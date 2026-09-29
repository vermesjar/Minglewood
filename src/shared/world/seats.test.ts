import { describe, expect, it } from 'vitest';
import { allScenes, getScene } from './index';
import { findPath, isValidPath } from './pathfinding';
import { approach, approachTiles } from './interact';
import { seatFacing, seatSpotAt, seatSpots, stepOffTiles } from './seats';
import { isSeat } from './scene';
import { WalkGrid } from './walkGrid';

describe('seat standard', () => {
  const cafe = getScene('cafe')!;
  const couch = cafe.objects.find((o) => o.sprite === 'couch')!;

  it('gives a couch one spot per cushion, all facing the way it faces', () => {
    const spots = seatSpots(couch, cafe);
    expect(spots).toHaveLength((couch.w ?? 1) * (couch.d ?? 1));
    expect(new Set(spots.map((s) => s.facing))).toEqual(new Set([couch.facing]));
    for (const s of spots) expect(seatSpotAt(cafe, s.x, s.y)?.seat.id).toBe(couch.id);
  });

  it('turns a stool with no facing of its own toward the counter beside it', () => {
    const stool = cafe.objects.find((o) => o.sprite === 'stool')!;
    expect(seatFacing(stool, cafe)).toBe('ne');
  });

  it('never lets anyone walk through or stand on furniture, seats included', () => {
    for (const scene of allScenes().values()) {
      const grid = new WalkGrid(scene);
      for (const o of scene.objects.filter(isSeat)) for (const s of seatSpots(o, scene)) expect(grid.walkable(s.x, s.y)).toBe(false);
    }
  });

  it('reaches every seat spot as the last step of a walk, with somewhere to step off', () => {
    for (const scene of [...allScenes().values()].filter((s) => s.kind === 'interior')) {
      const grid = new WalkGrid(scene);
      for (const o of scene.objects.filter(isSeat))
        for (const s of seatSpots(o, scene)) {
          const path = findPath(grid, [scene.spawn.x, scene.spawn.y], [s.x, s.y], { allowGoal: true });
          expect(path, `${scene.id} ${o.id} (${s.x},${s.y})`).not.toBeNull();
          expect(isValidPath(grid, path!, true)).toBe(true);
          // no walking through other seats on the way, and somewhere to step off when you stand
          expect(path!.slice(1, -1).every(([x, y]) => grid.walkable(x, y))).toBe(true);
          expect(stepOffTiles(s).some(([x, y]) => grid.walkable(x, y)), `${scene.id} ${o.id} step off`).toBe(true);
        }
    }
  });

  it('keeps guests out of the lane behind the café bar', () => {
    const grid = new WalkGrid(cafe);
    for (const a of cafe.staff ?? []) for (let x = a.x; x < a.x + a.w; x++) expect(grid.walkable(x, a.y)).toBe(false);
  });
});

describe('using things', () => {
  const cafe = getScene('cafe')!;
  const machine = cafe.objects.find((o) => o.sprite === 'espresso')!;

  it('orders at the espresso machine from the room side of the counter', () => {
    const grid = new WalkGrid(cafe);
    const way = approach(grid, [cafe.spawn.x, cafe.spawn.y], machine)!;
    expect(way).not.toBeNull();
    expect(way.tile[1]).toBeGreaterThan(machine.y); // in front (the room is +y of the bar), never behind it
    expect(Math.abs(way.tile[0] - machine.x) + Math.abs(way.tile[1] - machine.y)).toBe(1);
  });

  it('lists the tiles in front of an object first', () => {
    // the machine's working face is toward the barista (ne = −y), so its front tile is behind the bar;
    // guests still order from the room side (above) because that lane is staff-only
    expect(machine.facing).toBe('ne');
    const [first] = approachTiles(machine);
    expect(first).toEqual([machine.x, machine.y - 1]);
    const [fx, fy] = approachTiles({ ...machine, facing: 'sw' })[0];
    expect([fx, fy]).toEqual([machine.x, machine.y + 1]);
  });
});
