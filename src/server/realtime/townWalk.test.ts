import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerMsg } from '@shared/protocol';
import { ORG_ID } from '@shared/seed/northstar';
import { DEFAULT_LOADOUT } from '@shared/avatar';
import { getScene, TOWN_ID } from '@shared/world';
import { WalkGrid } from '@shared/world/walkGrid';
import { findPath, isValidPath } from '@shared/world/pathfinding';
import { Store } from '../store/store';
import { MemoryPersistence } from '../store/jsonFile';
import { OrgHub, type HubClient } from './orgHub';

/** Long walks across the 76×76 town: planned fast, and accepted by the server end to end. */
describe('walking across town', () => {
  const town = getScene(TOWN_ID)!;
  const grid = new WalkGrid(town);
  const doors = town.objects.filter((o) => o.building && o.door);

  it('plans a walk from the spawn point to every door in well under a frame', () => {
    for (const b of doors) {
      const t0 = performance.now();
      const path = findPath(grid, [town.spawn.x, town.spawn.y], [b.door!.x, b.door!.y]);
      const ms = performance.now() - t0;
      expect(path, b.id).not.toBeNull();
      expect(isValidPath(grid, path!), b.id).toBe(true);
      expect(ms, `${b.id} took ${ms.toFixed(1)} ms`).toBeLessThan(20);
    }
  });

  let store: Store;
  let hub: OrgHub;
  beforeEach(async () => {
    store = new Store(new MemoryPersistence());
    await store.init();
    hub = new OrgHub(ORG_ID, store);
  });
  afterEach(() => hub.dispose());

  it('accepts the whole walk from the spawn point to the café door ("Join them")', () => {
    const m = store.createMember(ORG_ID, {
      displayName: 'Walker',
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
    const msgs: ServerMsg[] = [];
    const c: HubClient = { id: 'c-walker', memberId: m.id, sceneId: null, send: (x) => msgs.push(x) };
    hub.connect(c);
    hub.enter(m.id, TOWN_ID, 'live', [town.spawn.x, town.spawn.y]);
    const cafe = doors.find((o) => o.roomId === 'cafe')!;
    const path = findPath(grid, [town.spawn.x, town.spawn.y], [cafe.door!.x, cafe.door!.y])!;
    expect(path.length).toBeGreaterThan(20); // a real walk, not a hop
    expect(hub.move(m.id, path)).toBe(true);
  });
});
