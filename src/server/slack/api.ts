/**
 * Thin Slack Web API client — only the methods we use (https://api.slack.com/methods). Calls go through a
 * transport so the same code talks to Slack in production, to a mocked `fetch` in tests, and to the recording
 * mock transport in local development (SLACK_MOCK=true), where nothing leaves the machine.
 */
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

/** The real transport: form-encoded for OAuth exchanges, JSON for everything else; waits out one 429. */
export const fetchTransport: SlackTransport = async (call) => {
  const oauth = call.method.startsWith('oauth.') || call.method === 'openid.connect.token';
  const headers: Record<string, string> = {
    'Content-Type': oauth ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8',
  };
  if (call.token) headers.Authorization = `Bearer ${call.token}`;
  const body = oauth
    ? new URLSearchParams(Object.entries(call.args).map(([k, v]) => [k, String(v)])).toString()
    : JSON.stringify(call.args);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${SLACK_API}/${call.method}`, { method: 'POST', headers, body });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, Math.min(5, Number(res.headers.get('retry-after') ?? '1')) * 1000));
      continue;
    }
    if (!res.ok) throw new SlackApiError(call.method, `http_${res.status}`, res.status);
    return (await res.json()) as Record<string, unknown>;
  }
};

/* ------------------------------------------------------------------ response shapes (the fields we read) */

export interface SlackOAuthAccess {
  access_token: string;
  bot_user_id?: string;
  scope?: string;
  team: { id: string; name: string };
  authed_user: { id: string };
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
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
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

  postMessage(botToken: string, channel: string, text: string, blocks?: unknown[]) {
    return this.call<{ ts: string; channel: string }>('chat.postMessage', { channel, text, ...(blocks ? { blocks } : {}), unfurl_links: false }, botToken);
  }

  /** Previews for links in a message: by channel + message ts, or the newer unfurl_id + source. */
  unfurl(botToken: string, target: { channel: string; ts: string } | { unfurl_id: string; source: string }, unfurls: Record<string, unknown>) {
    return this.call<Record<string, never>>('chat.unfurl', { ...target, unfurls }, botToken);
  }

  /** Opens (or finds) the bot's DM with a user. */
  openDm(botToken: string, user: string) {
    return this.call<{ channel: { id: string } }>('conversations.open', { users: user }, botToken).then((r) => r.channel.id);
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
    { id: 'C0HQ', name: 'general', is_member: true },
    { id: 'C0ENG', name: 'eng', is_member: true },
    { id: 'C0LAUNCH', name: 'launch-war-room', is_member: true },
    { id: 'C0EVENTS', name: 'all-hands', is_member: true },
    { id: 'C0ARCADE', name: 'game-night', is_member: true },
    { id: 'C0DESIGN', name: 'design', is_member: true },
    { id: 'C0FOCUS', name: 'quiet-hours', is_member: true },
  ];

  transport: SlackTransport = async (call) => {
    this.outbox.push({ ...call, token: call.token ? `${call.token.slice(0, 5)}…` : undefined, at: new Date().toISOString() });
    if (this.outbox.length > 200) this.outbox.shift();
    switch (call.method) {
      case 'users.info': {
        const id = String(call.args.user);
        return { ok: true, user: this.users.get(id) ?? { id, name: id.toLowerCase(), real_name: `Slack user ${id}`, profile: {} } };
      }
      case 'team.info':
        return { ok: true, team: { id: 'T0MOCK', name: 'Mock workspace', domain: 'mock' } };
      case 'conversations.list':
        return { ok: true, channels: this.channels, response_metadata: { next_cursor: '' } };
      case 'conversations.open':
        return { ok: true, channel: { id: `D${String(call.args.users)}` } };
      case 'chat.postMessage':
        return { ok: true, ts: String(Date.now() / 1000), channel: call.args.channel };
      case 'chat.unfurl':
        return { ok: true };
      default:
        return { ok: false, error: 'not_mocked' };
    }
  };
}
