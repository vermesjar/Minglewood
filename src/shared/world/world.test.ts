import { describe, expect, it } from 'vitest';
import { allScenes, getScene, TOWN_ID } from './index';
import { WalkGrid } from './walkGrid';
import { findPath, isValidPath, positionAlong } from './pathfinding';
import { isSeat } from './scene';
import { buildSeed, ROOMS, DEMO_BINDINGS } from '../seed/northstar';
import { MEMORY_SLOTS, nextFreeSlot, sceneWithMemory } from './memory';

describe('northstar world', () => {
  const town = getScene(TOWN_ID)!;
  const grid = new WalkGrid(town);

  it('has every building door reachable from the spawn point', () => {
    const buildings = town.objects.filter((o) => o.building);
    expect(buildings.length).toBeGreaterThanOrEqual(7);
    for (const b of buildings) {
      const path = findPath(grid, [town.spawn.x, town.spawn.y], [b.door!.x, b.door!.y]);
      expect(path, `door of ${b.id}`).not.toBeNull();
    }
  });

  it('every room has an interior scene and a building', () => {
    for (const r of ROOMS) {
      expect(getScene(r.id), r.id).toBeDefined();
      expect(town.objects.some((o) => o.roomId === r.id), r.id).toBe(true);
    }
  });

  it('every interior seat is reachable from the door', () => {
    for (const s of allScenes().values()) {
      if (s.kind !== 'interior') continue;
      const g = new WalkGrid(s, new Set(['balloons']));
      for (const seat of s.objects.filter(isSeat)) {
        const path = findPath(g, [s.spawn.x, s.spawn.y], [seat.x, seat.y], { allowGoal: true });
        expect(path, `${s.id} seat ${seat.id} at ${seat.x},${seat.y}`).not.toBeNull();
      }
    }
  });

  it('artifacts referenced by objects exist, and every artifact is placed', () => {
    const { artifacts } = buildSeed();
    const ids = new Set(artifacts.map((a) => a.id));
    const placed = new Set<string>();
    for (const s of allScenes().values()) {
      for (const o of s.objects) {
        if (!o.artifactId) continue;
        expect(ids.has(o.artifactId), o.artifactId).toBe(true);
        placed.add(o.artifactId);
      }
    }
    for (const a of artifacts) expect(placed.has(a.id), a.id).toBe(true);
  });

  it('bindings point at real rooms', () => {
    for (const b of DEMO_BINDINGS) expect(ROOMS.some((r) => r.id === b.roomId)).toBe(true);
  });

  it('seed people have valid teams, managers and start scenes', () => {
    const { members, sim } = buildSeed();
    const ids = new Set(members.map((m) => m.id));
    expect(members.length).toBeGreaterThanOrEqual(25);
    for (const m of members) {
      if (m.managerId) expect(ids.has(m.managerId), m.id).toBe(true);
      expect(allScenes().has(sim[m.id].start), m.id).toBe(true);
    }
  });
});

describe('pathfinding', () => {
  const town = getScene(TOWN_ID)!;
  const grid = new WalkGrid(town);

  it('produces valid, contiguous paths', () => {
    const p = findPath(grid, [21, 23], [33, 20])!;
    expect(p).not.toBeNull();
    expect(isValidPath(grid, p)).toBe(true);
  });

  it('rejects teleporting paths', () => {
    expect(isValidPath(grid, [[21, 23], [25, 23]])).toBe(false);
  });

  it('interpolates along a path deterministically', () => {
    const path: [number, number][] = [[0, 0], [1, 0], [2, 0]];
    const mid = positionAlong(path, 1000 / 4.2, 4.2);
    expect(mid.x).toBeCloseTo(1, 3);
    expect(positionAlong(path, 10_000).done).toBe(true);
  });
});

describe('memory walls', () => {
  it('slots sit on free wall space in every room', () => {
    for (const r of ROOMS) {
      const scene = getScene(r.id)!;
      const slots = MEMORY_SLOTS[r.id];
      expect(slots?.length, r.id).toBeGreaterThan(0);
      for (const slot of slots) {
        const span = slot.wall === 'right' ? scene.width : scene.height;
        expect(slot.at, `${r.id} ${slot.wall}:${slot.at}`).toBeLessThan(span);
        for (const o of scene.objects.filter((x) => x.wall === slot.wall)) {
          const start = slot.wall === 'right' ? o.x : o.y;
          const len = slot.wall === 'right' ? (o.w ?? 1) : (o.d ?? o.w ?? 1);
          const overlaps = slot.at >= start && slot.at < start + len;
          expect(overlaps, `${r.id} slot ${slot.wall}:${slot.at} vs ${o.id}`).toBe(false);
        }
      }
    }
  });

  it('fills slots in order and places new artifacts in the scene', () => {
    const { artifacts } = buildSeed();
    const s1 = nextFreeSlot('launch', artifacts)!;
    const added = { ...artifacts[0], id: 'art-x', objectId: 'mem-art-x', sceneId: 'launch', placement: s1 };
    const s2 = nextFreeSlot('launch', [...artifacts, added])!;
    expect(`${s2.wall}:${s2.at}`).not.toBe(`${s1.wall}:${s1.at}`);
    const scene = sceneWithMemory(getScene('launch')!, [...artifacts, added]);
    expect(scene.objects.some((o) => o.artifactId === 'art-x' && o.wall === s1.wall)).toBe(true);
  });
});
