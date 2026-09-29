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

/**
 * How a large piece's drawing meets its footprint diamond (sprite px; + = past the diamond's corner): `dl` / `dr`
 * how far its left / right extremes reach past the side corners, `db` how far its lowest pixel reaches past the
 * front corner. Anchor = the footprint's back vertex.
 */
export function fillOffsets(p: Pixels, ax: number, ay: number, w: number, d: number, scale = 2): { dl: number; dr: number; db: number } | null {
  const s = silhouette(p);
  if (!s) return null;
  const k = 16 * scale;
  return { dl: ax - k * d - s.l, dr: s.r - (ax + k * w), db: s.b - (ay + (k / 2) * (w + d)) };
}

/**
 * THE FILL RULE: a large piece (one that isn't small for its footprint) stands on its footprint. Its base is
 *   filled   it covers the footprint (a couch, a desk, a bench, a cart on its wheels, a ring of stones): its drawing
 *            fills the diamond, or is inset evenly. Its sides reach alike toward the side corners (|dl − dr| ≤ 6
 *            px), overhang them by no more than 6 px (arms, curls), and its lowest pixel is where a base that wide,
 *            centred on the footprint, ends: db = (dl + dr) / 4, within 4 px. Drawn to fill, it ends on the front
 *            corner. (A bench drawn 16 px too high sits its seats on the pavement in front of it: this fails it.)
 *   centred  it stands on one base narrower than the footprint (a pot, a post, a pedestal, a trunk): the bottom of
 *            that base is centred on the footprint's centre, within 6 px.
 * Returns what's wrong (empty = fine).
 */
export function fillProblems(p: Pixels, ax: number, ay: number, w: number, d: number, base: 'filled' | 'centred', scale = 2): string[] {
  const o = fillOffsets(p, ax, ay, w, d, scale);
  const s = silhouette(p);
  if (!o || !s) return [];
  const out: string[] = [];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  if (base === 'filled') {
    if (o.dl > 6) out.push(`overhangs its left corner by ${o.dl} px`);
    if (o.dr > 6) out.push(`overhangs its right corner by ${o.dr} px`);
    if (Math.abs(o.dl - o.dr) > 6) out.push(`sits ${r1(Math.abs(o.dl - o.dr) / 2)} px ${o.dl > o.dr ? 'left' : 'right'} of its footprint (sides ${o.dl} / ${o.dr} px past the corners)`);
    const off = o.db - (o.dl + o.dr) / 4;
    if (Math.abs(off) > 4) out.push(`its base ends ${r1(Math.abs(off))} px ${off < 0 ? 'above' : 'below'} where it should (lowest pixel ${o.db} px past the front corner; drawn ${off < 0 ? 'too high' : 'too low'})`);
    return out;
  }
  // the bottom of a narrow base: its middle, and its centre a quarter of its width above its lowest pixel
  let l = p.w;
  let r = -1;
  for (let y = Math.max(0, s.b - 5); y <= s.b; y++)
    for (let x = 0; x < p.w; x++)
      if (solid(p, x, y)) {
        l = Math.min(l, x);
        r = Math.max(r, x);
      }
  const [cx, cy] = footprintCentre(ax, ay, w, d, scale);
  const dx = (l + r) / 2 - cx;
  if (Math.abs(dx) > 6) out.push(`its base sits ${r1(Math.abs(dx))} px ${dx < 0 ? 'left' : 'right'} of its footprint's centre`);
  if (r - l < (w + d) * 8 * scale) {
    const dy = s.b - (r - l) / 4 - cy;
    if (Math.abs(dy) > 6) out.push(`its base sits ${r1(Math.abs(dy))} px ${dy < 0 ? 'behind' : 'in front of'} its footprint's centre`);
  } else if (o.db > 4) out.push(`its base reaches ${o.db} px past the footprint's front corner`);
  return out;
}

/**
 * The anchor that makes a large piece meet the fill rule (null if it can't be done by moving it: a 'filled' piece
 * wider than its footprint plus the overhang allowance needs redrawing, not moving).
 */
export function fillAnchor(p: Pixels, ax: number, ay: number, w: number, d: number, base: 'filled' | 'centred', scale = 2): [number, number] | null {
  const o = fillOffsets(p, ax, ay, w, d, scale);
  const s = silhouette(p);
  if (!o || !s) return null;
  if (base === 'filled') {
    // moving the anchor right by k moves the footprint right under the drawing: dl + k, dr − k; down by j: db − j
    const k = Math.round((o.dr - o.dl) / 2);
    const dl = o.dl + k;
    const dr = o.dr - k;
    if (dl > 6 || dr > 6) return null;
    return [ax + k, ay + Math.round(o.db - (dl + dr) / 4)];
  }
  let l = p.w;
  let r = -1;
  for (let y = Math.max(0, s.b - 5); y <= s.b; y++)
    for (let x = 0; x < p.w; x++)
      if (solid(p, x, y)) {
        l = Math.min(l, x);
        r = Math.max(r, x);
      }
  const [cx, cy] = footprintCentre(ax, ay, w, d, scale);
  const narrow = r - l < (w + d) * 8 * scale;
  const dx = Math.round((l + r) / 2 - cx);
  const dy = narrow ? Math.round(s.b - (r - l) / 4 - cy) : Math.min(0, Math.round(-(o.db - 4)));
  return [ax + dx, ay + (narrow ? dy : -dy)];
}
