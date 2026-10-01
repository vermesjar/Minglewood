import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEAT_LOOKS } from '@shared/world/seatModels';
import { FIG } from '@shared/world/seatFigure';
import { avatarSurfaceDepth } from './avatarSurfaceDepth';
import { renderAvatarLayers } from './avatarQa';

const look = { ...SEAT_LOOKS[0], pet: 'pet.none' };
const legs = { reach: .33, rise: 2.5, drop: 11, toe: .12, hang: 2.5 };
const digest = (value: Uint8Array | Uint8ClampedArray) => createHash('sha256').update(value).digest('hex');

describe('original sealed-pocket depth provenance', () => {
  it('preserves exact original pixels and owners while closing the two proven pink sealed outline holes', () => {
    const fig = renderAvatarLayers(look, 'se', 'sit-floor', legs);
    const depth = avatarSurfaceDepth(look, 'se', 'sit-floor', legs);
    expect(digest(fig.px)).toBe('bc075d59a90e4f2aa59c8d47c594cadc1a4dfb9e291b64fb1e2fce45942fd4b5');
    expect(digest(fig.owner)).toBe('f9c9ee1e19d62e3356c16bca2c6f24167611ee4f4969f494ee8698ff8a43a28b');
    // Source-art coordinates and independent authored surface depths from the
    // rejected v8 diagnostic; no current renderer mask is used as an oracle.
    for (const [x, y, surface] of [[41, 28, 7.678991699218602], [41, 29, 7.296398925781095]]) {
      const i = (y + 75) * FIG.w + x + 17;
      expect(fig.sealed?.[i], `${x},${y} original sealed provenance`).toBe(1);
      expect(depth.method[i]).toBe(8); // sealed pocket lies within the continuous internal stroke
      expect(11 + depth.z[i], `${x},${y} continuous original stroke`).toBeGreaterThan(surface);
      const neighbors = [i - 1, i + 1, i - FIG.w, i + FIG.w];
      expect(depth.z[i]).toBeCloseTo(neighbors.reduce((sum, j) => sum + depth.z[j], 0) / 4, 10);
    }
  });

  it('smooths only original internal strokes and preserves frozen body depths outside the explicitly revised shoe support and outline', () => {
    const fig = renderAvatarLayers(look, 'se', 'sit-floor', legs);
    const depth = avatarSurfaceDepth(look, 'se', 'sit-floor', legs);
    const exterior = createHash('sha256');
    let frozen = 0, internal = 0;
    for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) {
      const i = y * FIG.w + x;
      if (!fig.px[i * 4 + 3]) { expect(Number.isNaN(depth.z[i])).toBe(true); continue; }
      const neighbors = [i - 1, i + 1, i - FIG.w, i + FIG.w];
      const enclosed = fig.owner[i] === 19 && x > 0 && y > 0 && x < FIG.w - 1 && y < FIG.h - 1 &&
        neighbors.every(j => fig.px[j * 4 + 3]);
      if (enclosed) {
        expect(depth.method[i]).toBe(8);
        expect(depth.z[i]).toBeCloseTo(neighbors.reduce((sum, j) => sum + depth.z[j], 0) / 4, 9);
        internal++;
      } else {
        expect(depth.method[i]).not.toBe(8);
        // Shoe enclosure is a separately authored change; retain the prior
        // source baseline for every unrelated original painted/exterior pixel.
        if (fig.owner[i] === 7 || fig.owner[i] === 19) continue;
        const bytes = Buffer.alloc(12); bytes.writeUInt32LE(i); bytes.writeDoubleLE(depth.z[i], 4);
        exterior.update(bytes); frozen++;
      }
    }
    // Frozen before both changes, from the original source-body export.
    // Prior full1611 hash469a768b... and1504 hashd84b4458... included
    // revised shoes/outline; this1335 painted-body subset is derived
    // from that same immutable export, never from the new implementation.
    expect(frozen).toBe(1335);
    expect(exterior.digest('hex')).toBe('089beda2120c204318143dfc99adc4b6d26e1ee423d132fa97c3457054a916e1');
    expect(internal).toBeGreaterThan(0);
    const i = (33 + 75) * FIG.w + 42 + 17;
    expect(fig.sealed?.[i] ?? 0).toBe(0); // the third pixel is an internal stroke, not a sealed pocket
    // Prior v10 depth5.684118875368119 can increase with enclosing ankle support.
    expect(11 + depth.z[i]).toBeGreaterThan(5.587341308593572);
  });

  it('binds each painted shoe to its actual near/far painter and encloses its ankle', () => {
    const fig = renderAvatarLayers(look, 'se', 'sit-floor', legs);
    const depth = avatarSurfaceDepth(look, 'se', 'sit-floor', legs);
    const i = (33 + 75) * FIG.w + 44 + 17;
    expect(fig.owner[i]).toBe(7);
    expect(fig.shoeLimb?.[i]).toBe(2); // actual far shoe, not a nearest-leg heuristic
    expect(11 + depth.z[i]).toBeGreaterThan(5.183923339843571);
    const ids = new Set<number>();
    for (let j = 0; j < fig.owner.length; j++) {
      const limb = fig.shoeLimb?.[j] ?? 0;
      if (fig.owner[j] === 7) { expect([1, 2]).toContain(limb); ids.add(limb); }
      else expect(limb).toBe(0);
    }
    expect([...ids].sort()).toEqual([1, 2]);
  });

  it('distinguishes body-only original hair-pocket fills from actual hair', () => {
    const input = { ...SEAT_LOOKS[2], pet: 'pet.none' };
    const fig = renderAvatarLayers(input, 'se', 'sit-floor', legs);
    const depth = avatarSurfaceDepth(input, 'se', 'sit-floor', legs);
    const i = (34 + 75) * FIG.w + 43 + 17;
    expect(fig.owner[i]).toBe(3); // historical source owner is deliberately unchanged
    expect(fig.bodyPocket?.[i]).toBe(1);
    expect(fig.sealed?.[i] ?? 0).toBe(0);
    expect(depth.method[i]).toBe(9);
    expect(depth.z[i]).toBeCloseTo([i - 1, i + 1, i - FIG.w, i + FIG.w].reduce((sum, j) => sum + depth.z[j], 0) / 4, 10);
    expect(11 + depth.z[i]).toBeGreaterThan(5.010388183593566);
    let genuineHair = 0;
    for (let j = 0; j < fig.owner.length; j++) if (fig.owner[j] === 3 && !fig.bodyPocket?.[j]) {
      expect(depth.method[j]).not.toBe(9); genuineHair++;
    }
    expect(genuineHair).toBeGreaterThan(0);
  });

  it('mirrors exact construction provenance and local interpolated depth', () => {
    const a = renderAvatarLayers(look, 'se', 'sit-floor', legs), b = renderAvatarLayers(look, 'sw', 'sit-floor', legs);
    const da = avatarSurfaceDepth(look, 'se', 'sit-floor', legs), db = avatarSurfaceDepth(look, 'sw', 'sit-floor', legs);
    let count = 0;
    for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) {
      const i = y * FIG.w + x, j = y * FIG.w + FIG.w - 1 - x;
      expect(b.sealed?.[j] ?? 0).toBe(a.sealed?.[i] ?? 0);
      expect(b.shoeLimb?.[j] ?? 0).toBe(a.shoeLimb?.[i] ?? 0);
      expect(b.bodyPocket?.[j] ?? 0).toBe(a.bodyPocket?.[i] ?? 0);
      if (!a.sealed?.[i]) continue;
      expect(db.z[j]).toBeCloseTo(da.z[i], 9);
      count++;
    }
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('does not invent depth or opacity in genuine open gaps between walking legs', () => {
    const fig = renderAvatarLayers(look, 'se', 'walk2');
    const depth = avatarSurfaceDepth(look, 'se', 'walk2');
    let gaps = 0;
    for (let y = 85; y < FIG.feet; y++) for (let x = 1; x < FIG.w - 1; x++) {
      const i = y * FIG.w + x;
      if (fig.px[i * 4 + 3]) continue;
      const left = Array.from({ length: x }, (_, k) => fig.px[(y * FIG.w + k) * 4 + 3]).some(Boolean);
      const right = Array.from({ length: FIG.w - x - 1 }, (_, k) => fig.px[(y * FIG.w + x + k + 1) * 4 + 3]).some(Boolean);
      if (!left || !right) continue;
      expect(fig.sealed?.[i] ?? 0).toBe(0);
      expect(Number.isNaN(depth.z[i])).toBe(true);
      gaps++;
    }
    expect(gaps).toBeGreaterThan(0);
  });
});
