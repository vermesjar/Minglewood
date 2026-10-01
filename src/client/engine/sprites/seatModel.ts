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
import { FIG, drawingPrint, figAx, figSeatRow, isSitPoseName, poseDrop } from '@shared/world/seatFigure';
import { boxHull, drawingAt, projectLocal, rayBillboard, rayBox, rayPlane, rayThrough, seatSurfaceShapeProblems, towardCamera, worldToLocal, type Face, type Ray, type SeatModel, type SeatSurfaceMap, type SitPoint } from '@shared/world/seatModels';
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
  /** Proxy inference is not source-pixel semantic verification. */
  source: 'semantic' | 'proxy' | 'authored';
  w: number;
  h: number;
  /** Per pixel: the height (world px) at which its ray meets the seat's proxy; NaN where the drawing is clear. */
  z: Float64Array;
  /** The part that depth comes from (−1: none). */
  part: Int16Array;
  /** 1: proxy ray hit; 2: proxy extrapolation; 3: source-pixel semantic surface; 4: authored curved depth. */
  how: Uint8Array;
  /** The face of the box the ray meets: 0 its top, 1 or 2 a side (always the side toward the camera). */
  face: Uint8Array;
  /** Where the ray meets it, in the seat's local frame (tiles). */
  u: Float64Array;
  v: Float64Array;
}

const FACE_CODE: Record<Face, number> = { top: 0, u: 1, v: 2 };
const FACES: Face[] = ['top', 'u', 'v'];

/** The serialized parts are deliberately bound exactly: reordered/refitted parts require new labels. */
export const surfacePartsSignature = (model: Pick<SeatModel, 'parts'>): string => JSON.stringify(model.parts);

export function seatSurfaceMapProblems(map: SeatSurfaceMap, px: Pixels, model: SeatModel): string[] {
  const problems: string[] = [];
  if (map.version !== 1 && map.version !== 2) problems.push('Unsupported seating surface map version.');
  if (map.width !== px.w || map.height !== px.h) problems.push('Surface map dimensions do not match the drawing.');
  if (map.drawing !== drawingPrint(px.w, px.h, px.d)) problems.push('Surface map drawing fingerprint is stale.');
  if (map.modelParts !== surfacePartsSignature(model)) problems.push('Surface map model parts are stale.');
  if (!Array.isArray(map.labels) || map.labels.length !== px.w * px.h) {
    problems.push('Surface map must contain one label per drawing pixel.');
    return problems;
  }
  let uncovered = 0, extra = 0, invalid = 0;
  for (let i = 0; i < map.labels.length; i++) {
    const label = map.labels[i];
    if (!Number.isInteger(label) || label < 0 || label > model.parts.length * 3) invalid++;
    else if (px.d[i * 4 + 3] && label === 0) uncovered++;
    else if (!px.d[i * 4 + 3] && label !== 0) extra++;
  }
  if (uncovered) problems.push(`Surface map leaves ${uncovered} opaque pixels unlabeled.`);
  if (extra) problems.push(`Surface map labels ${extra} transparent pixels.`);
  if (invalid) problems.push(`Surface map has ${invalid} invalid part/face labels.`);
  return problems;
}

const PARTNER: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };

/** Resolve a source map in the exact same raster space as the resolved drawing.
 * Mirroring is accepted only with matching mirrored art and symmetric corresponding parts.
 * An asset supplying maps cannot silently fall back on a missing/invalid view.
 */
export function resolveSeatSurfaceMap(v: ModelView): SeatSurfaceMap | undefined {
  const maps = v.model.surfaces;
  if (maps === undefined) return undefined;
  const structure = seatSurfaceShapeProblems(v.model);
  if (structure.length) throw new Error(structure.join(' '));
  const { px } = v.art;
  let map = maps[v.facing];
  if (!map) {
    const source = maps[PARTNER[v.facing]];
    if (!source) throw new Error(`Missing seating surface map for ${v.facing} and its mirrored partner.`);
    if (source.version === 2) throw new Error('Authored depth requires an explicit validated map for every facing.');
    const mirrored = new Uint8Array(px.d.length);
    for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++)
      mirrored.set(px.d.subarray((y * px.w + x) * 4, (y * px.w + x + 1) * 4), (y * px.w + px.w - 1 - x) * 4);
    const problems = seatSurfaceMapProblems(source, { ...px, d: mirrored }, v.model);
    if (problems.length) throw new Error(problems.join(' '));
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-8;
    const reflected = v.model.parts.map(p => v.model.parts.findIndex(q =>
      q.part === p.part && same(q.u[0], v.model.size[0] - p.u[1]) && same(q.u[1], v.model.size[0] - p.u[0]) &&
      p.v.every((n, i) => same(n, q.v[i])) && p.z.every((n, i) => same(n, q.z[i]))));
    const labels = new Array<number>(px.w * px.h);
    for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
      const code = source.labels[y * px.w + px.w - 1 - x];
      if (!code) { labels[y * px.w + x] = 0; continue; }
      const part = reflected[Math.floor((code - 1) / 3)];
      if (part < 0) throw new Error('Surface map cannot mirror an asymmetric model part; supply this view explicitly.');
      labels[y * px.w + x] = 1 + part * 3 + (code - 1) % 3;
    }
    map = { ...source, drawing: drawingPrint(px.w, px.h, px.d), labels };
  }
  const problems = seatSurfaceMapProblems(map, px, v.model);
  if (map.version === 2 && (map.authored.anchor[0] !== v.art.ax || map.authored.anchor[1] !== v.art.ay || map.authored.style !== v.style))
    problems.push('Authored surface anchor or sitting style is stale.');
  if (problems.length) throw new Error(problems.join(' '));
  return map;
}

function depthFromSurfaceMap(v: ModelView, map: SeatSurfaceMap): SeatDepth {
  const { px, ax, ay } = v.art, n = px.w * px.h;
  const z = new Float64Array(n).fill(NaN), part = new Int16Array(n).fill(-1), how = new Uint8Array(n), face = new Uint8Array(n);
  const u = new Float64Array(n), vv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!map.labels[i]) continue;
    const code = map.labels[i] - 1, k = Math.floor(code / 3), f = code % 3, p = v.model.parts[k];
    const r = rayThrough([ax, ay], v.model.size, v.facing, i % px.w + 0.5, Math.floor(i / px.w) + 0.5);
    part[i] = k; face[i] = f; how[i] = map.version === 2 ? 4 : 3;
    // Explicit surface identity does not let an undersized proxy substitute another part.
    // Its own face can extend to painted fringe, bounded by that part's actual height.
    z[i] = map.version === 2 ? map.authored.z[i]! : Math.max(p.z[0], Math.min(p.z[1], rayPlane(r, p, FACES[f])));
    u[i] = r.u0 + r.du * z[i]; vv[i] = r.v0 + r.dv * z[i];
  }
  return { source: map.version === 2 ? 'authored' : 'semantic', w: px.w, h: px.h, z, part, how, face, u, v: vv };
}

const depthCache = new WeakMap<object, Map<string, SeatDepth>>();

/** The seat's depth map in a view (cached per drawing and model). */
export function seatDepth(v: ModelView): SeatDepth {
  const { px, ax, ay } = v.art;
  const surfaceMap = resolveSeatSurfaceMap(v);
  let memo = depthCache.get(px.d);
  if (!memo) depthCache.set(px.d, (memo = new Map()));
  const key = `${v.facing}|${ax},${ay}|${JSON.stringify(v.model.size)}|${JSON.stringify(v.model.parts)}|${surfaceMap ? JSON.stringify(surfaceMap) : 'proxy'}`;
  const had = memo.get(key);
  if (had) return had;
  if (surfaceMap) {
    const out = depthFromSurfaceMap(v, surfaceMap);
    memo.set(key, out);
    if (memo.size > 24) memo.delete(memo.keys().next().value!);
    return out;
  }
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
    face[i] = face[s];
    how[i] = 2;
    const p = parts[part[s]];
    // Extending a side face must not turn cushion fringe into a surface above
    // the cushion top (or grow a frame through the seated pelvis).
    z[i] = Math.max(p.z[0], Math.min(p.z[1], rayPlane(rays[i], p, FACES[face[s]])));
  }
  // A box around an open back also encloses the cushion visible through it.
  // Resolve that overlap from the drawing's own materials: learn the cushion
  // from unobstructed top pixels and the frame from pixels above the cushion.
  // Only use this evidence for a back with actual enclosed transparent holes;
  // a solid upholstered back must remain solid.
  const cushionZ = Math.max(0, ...parts.filter(p => p.part === 'seat').map(p => p.z[1]));
  const filled = filledSilhouette(px);
  const openBack = parts.some(p => p.part === 'back') && part.some((k, i) =>
    k >= 0 && parts[k].part === 'back' && !px.d[i * 4 + 3] && filled[i] &&
    (rayBox(rays[i], parts[k])?.hi ?? 0) > cushionZ + 3);
  if (openBack) {
    const seatColors = new Map<number, number[]>(), backColors = new Map<number, number[]>();
    const seatHits: Array<{ part: number; z: number; face: Face } | undefined> = new Array(W * H);
    const colorAt = (i: number) => [px.d[i * 4], px.d[i * 4 + 1], px.d[i * 4 + 2]];
    for (let i = 0; i < W * H; i++) {
      if (!px.d[i * 4 + 3] || part[i] < 0) continue;
      parts.forEach((p, k) => {
        if (p.part !== 'seat') return;
        const hit = rayBox(rays[i], p);
        if (hit && (!seatHits[i] || hit.hi > seatHits[i]!.z)) seatHits[i] = { part: k, z: hit.hi, face: hit.face };
      });
      const color = colorAt(i), code = color[0] * 65536 + color[1] * 256 + color[2];
      if (parts[part[i]].part === 'seat' && face[i] === 0) seatColors.set(code, color);
      if (parts[part[i]].part === 'back' && !seatHits[i] && z[i] > cushionZ + 3) backColors.set(code, color);
    }
    const distance = (color: number[], palette: Map<number, number[]>) => {
      let best = Infinity;
      for (const c of palette.values()) best = Math.min(best, c.reduce((sum, v, k) => sum + (v - color[k]) ** 2, 0));
      return best;
    };
    if (seatColors.size && backColors.size) for (let i = 0; i < W * H; i++) {
      const seat = seatHits[i];
      if (!seat || part[i] < 0 || parts[part[i]].part !== 'back') continue;
      const color = colorAt(i), ds = distance(color, seatColors), db = distance(color, backColors);
      // Ambiguous colours retain their geometric owner. A clearly distinct
      // cushion material continues through the opening behind the frame.
      if (ds < 3 * 28 ** 2 && ds + 100 < db * 0.5) {
        part[i] = seat.part; z[i] = seat.z; face[i] = FACE_CODE[seat.face]; how[i] = 1;
      }
    }
  }
  // The horizontal cap of a backrest proxy spans the open seat well of
  // curved furniture. Where that cap projects over a real cushion top, the
  // visible interior supports the sitter; the vertical back faces still occlude.
  // Arms remain separate foreground pieces, including their horizontal rails.
  if (v.facing === 'ne' || v.facing === 'nw') for (let i = 0; i < W * H; i++) {
    if (!px.d[i * 4 + 3] || part[i] < 0 || face[i] !== 0 || parts[part[i]].part !== 'back') continue;
    let support = -1, height = -Infinity;
    parts.forEach((p, k) => {
      if (p.part !== 'seat') return;
      const hit = rayBox(rays[i], p);
      // Fitted boxes stop between painted pixels. A top surface's fringe must
      // not jump to the height of the backrest when it misses the fitted seat
      // by one or two drawing pixels. Measure the miss in drawing pixels,
      // rather than stretching every surface or changing the sitter's height.
      const r = rays[i], zTop = p.z[1];
      const u = r.u0 + r.du * zTop, vv = r.v0 + r.dv * zTop;
      const nearest = projectLocal([ax, ay], v.model.size, v.facing,
        Math.max(p.u[0], Math.min(p.u[1], u)), Math.max(p.v[0], Math.min(p.v[1], vv)), zTop);
      const fringe = Math.hypot(nearest[0] - (i % W + 0.5), nearest[1] - (Math.floor(i / W) + 0.5)) <= 2;
      if ((hit?.face === 'top' || fringe) && zTop > height) { support = k; height = zTop; }
    });
    if (support >= 0) { part[i] = support; z[i] = height; face[i] = 0; how[i] = 1; }
  }
  for (let i = 0; i < W * H; i++) if (!px.d[i * 4 + 3]) part[i] = -1;
  const u = new Float64Array(W * H);
  const vv = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (part[i] < 0) continue;
    const r = rays[i];
    u[i] = r.u0 + r.du * z[i];
    vv[i] = r.v0 + r.dv * z[i];
  }
  const out: SeatDepth = { source: 'proxy', w: W, h: H, z, part, how, face, u, v: vv };
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
