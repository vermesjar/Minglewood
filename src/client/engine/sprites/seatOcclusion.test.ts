import { describe, expect, it } from 'vitest';
import { loadManifest } from '../../../../scripts/lib/manifest';
import { readModels, modelView } from '../../../../scripts/lib/models';
import { MODEL_FACINGS, SEAT_LOOKS } from '@shared/world/seatModels';
import { FIG, figAx, hipFeet } from '@shared/world/seatFigure';
import { THIGH_R } from '@shared/world/sitLegs';
import { SIT_POSE_OF } from '@shared/world/seats';
import { seatDepth } from './seatModel';
import { seatLayers, sitterMask } from './seatLayers';
import { renderAvatarLayers } from './avatarQa';
import { LAYER } from './avatarKit';
import type { Pose } from './avatarFrame';
import type { Sprites } from '../../../../scripts/lib/seats';

const catalog = loadManifest().sprites as unknown as Sprites;
const models = readModels();

describe('seating occlusion at the pelvis and open backs', () => {
  it('keeps every catalog sitter above the supporting cushion, including rear-view overlapping shins', () => {
    const cuts: string[] = [];
    let checked = 0;
    for (const [key, model] of Object.entries(models)) for (const facing of MODEL_FACINGS) {
      const v = modelView(catalog, key, facing, model), L = seatLayers(v), D = seatDepth(v);
      for (let c = 0; c < L.hips.length; c++) for (const look of SEAT_LOOKS) {
        const feet = hipFeet(L.hips[c]!, v.style), legs = L.legs[c]!, pose = SIT_POSE_OF[v.style] as Pose;
        const fig = renderAvatarLayers(look, facing, pose, legs), mask = sitterMask(v, look, facing, pose, feet, legs, L.sits[c]![2] + THIGH_R);
        for (let i = 0; i < fig.owner.length; i++) {
          if (fig.owner[i] !== LAYER.pelvis) continue;
          const x = feet[0] - figAx(facing) + i % FIG.w, y = feet[1] - FIG.feet + Math.floor(i / FIG.w);
          if (x < 0 || y < 0 || x >= D.w || y >= D.h) continue;
          const k = D.part[y * D.w + x];
          if (k < 0 || !['seat', 'base'].includes(model.parts[k].part)) continue;
          checked++;
          if (mask[i]) cuts.push(`${key}/${facing}/${c}: pelvis pixel ${i} hidden by ${model.parts[k].part}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(cuts).toEqual([]);
  });

  it('keeps the hips visible above the low curved seat pans reported in the bistro', () => {
    for (const key of ['couch.green', 'armchair.mustard']) for (const facing of ['ne', 'nw'] as const) {
      const v = modelView(catalog, key, facing, models[key]), L = seatLayers(v);
      for (let c = 0; c < L.hips.length; c++) for (const look of SEAT_LOOKS) {
        const feet = hipFeet(L.hips[c]!, v.style), legs = L.legs[c]!, pose = SIT_POSE_OF[v.style] as Pose;
        const fig = renderAvatarLayers(look, facing, pose, legs), mask = sitterMask(v, look, facing, pose, feet, legs, L.sits[c]![2] + THIGH_R);
        const hips = Array.from(fig.owner, (owner, i) => owner === LAYER.pelvis ? i : -1).filter(i => i >= 0);
        expect(hips.filter(i => !mask[i]).length, `${key}/${facing}/${c}`).toBeGreaterThan(hips.length / 2);
      }
    }
  });

  it('keeps foreground armrails over every overlapping part of the seated figure', () => {
    let overlaps = 0;
    for (const [key, model] of Object.entries(models)) for (const facing of MODEL_FACINGS) {
      const v = modelView(catalog, key, facing, model), L = seatLayers(v), D = seatDepth(v);
      for (let c = 0; c < L.hips.length; c++) {
        const feet = hipFeet(L.hips[c]!, v.style), legs = L.legs[c]!, pose = SIT_POSE_OF[v.style] as Pose;
        const fig = renderAvatarLayers(SEAT_LOOKS[0], facing, pose, legs), mask = sitterMask(v, SEAT_LOOKS[0], facing, pose, feet, legs, L.sits[c]![2] + THIGH_R);
        for (let i = 0; i < fig.owner.length; i++) {
          if (![LAYER.pelvis, LAYER.legs, LAYER.shoes].includes(fig.owner[i] as 6 | 7 | 20)) continue;
          const x = feet[0] - figAx(facing) + i % FIG.w, y = feet[1] - FIG.feet + Math.floor(i / FIG.w);
          if (x < 0 || y < 0 || x >= D.w || y >= D.h) continue;
          const k = D.part[y * D.w + x];
          if (k < 0 || model.parts[k].part !== 'arm' || !L.overParts[k]) continue;
          overlaps++;
          expect(mask[i], `${key}/${facing}/${c}/${i}`).toBe(1);
        }
      }
    }
    expect(overlaps).toBeGreaterThan(100);
  });

  it('recognizes the woven cushion through the NW bistro back rather than filling the back opening', () => {
    const v = modelView(catalog, 'chair-bistro.sage', 'nw', models['chair-bistro.sage']);
    const D = seatDepth(v);
    // Golden woven pixels inside the green bentwood frame in the original PNG.
    for (const [x, y] of [[27, 22], [29, 24], [28, 28]]) {
      const i = y * D.w + x;
      expect(v.model.parts[D.part[i]].part).toBe('seat');
      expect(D.z[i]).toBeLessThanOrEqual(v.model.sits[0][2]);
    }
    for (let i = 0; i < D.part.length; i++) if (!v.art.px.d[i * 4 + 3]) {
      expect(D.part[i]).toBe(-1);
      expect(Number.isNaN(D.z[i])).toBe(true);
    }
  });

  it('never extends a fitted part above or below its physical height bounds', () => {
    const bad: string[] = [];
    for (const [key, model] of Object.entries(models)) for (const facing of MODEL_FACINGS) {
      const D = seatDepth(modelView(catalog, key, facing, model));
      for (let i = 0; i < D.part.length; i++) if (D.part[i] >= 0) {
        const [lo, hi] = model.parts[D.part[i]].z;
        if (D.z[i] < lo - 1e-8 || D.z[i] > hi + 1e-8) bad.push(`${key}/${facing}/${i}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
