import { describe, expect, it } from 'vitest';
import { MODEL_FACINGS, SEAT_LOOKS, rayThrough, type SeatModel, type SeatSurfaceMap } from '@shared/world/seatModels';
import { authoredGeometrySignature, rolledRimHeight, type RolledRimProfile } from '@shared/world/seatSurfaceAuthored';
import { drawingPrint, FIG, figAx } from '@shared/world/seatFigure';
import { NATURAL_LEGS } from '@shared/world/sitLegs';
import type { Facing } from '@shared/world/scene';
import { seatDepth, type ModelView } from './seatModel';
import { attachSeatSurfaces } from './seatCompiler';
import { cleanSeatModel } from '../../../server/routes/devLab';
import { formatModels } from '../../../../scripts/lib/models';
import { avatarSurfaceDepth } from './avatarSurfaceDepth';
import { renderAvatarLayers } from './avatarQa';
import { sitterMask } from './seatLayers';

const profile: RolledRimProfile = { cu: .5, cv: .5, ru: .55, rv: .58, seat: 10, rise: 6,
  posterior: .35, rim: .45, width: .18, contact_u: .5, contact_v: .35, skirt: 3 };

function intersection(facing: Facing, x: number, y: number): number | null {
  const r = rayThrough([24, 16], [1, 1], facing, x + .5, y + .5);
  const inside = (z: number) => {
    const u = r.u0 + r.du * z, v = r.v0 + r.dv * z;
    return ((u - profile.cu) / profile.ru) ** 2 + ((v - profile.cv) / profile.rv) ** 2 <= 1 && z <= rolledRimHeight(profile, u, v);
  };
  for (let z = 20; z >= 0; z -= .1) {
    if (!inside(z)) continue;
    let lo = z, hi = z + .1;
    for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (inside(mid)) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  return null;
}

function fixture(): { model: SeatModel; views: ModelView[] } {
  const model: SeatModel = { size: [1, 1], parts: [{ part: 'seat', u: [0, 1], v: [0, 1], z: [0, 10] }], sits: [[.5, .35, 10]] };
  const views = MODEL_FACINGS.map(facing => {
    const w = 48, h = 48, d = new Uint8Array(w * h * 4), z: Array<number | null> = [], correspondence: Array<[number, number]> = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const depth = intersection(facing, x, y); z.push(depth); correspondence.push([x, y]);
      if (depth !== null) d.set([110, 70, 160, 255], (y * w + x) * 4);
    }
    const map: SeatSurfaceMap = { version: 2, width: w, height: h, drawing: drawingPrint(w, h, d), modelParts: JSON.stringify(model.parts),
      labels: z.map(v => v === null ? 0 : 1), authored: { kind: 'rolled-rim', provenance: 'authored-intent', identity: 'authored-profile', profile: structuredClone(profile),
        geometry: authoredGeometrySignature(model), anchor: [24, 16], style: 'floor', generatorSha256: 'a'.repeat(64), sourceInputsSha256: 'b'.repeat(64), z, correspondence } };
    (model.surfaces ??= {})[facing] = map;
    return { model, style: 'floor' as const, facing, art: { px: { w, h, d }, ax: 24, ay: 16 } };
  });
  return { model, views };
}

describe('authored curved source depth', () => {
  it('recomputes warmed masks across a real depth threshold inside the same hundredth-height bucket', () => {
    const view = fixture().views[0], look = { ...SEAT_LOOKS[0], pet: 'pet.none' }, legs = NATURAL_LEGS.floor;
    const feet: [number, number] = [24, 30], depth = seatDepth(view);
    const body = avatarSurfaceDepth(look, 'se', 'sit-floor', legs), fig = renderAvatarLayers(look, 'se', 'sit-floor', legs);
    let counterexample: { index: number; below: number; above: number } | undefined;
    for (let y = 0; y < depth.h && !counterexample; y++) for (let x = 0; x < depth.w; x++) {
      const X = x - feet[0] + figAx('se'), Y = y - feet[1] + FIG.feet;
      if (X < 0 || Y < 0 || X >= FIG.w || Y >= FIG.h || !view.art.px.d[(y * depth.w + x) * 4 + 3]) continue;
      const index = Y * FIG.w + X, threshold = depth.z[y * depth.w + x] - body.z[index];
      if (!fig.px[index * 4 + 3] || !Number.isFinite(threshold) || threshold < 0 || threshold > 24) continue;
      const below = threshold - .000001, above = threshold + .000001;
      if (below.toFixed(2) === above.toFixed(2)) { counterexample = { index, below, above }; break; }
    }
    expect(counterexample).toBeDefined();
    const { index, below, above } = counterexample!;
    const first = sitterMask(view, look, 'se', 'sit-floor', feet, legs, below);
    const second = sitterMask(view, look, 'se', 'sit-floor', feet, legs, above);
    expect(first[index]).toBe(1);
    expect(second[index]).toBe(0);
    expect(second).not.toBe(first);
    expect(sitterMask(view, look, 'se', 'sit-floor', feet, legs, below)).toBe(first);
  });

  it('uses curved heights directly rather than clamping them to proxy part tops', () => {
    const { views } = fixture();
    for (const view of views) {
      const depth = seatDepth(view), map = view.model.surfaces![view.facing]!;
      expect(depth.source).toBe('authored');
      expect([...depth.z].some(z => z > 10.5)).toBe(true);
      if (map.version !== 2) throw new Error('fixture');
      for (let i = 0; i < map.labels.length; i++)
        if (map.labels[i]) { expect(depth.z[i]).toBe(map.authored.z[i]); expect(depth.how[i]).toBe(4); }
    }
  });

  it('survives compiler attachment, worker clone, server cleaning, and model serialization exactly', () => {
    const { model, views } = fixture();
    const attached = attachSeatSurfaces(model, structuredClone({ surfaces: model.surfaces, views, style: 'floor' }));
    const cleaned = cleanSeatModel({ model: attached, for: 'source' })!.model;
    const serialized = JSON.parse(formatModels({ generated: cleaned })).generated;
    expect(serialized.surfaces).toEqual(model.surfaces);
    expect(seatDepth({ ...views[0], model: serialized }).source).toBe('authored');
    expect(() => attachSeatSurfaces(model, { surfaces: model.surfaces, views: views.slice(0, 2), style: 'floor' })).toThrow(/all four final source/);
  });

  it('rejects missing views, old anchors, moved contacts, and off-surface depth', () => {
    const f = fixture(), view = f.views[0];
    const test = (mutate: (v: ModelView) => void, message: RegExp) => {
      const copy = structuredClone(view); mutate(copy); expect(() => seatDepth(copy)).toThrow(message);
    };
    test(v => { delete v.model.surfaces!.nw; }, /all four explicit/);
    test(v => { v.art.ax++; }, /anchor|stale/);
    test(v => { v.model.sits[0][2]++; }, /stale authored|contact/);
    test(v => { const m = v.model.surfaces!.se!; if (m.version === 2) m.authored.z[m.labels.findIndex(x => x > 0)]! += 1; }, /bound curved solid/);
  });

  it('does not return warmed depth when a valid authored correspondence changes', () => {
    const { views } = fixture(), view = views[0], before = seatDepth(view), map = view.model.surfaces!.se!;
    if (map.version !== 2) throw new Error('fixture');
    const index = map.labels.findIndex((label, i) => label > 0 && i % 48 > 18 && i % 48 < 30 && Math.floor(i / 48) > 20);
    expect(index).toBeGreaterThan(0);
    const x = index % 48, y = Math.floor(index / 48), next = intersection('se', x + .01, y);
    expect(next).not.toBeNull(); map.authored.correspondence[index][0] += .01; map.authored.z[index] = next;
    const after = seatDepth(view);
    expect(after).not.toBe(before); expect(after.z[index]).toBe(next);
    map.authored.z[index]! += 1;
    expect(() => seatDepth(view)).toThrow(/bound curved solid/);
  });

  it('rejects nullable-depth JSON collisions after structural and renderer caches are warm', () => {
    const { views } = fixture(), view = views[0], map = view.model.surfaces!.se!;
    if (map.version !== 2) throw new Error('fixture');
    seatDepth(view);
    map.authored.z[map.labels.findIndex(label => label === 0)] = NaN;
    expect(() => seatDepth(view)).toThrow(/non-finite/);
  });
});
