/**
 * Slack behind the CommunicationProvider seam: Sign in with Slack (OpenID Connect), the workspace install
 * (OAuth v2 → a bot token), channel listing for room bindings, and join links. See docs/slack.md for the setup
 * and the capability audit (what Slack lets an app do, and what it doesn't).
 */
import type { RoomBinding } from '@shared/domain/types';
import { config, slackConfigured, slackSigningConfigured } from '../config';
import type { CommunicationProvider, ExternalChannel, JoinInstruction, ProviderCapabilities } from '../providers/types';
import { SlackApi, type SlackUser } from './api';
import { SLACK_BOT_SCOPES } from './scopes';
import type { SlackTokens } from './tokens';

/** Sign in with Slack: who you are, your workspace, your email (to link you across sign-in methods). */
export const SLACK_SIGNIN_SCOPES = ['openid', 'profile', 'email'];

export { SLACK_BOT_SCOPES } from './scopes';

export interface SlackSignIn {
  userId: string;
  teamId: string;
  teamName?: string;
  email?: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

export interface SlackInstall {
  teamId: string;
  teamName: string;
  botToken: string;
  installerUserId: string;
}

export class SlackProvider implements CommunicationProvider {
  readonly kind = 'slack' as const;

  constructor(
    readonly api: SlackApi,
    readonly tokens: SlackTokens,
  ) {}

  get capabilities(): ProviderCapabilities {
    const bot = this.tokens.has(undefined);
    return {
      identity: slackConfigured(),
      channelListing: bot,
      // huddle presence arrives as signed events; it needs the bot (history scopes) and the signing secret
      voicePresence: bot && slackSigningConfigured(),
      // Slack exposes no real-time speaking signal to apps
      speakingIndicators: false,
      // no API puts a person into a huddle; a link opens it and they click Join
      directVoiceJoin: false,
      deepLinkJoin: true,
      embeddedApp: false,
      // what's said in a space is posted to its channel as you, and the channel's messages show in the space (Events API)
      chatBridge: bot && slackSigningConfigured(),
      // no API moves someone between huddles; the other way round (joining a huddle walks your avatar) is part of voicePresence
      voiceFollow: false,
    };
  }

  /** Sign in with Slack (OpenID Connect). `team` pre-selects the workspace. */
  authorizeUrl(state: string, nonce: string, team?: string): string {
    const p = new URLSearchParams({
      response_type: 'code',
      scope: SLACK_SIGNIN_SCOPES.join(' '),
      client_id: config.slack.clientId,
      state,
      nonce,
      redirect_uri: config.slack.signInRedirectUri,
    });
    if (team) p.set('team', team);
    return `https://slack.com/openid/connect/authorize?${p}`;
  }

  /** Add Minglewood to a workspace (OAuth v2): the bot token that powers presence, chat, previews and DMs. */
  installUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: config.slack.clientId,
      scope: SLACK_BOT_SCOPES.join(','),
      redirect_uri: config.slack.installRedirectUri,
      state,
    });
    return `https://slack.com/oauth/v2/authorize?${p}`;
  }

  /**
   * Finishes Sign in with Slack. The id_token comes straight from Slack's token endpoint over TLS, so (per
   * OpenID Connect) its claims can be read without a signature check; its nonce must be the one we sent.
   */
  async signIn(code: string, nonce?: string): Promise<SlackSignIn> {
    const tok = await this.api.openIdToken(config.slack.clientId, config.slack.clientSecret, code, config.slack.signInRedirectUri);
    if (nonce !== undefined && idTokenClaims(tok.id_token).nonce !== nonce) throw new Error('nonce mismatch');
    const u = await this.api.openIdUserInfo(tok.access_token);
    return {
      userId: u['https://slack.com/user_id'],
      teamId: u['https://slack.com/team_id'],
      teamName: u['https://slack.com/team_name'],
      email: u.email,
      emailVerified: !!u.email_verified,
      name: u.name || u.given_name || 'Teammate',
      picture: u.picture,
    };
  }

  async install(code: string): Promise<SlackInstall> {
    const r = await this.api.oauthAccess(config.slack.clientId, config.slack.clientSecret, code, config.slack.installRedirectUri);
    return { teamId: r.team.id, teamName: r.team.name, botToken: r.access_token, installerUserId: r.authed_user.id };
  }

  /** A person's Slack profile (workspace admin flags, status, huddle state), when the bot can see it. */
  async user(teamId: string, userId: string): Promise<SlackUser | null> {
    const token = this.tokens.forTeam(teamId);
    if (!token) return null;
    return this.api.usersInfo(token, userId).catch(() => null);
  }

  async listChannels(teamId: string): Promise<ExternalChannel[]> {
    const token = this.tokens.forTeam(teamId);
    if (!token) return [];
    const channels = await this.api.conversations(token);
    return channels
      .filter((c) => !c.is_archived)
      .sort((a, b) => a.name.localeCompare(b.name))
      // Every Slack channel can hold a huddle: binding a room to a channel means "this room is that channel's huddle".
      .map((c) => ({ id: c.id, name: c.name, kind: 'voice' as const, parentName: c.is_private ? 'Private' : undefined }));
  }

  joinInstruction(binding: RoomBinding): JoinInstruction {
    const team = binding.externalGuildId ?? '';
    const channel = binding.externalChannelId;
    const name = binding.label.replace(/^[^#\w]*#?/, '');
    const huddle = binding.kind !== 'text';
    // Slack's huddle link (app.slack.com/huddle/{team}/{channel}) launches the desktop app straight into the
    // huddle — but only while one is running; with none it answers "Server Error". So: the huddle link when
    // someone's already in it (liveWebUrl), otherwise the channel, where the headphones button starts one.
    return {
      kind: 'deeplink',
      label: huddle ? `Join the huddle in #${name}` : `Open #${name} in Slack`,
      webUrl: `https://app.slack.com/client/${team}/${channel}`,
      appUrl: `slack://channel?team=${team}&id=${channel}`,
      ...(huddle ? { liveWebUrl: `https://app.slack.com/huddle/${team}/${channel}` } : {}),
      explainer: huddle
        ? 'Joins the huddle in Slack (one click once it’s running); with nobody in it yet, opens the channel so the headphones button can start it. Slack doesn’t let apps put you into a huddle automatically.'
        : 'Opens the channel in Slack. What’s said here in the world is posted there too.',
    };
  }
}

/** The claims of a JWT (not verified — see signIn). */
function idTokenClaims(jwt: string | undefined): { nonce?: string } {
  try {
    return JSON.parse(Buffer.from((jwt ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')) as { nonce?: string };
  } catch {
    return {};
  }
}
