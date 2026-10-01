/**
 * Pixel toolkit for avatar parts: an RGBA buffer with stamping, boolean masks built from shapes, painting
 * with the part line and two flat tones, and the selective outline around the whole figure.
 */
export const W = 88;
/** The figure canvas: 16 rows below the standing feet line (104) leave room for a sitter's feet let down to the floor. */
export const H = 128;

/* ================================================================== color */

export type RGB = [number, number, number];
export const PLUM: RGB = [42, 29, 51];
export const CREAM: RGB = [255, 246, 226];
export const WHITE: RGB = [255, 250, 240];
export const GOLD: RGB = [242, 193, 78];
export const GOLD_D: RGB = [168, 102, 26];
export const PINK: RGB = [255, 143, 193];

export function hx(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shadowOf = (c: RGB) => mix(c, PLUM, 0.3);
export const lightOf = (c: RGB) => mix(c, CREAM, 0.28);
export const deepOf = (c: RGB) => mix(c, PLUM, 0.52);
export const lum = (c: RGB) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;

/* ================================================================== pixels & shapes */

export interface LowerGarmentSource {
  version: 1;
  vertices: Array<{point:[number,number];anchor:'waist'|'hip'|'nearKnee'|'farKnee';drop:number}>;
  triangles: Array<[number,number,number]>;
  mask: Uint8Array;
}

export class Pix {
  readonly d = new Uint8ClampedArray(W * H * 4);
  /** Which part painted each pixel (a Layer id), for QA: what covers what. */
  readonly owner = new Uint8Array(W * H);
  /** Original concave pockets deliberately painted by sealPinholes; never inferred from a seat mask. */
  sealed?: Uint8Array;
  /** Exact original shoe painter: 1 near, 2 far; zero for all other paint. */
  shoeLimb?: Uint8Array;
  shoeLimbActive = 0;
  /** Original sealHairPockets fills with no hair/hat boundary, distinct from real hair. */
  bodyPocket?: Uint8Array;
  /** Exact original lower-garment painter domain and authored drape anchors. */
  lowerGarment?: LowerGarmentSource;
  /** The part currently being drawn. */
  layer = 0;
  set(x: number, y: number, c: RGB, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    this.owner[y * W + x] = this.layer;
    if (this.shoeLimbActive) this.shoeLimb ??= new Uint8Array(W * H);
    if (this.shoeLimb) this.shoeLimb[y * W + x] = this.shoeLimbActive;
    const i = (y * W + x) * 4;
    if (a < 255 && this.d[i + 3] > 0) {
      const k = a / 255;
      this.d[i] = this.d[i] + (c[0] - this.d[i]) * k;
      this.d[i + 1] = this.d[i + 1] + (c[1] - this.d[i + 1]) * k;
      this.d[i + 2] = this.d[i + 2] + (c[2] - this.d[i + 2]) * k;
      return;
    }
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
    this.d[i + 3] = a;
  }
  get(x: number, y: number): RGB | null {
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const i = (y * W + x) * 4;
    return this.d[i + 3] ? [this.d[i], this.d[i + 1], this.d[i + 2]] : null;
  }
  /** Stamp a tiny pixel map; '.' is transparent. */
  stamp(x0: number, y0: number, rows: string[], pal: Record<string, RGB>) {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const c = pal[row[dx]];
        if (c) this.set(x0 + dx, y0 + dy, c);
      }
    });
  }
}

export class Mask {
  readonly m = new Uint8Array(W * H);
  private fill(x0: number, y0: number, x1: number, y1: number, inside: (x: number, y: number) => boolean, v = 1) {
    const a = Math.max(0, Math.floor(x0));
    const b = Math.min(W - 1, Math.ceil(x1));
    const c = Math.max(0, Math.floor(y0));
    const e = Math.min(H - 1, Math.ceil(y1));
    for (let y = c; y <= e; y++) for (let x = a; x <= b; x++) if (inside(x + 0.5, y + 0.5)) this.m[y * W + x] = v;
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, v = 1) {
    return this.fill(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, v);
  }
  rect(x0: number, y0: number, x1: number, y1: number, v = 1) {
    return this.fill(x0, y0, x1, y1, (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1, v);
  }
  rrect(x0: number, y0: number, x1: number, y1: number, r: number, v = 1) {
    return this.fill(x0, y0, x1, y1, (x, y) => {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
      const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
      const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
      return dx * dx + dy * dy <= r * r;
    }, v);
  }
  capsule(ax: number, ay: number, bx: number, by: number, r: number, v = 1) {
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy || 1;
    return this.fill(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
      const dx = x - (ax + vx * t);
      const dy = y - (ay + vy * t);
      return dx * dx + dy * dy <= r * r;
    }, v);
  }
  poly(pts: Array<[number, number]>, v = 1) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return this.fill(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }, v);
  }
  cut(o: Mask) {
    for (let i = 0; i < this.m.length; i++) if (o.m[i]) this.m[i] = 0;
    return this;
  }
  keep(o: Mask) {
    for (let i = 0; i < this.m.length; i++) if (!o.m[i]) this.m[i] = 0;
    return this;
  }
  add(o: Mask) {
    for (let i = 0; i < this.m.length; i++) if (o.m[i]) this.m[i] = 1;
    return this;
  }
  /** Keep only rows in [y0, y1). */
  band(y0: number, y1: number) {
    for (let y = 0; y < H; y++) if (y < y0 || y >= y1) this.m.fill(0, y * W, y * W + W);
    return this;
  }
  has(x: number, y: number) {
    return x >= 0 && y >= 0 && x < W && y < H && this.m[y * W + x] === 1;
  }
  bbox(): [number, number, number, number] | null {
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (this.m[y * W + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : [x0, y0, x1, y1];
  }
}
export const M = () => new Mask();

export interface PaintOpts {
  /** Shift of the shadow line: positive = more shadow. */
  shade?: number;
  rim?: boolean;
  /** Draw the part's near-black outline (default). false for inner details that shouldn't be lined. */
  edge?: boolean;
  /** No broad shading (small or flat things). */
  flat?: boolean;
  /** A small highlight toward the light on rounded parts (heads, hair). */
  shine?: boolean;
}

/** The line colour: near-black with a hint of plum, like classic social-game avatars. */
export const LINE: RGB = [21, 13, 18];
/**
 * A part's own edge: a dark copy of its colour rather than flat black, so hair, skin and cloth keep their
 * hue at the seams (the whole figure still gets a near-black selective outline around it).
 */
export const lineOf = (c: RGB): RGB => mix(c, LINE, 0.74);

/** Paint a mask with 3-tone shading, a lit upper-left rim and a darker lower-right edge. */
export function paint(P: Pix, m: Mask, color: RGB | ((x: number, y: number) => RGB), o: PaintOpts = {}) {
  const b = m.bbox();
  if (!b) return;
  const [x0, y0, x1, y1] = b;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = Math.max(1, (x1 - x0) / 2);
  const hh = Math.max(1, (y1 - y0) / 2);
  const bias = o.shade ?? 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!m.has(x, y)) continue;
      const base = typeof color === 'function' ? color(x, y) : color;
      const t = ((x - cx) / hw) * 0.92 + ((y - cy) / hh) * 0.12;
      let c = base;
      const boundary = !m.has(x + 1, y) || !m.has(x, y + 1) || !m.has(x - 1, y) || !m.has(x, y - 1);
      if (o.edge !== false && boundary) c = lineOf(base);
      else if (o.rim === true && (!m.has(x - 1, y) || !m.has(x, y - 1))) c = lightOf(base);
      else if (!o.flat && t > 0.52 - bias) c = shadowOf(base);
      else if (o.shine && t < -0.62) c = lightOf(base);
      P.set(x, y, c);
    }
}

/** Selective outline: every empty pixel touching the figure takes a dark, plum-shifted copy of its neighbour. */
export function outline(P: Pix) {
  const src = new Uint8ClampedArray(P.d);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && src[(y * W + x) * 4 + 3] > 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (solid(x, y)) continue;
      const n = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].filter(([a, b]) => solid(a, b));
      if (!n.length) continue;
      const acc: RGB = [0, 0, 0];
      for (const [a, b] of n) {
        const i = (b * W + a) * 4;
        acc[0] += src[i];
        acc[1] += src[i + 1];
        acc[2] += src[i + 2];
      }
      const avg: RGB = [acc[0] / n.length, acc[1] / n.length, acc[2] / n.length];
      P.set(x, y, mix(avg, LINE, 0.9));
    }
}
