import { describe, expect, it } from 'vitest';
import { frontMask } from '@shared/world/seatRigs';
import { maskToPolys, traceMask } from './rigTrace';

/** A deterministic pseudo-random mask with blobs, holes and pinches. */
function mask(w: number, h: number, seed: number, p: number): Uint8Array {
  let s = seed;
  const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = r() < p ? 1 : 0;
  return m;
}

describe('rig polygons from pixel masks', () => {
  it('traces any mask exactly, holes and diagonal pinches included', () => {
    for (let k = 0; k < 40; k++) {
      const w = 7 + (k % 13);
      const h = 5 + (k % 11);
      const m = mask(w, h, 1000 + k, 0.35 + (k % 5) * 0.1);
      expect([...frontMask(w, h, maskToPolys(m, w, h))]).toEqual([...m]);
    }
  });

  it('keeps a ring’s hole out of it', () => {
    const w = 5;
    const m = new Uint8Array(25).fill(1);
    m[12] = 0;
    const back = frontMask(w, 5, maskToPolys(m, w, 5));
    expect(back[12]).toBe(0);
    expect(back.reduce((a, b) => a + b, 0)).toBe(24);
  });

  it('simplifies a blob to a few points for hand editing', () => {
    const w = 20;
    const m = new Uint8Array(w * 10);
    for (let y = 2; y < 8; y++) for (let x = 3; x < 17; x++) m[y * w + x] = 1;
    const [poly] = traceMask(m, w, 10);
    expect(poly.length).toBeLessThanOrEqual(6);
    expect(frontMask(w, 10, [poly]).reduce((a, b) => a + b, 0)).toBe(14 * 6);
  });
});
