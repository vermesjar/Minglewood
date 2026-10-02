/**
 * Thin Slack Web API client — only the methods we use (https://api.slack.com/methods). Calls go through a
 * transport so the same code talks to Slack in production, to a mocked `fetch` in tests, and to the recording
 * mock transport in local development (SLACK_MOCK=true), where nothing leaves the machine.
 */
import { SLACK_BOT_SCOPES } from './scopes';

export const SLACK_API = 'https://slack.com/api';

export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly error: string,
    readonly status = 200,
  ) {
    super(`Slack ${method}: ${error}`);
  }
}

export interface SlackCall {
  method: string;
  token?: string;
  args: Record<string, unknown>;
}

/** Sends one Web API call and returns Slack's JSON body. */
export type SlackTransport = (call: SlackCall) => Promise<Record<string, unknown>>;

/**
 * Methods that accept a JSON body (https://api.slack.com/web#posting_json): the ones with nested arguments
 * (blocks, unfurls). Every other method is sent form-encoded — Slack answers `invalid_arguments` to JSON on
 * read methods like conversations.info.
 */
const JSON_METHODS = new Set(['chat.postMessage', 'chat.unfurl', 'chat.update', 'conversations.open', 'users.profile.set']);

/** The real transport: JSON only where Slack takes it, form-encoded otherwise; waits out one 429. */
export const fetchTransport: SlackTransport = async (call) => {
  const json = JSON_METHODS.has(call.method);
  const headers: Record<string, string> = {
    'Content-Type': json ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded',
  };
  if (call.token) headers.Authorization = `Bearer ${call.token}`;
  const body = json
    ? JSON.stringify(call.args)
    : new URLSearchParams(Object.entries(call.args).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])).toString();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${SLACK_API}/${call.method}`, { method: 'POST', headers, body });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, Math.min(5, Number(res.headers.get('retry-after') ?? '1')) * 1000));
      continue;
    }
    if (!res.ok) throw new SlackApiError(call.method, `http_${res.status}`, res.status);
    const json = (await res.json()) as Record<string, unknown>;
    // Slack names the token's granted scopes in a header on every call; the readiness check reads them.
    const scopes = res.headers.get('x-oauth-scopes');
    if (scopes) json.response_metadata = { ...((json.response_metadata as Record<string, unknown> | undefined) ?? {}), scopes: scopes.split(',').map((s) => s.trim()).filter(Boolean) };
    return json;
  }
};

/* ------------------------------------------------------------------ response shapes (the fields we read) */

export interface SlackOAuthAccess {
  access_token?: string;
  bot_user_id?: string;
  scope?: string;
  team: { id: string; name: string };
  /** With user scopes requested, the person's own token (xoxp-…) and what it may do. */
  authed_user: { id: string; access_token?: string; scope?: string };
}

export interface SlackOpenIdToken {
  access_token: string;
  id_token?: string;
}

/** openid.connect.userInfo — Slack puts its own ids under URL-shaped claim names. */
export interface SlackOpenIdUser {
  sub: string;
  'https://slack.com/user_id': string;
  'https://slack.com/team_id': string;
  'https://slack.com/team_name'?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
}

export interface SlackProfile {
  display_name?: string;
  real_name?: string;
  email?: string;
  image_72?: string;
  image_192?: string;
  status_text?: string;
  status_emoji?: string;
  status_expiration?: number;
  huddle_state?: string;
  huddle_state_call_id?: string;
}

export interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  team_id?: string;
  is_admin?: boolean;
  is_owner?: boolean;
  is_bot?: boolean;
  deleted?: boolean;
  tz?: string;
  profile?: SlackProfile;
}

export interface SlackChannel {
  id: string;
  name: string;
  /** The workspace's default channel (#general, or #all-<workspace> in newer workspaces). */
  is_general?: boolean;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
}

/** auth.test — who the bot token is, plus (from the response header) the scopes it was granted. */
export interface SlackAuthTest {
  user_id: string;
  bot_id?: string;
  team_id: string;
  team?: string;
  scopes: string[];
}

/** A channel message (conversations.history, or a `message` event). */
export interface SlackMessage {
  type?: string;
  subtype?: string;
  ts: string;
  user?: string;
  /** Set on messages from apps and bots (including ours). */
  bot_id?: string;
  /** A custom name a bot posted under (chat:write.customize). */
  username?: string;
  bot_profile?: { id?: string; name?: string; icons?: { image_72?: string } };
  text?: string;
  thread_ts?: string;
  files?: Array<{ name?: string; title?: string }>;
  /** Only on events. */
  channel?: string;
}

/* ------------------------------------------------------------------ the client */

export class SlackApi {
  constructor(private readonly transport: SlackTransport = fetchTransport) {}

  private async call<T>(method: string, args: Record<string, unknown>, token?: string): Promise<T> {
    const body = await this.transport({ method, token, args });
    if (body.ok !== true) throw new SlackApiError(method, String(body.error ?? 'unknown_error'));
    return body as T;
  }

  /** OAuth v2 workspace install: exchanges the code for the workspace's bot token. */
  oauthAccess(clientId: string, clientSecret: string, code: string, redirectUri: string) {
    return this.call<SlackOAuthAccess>('oauth.v2.access', { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
  }

  /** Sign in with Slack (OpenID Connect): code → the user's own token. */
  openIdToken(clientId: string, clientSecret: string, code: string, redirectUri: string) {
    return this.call<SlackOpenIdToken>('openid.connect.token', { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
  }

  openIdUserInfo(userToken: string) {
    return this.call<SlackOpenIdUser & { ok: true }>('openid.connect.userInfo', {}, userToken);
  }

  usersInfo(botToken: string, user: string) {
    return this.call<{ user: SlackUser }>('users.info', { user }, botToken).then((r) => r.user);
  }

  teamInfo(botToken: string) {
    return this.call<{ team: { id: string; name: string; domain?: string } }>('team.info', {}, botToken).then((r) => r.team);
  }

  /** Channels the bot can see: public, plus private ones it's been invited to. */
  async conversations(botToken: string): Promise<SlackChannel[]> {
    const out: SlackChannel[] = [];
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const r = await this.call<{ channels: SlackChannel[]; response_metadata?: { next_cursor?: string } }>(
        'conversations.list',
        { types: 'public_channel,private_channel', exclude_archived: true, limit: 200, ...(cursor ? { cursor } : {}) },
        botToken,
      );
      out.push(...r.channels);
      cursor = r.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }
    return out;
  }

  /**
   * Post in a channel. With `as`, the message carries that person's name and picture (chat:write.customize);
   * Slack still marks it as from the app. Mentions typed as text are never linked, so nothing pings anyone.
   */
  postMessage(botToken: string, channel: string, text: string, blocks?: unknown[], as?: { username: string; iconUrl?: string }) {
    return this.call<{ ts: string; channel: string }>(
      'chat.postMessage',
      {
        channel,
        text,
        ...(blocks ? { blocks } : {}),
        ...(as ? { username: as.username, ...(as.iconUrl ? { icon_url: as.iconUrl } : {}) } : {}),
        unfurl_links: false,
        link_names: false,
      },
      botToken,
    );
  }

  /** Set the status of the person whose user token this is (users.profile:write). */
  setUserStatus(userToken: string, profile: { status_text: string; status_emoji: string; status_expiration: number }) {
    return this.call<Record<string, unknown>>('users.profile.set', { profile }, userToken);
  }

  /** Who this bot token is, and which scopes it holds. */
  authTest(botToken: string) {
    return this.call<{ user_id: string; bot_id?: string; team_id: string; team?: string; response_metadata?: { scopes?: string[] } }>('auth.test', {}, botToken).then(
      (r): SlackAuthTest => ({ user_id: r.user_id, bot_id: r.bot_id, team_id: r.team_id, team: r.team, scopes: r.response_metadata?.scopes ?? [] }),
    );
  }

  /** A channel's recent messages, newest first (channels:history / groups:history; the app must be in the channel). */
  conversationsHistory(botToken: string, channel: string, limit = 30) {
    return this.call<{ messages: SlackMessage[] }>('conversations.history', { channel, limit }, botToken).then((r) => r.messages);
  }

  conversationsInfo(botToken: string, channel: string) {
    return this.call<{ channel: SlackChannel }>('conversations.info', { channel }, botToken).then((r) => r.channel);
  }

  /** Create a public channel (channels:manage). Names must be lowercase, no spaces or periods, at most 80 characters. */
  conversationsCreate(botToken: string, name: string) {
    return this.call<{ channel: SlackChannel }>('conversations.create', { name, is_private: false }, botToken).then((r) => r.channel);
  }

  /** Invite people to a channel the app is in (channels:manage) — a channel the setup created has only the app in it. */
  conversationsInvite(botToken: string, channel: string, users: string[]) {
    return this.call<{ channel: SlackChannel }>('conversations.invite', { channel, users: users.join(',') }, botToken).then((r) => r.channel);
  }

  /** Join a public channel (channels:join), so its messages and huddles reach us. Private ones need /invite. */
  conversationsJoin(botToken: string, channel: string) {
    return this.call<{ channel: SlackChannel }>('conversations.join', { channel }, botToken).then((r) => r.channel);
  }

  /** Previews for links in a message: by channel + message ts, or the newer unfurl_id + source. */
  unfurl(botToken: string, target: { channel: string; ts: string } | { unfurl_id: string; source: string }, unfurls: Record<string, unknown>) {
    return this.call<Record<string, never>>('chat.unfurl', { ...target, unfurls }, botToken);
  }

  /** Opens (or finds) the bot's DM with a user. */
  openDm(botToken: string, user: string) {
    return this.call<{ channel: { id: string } }>('conversations.open', { users: user }, botToken).then((r) => r.channel.id);
  }

  /** Opens (or finds) a group DM of these people and the app (mpim:write) — a place for a table's huddle. */
  openGroupDm(botToken: string, users: string[]) {
    return this.call<{ channel: { id: string } }>('conversations.open', { users: users.join(',') }, botToken).then((r) => r.channel.id);
  }
}

/* ------------------------------------------------------------------ the local mock */

/**
 * Local development without a Slack workspace (SLACK_MOCK=true): records every outgoing call (see
 * GET /api/slack/dev/outbox) and answers with plausible data, so the whole flow — events in, messages,
 * unfurls and DMs out — can be exercised with scripts/slack-simulate.ts.
 */
export class MockSlack {
  readonly outbox: Array<SlackCall & { at: string }> = [];
  /** Users the mock knows (users.info); the simulator registers them. */
  readonly users = new Map<string, SlackUser>();
  readonly channels: SlackChannel[] = [
    { id: 'C0CAFE', name: 'cafe', is_member: true },
    { id: 'C0HQ', name: 'general', is_member: true, is_general: true },
    { id: 'C0ENG', name: 'eng', is_member: false },
    { id: 'C0LAUNCH', name: 'launch-war-room', is_member: true },
    { id: 'C0EVENTS', name: 'all-hands', is_member: true },
    { id: 'C0ARCADE', name: 'game-night', is_member: true },
    { id: 'C0DESIGN', name: 'design', is_member: true },
    { id: 'C0FOCUS', name: 'quiet-hours', is_member: true },
  ];
  /** Messages per channel, oldest first (conversations.history); what we post lands here too. */
  readonly history = new Map<string, SlackMessage[]>();
  /** The pretend bot user, and the scopes the pretend install granted (all of them unless the simulator says otherwise). */
  botUserId = 'U0MOCKBOT';
  botId = 'B0MOCK';
  scopes: string[] = [...SLACK_BOT_SCOPES];
  private nextChannel = 1;

  transport: SlackTransport = async (call) => {
    this.outbox.push({ ...call, token: call.token ? `${call.token.slice(0, 5)}…` : undefined, at: new Date().toISOString() });
    if (this.outbox.length > 200) this.outbox.shift();
    const channelOf = (id: unknown) => this.channels.find((c) => c.id === String(id));
    switch (call.method) {
      case 'oauth.v2.access':
        return { ok: true, access_token: 'xoxb-mock-installed', bot_user_id: this.botUserId, team: { id: 'T0MOCK', name: 'Mock workspace' }, authed_user: { id: 'U0INSTALLER', access_token: 'xoxp-mock-user', scope: 'users.profile:write' } };
      case 'users.profile.set':
        return { ok: true, profile: call.args.profile };
      case 'auth.test':
        return { ok: true, user_id: this.botUserId, bot_id: this.botId, team_id: 'T0MOCK', team: 'Mock workspace', response_metadata: { scopes: this.scopes } };
      case 'users.info': {
        const id = String(call.args.user);
        return { ok: true, user: this.users.get(id) ?? { id, name: id.toLowerCase(), real_name: `Slack user ${id}`, profile: {} } };
      }
      case 'team.info':
        return { ok: true, team: { id: 'T0MOCK', name: 'Mock workspace', domain: 'mock' } };
      case 'conversations.list':
        return { ok: true, channels: this.channels, response_metadata: { next_cursor: '' } };
      case 'conversations.info': {
        const c = channelOf(call.args.channel);
        return c ? { ok: true, channel: c } : { ok: false, error: 'channel_not_found' };
      }
      case 'conversations.history': {
        const c = channelOf(call.args.channel);
        if (!c) return { ok: false, error: 'channel_not_found' };
        if (!c.is_member) return { ok: false, error: 'not_in_channel' };
        return { ok: true, messages: [...(this.history.get(c.id) ?? [])].reverse().slice(0, Number(call.args.limit ?? 30)) };
      }
      case 'conversations.create': {
        const name = String(call.args.name);
        if (this.channels.some((c) => c.name === name)) return { ok: false, error: 'name_taken' };
        const made: SlackChannel = { id: `C0NEW${this.nextChannel++}`, name, is_member: true };
        this.channels.push(made);
        return { ok: true, channel: made };
      }
      case 'conversations.invite': {
        const c = channelOf(call.args.channel);
        return c ? { ok: true, channel: c } : { ok: false, error: 'channel_not_found' };
      }
      case 'conversations.join': {
        const c = channelOf(call.args.channel);
        if (!c) return { ok: false, error: 'channel_not_found' };
        if (c.is_private) return { ok: false, error: 'method_not_supported_for_channel_type' };
        c.is_member = true;
        return { ok: true, channel: c };
      }
      case 'conversations.open': {
        const users = String(call.args.users).split(',');
        return { ok: true, channel: { id: users.length > 1 ? `G0MPIM${users.length}` : `D${users[0]}` } };
      }
      case 'chat.postMessage': {
        const ts = `${Math.floor(Date.now() / 1000)}.${String(this.outbox.length).padStart(6, '0')}`;
        const c = channelOf(call.args.channel);
        if (c) {
          const msg: SlackMessage = { type: 'message', ts, user: this.botUserId, bot_id: this.botId, text: String(call.args.text ?? ''), ...(call.args.username ? { username: String(call.args.username) } : {}) };
          this.history.set(c.id, [...(this.history.get(c.id) ?? []), msg]);
        }
        return { ok: true, ts, channel: call.args.channel };
      }
      case 'chat.unfurl':
        return { ok: true };
      default:
        return { ok: false, error: 'not_mocked' };
    }
  };
}
