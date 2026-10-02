import { describe, expect, it } from 'vitest';
import { seatSupportLift, seatSupportProximity, sitMotion, sitThigh } from './seats';
import type { ModelPart } from './seatModels';

const steppedSupport: ModelPart[] = [
  { part: 'seat', u: [0, 1], v: [0, 1], z: [9.3, 11.3] },
  { part: 'seat', u: [1, 2], v: [0, 1], z: [22, 24] },
];

describe('adversarial support-height transitions', () => {
  it('does not raise a resting sitter for a nearby taller cushion outside the pelvis footprint', () => {
    // The pelvis at u=.5 ends at .8125, leaving a real gap before the raised cushion at u=1.
    // An anticipation band may help during travel, but cannot change this valid resting contact.
    const lift = 11.3 - sitThigh('chair');
    const actual = sitMotion(1, true, lift, 'chair', seatSupportProximity(steppedSupport, .5, .5),
      seatSupportLift(steppedSupport, .5, .5, 1), true);
    expect(actual.inSeat).toBe(true);
    expect(actual.lift).toBeCloseTo(lift, 10);
  });

  it('still retains the higher plane when the pelvis really intersects it at the resting point', () => {
    // This placement must subsequently be rejected/refitted by the authoring gate. A transient easing
    // change must not silently permit penetration just to preserve the lower selected-cushion height.
    expect(seatSupportLift(steppedSupport, .9, .5, 1)).toBeCloseTo(24 - 8, 10);
  });
});
