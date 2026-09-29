import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerMsg } from '@shared/protocol';
import { ORG_ID } from '@shared/seed/northstar';
import { DEFAULT_LOADOUT } from '@shared/avatar';
import { Store } from '../store/store';
import { MemoryPersistence } from '../store/jsonFile';
import { OrgHub, type HubClient } from './orgHub';

function client(memberId: string) {
  const msgs: ServerMsg[] = [];
  const c: HubClient & { msgs: ServerMsg[] } = {
    id: `c-${memberId}-${Math.random()}`,
    memberId,
    sceneId: null,
    msgs,
    send: (m) => msgs.push(m),
  };
  return c;
}

function newMember(store: Store, name: string, extra: Partial<Parameters<Store['createMember']>[1]> = {}) {
  return store.createMember(ORG_ID, {
    displayName: name,
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
    ...extra,
  });
}

describe('OrgHub', () => {
  let store: Store;
  let hub: OrgHub;
  beforeEach(async () => {
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
  });
  afterEach(() => hub.dispose());

  it('scopes movement updates to the scene', () => {
    const a = newMember(store, 'Ada');
    const b = newMember(store, 'Bo');
    const c = newMember(store, 'Cy');
    const ca = client(a.id);
    const cb = client(b.id);
    const cc = client(c.id);
    [ca, cb, cc].forEach((x) => hub.connect(x));
    hub.enter(a.id, 'cafe', 'live');
    hub.enter(b.id, 'cafe', 'live');
    hub.enter(c.id, 'eng', 'live');
    const start = hub.actor(a.id)!;
    const ok = hub.move(a.id, [
      [start.x, start.y],
      [start.x + 1, start.y],
    ]);
    expect(ok).toBe(true);
    expect(cb.msgs.some((m) => m.t === 'moved' && m.memberId === a.id)).toBe(true);
    expect(cc.msgs.some((m) => m.t === 'moved')).toBe(false);
  });

  it('rejects paths that teleport or start far from the actor', () => {
    const a = newMember(store, 'Ada');
    hub.connect(client(a.id));
    hub.enter(a.id, 'town', 'live', [21, 23]);
    expect(hub.move(a.id, [[21, 23], [25, 23]])).toBe(false);
    expect(hub.move(a.id, [[30, 30], [31, 30]])).toBe(false);
  });

  it('holds knocks for focused people and delivers them when they are free', () => {
    const a = newMember(store, 'Ada');
    const b = newMember(store, 'Bo');
    const ca = client(a.id);
    const cb = client(b.id);
    hub.connect(ca);
    hub.connect(cb);
    hub.enter(a.id, 'town', 'live');
    hub.enter(b.id, 'town', 'live');
    hub.setStatus(b.id, 'focused', 'deep work');
    hub.knock(a.id, b.id, 'chat');
    expect(cb.msgs.some((m) => m.t === 'knock')).toBe(false);
    expect(ca.msgs.some((m) => m.t === 'toast' && m.text.includes('focused'))).toBe(true);
    hub.setStatus(b.id, 'open', undefined);
    expect(cb.msgs.some((m) => m.t === 'knock' && m.fromId === a.id)).toBe(true);
  });

  it('never reveals location to viewers the member did not choose', () => {
    const a = newMember(store, 'Ada', { settings: { locationVisibility: 'nobody', knocksWhileFocused: false } });
    const t = newMember(store, 'Tea', { settings: { locationVisibility: 'team', knocksWhileFocused: false }, teamId: 'team-mobile' });
    const viewer = newMember(store, 'Vi');
    hub.connect(client(a.id));
    hub.connect(client(t.id));
    hub.enter(a.id, 'cafe', 'live');
    hub.enter(t.id, 'cafe', 'live');
    const dir = hub.directoryFor(viewer.id);
    const ea = dir.find((d) => d.memberId === a.id)!;
    const et = dir.find((d) => d.memberId === t.id)!;
    expect(ea.online).toBe(true);
    expect(ea.sceneId).toBeUndefined();
    expect(et.sceneId).toBeUndefined();
    // teammates can see team-visible location
    const mate = newMember(store, 'Mate', { teamId: 'team-mobile' });
    expect(hub.directoryFor(mate.id).find((d) => d.memberId === t.id)!.sceneId).toBe('cafe');
  });

  it('marks people in quiet rooms as focused', () => {
    const a = newMember(store, 'Ada');
    hub.connect(client(a.id));
    hub.setStatus(a.id, 'open', 'say hi');
    hub.enter(a.id, 'focus', 'live');
    expect(hub.presenceOf(a.id).status).toBe('focused');
    hub.enter(a.id, 'town', 'live');
    expect(hub.presenceOf(a.id)).toMatchObject({ status: 'open', note: 'say hi' });
  });

  it('refuses chat bubbles in quiet rooms', () => {
    const a = newMember(store, 'Ada');
    hub.connect(client(a.id));
    hub.enter(a.id, 'focus', 'live');
    expect(hub.say(a.id, 'hello?')).toBe(false);
  });

  it('only grants event rewards to people at the event', () => {
    const a = newMember(store, 'Ada');
    hub.connect(client(a.id));
    hub.enter(a.id, 'cafe', 'live');
    hub.claimReward(a.id, 'ev-jonah-bday');
    expect(store.member(ORG_ID, a.id)!.unlockedItems).not.toContain('hat.party');
    hub.enter(a.id, 'events', 'live');
    hub.claimReward(a.id, 'ev-jonah-bday');
    expect(store.member(ORG_ID, a.id)!.unlockedItems).toContain('hat.party');
  });

  it('sanitizes avatar loadouts against the catalog and unlocks', () => {
    const a = newMember(store, 'Ada');
    hub.connect(client(a.id));
    hub.setAvatar(a.id, { ...DEFAULT_LOADOUT, accessory: 'acc.party-hat', hair: 'hair.<script>' });
    const m = store.member(ORG_ID, a.id)!;
    expect(m.avatar.accessory).toBe('acc.none');
    expect(m.avatar.hair).toBe(DEFAULT_LOADOUT.hair);
  });
});
