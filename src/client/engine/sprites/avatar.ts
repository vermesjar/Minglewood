/**
 * Minglewood avatars, drawn at 2× density (88 × 112 px canvas, feet at y = 104).
 *
 * Every part is a shape (ellipses, capsules, polygons) rasterized to crisp pixels and shaded in three
 * tones with light from the upper left: a lit rim on the upper-left edge, a darker edge on the lower-right,
 * a broad shadow on the side away from the light. A final pass draws a selective outline around the whole
 * figure in a darkened, plum-shifted version of whatever it borders — never black. Faces are small
 * hand-placed pixel stamps so they read at 1:1.
 *
 * The figure is drawn facing screen-right: 3/4 front ("se") and 3/4 back ("ne"); "sw"/"nw" are mirrors.
 * Every wardrobe slot is a layer, so any combination of the catalog works in every facing and pose.
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { ITEM_BY_ID, normalizeLoadout, type FullLoadout } from '@shared/avatar';
import { makeCanvas, type Sprite } from './painter';

export type Pose = 'stand' | 'walk1' | 'walk2' | 'sit' | 'wave';
type View = 'front' | 'back';

const W = 88;
const H = 112;
/** Canvas pixels per art pixel. */
const DENSITY = 2;
export const AVATAR_DENSITY = DENSITY;
export const AVATAR_ANCHOR = { x: 44, y: 104 };

/** Crop rectangles (canvas px) for UI previews. */
export const AVATAR_CROPS = {
  head: { x: 27, y: 14, w: 36, h: 36 },
  face: { x: 31, y: 18, w: 30, h: 30 },
  bust: { x: 23, y: 12, w: 44, h: 48 },
  torso: { x: 25, y: 44, w: 40, h: 34 },
  legs: { x: 25, y: 68, w: 40, h: 38 },
  /** The person without the extra padding (pets and umbrellas may be clipped). */
  body: { x: 17, y: 8, w: 56, h: 100 },
  full: { x: 0, y: 0, w: W, h: H },
};

/* ================================================================== color */

type RGB = [number, number, number];
const PLUM: RGB = [42, 29, 51];
const CREAM: RGB = [255, 246, 226];
const WHITE: RGB = [255, 250, 240];
const GOLD: RGB = [242, 193, 78];
const GOLD_D: RGB = [168, 102, 26];
const PINK: RGB = [255, 143, 193];

function hx(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shadowOf = (c: RGB) => mix(c, PLUM, 0.3);
const lightOf = (c: RGB) => mix(c, CREAM, 0.28);
const deepOf = (c: RGB) => mix(c, PLUM, 0.52);
const lum = (c: RGB) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;

/* ================================================================== pixels & shapes */

class Pix {
  readonly d = new Uint8ClampedArray(W * H * 4);
  set(x: number, y: number, c: RGB, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
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

class Mask {
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
const M = () => new Mask();

interface PaintOpts {
  /** Shift of the shadow line: positive = more shadow. */
  shade?: number;
  rim?: boolean;
  edge?: boolean;
  /** No broad shading, just the edges (small or flat things). */
  flat?: boolean;
}

/** Paint a mask with 3-tone shading, a lit upper-left rim and a darker lower-right edge. */
function paint(P: Pix, m: Mask, color: RGB | ((x: number, y: number) => RGB), o: PaintOpts = {}) {
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
      const t = ((x - cx) / hw) * 0.6 + ((y - cy) / hh) * 0.55;
      let c = base;
      if (o.edge !== false && (!m.has(x + 1, y) || !m.has(x, y + 1))) c = deepOf(base);
      else if (o.rim === true && (!m.has(x - 1, y) || !m.has(x, y - 1))) c = lightOf(base);
      else if (!o.flat && t > 0.38 - bias) c = shadowOf(base);
      P.set(x, y, c);
    }
}

/** Selective outline: every empty pixel touching the figure takes a dark, plum-shifted copy of its neighbour. */
function outline(P: Pix) {
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
      P.set(x, y, mix(avg, [26, 18, 30], 0.8));
    }
}

/* ================================================================== the body */

interface Limb {
  a: [number, number];
  b: [number, number];
}

interface Body {
  view: View;
  pose: Pose;
  /** Head centre and radii. */
  hx: number;
  hy: number;
  rx: number;
  ry: number;
  /** Torso centre line and outline (shoulders → waist). */
  cx: number;
  torso: Array<[number, number]>;
  shoulderY: number;
  waistY: number;
  hipY: number;
  armNear: Limb;
  armFar: Limb;
  handNear: [number, number];
  handFar: [number, number];
  legs: Array<{ hip: [number, number]; knee: [number, number]; ankle: [number, number]; heel?: boolean }>;
  sitting: boolean;
}

/**
 * Social-pixel proportions: about 3.4 heads tall (head 24 × 25 on an 84 px figure), a squarish grown-up
 * head on a short neck, narrow shoulders, legs a little longer than the torso.
 */
function bodyFor(view: View, pose: Pose): Body {
  const sitting = pose === 'sit';
  const walk = pose === 'walk1' ? 1 : pose === 'walk2' ? -1 : 0;
  const dy = sitting ? 8 : walk ? 1 : 0;
  const cx = 45;
  const hx = 45;
  const hy = 33 + dy;
  const sY = 49 + dy;
  const wY = 69 + dy;
  const hipY = 76 + dy;
  const torso: Array<[number, number]> = [
    [cx - 10, sY],
    [cx + 10, sY],
    [cx + 12, sY + 3],
    [cx + 10, wY],
    [cx - 10, wY],
    [cx - 12, sY + 3],
  ];
  const swingN = walk * -3;
  const swingF = walk * 3;
  let armNear: Limb = { a: [cx - 10, sY + 3], b: [cx - 12 + swingN * 0.8, 65 + dy] };
  let armFar: Limb = { a: [cx + 10, sY + 3], b: [cx + 12 + swingF * 0.8, 64 + dy] };
  let handNear: [number, number] = [cx - 12 + swingN, 69 + dy];
  let handFar: [number, number] = [cx + 12 + swingF, 68 + dy];
  if (sitting) {
    armNear = { a: [cx - 10, sY + 3], b: [cx - 5, 74] };
    armFar = { a: [cx + 10, sY + 3], b: [cx + 9, 72] };
    handNear = [cx - 2, 77];
    handFar = [cx + 10, 76];
  }
  if (pose === 'wave') {
    armNear = { a: [cx - 10, sY + 2], b: [cx - 17, 39 + dy] };
    handNear = [cx - 18, 35 + dy];
  }
  let legs: Body['legs'];
  if (sitting && view === 'back') {
    legs = [
      { hip: [cx - 6, 82], knee: [cx + 6, 78], ankle: [cx + 8, 88] },
      { hip: [cx + 4, 81], knee: [cx + 14, 77], ankle: [cx + 15, 87] },
    ];
  } else if (sitting) {
    legs = [
      { hip: [cx - 6, 82], knee: [cx + 8, 86], ankle: [cx + 9, 98] },
      { hip: [cx + 4, 81], knee: [cx + 15, 85], ankle: [cx + 16, 97] },
    ];
  } else if (walk === 1) {
    legs = [
      { hip: [cx - 5, hipY], knee: [cx - 2, 87], ankle: [cx, 98] },
      { hip: [cx + 5, hipY], knee: [cx + 3, 87], ankle: [cx, 96], heel: true },
    ];
  } else if (walk === -1) {
    legs = [
      { hip: [cx - 5, hipY], knee: [cx - 7, 87], ankle: [cx - 10, 96], heel: true },
      { hip: [cx + 5, hipY], knee: [cx + 7, 87], ankle: [cx + 10, 98] },
    ];
  } else {
    legs = [
      { hip: [cx - 5, hipY], knee: [cx - 5, 87], ankle: [cx - 5, 98] },
      { hip: [cx + 5, hipY], knee: [cx + 5, 87], ankle: [cx + 5, 98] },
    ];
  }
  return { view, pose, hx, hy, rx: 12, ry: 12.5, cx, torso, shoulderY: sY, waistY: wY, hipY, armNear, armFar, handNear, handFar, legs, sitting };
}

function headMask(B: Body): Mask {
  const { hx, hy, rx, ry } = B;
  if (B.view === 'back') return M().ellipse(hx, hy - 1, rx, ry - 0.5).rrect(hx - rx + 1, hy - 2, hx + rx - 1, hy + ry, 7);
  // a rounded crown over a squarer jaw, turned a touch toward the side we face
  return M()
    .ellipse(hx, hy - 2, rx, ry - 1.5)
    .rrect(hx - rx + 1, hy - 3, hx + rx, hy + ry, 7)
    .ellipse(hx + 2, hy + 5, rx - 3, ry - 6);
}

/** The face window a hairstyle leaves open (front view). `top` lowers the hairline (bangs). */
function faceWindow(B: Body, top = 0, left = 0): Mask {
  return M().ellipse(B.hx + 2 + left * 0.4, B.hy + 4 + top * 0.5, B.rx - 2.5 - left * 0.4, B.ry - 3.5 - top * 0.5);
}

/* ================================================================== hair */

interface HairShapes {
  /** Behind the head and body (long hair, ponytails). */
  behind?: Mask;
  /** Over the head. */
  front: Mask;
}

function hairShapes(style: string, B: Body): HairShapes | null {
  const { hx: x, hy: y, rx, ry } = B;
  const back = B.view === 'back';
  const cap = (grow = 1.2, down = 2) =>
    M()
      .ellipse(x, y - 2, rx + grow, ry + grow * 0.5)
      .band(0, y + (back ? Math.max(down, 2) + 8 : down));
  const win = (top = 0, left = 0) => faceWindow(B, top, left);
  const bumps = (m: Mask, r: number, cy: number, span: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (i / n) * Math.PI;
      m.ellipse(x + Math.cos(a) * span, cy + Math.sin(a) * span * 0.9, r, r);
    }
    return m;
  };
  const long = (to: number, wave = 0) => {
    const m = M().ellipse(x - 1, y - 1, rx + 2, ry + 0.5);
    m.poly([
      [x - rx - 2, y - 2],
      [x + rx - 1, y - 2],
      [x + rx + wave, to],
      [x - rx - 3 - wave, to],
    ]);
    if (wave) for (let yy = y + 4; yy < to; yy += 5) m.ellipse(x - rx - 2 + ((yy / 5) % 2) * 1.5, yy, 2.4, 2.4).ellipse(x + rx - ((yy / 5) % 2) * 1.5, yy, 2.4, 2.4);
    return m;
  };
  switch (style) {
    case 'none':
      return null;
    case 'buzz':
      return { front: back ? cap(0.4, 6) : cap(0.4, -2).cut(win(-2)) };
    case 'short':
    case 'crop': {
      const m = cap(style === 'crop' ? 0.8 : 1.3, 1);
      if (!back) {
        m.cut(win(style === 'crop' ? -1 : 0));
        m.ellipse(x - rx + 1.5, y + 2, 2, 4); // sideburn
      }
      return { front: m };
    }
    case 'pixie': {
      const m = cap(1.4, 2);
      if (!back) {
        m.cut(win(2));
        m.poly([
          [x - 5, y - 10],
          [x + 9, y - 7],
          [x + 10, y - 2],
          [x + 1, y - 4],
        ]);
      }
      return { front: m };
    }
    case 'sidepart':
    case 'swoop': {
      const m = cap(1.5, 2);
      if (!back) {
        m.cut(win(style === 'swoop' ? 3 : 1));
        if (style === 'swoop')
          m.poly([
            [x - 8, y - 11],
            [x + 12, y - 9],
            [x + 13, y - 1],
            [x + 6, y - 5],
            [x - 2, y - 6],
          ]);
        else m.ellipse(x + 4, y - 9, 8, 3.5);
      }
      return { front: m };
    }
    case 'undercut':
    case 'mohawk': {
      const m =
        style === 'mohawk'
          ? M().ellipse(x - 1, y - ry - 1, 3, 6).ellipse(x - 1, y - ry + 3, 3.5, 4.5)
          : M().ellipse(x + 1, y - ry + 2, rx - 1, 5).ellipse(x + 6, y - ry + 4, 7, 3.5);
      if (!back && style === 'undercut') m.cut(win(-1));
      return { front: m };
    }
    case 'curlyshort':
    case 'curly': {
      const big = style === 'curly';
      const m = bumps(cap(1.5, big ? 6 : 1), big ? 3.8 : 3, y - 3, rx + (big ? 0.5 : 0), 9);
      if (big) m.ellipse(x - rx, y + 4, 3.5, 5).ellipse(x + rx - 1, y + 3, 3, 4.5);
      if (!back) m.cut(win(big ? 1 : 0));
      return { front: m };
    }
    case 'afro': {
      const m = bumps(M().ellipse(x - 1, y - 4, rx + 5, ry + 3.5), 3.6, y - 4, rx + 4.5, 12);
      if (!back) m.cut(win(1));
      return { front: m };
    }
    case 'bob':
    case 'bangs': {
      const m = M().ellipse(x - 1, y - 1, rx + 2, ry + 0.5).rect(x - rx - 2, y - 1, x + rx + 1, y + 8);
      m.band(0, y + 9);
      if (!back) m.cut(win(style === 'bangs' ? 5 : 1));
      if (!back && style === 'bangs') m.cut(M().rect(x - 1, y + 1, x + 10, y + 11));
      return { front: m };
    }
    case 'mullet': {
      const m = cap(1.3, 1);
      if (!back) m.cut(win(0));
      const tail = M().poly([
        [x - rx - 1, y - 1],
        [x - rx + 6, y - 1],
        [x - rx + 7, y + 17],
        [x - rx - 2, y + 15],
      ]);
      return { front: back ? m.add(tail) : m, behind: back ? undefined : tail };
    }
    case 'long':
    case 'wavy': {
      const behind = long(y + 26, style === 'wavy' ? 1 : 0);
      const m = cap(2, 3);
      if (!back) {
        m.cut(win(1));
        m.ellipse(x - rx + 1, y + 6, 3, 9);
      } else m.add(behind);
      return { front: m, behind: back ? undefined : behind };
    }
    case 'ponytail': {
      const m = cap(1.4, 2);
      if (!back) m.cut(win(0));
      const tail = M().ellipse(x - rx - 1, y - 3, 3.5, 3.5).capsule(x - rx - 3, y, x - rx - 4, y + 16, 3);
      return back ? { front: m.add(tail) } : { front: m, behind: tail };
    }
    case 'pigtails': {
      const m = cap(1.4, 2);
      if (!back) m.cut(win(1));
      m.capsule(x - rx - 2, y, x - rx - 4, y + 14, 3).capsule(x + rx + 1, y, x + rx + 3, y + 13, 2.6);
      return { front: m };
    }
    case 'bun':
    case 'spacebuns': {
      const m = cap(1.3, 2);
      if (!back) m.cut(win(0));
      if (style === 'bun') m.ellipse(x - 1, y - ry - 3, 5, 4.5);
      else m.ellipse(x - 8, y - ry + 1, 4, 4).ellipse(x + 8, y - ry + 1.5, 4, 4);
      return { front: m };
    }
    case 'braids': {
      const m = cap(1.4, 2);
      if (!back) m.cut(win(1));
      for (let k = 0; k < 5; k++) m.ellipse(x - rx - 1, y + 2 + k * 4, 2.6, 2.2).ellipse(x + rx, y + 1 + k * 4, 2.2, 2.2);
      return { front: m };
    }
    case 'locs': {
      const m = cap(2, 3);
      if (!back) m.cut(win(1));
      const behind = M();
      for (let k = -3; k <= 3; k++) behind.capsule(x + k * 3.6, y - 4, x + k * 4, y + 19 - Math.abs(k) * 1.5, 2);
      return back ? { front: m.add(behind) } : { front: m, behind };
    }
    default: {
      const m = cap(1.3, 1);
      if (!back) m.cut(win(0));
      return { front: m };
    }
  }
}

/** Hair: flat two-tone with a few strand lines, a small shine, optional two-tone tips. */
function paintHair(P: Pix, m: Mask, L: FullLoadout, strands: boolean) {
  const base = hx(L.hairColor);
  const tip = L.hairHighlight ? hx(L.hairHighlight) : null;
  const b = m.bbox();
  if (!b) return;
  const [x0, y0, x1, y1] = b;
  paint(P, m, (x, y) => {
    let c = base;
    if (tip) {
      const k = (y - y0) / Math.max(1, y1 - y0);
      if (y1 - y0 > 26 ? k > 0.66 : k < 0.22) c = mix(base, tip, 0.8);
    }
    if (strands && (x * 3 + y) % 9 === 0) c = shadowOf(c);
    return c;
  });
  // a small shine on the crown, toward the light
  const sx = x0 + (x1 - x0) * 0.34;
  const sy = y0 + 4;
  for (let x = Math.round(sx - 3); x <= sx + 2; x++) {
    const y = Math.round(sy + Math.abs(x - sx) * 0.4);
    if (m.has(x, y) && m.has(x, y - 1) && m.has(x - 1, y)) P.set(x, y, lightOf(base));
  }
}

/* ================================================================== face */

function drawFace(P: Pix, B: Body, L: FullLoadout) {
  const skin = hx(L.skin);
  const x = B.hx;
  const ey = B.hy; // middle row of the eyes
  const dark: RGB = [34, 24, 38];
  const iris = hx(L.eyeColor);
  const pal: Record<string, RGB> = { k: dark, c: lum(iris) < 0.25 ? dark : iris, w: WHITE };
  const eyes = L.eyes.replace('eyes.', '');
  // Small, simple eyes: expression lives in the brows and mouth.
  const near: Record<string, string[]> = {
    dot: ['kk', 'kc', 'kk'],
    wide: ['wk', 'kc', 'kk'],
    lashes: ['k..', '.kk', '.kc', '.kk'],
    happy: ['.k.', 'k.k'],
    sleepy: ['kk'],
    wink: ['kk', 'kc', 'kk'],
    sparkle: ['wk', 'kc', 'kw'],
  };
  const far: Record<string, string[]> = {
    dot: ['kk', 'ck', 'kk'],
    wide: ['wk', 'ck', 'kk'],
    lashes: ['..k', 'kk.', 'ck.', 'kk.'],
    happy: ['.k.', 'k.k'],
    sleepy: ['kk'],
    wink: ['.k.', 'k.k'],
    sparkle: ['wk', 'ck', 'kw'],
  };
  const n = near[eyes] ?? near.dot;
  const f = far[eyes] ?? far.dot;
  const top = (rows: string[]) => ey - Math.floor(rows.length / 2) - (rows[0].includes('.') && rows.length > 3 ? 1 : 0);
  P.stamp(x - 5 - (n[0].length > 2 ? 1 : 0), top(n), n, pal);
  P.stamp(x + 4, top(f), f, pal);
  // brows carry the personality
  const brow = mix(hx(L.hairColor), dark, 0.4);
  const by = ey - 4;
  if (L.brows === 'brows.bold') {
    P.stamp(x - 6, by - 1, ['bbb.', '.bbb'], { b: brow });
    P.stamp(x + 3, by - 1, ['.bbb', 'bbb.'], { b: brow });
  } else if (L.brows !== 'brows.none') {
    P.stamp(x - 6, by, ['bbb'], { b: brow });
    P.stamp(x + 4, by, ['bb'], { b: brow });
  }
  // nose
  P.set(x + 2, ey + 3, shadowOf(skin));
  P.set(x + 2, ey + 4, mix(skin, PLUM, 0.18));
  if (L.faceDetail === 'fd.blush') {
    const blush = mix(skin, [255, 110, 130], 0.45);
    P.stamp(x - 7, ey + 3, ['bb'], { b: blush });
    P.set(x + 6, ey + 3, blush);
  }
  if (L.faceDetail === 'fd.freckles') {
    const fr = mix(skin, [120, 70, 40], 0.4);
    P.stamp(x - 7, ey + 3, ['f.f', '.f.'], { f: fr });
    P.stamp(x + 5, ey + 3, ['f.', '.f'], { f: fr });
  }
  if (L.faceDetail === 'fd.mole') P.set(x + 5, ey + 7, mix(skin, dark, 0.7));
  if (L.faceDetail === 'fd.bandaid') P.stamp(x - 8, ey + 2, ['ttt', 'tdt'], { t: [236, 196, 150], d: [200, 150, 110] });
  // facial hair
  const fh = L.facialHair.replace('fh.', '');
  const hairC = hx(L.hairColor);
  if (fh === 'beard') {
    const m = M()
      .ellipse(x + 1, B.hy + 7, B.rx - 2, 6.5)
      .cut(M().rect(0, 0, W, B.hy + 3))
      .keep(headMask(B).add(M().ellipse(x + 1, B.hy + 10, 8, 4)));
    paint(P, m, hairC);
  } else if (fh === 'goatee') {
    paint(P, M().ellipse(x + 1, ey + 9, 2.5, 2), hairC);
  } else if (fh === 'stubble') {
    const m = M().ellipse(x + 1, B.hy + 7, B.rx - 2, 6).cut(M().rect(0, 0, W, B.hy + 4)).keep(headMask(B));
    const s = mix(skin, hairC, 0.4);
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (m.has(xx, yy) && (xx + yy) % 2 === 0) P.set(xx, yy, s);
  }
  if (fh === 'mustache' || fh === 'beard') P.stamp(x - 2, ey + 5, ['mmmmmm'], { m: fh === 'beard' ? shadowOf(hairC) : hairC });
  // mouth
  const mouthC = mix(skin, [70, 20, 40], 0.65);
  const mouths: Record<string, string[]> = {
    smile: ['m..m', '.mm.'],
    grin: ['mmmm', 'mwwm', '.mm.'],
    neutral: ['mmm'],
    smirk: ['...m', 'mmm.'],
    o: ['.m.', 'm.m', '.m.'],
    tongue: ['m..m', '.mt.'],
  };
  P.stamp(x - 1, ey + 6, mouths[L.mouth.replace('mouth.', '')] ?? mouths.smile, { m: mouthC, w: WHITE, t: [236, 110, 130] });
}

/* ================================================================== clothes */

const LONG_SLEEVES = new Set([
  'top.hoodie',
  'top.shirt',
  'top.sweater',
  'top.turtleneck',
  'top.flannel',
  'top.cardigan',
  'top.puffer',
  'top.blazer',
  'top.kimono',
  'top.raincoat',
  'top.labcoat',
  'top.northstar-hoodie',
]);

function patternFn(L: FullLoadout, base: RGB, top: string): (x: number, y: number) => RGB {
  const acc = hx(L.topAccent);
  const pat = top === 'top.flannel' ? 'pat.flannel' : L.topPattern;
  const knit = top === 'top.sweater' || top === 'top.turtleneck' || top === 'top.cardigan';
  return (x, y) => {
    let c = base;
    switch (pat) {
      case 'pat.stripes':
        if (y % 5 < 2) c = acc;
        break;
      case 'pat.dots':
        if (x % 4 === 1 && y % 4 === 1) c = acc;
        break;
      case 'pat.check':
        if ((Math.floor(x / 2) + Math.floor(y / 2)) % 2) c = mix(base, acc, 0.4);
        break;
      case 'pat.flannel': {
        const a = x % 6 < 2;
        const b = y % 6 < 2;
        if (a && b) c = mix(base, PLUM, 0.45);
        else if (a || b) c = mix(base, PLUM, 0.22);
        if (x % 6 === 4 || y % 6 === 4) c = mix(c, acc, 0.35);
        break;
      }
      case 'pat.stars':
        if ((x * 7 + y * 13) % 23 === 0) c = acc;
        break;
      case 'pat.hearts':
        if ((x * 5 + y * 11) % 23 === 0) c = [226, 76, 120];
        break;
    }
    if (knit && x % 3 === 0) c = mix(c, PLUM, 0.1);
    if (top === 'top.puffer' && y % 5 === 0) c = shadowOf(c);
    return c;
  };
}

function topColorFor(L: FullLoadout): RGB {
  if (L.top === 'top.labcoat') return [246, 244, 240];
  return hx(L.topColor);
}

function drawArm(P: Pix, B: Body, L: FullLoadout, near: boolean) {
  const arm = near ? B.armNear : B.armFar;
  const hand = near ? B.handNear : B.handFar;
  const skin = hx(L.skin);
  const top = L.top;
  const long = LONG_SLEEVES.has(top);
  const bare = top === 'top.tank';
  const shade = near ? 0 : 0.25;
  if (!long) paint(P, M().capsule(arm.a[0], arm.a[1], arm.b[0], arm.b[1], 3.1), skin, { shade });
  if (!bare) {
    const base = topColorFor(L);
    const r = top === 'top.puffer' ? 4.4 : 3.7;
    const sleeve = long
      ? M().capsule(arm.a[0], arm.a[1], arm.b[0], arm.b[1], r)
      : M().capsule(arm.a[0], arm.a[1], arm.a[0] + (arm.b[0] - arm.a[0]) * 0.4, arm.a[1] + (arm.b[1] - arm.a[1]) * 0.4, r + 0.3);
    paint(P, sleeve, patternFn(L, base, top), { shade });
    if (long) {
      const cy = Math.round(arm.b[1]);
      const cuff = M().capsule(arm.b[0], arm.b[1], arm.b[0], arm.b[1], r).band(cy + 1, cy + 3).keep(sleeve);
      const cuffC = top === 'top.shirt' || top === 'top.blazer' ? mix(hx(L.topAccent), base, 0.35) : shadowOf(base);
      paint(P, cuff, cuffC, { edge: false, flat: true });
    }
  }
  const [hx0, hy0] = hand;
  const h = M().ellipse(hx0, hy0, 3.2, 3.4);
  if (B.pose === 'wave' && near) h.ellipse(hx0 - 3, hy0 + 1, 1.4, 2); // thumb out
  paint(P, h, skin, { shade });
}

function drawTorso(P: Pix, B: Body, L: FullLoadout) {
  const top = L.top;
  const base = topColorFor(L);
  const acc = hx(L.topAccent);
  const skin = hx(L.skin);
  const back = B.view === 'back';
  const cx = B.cx;
  const sy = B.shoulderY;
  const wy = B.waistY;
  const t = M().poly(B.torso);
  if (top === 'top.puffer') t.ellipse(cx, sy + 5, 13, 6);
  const full = ITEM_BY_ID.get(top)?.fullLength;
  if (full) {
    const hem = B.sitting ? B.hipY + 7 : 91;
    t.poly([
      [cx - 10, wy - 2],
      [cx + 10, wy - 2],
      [cx + (B.sitting ? 16 : 13), hem],
      [cx - (B.sitting ? 11 : 13), hem],
    ]);
  }
  paint(P, t, patternFn(L, base, top));
  if (back) {
    if (top === 'top.hoodie' || top === 'top.northstar-hoodie' || top === 'top.raincoat') paint(P, M().ellipse(cx, sy + 2, 7, 4.5), shadowOf(base));
    return;
  }
  const inside = (m: Mask) => m.keep(t);
  switch (top) {
    case 'top.tee':
    case 'top.aurora-tee':
    case 'top.jersey':
      paint(P, inside(M().ellipse(cx + 1, sy, 4, 2.5)), skin, { edge: false });
      if (top === 'top.aurora-tee') P.stamp(cx - 1, sy + 6, ['.w.', 'wrw', 'www', '.o.'], { w: WHITE, r: [224, 80, 63], o: [255, 138, 61] });
      if (top === 'top.jersey') {
        P.stamp(cx - 3, sy, ['a.....a', '.a...a.', '..aaa..'], { a: acc });
        for (let y = sy + 8; y < sy + 10; y++) for (let x = cx - 12; x < cx + 13; x++) if (t.has(x, y)) P.set(x, y, acc);
      }
      break;
    case 'top.tank':
      paint(P, inside(M().ellipse(cx + 1, sy + 1, 6, 4)), skin, { edge: false });
      break;
    case 'top.hoodie':
    case 'top.northstar-hoodie':
      paint(P, M().ellipse(cx + 1, sy - 1, 8, 3).cut(M().ellipse(cx + 1, sy - 2, 4, 2)), shadowOf(base));
      P.stamp(cx - 1, sy + 2, ['w...w', 'w...w', 'o...o'], { w: WHITE, o: shadowOf(WHITE) });
      paint(P, inside(M().rrect(cx - 6, wy - 7, cx + 8, wy - 2, 2)), shadowOf(base), { flat: true });
      if (top === 'top.northstar-hoodie') P.stamp(cx - 1, sy + 6, ['.g.', 'ggg', 'g.g'], { g: GOLD });
      break;
    case 'top.shirt':
    case 'top.flannel': {
      const col = top === 'top.shirt' ? lightOf(base) : shadowOf(base);
      P.stamp(cx - 3, sy - 1, ['cc...cc', '.cc.cc.'], { c: col });
      for (let y = sy + 2; y < wy; y++) P.set(cx + 1, y, shadowOf(base));
      for (let y = sy + 3; y < wy - 1; y += 4) P.set(cx + 2, y, top === 'top.shirt' ? acc : WHITE);
      break;
    }
    case 'top.sweater':
    case 'top.turtleneck':
      if (top === 'top.turtleneck') paint(P, M().rrect(cx - 4, sy - 5, cx + 6, sy + 2, 2), mix(base, PLUM, 0.08));
      else paint(P, inside(M().ellipse(cx + 1, sy, 4, 2.5)), skin, { edge: false });
      for (let y = wy - 3; y < wy; y++) for (let x = cx - 12; x < cx + 13; x++) if (t.has(x, y)) P.set(x, y, x % 2 ? shadowOf(base) : base);
      break;
    case 'top.cardigan':
    case 'top.blazer':
    case 'top.labcoat':
    case 'top.kimono': {
      const inner = top === 'top.labcoat' ? hx(L.topAccent) : acc;
      const bottom = wy - (top === 'top.kimono' ? 5 : 1);
      const v = inside(
        M().poly([
          [cx - 2, sy - 1],
          [cx + 5, sy - 1],
          [cx + 3, bottom],
          [cx + 1, bottom],
        ]),
      );
      paint(P, v, inner, { edge: false });
      if (top === 'top.blazer' || top === 'top.labcoat') {
        P.stamp(cx - 3, sy, ['l.....', '.l...l', '..l.l.', '...l..'], { l: shadowOf(base) });
        P.set(cx + 7, sy + 5, acc);
        if (top === 'top.labcoat') P.stamp(cx + 6, sy + 4, ['b', 'b'], { b: [63, 143, 216] });
      }
      if (top === 'top.kimono') for (let x = cx - 12; x < cx + 13; x++) for (let y = wy - 4; y < wy - 2; y++) if (t.has(x, y)) P.set(x, y, acc);
      if (top === 'top.cardigan') for (let y = sy + 3; y < wy - 1; y += 4) P.set(cx + 4, y, lightOf(acc));
      break;
    }
    case 'top.puffer':
      paint(P, M().rrect(cx - 4, sy - 4, cx + 6, sy + 2, 2), base);
      for (let y = sy; y < wy; y++) P.set(cx + 1, y, deepOf(base));
      break;
    case 'top.overalls':
      paint(P, M().poly(B.torso).band(0, sy + 5), acc);
      paint(P, M().rrect(cx - 6, sy + 5, cx + 8, wy, 2), base);
      for (let y = sy; y < sy + 5; y++) {
        P.set(cx - 5, y, shadowOf(base));
        P.set(cx + 7, y, shadowOf(base));
      }
      P.set(cx - 5, sy + 5, GOLD);
      P.set(cx + 7, sy + 5, GOLD);
      paint(P, M().rrect(cx - 2, sy + 8, cx + 4, sy + 12, 1), shadowOf(base), { flat: true });
      break;
    case 'top.dress':
      paint(P, inside(M().ellipse(cx + 1, sy, 5, 3)), skin, { edge: false });
      for (let x = cx - 12; x < cx + 13; x++) for (let y = wy - 2; y < wy; y++) if (t.has(x, y)) P.set(x, y, acc);
      break;
    case 'top.raincoat':
      paint(P, M().rrect(cx - 4, sy - 4, cx + 6, sy + 2, 2), base);
      for (let y = sy + 3; y < 90; y += 5) P.stamp(cx + 1, y, ['kk'], { k: deepOf(base) });
      break;
  }
}

function drawLegs(P: Pix, B: Body, L: FullLoadout) {
  const skin = hx(L.skin);
  const pants = hx(L.bottomColor);
  const bottom = L.bottom;
  const full = ITEM_BY_ID.get(L.top)?.fullLength;
  const skirt = bottom === 'bottom.skirt' || bottom === 'bottom.longskirt';
  const shorts = bottom === 'bottom.shorts';
  const r = bottom === 'bottom.leggings' ? 3.4 : bottom === 'bottom.cargo' || bottom === 'bottom.joggers' ? 4.6 : 4.2;
  const cx = B.cx;
  const order = [...B.legs].reverse(); // far leg first
  for (const [i, leg] of order.entries()) {
    const far = i === 0;
    const shade = far ? 0.3 : 0;
    const bare = M().capsule(leg.hip[0], leg.hip[1], leg.knee[0], leg.knee[1], 3.4).capsule(leg.knee[0], leg.knee[1], leg.ankle[0], leg.ankle[1], 3);
    paint(P, bare, skin, { shade });
    if (skirt || full) continue;
    const pm = M().capsule(leg.hip[0], leg.hip[1], leg.knee[0], leg.knee[1], r);
    if (shorts) pm.band(0, Math.round(leg.hip[1] + (leg.knee[1] - leg.hip[1]) * 0.85));
    else pm.capsule(leg.knee[0], leg.knee[1], leg.ankle[0], leg.ankle[1] - (bottom === 'bottom.joggers' ? 2 : 0), r - 0.3);
    paint(P, pm, pants, { shade });
    if (bottom === 'bottom.jeans') paint(P, M().capsule(leg.ankle[0], leg.ankle[1] - 2, leg.ankle[0], leg.ankle[1] - 1, r).keep(pm), lightOf(pants), { flat: true, edge: false });
    if (bottom === 'bottom.joggers') paint(P, M().capsule(leg.ankle[0], leg.ankle[1] - 3, leg.ankle[0], leg.ankle[1] - 1, r - 1), shadowOf(pants), { flat: true });
    if (bottom === 'bottom.cargo' && !far) paint(P, M().rrect(leg.knee[0] - 4, leg.knee[1] - 6, leg.knee[0], leg.knee[1] - 1, 1), shadowOf(pants), { flat: true });
  }
  if (!full && !skirt) {
    const hips = B.sitting ? M().rrect(cx - 11, B.hipY - 5, cx + 11, B.hipY + 5, 4) : M().rrect(cx - 10, B.waistY - 1, cx + 10, B.hipY + 4, 3);
    paint(P, hips, pants);
    // belt line
    for (let x = cx - 10; x < cx + 10; x++) if (hips.has(x, B.waistY)) P.set(x, B.waistY, shadowOf(pants));
  }
  if (skirt) {
    const long = bottom === 'bottom.longskirt';
    const hem = long ? (B.sitting ? B.hipY + 13 : 98) : B.sitting ? B.hipY + 7 : 88;
    const sk = M().poly([
      [cx - 10, B.waistY - 1],
      [cx + 10, B.waistY - 1],
      [cx + (B.sitting ? 17 : 13), hem],
      [cx - (B.sitting ? 10 : 13), hem],
    ]);
    paint(P, sk, (x) => (x % 4 === 0 ? shadowOf(pants) : pants));
  }
}

function drawShoes(P: Pix, B: Body, L: FullLoadout) {
  const kind = L.shoes.replace('shoes.', '');
  const c = hx(L.shoesColor);
  const back = B.view === 'back';
  const order = [...B.legs].reverse();
  for (const [i, leg] of order.entries()) {
    const shade = i === 0 ? 0.25 : 0;
    const [ax, ay] = leg.ankle;
    const toe = back ? -1 : 1;
    const x0 = ax - 3 - (toe < 0 ? 2 : 0);
    const x1 = ax + 4 + (toe > 0 ? 2 : 0);
    const y0 = ay;
    const tall = kind === 'boots' ? 5 : kind === 'rainboots' ? 8 : kind === 'hightops' ? 3 : 0;
    const shoe = M().rrect(x0, y0, x1, y0 + 5, 2);
    if (tall) shoe.rect(ax - 3, y0 - tall, ax + 4, y0 + 2);
    if (kind === 'sandals') {
      paint(P, M().rrect(x0, y0 + 1, x1, y0 + 5, 2), hx(L.skin), { shade });
      P.stamp(x0 + 1, y0 + 2, ['cccc'], { c });
      P.stamp(x0, y0 + 4, ['ssssssss'], { s: [120, 80, 50] });
      continue;
    }
    paint(P, shoe, kind === 'slippers' ? lightOf(c) : c, { shade });
    const soleY = y0 + 4;
    const soleC: RGB = kind === 'sneakers' || kind === 'hightops' || kind === 'skates' ? WHITE : kind === 'heels' || kind === 'loafers' ? [58, 40, 42] : deepOf(c);
    for (let x = x0; x < x1; x++) if (shoe.has(x, soleY)) P.set(x, soleY, soleC);
    if (kind === 'sneakers' || kind === 'hightops') P.stamp(ax - 1, y0 + 1, ['www'], { w: WHITE });
    if (kind === 'hightops') P.stamp(ax - 1, y0 - 2, ['w.w'], { w: WHITE });
    if (kind === 'rainboots') P.stamp(ax - 2, y0 - 6, ['l', 'l', 'l', 'l'], { l: lightOf(lightOf(c)) });
    if (kind === 'heels') P.stamp(toe > 0 ? x0 : x1 - 1, y0 + 5, ['k'], { k: [58, 40, 42] });
    if (kind === 'loafers') P.stamp(ax, y0 + 1, ['gg'], { g: GOLD });
    if (kind === 'skates') for (const wx of [x0 + 1, x0 + 4, x0 + 7]) P.set(wx, y0 + 6, [255, 138, 61]);
    if (kind === 'slippers') for (let x = x0; x < x1; x += 2) P.set(x, y0, WHITE);
  }
}

/* ================================================================== head, hats, glasses, neckwear */

function drawHead(P: Pix, B: Body, L: FullLoadout) {
  const skin = hx(L.skin);
  paint(P, M().rrect(B.hx - 4, B.hy + 9, B.hx + 5, B.shoulderY + 2, 2), shadowOf(skin), { flat: true });
  paint(P, headMask(B), skin, { shade: -0.1 });
  if (B.view === 'front') {
    paint(P, M().ellipse(B.hx - B.rx + 1, B.hy + 1, 2, 3), skin, { flat: true });
    P.set(B.hx - B.rx + 1, B.hy + 1, shadowOf(skin));
  }
}

function drawHeadwear(P: Pix, B: Body, L: FullLoadout) {
  const hat = L.headwear.replace('hat.', '');
  if (hat === 'none') return;
  const c = hx(L.headwearColor);
  const { hx: x, hy: y, rx, ry } = B;
  const back = B.view === 'back';
  const dir = back ? -1 : 1;
  const top = y - ry;
  switch (hat) {
    case 'beanie':
      paint(P, M().ellipse(x, y - 3, rx + 1.5, ry - 1).band(0, y - 4), (px) => (px % 3 === 0 ? shadowOf(c) : c));
      paint(P, M().rrect(x - rx - 1.5, y - 7, x + rx + 1.5, y - 3, 2), lightOf(c));
      paint(P, M().ellipse(x - 1, top - 2, 3, 2.6), WHITE);
      break;
    case 'cap':
    case 'capback': {
      const d = hat === 'cap' ? dir : -dir;
      paint(P, M().ellipse(x, y - 4, rx + 1, ry - 2).band(0, y - 4), c);
      paint(P, M().ellipse(x + d * (rx + 1), y - 5, 7, 2.2).band(y - 6, H), shadowOf(c));
      break;
    }
    case 'bucket':
      paint(P, M().ellipse(x, y - 5, rx - 1, ry - 3.5).band(0, y - 4), c);
      paint(P, M().ellipse(x, y - 4, rx + 4, 3.4), shadowOf(c));
      break;
    case 'beret':
      paint(P, M().ellipse(x - 2 * dir, top + 3, rx + 2, 4), c);
      P.set(x - 2 * dir, top - 1, shadowOf(c));
      break;
    case 'headband':
      paint(P, M().ellipse(x, y - 2, rx + 1, ry).band(y - 8, y - 5), c, { flat: true });
      break;
    case 'bow':
      paint(P, M().ellipse(x - 6, top + 1, 4.5, 3.4).ellipse(x + 3, top, 4.5, 3.4), c);
      paint(P, M().ellipse(x - 1.5, top + 0.5, 2, 2), shadowOf(c));
      break;
    case 'catears':
      paint(P, M().poly([[x - 10, top + 4], [x - 8, top - 4], [x - 3, top + 2]]).poly([[x + 3, top + 1], [x + 8, top - 5], [x + 10, top + 4]]), c);
      P.stamp(x - 8, top - 1, ['p', 'pp'], { p: PINK });
      break;
    case 'flowers': {
      const cols: RGB[] = [PINK, GOLD, [159, 220, 255], WHITE];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI * (1.08 + (k / 5) * 0.84);
        const fx = x + Math.cos(a) * (rx + 0.5);
        const fy = y - 2 + Math.sin(a) * (ry - 1);
        paint(P, M().ellipse(fx, fy, 2, 1.9), cols[k % cols.length], { flat: true });
        P.set(fx, fy, GOLD);
      }
      break;
    }
    case 'headphones':
      paint(P, M().ellipse(x, y - 2, rx + 2, ry + 1).cut(M().ellipse(x, y - 1, rx + 0.5, ry)).band(0, y), [58, 58, 70]);
      if (!back) paint(P, M().rrect(x - rx - 2, y - 3, x - rx + 3, y + 5, 2), c);
      else paint(P, M().rrect(x + rx - 3, y - 3, x + rx + 2, y + 5, 2), c);
      break;
    case 'cowboy':
      paint(P, M().rrect(x - 8, top - 4, x + 8, y - 5, 3), c);
      paint(P, M().ellipse(x, y - 5, rx + 6, 3).cut(M().ellipse(x, y - 7.5, rx + 3, 2)), shadowOf(c));
      paint(P, M().rect(x - 8, y - 8, x + 8, y - 6), deepOf(c), { flat: true });
      break;
    case 'crown': {
      const m = M().rect(x - 8, top - 1, x + 8, top + 4).poly([[x - 8, top], [x - 8, top - 5], [x - 4, top]]).poly([[x - 2, top], [x, top - 6], [x + 2, top]]).poly([[x + 4, top], [x + 8, top - 5], [x + 8, top]]);
      paint(P, m, GOLD);
      P.stamp(x - 6, top + 1, ['r.....b.....r'.slice(0, 13)], { r: [224, 80, 63], b: [63, 143, 216] });
      break;
    }
    case 'hijab': {
      const m = M().ellipse(x, y, rx + 2.5, ry + 2.5).rrect(x - rx - 2, y + 3, x + rx + 2, B.shoulderY + 6, 5);
      if (!back) m.cut(faceWindow(B, 1, 2));
      paint(P, m, c);
      break;
    }
    case 'turban': {
      const m = M().ellipse(x - 1, y - 5, rx + 2.5, ry - 2).band(0, y - 1);
      if (back) m.ellipse(x, y, rx + 1, ry).band(0, y + 8);
      paint(P, m, (px, py) => ((px + py * 2) % 7 < 2 ? shadowOf(c) : c));
      break;
    }
    case 'party':
      paint(P, M().poly([[x - 7, top + 3], [x + 2, top - 12], [x + 7, top + 3]]), (px, py) => ((px + py) % 5 < 2 ? c : WHITE));
      paint(P, M().ellipse(x + 2, top - 13, 2.2, 2.2), GOLD);
      break;
  }
}

function drawEyewear(P: Pix, B: Body, L: FullLoadout) {
  const kind = L.eyewear.replace('eye.', '');
  if (kind === 'none' || B.view === 'back') return;
  const y = B.hy;
  const nx = B.hx - 4.5;
  const fx = B.hx + 4.5;
  const frame: RGB = kind === 'heart' ? [226, 76, 156] : kind === 'star' ? GOLD : [42, 32, 44];
  const ring = (cx: number, cy: number, rx: number, ry: number, lens?: RGB) => {
    const outer = M().ellipse(cx, cy, rx, ry);
    const inner = M().ellipse(cx, cy, rx - 1, ry - 1);
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) {
        if (inner.has(xx, yy) && lens) P.set(xx, yy, lens);
        else if (outer.has(xx, yy) && !inner.has(xx, yy)) P.set(xx, yy, frame);
      }
  };
  switch (kind) {
    case 'round':
      ring(nx, y, 3.6, 3.4);
      ring(fx, y, 3, 3.4);
      break;
    case 'square':
      P.stamp(nx - 3, y - 2, ['fffffff', 'f.....f', 'f.....f', 'f.....f', 'fffffff'], { f: frame });
      P.stamp(fx - 2, y - 2, ['fffff', 'f...f', 'f...f', 'f...f', 'fffff'], { f: frame });
      break;
    case 'sun':
    case '3d':
      ring(nx, y, 3.6, 3, kind === 'sun' ? [30, 26, 40] : [224, 60, 70]);
      ring(fx, y, 3, 3, kind === 'sun' ? [30, 26, 40] : [60, 190, 220]);
      if (kind === 'sun') P.set(nx - 1, y - 1, WHITE);
      break;
    case 'heart':
    case 'star':
      P.stamp(nx - 3, y - 2, kind === 'heart' ? ['ff.ff', 'fffff', '.fff.', '..f..'] : ['..f..', 'fffff', '.fff.', 'f...f'], { f: frame });
      P.stamp(fx - 2, y - 2, kind === 'heart' ? ['f.f', 'fff', '.f.'] : ['.f.', 'fff', 'f.f'], { f: frame });
      break;
    case 'monocle':
      ring(fx, y, 3.4, 3.6);
      for (let k = 0; k < 7; k++) P.set(fx + 2 + (k % 2), y + 3 + k, GOLD_D);
      return;
    case 'goggles':
      paint(P, M().ellipse(B.hx, y - 1, B.rx + 0.5, 1.6).band(y - 2, y + 1), [80, 70, 60], { flat: true });
      ring(nx, y, 4, 3.6, [159, 220, 255]);
      ring(fx, y, 3.4, 3.6, [159, 220, 255]);
      return;
  }
  for (let x = Math.round(nx + 3); x < fx - 2; x++) P.set(x, y - 1, frame);
  for (let x = B.hx - B.rx + 1; x < nx - 3; x++) P.set(x, y - 1, frame);
}

function drawNeckwear(P: Pix, B: Body, L: FullLoadout) {
  const kind = L.neck.replace('neck.', '');
  if (kind === 'none') return;
  const c = hx(L.neckColor);
  const cx = B.cx;
  const sy = B.shoulderY;
  const back = B.view === 'back';
  switch (kind) {
    case 'scarf':
      paint(P, M().rrect(cx - 8, sy - 4, cx + 9, sy + 2, 3), (x) => (x % 4 < 2 ? c : lightOf(c)));
      if (!back) paint(P, M().rrect(cx - 6, sy, cx - 2, sy + 12, 2), (_x, y) => (y % 4 < 2 ? c : lightOf(c)));
      break;
    case 'bowtie':
      if (!back) paint(P, M().poly([[cx - 3, sy - 1], [cx + 1, sy + 1], [cx - 3, sy + 3]]).poly([[cx + 5, sy - 1], [cx + 1, sy + 1], [cx + 5, sy + 3]]).ellipse(cx + 1, sy + 1, 1.2, 1.2), c);
      break;
    case 'tie':
      if (!back) {
        paint(P, M().ellipse(cx + 1, sy + 1, 1.8, 1.5), c);
        paint(P, M().poly([[cx, sy + 2], [cx + 2, sy + 2], [cx + 3, sy + 14], [cx + 1, sy + 16], [cx - 1, sy + 14]]), c);
      }
      break;
    case 'necklace':
      if (!back) {
        for (let k = -5; k <= 6; k++) P.set(cx + k, sy + 2 + Math.round((k * k) / 14), GOLD);
        P.set(cx + 1, sy + 5, [159, 220, 255]);
      }
      break;
    case 'bandana':
      if (!back) paint(P, M().poly([[cx - 6, sy - 1], [cx + 8, sy - 1], [cx + 1, sy + 7]]), (x, y) => ((x + y) % 4 === 0 ? WHITE : c));
      else paint(P, M().rrect(cx - 7, sy - 3, cx + 7, sy + 1, 2), c);
      break;
    case 'lanyard':
      if (!back) {
        for (let k = 0; k < 10; k++) {
          P.set(cx - 4 + Math.round(k * 0.3), sy + k, c);
          P.set(cx + 6 - Math.round(k * 0.3), sy + k, c);
        }
        paint(P, M().rrect(cx - 2, sy + 9, cx + 4, sy + 15, 1), WHITE, { flat: true });
        P.stamp(cx - 1, sy + 10, ['cccc'], { c });
      }
      break;
  }
}

function drawAccessory(P: Pix, B: Body, L: FullLoadout) {
  const back = B.view === 'back';
  const cx = B.cx;
  const sy = B.shoulderY;
  switch (L.accessory) {
    case 'acc.flower':
      P.stamp(back ? B.hx + B.rx - 3 : B.hx - B.rx - 1, B.hy - 8, ['.p.', 'pyp', '.p.'], { p: PINK, y: GOLD });
      break;
    case 'acc.earrings':
      if (!back) P.stamp(B.hx - B.rx, B.hy + 4, ['g', 'g'], { g: GOLD });
      break;
    case 'acc.hearing-aid':
      P.stamp(back ? B.hx + B.rx - 1 : B.hx - B.rx - 1, B.hy - 1, ['t', 't'], { t: [43, 179, 163] });
      break;
    case 'acc.star-pin':
    case 'acc.five-year-pin':
      if (!back) P.stamp(cx - 7, sy + 4, ['.y.', 'yyy', L.accessory === 'acc.five-year-pin' ? 'r.r' : '.y.'], { y: GOLD, r: [224, 80, 63] });
      break;
    case 'acc.rainbow-pin':
      if (!back) P.stamp(cx - 8, sy + 4, ['rrr', 'y.y', 'b.b'], { r: [224, 80, 63], y: GOLD, b: [63, 143, 216] });
      break;
  }
}

function drawHeld(P: Pix, B: Body, L: FullLoadout) {
  if (L.held === 'held.none') return;
  const waving = B.pose === 'wave';
  const [x, y] = waving ? B.handFar : B.handNear;
  const c = hx(L.heldColor);
  switch (L.held) {
    case 'held.coffee':
      paint(P, M().rrect(x - 2, y - 7, x + 3, y + 1, 1), WHITE, { flat: true });
      paint(P, M().rect(x - 2, y - 5, x + 3, y - 2), [201, 160, 106], { flat: true, edge: false });
      paint(P, M().rrect(x - 3, y - 9, x + 4, y - 6, 1), [90, 60, 50], { flat: true });
      break;
    case 'held.boba':
      paint(P, M().rrect(x - 2, y - 8, x + 3, y + 1, 1), [236, 206, 170], { flat: true });
      P.stamp(x - 1, y - 2, ['k.k', '.k.'], { k: [59, 37, 24] });
      for (let k = 0; k < 5; k++) P.set(x + 2 + (k > 3 ? 1 : 0), y - 9 - k, c);
      break;
    case 'held.laptop':
      paint(P, M().rrect(x - 6, y - 2, x + 6, y + 1, 1), [201, 206, 214]);
      break;
    case 'held.book':
      paint(P, M().rrect(x - 2, y - 7, x + 4, y + 1, 1), c);
      for (let yy = y - 6; yy < y; yy++) P.set(x + 3, yy, WHITE);
      break;
    case 'held.plant':
      paint(P, M().rrect(x - 2, y - 3, x + 3, y + 2, 1), [201, 98, 63]);
      paint(P, M().ellipse(x - 1, y - 5, 2.2, 1.8).ellipse(x + 2, y - 6, 2.2, 1.8).ellipse(x, y - 8, 1.8, 2.2), [94, 156, 74]);
      break;
    case 'held.icecream':
      paint(P, M().poly([[x - 2, y - 4], [x + 3, y - 4], [x + 0.5, y + 3]]), [232, 179, 90]);
      paint(P, M().ellipse(x + 0.5, y - 6, 3, 2.8), c);
      break;
    case 'held.balloon':
      for (let k = 0; k < 28; k++) P.set(x + (k > 17 ? -1 : 0), y - k, [142, 138, 132]);
      paint(P, M().ellipse(x - 1, y - 34, 5.5, 6.5), c);
      break;
    case 'held.umbrella':
      for (let k = 0; k < 36; k++) P.set(x + 1, y - k, [58, 40, 42]);
      paint(P, M().ellipse(x + 1, y - 36, 19, 9).band(0, y - 35), (px) => (Math.floor((px - x) / 5) % 2 ? c : lightOf(c)));
      break;
  }
}

/* ================================================================== pets & mobility */

function drawPet(P: Pix, L: FullLoadout, pose: Pose) {
  const kind = L.pet.replace('pet.', '');
  if (kind === 'none') return;
  const c = hx(L.petColor);
  const hop = pose === 'walk1' ? -2 : 0;
  const x = 12;
  const y = 98 + hop;
  const eye: RGB = [30, 20, 34];
  switch (kind) {
    case 'cat':
      paint(P, M().ellipse(x, y, 8, 5).capsule(x - 7, y - 2, x - 10, y - 10, 1.6), c);
      paint(P, M().ellipse(x + 7, y - 6, 5, 4.5).poly([[x + 3, y - 9], [x + 4, y - 14], [x + 7, y - 10]]).poly([[x + 8, y - 10], [x + 11, y - 14], [x + 11, y - 8]]), c);
      P.stamp(x + 7, y - 7, ['k.k'], { k: eye });
      break;
    case 'dog':
      paint(P, M().ellipse(x, y, 8.5, 5.5).capsule(x - 7, y - 3, x - 10, y - 7, 1.6), c);
      paint(P, M().ellipse(x + 7, y - 7, 5, 4.5).ellipse(x + 11, y - 5, 3, 2.2), c);
      paint(P, M().ellipse(x + 4, y - 7, 2, 4), shadowOf(c), { rim: false });
      P.stamp(x + 7, y - 8, ['k..', '...', '..kk'], { k: eye });
      break;
    case 'duck':
      paint(P, M().ellipse(x, y - 1, 7, 5), c);
      paint(P, M().ellipse(x + 5, y - 8, 4, 4), c);
      P.stamp(x + 8, y - 8, ['oo', 'oo'], { o: [255, 159, 28] });
      P.set(x + 6, y - 9, eye);
      break;
    case 'bunny':
      paint(P, M().ellipse(x, y, 7, 5).ellipse(x + 6, y - 6, 4.5, 4).capsule(x + 4, y - 9, x + 3, y - 17, 1.6).capsule(x + 7, y - 9, x + 8, y - 17, 1.6), c);
      P.set(x + 7, y - 7, eye);
      paint(P, M().ellipse(x - 7, y - 2, 2, 2), WHITE, { rim: false });
      break;
    case 'frog':
      paint(P, M().ellipse(x, y - 1, 8, 5), c);
      paint(P, M().ellipse(x - 3, y - 6, 2.6, 2.6).ellipse(x + 3, y - 6, 2.6, 2.6), c);
      P.stamp(x - 3, y - 7, ['k.....k'], { k: eye });
      break;
  }
}

function drawWheelchair(P: Pix, pose: Pose, part: 'back' | 'front') {
  const frame: RGB = [58, 63, 75];
  const metal: RGB = [201, 206, 214];
  if (part === 'back') {
    paint(P, M().rrect(26, 58, 31, 92, 2), frame);
    paint(P, M().rrect(30, 86, 60, 91, 2), frame);
    P.stamp(24, 56, ['mmm'], { m: metal });
    return;
  }
  const cx = 38;
  const cy = 94;
  const rim = M().ellipse(cx, cy, 11, 11).cut(M().ellipse(cx, cy, 9, 9));
  paint(P, rim, [47, 53, 66], { rim: false });
  const hand = M().ellipse(cx, cy, 8.5, 8.5).cut(M().ellipse(cx, cy, 7.5, 7.5));
  paint(P, hand, [142, 150, 163], { rim: false });
  const spin = pose === 'walk1' ? 0.5 : pose === 'walk2' ? 1 : 0;
  for (let k = 0; k < 3; k++) {
    const a = ((k + spin) / 3) * Math.PI;
    for (let r = -7; r <= 7; r++) P.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, metal);
  }
  paint(P, M().ellipse(cx, cy, 1.6, 1.6), frame, { rim: false });
  paint(P, M().capsule(58, 90, 60, 100, 1.3), metal, { rim: false });
  paint(P, M().ellipse(60, 101, 2.5, 2.5), [47, 53, 66], { rim: false });
  paint(P, M().rrect(56, 96, 66, 98, 1), metal, { rim: false });
}

function drawCane(P: Pix, B: Body) {
  const [x, y] = B.handNear;
  for (let yy = y; yy < 104; yy++) P.set(x - 1, yy, [138, 90, 59]);
  P.stamp(x - 1, y - 2, ['bbb.', '...b'], { b: [107, 68, 40] });
}

/* ================================================================== assembly */

export function drawAvatarCanvas(input: AvatarLoadout, facing: Facing, requested: Pose): HTMLCanvasElement {
  const L = normalizeLoadout(input);
  const view: View = facing === 'se' || facing === 'sw' ? 'front' : 'back';
  const wheelchair = L.mobility === 'mob.wheelchair';
  const pose: Pose = wheelchair ? (requested === 'wave' ? 'wave' : 'sit') : requested;
  let B = bodyFor(view, wheelchair ? 'sit' : pose);
  if (wheelchair && pose === 'wave') {
    const wave = bodyFor(view, 'wave');
    B = { ...B, pose: 'wave', armNear: { a: [B.cx - 10, B.shoulderY + 2], b: [B.cx - 17, 47] }, handNear: [B.cx - 18, 43] };
    void wave;
  }
  const P = new Pix();
  const coversHair = !!ITEM_BY_ID.get(L.headwear)?.coversHair;
  const hair = coversHair ? null : hairShapes(L.hair.replace('hair.', ''), B);
  const longHair = ['long', 'wavy', 'locs', 'braids'].includes(L.hair.replace('hair.', ''));

  drawPet(P, L, requested);
  if (wheelchair) drawWheelchair(P, requested, 'back');
  if (hair?.behind) paintHair(P, hair.behind, L, longHair);
  if (view === 'front') drawArm(P, B, L, false);
  drawLegs(P, B, L);
  drawShoes(P, B, L);
  if (view === 'back') drawArm(P, B, L, true);
  drawTorso(P, B, L);
  drawNeckwear(P, B, L);
  drawHead(P, B, L);
  if (view === 'front') drawFace(P, B, L);
  if (hair) paintHair(P, hair.front, L, longHair);
  drawHeadwear(P, B, L);
  drawEyewear(P, B, L);
  drawAccessory(P, B, L);
  if (view === 'front') drawArm(P, B, L, true);
  else drawArm(P, B, L, false);
  if (wheelchair) drawWheelchair(P, requested, 'front');
  drawHeld(P, B, L);
  if (L.mobility === 'mob.cane' && !B.sitting) drawCane(P, B);
  outline(P);

  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(W, H);
  img.data.set(P.d);
  ctx.putImageData(img, 0, 0);
  if (facing === 'sw' || facing === 'nw') {
    const m = makeCanvas(W, H);
    const mctx = m.getContext('2d', { willReadFrequently: true })!;
    mctx.translate(W, 0);
    mctx.scale(-1, 1);
    mctx.drawImage(c, 0, 0);
    return m;
  }
  return c;
}

const cache = new Map<string, Sprite>();

export function avatarKey(L: AvatarLoadout): string {
  const n = normalizeLoadout(L);
  return Object.keys(n)
    .sort()
    .map((k) => n[k as keyof FullLoadout])
    .join('|');
}

export function avatarSprite(L: AvatarLoadout, facing: Facing, pose: Pose): Sprite {
  const key = `${avatarKey(L)}|${facing}|${pose}`;
  let s = cache.get(key);
  if (!s) {
    const canvas = drawAvatarCanvas(L, facing, pose);
    const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] ? 1 : 0;
    const ax = facing === 'sw' || facing === 'nw' ? W - AVATAR_ANCHOR.x : AVATAR_ANCHOR.x;
    s = { canvas, ax, ay: AVATAR_ANCHOR.y, mask, scale: DENSITY };
    cache.set(key, s);
    if (cache.size > 3000) cache.clear();
  }
  return s;
}

export function usesWheelchair(L: AvatarLoadout): boolean {
  return L.mobility === 'mob.wheelchair';
}
