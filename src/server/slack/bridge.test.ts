import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID } from '@shared/seed/northstar';
import { DEFAULT_LOADOUT } from '@shared/avatar';
import { TOWN_ID } from '@shared/world';
import type { ServerMsg } from '@shared/protocol';
import type { RoomBinding } from '@shared/domain/types';
import { Store } from '../store/store';
import { MemoryPersistence } from '../store/jsonFile';
import { OrgHub, type HubClient } from '../realtime/orgHub';
import { SlackApiError, type SlackChannel, type SlackMessage } from './api';
import { SlackBridge } from './bridge';
import { SlackPresence } from './presence';
import { isConversation, renderSlackText, slackMessageId, slackTime } from './render';
import { SLACK_BOT_SCOPES } from './scopes';
import { planSlackSetup, readiness, runSlackSetup, slackLabel } from './setup';
import { SlackTokens } from './tokens';

const TEAM = 'T1';

function fakeApi() {
  const api = {
    posted: [] as Array<{ channel: string; text: string; username?: string; iconUrl?: string }>,
    joined: [] as string[],
    customize: true,
    history: new Map<string, SlackMessage[]>(),
    channels: [
      { id: 'CGENERAL', name: 'general', is_member: true },
      { id: 'CCAFE', name: 'cafe', is_member: true },
      { id: 'CENG', name: 'eng', is_member: false },
      { id: 'GSECRET', name: 'leadership', is_member: false, is_private: true },
    ] as SlackChannel[],
    scopes: [...SLACK_BOT_SCOPES],
    postMessage: vi.fn(async (_t: string, channel: string, text: string, _b?: unknown[], as?: { username: string; iconUrl?: string }) => {
      if (as && !api.customize) throw new SlackApiError('chat.postMessage', 'missing_scope');
      const c = api.channels.find((x) => x.id === channel);
      if (c && !c.is_member) throw new SlackApiError('chat.postMessage', 'not_in_channel');
      api.posted.push({ channel, text, username: as?.username, iconUrl: as?.iconUrl });
      return { ts: `1700000000.${String(api.posted.length).padStart(6, '0')}`, channel };
    }),
    usersInfo: vi.fn(async (_t: string, user: string) =>
      user === 'UJAY'
        ? { id: user, real_name: 'Jay Tester', profile: { display_name: 'jay ☕', image_72: 'https://img/jay72.png', image_192: 'https://img/jay192.png' } }
        : user === 'USAM'
          ? { id: user, real_name: 'Sam Rivera', profile: { display_name: '', image_72: 'https://img/sam.png' } }
          : Promise.reject(new SlackApiError('users.info', 'user_not_found')),
    ),
    conversationsHistory: vi.fn(async (_t: string, channel: string) => {
      const c = api.channels.find((x) => x.id === channel);
      if (c && !c.is_member) throw new SlackApiError('conversations.history', 'not_in_channel');
      return [...(api.history.get(channel) ?? [])].reverse(); // Slack returns newest first
    }),
    conversationsInfo: vi.fn(async (_t: string, channel: string) => {
      const c = api.channels.find((x) => x.id === channel);
      if (!c) throw new SlackApiError('conversations.info', 'channel_not_found');
      return c;
    }),
    conversationsJoin: vi.fn(async (_t: string, channel: string) => {
      const c = api.channels.find((x) => x.id === channel)!;
      c.is_member = true;
      api.joined.push(channel);
      return c;
    }),
    conversations: vi.fn(async () => api.channels),
    conversationsCreate: vi.fn(async (_t: string, name: string) => {
      const made = { id: `CNEW${name}`, name, is_member: true };
      api.channels.push(made);
      return made;
    }),
    invited: [] as Array<{ channel: string; users: string[] }>,
    conversationsInvite: vi.fn(async (_t: string, channel: string, users: string[]) => {
      api.invited.push({ channel, users });
      return api.channels.find((c) => c.id === channel)!;
    }),
    authTest: vi.fn(async () => ({ user_id: 'UBOT', bot_id: 'BBOT', team_id: TEAM, team: 'Northstar', scopes: api.scopes })),
  };
  return api;
}
let api: ReturnType<typeof fakeApi>;

const msg = (p: Partial<SlackMessage> & { ts: string }): SlackMessage & { channel: string } => ({ type: 'message', user: 'USAM', text: '', channel: 'CCAFE', ...p });

function client(memberId: string) {
  const msgs: ServerMsg[] = [];
  const c: HubClient & { msgs: ServerMsg[] } = { id: `c-${memberId}`, memberId, sceneId: null, msgs, send: (m) => msgs.push(m) };
  return c;
}

const bind = (roomId: string, kind: RoomBinding['kind'], ch: string, label: string): RoomBinding => ({
  id: `${roomId}-${kind}`,
  orgId: ORG_ID,
  roomId,
  provider: 'slack',
  kind,
  externalGuildId: TEAM,
  externalChannelId: ch,
  label,
});

describe('Slack bridge: spaces are their channels', () => {
  let store: Store;
  let hub: OrgHub;
  let bridge: SlackBridge;
  let memberId: string;
  const flush = async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };

  beforeEach(async () => {
    api = fakeApi();
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
    bridge = new SlackBridge({ store, api, tokens: new SlackTokens(() => 'xoxb-test'), hubFor: () => hub, teamFor: () => TEAM });
    bridge.attach(hub);
    const m = store.createMember(ORG_ID, {
      displayName: 'Jay Tester',
      title: 'Tester',
      departmentId: 'dep-eng',
      teamId: 'team-platform',
      location: 'Remote',
      timezone: 'UTC',
      startDate: '2026-01-01',
      askMeAbout: [],
      interests: [],
      role: 'member',
      avatar: DEFAULT_LOADOUT,
      unlockedItems: [],
      settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
    });
    memberId = m.id;
    store.linkIdentity(ORG_ID, { provider: 'slack', externalId: 'UJAY', memberId, avatarUrl: 'https://img/signin.png', linkedAt: new Date().toISOString() });
    store.setConnection(ORG_ID, { id: 'conn', orgId: ORG_ID, provider: 'slack', externalWorkspaceId: TEAM, displayName: 'Northstar', connectedAt: '', connectedBy: '', status: 'active' });
    store.setBinding(ORG_ID, bind('cafe', 'text', 'CCAFE', '#cafe'), 'cafe');
    store.setBinding(ORG_ID, bind('cafe', 'voice', 'CCAFE', '🎧 #cafe'), 'cafe');
    store.setBinding(ORG_ID, bind(TOWN_ID, 'text', 'CGENERAL', '#general'), TOWN_ID);
    store.setBinding(ORG_ID, bind(TOWN_ID, 'voice', 'CGENERAL', '🎧 #general'), TOWN_ID);
    store.setBinding(ORG_ID, bind('eng', 'text', 'CENG', '#eng'), 'eng');
  });
  afterEach(() => hub.dispose());

  it('posts what you say in a space to its channel, as you (your Slack name and picture)', async () => {
    hub.connect(client(memberId));
    hub.enter(memberId, 'cafe', 'live');
    hub.say(memberId, 'anyone want a flat white?');
    await flush();
    expect(api.posted).toEqual([{ channel: 'CCAFE', text: 'anyone want a flat white?', username: 'jay ☕', iconUrl: 'https://img/jay192.png' }]);
    // the local line now carries Slack's id, so the echo and history won't show it twice
    expect(hub.chatLog('cafe').at(-1)?.id).toBe(slackMessageId('CCAFE', '1700000000.000001'));
  });

  it('falls back to posting as the app when chat:write.customize is missing', async () => {
    api.customize = false;
    hub.connect(client(memberId));
    hub.enter(memberId, 'cafe', 'live');
    hub.say(memberId, 'hello');
    await flush();
    expect(api.posted).toEqual([{ channel: 'CCAFE', text: '*jay ☕*: hello', username: undefined, iconUrl: undefined }]);
    hub.say(memberId, 'again');
    await flush();
    expect(api.postMessage).toHaveBeenCalledTimes(3); // one failed try with a name, then as the app; the second post goes straight to the app form
  });

  it('joins a public channel it is not in yet, then posts', async () => {
    hub.connect(client(memberId));
    hub.enter(memberId, 'eng', 'live');
    hub.say(memberId, 'shipping');
    await flush();
    expect(api.joined).toEqual(['CENG']);
    expect(api.posted.at(-1)).toMatchObject({ channel: 'CENG', text: 'shipping' });
  });

  it('shows channel messages in the space, with mentions by name, and as a bubble over the author when they are there', async () => {
    const c = client(memberId);
    hub.connect(c);
    hub.enter(memberId, 'cafe', 'live');
    await flush();
    c.msgs.length = 0;
    await bridge.onMessage(ORG_ID, msg({ ts: '1.1', channel: 'CCAFE', user: 'UJAY', text: 'typing from Slack' }));
    await bridge.onMessage(ORG_ID, msg({ ts: '1.2', channel: 'CCAFE', user: 'USAM', text: 'hi <@UJAY>! see <#CCAFE|cafe> &amp; <https://x.dev|the plan>', files: [{ name: 'plan.pdf' }] }));
    const chat = c.msgs.filter((m) => m.t === 'chat').map((m) => (m.t === 'chat' ? m.entry : null));
    expect(chat.map((e) => [e?.name, e?.text, e?.memberId, e?.source])).toEqual([
      ['Jay Tester', 'typing from Slack', memberId, 'slack'],
      ['Sam Rivera', 'hi @Jay Tester! see #cafe & the plan 📎 plan.pdf', undefined, 'slack'],
    ]);
    expect(chat[1]?.avatarUrl).toBe('https://img/sam.png');
    expect(c.msgs.some((m) => m.t === 'said' && m.memberId === memberId && m.text === 'typing from Slack')).toBe(true);
  });

  it('ignores its own echoes (by bot id, and by the post still in flight) and non-conversation subtypes', async () => {
    hub.connect(client(memberId));
    hub.enter(memberId, 'cafe', 'live');
    hub.say(memberId, 'hello');
    await flush();
    const before = hub.chatLog('cafe').length;
    await bridge.onMessage(ORG_ID, msg({ ts: '9.1', channel: 'CCAFE', user: 'UBOT', bot_id: 'BBOT', username: 'jay ☕', text: 'hello' }));
    await bridge.onMessage(ORG_ID, msg({ ts: '9.2', channel: 'CCAFE', user: 'USAM', subtype: 'channel_join', text: 'Sam joined' }));
    await bridge.onMessage(ORG_ID, msg({ ts: '9.3', channel: 'CCAFE', user: 'USAM', subtype: 'huddle_thread', text: '' }));
    await bridge.onMessage(ORG_ID, msg({ ts: '9.4', channel: 'CCAFE', user: 'USAM', text: 'in a thread', thread_ts: '1.0' }));
    expect(hub.chatLog('cafe')).toHaveLength(before);
    // another app's post is a real line
    await bridge.onMessage(ORG_ID, msg({ ts: '9.5', channel: 'CCAFE', user: undefined, bot_id: 'BOTHER', subtype: 'bot_message', username: 'Deploybot', text: 'deployed v2' }));
    expect(hub.chatLog('cafe').at(-1)).toMatchObject({ name: 'Deploybot', text: 'deployed v2' });
  });

  it('loads the channel history when you walk in (oldest first, people’s lines only)', async () => {
    api.history.set('CGENERAL', [
      msg({ ts: '1700000100.1', user: 'USAM', text: 'good morning' }),
      msg({ ts: '1700000101.1', user: 'USAM', subtype: 'channel_join', text: 'Sam has joined' }),
      msg({ ts: '1700000102.1', user: 'UJAY', text: 'morning!' }),
      msg({ ts: '1700000103.1', user: 'UBOT', bot_id: 'BBOT', text: '3 people are around in Minglewood.' }), // the daily note
      msg({ ts: '1700000104.1', user: 'UBOT', bot_id: 'BBOT', username: 'jay ☕', text: 'said in the world' }), // posted for Jay
    ]);
    const c = client(memberId);
    hub.connect(c);
    hub.enter(memberId, TOWN_ID, 'live');
    await flush();
    const hist = c.msgs.filter((m) => m.t === 'chat-history').at(-1);
    expect(hist?.t === 'chat-history' && hist.entries.map((e) => [e.name, e.text])).toEqual([
      ['Sam Rivera', 'good morning'],
      ['Jay Tester', 'morning!'],
      ['jay ☕', 'said in the world'],
    ]);
    expect(hist?.t === 'chat-history' && hist.channel).toEqual({ name: '#general', provider: 'slack' });
    expect(hist?.t === 'chat-history' && hist.entries[0].at).toBe(slackTime('1700000100.1'));
  });

  it('joins a public channel to load its history, and leaves private ones to an /invite', async () => {
    hub.connect(client(memberId));
    hub.enter(memberId, 'eng', 'live');
    await flush();
    expect(api.joined).toEqual(['CENG']);
    expect(await bridge.ensureInChannel(ORG_ID, 'GSECRET')).toBe('private');
    expect(await bridge.ensureInChannel(ORG_ID, 'CGENERAL')).toBe('member');
  });

  it('follows Slack when a linked channel is renamed, archived or deleted', () => {
    bridge.onChannel(ORG_ID, { id: 'CCAFE', name: 'coffee-talk', gone: false });
    expect(store.bindingFor(ORG_ID, 'cafe', 'text')?.label).toBe('#coffee-talk');
    expect(store.bindingFor(ORG_ID, 'cafe', 'voice')?.label).toBe('🎧 #coffee-talk');
    bridge.onChannel(ORG_ID, { id: 'CCAFE', gone: true });
    expect(store.bindingFor(ORG_ID, 'cafe', 'text')).toBeUndefined();
    expect(store.bindingFor(ORG_ID, 'cafe', 'voice')).toBeUndefined();
    expect(store.bindingFor(ORG_ID, TOWN_ID, 'text')).toBeDefined();
  });

  it('walks your avatar into the space whose huddle you joined in Slack (unless you turned that off)', () => {
    const presence = new SlackPresence(hub, store);
    hub.connect(client(memberId));
    hub.enter(memberId, TOWN_ID, 'live');
    presence.userHuddle('UJAY', 'in_a_huddle', 'R1');
    presence.huddleRoom('CCAFE', { id: 'R1', participants: ['UJAY'] });
    expect(hub.actor(memberId)?.sceneId).toBe('cafe');
    expect(hub.actor(memberId)?.via).toBe('live');
    expect(hub.presenceOf(memberId).voice?.providerChannelId).toBe('CCAFE');
    // off: the badge shows, the avatar stays
    store.updateMember(ORG_ID, memberId, { settings: { locationVisibility: 'everyone', knocksWhileFocused: false, voiceFollow: false } });
    hub.enter(memberId, TOWN_ID, 'live');
    presence.huddleRoom('CCAFE', { id: 'R2', participants: ['UJAY'] });
    expect(hub.actor(memberId)?.sceneId).toBe(TOWN_ID);
  });
});

describe('Silent disco: every huddle carries a call id', () => {
  let store: Store;
  let hub: OrgHub;
  let memberId: string;
  beforeEach(async () => {
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
    const m = store.createMember(ORG_ID, {
      displayName: 'Jay Tester', title: 'Tester', departmentId: 'dep-eng', teamId: 'team-platform', location: 'Remote', timezone: 'UTC',
      startDate: '2026-01-01', askMeAbout: [], interests: [], role: 'member', avatar: DEFAULT_LOADOUT, unlockedItems: [],
      settings: { locationVisibility: 'everyone', knocksWhileFocused: false },
    });
    memberId = m.id;
    store.linkIdentity(ORG_ID, { provider: 'slack', externalId: 'UJAY', memberId, linkedAt: new Date().toISOString() });
    store.setBinding(ORG_ID, bind('cafe', 'voice', 'CCAFE', '🎧 #cafe'), 'cafe');
  });
  afterEach(() => hub.dispose());

  it('shows a DM huddle as a badge with its call id, without placing anyone anywhere', () => {
    const presence = new SlackPresence(hub, store);
    hub.connect(client(memberId));
    hub.enter(memberId, 'cafe', 'live');
    presence.userHuddle('UJAY', 'in_a_huddle', 'RDM1'); // no huddle_thread ever: a DM huddle
    expect(hub.presenceOf(memberId).voice).toEqual({ providerChannelId: '', callId: 'RDM1', muted: false, video: false });
    expect(hub.actor(memberId)?.sceneId).toBe('cafe'); // still where they were
    presence.userHuddle('UJAY', 'default_unset', undefined);
    expect(hub.presenceOf(memberId).voice).toBeUndefined();
  });

  it('keeps someone who is only on a DM huddle online in the directory, and offline once it ends', () => {
    const presence = new SlackPresence(hub, store);
    presence.userHuddle('UJAY', 'in_a_huddle', 'RDM2');
    expect(hub.presenceOf(memberId).voice?.callId).toBe('RDM2');
    expect(hub.actor(memberId)).toBeUndefined();
    presence.userHuddle('UJAY', 'default_unset', undefined);
    expect(hub.presenceOf(memberId).status).toBe('offline');
  });

  it('a channel huddle carries the call id too, so people on it match', () => {
    const presence = new SlackPresence(hub, store);
    presence.userHuddle('UJAY', 'in_a_huddle', 'RCH1');
    presence.huddleRoom('CCAFE', { id: 'RCH1', participants: ['UJAY'] });
    expect(hub.presenceOf(memberId).voice).toMatchObject({ providerChannelId: 'CCAFE', callId: 'RCH1' });
    expect(hub.actor(memberId)?.sceneId).toBe('cafe');
  });
});

describe('Slack join links', () => {
  it('goes straight into a running huddle, and to the channel otherwise', async () => {
    const { SlackProvider } = await import('./provider');
    const { SlackApi } = await import('./api');
    const p = new SlackProvider(new SlackApi(async () => ({ ok: true })), new SlackTokens(() => ''));
    const huddle = p.joinInstruction({ id: 'b', orgId: ORG_ID, roomId: 'cafe', provider: 'slack', kind: 'voice', externalGuildId: 'T1', externalChannelId: 'C1', label: '🎧 #cafe' });
    expect(huddle).toMatchObject({ webUrl: 'https://slack.com/app_redirect?team=T1&channel=C1', liveWebUrl: 'https://app.slack.com/huddle/T1/C1', appUrl: 'slack://channel?team=T1&id=C1' });
    const text = p.joinInstruction({ id: 'b', orgId: ORG_ID, roomId: 'cafe', provider: 'slack', kind: 'text', externalGuildId: 'T1', externalChannelId: 'C1', label: '#cafe' });
    expect(text.liveWebUrl).toBeUndefined();
    expect(text.label).toBe('Open #cafe in Slack');
  });
});

describe('Slack message rendering', () => {
  it('turns mrkdwn escapes into words and never pings anyone', () => {
    const nameOf = (id: string) => ({ U1: 'Kim' })[id];
    expect(renderSlackText({ text: 'hey <@U1> and <@U2> <!here> <!subteam^S1|@design> <#C1|cafe> <#C2> <https://a.b/x|plan> <https://a.b/y> 2 &gt; 1 &amp; ok' }, nameOf)).toBe(
      'hey @Kim and @someone @here @design #cafe #channel plan https://a.b/y 2 > 1 & ok',
    );
    expect(renderSlackText({ text: '', files: [{ title: 'Sketch' }, { name: 'a.png' }] }, () => undefined)).toBe('📎 Sketch 📎 a.png');
  });
  it('knows which messages are the conversation', () => {
    expect(isConversation({ ts: '1', subtype: undefined })).toBe(true);
    expect(isConversation({ ts: '1', subtype: 'file_share' })).toBe(true);
    expect(isConversation({ ts: '2', thread_ts: '2' })).toBe(true); // a thread parent
    expect(isConversation({ ts: '3', thread_ts: '2' })).toBe(false); // a reply inside a thread
    expect(isConversation({ ts: '3', thread_ts: '2', subtype: 'thread_broadcast' })).toBe(true);
    expect(isConversation({ ts: '4', subtype: 'channel_join' })).toBe(false);
    expect(isConversation({ ts: '5', subtype: 'huddle_thread' })).toBe(false);
  });
  it('reads Slack timestamps', () => {
    expect(slackTime('1700000000.123456')).toBe('2023-11-14T22:13:20.123Z');
  });
});

describe('Slack channel setup for every space', () => {
  const rooms = [
    { id: 'cafe', name: 'Tidewater Café' },
    { id: 'eng', name: 'Engineering Studio' },
    { id: 'focus', name: 'The Quiet Grove', quiet: true },
  ];
  const spaces = [{ id: TOWN_ID, name: 'Town' }, ...rooms.filter((r) => !r.quiet)];

  it('plans one channel per space: #general for the town, matches by name, creates the rest', () => {
    const channels: SlackChannel[] = [
      { id: '1', name: 'general', is_member: true },
      { id: '2', name: 'cafe', is_member: false },
      { id: '3', name: 'random', is_member: true },
      { id: '4', name: 'engineering', is_member: true, is_archived: true },
    ];
    const plan = planSlackSetup(spaces, channels, [], true);
    expect(plan.map((p) => [p.spaceId, p.action, p.channelName, p.inChannel])).toEqual([
      [TOWN_ID, 'matched', 'general', true],
      ['cafe', 'matched', 'cafe', false],
      ['eng', 'create', 'engineering-studio', undefined],
    ]);
    // newer workspaces call the default channel #all-<workspace>: Slack's is_general flag wins for the town
    expect(planSlackSetup(spaces, [{ id: '9', name: 'all-acme', is_general: true }, ...channels.slice(1)], [], false)[0]).toMatchObject({ action: 'matched', channelId: '9' });
    // without creating, a space with no match is skipped; the town is never "created" (Slack always has #general)
    expect(planSlackSetup(spaces, channels.slice(1), [], false).map((p) => p.action)).toEqual(['skip', 'matched', 'skip']);
    expect(planSlackSetup(spaces, channels.slice(1), [], true)[0].action).toBe('skip');
  });

  it('creates what is missing, joins what it is not in, and binds every space as text + huddle', async () => {
    const store = new Store(new MemoryPersistence());
    await store.init();
    const fake = fakeApi();
    store.linkIdentity(ORG_ID, { provider: 'slack', externalId: 'UJAY', memberId: 'm1', linkedAt: '' });
    store.linkIdentity(ORG_ID, { provider: 'slack', externalId: 'USAM', memberId: 'm2', linkedAt: '' });
    const { plan, failed } = await runSlackSetup({ store, orgId: ORG_ID, teamId: TEAM, token: 't', create: true, api: fake });
    expect(failed).toEqual([]);
    expect(fake.conversationsCreate).toHaveBeenCalled();
    // everyone who signed in with Slack is put into the channels it created (a new channel holds only the app)
    expect(fake.invited.length).toBe(fake.conversationsCreate.mock.calls.length);
    expect(fake.invited[0].users).toEqual(['UJAY', 'USAM']);
    expect(fake.joined).toEqual(['CENG']);
    expect(store.bindingFor(ORG_ID, TOWN_ID, 'text')).toMatchObject({ externalChannelId: 'CGENERAL', label: '#general' });
    expect(store.bindingFor(ORG_ID, TOWN_ID, 'voice')).toMatchObject({ externalChannelId: 'CGENERAL', label: '🎧 #general' });
    expect(store.bindingFor(ORG_ID, 'eng', 'text')).toMatchObject({ externalChannelId: 'CENG' });
    expect(store.bindingFor(ORG_ID, 'focus', 'voice')).toBeUndefined(); // quiet room: no channel
    expect(plan.find((p) => p.spaceId === 'eng')?.joined).toBe(true);
    // a second run keeps everything
    const again = await runSlackSetup({ store, orgId: ORG_ID, teamId: TEAM, token: 't', create: true, api: fake });
    expect(again.plan.every((p) => p.action === 'kept')).toBe(true);
  });

  it('labels channels the way the admin console does', () => {
    expect(slackLabel('text', 'cafe')).toBe('#cafe');
    expect(slackLabel('voice', '#cafe')).toBe('🎧 #cafe');
    expect(slackLabel('voice', '🎧 #cafe')).toBe('🎧 #cafe');
  });

  it('reports missing scopes and channels the app is not in', async () => {
    const store = new Store(new MemoryPersistence());
    await store.init();
    const fake = fakeApi();
    fake.scopes = fake.scopes.filter((s) => s !== 'chat:write.customize' && s !== 'channels:join');
    store.setBinding(ORG_ID, { id: 'b1', orgId: ORG_ID, roomId: 'eng', provider: 'slack', kind: 'text', externalGuildId: TEAM, externalChannelId: 'CENG', label: '#eng' }, 'eng');
    store.setBinding(ORG_ID, { id: 'b2', orgId: ORG_ID, roomId: 'eng', provider: 'slack', kind: 'voice', externalGuildId: TEAM, externalChannelId: 'CENG', label: '🎧 #eng' }, 'eng');
    store.setBinding(ORG_ID, { id: 'b3', orgId: ORG_ID, roomId: 'launch', provider: 'slack', kind: 'voice', externalGuildId: TEAM, externalChannelId: 'GSECRET', label: '🎧 #leadership' }, 'launch');
    const r = await readiness({ store, orgId: ORG_ID, teamId: TEAM, token: 't', api: fake });
    expect(r.scopesKnown).toBe(true);
    expect(r.scopes.filter((s) => !s.ok).map((s) => s.scope)).toEqual(['chat:write.customize', 'channels:join']);
    expect(r.channels).toEqual([
      { spaceId: 'eng', spaceName: expect.any(String), channelId: 'CENG', channelName: 'eng', slots: ['text', 'voice'], inChannel: false, isPrivate: false },
      { spaceId: 'launch', spaceName: expect.any(String), channelId: 'GSECRET', channelName: 'leadership', slots: ['voice'], inChannel: false, isPrivate: true },
    ]);
    fake.scopes = [];
    expect((await readiness({ store, orgId: ORG_ID, teamId: TEAM, token: 't', api: fake })).scopes.every((s) => s.ok === null)).toBe(true);
  });
});
