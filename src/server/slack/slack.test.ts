import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { ORG_ID } from '@shared/seed/northstar';
import type { ServerMsg } from '@shared/protocol';
import { config } from '../config';
import { createApp, type App } from '../app';
import { MemoryPersistence } from '../store/jsonFile';
import { MockSlack, SlackApi, fetchTransport, type SlackCall } from './api';
import { mapSlackStatus } from './status';
import { SlackProvider } from './provider';
import { SlackTokens } from './tokens';
import { slackSignature, verifySlackRequest } from './verify';

describe('Slack request signatures', () => {
  const secret = '8f742231b10e8888abcd99yyyzzz85a5';
  const body = 'token=xyz&team_id=T1&command=%2Fminglewood&text=who';
  const ts = '1531420618';

  it('accepts a correctly signed, fresh request', () => {
    const signature = slackSignature(secret, ts, body);
    expect(verifySlackRequest(secret, { timestamp: ts, signature }, body, Number(ts) + 10)).toEqual({ ok: true });
  });

  it('rejects a wrong signature, a tampered body, a stale timestamp, and missing headers', () => {
    const signature = slackSignature(secret, ts, body);
    expect(verifySlackRequest(secret, { timestamp: ts, signature: signature.replace(/.$/, '0') }, body, Number(ts))).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(verifySlackRequest(secret, { timestamp: ts, signature }, `${body}&admin=true`, Number(ts))).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(verifySlackRequest(secret, { timestamp: ts, signature }, body, Number(ts) + 6 * 60)).toMatchObject({ ok: false, reason: 'stale' });
    expect(verifySlackRequest(secret, { timestamp: ts }, body, Number(ts))).toMatchObject({ ok: false, reason: 'missing' });
    expect(verifySlackRequest('', { timestamp: ts, signature }, body, Number(ts))).toMatchObject({ ok: false, reason: 'no-secret' });
  });
});

describe('Slack status → Minglewood status', () => {
  it('reads the common conventions', () => {
    expect(mapSlackStatus({ emoji: ':spiral_calendar_pad:', text: 'In a meeting', expiration: 1_900_000_000 })).toMatchObject({
      status: 'meeting',
      note: 'In a meeting',
      until: new Date(1_900_000_000 * 1000).toISOString(),
    });
    expect(mapSlackStatus({ emoji: ':palm_tree:', text: 'Vacationing' })?.status).toBe('away');
    expect(mapSlackStatus({ text: 'out sick' })?.status).toBe('away');
    expect(mapSlackStatus({ emoji: ':headphones:', text: 'heads down' })?.status).toBe('focused');
    expect(mapSlackStatus({ emoji: ':wave:', text: 'come say hi' })?.status).toBe('open');
    expect(mapSlackStatus({ emoji: ':taco:', text: 'taco tuesday' })).toEqual({ status: 'available', note: 'taco tuesday', until: undefined });
  });

  it('treats Do Not Disturb as focus, and an empty status as no opinion', () => {
    expect(mapSlackStatus({ dnd: true })).toMatchObject({ status: 'focused', note: 'Do not disturb in Slack' });
    expect(mapSlackStatus({ dnd: true, text: 'writing', emoji: ':pencil:' })).toMatchObject({ status: 'focused', note: 'writing' });
    expect(mapSlackStatus({})).toBeNull();
  });
});

const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('Slack OAuth', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('installs to a workspace (OAuth v2) and signs people in (OpenID Connect)', async () => {
    const calls: SlackCall[] = [];
    const api = new SlackApi(async (call) => {
      calls.push(call);
      if (call.method === 'oauth.v2.access')
        return { ok: true, access_token: 'xoxb-1', team: { id: 'T1', name: 'Northstar' }, authed_user: { id: 'U1' } };
      if (call.method === 'openid.connect.token') return { ok: true, access_token: 'xoxp-user', id_token: jwt({ nonce: 'n-1' }) };
      if (call.method === 'openid.connect.userInfo')
        return {
          ok: true,
          sub: 'U2',
          'https://slack.com/user_id': 'U2',
          'https://slack.com/team_id': 'T1',
          'https://slack.com/team_name': 'Northstar',
          email: 'maya@northstar.dev',
          email_verified: true,
          name: 'Maya Chen',
        };
      return { ok: false, error: 'unexpected' };
    });
    const p = new SlackProvider(api, new SlackTokens(() => ''));
    await expect(p.install('code-1')).resolves.toEqual({ teamId: 'T1', teamName: 'Northstar', botToken: 'xoxb-1', installerUserId: 'U1' });
    await expect(p.signIn('code-2', 'n-1')).resolves.toMatchObject({ userId: 'U2', teamId: 'T1', email: 'maya@northstar.dev', emailVerified: true, name: 'Maya Chen' });
    expect(calls.map((c) => c.method)).toEqual(['oauth.v2.access', 'openid.connect.token', 'openid.connect.userInfo']);
    expect(calls[2].token).toBe('xoxp-user');
    // a replayed or swapped sign-in (the id_token's nonce isn't ours) is refused before we ask who it is
    await expect(p.signIn('code-3', 'n-2')).rejects.toThrow('nonce');
    expect(calls).toHaveLength(4);
  });

  it('surfaces Slack errors (ok: false) as SlackApiError', async () => {
    const api = new SlackApi(async () => ({ ok: false, error: 'invalid_code' }));
    await expect(new SlackProvider(api, new SlackTokens(() => '')).install('bad')).rejects.toThrow('invalid_code');
  });

  it('speaks HTTP the way Slack expects: form-encoded OAuth, JSON + bearer for the Web API, one retry on 429', async () => {
    vi.useFakeTimers();
    const seen: Array<{ url: string; type: string; auth?: string; body: string }> = [];
    let limited = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const h = init.headers as Record<string, string>;
        seen.push({ url, type: h['Content-Type'], auth: h.Authorization, body: String(init.body) });
        if (url.endsWith('chat.postMessage') && limited) {
          limited = false;
          return new Response('{}', { status: 429, headers: { 'Retry-After': '1' } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    await fetchTransport({ method: 'oauth.v2.access', args: { client_id: 'c', code: 'x' } });
    const posted = fetchTransport({ method: 'chat.postMessage', token: 'xoxb-1', args: { channel: 'C1', text: 'hi' } });
    await vi.advanceTimersByTimeAsync(1000);
    await posted;
    vi.useRealTimers();
    expect(seen[0]).toMatchObject({ url: 'https://slack.com/api/oauth.v2.access', type: 'application/x-www-form-urlencoded', body: 'client_id=c&code=x' });
    expect(seen[1]).toMatchObject({ url: 'https://slack.com/api/chat.postMessage', auth: 'Bearer xoxb-1' });
    expect(JSON.parse(seen[1].body)).toEqual({ channel: 'C1', text: 'hi' });
    expect(seen).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ end to end, over HTTP */

describe('Slack, end to end (signed requests into a running server, the recording mock out)', () => {
  let app: App;
  let base: string;
  const saved = { ...config.slack };
  const TEAM = 'T0MOCK';

  const signed = (body: string, type: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    return { 'Content-Type': type, 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': slackSignature(config.slack.signingSecret, ts, body) };
  };
  const event = (ev: Record<string, unknown>) => {
    const body = JSON.stringify({ type: 'event_callback', team_id: TEAM, event: ev });
    return fetch(`${base}/api/slack/events`, { method: 'POST', headers: signed(body, 'application/json'), body });
  };
  const command = (userId: string, text: string) => {
    const body = new URLSearchParams({ team_id: TEAM, user_id: userId, command: '/minglewood', text }).toString();
    return fetch(`${base}/api/slack/commands`, { method: 'POST', headers: signed(body, 'application/x-www-form-urlencoded'), body }).then(
      (r) => r.json() as Promise<{ response_type: string; text: string }>,
    );
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const outbox = () => fetch(`${base}/api/slack/dev/outbox`).then((r) => r.json() as Promise<{ outbox: SlackCall[] }>);

  beforeAll(async () => {
    Object.assign(config.slack, { signingSecret: 'test-signing-secret', teamId: TEAM, mock: true, botToken: '', clientId: 'test-client', clientSecret: 'test-secret' });
    app = await createApp({ persistence: new MemoryPersistence(), simulateCoworkers: false });
    await new Promise<void>((r) => app.server.listen(0, r));
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    // Maya (a seeded coworker) is U1 in Slack; the Design Loft is #design's huddle
    const maya = app.store.members(ORG_ID).find((m) => m.displayName.startsWith('Maya'))!;
    app.store.linkIdentity(ORG_ID, { provider: 'slack', externalId: 'U1', memberId: maya.id, linkedAt: new Date().toISOString() });
    app.store.setBinding(ORG_ID, { id: 'b1', orgId: ORG_ID, roomId: 'design', provider: 'slack', kind: 'voice', externalGuildId: TEAM, externalChannelId: 'C0DESIGN', label: '🎧 #design' }, 'design');
  });

  afterAll(async () => {
    await app.close();
    Object.assign(config.slack, saved);
  });

  const maya = () => app.store.members(ORG_ID).find((m) => m.displayName.startsWith('Maya'))!;

  it('answers Slack’s URL check, and refuses unsigned or mis-signed requests', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    const ok = await fetch(`${base}/api/slack/events`, { method: 'POST', headers: signed(body, 'application/json'), body });
    expect(await ok.json()).toEqual({ challenge: 'abc123' });
    const unsigned = await fetch(`${base}/api/slack/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(unsigned.status).toBe(401);
    const forged = await fetch(`${base}/api/slack/events`, { method: 'POST', headers: { ...signed(body, 'application/json'), 'X-Slack-Signature': 'v0=00' }, body });
    expect(forged.status).toBe(401);
  });

  it('puts someone in a huddle in a bound channel into that room, and takes them out when they leave', async () => {
    const hub = app.hubs.get(ORG_ID)!;
    // Slack sends the huddle state first, then the channel's huddle thread
    await event({ type: 'user_huddle_changed', user: { id: 'U1', profile: { huddle_state: 'in_a_huddle', huddle_state_call_id: 'R1' } } });
    await event({ type: 'message', subtype: 'huddle_thread', channel: 'C0DESIGN', ts: '1.0', room: { id: 'R1', participants: ['U1'], has_ended: false } });
    await settle();
    expect(hub.actor(maya().id)).toMatchObject({ sceneId: 'design', via: 'provider' });
    expect(hub.presenceOf(maya().id).voice?.providerChannelId).toBe('C0DESIGN');

    await event({ type: 'user_huddle_changed', user: { id: 'U1', profile: { huddle_state: 'default_unset' } } });
    await settle();
    expect(hub.actor(maya().id)).toBeUndefined();
    expect(hub.presenceOf(maya().id)).toMatchObject({ status: 'offline', voice: undefined });
  });

  it('follows the huddle thread as people join, and ends it for everyone', async () => {
    const hub = app.hubs.get(ORG_ID)!;
    await event({ type: 'message', subtype: 'message_changed', channel: 'C0DESIGN', message: { subtype: 'huddle_thread', room: { id: 'R2', participants: ['U1'] } } });
    await settle();
    expect(hub.actor(maya().id)?.sceneId).toBe('design');
    await event({ type: 'message', subtype: 'message_changed', channel: 'C0DESIGN', message: { subtype: 'huddle_thread', room: { id: 'R2', participants: [], has_ended: true } } });
    await settle();
    expect(hub.actor(maya().id)).toBeUndefined();
  });

  it('shows a Slack status (and Do Not Disturb) for someone who’s around', async () => {
    const hub = app.hubs.get(ORG_ID)!;
    await event({ type: 'message', subtype: 'huddle_thread', channel: 'C0DESIGN', room: { id: 'R3', participants: ['U1'] } });
    await event({ type: 'user_change', user: { id: 'U1', profile: { status_text: 'In a meeting', status_emoji: ':spiral_calendar_pad:', status_expiration: 0 } } });
    await settle();
    expect(hub.presenceOf(maya().id)).toMatchObject({ status: 'meeting', note: 'In a meeting', source: 'provider' });
    await event({ type: 'user_change', user: { id: 'U1', profile: { status_text: '', status_emoji: '' } } });
    await event({ type: 'dnd_updated_user', user: 'U1', dnd_status: { snooze_enabled: true } });
    await settle();
    expect(hub.presenceOf(maya().id).status).toBe('focused');
    await event({ type: 'dnd_updated_user', user: 'U1', dnd_status: { snooze_enabled: false } });
    await settle();
    expect(hub.presenceOf(maya().id)).toMatchObject({ status: 'available', source: 'default' });
  });

  it('answers /minglewood: who’s around, where someone is, a link to join them', async () => {
    const who = await command('U1', '');
    expect(who.response_type).toBe('ephemeral');
    expect(who.text).toContain('Design Loft');
    const where = await command('U9', 'where <@U1|maya>');
    expect(where.text).toMatch(/Maya .* is in .*Design Loft/);
    expect(where.text).toContain(`?to=${maya().id}`);
    expect((await command('U1', 'room café')).text).toContain('?room=cafe');
    expect((await command('U1', 'bogus')).text).toContain('didn’t catch that');
  });

  it('previews links to rooms and people', async () => {
    await event({ type: 'link_shared', channel: 'C0HQ', message_ts: '2.0', links: [{ url: `${config.publicUrl}/?room=design` }, { url: 'https://example.com' }] });
    await settle();
    const call = (await outbox()).outbox.filter((c) => c.method === 'chat.unfurl').pop()!;
    expect(call.args).toMatchObject({ channel: 'C0HQ', ts: '2.0' });
    const unfurls = call.args.unfurls as Record<string, { blocks: Array<{ text?: { text: string } }> }>;
    expect(Object.keys(unfurls)).toEqual([`${config.publicUrl}/?room=design`]);
    expect(unfurls[`${config.publicUrl}/?room=design`].blocks[0].text?.text).toContain('Design Loft');
  });

  it('delivers a knock as a Slack DM to someone who isn’t in the world and opted in', async () => {
    const hub = app.hubs.get(ORG_ID)!;
    await event({ type: 'message', subtype: 'message_changed', channel: 'C0DESIGN', message: { subtype: 'huddle_thread', room: { id: 'R3', participants: [], has_ended: true } } });
    await settle();
    const other = app.store.members(ORG_ID).find((m) => m.id !== maya().id && !m.displayName.startsWith('Maya'))!;
    app.store.updateMember(ORG_ID, maya().id, { settings: { ...maya().settings, slackKnockDms: true } });
    hub.knock(other.id, maya().id, 'coffee');
    await settle();
    const sent = (await outbox()).outbox.slice(-2);
    expect(sent.map((c) => c.method)).toEqual(['conversations.open', 'chat.postMessage']);
    expect(sent[1].args).toMatchObject({ channel: 'DU1' });
    expect(String(sent[1].args.text)).toContain('coffee');
  });

  it('signs in a Slack person of the connected workspace as a member (mock sign-in)', async () => {
    const res = await fetch(`${base}/api/slack/dev/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'U42', teamId: TEAM, name: 'Ari' }) });
    const body = (await res.json()) as { memberId: string };
    expect(app.store.identity(ORG_ID, 'slack', 'U42')?.memberId).toBe(body.memberId);
    const other = await fetch(`${base}/api/slack/dev/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'U43', teamId: 'TOTHER', name: 'Bo' }) });
    expect(other.status).toBe(404);
  });

  it('mirrors what’s posted in the channel into the space, and what’s said in the space into the channel — as the speaker', async () => {
    const hub = app.hubs.get(ORG_ID)!;
    // #design is the Design Loft's conversation too (not only its huddle)
    app.store.setBinding(ORG_ID, { id: 'b1t', orgId: ORG_ID, roomId: 'design', provider: 'slack', kind: 'text', externalGuildId: TEAM, externalChannelId: 'C0DESIGN', label: '#design' }, 'design');
    hub.bindingsChanged();
    const ari = app.store.identity(ORG_ID, 'slack', 'U42')!.memberId;
    const msgs: ServerMsg[] = [];
    const c = { id: 'c-ari', memberId: ari, sceneId: null as string | null, send: (m: ServerMsg) => msgs.push(m) };
    hub.connect(c);
    hub.enter(ari, 'design', 'live');
    await settle();
    await event({ type: 'message', channel: 'C0DESIGN', user: 'U1', text: 'hi <@U42>, see <#C0DESIGN|design>', ts: '1700000000.000100' });
    await settle();
    expect(hub.chatLog('design').at(-1)).toMatchObject({ memberId: maya().id, text: 'hi @Ari, see #design', source: 'slack', at: '2023-11-14T22:13:20.000Z' });
    expect(msgs.some((m) => m.t === 'chat' && m.entry.text === 'hi @Ari, see #design')).toBe(true);
    hub.say(ari, 'hey Maya 👋');
    await settle();
    const post = (await outbox()).outbox.filter((x) => x.method === 'chat.postMessage').pop()!;
    expect(post.args).toMatchObject({ channel: 'C0DESIGN', text: 'hey Maya 👋', username: 'Ari', link_names: false });
    // the echo Slack sends back for our own post is not shown a second time
    const before = hub.chatLog('design').length;
    await event({ type: 'message', channel: 'C0DESIGN', user: 'U0MOCKBOT', bot_id: 'B0MOCK', username: 'Ari', text: 'hey Maya 👋', ts: '1700000000.000200' });
    await settle();
    expect(hub.chatLog('design')).toHaveLength(before);
    hub.disconnect(c);
  });

  it('follows Slack when a linked channel is renamed or archived', async () => {
    await event({ type: 'channel_rename', channel: { id: 'C0DESIGN', name: 'design-crew' } });
    await settle();
    expect(app.store.bindingFor(ORG_ID, 'design', 'text')?.label).toBe('#design-crew');
    expect(app.store.bindingFor(ORG_ID, 'design', 'voice')?.label).toBe('🎧 #design-crew');
    await event({ type: 'channel_archive', channel: 'C0DESIGN', user: 'U1' });
    await settle();
    expect(app.store.bindingFor(ORG_ID, 'design', 'text')).toBeUndefined();
    expect(app.store.bindingFor(ORG_ID, 'design', 'voice')).toBeUndefined();
  });

  it('admin: one click links a channel to every space (joining the ones the app is not in), and the readiness check agrees', async () => {
    const signin = await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ops', teamId: 'team-aurora', admin: true }) });
    const cookie = signin.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const setup = (await fetch(`${base}/api/slack/admin/setup`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ create: true }) }).then((r) => r.json())) as {
      plan: Array<{ spaceId: string; action: string; channelName: string; joined?: boolean }>;
      failed: unknown[];
    };
    expect(setup.failed).toEqual([]);
    expect(setup.plan.find((p) => p.spaceId === 'town')).toMatchObject({ action: 'matched', channelName: 'general' });
    expect(setup.plan.find((p) => p.spaceId === 'eng')).toMatchObject({ action: 'matched', channelName: 'eng', joined: true });
    expect(setup.plan.find((p) => p.spaceId === 'design')?.action).toBe('matched'); // the channel archived above is gone; nothing else is called design… except #design itself in the mock list
    expect(app.store.bindingFor(ORG_ID, 'town', 'text')).toMatchObject({ provider: 'slack', externalChannelId: 'C0HQ', label: '#general' });
    expect(app.store.bindingFor(ORG_ID, 'town', 'voice')).toMatchObject({ externalChannelId: 'C0HQ', label: '🎧 #general' });
    expect(app.store.bindingFor(ORG_ID, 'focus', 'text')).toBeUndefined();
    const ready = (await fetch(`${base}/api/slack/admin/readiness`, { headers: { cookie } }).then((r) => r.json())) as { connected: boolean; scopesKnown: boolean; scopes: Array<{ ok: boolean | null }>; channels: Array<{ inChannel: boolean | null }> };
    expect(ready.connected).toBe(true);
    expect(ready.scopesKnown).toBe(true);
    expect(ready.scopes.every((s) => s.ok)).toBe(true);
    expect(ready.channels.length).toBeGreaterThan(3);
    expect(ready.channels.every((c) => c.inChannel)).toBe(true);
  });

  it('Add to Slack from the landing page connects the server’s workspace and signs the installer in as an admin', async () => {
    const start = await fetch(`${base}/api/slack/add`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(to.searchParams.get('scope')).toContain('chat:write.customize');
    const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const cb = await fetch(`${base}/api/slack/install/callback?code=abc&state=${to.searchParams.get('state')}`, { headers: { cookie }, redirect: 'manual' });
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/');
    expect(app.ctx.slack.connection(ORG_ID)).toMatchObject({ externalWorkspaceId: TEAM, displayName: 'Mock workspace', status: 'active' });
    // the token is kept server-side with the company (never in anything a client sees), and the installer is an admin
    expect(app.store.secret(ORG_ID, 'slackBotToken')).toBe('xoxb-mock-installed');
    expect(app.ctx.slack.provider.tokens.forTeam(TEAM)).toBe('xoxb-mock-installed');
    const installer = app.store.identity(ORG_ID, 'slack', 'U0INSTALLER')!;
    expect(app.store.member(ORG_ID, installer.memberId)?.role).toBe('admin');
    expect(cb.headers.getSetCookie().some((c) => c.includes('_session='))).toBe(true);
    // a wrong state is refused
    const bad = await fetch(`${base}/api/slack/install/callback?code=abc&state=nope`, { headers: { cookie }, redirect: 'manual' });
    expect(bad.headers.get('location')).toBe('/?error=oauth_state');
  });
});

describe('Slack bridge during boot', () => {
  it('tolerates simulated coworkers chatting before the Slack service exists (no workspace yet → nothing to post)', async () => {
    // Render crashed on 2026-10-02: LifeSim said something while createApp was still awaiting tenants, and the
    // bridge touched the not-yet-assigned service. The app must boot with the sim on and a say must not throw.
    const app = await createApp({ persistence: new MemoryPersistence(), simulateCoworkers: true });
    try {
      const hub = app.hubs.get(ORG_ID)!;
      const sim = app.store.members(ORG_ID).find((m) => m.simulated)!;
      hub.enter(sim.id, 'cafe', 'sim');
      expect(() => hub.say(sim.id, 'morning!')).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(app.ctx.slack).toBeDefined();
    } finally {
      await app.close();
    }
  });
});

// keep the mock's defaults honest: every method it's asked for in the flows above answers ok
describe('MockSlack', () => {
  it('answers the Web API calls Minglewood makes', async () => {
    const m = new MockSlack();
    for (const method of ['users.info', 'team.info', 'conversations.list', 'conversations.open', 'chat.postMessage', 'chat.unfurl'])
      expect((await m.transport({ method, args: { user: 'U1', users: 'U1' } })).ok).toBe(true);
    expect(m.outbox).toHaveLength(6);
  });
});
