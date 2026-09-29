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
export const AVATAR_ANCHOR = { x: 44, y: 104 };

/** Crop rectangles (canvas px) for UI previews. */
export const AVATAR_CROPS = {
  head: { x: 22, y: 8, w: 46, h: 44 },
  face: { x: 27, y: 14, w: 38, h: 36 },
  bust: { x: 18, y: 8, w: 52, h: 62 },
  torso: { x: 20, y: 44, w: 48, h: 40 },
  legs: { x: 20, y: 70, w: 48, h: 38 },
  /** The person without the extra padding (pets and umbrellas may be clipped). */
  body: { x: 16, y: 6, w: 58, h: 102 },
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
      else if (o.rim !== false && (!m.has(x - 1, y) || !m.has(x, y - 1))) c = lightOf(base);
      else if (!o.flat && t > 0.42 - bias) c = shadowOf(base);
      else if (!o.flat && t < -0.62) c = lightOf(base);
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
      P.set(x, y, mix(avg, PLUM, 0.72));
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
  /** Torso outline (shoulders → waist). */
  torso: Array<[number, number]>;
  shoulderY: number;
  waistY: number;
  hipY: number;
  /** Arms: shoulder → hand; hand centre. */
  armNear: Limb;
  armFar: Limb;
  handNear: [number, number];
  handFar: [number, number];
  /** Legs: hip → knee → ankle. */
  legs: Array<{ hip: [number, number]; knee: [number, number]; ankle: [number, number]; heel?: boolean }>;
  sitting: boolean;
}

function bodyFor(view: View, pose: Pose): Body {
  const sitting = pose === 'sit';
  const walk = pose === 'walk1' ? 1 : pose === 'walk2' ? -1 : 0;
  const dy = sitting ? 9 : walk ? 1 : 0;
  // Chibi but grown-up: a big head (~38% of height) sitting right on real shoulders.
  const hxC = 45;
  const hyC = 33 + dy;
  const sY = 51 + dy;
  const wY = 72 + dy;
  const torso: Array<[number, number]> = [
    [31, sY],
    [59, sY],
    [62, sY + 4],
    [58, wY],
    [32, wY],
    [28, sY + 4],
  ];
  // Arms swing opposite the legs.
  const swingN = walk * -4;
  const swingF = walk * 4;
  let handNear: [number, number] = [29 + swingN, 75 + dy];
  let handFar: [number, number] = [61 + swingF, 74 + dy];
  let armNear: Limb = { a: [31, sY + 4], b: [29 + swingN * 0.8, 70 + dy] };
  let armFar: Limb = { a: [59, sY + 4], b: [61 + swingF * 0.8, 69 + dy] };
  if (sitting) {
    handNear = [44, 82];
    handFar = [56, 81];
    armNear = { a: [31, sY + 4], b: [39, 78] };
    armFar = { a: [59, sY + 4], b: [56, 76] };
  }
  if (pose === 'wave') {
    armNear = { a: [31, sY + 3], b: [23, 41 + dy] };
    handNear = [22, 37 + dy];
  }
  const hipY = 79 + dy;
  let legs: Body['legs'];
  if (sitting && view === 'back') {
    // facing away: the knees point into the room, mostly hidden by the body
    legs = [
      { hip: [38, 84], knee: [52, 80], ankle: [54, 90] },
      { hip: [50, 83], knee: [62, 78], ankle: [63, 88] },
    ];
  } else if (sitting) {
    legs = [
      { hip: [38, 84], knee: [54, 89], ankle: [55, 99] },
      { hip: [50, 83], knee: [62, 87], ankle: [63, 97] },
    ];
  } else if (walk === 1) {
    legs = [
      { hip: [39, hipY], knee: [42, 89], ankle: [45, 98] },
      { hip: [51, hipY], knee: [49, 89], ankle: [45, 96], heel: true },
    ];
  } else if (walk === -1) {
    legs = [
      { hip: [39, hipY], knee: [37, 89], ankle: [34, 96], heel: true },
      { hip: [51, hipY], knee: [54, 89], ankle: [57, 98] },
    ];
  } else {
    legs = [
      { hip: [39, hipY], knee: [39, 89], ankle: [39, 98] },
      { hip: [51, hipY], knee: [51, 89], ankle: [51, 98] },
    ];
  }
  return { view, pose, hx: hxC, hy: hyC, rx: 17.5, ry: 16.5, torso, shoulderY: sY, waistY: wY, hipY, armNear, armFar, handNear, handFar, legs, sitting };
}

function headMask(B: Body): Mask {
  if (B.view === 'back') return M().ellipse(B.hx, B.hy, B.rx, B.ry);
  // soft, full cheeks toward the side we face
  return M().ellipse(B.hx, B.hy, B.rx, B.ry).ellipse(B.hx + 2, B.hy + 5, B.rx - 2, B.ry - 5);
}

/** The face window a hairstyle leaves open (front view). `top` lowers the hairline (bangs). */
function faceWindow(B: Body, top = 0, left = 0): Mask {
  return M().ellipse(B.hx + 3 + left * 0.5, B.hy + 5 + top * 0.5, B.rx - 3 - left * 0.5, B.ry - 4.5 - top * 0.5);
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
  const cap = (grow = 1.5, down = 4) => M().ellipse(x, y - 1, rx + grow, ry + grow * 0.6).band(0, y + (back ? Math.max(down, 2) + 10 : down));
  const win = (top = 0, left = 0) => faceWindow(B, top, left);
  const bumps = (m: Mask, r: number, cy: number, span: number, n: number, ry2 = r) => {
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (i / n) * Math.PI;
      m.ellipse(x + Math.cos(a) * span, cy + Math.sin(a) * span * 0.9, r, ry2);
    }
    return m;
  };
  const long = (to: number, wave = 0) => {
    const m = M().ellipse(x - 1, y, rx + 2.5, ry + 1);
    m.poly([
      [x - rx - 3, y],
      [x + rx - 2, y],
      [x + rx - 1 + wave, to],
      [x - rx - 4 - wave, to],
    ]);
    if (wave) for (let yy = y + 6; yy < to; yy += 6) m.ellipse(x - rx - 3 + ((yy / 6) % 2) * 2, yy, 3, 3).ellipse(x + rx - 1 - ((yy / 6) % 2) * 2, yy, 3, 3);
    return m;
  };
  switch (style) {
    case 'none':
      return null;
    case 'buzz':
      return { front: back ? cap(0.6, 8) : cap(0.6, 0).cut(win(-2)) };
    case 'short':
    case 'crop': {
      const m = cap(style === 'crop' ? 1 : 1.6, 2);
      if (!back) m.cut(win(style === 'crop' ? -1 : 0));
      if (!back) m.ellipse(x - rx + 2, y + 3, 2.5, 5); // sideburn
      return { front: m };
    }
    case 'pixie': {
      const m = cap(1.8, 3);
      if (!back) {
        m.cut(win(2));
        m.poly([
          [x - 6, y - 12],
          [x + 12, y - 9],
          [x + 14, y - 3],
          [x + 2, y - 5],
        ]);
      }
      return { front: m };
    }
    case 'sidepart':
    case 'swoop': {
      const m = cap(2, 3);
      if (!back) {
        m.cut(win(style === 'swoop' ? 3 : 1));
        if (style === 'swoop')
          m.poly([
            [x - 10, y - 13],
            [x + 16, y - 11],
            [x + 17, y - 1],
            [x + 8, y - 6],
            [x - 2, y - 8],
          ]);
        else m.ellipse(x + 6, y - 11, 11, 5);
      }
      return { front: m };
    }
    case 'undercut':
    case 'mohawk': {
      const m =
        style === 'mohawk'
          ? M().ellipse(x - 1, y - ry - 1, 4, 8).ellipse(x - 1, y - ry + 4, 4.5, 6)
          : M().ellipse(x + 2, y - ry + 3, rx - 1, 7).ellipse(x + 8, y - ry + 6, 9, 5);
      if (!back && style === 'undercut') m.cut(win(-1));
      return { front: m };
    }
    case 'curlyshort':
    case 'curly': {
      const big = style === 'curly';
      const m = bumps(cap(2, big ? 8 : 2), big ? 5 : 4, y - 2, rx + (big ? 1 : 0), 9);
      if (big) m.ellipse(x - rx, y + 6, 5, 7).ellipse(x + rx - 1, y + 5, 4, 6);
      if (!back) m.cut(win(big ? 1 : 0));
      return { front: m };
    }
    case 'afro': {
      const m = bumps(M().ellipse(x - 1, y - 4, rx + 7, ry + 5), 5, y - 4, rx + 6, 12);
      if (!back) m.cut(win(1));
      return { front: m };
    }
    case 'bob':
    case 'bangs': {
      const m = M().ellipse(x - 1, y, rx + 2.5, ry + 1).rect(x - rx - 3, y, x + rx + 1, y + 12);
      m.band(0, y + 13);
      if (!back) m.cut(win(style === 'bangs' ? 5 : 1));
      if (!back && style === 'bangs') m.cut(M().rect(x - 2, y + 1, x + 14, y + 14));
      return { front: m };
    }
    case 'mullet': {
      const m = cap(1.6, 2);
      if (!back) m.cut(win(0));
      const tail = M().poly([
        [x - rx - 1, y],
        [x - rx + 8, y],
        [x - rx + 9, y + 24],
        [x - rx - 3, y + 22],
      ]);
      return { front: m, behind: tail };
    }
    case 'long':
    case 'wavy': {
      const behind = long(y + 36, style === 'wavy' ? 1 : 0);
      const m = cap(2.5, 4);
      if (!back) {
        m.cut(win(1));
        m.ellipse(x - rx + 1, y + 8, 4, 12);
      } else m.add(behind);
      return { front: m, behind: back ? undefined : behind };
    }
    case 'ponytail': {
      const m = cap(1.8, 3);
      if (!back) m.cut(win(0));
      const tail = M().ellipse(x - rx - 2, y - 2, 5, 5).capsule(x - rx - 4, y + 2, x - rx - 6, y + 22, 4);
      return { front: m, behind: back ? undefined : tail, ...(back ? { front: m.add(tail) } : {}) };
    }
    case 'pigtails': {
      const m = cap(1.8, 3);
      if (!back) m.cut(win(1));
      const tails = M().capsule(x - rx - 3, y + 2, x - rx - 5, y + 20, 4).capsule(x + rx + 2, y + 1, x + rx + 4, y + 18, 3.5);
      m.add(tails);
      return { front: m };
    }
    case 'bun':
    case 'spacebuns': {
      const m = cap(1.6, 3);
      if (!back) m.cut(win(0));
      if (style === 'bun') m.ellipse(x - 1, y - ry - 4, 7, 6);
      else m.ellipse(x - 10, y - ry + 1, 5.5, 5.5).ellipse(x + 11, y - ry + 2, 5.5, 5.5);
      return { front: m };
    }
    case 'braids': {
      const m = cap(1.8, 3);
      if (!back) m.cut(win(1));
      const b = M();
      for (let k = 0; k < 5; k++) {
        b.ellipse(x - rx - 1, y + 4 + k * 5, 3.5, 3);
        b.ellipse(x + rx, y + 3 + k * 5, 3, 3);
      }
      m.add(b);
      return { front: m };
    }
    case 'locs': {
      const m = cap(2.5, 4);
      if (!back) m.cut(win(1));
      const behind = M();
      for (let k = -3; k <= 3; k++) behind.capsule(x + k * 5, y - 4, x + k * 5.5, y + 26 - Math.abs(k) * 2, 2.6);
      return { front: back ? m.add(behind) : m, behind: back ? undefined : behind };
    }
    default: {
      const m = cap(1.6, 2);
      if (!back) m.cut(win(0));
      return { front: m };
    }
  }
}

/** Hair shading adds a lighter strand band and optional two-tone tips. */
function paintHair(P: Pix, m: Mask, L: FullLoadout, strands: boolean) {
  const base = hx(L.hairColor);
  const tip = L.hairHighlight ? hx(L.hairHighlight) : null;
  const b = m.bbox();
  if (!b) return;
  const [, y0, , y1] = b;
  paint(P, m, (x, y) => {
    let c = base;
    if (tip) {
      const k = (y - y0) / Math.max(1, y1 - y0);
      if (y1 - y0 > 34 ? k > 0.68 : k < 0.2) c = mix(base, tip, 0.8);
    }
    if (strands && (x * 3 + y) % 11 === 0) c = shadowOf(c);
    return c;
  });
  // shine: a soft highlight on the crown, toward the light
  const [x0, , x1] = b;
  const shine = M().ellipse(x0 + (x1 - x0) * 0.36, y0 + 6, Math.max(3, (x1 - x0) * 0.16), 2.4).keep(m);
  const shineIn = M().ellipse(x0 + (x1 - x0) * 0.36, y0 + 6, Math.max(2, (x1 - x0) * 0.16) - 1.5, 1.2).keep(m);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!shine.has(x, y) || !m.has(x, y - 1) || !m.has(x - 1, y)) continue;
      P.set(x, y, shineIn.has(x, y) ? lightOf(lightOf(base)) : lightOf(base));
    }
}

/* ================================================================== face */

function drawFace(P: Pix, B: Body, L: FullLoadout) {
  const skin = hx(L.skin);
  const x = B.hx;
  const y = B.hy;
  const dark: RGB = mix(PLUM, [20, 12, 22], 0.3);
  const iris = hx(L.eyeColor);
  const irisC = lum(iris) < 0.25 ? dark : iris;
  const ey = y + 3;
  const en = x - 5; // near eye (left)
  const ef = x + 8; // far eye (right, foreshortened)
  const pal: Record<string, RGB> = { c: irisC, k: dark, w: WHITE, p: PINK };
  const eyes = L.eyes.replace('eyes.', '');
  const eyeNear: Record<string, string[]> = {
    dot: ['.kkk.', 'kwwck', 'kwcck', 'kccck', 'kccwk', '.kkk.'],
    wide: ['.kkk.', 'kwwck', 'kwwck', 'kccck', 'kccck', 'kccwk', '.kkk.'],
    lashes: ['k.....', '.kkkk.', '.kwwck', '.kwcck', '.kccck', '.kccwk', '..kkk.'],
    happy: ['.kkk.', 'k...k', 'k...k'],
    sleepy: ['kkkkk', 'kccck', '.kkk.'],
    wink: ['.kkk.', 'kwwck', 'kwcck', 'kccck', 'kccwk', '.kkk.'],
    sparkle: ['.kkk.', 'kwkwk', 'kkwck', 'kccck', 'kcwck', '.kkk.'],
  };
  const eyeFar: Record<string, string[]> = {
    dot: ['.kk.', 'wwck', 'wcck', 'ccck', 'ccwk', '.kk.'],
    wide: ['.kk.', 'wwck', 'wwck', 'ccck', 'ccck', 'ccwk', '.kk.'],
    lashes: ['....k', '.kkk.', 'wwck.', 'wcck.', 'ccck.', 'ccwk.', '.kk..'],
    happy: ['.kk.', 'k..k', 'k..k'],
    sleepy: ['kkkk', 'ccck', '.kk.'],
    wink: ['.kk.', 'k..k', '....'],
    sparkle: ['.kk.', 'wkwk', 'kwck', 'ccck', 'cwck', '.kk.'],
  };
  const near = eyeNear[eyes] ?? eyeNear.dot;
  const far = eyeFar[eyes] ?? eyeFar.dot;
  const eyeTop = ey - Math.floor(near.length / 2);
  P.stamp(en - 2, eyeTop, near, pal);
  P.stamp(ef - 2, eyeTop + Math.round((near.length - far.length) / 2), far, pal);
  // brows
  const brow = mix(hx(L.hairColor), dark, 0.35);
  const by = eyeTop - 3;
  if (L.brows === 'brows.bold') {
    P.stamp(en - 3, by - 1, ['bbbb..', '.bbbbb'], { b: brow });
    P.stamp(ef - 2, by - 1, ['bbbb', 'bbb.'], { b: brow });
  } else if (L.brows !== 'brows.none') {
    P.stamp(en - 2, by, ['.bbb.'], { b: brow });
    P.stamp(ef - 2, by, ['bbb'], { b: brow });
  }
  // nose: a single shade pixel
  P.set(x + 6, y + 8, shadowOf(skin));
  // cheeks: always a little warmth, a proper blush when chosen
  const warm = mix(skin, [255, 120, 140], 0.18);
  const blush = mix(skin, [255, 110, 130], 0.5);
  const cheek = L.faceDetail === 'fd.blush' || eyes === 'happy' ? blush : warm;
  P.stamp(en - 3, y + 9, ['bbb'], { b: cheek });
  P.stamp(ef + 1, y + 9, ['bb'], { b: cheek });
  if (L.faceDetail === 'fd.freckles') {
    const fr = mix(skin, [120, 70, 40], 0.35);
    P.stamp(en - 3, y + 6, ['f.f', '.f.'], { f: fr });
    P.stamp(ef, y + 6, ['f.', '.f'], { f: fr });
  }
  if (L.faceDetail === 'fd.mole') P.set(x + 9, y + 10, mix(skin, dark, 0.7));
  if (L.faceDetail === 'fd.bandaid') P.stamp(x + 3, y + 5, ['tttt', 'tdtt', 'tttt'], { t: [236, 196, 150], d: [200, 150, 110] });
  // facial hair
  const fh = L.facialHair.replace('fh.', '');
  const hairC = hx(L.hairColor);
  if (fh === 'beard') {
    const m = M().ellipse(x + 2, y + 9, B.rx - 3, 7.5).cut(M().rect(0, 0, W, y + 5)).keep(headMask(B).add(M().ellipse(x + 2, y + 12, 12, 6)));
    paint(P, m, hairC, { rim: false });
  } else if (fh === 'goatee') {
    paint(P, M().ellipse(x + 4, y + 13, 3.5, 3), hairC, { rim: false });
  } else if (fh === 'stubble') {
    const m = M().ellipse(x + 2, y + 9, B.rx - 3, 7).cut(M().rect(0, 0, W, y + 6)).keep(headMask(B));
    const s = mix(skin, hairC, 0.45);
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (m.has(xx, yy) && (xx + yy) % 2 === 0) P.set(xx, yy, s);
  }
  if (fh === 'mustache' || fh === 'beard') P.stamp(x + 1, y + 10, ['.mmmmm.', 'mm...mm'], { m: fh === 'beard' ? shadowOf(hairC) : hairC });
  // mouth
  const mouthC = mix(skin, [70, 20, 40], 0.62);
  const mx = x + 2;
  const my = y + 11;
  const mpal: Record<string, RGB> = { m: mouthC, w: WHITE, t: [236, 110, 130], d: [120, 30, 50] };
  const mouths: Record<string, string[]> = {
    smile: ['m....m', '.mmmm.'],
    grin: ['mmmmmm', 'mwwwwm', '.mttm.'],
    neutral: ['.mmmm.'],
    smirk: ['.....m', 'mmmmm.'],
    o: ['.mm.', 'mddm', '.mm.'],
    tongue: ['m....m', '.mmmm.', '..tt..'],
  };
  P.stamp(mx, my, mouths[L.mouth.replace('mouth.', '')] ?? mouths.smile, mpal);
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
        if (y % 6 < 2) c = acc;
        break;
      case 'pat.dots':
        if (x % 5 === 1 && y % 5 === 1) c = acc;
        else if (x % 5 === 2 && y % 5 === 1) c = acc;
        break;
      case 'pat.check':
        if ((Math.floor(x / 3) + Math.floor(y / 3)) % 2) c = mix(base, acc, 0.4);
        break;
      case 'pat.flannel': {
        const a = x % 8 < 3;
        const b = y % 8 < 3;
        if (a && b) c = mix(base, PLUM, 0.45);
        else if (a || b) c = mix(base, PLUM, 0.22);
        if (x % 8 === 6 || y % 8 === 6) c = mix(c, acc, 0.35);
        break;
      }
      case 'pat.stars':
        if ((x * 7 + y * 13) % 29 === 0 || ((x - 1) * 7 + y * 13) % 29 === 0) c = acc;
        break;
      case 'pat.hearts':
        if ((x * 5 + y * 11) % 31 === 0) c = [226, 76, 120];
        break;
    }
    if (knit && x % 3 === 0) c = mix(c, PLUM, 0.1);
    if (top === 'top.puffer' && y % 6 === 0) c = shadowOf(c);
    return c;
  };
}

function topColorFor(L: FullLoadout): RGB {
  if (L.top === 'top.labcoat') return [246, 244, 240];
  return hx(L.topColor);
}

function sleeveMask(arm: Limb, long: boolean, puffy: boolean): Mask {
  const r = puffy ? 5.8 : 5;
  if (long) return M().capsule(arm.a[0], arm.a[1], arm.b[0], arm.b[1], r);
  const mid: [number, number] = [arm.a[0] + (arm.b[0] - arm.a[0]) * 0.42, arm.a[1] + (arm.b[1] - arm.a[1]) * 0.42];
  return M().capsule(arm.a[0], arm.a[1], mid[0], mid[1], r + 0.4);
}

function drawArm(P: Pix, B: Body, L: FullLoadout, near: boolean) {
  const arm = near ? B.armNear : B.armFar;
  const hand = near ? B.handNear : B.handFar;
  const skin = hx(L.skin);
  const top = L.top;
  const long = LONG_SLEEVES.has(top);
  const bare = top === 'top.tank';
  // skin arm underneath (short sleeves and tank tops)
  if (!long) paint(P, M().capsule(arm.a[0], arm.a[1], arm.b[0], arm.b[1], 4.2), skin, { rim: false });
  if (!bare) {
    const base = topColorFor(L);
    const sleeve = sleeveMask(arm, long, top === 'top.puffer');
    const fn = patternFn(L, base, top);
    paint(P, sleeve, fn, { shade: near ? 0 : 0.25 });
    if (long) {
      // cuff
      // a slim cuff band just above the hand
      const cuff = M().capsule(arm.b[0], arm.b[1], arm.b[0], arm.b[1], 5).band(Math.round(arm.b[1]) + 1, Math.round(arm.b[1]) + 3);
      const cuffC = top === 'top.shirt' || top === 'top.blazer' ? mix(hx(L.topAccent), base, 0.35) : shadowOf(base);
      paint(P, cuff.keep(sleeve), cuffC, { rim: false, edge: false });
    }
  }
  // mitten hand
  const [hx0, hy0] = hand;
  const h = M().ellipse(hx0, hy0, 4.3, 4.5);
  if (B.pose === 'wave' && near) h.ellipse(hx0 - 4, hy0 + 1, 1.8, 2.6); // thumb out
  paint(P, h, skin);
}

function drawTorso(P: Pix, B: Body, L: FullLoadout) {
  const top = L.top;
  const base = topColorFor(L);
  const acc = hx(L.topAccent);
  const skin = hx(L.skin);
  const back = B.view === 'back';
  const puffer = top === 'top.puffer';
  const t = M().poly(B.torso);
  if (puffer) t.ellipse(B.hx - 1, B.shoulderY + 6, 16, 8);
  const full = ITEM_BY_ID.get(top)?.fullLength;
  if (full) {
    // dress / long coat: flare to the knee
    const hem = B.sitting ? B.hipY + 8 : 94;
    t.poly([
      [32, B.waistY - 2],
      [57, B.waistY - 2],
      [B.sitting ? 62 : 60, hem],
      [B.sitting ? 34 : 29, hem],
    ]);
  }
  const fn = patternFn(L, base, top);
  paint(P, t, fn);
  const cx = B.hx - 1;
  const sy = B.shoulderY;
  if (back) {
    if (top === 'top.hoodie' || top === 'top.northstar-hoodie' || top === 'top.raincoat') paint(P, M().ellipse(cx, sy + 3, 9, 6), shadowOf(base));
    return;
  }
  // necklines and fronts
  switch (top) {
    case 'top.tee':
    case 'top.aurora-tee':
    case 'top.jersey':
      paint(P, M().ellipse(cx + 2, sy, 5, 3.5), skin, { rim: false });
      P.stamp(cx - 4, sy + 2, ['.aaaaaaaaa.'], { a: shadowOf(base) });
      if (top === 'top.aurora-tee') P.stamp(cx, sy + 9, ['..w..', '.wrw.', '.www.', 'wwwww', '.o.o.'], { w: WHITE, r: [224, 80, 63], o: [255, 138, 61] });
      if (top === 'top.jersey') {
        P.stamp(cx - 3, sy + 1, ['a.......a', '.a.....a.', '..aaaaa..'], { a: acc });
        for (let y = sy + 10; y < sy + 13; y++) for (let x = 33; x < 57; x++) if (t.has(x, y)) P.set(x, y, acc);
      }
      break;
    case 'top.tank':
      paint(P, M().ellipse(cx + 2, sy + 1, 8, 5), skin, { rim: false });
      break;
    case 'top.hoodie':
    case 'top.northstar-hoodie':
      // hood gathered round the neck, drawstrings, kangaroo pocket
      paint(P, M().ellipse(cx + 1, sy - 1, 11, 4.5).cut(M().ellipse(cx + 2, sy - 2, 5, 3)), shadowOf(base), { rim: false });
      P.stamp(cx, sy + 2, ['a...a', 'a...a', 'a...a', 'o...o'], { a: WHITE, o: shadowOf(WHITE) });
      paint(P, M().rrect(cx - 7, B.waistY - 9, cx + 11, B.waistY - 2, 2), shadowOf(base), { rim: false });
      if (top === 'top.northstar-hoodie') P.stamp(cx + 1, sy + 8, ['..g..', 'ggggg', '.ggg.', 'g...g'], { g: GOLD });
      break;
    case 'top.shirt':
    case 'top.flannel': {
      const col = top === 'top.shirt' ? lightOf(base) : shadowOf(base);
      P.stamp(cx - 3, sy - 1, ['cc.....cc', '.ccc.ccc.', '...c.c...'], { c: col });
      for (let y = sy + 3; y < B.waistY - 1; y += 4) P.set(cx + 2, y, top === 'top.shirt' ? acc : WHITE);
      for (let y = sy + 2; y < B.waistY; y++) P.set(cx + 1, y, shadowOf(base));
      break;
    }
    case 'top.sweater':
    case 'top.turtleneck': {
      if (top === 'top.turtleneck') paint(P, M().rrect(cx - 4, sy - 7, cx + 8, sy + 2, 2), mix(base, PLUM, 0.1));
      else paint(P, M().ellipse(cx + 2, sy, 5, 3), skin, { rim: false });
      // ribbed hem
      for (let y = B.waistY - 3; y < B.waistY; y++) for (let x = 30; x < 60; x++) if (t.has(x, y)) P.set(x, y, x % 2 ? shadowOf(base) : base);
      break;
    }
    case 'top.cardigan':
    case 'top.blazer':
    case 'top.labcoat':
    case 'top.kimono': {
      // open front showing the shirt underneath
      const inner = top === 'top.labcoat' ? hx(L.topAccent) : acc;
      const v = M().poly([
        [cx - 3, sy - 1],
        [cx + 7, sy - 1],
        [cx + 4, B.waistY - (top === 'top.kimono' ? 6 : 1)],
        [cx + 1, B.waistY - (top === 'top.kimono' ? 6 : 1)],
      ]);
      paint(P, v.keep(t), inner, { rim: false });
      if (top === 'top.blazer' || top === 'top.labcoat') {
        P.stamp(cx - 4, sy, ['ll.......', '.ll...ll.', '..ll.ll..', '...lll...'], { l: shadowOf(base) });
        P.set(cx + 8, sy + 7, acc); // pocket square
        if (top === 'top.labcoat') P.stamp(cx + 7, sy + 6, ['b', 'b', 'b'], { b: [63, 143, 216] });
      }
      if (top === 'top.kimono') for (let x = 30; x < 60; x++) for (let y = B.waistY - 5; y < B.waistY - 2; y++) if (t.has(x, y)) P.set(x, y, acc);
      if (top === 'top.cardigan') for (let y = sy + 4; y < B.waistY - 1; y += 4) P.set(cx + 5, y, lightOf(acc));
      break;
    }
    case 'top.puffer':
      paint(P, M().rrect(cx - 5, sy - 5, cx + 9, sy + 2, 3), base);
      for (let y = sy; y < B.waistY; y++) P.set(cx + 2, y, deepOf(base));
      break;
    case 'top.overalls':
      paint(P, M().poly(B.torso).band(0, sy + 6), acc, { rim: false });
      paint(P, M().rrect(cx - 7, sy + 6, cx + 11, B.waistY, 2), base);
      P.stamp(cx - 6, sy, ['s..............s', 's..............s', 's..............s', 's..............s', 's..............s', 's..............s'], { s: shadowOf(base) });
      P.stamp(cx - 6, sy + 6, ['g', '.', '.', '.'], { g: GOLD });
      P.stamp(cx + 10, sy + 6, ['g'], { g: GOLD });
      paint(P, M().rrect(cx - 2, sy + 10, cx + 6, sy + 15, 1), shadowOf(base), { rim: false });
      break;
    case 'top.dress':
      paint(P, M().ellipse(cx + 2, sy, 6, 3.5), skin, { rim: false });
      for (let x = 30; x < 60; x++) for (let y = B.waistY - 2; y < B.waistY; y++) if (t.has(x, y)) P.set(x, y, acc);
      break;
    case 'top.raincoat':
      paint(P, M().rrect(cx - 5, sy - 5, cx + 9, sy + 2, 3), base);
      for (let y = sy + 3; y < 92; y += 5) P.stamp(cx + 2, y, ['kk'], { k: deepOf(base) });
      break;
  }
}

function drawLegs(P: Pix, B: Body, L: FullLoadout) {
  const skin = hx(L.skin);
  const pants = hx(L.bottomColor);
  const bottom = L.bottom;
  const full = ITEM_BY_ID.get(L.top)?.fullLength;
  const cover = bottom === 'bottom.shorts' ? 0.42 : bottom === 'bottom.skirt' ? 0.5 : bottom === 'bottom.longskirt' ? 1 : 1;
  const tight = bottom === 'bottom.leggings';
  const r = tight ? 4.2 : bottom === 'bottom.cargo' || bottom === 'bottom.joggers' ? 5.6 : 5.2;
  // far leg first
  const order = [...B.legs].reverse();
  for (const [i, leg] of order.entries()) {
    const far = i === 0;
    const bare = M().capsule(leg.hip[0], leg.hip[1], leg.knee[0], leg.knee[1], 4.2).capsule(leg.knee[0], leg.knee[1], leg.ankle[0], leg.ankle[1], 3.8);
    paint(P, bare, skin, { rim: false, shade: far ? 0.3 : 0 });
    if (bottom === 'bottom.skirt' || bottom === 'bottom.longskirt' || full) continue;
    const pm = M().capsule(leg.hip[0], leg.hip[1], leg.knee[0], leg.knee[1], r);
    if (cover > 0.5) pm.capsule(leg.knee[0], leg.knee[1], leg.ankle[0], leg.ankle[1] - (bottom === 'bottom.joggers' ? 2 : 0), r - 0.4);
    else pm.band(0, Math.round(leg.hip[1] + (leg.knee[1] - leg.hip[1]) * 0.9));
    paint(P, pm, pants, { shade: far ? 0.3 : 0 });
    if (bottom === 'bottom.jeans') {
      // rolled cuff and outer seam
      const cuff = M().capsule(leg.ankle[0], leg.ankle[1] - 2, leg.ankle[0], leg.ankle[1] - 1, r).keep(pm);
      paint(P, cuff, lightOf(pants), { rim: false });
    }
    if (bottom === 'bottom.joggers') paint(P, M().capsule(leg.ankle[0], leg.ankle[1] - 3, leg.ankle[0], leg.ankle[1] - 1, r - 1.2), shadowOf(pants), { rim: false });
    if (bottom === 'bottom.cargo' && !far) paint(P, M().rrect(leg.knee[0] - 5, leg.knee[1] - 7, leg.knee[0] - 1, leg.knee[1] - 1, 1), shadowOf(pants), { rim: false });
    if (bottom === 'bottom.chinos') for (let y = Math.round(leg.hip[1] + 2); y < leg.ankle[1] - 2; y++) P.set(Math.round(leg.hip[0] + ((leg.ankle[0] - leg.hip[0]) * (y - leg.hip[1])) / (leg.ankle[1] - leg.hip[1])) + 1, y, shadowOf(pants));
  }
  // hips / waistband
  if (!full && bottom !== 'bottom.skirt' && bottom !== 'bottom.longskirt') {
    const hips = B.sitting ? M().rrect(33, B.hipY - 6, 58, B.hipY + 5, 4) : M().rrect(33, B.waistY - 1, 57, B.hipY + 4, 3);
    paint(P, hips, pants);
    if (bottom === 'bottom.joggers') P.stamp(44, B.waistY + 1, ['w.w', 'w.w'], { w: WHITE });
  }
  if (bottom === 'bottom.skirt' || bottom === 'bottom.longskirt') {
    const hem = bottom === 'bottom.longskirt' ? (B.sitting ? B.hipY + 14 : 99) : B.sitting ? B.hipY + 8 : 91;
    const sk = M().poly([
      [34, B.waistY - 1],
      [56, B.waistY - 1],
      [B.sitting ? 64 : 60, hem],
      [B.sitting ? 34 : 29, hem],
    ]);
    paint(P, sk, (x) => (x % 5 === 0 ? shadowOf(pants) : pants));
  }
}

function drawShoes(P: Pix, B: Body, L: FullLoadout) {
  const kind = L.shoes.replace('shoes.', '');
  const c = hx(L.shoesColor);
  const back = B.view === 'back';
  const order = [...B.legs].reverse();
  for (const [i, leg] of order.entries()) {
    const far = i === 0;
    const [ax, ay] = leg.ankle;
    const toe = back ? -1 : 1;
    const x0 = ax - 4;
    const y0 = ay - 1;
    const tall = kind === 'boots' ? 7 : kind === 'rainboots' ? 10 : kind === 'hightops' ? 5 : 0;
    const shoe = M().rrect(x0 - (toe < 0 ? 3 : 0), y0, x0 + 9 + (toe > 0 ? 3 : 0), y0 + 6, 3);
    if (tall) shoe.rect(ax - 4, y0 - tall, ax + 4, y0 + 2);
    if (leg.heel) shoe.rect(0, 0, W, 0);
    const soleY = y0 + 5;
    let upper = c;
    if (kind === 'slippers') upper = lightOf(c);
    if (kind === 'sandals') {
      paint(P, M().rrect(x0, y0 + 1, x0 + 11, y0 + 6, 2), hx(L.skin), { rim: false });
      P.stamp(x0 + 2, y0 + 2, ['cccccc', '.....c'], { c });
      P.stamp(x0, soleY, ['sssssssssss'], { s: [120, 80, 50] });
      continue;
    }
    paint(P, shoe, upper, { shade: far ? 0.25 : 0 });
    // soles and details
    const soleC: RGB = kind === 'sneakers' || kind === 'hightops' || kind === 'skates' ? WHITE : kind === 'heels' || kind === 'loafers' ? [58, 40, 42] : deepOf(c);
    for (let x = 0; x < W; x++) if (shoe.has(x, soleY)) P.set(x, soleY, soleC);
    if (kind === 'sneakers' || kind === 'hightops') P.stamp(x0 + (toe > 0 ? 3 : 2), y0 + 2, ['wwww'], { w: WHITE });
    if (kind === 'hightops') P.stamp(ax - 2, y0 - 4, ['w.w', '.w.', 'w.w'], { w: WHITE });
    if (kind === 'rainboots') P.stamp(ax - 3, y0 - 8, ['l', 'l', 'l', 'l', 'l'], { l: lightOf(lightOf(c)) });
    if (kind === 'heels') P.stamp(x0 + (toe > 0 ? 1 : 9), y0 + 6, ['k', 'k'], { k: [58, 40, 42] });
    if (kind === 'loafers') P.stamp(x0 + (toe > 0 ? 6 : 2), y0 + 1, ['gg'], { g: GOLD });
    if (kind === 'skates')
      for (const wx of [x0 + 1, x0 + 5, x0 + 9]) paint(P, M().ellipse(wx, y0 + 7, 1.6, 1.6), [255, 138, 61], { rim: false });
    if (kind === 'slippers') for (let x = x0; x < x0 + 12; x += 2) P.set(x, y0, WHITE);
  }
}

/* ================================================================== head, hair, hats, glasses */

function drawHead(P: Pix, B: Body, L: FullLoadout) {
  const skin = hx(L.skin);
  // neck, shaded under the chin
  paint(P, M().rrect(B.hx - 5, B.hy + 13, B.hx + 5, B.shoulderY + 2, 2), shadowOf(skin), { rim: false });
  const head = headMask(B);
  paint(P, head, skin, { shade: -0.05 });
  if (B.view === 'front') {
    // ear on the near side
    paint(P, M().ellipse(B.hx - B.rx + 1, B.hy + 3, 2.6, 3.4), skin, { rim: false });
    P.set(B.hx - B.rx + 1, B.hy + 3, shadowOf(skin));
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
    case 'beanie': {
      const m = M().ellipse(x, y - 3, rx + 2, ry - 1).band(0, y - 4);
      paint(P, m, (px) => (px % 3 === 0 ? shadowOf(c) : c));
      paint(P, M().rrect(x - rx - 2, y - 7, x + rx + 2, y - 2, 2), lightOf(c));
      paint(P, M().ellipse(x - 1, top - 3, 4, 3.5), WHITE);
      break;
    }
    case 'cap':
    case 'capback': {
      const d = hat === 'cap' ? dir : -dir;
      paint(P, M().ellipse(x, y - 4, rx + 1.5, ry - 2).band(0, y - 4), c);
      paint(P, M().ellipse(x + d * (rx + 2), y - 5, 10, 3).band(y - 6, H), shadowOf(c));
      P.set(x - 1, top - 1, lightOf(c));
      break;
    }
    case 'bucket':
      paint(P, M().ellipse(x, y - 6, rx - 1, ry - 4).band(0, y - 4), c);
      paint(P, M().ellipse(x, y - 4, rx + 6, 4.5), shadowOf(c));
      break;
    case 'beret':
      paint(P, M().ellipse(x - 3 * dir, top + 3, rx + 3, 5.5), c);
      P.set(x - 3 * dir, top - 3, shadowOf(c));
      break;
    case 'headband':
      paint(P, M().ellipse(x, y - 2, rx + 1, ry).band(y - 9, y - 5), c, { rim: false });
      break;
    case 'bow':
      paint(P, M().ellipse(x - 8, top + 1, 6, 4.5).ellipse(x + 4, top - 1, 6, 4.5), c);
      paint(P, M().ellipse(x - 2, top, 2.5, 2.5), shadowOf(c));
      break;
    case 'catears':
      paint(P, M().poly([[x - 13, top + 5], [x - 11, top - 5], [x - 4, top + 2]]).poly([[x + 4, top + 1], [x + 11, top - 6], [x + 14, top + 5]]), c);
      P.stamp(x - 11, top - 1, ['p', 'pp'], { p: PINK });
      break;
    case 'flowers': {
      const cols: RGB[] = [PINK, GOLD, [159, 220, 255], WHITE];
      for (let k = 0; k < 7; k++) {
        const a = Math.PI * (1.05 + (k / 6) * 0.9);
        const fx = x + Math.cos(a) * (rx + 0.5);
        const fy = y - 2 + Math.sin(a) * (ry - 1);
        paint(P, M().ellipse(fx, fy, 2.6, 2.4), cols[k % cols.length], { rim: false });
        P.set(fx, fy, GOLD);
      }
      break;
    }
    case 'headphones':
      paint(P, M().ellipse(x, y - 2, rx + 2.5, ry + 1.5).cut(M().ellipse(x, y - 1, rx + 0.5, ry)).band(0, y), [58, 58, 70]);
      if (!back) paint(P, M().rrect(x - rx - 3, y - 3, x - rx + 4, y + 8, 3), c);
      else paint(P, M().rrect(x + rx - 4, y - 3, x + rx + 3, y + 8, 3), c);
      break;
    case 'cowboy':
      paint(P, M().rrect(x - 11, top - 5, x + 11, y - 5, 4), c);
      paint(P, M().ellipse(x, y - 5, rx + 9, 4).cut(M().ellipse(x, y - 8, rx + 4, 2.5)), shadowOf(c));
      paint(P, M().rect(x - 11, y - 9, x + 11, y - 7), deepOf(c), { rim: false });
      break;
    case 'crown': {
      const m = M().rect(x - 10, top - 1, x + 10, top + 5).poly([[x - 10, top], [x - 10, top - 6], [x - 5, top]]).poly([[x - 3, top], [x, top - 8], [x + 3, top]]).poly([[x + 5, top], [x + 10, top - 6], [x + 10, top]]);
      paint(P, m, GOLD);
      P.stamp(x - 7, top + 1, ['r....b....r'], { r: [224, 80, 63], b: [63, 143, 216] });
      break;
    }
    case 'hijab': {
      const m = M().ellipse(x, y + 1, rx + 3, ry + 3).rrect(x - rx - 2, y + 4, x + rx + 3, B.shoulderY + 8, 6);
      if (!back) m.cut(faceWindow(B, 1, 2));
      paint(P, m, c);
      if (!back) paint(P, M().ellipse(x + 3, y + 5, B.rx - 2.5, B.ry - 3.5).cut(faceWindow(B, 1, 2)).band(0, y + 9), shadowOf(c), { rim: false });
      break;
    }
    case 'turban': {
      const m = M().ellipse(x - 1, y - 5, rx + 3, ry - 2).band(0, y - 1);
      if (back) m.ellipse(x, y, rx + 1.5, ry + 0.5).band(0, y + 10);
      paint(P, m, (px, py) => ((px + py * 2) % 9 < 2 ? shadowOf(c) : c));
      break;
    }
    case 'party': {
      const m = M().poly([[x - 9, top + 4], [x + 3, top - 16], [x + 9, top + 4]]);
      paint(P, m, (px, py) => ((px + py) % 6 < 3 ? c : WHITE));
      paint(P, M().ellipse(x + 3, top - 17, 3, 3), GOLD);
      break;
    }
  }
}

function drawEyewear(P: Pix, B: Body, L: FullLoadout) {
  const kind = L.eyewear.replace('eye.', '');
  if (kind === 'none' || B.view === 'back') return;
  const y = B.hy + 2;
  const nx = B.hx - 4;
  const fx = B.hx + 8;
  const frame: RGB = kind === 'heart' ? [226, 76, 156] : kind === 'star' ? GOLD : [42, 32, 44];
  const ring = (cx: number, cy: number, rx: number, ry: number, lens?: RGB, alpha = 255) => {
    const outer = M().ellipse(cx, cy, rx, ry);
    const inner = M().ellipse(cx, cy, rx - 1, ry - 1);
    if (lens) for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (inner.has(xx, yy)) P.set(xx, yy, lens, alpha);
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (outer.has(xx, yy) && !inner.has(xx, yy)) P.set(xx, yy, frame);
  };
  switch (kind) {
    case 'round':
      ring(nx, y, 4.5, 4.5);
      ring(fx, y, 3.5, 4.5);
      break;
    case 'square':
      P.stamp(nx - 4, y - 3, ['fffffffff', 'f.......f', 'f.......f', 'f.......f', 'f.......f', 'fffffffff'], { f: frame });
      P.stamp(fx - 3, y - 3, ['fffffff', 'f.....f', 'f.....f', 'f.....f', 'f.....f', 'fffffff'], { f: frame });
      break;
    case 'sun':
    case '3d':
      ring(nx, y, 4.5, 4, kind === 'sun' ? [30, 26, 40] : [224, 60, 70], 230);
      ring(fx, y, 3.5, 4, kind === 'sun' ? [30, 26, 40] : [60, 190, 220], 230);
      if (kind === 'sun') P.set(nx - 2, y - 2, WHITE);
      break;
    case 'heart':
    case 'star':
      P.stamp(nx - 4, y - 3, kind === 'heart' ? ['.ff.ff.', 'fffffff', 'fffffff', '.fffff.', '..fff..', '...f...'] : ['...f...', '..fff..', 'fffffff', '.fffff.', '.ff.ff.', 'f.....f'], { f: frame });
      P.stamp(fx - 3, y - 3, kind === 'heart' ? ['ff.f', 'ffff', 'ffff', '.ff.', '..f.'] : ['..f.', '.fff', 'ffff', '.ff.', 'f..f'], { f: frame });
      break;
    case 'monocle':
      ring(fx, y, 4, 4.5);
      for (let k = 0; k < 8; k++) P.set(fx + 3 + (k % 2), y + 4 + k, GOLD_D);
      return;
    case 'goggles':
      paint(P, M().ellipse(B.hx, y - 1, B.rx + 0.5, 2).band(y - 2, y + 1), [80, 70, 60], { rim: false });
      ring(nx, y, 5, 4.5, [159, 220, 255], 200);
      ring(fx, y, 4, 4.5, [159, 220, 255], 200);
      return;
  }
  // bridge and arm
  for (let x = nx + 4; x < fx - 3; x++) P.set(x, y - 1, frame);
  for (let x = B.hx - B.rx + 2; x < nx - 4; x++) P.set(x, y - 1, frame);
}

function drawNeckwear(P: Pix, B: Body, L: FullLoadout) {
  const kind = L.neck.replace('neck.', '');
  if (kind === 'none') return;
  const c = hx(L.neckColor);
  const cx = B.hx;
  const sy = B.shoulderY;
  const back = B.view === 'back';
  switch (kind) {
    case 'scarf':
      paint(P, M().rrect(cx - 11, sy - 5, cx + 11, sy + 2, 3), (x) => (x % 4 < 2 ? c : lightOf(c)));
      if (!back) paint(P, M().rrect(cx - 7, sy, cx - 1, sy + 16, 2), (_x, y) => (y % 4 < 2 ? c : lightOf(c)));
      break;
    case 'bowtie':
      if (!back) paint(P, M().poly([[cx - 4, sy - 2], [cx + 1, sy + 1], [cx - 4, sy + 4]]).poly([[cx + 7, sy - 2], [cx + 2, sy + 1], [cx + 7, sy + 4]]).ellipse(cx + 1.5, sy + 1, 1.6, 1.6), c);
      break;
    case 'tie':
      if (!back) {
        paint(P, M().ellipse(cx + 1.5, sy + 1, 2.4, 2), c);
        paint(P, M().poly([[cx, sy + 2], [cx + 3, sy + 2], [cx + 4, sy + 17], [cx + 1.5, sy + 20], [cx - 1, sy + 17]]), c);
      }
      break;
    case 'necklace':
      if (!back) {
        for (let k = -7; k <= 8; k++) P.set(cx + k, sy + 2 + Math.round((k * k) / 18), GOLD);
        paint(P, M().ellipse(cx + 1, sy + 7, 1.8, 2), [159, 220, 255], { rim: false });
      }
      break;
    case 'bandana':
      if (!back) paint(P, M().poly([[cx - 8, sy - 1], [cx + 10, sy - 1], [cx + 1, sy + 10]]), (x, y) => ((x + y) % 5 === 0 ? WHITE : c));
      else paint(P, M().rrect(cx - 9, sy - 3, cx + 9, sy + 1, 2), c);
      break;
    case 'lanyard':
      if (!back) {
        for (let k = 0; k < 12; k++) {
          P.set(cx - 5 + Math.round(k * 0.35), sy + k, c);
          P.set(cx + 7 - Math.round(k * 0.35), sy + k, c);
        }
        paint(P, M().rrect(cx - 2, sy + 11, cx + 5, sy + 19, 1), WHITE);
        P.stamp(cx - 1, sy + 12, ['cccccc'], { c });
      }
      break;
  }
}

function drawAccessory(P: Pix, B: Body, L: FullLoadout) {
  const back = B.view === 'back';
  const cx = B.hx;
  const sy = B.shoulderY;
  switch (L.accessory) {
    case 'acc.flower':
      P.stamp(back ? cx + 8 : cx - 13, B.hy - 9, ['.p.', 'pyp', '.p.'], { p: PINK, y: GOLD });
      break;
    case 'acc.earrings':
      if (!back) paint(P, M().ellipse(B.hx - B.rx + 1, B.hy + 8, 1.4, 1.6), GOLD, { rim: false });
      break;
    case 'acc.hearing-aid':
      P.stamp(back ? cx + B.rx - 1 : cx - B.rx - 1, B.hy + 1, ['t', 't', 't'], { t: [43, 179, 163] });
      break;
    case 'acc.star-pin':
    case 'acc.five-year-pin':
      if (!back) P.stamp(cx - 8, sy + 5, ['.y.', 'yyy', '.y.', L.accessory === 'acc.five-year-pin' ? 'r.r' : '...'], { y: GOLD, r: [224, 80, 63] });
      break;
    case 'acc.rainbow-pin':
      if (!back) P.stamp(cx - 9, sy + 5, ['rrrr', 'y..y', 'b..b'], { r: [224, 80, 63], y: GOLD, b: [63, 143, 216] });
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
      paint(P, M().rrect(x - 2, y - 9, x + 5, y + 1, 1), WHITE);
      paint(P, M().rect(x - 2, y - 6, x + 5, y - 2), [201, 160, 106], { rim: false });
      paint(P, M().rrect(x - 3, y - 11, x + 6, y - 8, 1), [90, 60, 50], { rim: false });
      break;
    case 'held.boba':
      paint(P, M().rrect(x - 2, y - 10, x + 5, y + 1, 1), [236, 206, 170]);
      P.stamp(x - 1, y - 2, ['k.k.k', '.k.k.'], { k: [59, 37, 24] });
      for (let k = 0; k < 6; k++) P.set(x + 3 + (k > 3 ? 1 : 0), y - 11 - k, c);
      break;
    case 'held.laptop':
      paint(P, M().rrect(x - 8, y - 3, x + 8, y + 1, 1), [201, 206, 214]);
      break;
    case 'held.book':
      paint(P, M().rrect(x - 3, y - 9, x + 5, y + 1, 1), c);
      for (let yy = y - 8; yy < y; yy++) P.set(x + 4, yy, WHITE);
      break;
    case 'held.plant':
      paint(P, M().rrect(x - 3, y - 4, x + 4, y + 2, 1), [201, 98, 63]);
      paint(P, M().ellipse(x - 2, y - 7, 3, 2.5).ellipse(x + 3, y - 8, 3, 2.5).ellipse(x, y - 10, 2.5, 3), [94, 156, 74]);
      break;
    case 'held.icecream':
      paint(P, M().poly([[x - 3, y - 5], [x + 4, y - 5], [x + 0.5, y + 4]]), [232, 179, 90]);
      paint(P, M().ellipse(x + 0.5, y - 8, 4, 3.8), c.every((v) => v > 0) ? c : PINK);
      break;
    case 'held.balloon':
      for (let k = 0; k < 34; k++) P.set(x + (k > 20 ? -1 : 0), y - k, [142, 138, 132]);
      paint(P, M().ellipse(x - 1, y - 42, 7, 8.5), c);
      break;
    case 'held.umbrella':
      for (let k = 0; k < 44; k++) P.set(x + 1, y - k, [58, 40, 42]);
      paint(P, M().ellipse(x + 1, y - 44, 24, 12).band(0, y - 43), (px) => (Math.floor((px - x) / 6) % 2 ? c : lightOf(c)));
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
    B = { ...B, pose: 'wave', armNear: { a: [32, B.shoulderY + 2], b: [24, 42 + 9] }, handNear: [23, 47] };
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
