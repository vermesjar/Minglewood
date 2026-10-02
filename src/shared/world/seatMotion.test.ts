import { describe, expect, it } from 'vitest';
import { CROUCH_UNTIL, SIT_DROP, seatSupportExit, seatSupportProximity, seatSupportLift, seatSupportContains, sitMotion, sitThigh, type SitStyle } from './seats';
import { localToWorld, worldToLocal, type ModelPart } from './seatModels';
import type { Facing } from './scene';

const support: ModelPart[] = [{ part: 'seat', u: [0.1, 1.9], v: [0.05, 0.85], z: [7, 11.3] }];
const underside = (k: number, down: boolean, height: number, style: SitStyle, proximity: number) => {
  const motion = sitMotion(k, down, height - sitThigh(style), style, proximity);
  return motion.lift + (104 - 82 - 3 - (motion.inSeat ? SIT_DROP[style] : 3)) / 2;
};

describe('seat contact trajectory', () => {
  for (const style of ['chair', 'stool', 'lounge', 'floor'] as SitStyle[]) {
    it(`${style}: preserves resting height and clears support throughout both directions`, () => {
      for (const height of [2, 9, 11.3, 18, 24]) {
        for (const down of [false, true]) {
          expect(underside(1, down, height, style, 1)).toBeCloseTo(height, 9);
          expect(underside(0, down, height, style, 0)).toBeCloseTo(8, 9);
          for (let i = 0; i <= 1000; i++) expect(underside(i / 1000, down, height, style, 1)).toBeGreaterThanOrEqual(height - 1e-9);
          expect(underside(CROUCH_UNTIL - 1e-8, down, height, style, 1))
            .toBeCloseTo(underside(CROUCH_UNTIL, down, height, style, 1), 6);
        }
      }
    });
  }

  it('expands support for the whole pelvis and raises before contact, including sides', () => {
    expect(seatSupportProximity(support, 1, -0.25)).toBe(1);
    expect(seatSupportProximity(support, -0.2, 0.4)).toBe(1);
    expect(seatSupportProximity(support, 1, -0.4)).toBeGreaterThan(0);
    expect(seatSupportProximity(support, 1, -0.6)).toBe(0);
  });

  it('leaves the whole support before lowering on every exit side', () => {
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) {
      const distance = seatSupportExit(support, 0.65, 0.42, du, dv);
      expect(seatSupportProximity(support, 0.65 + distance * du, 0.42 + distance * dv, 0)).toBe(0);
      expect(seatSupportLift(support, 0.65 + distance * du, 0.42 + distance * dv, 0)).toBe(-Infinity);
    }
  });

  it('does not overshoot a clear adjacent floor tile or a wide bench diagonal exit', () => {
    const full: ModelPart = { part: 'seat', u: [0, 1], v: [0, 1], z: [9.3, 11.3] };
    expect(seatSupportExit([full], 0.5, 0.5, 0, -1)).toBeLessThan(1);
    expect(seatSupportExit([{ ...full, u: [0, 10] }], 5, 0.5, 1, -1)).toBeLessThan(1);
  });

  it('clears the height of an intersected raised neighbouring cushion', () => {
    const raised: ModelPart = { part: 'seat', u: [1, 2], v: [0, 1], z: [16, 18] };
    const minimum = seatSupportLift([...support, raised], 0.95, 0.5, 0.2);
    const motion = sitMotion(0.2, true, 11.3 - sitThigh('chair'), 'chair', 0, minimum);
    expect(motion.lift + 8).toBeGreaterThanOrEqual(18);
  });

  it('waits for actual cushion arrival to sit, preserving pelvis height through the pose change', () => {
    expect(seatSupportContains(support, 1, -0.1)).toBe(false);
    expect(seatSupportContains(support, 1, 0.2)).toBe(true);
    const before = sitMotion(0.8, true, 4.8, 'chair', 0, -Infinity, false);
    const after = sitMotion(0.8, true, 4.8, 'chair', 0, -Infinity, true);
    expect(before.inSeat).toBe(false);
    expect(after.inSeat).toBe(true);
    expect(before.lift + 8).toBeCloseTo(after.lift + sitThigh('chair'), 10);
  });

  it('uses the same contact geometry after all four facing rotations', () => {
    for (const facing of ['se', 'sw', 'ne', 'nw'] as Facing[]) {
      for (const [u, v] of [[1, -0.25], [-0.2, 0.4], [1, -0.4], [2.5, 0.4]]) {
        const world = localToWorld([2, 1], facing, u, v);
        const local = worldToLocal([2, 1], facing, world.x, world.y);
        expect(seatSupportProximity(support, local.u, local.v)).toBeCloseTo(seatSupportProximity(support, u, v), 10);
      }
    }
  });
});
