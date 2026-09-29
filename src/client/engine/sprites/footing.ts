/**
 * Footing: where a drawing stands. Pure pixel maths shared by the runtime (art.ts centres small pieces on
 * their footprint) and the furniture review (scripts/furniture-review.ts), so both agree exactly.
 *
 * A piece's base is read from the lower part of its silhouette: its width there is the width of the base
 * diamond, its lowest pixel is the diamond's front corner, so the base centre sits a quarter of that width
 * above it (2:1 isometric). Small pieces — anything well narrower than its footprint: things on a counter,
 * lamps, ornaments — must have this centre on the footprint's centre.
 */
export interface Pixels {
  w: number;
  h: number;
  /** RGBA */
  d: Uint8Array | Uint8ClampedArray;
}

const solid = (p: Pixels, x: number, y: number) => p.d[(y * p.w + x) * 4 + 3] > 0;

export function silhouette(p: Pixels): { l: number; r: number; t: number; b: number } | null {
  let l = p.w;
  let r = -1;
  let t = p.h;
  let b = -1;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (solid(p, x, y)) {
        l = Math.min(l, x);
        r = Math.max(r, x);
        t = Math.min(t, y);
        b = Math.max(b, y);
      }
  return r < 0 ? null : { l, r, t, b };
}

/** The centre of the base (sprite px), read from the lower 30% of the silhouette. */
export function baseCentre(p: Pixels): [number, number] | null {
  const s = silhouette(p);
  if (!s) return null;
  const top = Math.round(s.b - (s.b - s.t) * 0.3);
  let l = p.w;
  let r = -1;
  for (let y = top; y <= s.b; y++)
    for (let x = 0; x < p.w; x++)
      if (solid(p, x, y)) {
        l = Math.min(l, x);
        r = Math.max(r, x);
      }
  return [(l + r) / 2, s.b - (r - l) / 4];
}

/** The footprint's centre in the drawing, given the anchor (the footprint's back vertex) and its size. */
export function footprintCentre(ax: number, ay: number, w: number, d: number, scale = 2): [number, number] {
  return [ax + 8 * scale * (w - d), ay + 4 * scale * (w + d)];
}

/** Whether a piece is SMALL for its footprint (well narrower than it): such pieces are centred on it. */
export function isSmall(p: Pixels, w: number, d: number, scale = 2): boolean {
  const s = silhouette(p);
  return !!s && s.r - s.l < (w + d) * 16 * scale * 0.7;
}

/**
 * The anchor that centres a small piece's base on its footprint (null if it isn't small or has no pixels).
 * Anchor = the footprint's back vertex in the drawing (see art.ts).
 */
export function centredAnchor(p: Pixels, w: number, d: number, scale = 2): [number, number] | null {
  if (!isSmall(p, w, d, scale)) return null;
  const bc = baseCentre(p);
  if (!bc) return null;
  const [cx, cy] = footprintCentre(0, 0, w, d, scale);
  return [Math.round(bc[0] - cx), Math.round(bc[1] - cy)];
}
