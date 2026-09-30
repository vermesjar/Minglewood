/**
 * A seat's model against its drawing, pixel by pixel (the model: src/shared/world/seatModels.ts). Every pixel of a
 * seat's drawing gets the part of the model it shows and how deep it is — its view ray cast into the model's boxes,
 * the nearest face it meets; a pixel outside every box (a curl, a tuft) takes the face its nearest covered neighbour
 * lies on, extended (seatDepth). The seat layers are split by those parts (seatLayers.ts); the fitter and the checks
 * measure how well the model's silhouette covers each drawing (silhouetteFit).
 *
 * Pure: pixels in, masks and measurements out, for the renderer, the seat tools and the Design Lab.
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { SIT_POSE_OF, type SitStyle } from '@shared/world/seats';
import { FIG, figAx, figSeatRow, isSitPoseName, poseDrop } from '@shared/world/seatFigure';
import { boxHull, drawingAt, rayBillboard, rayBox, rayPlane, rayThrough, towardCamera, worldToLocal, type Face, type Ray, type SeatModel, type SitPoint } from '@shared/world/seatModels';
import type { SitLegs } from '@shared/world/sitLegs';
import { renderAvatarLayers } from './avatarQa';
import type { Pose } from './avatarFrame';
import type { Pixels } from './footing';

/** One view of a seat: the drawing the game uses in this facing (with its anchor) and its model. */
export interface ModelView {
  art: { px: Pixels; ax: number; ay: number };
  facing: Facing;
  model: SeatModel;
  style: SitStyle;
}

/* ------------------------------------------------------------------ the seat's depth */

export interface SeatDepth {
  w: number;
  h: number;
  /** Per pixel: the height (world px) at which its ray meets the seat's proxy; NaN where the drawing is clear. */
  z: Float64Array;
  /** The part that depth comes from (−1: none). */
  part: Int16Array;
  /** 1: the ray meets that part's box; 2: outside every box, on the nearest covered pixel's face extended. */
  how: Uint8Array;
}

const FACE_CODE: Record<Face, number> = { top: 0, u: 1, v: 2 };
const FACES: Face[] = ['top', 'u', 'v'];

const depthCache = new WeakMap<object, Map<string, SeatDepth>>();

/** The seat's depth map in a view (cached per drawing and model). */
export function seatDepth(v: ModelView): SeatDepth {
  const { px, ax, ay } = v.art;
  let memo = depthCache.get(px.d);
  if (!memo) depthCache.set(px.d, (memo = new Map()));
  const key = `${v.facing}|${ax},${ay}|${JSON.stringify(v.model.size)}|${JSON.stringify(v.model.parts)}`;
  const had = memo.get(key);
  if (had) return had;
  const W = px.w;
  const H = px.h;
  const z = new Float64Array(W * H).fill(NaN);
  const part = new Int16Array(W * H).fill(-1);
  const how = new Uint8Array(W * H);
  const face = new Uint8Array(W * H);
  const rays: Ray[] = new Array(W * H);
  const parts = v.model.parts;
  const queue: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const r = rayThrough([ax, ay], v.model.size, v.facing, x + 0.5, y + 0.5);
      rays[i] = r;
      let best = -Infinity;
      for (let k = 0; k < parts.length; k++) {
        const hit = rayBox(r, parts[k]);
        if (hit && hit.hi > best) {
          best = hit.hi;
          part[i] = k;
          face[i] = FACE_CODE[hit.face];
        }
      }
      if (part[i] >= 0) {
        how[i] = 1;
        queue.push(i);
        if (px.d[i * 4 + 3]) z[i] = best;
      }
    }
  // the drawing's pixels outside every box: the face of the nearest covered pixel, extended (a breadth-first fill
  // over the whole grid, so a stray island of the drawing still finds one)
  const src = new Int32Array(W * H).fill(-1);
  for (const i of queue) src[i] = i;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const j = Y * W + X;
        if (src[j] >= 0) continue;
        src[j] = src[i];
        queue.push(j);
      }
  }
  for (let i = 0; i < W * H; i++) {
    if (!px.d[i * 4 + 3] || how[i] === 1 || src[i] < 0) continue;
    const s = src[i];
    part[i] = part[s];
    how[i] = 2;
    z[i] = rayPlane(rays[i], parts[part[s]], FACES[face[s]]);
  }
  for (let i = 0; i < W * H; i++) if (!px.d[i * 4 + 3]) part[i] = -1;
  const out = { w: W, h: H, z, part, how };
  memo.set(key, out);
  if (memo.size > 24) memo.delete(memo.keys().next().value!);
  return out;
}

/** The seat's depth at a pixel by casting its ray afresh (no cache, no fill): the check's second opinion. */
export function castDepth(v: ModelView, x: number, y: number): { z: number; part: number } | null {
  const r = rayThrough([v.art.ax, v.art.ay], v.model.size, v.facing, x + 0.5, y + 0.5);
  let best: { z: number; part: number } | null = null;
  v.model.parts.forEach((p, k) => {
    const hit = rayBox(r, p);
    if (hit && (!best || hit.hi > best.z)) best = { z: hit.hi, part: k };
  });
  return best;
}

/* ------------------------------------------------------------------ a person against a piece (depth by proxy) */

/** A person's billboard stands this far (tiles) nearer the camera than their pelvis or feet: a torso's half-depth. */
const TORSO_HALF = 0.1;
/** Ties go to the person (world px). */
const EPS = 0.25;

export interface Overlay {
  /** The figure's top-left in the drawing's px. */
  x0: number;
  y0: number;
  /** Per figure pixel (FIG.w × FIG.h): 1 where the piece is drawn over them. */
  mask: Uint8Array;
}

/**
 * DEPTH BY PROXY (a prototype, off by default: WorldView proxyDepth, docs/furniture.md): what of a piece is drawn over
 * a person who isn't sitting in it, the person one billboard where they are — at their pelvis when sitting, else at
 * their feet: every pixel of theirs where the piece's surface meets the view ray nearer the camera (higher) than they
 * do. `feet`: their figure's anchor in the drawing's px; `lift`: how high it's lifted (world px).
 */
export function overlayFor(v: ModelView, look: AvatarLoadout, facing: Facing, pose: Pose, feet: readonly [number, number], lift: number, legs?: SitLegs): Overlay {
  const px = renderAvatarLayers(look, facing, pose, legs).px;
  const anchor: [number, number] = [v.art.ax, v.art.ay];
  const up = isSitPoseName(pose) ? FIG.feet - figSeatRow(poseDrop(pose)) : 0;
  const w = drawingAt(anchor, feet[0], feet[1] - up, lift + up / 2);
  const at = worldToLocal(v.model.size, v.facing, w.x, w.y);
  const t = towardCamera(v.facing);
  const bu = at.u + TORSO_HALF * t.u;
  const bv = at.v + TORSO_HALF * t.v;
  const D = seatDepth(v);
  const x0 = Math.round(feet[0]) - figAx(facing);
  const y0 = Math.round(feet[1]) - FIG.feet;
  const mask = new Uint8Array(FIG.w * FIG.h);
  for (let y = 0; y < FIG.h; y++)
    for (let x = 0; x < FIG.w; x++) {
      if (!px[(y * FIG.w + x) * 4 + 3]) continue;
      const X = x0 + x;
      const Y = y0 + y;
      if (X < 0 || Y < 0 || X >= D.w || Y >= D.h) continue;
      const sz = D.z[Y * D.w + X];
      if (Number.isNaN(sz)) continue;
      const pz = rayBillboard(rayThrough(anchor, v.model.size, v.facing, X + 0.5, Y + 0.5), bu, bv);
      if (sz > pz + EPS) mask[y * FIG.w + x] = 1;
    }
  return { x0, y0, mask };
}

/** How far a sitter's figure is lifted on a sitting point (world px): their feet this far under the pelvis. */
export function liftForSit(s: SitPoint, style: SitStyle): number {
  return s[2] - (FIG.feet - figSeatRow(poseDrop(SIT_POSE_OF[style]))) / 2;
}

/* ------------------------------------------------------------------ fitting the drawings */

/** The drawing's silhouette with its enclosed gaps filled (the loop of a bentwood back, the gap under an arm). */
export function filledSilhouette(px: Pixels): Uint8Array {
  const W = px.w;
  const H = px.h;
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  const solid = (i: number) => px.d[i * 4 + 3] > 0;
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (outside[i] || solid(i)) continue;
    outside[i] = 1;
    const x = i % W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (H - 1)) stack.push(i + W);
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** The proxy drawn as a silhouette over a w × h drawing: 1 where a pixel's centre is inside a box's projection. */
export function proxySilhouette(v: ModelView, w = v.art.px.w, h = v.art.px.h): { mask: Uint8Array; owner: Int16Array; top: Int16Array[] } {
  const mask = new Uint8Array(w * h);
  const owner = new Int16Array(w * h).fill(-1);
  const top = v.model.parts.map(() => new Int16Array(w).fill(-1));
  v.model.parts.forEach((p, k) => {
    const poly = boxHull([v.art.ax, v.art.ay], v.model.size, v.facing, p);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, Math.ceil(x1)); x++)
        if (inConvex(poly, x + 0.5, y + 0.5)) {
          mask[y * w + x] = 1;
          if (top[k][x] < 0) top[k][x] = y;
        }
  });
  // which part is the proxy's top in each column (for the top-edge check)
  for (let x = 0; x < w; x++) {
    let best = -1;
    let row = Infinity;
    top.forEach((t, k) => {
      if (t[x] >= 0 && t[x] < row) {
        row = t[x];
        best = k;
      }
    });
    if (best >= 0) owner[x] = best;
  }
  return { mask, owner, top };
}

function inConvex(poly: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c === 0) continue;
    const s = Math.sign(c);
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export interface SilhouetteFit {
  iou: number;
  /** Per back / arm part: its top edge against the drawing's (columns where it's the proxy's top). */
  tops: Array<{ part: number; kind: string; cols: number; within: number; worst: number; mean: number }>;
}

/** How well the proxy's silhouette matches a drawing: IoU against its filled silhouette, and the tops of backs and arms. */
export function silhouetteFit(v: ModelView): SilhouetteFit {
  const { px } = v.art;
  const S = filledSilhouette(px);
  const P = proxySilhouette(v);
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < S.length; i++) {
    if (S[i] && P.mask[i]) inter++;
    if (S[i] || P.mask[i]) uni++;
  }
  const sTop = new Int16Array(px.w).fill(-1);
  for (let x = 0; x < px.w; x++)
    for (let y = 0; y < px.h; y++)
      if (S[y * px.w + x]) {
        sTop[x] = y;
        break;
      }
  const tops: SilhouetteFit['tops'] = [];
  v.model.parts.forEach((p, k) => {
    if (p.part !== 'back' && p.part !== 'arm') return;
    const cols: number[] = [];
    for (let x = 0; x < px.w; x++) if (P.owner[x] === k && sTop[x] >= 0) cols.push(x);
    // the outermost columns are the rounded ends a box can't follow
    const mid = cols.slice(2, Math.max(2, cols.length - 2));
    if (mid.length < 3) return;
    const err = mid.map((x) => Math.abs(P.top[k][x] - sTop[x]));
    tops.push({ part: k, kind: p.part, cols: mid.length, within: err.filter((e) => e <= 2).length / mid.length, worst: Math.max(...err), mean: err.reduce((a, b) => a + b, 0) / err.length });
  });
  return { iou: uni ? inter / uni : 0, tops };
}

