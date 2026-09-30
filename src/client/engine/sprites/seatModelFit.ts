/**
 * Fitting a seat's proxy (src/shared/world/seatModels.ts) to its drawings: a template of boxes for its family (a
 * chair, an armchair, a couch, a stool, a bench, a beanbag, an ottoman, a throne), its cushion at the seat profile's
 * height, then every box's bounds nudged — mirror-symmetric across the seat, the same boxes in all four facings —
 * until the proxy's silhouette matches every drawing's (IoU) and the tops of its back and arms follow the drawings'.
 * The sitting points go on the cushion, bottom back against the backrest (seatModels.ts SIT_GAP; the middle of a
 * backless seat) — the old rig hips, where given, only
 * say where along a long seat each cushion is).
 *
 * A fit is a seed, never reviewed: the sheets (scripts/seat-model.ts --sheet) and the live screenshots are read
 * before anyone passes it. Pure: pixels in, a model out (the model tools and the Design Lab's auto-fit share it).
 */
import type { Facing } from '@shared/world/scene';
import type { SitStyle } from '@shared/world/seats';
import { boxHull, cushionTop, seatSpan, standardSitV, tidyModel, type ModelPart, type PartKind, type SeatModel, type SitPoint } from '@shared/world/seatModels';
import { filledSilhouette } from './seatModel';
import type { Pixels } from './footing';

export type Family = 'chair' | 'armchair' | 'couch' | 'stool' | 'bench' | 'beanbag' | 'ottoman' | 'throne';

export function familyOf(key: string): Family {
  if (/^heirloom-throne/.test(key)) return 'throne';
  if (/^armchair/.test(key)) return 'armchair';
  if (/^couch|^sofa/.test(key)) return 'couch';
  if (/^stool/.test(key)) return 'stool';
  if (/^bench/.test(key)) return 'bench';
  if (/^beanbag/.test(key)) return 'beanbag';
  if (/^ottoman|^pouf/.test(key)) return 'ottoman';
  return 'chair';
}

export interface FitView {
  facing: Facing;
  art: { px: Pixels; ax: number; ay: number };
}

export interface FitInput {
  key: string;
  size: [number, number];
  /** The cushion's height (the seat profile's `seat`, world px). */
  seat: number;
  style: SitStyle;
  backrest: boolean;
  arms: boolean;
  views: FitView[];
  /** Where along the seat (u) each cushion's old rig put the hips, if known. */
  hintU?: number[];
}

/** A box in a template: centred across the seat (one width), or one of a mirrored pair (its twin mirrored). */
interface TBox {
  part: PartKind;
  u: [number, number];
  v: [number, number];
  z: [number, number];
  /** 'centre': u0 + u1 = W; 'pair': a twin at [W − u1, W − u0]; 'free': as is. */
  sym: 'centre' | 'pair' | 'free';
  /** Bounds the fit leaves alone: 'z0', 'z1' (a cushion's top, a leg's foot). */
  fixed?: Array<'u0' | 'u1' | 'v0' | 'v1' | 'z0' | 'z1'>;
  /** A leg that runs on up past the seat (a bentwood chair's back legs become the back's posts). */
  post?: boolean;
}

/** The family's boxes, in proportions a first look at the catalog suggests (the fit moves them). */
export function template(f: Family, W: number, D: number, zc: number, height: number, backrest: boolean, arms: boolean): TBox[] {
  const T: TBox[] = [];
  const top = Math.max(height, zc + 6);
  const legs = (inU: number, inV0: number, inV1: number, w: number, z1: number) => {
    T.push({ part: 'leg', u: [inU, inU + w], v: [inV0, inV0 + w], z: [0, z1], sym: 'pair', fixed: ['z0'] });
    T.push({ part: 'leg', u: [inU, inU + w], v: [inV1 - w, inV1], z: [0, z1], sym: 'pair', fixed: ['z0'] });
  };
  switch (f) {
    case 'chair': {
      T.push({ part: 'seat', u: [0.22, W - 0.22], v: [0.2, D - 0.25], z: [zc - 2.5, zc], sym: 'centre', fixed: ['z1'] });
      legs(0.25, 0.22, D - 0.27, 0.05, zc - 2.5);
      if (backrest) T.push({ part: 'back', u: [0.24, W - 0.24], v: [D - 0.3, D - 0.22], z: [zc, top], sym: 'centre' });
      if (arms) T.push({ part: 'arm', u: [0.2, 0.28], v: [0.22, D - 0.3], z: [zc, zc + 7], sym: 'pair' });
      break;
    }
    case 'throne': {
      T.push({ part: 'base', u: [0.15, W - 0.15], v: [0.12, D - 0.2], z: [2, zc - 2], sym: 'centre' });
      T.push({ part: 'seat', u: [0.25, W - 0.25], v: [0.12, D - 0.3], z: [zc - 2, zc], sym: 'centre', fixed: ['z1'] });
      T.push({ part: 'arm', u: [0.12, 0.25], v: [0.12, D - 0.25], z: [2, zc + 8], sym: 'pair' });
      T.push({ part: 'back', u: [0.15, W - 0.15], v: [D - 0.3, D - 0.15], z: [2, top], sym: 'centre' });
      legs(0.15, 0.12, D - 0.15, 0.06, 2);
      break;
    }
    case 'armchair':
    case 'couch': {
      const aw = f === 'couch' ? 0.18 : 0.2;
      T.push({ part: 'base', u: [0.08, W - 0.08], v: [0.1, D - 0.1], z: [2.5, zc - 3], sym: 'centre' });
      T.push({ part: 'seat', u: [0.08 + aw, W - 0.08 - aw], v: [0.1, D - 0.35], z: [zc - 3, zc], sym: 'centre', fixed: ['z1'] });
      if (arms) T.push({ part: 'arm', u: [0.08, 0.08 + aw], v: [0.1, D - 0.1], z: [2.5, zc + 7], sym: 'pair' });
      if (backrest) T.push({ part: 'back', u: [0.08, W - 0.08], v: [D - 0.35, D - 0.1], z: [2.5, top], sym: 'centre' });
      legs(0.1, 0.12, D - 0.12, 0.06, 2.5);
      break;
    }
    case 'stool': {
      // a round seat as a cross of two boxes (an octagon from above)
      T.push({ part: 'seat', u: [0.28, W - 0.28], v: [0.36, D - 0.36], z: [zc - 3, zc], sym: 'centre', fixed: ['z1'] });
      T.push({ part: 'seat', u: [0.36, W - 0.36], v: [0.28, D - 0.28], z: [zc - 3, zc], sym: 'centre', fixed: ['z1'] });
      legs(0.3, 0.3, D - 0.3, 0.04, zc - 3);
      if (backrest) T.push({ part: 'back', u: [0.3, W - 0.3], v: [D - 0.34, D - 0.28], z: [zc, top], sym: 'centre' });
      break;
    }
    case 'bench': {
      T.push({ part: 'seat', u: [0.06, W - 0.06], v: [0.2, D - 0.3], z: [zc - 2.5, zc], sym: 'centre', fixed: ['z1'] });
      legs(0.1, 0.22, D - 0.32, 0.07, zc - 2.5);
      if (backrest) T.push({ part: 'back', u: [0.06, W - 0.06], v: [D - 0.3, D - 0.2], z: [zc, top], sym: 'centre' });
      if (arms) T.push({ part: 'arm', u: [0.04, 0.12], v: [0.2, D - 0.25], z: [zc - 2.5, zc + 6], sym: 'pair' });
      break;
    }
    case 'beanbag': {
      T.push({ part: 'seat', u: [0.15, W - 0.15], v: [0.12, D - 0.35], z: [0, zc], sym: 'centre', fixed: ['z0', 'z1'] });
      T.push({ part: 'wrap', u: [0.15, W - 0.15], v: [D - 0.4, D - 0.12], z: [0, top], sym: 'centre', fixed: ['z0'] });
      T.push({ part: 'wrap', u: [0.1, 0.25], v: [0.25, D - 0.2], z: [0, zc + 3], sym: 'pair', fixed: ['z0'] });
      break;
    }
    case 'ottoman': {
      T.push({ part: 'seat', u: [0.2, W - 0.2], v: [0.2, D - 0.2], z: [1.5, zc], sym: 'centre', fixed: ['z1'] });
      legs(0.22, 0.22, D - 0.22, 0.04, 1.5);
      break;
    }
  }
  return T;
}

/**
 * A template's variants: a round seat as a cross of two boxes (an octagon from above), an arched back as two boxes
 * stacked (the upper one narrower). The fit tries each and keeps the best, less a little for every box added.
 */
export interface Variant {
  roundSeat?: boolean;
  archBack?: boolean;
}

export function applyVariant(T: TBox[], v: Variant): TBox[] {
  const out: TBox[] = [];
  for (const b of T) {
    if (v.roundSeat && b.part === 'seat' && b.sym === 'centre') {
      const du = (b.u[1] - b.u[0]) * 0.18;
      const dv = (b.v[1] - b.v[0]) * 0.18;
      out.push({ ...b, u: [b.u[0], b.u[1]], v: [b.v[0] + dv, b.v[1] - dv], fixed: [...(b.fixed ?? [])] });
      out.push({ ...b, u: [b.u[0] + du, b.u[1] - du], v: [b.v[0], b.v[1]], fixed: [...(b.fixed ?? [])] });
    } else if (v.archBack && b.part === 'back' && b.sym === 'centre') {
      const zm = b.z[0] + (b.z[1] - b.z[0]) * 0.65;
      out.push({ ...b, u: [b.u[0], b.u[1]], v: [b.v[0], b.v[1]], z: [b.z[0], zm], fixed: [...(b.fixed ?? [])] });
      out.push({ ...b, u: [b.u[0] + 0.06, b.u[1] - 0.06], v: [b.v[0], b.v[1]], z: [zm, b.z[1]], fixed: [...(b.fixed ?? [])] });
    } else out.push({ ...b, u: [b.u[0], b.u[1]], v: [b.v[0], b.v[1]], z: [b.z[0], b.z[1]], fixed: [...(b.fixed ?? [])] });
  }
  return out;
}

/** The boxes of a template, twins included. */
export function expand(T: TBox[], W: number): ModelPart[] {
  const out: ModelPart[] = [];
  for (const b of T) {
    const u: [number, number] = b.sym === 'centre' ? [b.u[0], W - b.u[0]] : [b.u[0], b.u[1]];
    out.push({ part: b.part, u, v: [b.v[0], b.v[1]], z: [b.z[0], b.z[1]] });
    if (b.sym === 'pair') out.push({ part: b.part, u: [W - u[1], W - u[0]], v: [b.v[0], b.v[1]], z: [b.z[0], b.z[1]] });
  }
  return out;
}

/** A model's parts read back as a template (mirror pairs found by symmetry), to fit an existing model further. */
export function asTemplate(parts: ModelPart[], W: number): TBox[] {
  const used = new Set<number>();
  const T: TBox[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
  parts.forEach((p, i) => {
    if (used.has(i)) return;
    used.add(i);
    const fixed: TBox['fixed'] = [];
    if (p.part === 'seat') fixed.push('z1');
    if (p.z[0] === 0) fixed.push('z0');
    const seatBottom = Math.min(...parts.filter((q) => q.part === 'seat').map((q) => q.z[0]));
    const post = p.part === 'leg' && p.z[1] > seatBottom + 1;
    if (near(p.u[0] + p.u[1], W)) {
      T.push({ part: p.part, u: [p.u[0], p.u[1]], v: [p.v[0], p.v[1]], z: [p.z[0], p.z[1]], sym: 'centre', fixed, post });
      return;
    }
    const j = parts.findIndex((q, k) => !used.has(k) && q.part === p.part && near(q.u[0], W - p.u[1]) && near(q.u[1], W - p.u[0]) && near(q.v[0], p.v[0]) && near(q.v[1], p.v[1]) && near(q.z[0], p.z[0]) && near(q.z[1], p.z[1]));
    if (j >= 0) {
      used.add(j);
      const lo = p.u[0] < parts[j].u[0] ? p : parts[j];
      T.push({ part: p.part, u: [lo.u[0], lo.u[1]], v: [p.v[0], p.v[1]], z: [p.z[0], p.z[1]], sym: 'pair', fixed, post });
    } else T.push({ part: p.part, u: [p.u[0], p.u[1]], v: [p.v[0], p.v[1]], z: [p.z[0], p.z[1]], sym: 'free', fixed, post });
  });
  return T;
}

/* ------------------------------------------------------------------ scoring */

interface Prepared {
  f: Facing;
  anchor: [number, number];
  w: number;
  h: number;
  sil: Uint8Array;
  top: Int16Array;
  area: number;
}

function prepare(v: FitView): Prepared {
  const { px } = v.art;
  const sil = filledSilhouette(px);
  const top = new Int16Array(px.w).fill(-1);
  let area = 0;
  for (let x = 0; x < px.w; x++)
    for (let y = 0; y < px.h; y++)
      if (sil[y * px.w + x]) {
        if (top[x] < 0) top[x] = y;
        area++;
      }
  return { f: v.facing, anchor: [v.art.ax, v.art.ay], w: px.w, h: px.h, sil, top, area };
}

/** How well a proxy fits one prepared view: IoU, and the mean excess (px beyond 1) of back and arm tops. */
function scoreView(P: Prepared, size: [number, number], parts: ModelPart[], buf: Uint8Array, tops: Int16Array[]): { iou: number; topErr: number } {
  buf.fill(0);
  const W = P.w;
  const H = P.h;
  parts.forEach((p, k) => {
    const poly = boxHull(P.anchor, size, P.f, p);
    const t = tops[k];
    t.fill(-1);
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [, y] of poly) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const n = poly.length;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
      // the hull's span on this row (a convex polygon: one run)
      const cy = y + 0.5;
      let l = Infinity;
      let r = -Infinity;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % n];
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
          const x = ax + ((cy - ay) * (bx - ax)) / (by - ay);
          l = Math.min(l, x);
          r = Math.max(r, x);
        }
      }
      if (!(l < r)) continue;
      const xa = Math.max(0, Math.ceil(l - 0.5));
      const xb = Math.min(W - 1, Math.floor(r - 0.5));
      for (let x = xa; x <= xb; x++) {
        buf[y * W + x] = 1;
        if (t[x] < 0) t[x] = y;
      }
    }
  });
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < W * H; i++) {
    const a = P.sil[i];
    const b = buf[i];
    if (a & b) inter++;
    if (a | b) uni++;
  }
  // the tops of backs and arms, where each is the proxy's top
  let err = 0;
  let cols = 0;
  for (let x = 0; x < W; x++) {
    if (P.top[x] < 0) continue;
    let k = -1;
    let row = Infinity;
    for (let j = 0; j < parts.length; j++)
      if (tops[j][x] >= 0 && tops[j][x] < row) {
        row = tops[j][x];
        k = j;
      }
    if (k < 0 || (parts[k].part !== 'back' && parts[k].part !== 'arm')) continue;
    err += Math.max(0, Math.abs(row - P.top[x]) - 1);
    cols++;
  }
  return { iou: uni ? inter / uni : 0, topErr: cols ? err / cols : 0 };
}

export interface FitResult {
  model: SeatModel;
  ious: Partial<Record<Facing, number>>;
  score: number;
}

/**
 * Sitters on a seat of several cushions sit this far apart (tiles), about its middle: at their tiles' middles the end
 * ones sat against the arms and read as sitting on them (Carter: "the seats are overlapping the couch arms"; the
 * catalog's couches were moved 0.1–0.15 tile in, to 0.66 and 1.4 on a two-seater).
 */
export const CUSHION_SPACING = 0.8;
/** How far (tiles) a sitter's hips stay from an arm's inner face: half their torso's width on screen and a little. */
export const ARM_CLEAR = 0.42;

/**
 * Sitting points by the standard: on the cushion over each cushion's tile, back against the backrest (else its
 * middle); across, a single seat's sitter in its middle, a longer seat's CUSHION_SPACING apart about its middle and
 * ARM_CLEAR from its arms. `hintU` keeps the sitters where they are across (the Lab's "sit them back" button).
 */
export function placeSits(parts: ModelPart[], size: [number, number], hintU?: number[]): SitPoint[] {
  const [W] = size;
  const n = Math.max(1, Math.round(W));
  const arms = parts.filter((p) => p.part === 'arm');
  const armL = Math.max(0, ...arms.filter((p) => p.u[0] + p.u[1] < W).map((p) => p.u[1]));
  const armR = Math.min(W, ...arms.filter((p) => p.u[0] + p.u[1] >= W).map((p) => p.u[0]));
  const across = (i: number) => {
    if (n === 1) return W / 2;
    const u = W / 2 + (i + 0.5 - n / 2) * CUSHION_SPACING;
    // clear of the arms, but over its own tile
    return Math.min(i + 0.95, Math.max(i + 0.05, Math.min(armR - ARM_CLEAR, Math.max(armL + ARM_CLEAR, u))));
  };
  const out: SitPoint[] = [];
  for (let i = 0; i < n; i++) {
    const u = hintU?.[i] !== undefined && hintU[i] >= i && hintU[i] <= i + 1 ? hintU[i] : across(i);
    // the standard (seatModels.ts SIT_GAP): bottom back against the backrest, else the middle of a backless seat —
    // on the cushion top there (a back's front face depends on the cushion's height, so settle it twice)
    const span = seatSpan({ parts }, u);
    let v = span ? (span.v0 + span.v1) / 2 : 0.5;
    let z = cushionTop({ parts }, u, v) ?? 0;
    for (let it = 0; it < 3; it++) {
      v = standardSitV({ parts }, u, z) ?? v;
      z = cushionTop({ parts }, u, v) ?? z;
    }
    out.push([u, v, z]);
  }
  return out;
}

/**
 * Fit a proxy: from a template (or an existing model's parts), coordinate descent on every free bound — steps
 * halving from 0.08 tile / 4 px — maximising the mean IoU over the views (plus the worst one), less the tops' error.
 */
export function fitModel(input: FitInput, from?: ModelPart[], opts: { rounds?: number; shakes?: number; variant?: Variant } = {}): FitResult {
  if (from || opts.variant) return fitOnce(input, from, opts);
  let best: FitResult | null = null;
  const fam = familyOf(input.key);
  const variants: Variant[] = [{}];
  if (fam === 'chair' || fam === 'stool' || fam === 'throne') variants.push({ roundSeat: fam !== 'stool' });
  if (input.backrest && fam !== 'beanbag') variants.push({ archBack: true }, { roundSeat: fam === 'chair', archBack: true });
  for (const variant of variants) {
    const r = fitOnce(input, undefined, { ...opts, variant });
    // every box added has to earn its place
    const cost = 0.004 * r.model.parts.length;
    if (!best || r.score - cost > best.score - 0.004 * best.model.parts.length) best = r;
  }
  return best!;
}

function fitOnce(input: FitInput, from: ModelPart[] | undefined, opts: { rounds?: number; shakes?: number; variant?: Variant }): FitResult {
  const [W, D] = input.size;
  const views = input.views.map(prepare);
  // the drawing's height over its anchor, highest of the views (world px): where a template's back starts
  let height = input.seat + 8;
  for (const P of views) {
    const top = P.top.reduce((m, t) => (t >= 0 ? Math.min(m, t) : m), Infinity);
    // the back vertex is at the anchor on the floor; the far top corner of a box of height h draws 2h above it
    if (Number.isFinite(top)) height = Math.max(height, (P.anchor[1] - top) / 2);
  }
  const T = from ? asTemplate(from, W) : applyVariant(template(familyOf(input.key), W, D, input.seat, height, input.backrest, input.arms), opts.variant ?? {});
  const bufs = views.map((P) => new Uint8Array(P.w * P.h));
  const topBufs = views.map((P) => new Array(T.length * 2 + 2).fill(0).map(() => new Int16Array(P.w)));
  const evaluate = () => {
    const parts = expand(T, W);
    let sum = 0;
    let worst = 1;
    let terr = 0;
    views.forEach((P, i) => {
      const s = scoreView(P, input.size, parts, bufs[i], topBufs[i]);
      sum += s.iou;
      worst = Math.min(worst, s.iou);
      terr += s.topErr;
    });
    return sum / views.length + 0.5 * worst - 0.02 * (terr / views.length);
  };
  type Key = 'u0' | 'u1' | 'v0' | 'v1' | 'z0' | 'z1';
  const params: Array<{ b: TBox; k: Key }> = [];
  for (const b of T)
    for (const k of ['u0', 'u1', 'v0', 'v1', 'z0', 'z1'] as Key[]) {
      if (b.fixed?.includes(k)) continue;
      if (b.sym === 'centre' && k === 'u1') continue;
      params.push({ b, k });
    }
  const get = (b: TBox, k: Key) => (k[0] === 'u' ? b.u : k[0] === 'v' ? b.v : b.z)[k[1] === '0' ? 0 : 1];
  const set = (b: TBox, k: Key, x: number) => {
    ((k[0] === 'u' ? b.u : k[0] === 'v' ? b.v : b.z) as number[])[k[1] === '0' ? 0 : 1] = x;
  };
  // the seat's structure holds whatever the silhouettes say: legs stand under the seat (a post may run on up into
  // the back), a back stands behind the front of the cushion and rises above it, arms rise above it
  const seats = T.filter((b) => b.part === 'seat');
  const valid = (b: TBox) => {
    if (b.u[0] >= b.u[1] - 0.01 || b.v[0] >= b.v[1] - 0.01 || b.z[0] >= b.z[1] - 0.3) return false;
    if (b.sym === 'centre' && (b.u[0] < -0.3 || b.u[0] > W / 2 - 0.01)) return false;
    if (b.u[0] < -0.3 || b.u[1] > W + 0.3 || b.v[0] < -0.3 || b.v[1] > D + 0.3 || b.z[0] < 0) return false;
    if (b.part === 'seat' && b.z[1] < 1) return false;
    const seatBottom = Math.min(...seats.map((s) => s.z[0]));
    const seatFront = Math.min(...seats.map((s) => s.v[0]));
    if (b.part === 'leg' && !b.post && b.z[1] > seatBottom + 1) return false;
    if (b.part === 'back' && (b.v[0] < seatFront + 0.2 || b.z[1] < input.seat + 3)) return false;
    if (b.part === 'arm' && b.z[1] < input.seat + 1) return false;
    return true;
  };
  const allValid = () => T.every(valid);
  let best = evaluate();
  const descend = (steps: Array<[number, number]>, rounds: number) => {
    for (const [ts, zs] of steps)
      for (let r = 0; r < rounds; r++) {
        let improved = false;
        for (const { b, k } of params) {
          const step = k[0] === 'z' ? zs : ts;
          for (const dir of [1, -1]) {
            const was = get(b, k);
            set(b, k, was + dir * step);
            if (!valid(b) || (b.part === 'seat' && !allValid())) {
              set(b, k, was);
              continue;
            }
            const s = evaluate();
            if (s > best + 1e-6) {
              best = s;
              improved = true;
              break;
            }
            set(b, k, was);
          }
        }
        if (!improved) break;
      }
  };
  const STEPS: Array<[number, number]> = [
    [0.08, 4],
    [0.04, 2],
    [0.02, 1],
    [0.01, 0.5],
    [0.005, 0.25],
  ];
  descend(STEPS, opts.rounds ?? 6);
  // then shake it: nudge a few bounds at random and descend again, keeping what scores better (a fixed seed, so a
  // fit is repeatable)
  let seed = 0x9e3779b9;
  const rand = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) ^ Math.imul(seed ^ (seed >>> 13), 3266489909)) >>> 0) / 4294967296;
  const snapshot = () => T.map((b) => ({ u: [...b.u], v: [...b.v], z: [...b.z] }));
  const restore = (s: ReturnType<typeof snapshot>) =>
    T.forEach((b, i) => {
      b.u = s[i].u as [number, number];
      b.v = s[i].v as [number, number];
      b.z = s[i].z as [number, number];
    });
  for (let trial = 0; trial < (opts.shakes ?? 40); trial++) {
    const keep = snapshot();
    const had = best;
    for (const { b, k } of params) {
      if (rand() > 0.25) continue;
      const step = (k[0] === 'z' ? 1.5 : 0.03) * (1 + Math.floor(rand() * 3)) * (rand() < 0.5 ? -1 : 1);
      const was = get(b, k);
      set(b, k, was + step);
      if (!valid(b)) set(b, k, was);
    }
    if (!allValid()) {
      restore(keep);
      continue;
    }
    best = evaluate();
    descend(STEPS.slice(1), 4);
    if (best <= had) {
      restore(keep);
      best = had;
    }
  }
  const parts = expand(T, W);
  const ious: Partial<Record<Facing, number>> = {};
  views.forEach((P, i) => (ious[P.f] = scoreView(P, input.size, parts, bufs[i], topBufs[i]).iou));
  const model = tidyModel({ size: input.size, parts, sits: placeSits(parts, input.size, input.hintU) });
  return { model, ious, score: best };
}
