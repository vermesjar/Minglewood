import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEAT_LOOKS } from '@shared/world/seatModels';
import { FIG } from '@shared/world/seatFigure';
import { NATURAL_LEGS } from '@shared/world/sitLegs';
import { SIT_POSE_OF } from '@shared/world/seats';
import { avatarSurfaceDepth, sourcePaintGradient, sourceSurfaceRoots } from './avatarSurfaceDepth';
import { renderAvatarLayers } from './avatarQa';
import { LAYER } from './avatarKit';
import type { Pose } from './avatarFrame';

const looks = [...SEAT_LOOKS, JSON.parse(readFileSync('tests/fixtures/seating-cardigan.json', 'utf8'))]
  .map(look => ({ ...look, pet: 'pet.none' }));

describe('original surface tangent arithmetic', () => {
  it('retains authored tangencies despite negative floating point cancellation', () => {
    expect(sourceSurfaceRoots(3.0000000000000004, -95.40000000000002, 758.4300000000003))
      .toEqual([15.9, 15.9]);
    const shoe = sourceSurfaceRoots(.8554562320796089, -5.817102378141341, 9.889074042840281);
    expect(shoe).toHaveLength(2);
    expect(shoe[0]).toBeCloseTo(3.4, 12);
    expect(shoe[1]).toBe(shoe[0]);
  });
  it('rejects genuine misses across coefficient scales and preserves positive roots exactly', () => {
    for (const scale of [1e-6, 1, 1e6, 1e60]) {
      for (const miss of [1e-10, 1e-6, 1, 100])
        expect(sourceSurfaceRoots(scale, -2 * scale, (1 + miss) * scale)).toEqual([]);
      const a = scale, b = -3 * scale, c = 2 * scale, d = b * b - 4 * a * c;
      expect(sourceSurfaceRoots(a, b, c)).toEqual([(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)]);
    }
  });
});

describe('authored original-avatar surfaces', () => {
  it('keeps mirrored body depths identical for every review outfit and sitting style', () => {
    let checked = 0;
    for (const look of looks) for (const style of ['chair', 'lounge', 'floor', 'stool'] as const) {
      const pose = SIT_POSE_OF[style] as Pose, legs = NATURAL_LEGS[style];
      for (const [a, b] of [['se', 'sw'], ['ne', 'nw']] as const) {
        const original = renderAvatarLayers(look, a, pose, legs);
        const left = avatarSurfaceDepth(look, a, pose, legs), right = avatarSurfaceDepth(look, b, pose, legs);
        for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) {
          const i = y * FIG.w + x, j = y * FIG.w + FIG.w - 1 - x;
          if (!original.px[i * 4 + 3]) continue;
          expect(Number.isFinite(left.z[i]), `${style}/${a}/${x},${y} original owner ${original.owner[i]}`).toBe(true);
          expect(right.z[j], `${style}/${a}/${x},${y}`).toBeCloseTo(left.z[i], 7);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20000);
  });

  it('transports the source shin gradient instead of copying an upper pixel height into floating outline', () => {
    const legs = { reach: .33, rise: 2.5, drop: 11, toe: .12, hang: 2.5 };
    const fig = renderAvatarLayers(looks[0], 'se', 'sit-floor', legs);
    const depth = avatarSurfaceDepth(looks[0], 'se', 'sit-floor', legs);
    const i = (29 + 75) * FIG.w + 34 + 17;
    expect(fig.owner[i]).toBe(LAYER.outline);
    expect(fig.owner[i - FIG.w]).toBe(LAYER.legs);
    // V11 incorrectly copied the upper painted pixel's absolute8.308 height.
    // The actual isolated pink island was rejected in all four front looks.
    expect(depth.z[i]).toBeLessThan(depth.z[i - FIG.w] - .1);
    expect(11 + depth.z[i]).toBeLessThan(8.205456542968609);
    expect(Number.isFinite(depth.z[i])).toBe(true);
  });
});


describe('bounded original-paint gradient', () => {
  function fixture(points: Array<[number, number, number]>) {
    const owner = new Uint8Array(49), rgba = new Uint8Array(196), depth = new Float64Array(49).fill(NaN), sealed = new Uint8Array(49);
    for (const [x, y, z] of points) { const i = y * 7 + x; owner[i] = 6; rgba[i * 4 + 3] = 255; depth[i] = z; }
    return { owner, rgba, depth, sealed, fit: () => sourcePaintGradient(7, 7, 3, 3, owner, rgba, depth, sealed) };
  }
  it('transports the donor plane without borrowing a disconnected same-owner limb', () => {
    const f = fixture([[3,3,10],[2,3,8],[3,2,11],[2,2,9], [5,3,100],[5,2,-100],[5,4,300]]);
    expect(f.fit()).toEqual([2, -1]);
    // A diagonal-only touch still does not connect two painted regions.
    f.owner[4 * 7 + 4] = 6; f.rgba[(4 * 7 + 4) * 4 + 3] = 255; f.depth[4 * 7 + 4] = 200;
    expect(f.fit()).toEqual([2, -1]);
  });
  it('rejects a connected depth discontinuity and a rank-deficient stroke', () => {
    expect(fixture([[3,3,0],[2,3,0],[3,2,0],[2,2,10]]).fit()).toBeNull();
    expect(fixture([[2,3,8],[3,3,10],[4,3,12]]).fit()).toBeNull();
  });
  it('excludes original filled pockets from plane fitting and connectivity', () => {
    const f = fixture([[3,3,10],[2,3,8],[3,2,11],[2,2,9],[4,3,200],[5,3,100]]);
    f.sealed[3 * 7 + 4] = 1;
    expect(f.fit()).toEqual([2, -1]);
    f.sealed[3 * 7 + 3] = 1;
    expect(f.fit()).toBeNull();
  });
});
