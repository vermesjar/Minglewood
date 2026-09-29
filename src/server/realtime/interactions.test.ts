import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerMsg } from '@shared/protocol';
import { ORG_ID } from '@shared/seed/northstar';
import { DEFAULT_LOADOUT } from '@shared/avatar';
import { distanceToObject, rollInteraction, type PropState } from '@shared/world/interactions';
import type { SceneObject } from '@shared/world/scene';
import { Store } from '../store/store';
import { MemoryPersistence } from '../store/jsonFile';
import { OrgHub, type HubClient } from './orgHub';

function client(memberId: string) {
  const msgs: ServerMsg[] = [];
  const c: HubClient & { msgs: ServerMsg[] } = { id: `c-${memberId}-${Math.random()}`, memberId, sceneId: null, msgs, send: (m) => msgs.push(m) };
  return c;
}

function member(store: Store, name: string) {
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
  });
}

describe('prop interactions', () => {
  const fountain: SceneObject = { id: 'f', sprite: 'fountain', x: 20, y: 20, w: 2, d: 2 };

  it('measures reach from the footprint edge', () => {
    expect(distanceToObject(fountain, 21, 21)).toBe(0);
    expect(distanceToObject(fountain, 21, 23)).toBe(2);
    expect(distanceToObject(fountain, 18, 20)).toBe(2);
  });

  it('counts wishes per day and resets tomorrow', () => {
    const st: PropState = {};
    const day = Date.parse('2026-09-29T10:00:00Z');
    expect(rollInteraction(fountain, st, 'Ada', day).n).toBe(1);
    expect(rollInteraction(fountain, st, 'Bo', day).text).toContain('#2');
    expect(rollInteraction(fountain, st, 'Cy', day + 86_400_000).n).toBe(1);
  });

  it('keeps an arcade high score with its holder', () => {
    const cab: SceneObject = { id: 'c', sprite: 'arcade-cabinet', x: 0, y: 0 };
    const st: PropState = {};
    const r1 = rollInteraction(cab, st, 'Ada', Date.now(), () => 0.9);
    expect(r1.best).toBe(true);
    const r2 = rollInteraction(cab, st, 'Bo', Date.now(), () => 0.1);
    expect(r2.best).toBe(false);
    expect(st.bestBy).toBe('Ada');
  });

  it('cycles the jukebox and toggles lamps', () => {
    const sp: SceneObject = { id: 's', sprite: 'speaker', x: 0, y: 0 };
    const st: PropState = {};
    expect(rollInteraction(sp, st, 'Ada').track).toBe(1);
    expect(rollInteraction(sp, st, 'Ada').track).toBe(2);
    const lamp: SceneObject = { id: 'l', sprite: 'lamp-post', x: 0, y: 0 };
    const ls: PropState = {};
    expect(rollInteraction(lamp, ls, 'Ada').on).toBe(false);
    expect(rollInteraction(lamp, ls, 'Ada').on).toBe(true);
  });
});

describe('OrgHub: playing together', () => {
  let store: Store;
  let hub: OrgHub;
  beforeEach(async () => {
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
  });
  afterEach(() => hub.dispose());

  it('shares a prop outcome with the scene, only within reach', () => {
    const a = member(store, 'Ada');
    const b = member(store, 'Bo');
    const ca = client(a.id);
    const cb = client(b.id);
    hub.connect(ca);
    hub.connect(cb);
    hub.enter(a.id, 'town', 'live', [21, 23]);
    hub.enter(b.id, 'town', 'live', [30, 30]);
    expect(hub.interact(a.id, 'fountain')).toBe(true);
    const seen = cb.msgs.find((m) => m.t === 'interacted');
    expect(seen && seen.t === 'interacted' && seen.result.n).toBe(1);
    // Too far away, and rate limited.
    expect(hub.interact(b.id, 'fountain')).toBe(false);
    expect(hub.interact(a.id, 'fountain')).toBe(false);
    // Anyone arriving later sees the prop's state.
    const c = member(store, 'Cy');
    const cc = client(c.id);
    hub.connect(cc);
    hub.enter(c.id, 'town', 'live');
    const scene = cc.msgs.find((m) => m.t === 'scene');
    expect(scene && scene.t === 'scene' && scene.props?.fountain?.n).toBe(1);
  });

  it('completes a high five only when both hands go up', () => {
    const a = member(store, 'Ada');
    const b = member(store, 'Bo');
    const ca = client(a.id);
    const cb = client(b.id);
    hub.connect(ca);
    hub.connect(cb);
    hub.enter(a.id, 'cafe', 'live');
    hub.enter(b.id, 'cafe', 'live');
    hub.emote(a.id, 'highfive', b.id);
    expect(cb.msgs.some((m) => m.t === 'toast' && m.text.includes('high five'))).toBe(true);
    expect(ca.msgs.some((m) => m.t === 'combo')).toBe(false);
    hub.emote(b.id, 'highfive', a.id);
    const combo = ca.msgs.find((m) => m.t === 'combo');
    expect(combo && combo.t === 'combo' && [combo.a, combo.b]).toEqual([a.id, b.id]);
  });
});
