import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID } from '@shared/seed/northstar';
import { DEFAULT_LOADOUT } from '@shared/avatar';
import { TOWN_ID } from '@shared/world';
import type { ServerMsg } from '@shared/protocol';
import type { RoomBinding } from '@shared/domain/types';
import { Store } from '../../store/store';
import { MemoryPersistence } from '../../store/jsonFile';
import { OrgHub, type HubClient } from '../../realtime/orgHub';
import { DiscordBridge, renderContent, webhookName } from './bridge';
import { labelFor, namesFor, planSetup, runSetup, spacesOf, effectivePermissions } from './setup';
import { ChannelType, type DiscordMessage } from './api';

const G = 'G1';

function fakeApi() {
  return {
    posted: [] as Array<{ channel?: string; hook?: string; content: string; username?: string }>,
    moves: [] as Array<{ user: string; channel: string | null }>,
    afk: null as string | null,
    guildMember: vi.fn(async (_t: string, _g: string, user: string) => ({
      roles: [],
      nick: user === 'u-jay' ? 'Jay (café crew)' : null,
      avatar: user === 'u-jay' ? 'guildpic' : null,
      user: { id: user, username: 'jay', global_name: 'Jay', avatar: 'userpic' },
    })),
    guild: vi.fn(async (_t: string, g: string) => ({ id: g, name: 'Test', owner_id: 'owner', afk_channel_id: api.afk })),
    history: new Map<string, DiscordMessage[]>(),
    channelMessages: vi.fn(async function (this: unknown, _t: string, ch: string) {
      return [...(api.history.get(ch) ?? [])].reverse(); // Discord returns newest first
    }),
    channelWebhooks: vi.fn(async () => []),
    createWebhook: vi.fn(async (_t: string, ch: string) => ({ id: `hook-${ch}`, token: 'secret', application_id: 'APP' })),
    executeWebhook: vi.fn(async (hook: { id: string }, body: { content: string; username: string }) => {
      api.posted.push({ hook: hook.id, content: body.content, username: body.username });
      return msg({ id: `m${api.posted.length}`, content: body.content, webhook_id: hook.id });
    }),
    sendMessage: vi.fn(async (_t: string, channel: string, content: string) => {
      api.posted.push({ channel, content });
      return msg({ id: `m${api.posted.length}`, content });
    }),
    moveMember: vi.fn(async (_t: string, _g: string, user: string, channel: string | null) => {
      api.moves.push({ user, channel });
    }),
  };
}
let api: ReturnType<typeof fakeApi>;

function msg(p: Partial<DiscordMessage> & { id: string }): DiscordMessage {
  return { channel_id: 'T-cafe', content: '', timestamp: new Date().toISOString(), author: { id: 'u-someone', username: 'someone' }, ...p };
}

function client(memberId: string) {
  const msgs: ServerMsg[] = [];
  const c: HubClient & { msgs: ServerMsg[] } = { id: `c-${memberId}`, memberId, sceneId: null, msgs, send: (m) => msgs.push(m) };
  return c;
}

const bind = (roomId: string, kind: RoomBinding['kind'], ch: string, label: string): RoomBinding => ({
  id: `${roomId}-${kind}`,
  orgId: ORG_ID,
  roomId,
  provider: 'discord',
  kind,
  externalGuildId: G,
  externalChannelId: ch,
  label,
});

describe('Discord bridge: spaces are their channels', () => {
  let store: Store;
  let hub: OrgHub;
  let bridge: DiscordBridge;
  let memberId: string;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(async () => {
    api = fakeApi();
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
    bridge = new DiscordBridge({ store, token: () => 'bot', applicationId: () => 'APP', hubFor: () => hub, orgForGuild: async () => ORG_ID, api });
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
    store.linkIdentity(ORG_ID, { provider: 'discord', externalId: 'u-jay', memberId, avatarUrl: 'https://cdn/jay.png', linkedAt: new Date().toISOString() });
    store.setConnection(ORG_ID, { id: 'conn', orgId: ORG_ID, provider: 'discord', externalWorkspaceId: G, displayName: 'Test', connectedAt: '', connectedBy: '', status: 'active' });
    store.setBinding(ORG_ID, bind('cafe', 'text', 'T-cafe', '#cafe'), 'cafe');
    store.setBinding(ORG_ID, bind('cafe', 'voice', 'V-cafe', '🔊 Café'), 'cafe');
    store.setBinding(ORG_ID, bind(TOWN_ID, 'text', 'T-general', '#general'), TOWN_ID);
    store.setBinding(ORG_ID, bind(TOWN_ID, 'voice', 'V-general', '🔊 General'), TOWN_ID);
  });
  afterEach(() => hub.dispose());

  it('keeps one voice and one text channel per space', () => {
    expect(store.get(ORG_ID).bindings.filter((b) => b.roomId === 'cafe')).toHaveLength(2);
    store.setBinding(ORG_ID, bind('cafe', 'text', 'T-other', '#other'), 'cafe');
    expect(store.bindingFor(ORG_ID, 'cafe', 'text')?.externalChannelId).toBe('T-other');
    expect(store.bindingFor(ORG_ID, 'cafe', 'voice')?.externalChannelId).toBe('V-cafe');
    store.setBinding(ORG_ID, null, 'cafe', 'text');
    expect(store.bindingFor(ORG_ID, 'cafe', 'text')).toBeUndefined();
    expect(store.bindingFor(ORG_ID, 'cafe', 'voice')).toBeDefined();
  });

  it('posts what you say in a space to its channel, as you', async () => {
    const c = client(memberId);
    hub.connect(c);
    hub.enter(memberId, 'cafe', 'live');
    hub.say(memberId, 'anyone want a flat white?');
    await flush();
    await flush();
    // posted as they look in this server: their nickname and server picture there
    expect(api.posted).toEqual([{ hook: 'hook-T-cafe', content: 'anyone want a flat white?', username: 'Jay (café crew)' }]);
    expect(api.executeWebhook.mock.calls[0][1]).toMatchObject({ avatar_url: 'https://cdn.discordapp.com/guilds/G1/users/u-jay/avatars/guildpic.png?size=128' });
    // the local line now carries Discord's id, so history won't show it twice
    expect(hub.chatLog('cafe').at(-1)?.id).toBe('m1');
  });

  it('shows channel messages in the space, and as a bubble over the author when they are there', async () => {
    const c = client(memberId);
    hub.connect(c);
    hub.enter(memberId, 'cafe', 'live');
    c.msgs.length = 0;
    await bridge.onMessage(G, msg({ id: 'd1', author: { id: 'u-jay', username: 'jay' }, content: 'typing from Discord' }));
    await bridge.onMessage(G, msg({ id: 'd2', author: { id: 'u-sam', username: 'sam', global_name: 'Sam' }, content: 'hi <@555>!', mentions: [{ id: '555', username: 'jay', global_name: 'Jay' }] }));
    const chat = c.msgs.filter((m) => m.t === 'chat').map((m) => (m.t === 'chat' ? m.entry : null));
    expect(chat.map((e) => [e?.name, e?.text, e?.memberId])).toEqual([
      ['Jay Tester', 'typing from Discord', memberId],
      ['Sam', 'hi @Jay!', undefined],
    ]);
    expect(c.msgs.some((m) => m.t === 'said' && m.memberId === memberId && m.text === 'typing from Discord')).toBe(true);
  });

  it('ignores its own webhook echoes', async () => {
    hub.connect(client(memberId));
    hub.enter(memberId, 'cafe', 'live');
    hub.say(memberId, 'hello');
    await flush();
    await flush();
    const before = hub.chatLog('cafe').length;
    await bridge.onMessage(G, msg({ id: 'm1', webhook_id: 'hook-T-cafe', content: 'hello', author: { id: 'hook', username: 'Jay Tester' } }));
    expect(hub.chatLog('cafe')).toHaveLength(before);
  });

  it('loads the channel history when you walk in', async () => {
    api.history.set('T-general', [
      msg({ id: 'h1', channel_id: 'T-general', content: 'good morning', author: { id: 'u-sam', username: 'sam' }, timestamp: '2026-09-30T08:00:00.000Z' }),
      msg({ id: 'h2', channel_id: 'T-general', content: 'morning!', author: { id: 'u-jay', username: 'jay' }, timestamp: '2026-09-30T08:01:00.000Z' }),
    ]);
    const c = client(memberId);
    hub.connect(c);
    hub.enter(memberId, TOWN_ID, 'live');
    await flush();
    await flush();
    const hist = c.msgs.filter((m) => m.t === 'chat-history').at(-1);
    expect(hist?.t === 'chat-history' && hist.entries.map((e) => e.text)).toEqual(['good morning', 'morning!']);
    expect(hist?.t === 'chat-history' && hist.channel).toEqual({ name: '#general', provider: 'discord' });
  });

  it('moves you between voice channels as you walk between spaces', async () => {
    hub.connect(client(memberId));
    bridge.onVoice(G, { externalUserId: 'u-jay', channelId: 'V-general', muted: false, video: false }, ORG_ID);
    hub.enter(memberId, TOWN_ID, 'live');
    await flush();
    expect(api.moves).toEqual([]); // already in town's voice
    hub.enter(memberId, 'cafe', 'live');
    await flush();
    expect(api.moves).toEqual([{ user: 'u-jay', channel: 'V-cafe' }]);
    // the resulting voice update is the move we asked for: the avatar stays put
    bridge.onVoice(G, { externalUserId: 'u-jay', channelId: 'V-cafe', muted: false, video: false }, ORG_ID);
    expect(hub.actor(memberId)?.sceneId).toBe('cafe');
  });

  it('does not touch voice for people who are not connected to it, or who turned follow off', async () => {
    hub.connect(client(memberId));
    hub.enter(memberId, 'cafe', 'live');
    await flush();
    expect(api.moves).toEqual([]);
    store.updateMember(ORG_ID, memberId, { settings: { locationVisibility: 'everyone', knocksWhileFocused: false, voiceFollow: false } });
    bridge.onVoice(G, { externalUserId: 'u-jay', channelId: 'V-general', muted: false, video: false }, ORG_ID);
    hub.enter(memberId, 'cafe', 'live');
    await flush();
    expect(api.moves).toEqual([]);
  });

  it('takes you out of the call when you walk into a space with no voice channel', async () => {
    hub.connect(client(memberId));
    bridge.onVoice(G, { externalUserId: 'u-jay', channelId: 'V-cafe', muted: false, video: false }, ORG_ID);
    hub.enter(memberId, 'focus', 'live'); // the Quiet Grove: no channels
    await flush();
    await flush();
    expect(api.moves).toEqual([{ user: 'u-jay', channel: null }]);
    bridge.onVoice(G, { externalUserId: 'u-jay', channelId: null, muted: false, video: false }, ORG_ID);
    expect(hub.actor(memberId)?.sceneId).toBe('focus');
  });

  it('parks you in the AFK channel when there is one, and brings you back out', async () => {
    api.afk = 'V-afk';
    hub.connect(client(memberId));
    bridge.onVoice(G, { externalUserId: 'u-jay', channelId: 'V-cafe', muted: false, video: false }, ORG_ID);
    hub.enter(memberId, 'focus', 'live');
    await flush();
    await flush();
    expect(api.moves).toEqual([{ user: 'u-jay', channel: 'V-afk' }]);
    bridge.onVoice(G, { externalUserId: 'u-jay', channelId: 'V-afk', muted: false, video: false }, ORG_ID);
    hub.enter(memberId, TOWN_ID, 'live');
    await flush();
    expect(api.moves.at(-1)).toEqual({ user: 'u-jay', channel: 'V-general' });
  });

  it('leaves people alone who are in a call that is not one of the spaces', async () => {
    hub.connect(client(memberId));
    bridge.onVoice(G, { externalUserId: 'u-jay', channelId: 'V-gaming', muted: false, video: false }, ORG_ID);
    hub.enter(memberId, 'focus', 'live');
    await flush();
    await flush();
    expect(api.moves).toEqual([]);
  });

  it('shows the talk light only while really in voice and not muted', () => {
    const c = client(memberId);
    hub.connect(c);
    hub.enter(memberId, 'cafe', 'live');
    hub.speakingFromMic(memberId, true);
    expect(hub.actor(memberId)?.speaking).toBeFalsy(); // not in voice
    hub.setVoice(memberId, { providerChannelId: 'V-cafe', muted: true, video: false });
    hub.speakingFromMic(memberId, true);
    expect(hub.actor(memberId)?.speaking).toBeFalsy(); // muted in Discord
    hub.setVoice(memberId, { providerChannelId: 'V-cafe', muted: false, video: false });
    hub.speakingFromMic(memberId, true);
    expect(hub.actor(memberId)?.speaking).toBe(true);
    hub.setVoice(memberId, undefined); // left voice: the light goes off
    expect(hub.actor(memberId)?.speaking).toBe(false);
  });

  it('walks your avatar to the space whose voice channel you switched to in Discord', () => {
    hub.connect(client(memberId));
    hub.enter(memberId, TOWN_ID, 'live');
    bridge.onVoice(G, { externalUserId: 'u-jay', channelId: 'V-cafe', muted: false, video: false }, ORG_ID);
    expect(hub.actor(memberId)?.sceneId).toBe('cafe');
  });

  it('follows Discord when a bound channel is renamed or deleted', () => {
    bridge.onChannel(ORG_ID, { id: 'T-cafe', name: 'coffee-talk', deleted: false });
    expect(store.bindingFor(ORG_ID, 'cafe', 'text')?.label).toBe('#coffee-talk');
    bridge.onChannel(ORG_ID, { id: 'V-cafe', deleted: true });
    expect(store.bindingFor(ORG_ID, 'cafe', 'voice')).toBeUndefined();
  });
});

describe('Discord message rendering', () => {
  it('names mentions, keeps custom emoji readable, notes attachments', () => {
    expect(
      renderContent(msg({ id: '1', content: 'hey <@42> see <#7> :) <:party:123>', mentions: [{ id: '42', username: 'x', member: { nick: 'Kim' } }], attachments: [{ filename: 'plan.pdf' }] })),
    ).toBe('hey @Kim see #channel :) :party: 📎 plan.pdf');
  });
  it('keeps webhook names within Discord’s rules', () => {
    expect(webhookName('Discord Dave')).not.toMatch(/discord/i);
    expect(webhookName('')).toBe('Minglewood member');
  });
});

describe('Channel setup for every space', () => {
  const ch = (id: string, name: string, type: number, position = 0) => ({ id, name, type, position });
  const rooms = [
    { id: 'cafe', name: 'Tidewater Café' },
    { id: 'eng', name: 'Engineering Studio' },
    { id: 'focus', name: 'The Quiet Grove', quiet: true },
  ];

  it('covers the town and every room except quiet ones', () => {
    expect(spacesOf(rooms).map((s) => s.id)).toEqual([TOWN_ID, 'cafe', 'eng']);
    expect(namesFor({ id: 'cafe', name: 'Tidewater Café' })).toMatchObject({ text: 'tidewater-cafe', voice: 'Tidewater Café' });
  });

  it('matches existing channels by name and plans the rest', () => {
    const channels = [ch('1', 'general', ChannelType.GUILD_TEXT), ch('2', 'General', ChannelType.GUILD_VOICE), ch('3', 'cafe', ChannelType.GUILD_TEXT), ch('4', 'random', ChannelType.GUILD_TEXT)];
    const plan = planSetup(spacesOf(rooms), channels, [], true);
    const get = (space: string, slot: string) => plan.find((p) => p.spaceId === space && p.slot === slot)!;
    expect(get(TOWN_ID, 'text')).toMatchObject({ action: 'matched', channelId: '1' });
    expect(get(TOWN_ID, 'voice')).toMatchObject({ action: 'matched', channelId: '2' });
    expect(get('cafe', 'text')).toMatchObject({ action: 'matched', channelId: '3' });
    expect(get('cafe', 'voice')).toMatchObject({ action: 'create', channelName: 'Tidewater Café' });
    expect(get('eng', 'text')).toMatchObject({ action: 'create', channelName: 'engineering-studio' });
    expect(plan.some((p) => p.channelId === '4')).toBe(false);
  });

  it('creates what is missing in a Minglewood category and binds everything', async () => {
    const store = new Store(new MemoryPersistence());
    await store.init();
    let next = 100;
    const created: Array<{ name: string; type: number; parent_id?: string }> = [];
    const fake = {
      guildChannels: vi.fn(async () => [ch('1', 'general', ChannelType.GUILD_TEXT)]),
      createChannel: vi.fn(async (_t: string, _g: string, body: { name: string; type: number; parent_id?: string }) => {
        created.push(body);
        return { id: String(next++), name: body.name, type: body.type };
      }),
    };
    const { failed } = await runSetup({ store, orgId: ORG_ID, guildId: G, token: 't', create: true, api: fake });
    expect(failed).toEqual([]);
    expect(created[0]).toMatchObject({ name: 'Minglewood', type: ChannelType.GUILD_CATEGORY });
    expect(created.slice(1).every((c) => c.parent_id === '100')).toBe(true);
    expect(store.bindingFor(ORG_ID, TOWN_ID, 'text')).toMatchObject({ externalChannelId: '1', label: '#general' });
    expect(store.bindingFor(ORG_ID, 'cafe', 'text')?.label).toBe(labelFor('text', 'tidewater-cafe'));
    expect(store.bindingFor(ORG_ID, 'focus', 'voice')).toBeUndefined(); // quiet room: no channels
  });

  it('reads the bot’s server-wide permissions', () => {
    const base = { guildId: 'G', ownerId: 'owner', botId: 'bot', botRoleIds: ['r1'] };
    expect(effectivePermissions({ ...base, roles: [{ id: 'G', permissions: '1024' }, { id: 'r1', permissions: String(1 << 11) }] })).toBe(1024n | 2048n);
    expect(effectivePermissions({ ...base, roles: [{ id: 'r1', permissions: '8' }] })).toBe(~0n);
  });
});
