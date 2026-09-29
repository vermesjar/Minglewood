import type { RoomBinding } from '@shared/domain/types';
import { config, discordBotConfigured, discordConfigured } from '../../config';
import type {
  CommunicationProvider,
  ExternalChannel,
  ExternalIdentityProfile,
  JoinInstruction,
  ProviderCapabilities,
} from '../types';
import { avatarUrl, ChannelType, DiscordApiError, discordApi } from './api';

/** Minimum OAuth scopes: who you are, and whether you're in the company's server. */
export const DISCORD_LOGIN_SCOPES = ['identify', 'guilds', 'guilds.members.read'];

export interface UserGuild {
  id: string;
  name: string;
  /** Server owner or has Administrator / Manage Server — becomes a Minglewood admin. */
  manager: boolean;
}

const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;
/** Bot install: View Channels only (1024) — enough to list channels and see voice occupancy. */
export const DISCORD_BOT_PERMISSIONS = '1024';

export class DiscordProvider implements CommunicationProvider {
  readonly kind = 'discord' as const;

  get capabilities(): ProviderCapabilities {
    return {
      identity: discordConfigured(),
      channelListing: discordBotConfigured(),
      voicePresence: discordBotConfigured(),
      // Speaking events exist in the Embedded App SDK but require the `rpc.voice.read` scope,
      // which Discord grants to approved partners only. Bots see speaking only by joining voice.
      speakingIndicators: false,
      // No API moves a user into voice unless they're already connected; the SDK has no join command.
      directVoiceJoin: false,
      deepLinkJoin: true,
      embeddedApp: !!config.discord.clientId,
    };
  }

  authorizeUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: config.discord.clientId,
      response_type: 'code',
      redirect_uri: config.discord.redirectUri,
      scope: DISCORD_LOGIN_SCOPES.join(' '),
      state,
      prompt: 'none',
    });
    return `https://discord.com/oauth2/authorize?${p}`;
  }

  botInstallUrl(): string {
    const p = new URLSearchParams({
      client_id: config.discord.clientId,
      scope: 'bot',
      permissions: DISCORD_BOT_PERMISSIONS,
    });
    return `https://discord.com/oauth2/authorize?${p}`;
  }

  /** Exchanges a code and verifies membership of `guildId`. Never stores the access token. */
  /** Exchange a code and return the user plus the servers they belong to. */
  async signIn(code: string, redirectUri?: string) {
    const tok = await discordApi.exchangeCode(config.discord.clientId, config.discord.clientSecret, code, redirectUri);
    const [user, guilds] = await Promise.all([discordApi.me(tok.access_token), discordApi.myGuilds(tok.access_token).catch(() => [])]);
    const userGuilds: UserGuild[] = guilds.map((g) => {
      let perms = 0n;
      try {
        perms = BigInt(g.permissions ?? '0');
      } catch {
        perms = 0n;
      }
      return { id: g.id, name: g.name, manager: !!g.owner || (perms & ADMINISTRATOR) !== 0n || (perms & MANAGE_GUILD) !== 0n };
    });
    return { accessToken: tok.access_token, user, guilds: userGuilds };
  }

  /** Nickname and roles in one server (guilds.members.read). */
  async memberProfile(accessToken: string, user: { id: string; username: string; global_name?: string | null; avatar?: string | null }, guildId: string): Promise<ExternalIdentityProfile> {
    let nick: string | undefined;
    let roles: string[] = [];
    let workspaceMember = false;
    try {
      const gm = await discordApi.myGuildMember(accessToken, guildId);
      workspaceMember = true;
      nick = gm.nick ?? undefined;
      roles = gm.roles;
    } catch (e) {
      if (!(e instanceof DiscordApiError) || e.status !== 404) throw e;
    }
    return {
      externalId: user.id,
      username: user.username,
      displayName: nick ?? user.global_name ?? user.username,
      avatarUrl: avatarUrl(user),
      workspaceMember,
      workspaceNick: nick,
      roleIds: roles,
    };
  }

  async identify(code: string, guildId: string | undefined, redirectUri?: string): Promise<ExternalIdentityProfile & { accessToken: string }> {
    const tok = await discordApi.exchangeCode(config.discord.clientId, config.discord.clientSecret, code, redirectUri);
    const user = await discordApi.me(tok.access_token);
    let workspaceMember = false;
    let nick: string | undefined;
    let roles: string[] = [];
    if (guildId) {
      try {
        const gm = await discordApi.myGuildMember(tok.access_token, guildId);
        workspaceMember = true;
        nick = gm.nick ?? undefined;
        roles = gm.roles;
      } catch (e) {
        if (!(e instanceof DiscordApiError) || e.status !== 404) throw e;
      }
    }
    return {
      externalId: user.id,
      username: user.username,
      displayName: nick ?? user.global_name ?? user.username,
      avatarUrl: avatarUrl(user),
      workspaceMember,
      workspaceNick: nick,
      roleIds: roles,
      accessToken: tok.access_token,
    };
  }

  async listGuilds() {
    if (!discordBotConfigured()) return [];
    return discordApi.botGuilds(config.discord.botToken);
  }

  async listChannels(guildId: string): Promise<ExternalChannel[]> {
    if (!discordBotConfigured()) return [];
    const raw = await discordApi.guildChannels(config.discord.botToken, guildId);
    const categories = new Map(raw.filter((c) => c.type === ChannelType.GUILD_CATEGORY).map((c) => [c.id, c.name]));
    return raw
      .filter((c) => c.type !== ChannelType.GUILD_CATEGORY)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => ({
        id: c.id,
        name: c.name ?? c.id,
        kind:
          c.type === ChannelType.GUILD_VOICE
            ? 'voice'
            : c.type === ChannelType.GUILD_STAGE_VOICE
              ? 'stage'
              : c.type === ChannelType.GUILD_TEXT
                ? 'text'
                : 'other',
        parentName: c.parent_id ? categories.get(c.parent_id) ?? undefined : undefined,
      }));
  }

  joinInstruction(binding: RoomBinding): JoinInstruction {
    const g = binding.externalGuildId;
    const c = binding.externalChannelId;
    const voice = binding.kind === 'voice' || binding.kind === 'stage';
    return {
      kind: 'deeplink',
      label: voice ? `Join ${binding.label} in Discord` : `Open ${binding.label} in Discord`,
      webUrl: `https://discord.com/channels/${g}/${c}`,
      appUrl: `discord://-/channels/${g}/${c}`,
      explainer: voice
        ? 'Opens the voice channel in Discord — click “Join Voice” there. Discord doesn’t let apps move you into voice automatically.'
        : 'Opens the channel in Discord.',
    };
  }
}
