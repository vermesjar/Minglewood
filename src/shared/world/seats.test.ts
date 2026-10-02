import { describe, expect, it } from 'vitest';
import { allScenes, getScene } from './index';
import { findPath, isValidPath } from './pathfinding';
import { approach, approachTiles } from './interact';
import { SEAT_FIELDS, seatFacing, seatProfile, seatSpotAt, seatSpots, seenFromBehind, sitterLift, sitterPoint, sitThigh, spacingProblems, stepOffTiles } from './seats';
import type { SeatModel } from './seatModels';
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

  it('leaves a tile of floor in front of every seat in every room (the seat spacing rule)', () => {
    for (const s of allScenes().values()) expect(spacingProblems(s), s.id).toEqual([]);
    // a couch hard up against a coffee table breaks it; a chair pulled up to a desk doesn't
    const base = getScene('cafe')!;
    const room = (objects: typeof base.objects) => ({ ...base, objects });
    const sit = [{ kind: 'sit' as const, label: 'Sit' }];
    const couch = { id: 'c', sprite: 'couch', x: 2, y: 2, w: 2, d: 1, facing: 'sw' as const, actions: sit };
    expect(spacingProblems(room([couch, { id: 't', sprite: 'table-low', x: 2, y: 3, w: 2, d: 1 }]))).toHaveLength(2);
    expect(spacingProblems(room([couch, { id: 't', sprite: 'table-low', x: 2, y: 4, w: 2, d: 1 }]))).toEqual([]);
    const chair = { id: 'o', sprite: 'chair', variant: 'office', x: 2, y: 2, facing: 'sw' as const, actions: sit };
    expect(spacingProblems(room([chair, { id: 'd', sprite: 'desk', x: 2, y: 3, w: 2, d: 1 }]))).toEqual([]);
    expect(spacingProblems(room([chair, { id: 'l', sprite: 'lamp', x: 2, y: 3 }]))).toHaveLength(1);
  });

  it('keeps guests out of the lane behind the café bar', () => {
    const grid = new WalkGrid(cafe);
    for (const a of cafe.staff ?? []) for (let x = a.x; x < a.x + a.w; x++) expect(grid.walkable(x, a.y)).toBe(false);
  });
});

describe('seat profiles', () => {
  it('fills a seat’s profile from its family, its own values first', () => {
    expect(seatProfile('stool')).toMatchObject({ sitStyle: 'stool', backrest: false });
    expect(seatProfile('couch')).toMatchObject({ sitStyle: 'lounge', backrest: true });
    expect(seatProfile('beanbag')).toMatchObject({ sitStyle: 'floor', backrest: true });
    expect(seatProfile('chair', { seat: 16.9, arms: true })).toEqual({ seat: 16.9, sitStyle: 'chair', backrest: true, arms: true });
  });

  it('lifts a sitter so the underside of their thighs rests on the cushion', () => {
    // the sitting figure's thighs sit (104 − (82 + drop + 3)) / 2 world px above its feet anchor
    expect(sitThigh('chair')).toBe(6.5);
    expect(sitterLift(seatProfile('chair', { seat: 12 }))).toBe(5.5);
    expect(sitterLift(seatProfile('beanbag', { seat: 9.5 }))).toBeCloseTo(9.5 - sitThigh('floor'));
  });

  it('sits someone in the middle of the tile of a seat without a model', () => {
    expect(sitterPoint({ x: 3, y: 4 })).toEqual({ x: 3.5, y: 4.5 });
    expect(['se', 'sw', 'ne', 'nw'].filter((f) => seenFromBehind(f as never))).toEqual(['ne', 'nw']);
  });

  it('names every field the manifest carries for a seat', () => {
    expect([...SEAT_FIELDS]).toEqual(['seat', 'sitStyle', 'backrest', 'arms', 'seatKind']);
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

describe('where each view sits you (seat models)', () => {
  // a 1×1 armchair: a cushion block from the front edge to the back, a back behind it
  const m: SeatModel = {
    size: [1, 1],
    parts: [
      { part: 'seat', u: [0.1, 0.9], v: [0.05, 0.95], z: [4, 10] },
      { part: 'back', u: [0.1, 0.9], v: [0.7, 0.95], z: [10, 22] },
    ],
    sits: [[0.5, 0.35, 10]],
  };

  it('projects the same sitting points in all four views', async () => {
    const { viewSits } = await import('./seatModels');
    for (const facing of ['se', 'sw', 'ne', 'nw'] as const) expect(viewSits(m, facing)[0]).toEqual(m.sits[0]);
  });

  it('puts the pelvis forward on a seat deeper than a thigh, knees at its front', async () => {
    const { standardSitV, SEAT_REACH } = await import('./seatModels');
    const deep = structuredClone(m);
    deep.parts[1].v = [0.95, 1];
    expect(standardSitV(deep, 0.5, 10)).toBeCloseTo(0.05 - 0.04 + SEAT_REACH);
  });

  it('uses the original pelvis width for back contact without a contradictory short-thigh limit', async () => {
    const { standardSitV, SIT_GAP, seatPlacementProblems } = await import('./seatModels');
    const { legsFor, kneeV, KNEE_OUT } = await import('./sitLegs');
    const chair: SeatModel = { size: [1, 1], parts: [
      { part: 'seat', u: [0.2, 0.8], v: [0.2, 0.77], z: [9, 11.3] },
      { part: 'back', u: [0.2, 0.8], v: [0.78, 0.86], z: [11.05, 21] },
    ], sits: [] };
    const v = standardSitV(chair, 0.5, 11.3)!;
    expect(v + SIT_GAP).toBeCloseTo(0.78);
    expect(v).toBeGreaterThan(0.56);
    const sit: [number, number, number] = [0.5, v, 11.3];
    expect(kneeV(sit, legsFor(chair, sit, 'chair'))).toBeCloseTo(0.2 - KNEE_OUT, 2);
    expect(seatPlacementProblems({ ...chair, sits: [sit] })).toEqual([]);
    expect(seatPlacementProblems({ ...chair, sits: [[0.5, 0.48, 11.3]] }).join()).toContain('too far forward');
    expect(seatPlacementProblems({ ...chair, sits: [[0.5, 0.62, 11.3]] }).join()).toContain('intersects');
  });

  it('lays the legs from the seat: knees just past its front, feet on the floor when a shin reaches it', async () => {
    const { legsFor, kneeV, KNEE_OUT, SHIN_MAX, THIGH_R } = await import('./sitLegs');
    const low: SeatModel = { ...m, parts: [{ part: 'seat', u: [0.1, 0.9], v: [0.05, 0.95], z: [3, 8] }], sits: [[0.5, 0.35, 8]] };
    const legs = legsFor(low, low.sits[0], 'chair');
    expect(kneeV(low.sits[0], legs)).toBeCloseTo(0.05 - KNEE_OUT);
    expect(legs.drop).toBeCloseTo(8 + THIGH_R);
    // a bar stool: the knees too high for a shin to reach the floor, so the feet hang
    const stool: SeatModel = { size: [1, 1], parts: [{ part: 'seat', u: [0.3, 0.7], v: [0.3, 0.7], z: [20, 22] }], sits: [[0.5, 0.5, 22]] };
    expect(legsFor(stool, stool.sits[0], 'stool').drop).toBe(SHIN_MAX);
    expect(legsFor(stool, stool.sits[0], 'stool').hang).toBeCloseTo(22 + THIGH_R - 1.5 - SHIN_MAX);
  });

  it('seats a couch’s sitters toward its middle, clear of its arms', async () => {
    const { placeSits, ARM_CLEAR } = await import('../../client/engine/sprites/seatModelFit');
    const couch = [
      { part: 'seat' as const, u: [0, 2] as [number, number], v: [0.1, 0.9] as [number, number], z: [4, 10] as [number, number] },
      { part: 'arm' as const, u: [0, 0.25] as [number, number], v: [0.1, 0.9] as [number, number], z: [10, 16] as [number, number] },
      { part: 'arm' as const, u: [1.75, 2] as [number, number], v: [0.1, 0.9] as [number, number], z: [10, 16] as [number, number] },
    ];
    const [a, b] = placeSits(couch, [2, 1]);
    expect(a[0]).toBeCloseTo(0.25 + ARM_CLEAR);
    expect(b[0]).toBeCloseTo(1.75 - ARM_CLEAR);
    // an armless bench: the spacing about its middle
    const [c, d] = placeSits([couch[0]], [2, 1]);
    expect([c[0], d[0]]).toEqual([0.6, 1.4]);
    // a single seat: its middle
    expect(placeSits([{ ...couch[0], u: [0, 1] }], [1, 1])[0][0]).toBe(0.5);
  });

  it('keeps complete bent legs in every view, even when the backrest will hide them', async () => {
    const { legsFor } = await import('./sitLegs');
    const { frameFor } = await import('../../client/engine/sprites/avatarFrame');
    for (const style of ['chair', 'stool', 'lounge', 'floor'] as const) {
      const legs = legsFor(m, [0.5, 0.4, 10], style);
      const pose = { chair: 'sit', stool: 'sit-stool', lounge: 'sit-lounge', floor: 'sit-floor' } as const;
      for (const view of ['front', 'back'] as const) {
        const F = frameFor(view, pose[style], 'a', false, { ...legs, hidden: true });
        for (const l of [F.legNear, F.legFar]) {
          expect(l.m[0]).toBeGreaterThan(l.a[0]);
          expect(l.b[1]).toBeGreaterThan(l.m[1]);
          expect(l.b[1] + 5 - l.m[1]).toBeCloseTo(2 * legs.drop + (view === 'back' ? -16 : 16) * legs.toe);
        }
      }
    }
  });

  it('rotating a seat never moves the pelvis inside the backrest', async () => {
    const { sitFor } = await import('./seatModels');
    const s: [number, number, number] = [0.5, 0.35, 10];
    for (const f of ['se', 'sw', 'ne', 'nw'] as const) expect(sitFor(m, s, f)).toEqual(s);
  });
});
