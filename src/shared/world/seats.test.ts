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
    expect([...SEAT_FIELDS]).toEqual(['seat', 'sitStyle', 'backrest', 'arms']);
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

describe('the seat framework (seat specs, models, legs)', () => {
  it('builds every kind with its sitting point on the cushion, knees past the front and the feet on the floor or footrest', async () => {
    const { buildSeat, buildProblems, KIND_DEFAULTS, SEAT_KINDS, KNEE_OUT } = await import('./seatSpec');
    const { legsFor, kneeV, soleZ } = await import('./sitLegs');
    const { cushionTop, frontEdge } = await import('./seatModels');
    for (const kind of SEAT_KINDS) {
      const b = buildSeat({ key: `test.${kind}`, name: kind, kind, rooms: ['lounge'], mat: { fabric: { base: '#3f9a6b', kind: 'fabric' }, frame: { base: '#a0683f', kind: 'wood' } } });
      expect(buildProblems(b), kind).toEqual([]);
      expect(b.model.sits.length, kind).toBe(KIND_DEFAULTS[kind].size[0]);
      for (const sit of b.model.sits) {
        expect(cushionTop(b.model, sit[0], sit[1]), kind).toBe(sit[2]);
        const legs = legsFor(b.model, sit, b.style);
        expect(kneeV(sit, legs), kind).toBeLessThanOrEqual(frontEdge(b.model, sit[0]) - KNEE_OUT + 1e-9);
        expect(soleZ(sit, legs), kind).toBeCloseTo(b.rest ?? 0, 5);
      }
    }
  });

  it('keeps every catalog seat well-formed and sized to its footprint', async () => {
    const { SEAT_SPECS, seatBuildOf } = await import('../art/seatCatalog');
    const { buildProblems } = await import('./seatSpec');
    const { modelShapeProblems } = await import('./seatModels');
    expect(SEAT_SPECS.length).toBeGreaterThan(20);
    for (const spec of SEAT_SPECS) {
      const b = seatBuildOf(spec.key)!;
      expect(buildProblems(b), spec.key).toEqual([]);
      expect(modelShapeProblems(b.model, b.size[0] * b.size[1]), spec.key).toEqual([]);
      for (const p of b.model.parts) {
        expect(p.u[0], spec.key).toBeGreaterThanOrEqual(-0.1);
        expect(p.u[1], spec.key).toBeLessThanOrEqual(b.size[0] + 0.1);
        expect(p.v[0], spec.key).toBeGreaterThanOrEqual(-0.1);
        expect(p.v[1], spec.key).toBeLessThanOrEqual(b.size[1] + 0.1);
      }
    }
  });

  it('lays the legs from the seat: knees just past its front, shins to the floor when they reach it, else to the footrest', async () => {
    const { legsFor, kneeV, KNEE_OUT, SHIN_MAX, THIGH_R } = await import('./sitLegs');
    const low: SeatModel = { size: [1, 1], parts: [{ part: 'seat', u: [0.1, 0.9], v: [0.05, 0.95], z: [3, 8] }], sits: [[0.5, 0.35, 8]] };
    const legs = legsFor(low, low.sits[0], 'chair');
    expect(kneeV(low.sits[0], legs)).toBeCloseTo(0.05 - KNEE_OUT);
    expect(legs.drop).toBeCloseTo(8 + THIGH_R);
    // a bar stool with a footring: the shins come down onto the ring
    const stool: SeatModel = { size: [1, 1], parts: [{ part: 'seat', u: [0.3, 0.7], v: [0.3, 0.7], z: [13, 15] }], sits: [[0.5, 0.55, 15]], rest: 5.5 };
    const sl = legsFor(stool, stool.sits[0], 'stool');
    expect(sl.drop).toBeCloseTo(15 + THIGH_R - 1.5 - 5.5);
    expect(sl.hang).toBe(0);
    expect(sl.rest).toBe(5.5);
    // too high for any shin: the feet hang
    const high: SeatModel = { ...stool, parts: [{ part: 'seat', u: [0.3, 0.7], v: [0.3, 0.7], z: [20, 22] }], sits: [[0.5, 0.5, 22]], rest: undefined };
    expect(legsFor(high, high.sits[0], 'stool').drop).toBe(SHIN_MAX);
  });

  it('draws the legs from behind out along the seat and down beyond it, for the seat to hide what it stands in front of', async () => {
    const { frameFor } = await import('../../client/engine/sprites/avatarFrame');
    const legs = { reach: 0.3, rise: 0, drop: 10, toe: 0.03, hang: 0 };
    const back = frameFor('back', 'sit', 'a', false, legs);
    const front = frameFor('front', 'sit', 'a', false, legs);
    // the thigh runs away from us (up the screen) from behind and toward us (down) from the front, the same length
    expect(back.legNear.m[0] - back.legNear.a[0]).toBeCloseTo(front.legNear.m[0] - front.legNear.a[0]);
    expect(back.legNear.m[1] - back.legNear.a[1]).toBeCloseTo(-(front.legNear.m[1] - front.legNear.a[1]));
    // the shins drop the same from the knees in both views (the toe leans the other way: a px)
    expect(Math.abs(back.legNear.b[1] - back.legNear.m[1] - (front.legNear.b[1] - front.legNear.m[1]))).toBeLessThan(1.5);
  });

  it('composes a sitter against the seat by depth: on the cushion from the front, behind the back from behind', async () => {
    const { buildSeat } = await import('./seatSpec');
    const { renderSeat } = await import('../art/seatRender');
    const { overMask } = await import('../art/seatCompose');
    const { legsFor } = await import('./sitLegs');
    const { renderAvatarLayers } = await import('../../client/engine/sprites/avatarQa');
    const { SEAT_LOOKS } = await import('./seatModels');
    const spec = { key: 'test.armchair', name: 'test', kind: 'armchair' as const, rooms: ['lounge' as const], mat: { fabric: { base: '#3f9a6b', kind: 'fabric' as const }, frame: { base: '#a0683f', kind: 'wood' as const } } };
    const b = buildSeat(spec);
    const sit = b.model.sits[0];
    const legs = legsFor(b.model, sit, b.style);
    const front = overMask(renderSeat(b.model, spec.mat, 'se'), b.model, sit, legs, b.style, renderAvatarLayers(SEAT_LOOKS[0], 'se', 'sit-lounge', legs));
    const behind = overMask(renderSeat(b.model, spec.mat, 'ne'), b.model, sit, legs, b.style, renderAvatarLayers(SEAT_LOOKS[0], 'ne', 'sit-lounge', legs));
    // from the front only the near arm is over them: a small part; from behind the back hides most of the body
    expect(front.covered / front.total).toBeGreaterThan(0.02);
    expect(front.covered / front.total).toBeLessThan(0.25);
    expect(behind.covered / behind.total).toBeGreaterThan(0.35);
    expect(behind.covered / behind.total).toBeLessThan(0.85);
  });
});
