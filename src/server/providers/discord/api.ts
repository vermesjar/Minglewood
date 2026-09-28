/**
 * Thin Discord REST client (API v10). Only endpoints we actually use, all documented at
 * https://docs.discord.com/developers — see docs/DISCORD.md for the capability audit.
 */
export const DISCORD_API = 'https://discord.com/api/v10';

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Discord API ${status}: ${body.slice(0, 200)}`);
  }
}

async function call<T>(path: string, init: RequestInit & { auth: string }): Promise<T> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: { Authorization: init.auth, 'User-Agent': 'Minglewood (https://minglewood.dev, 0.1)', ...(init.headers ?? {}) },
  });
  if (res.status === 429) {
    const retry = Number((await res.json().catch(() => ({})) as { retry_after?: number }).retry_after ?? 1);
    await new Promise((r) => setTimeout(r, Math.min(5, retry) * 1000));
    return call(path, init);
  }
  if (!res.ok) throw new DiscordApiError(res.status, await res.text());
  return (await res.json()) as T;
}

export const bot = (token: string) => `Bot ${token}`;
export const bearer = (token: string) => `Bearer ${token}`;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}
export interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
  roles: string[];
}
export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  parent_id?: string | null;
  position?: number;
}
export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string | null;
}

export const ChannelType = { GUILD_TEXT: 0, GUILD_VOICE: 2, GUILD_CATEGORY: 4, GUILD_STAGE_VOICE: 13 } as const;

export const discordApi = {
  me: (accessToken: string) => call<DiscordUser>('/users/@me', { auth: bearer(accessToken) }),
  /** Requires the `guilds.members.read` scope. 404 when the user is not in the guild. */
  myGuildMember: (accessToken: string, guildId: string) =>
    call<DiscordGuildMember>(`/users/@me/guilds/${guildId}/member`, { auth: bearer(accessToken) }),
  botGuilds: (token: string) => call<DiscordGuild[]>('/users/@me/guilds', { auth: bot(token) }),
  guildChannels: (token: string, guildId: string) =>
    call<DiscordChannel[]>(`/guilds/${guildId}/channels`, { auth: bot(token) }),
  exchangeCode: async (clientId: string, clientSecret: string, code: string, redirectUri?: string) => {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code });
    if (redirectUri) body.set('redirect_uri', redirectUri);
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body,
    });
    if (!res.ok) throw new DiscordApiError(res.status, await res.text());
    return (await res.json()) as { access_token: string; token_type: string; expires_in: number; scope: string };
  },
};

export function avatarUrl(u: DiscordUser): string | undefined {
  return u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : undefined;
}
