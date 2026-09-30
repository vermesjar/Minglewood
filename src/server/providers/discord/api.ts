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
    headers: { ...(init.auth ? { Authorization: init.auth } : {}), 'User-Agent': 'Minglewood (https://minglewood.dev, 0.1)', ...(init.headers ?? {}) },
  });
  if (res.status === 429) {
    const retry = Number((await res.json().catch(() => ({})) as { retry_after?: number }).retry_after ?? 1);
    await new Promise((r) => setTimeout(r, Math.min(5, retry) * 1000));
    return call(path, init);
  }
  if (!res.ok) throw new DiscordApiError(res.status, await res.text());
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): Pick<RequestInit, 'body' | 'headers'> => ({
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

/** Never let a bridged message ping anyone: mentions are shown, not triggered. */
const NO_PINGS = { allowed_mentions: { parse: [] as string[] } };

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
export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  webhook_id?: string;
  author: DiscordUser & { bot?: boolean };
  member?: { nick?: string | null };
  mentions?: Array<DiscordUser & { member?: { nick?: string | null } }>;
  attachments?: Array<{ filename: string }>;
  embeds?: unknown[];
  sticker_items?: Array<{ name: string }>;
}
export interface DiscordWebhook {
  id: string;
  token?: string;
  name?: string | null;
  application_id?: string | null;
  channel_id?: string | null;
}
export interface DiscordRole {
  id: string;
  permissions: string;
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
  /** Requires the `guilds` scope. Includes `owner` and the user's `permissions` bitfield. */
  myGuilds: (accessToken: string) =>
    call<Array<DiscordGuild & { owner?: boolean; permissions?: string }>>('/users/@me/guilds', { auth: bearer(accessToken) }),
  botGuilds: (token: string) => call<DiscordGuild[]>('/users/@me/guilds', { auth: bot(token) }),
  guildChannels: (token: string, guildId: string) =>
    call<DiscordChannel[]>(`/guilds/${guildId}/channels`, { auth: bot(token) }),
  guild: (token: string, guildId: string) => call<DiscordGuild & { owner_id: string }>(`/guilds/${guildId}`, { auth: bot(token) }),
  guildRoles: (token: string, guildId: string) => call<DiscordRole[]>(`/guilds/${guildId}/roles`, { auth: bot(token) }),
  guildMember: (token: string, guildId: string, userId: string) =>
    call<DiscordGuildMember>(`/guilds/${guildId}/members/${userId}`, { auth: bot(token) }),
  botUser: (token: string) => call<DiscordUser>('/users/@me', { auth: bot(token) }),
  /** Recent messages, newest first. Needs View Channel + Read Message History (and the Message Content intent for text). */
  channelMessages: (token: string, channelId: string, limit = 30) =>
    call<DiscordMessage[]>(`/channels/${channelId}/messages?limit=${limit}`, { auth: bot(token) }),
  sendMessage: (token: string, channelId: string, content: string) =>
    call<DiscordMessage>(`/channels/${channelId}/messages`, { method: 'POST', auth: bot(token), ...json({ content, ...NO_PINGS }) }),
  channelWebhooks: (token: string, channelId: string) => call<DiscordWebhook[]>(`/channels/${channelId}/webhooks`, { auth: bot(token) }),
  createWebhook: (token: string, channelId: string, name: string) =>
    call<DiscordWebhook>(`/channels/${channelId}/webhooks`, { method: 'POST', auth: bot(token), ...json({ name }) }),
  /** Post as a person (their name and avatar) through our webhook. */
  executeWebhook: (hook: { id: string; token: string }, body: { content: string; username: string; avatar_url?: string }) =>
    call<DiscordMessage>(`/webhooks/${hook.id}/${hook.token}?wait=true`, { method: 'POST', auth: '', ...json({ ...body, ...NO_PINGS }) }),
  /** Move a member who is already connected to voice. Needs Move Members (and Connect on the target). */
  moveMember: (token: string, guildId: string, userId: string, channelId: string) =>
    call<unknown>(`/guilds/${guildId}/members/${userId}`, { method: 'PATCH', auth: bot(token), ...json({ channel_id: channelId }) }),
  createChannel: (token: string, guildId: string, body: { name: string; type: number; parent_id?: string; topic?: string }) =>
    call<DiscordChannel>(`/guilds/${guildId}/channels`, { method: 'POST', auth: bot(token), ...json(body) }),
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
