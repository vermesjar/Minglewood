/**
 * People in seats by Z-BUFFER (the seat model: src/shared/world/seatModels.ts). Every pixel of a seat's drawing
 * gets a depth — its view ray cast into the seat's proxy boxes, the nearest face it meets; a pixel outside every
 * box (a curl, a tuft) takes the face its nearest covered neighbour lies on, extended. Every pixel of a seated
 * person gets a depth from the body part that painted it (the avatar kit's layer map, avatarKit LAYER):
 *   torso, head, hair, hat …  a billboard at the pelvis, a torso's half-depth nearer the camera (hair behind the
 *                             head: at the pelvis)
 *   thighs                    the plane of their tops, forward from the hips at the cushion's height
 *   shins and shoes           a plane parallel to the seat's front, just in front of it (seatModels kneeFace): across
 *                             their whole width they hang in front of it, whatever the figure's short thighs say
 *   upper arms                billboards at the shoulders, either side of the torso
 *   forearms, hands, held     resting on the armrest on their side (just above its top) when the seat has one, else
 *                             on the lap — or nearer, where the arm is raised
 * Standing, walking or crouching on a seat's tile, the whole figure is one billboard outside the seat's boxes, on
 * the side they're on (in front of it, or behind it). A seat pixel is drawn over a person's pixel only where the
 * seat's surface is nearer the camera: its ray meets the seat higher up than the person (the depth is the ray's
 * height, seatModels.ts). A person is always drawn whole: the seat hides what it hides by being drawn over them.
 *
 * Pure: pixels in, pixels and measurements out, for the renderer (WorldView), the model tools
 * (scripts/seat-model.ts: sheets, checks, the live probe) and the Design Lab. Cached per (seat drawing, look,
 * pose, placement), so a seated person costs one lookup a frame.
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { CROUCH_UNTIL, SIT_POSE_OF, sitMotion, type SitStyle } from '@shared/world/seats';
import { FIG, figAx, figSeatRow, isSitPoseName, poseDrop } from '@shared/world/seatRigs';
import {
  armTop,
  backTop,
  behindView,
  bodyVolume,
  boxHull,
  cushionTiles,
  cushionTop,
  drawingAt,
  backFace,
  intrusions,
  kneeFace,
  localToWorld,
  projectLocal,
  rayBillboard,
  rayBox,
  rayPlane,
  rayThrough,
  seatSpan,
  sitsByCushion,
  towardCamera,
  worldToLocal,
  type Face,
  type Ray,
  type SeatModel,
  type SitPoint,
} from '@shared/world/seatModels';
import { renderAvatarLayers } from './avatarQa';
import { LAYER, kitFrame } from './avatarKit';
import { frameFor, type Frame, type Pose } from './avatarFrame';
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

/* ------------------------------------------------------------------ the person's depth */

/** The body parts a figure's pixels are sorted into (camera side: the arm nearer the camera). */
export const BODY = { none: 0, torso: 1, hairBack: 2, thigh: 3, shin: 4, upperCam: 5, upperFar: 6, foreCam: 7, foreFar: 8 } as const;
export const BODY_NAMES = ['none', 'torso', 'hair behind', 'thigh', 'shin', 'upper arm (near)', 'upper arm (far)', 'forearm (near)', 'forearm (far)'];

export interface FigureParts {
  px: Uint8ClampedArray;
  /** Per figure pixel: its BODY part (0 where the figure is clear). */
  part: Uint8Array;
  frame: Frame;
}

const TORSO_LAYERS = new Set<number>([LAYER.pet, LAYER.chairBack, LAYER.torso, LAYER.neck, LAYER.head, LAYER.face, LAYER.hair, LAYER.hat, LAYER.glasses, LAYER.accessory, LAYER.chairFront, LAYER.cane]);

const partsCache = new Map<string, FigureParts>();

/**
 * A figure's pixels and the body part of each (cached per look, facing, pose and feet drop). `drop`: its feet let down
 * that many px to the floor (feetDrop: a low seat), the shins stretched to reach.
 */
export function figureParts(look: AvatarLoadout, facing: Facing, pose: Pose, drop = 0): FigureParts {
  const key = `${JSON.stringify(look)}|${facing}|${pose}|${drop}`;
  const had = partsCache.get(key);
  if (had) return had;
  if (drop > 0) {
    const base = figureParts(look, facing, pose, 0);
    const out = { ...stretchFigure(base.px, base.part, base.frame, drop), frame: base.frame };
    partsCache.set(key, out);
    return out;
  }
  const r = renderAvatarLayers(look, facing, pose);
  const view = facing === 'se' || facing === 'sw' ? 'front' : 'back';
  const F = kitFrame(look, view, pose);
  const W = FIG.w;
  const H = FIG.h;
  const mirrored = facing === 'sw' || facing === 'nw';
  // the frame's points as drawn (mirrored with the figure)
  const P = (p: readonly [number, number]): [number, number] => (mirrored ? [W - p[0], p[1]] : [p[0], p[1]]);
  const seg = (x: number, y: number, a: readonly [number, number], b: readonly [number, number]) => {
    const [ax, ay] = P(a);
    const [bx, by] = P(b);
    const dx = bx - ax;
    const dy = by - ay;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
  };
  // which arm is on the camera's side: seen from the front the near arm, from behind the far one
  const camArm = view === 'front' ? F.armNear : F.armFar;
  const farArm = view === 'front' ? F.armFar : F.armNear;
  const camHand = view === 'front' ? F.handNear : F.handFar;
  const farHand = view === 'front' ? F.handFar : F.handNear;
  const part = new Uint8Array(W * H);
  const outline: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!r.px[i * 4 + 3]) continue;
      const o = r.owner[i];
      const cx = x + 0.5;
      const cy = y + 0.5;
      // (a pocket the kit seals in hair or hat colour below the hips — between the shins — is no hair: it goes with
      // what's round it, like the outline)
      if (o === LAYER.outline || o === LAYER.none || ((o === LAYER.hairBehind || o === LAYER.hat) && y > F.hipY + 2)) {
        outline.push(i);
        continue;
      }
      if (TORSO_LAYERS.has(o)) part[i] = BODY.torso;
      else if (o === LAYER.hairBehind) part[i] = BODY.hairBack;
      else if (o === LAYER.legs || o === LAYER.shoes) {
        // seen from behind, what the kit draws of the legs is the seat of the trousers, resting on the cushion: all
        // of it at one depth (the thighs'), so whatever of the seat is nearer cuts it along one clean line
        if (view === 'back') {
          part[i] = BODY.thigh;
          continue;
        }
        const thigh = Math.min(seg(cx, cy, F.legNear.a, F.legNear.m), seg(cx, cy, F.legFar.a, F.legFar.m));
        const shin = Math.min(seg(cx, cy, F.legNear.m, F.legNear.b), seg(cx, cy, F.legFar.m, F.legFar.b));
        part[i] = o === LAYER.shoes || shin < thigh ? BODY.shin : BODY.thigh;
      } else if (o === LAYER.armFront || o === LAYER.armBack || o === LAYER.held) {
        const d = [
          seg(cx, cy, camArm.a, camArm.m),
          Math.min(seg(cx, cy, camArm.m, camArm.b), seg(cx, cy, camHand, camHand) - 1),
          seg(cx, cy, farArm.a, farArm.m),
          Math.min(seg(cx, cy, farArm.m, farArm.b), seg(cx, cy, farHand, farHand) - 1),
        ];
        // what's held goes with the hand holding it
        if (o === LAYER.held) {
          d[0] = Infinity;
          d[2] = Infinity;
        }
        const k = d.indexOf(Math.min(...d));
        part[i] = [BODY.upperCam, BODY.foreCam, BODY.upperFar, BODY.foreFar][k];
      } else part[i] = BODY.torso;
    }
  // the outline goes with the part it outlines (the nearest painted pixel)
  for (let pass = 0; pass < 4 && outline.length; pass++)
    for (let k = outline.length - 1; k >= 0; k--) {
      const i = outline[k];
      const x = i % W;
      // the most common part round it (so a pocket between the shins is shin, whatever its first neighbour)
      const n = new Array<number>(9).fill(0);
      for (const j of [i - 1, i + 1, i - W, i + W, i - W - 1, i - W + 1, i + W - 1, i + W + 1]) {
        if (j < 0 || j >= W * H || Math.abs((j % W) - x) > 1) continue;
        if (part[j]) n[part[j]]++;
      }
      let best = 0;
      for (let k = 1; k < 9; k++) if (n[k] > n[best]) best = k;
      if (best) {
        part[i] = best;
        outline.splice(k, 1);
      }
    }
  for (const i of outline) part[i] = BODY.torso;
  const out = { px: r.px, part, frame: F };
  partsCache.set(key, out);
  if (partsCache.size > 600) partsCache.delete(partsCache.keys().next().value!);
  return out;
}

/**
 * A figure with its feet let down `drop` px: every shin and shoe pixel from just under the knees moves down, and the
 * gap is filled by repeating the shins' top row there — the legs reach the floor. Pure (the game stretches its own
 * sprite, blink and all, with the part map from figureParts).
 */
export function stretchFigure(px: ArrayLike<number>, part: Uint8Array, F: Frame, drop: number): { px: Uint8ClampedArray; part: Uint8Array } {
  const W = FIG.w;
  const H = FIG.h;
  const out = new Uint8ClampedArray(W * H * 4);
  const outPart = new Uint8Array(W * H);
  const cut = Math.round(Math.max(F.legNear.m[1], F.legFar.m[1])) + 2;
  const put = (x: number, y: number, i: number, keep: boolean) => {
    if (y < 0 || y >= H) return;
    const o = y * W + x;
    if (keep && outPart[o] && outPart[o] !== BODY.shin) return;
    for (let k = 0; k < 4; k++) out[o * 4 + k] = px[i * 4 + k];
    outPart[o] = part[i];
  };
  // everything but the lower shins where it was
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!px[i * 4 + 3] || (part[i] === BODY.shin && y >= cut)) continue;
      put(x, y, i, false);
    }
  // the lower shins and the feet, let down; the gap filled with the shins' top row
  for (let y = cut; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (px[i * 4 + 3] && part[i] === BODY.shin) put(x, y + drop, i, true);
    }
  for (let x = 0; x < W; x++) {
    const i = cut * W + x;
    if (!px[i * 4 + 3] || part[i] !== BODY.shin) continue;
    for (let y = cut; y < cut + drop; y++) put(x, y, i, true);
  }
  return { px: out, part: outPart };
}

/**
 * How far a seated figure's feet are let down to the floor (px): on a low seat — sat in upright or lounging, seen from
 * the front, their feet no more than 4 world px off the floor — all the way down; else not at all (legs dangle from a
 * tall chair, rest on a stool's rung, stretch out from a beanbag).
 */
export function feetDrop(style: SitStyle, facing: Facing, pose: string, lift: number): number {
  if (behindView(facing) || !isSitPoseName(pose) || (style !== 'chair' && style !== 'lounge')) return 0;
  const px = Math.round(lift * 2);
  return px > 0 && px <= 8 ? px : 0;
}

/** A torso's half-depth (tiles): the billboard of the body is this much nearer the camera than the pelvis. */
export const TORSO_HALF = 0.1;
/** The shoulders' half-width (tiles): where the upper arms hang, either side of the pelvis. */
export const SHOULDER_HALF = 0.2;
/** A thigh's thickness (world px): its top lies this far above the cushion. */
export const THIGH_TOP = 3;
/** How far a person on a seat's tile (not sitting) stands clear of its boxes (tiles). */
export const STAND_CLEAR = 0.12;

/** Where a person's body is, in the seat's local frame: their pelvis when sitting, else their feet. */
export interface BodyAt {
  u: number;
  v: number;
  z: number;
  sitting: boolean;
}

/**
 * The body's position from where its figure is drawn: the figure's feet (its anchor) at `feet` in the drawing's
 * px, lifted `lift` world px (seats.ts sitMotion). Sitting, the pelvis is above the feet by the figure's own
 * geometry (at least on the cushion); standing or crouching on the seat's tile, the feet — kept out of the boxes,
 * on whichever side they are.
 */
export function bodyAt(v: ModelView, feet: readonly [number, number], pose: string, lift: number, free = false): BodyAt {
  const anchor: [number, number] = [v.art.ax, v.art.ay];
  if (free) {
    // against a piece that isn't their seat (depth by proxy, docs/furniture.md): one billboard where they are — at
    // their pelvis when sitting, else at their feet — wherever that is
    const up = isSitPoseName(pose) ? FIG.feet - figSeatRow(poseDrop(pose)) : 0;
    const w = drawingAt(anchor, feet[0], feet[1] - up, lift + up / 2);
    const l = worldToLocal(v.model.size, v.facing, w.x, w.y);
    return { u: l.u, v: l.v, z: lift, sitting: false };
  }
  if (isSitPoseName(pose)) {
    const up = FIG.feet - figSeatRow(poseDrop(pose));
    const z = lift + up / 2;
    const w = drawingAt(anchor, feet[0], feet[1] - up, z);
    const l = worldToLocal(v.model.size, v.facing, w.x, w.y);
    const top = cushionTop(v.model, l.u, l.v);
    return { u: l.u, v: l.v, z: top !== null ? Math.max(z, top) : z, sitting: true };
  }
  const w = drawingAt(anchor, feet[0], feet[1], lift);
  const l = worldToLocal(v.model.size, v.facing, w.x, w.y);
  let vFront = Infinity;
  let vBack = -Infinity;
  for (const p of v.model.parts) {
    vFront = Math.min(vFront, p.v[0]);
    vBack = Math.max(vBack, p.v[1]);
  }
  // getting in or out, a person stands in front of the seat (they turn and sit down from there); only a step off
  // over its back (out from a chair pulled up to a table) takes them behind it
  const vv = l.v > vBack ? Math.max(l.v, vBack + STAND_CLEAR) : Math.min(l.v, vFront - STAND_CLEAR);
  return { u: l.u, v: vv, z: lift, sitting: false };
}

/** Everything the per-pixel depth of one person needs, worked out once for their body and the seat. */
interface BodyPlanes {
  torso: [number, number];
  hair: [number, number];
  upperCam: [number, number];
  upperFar: [number, number];
  shin: [number, number];
  thighZ: number;
  foreCamZ: number;
  foreFarZ: number;
  sitting: boolean;
}

function bodyPlanes(v: ModelView, b: BodyAt): BodyPlanes {
  const t = towardCamera(v.facing);
  const side = Math.sign(t.u);
  const torso: [number, number] = [b.u + TORSO_HALF * t.u, b.v + TORSO_HALF * t.v];
  const thighZ = b.z + THIGH_TOP;
  const lap = thighZ + 1.5;
  const armCam = armTop(v.model, b.u, side);
  const armFar = armTop(v.model, b.u, -side);
  // the knees: at the seat's front (the standard: seatModels.kneeFace), so the shins and feet always hang in front of
  // it, whatever the figure's own short thighs say; the thighs lie on the cushion between
  const kneeV = kneeFace(v.model);
  return {
    torso,
    hair: [b.u, b.v],
    upperCam: [torso[0] + SHOULDER_HALF * side, torso[1]],
    upperFar: [torso[0] - SHOULDER_HALF * side, torso[1]],
    shin: [b.u, kneeV],
    thighZ,
    foreCamZ: armCam !== null ? armCam + 1 : lap,
    foreFarZ: armFar !== null ? armFar + 1 : lap,
    sitting: b.sitting,
  };
}

/** The height at which a person's pixel of body part `part` meets its ray (their depth there). */
function personZ(r: Ray, part: number, B: BodyPlanes): number {
  if (!B.sitting) return rayBillboard(r, B.torso[0], B.torso[1]);
  switch (part) {
    case BODY.hairBack:
      return rayBillboard(r, B.hair[0], B.hair[1]);
    case BODY.thigh:
      return B.thighZ;
    case BODY.shin:
      // a vertical plane parallel to the seat's front, just in front of it (v = the knees' depth): not a billboard,
      // which slants against that face and would let its near edge fall behind it
      return (B.shin[1] - r.v0) / r.dv;
    case BODY.upperCam:
      return rayBillboard(r, B.upperCam[0], B.upperCam[1]);
    case BODY.upperFar:
      return rayBillboard(r, B.upperFar[0], B.upperFar[1]);
    case BODY.foreCam:
      return Math.max(rayBillboard(r, B.upperCam[0], B.upperCam[1]), B.foreCamZ);
    case BODY.foreFar:
      return Math.max(rayBillboard(r, B.upperFar[0], B.upperFar[1]), B.foreFarZ);
    default:
      return rayBillboard(r, B.torso[0], B.torso[1]);
  }
}

/** Ties go to the person (world px). */
const EPS = 0.25;
const quant = (z: number) => Math.round(z * 64) / 64;

export interface Overlay {
  /** The figure's top-left in the drawing's px. */
  x0: number;
  y0: number;
  /** Per figure pixel (FIG.w × FIG.h): 1 where the seat is drawn over them. */
  mask: Uint8Array;
  /** Per figure pixel: their depth (NaN where they're clear or off the drawing). */
  z: Float64Array;
  /** Per figure pixel: the seat's depth there (NaN: no seat pixel). */
  seatZ: Float64Array;
  /** Per figure pixel: the seat part in front of them (−1: none). */
  by: Int16Array;
  parts: FigureParts;
  body: BodyAt;
  /** Tiny islands of seat taken off them (single pixels of chair poking through a person read as holes). */
  specks: number;
}

/**
 * What of a seat is drawn over one person: every pixel of theirs where the seat's surface is nearer the camera.
 * `feet`: their figure's anchor in the drawing's px; `lift`: how high it's lifted (world px). `free`: the person
 * isn't in or getting into this seat (any piece's proxy, depth by proxy): one billboard where they are.
 */
export function overlayFor(v: ModelView, look: AvatarLoadout, facing: Facing, pose: Pose, feet: readonly [number, number], lift: number, opts: { free?: boolean } = {}): Overlay {
  const parts = figureParts(look, facing, pose, opts.free ? 0 : feetDrop(v.style, facing, pose, lift));
  const b = bodyAt(v, feet, pose, lift, !!opts.free);
  const B = bodyPlanes(v, b);
  const D = seatDepth(v);
  const x0 = Math.round(feet[0]) - figAx(facing);
  const y0 = Math.round(feet[1]) - FIG.feet;
  const W = FIG.w;
  const H = FIG.h;
  const mask = new Uint8Array(W * H);
  const z = new Float64Array(W * H).fill(NaN);
  const seatZ = new Float64Array(W * H).fill(NaN);
  const by = new Int16Array(W * H).fill(-1);
  const anchor: [number, number] = [v.art.ax, v.art.ay];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!parts.px[i * 4 + 3]) continue;
      const X = x0 + x;
      const Y = y0 + y;
      if (X < 0 || Y < 0 || X >= D.w || Y >= D.h) continue;
      const j = Y * D.w + X;
      const r = rayThrough(anchor, v.model.size, v.facing, X + 0.5, Y + 0.5);
      // (both depths on a 1/64 px grid: a tie on a seam — a thigh just under an arm's top — goes the same way in the
      // game and on the sheet, and to the person)
      const pz = quant(personZ(r, parts.part[i], B));
      z[i] = pz;
      if (Number.isNaN(D.z[j])) continue;
      const sz = quant(D.z[j]);
      seatZ[i] = sz;
      if (sz > pz + EPS) {
        mask[i] = 1;
        by[i] = D.part[j];
      }
    }
  // a speck of seat (1–2 px) with the person all round it reads as a hole in them: they show there instead
  let specks = 0;
  const seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp: number[] = [];
    const q = [s];
    seen[s] = 1;
    let enclosed = true;
    while (q.length) {
      const i = q.pop()!;
      comp.push(i);
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= W * H) {
          enclosed = false;
          continue;
        }
        if (mask[j]) {
          if (!seen[j]) {
            seen[j] = 1;
            q.push(j);
          }
        } else if (!parts.px[j * 4 + 3]) enclosed = false;
      }
    }
    if (enclosed && comp.length <= 2) {
      for (const i of comp) {
        mask[i] = 0;
        by[i] = -1;
      }
      specks += comp.length;
    }
  }
  return { x0, y0, mask, z, seatZ, by, parts, body: b, specks };
}

/* ------------------------------------------------------------------ placing sitters */

/** The figure's anchor (feet) in the drawing for a sitting point: the pelvis drawn exactly where the point projects. */
export function feetForSit(v: ModelView, s: SitPoint, style: SitStyle): [number, number] {
  const [hx, hy] = projectLocal([v.art.ax, v.art.ay], v.model.size, v.facing, s[0], s[1], s[2]);
  const pose = SIT_POSE_OF[style];
  return [Math.round(hx), Math.round(hy) - figSeatRow(poseDrop(pose)) + FIG.feet];
}

/** How far a sitter's figure is lifted on a sitting point (world px): their feet this far under the pelvis. */
export function liftForSit(s: SitPoint, style: SitStyle): number {
  return s[2] - (FIG.feet - figSeatRow(poseDrop(SIT_POSE_OF[style]))) / 2;
}

export interface ModelSitter {
  look: AvatarLoadout;
  facing: Facing;
  pose: Pose;
  feet: readonly [number, number];
  lift: number;
  /** Back-to-front order (the game draws the farther sitter first). */
  depth: number;
}

/** Everyone seated in a view: look k + i on cushion i. */
export function modelSitters(v: ModelView, looks: AvatarLoadout[], k = 0): ModelSitter[] {
  const sits = sitsByCushion(v.model, v.facing);
  const tiles = cushionTiles(v.model.size, v.facing);
  const out: ModelSitter[] = [];
  sits.forEach((s, i) => {
    if (!s) return;
    out.push({ look: looks[(k + i) % looks.length], facing: v.facing, pose: SIT_POSE_OF[v.style] as Pose, feet: feetForSit(v, s, v.style), lift: liftForSit(s, v.style), depth: tiles[i].x + tiles[i].y });
  });
  return out;
}

/**
 * Sitting down → seated → standing up on cushion 0, frame by frame, the way WorldView moves a sitter: from their
 * feet on the cushion's tile, crouching, up into the seat (seats.ts sitMotion) and back.
 */
export function modelSitFrames(v: ModelView, look: AvatarLoadout): ModelSitter[] {
  const s = sitsByCushion(v.model, v.facing)[0];
  const c = cushionTiles(v.model.size, v.facing)[0];
  if (!s) return [];
  const anchor: [number, number] = [v.art.ax, v.art.ay];
  const L = liftForSit(s, v.style);
  const hip = localToWorld(v.model.size, v.facing, s[0], s[1]);
  const foot = { x: c.x + 0.5, y: c.y + 0.5 };
  const ks: Array<[number, boolean]> = [
    [0, true],
    [0.2, true],
    [0.34, true],
    [0.45, true],
    [0.6, true],
    [0.8, true],
    [1, true],
    [0.8, false],
    [0.55, false],
    [0.36, false],
    [0.2, false],
    [0, false],
  ];
  return ks.map(([k, down]) => {
    const m = sitMotion(k, down, L);
    const x = foot.x + (hip.x - foot.x) * k;
    const y = foot.y + (hip.y - foot.y) * k;
    const px = anchor[0] + 32 * (x - y);
    const py = anchor[1] + 16 * (x + y) - 2 * m.lift;
    const pose: Pose = k <= 0 ? 'stand' : k < CROUCH_UNTIL ? 'crouch' : (SIT_POSE_OF[v.style] as Pose);
    return { look, facing: v.facing, pose, feet: [Math.round(px), Math.round(py)] as [number, number], lift: m.lift, depth: c.x + c.y };
  });
}

/* ------------------------------------------------------------------ composing (sheets, checks, the probe) */

export interface SitterStats {
  /** Figure pixels by body part: how many, and how many the seat covers. */
  count: number[];
  covered: number[];
  /** Head and shoulders (every figure row down to 3 px under the shoulder line), and how much of it shows. */
  upper: number;
  upperShown: number;
  /** Forearm pixels over an armrest's box, and how many of them an arm covers. */
  foreOnArm: number;
  foreOnArmHidden: number;
  /** Seat drawn over them where it's farther than they are (never, by construction: the z-buffer self-check). */
  wrong: number;
  /** Their pixels that end up see-through (nothing, or the seat behind them, shows). */
  holes: number;
  specks: number;
  body: BodyAt;
}

export interface ModelComposition {
  cell: Pixels;
  /** Per cell pixel: 0 nothing, 1 the seat, 2 the seat drawn over a sitter, 3 + k sitter k (in the order given). */
  who: Uint8Array;
  figures: Array<{ x0: number; y0: number }>;
  overlays: Overlay[];
  sitters: SitterStats[];
  /** Cell pixels the checks flag (for the sheets, in red). */
  flagged: Array<[number, number]>;
}

/**
 * Compose a seat and its sitters into a cell (`size` [w, h]), the drawing's (0, 0) at `origin`: the seat; then each
 * sitter, back to front, followed by the seat's pixels nearer the camera than them (overlayFor) — as WorldView draws.
 */
export function composeModel(v: ModelView, sitters: ModelSitter[], opts: { size: [number, number]; origin: [number, number] }): ModelComposition {
  const [W, H] = opts.size;
  const [OX, OY] = opts.origin;
  const cell: Pixels = { w: W, h: H, d: new Uint8ClampedArray(W * H * 4) };
  const who = new Uint8Array(W * H);
  const { px } = v.art;
  const put = (X: number, Y: number, src: ArrayLike<number>, i: number, tag: number) => {
    if (X < 0 || Y < 0 || X >= W || Y >= H) return;
    const o = (Y * W + X) * 4;
    cell.d[o] = src[i];
    cell.d[o + 1] = src[i + 1];
    cell.d[o + 2] = src[i + 2];
    cell.d[o + 3] = 255;
    who[Y * W + X] = tag;
  };
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) {
      const i = (y * px.w + x) * 4;
      if (px.d[i + 3]) put(OX + x, OY + y, px.d, i, 1);
    }
  const order = sitters.map((s, k) => ({ s, k })).sort((a, b) => a.s.depth - b.s.depth);
  const overlays: Overlay[] = new Array(sitters.length);
  const figures: Array<{ x0: number; y0: number }> = new Array(sitters.length);
  for (const { s, k } of order) {
    const ov = overlayFor(v, s.look, s.facing, s.pose, s.feet, s.lift);
    overlays[k] = ov;
    figures[k] = { x0: ov.x0, y0: ov.y0 };
    const f = ov.parts;
    for (let y = 0; y < FIG.h; y++)
      for (let x = 0; x < FIG.w; x++) {
        const i = y * FIG.w + x;
        if (f.px[i * 4 + 3]) put(OX + ov.x0 + x, OY + ov.y0 + y, f.px, i * 4, 3 + k);
      }
    for (let y = 0; y < FIG.h; y++)
      for (let x = 0; x < FIG.w; x++) {
        const i = y * FIG.w + x;
        if (!ov.mask[i]) continue;
        const X = ov.x0 + x;
        const Y = ov.y0 + y;
        put(OX + X, OY + Y, px.d, (Y * px.w + X) * 4, 2);
      }
  }
  // what of each sitter shows, and the checks' measures
  const flagged: Array<[number, number]> = [];
  const stats: SitterStats[] = sitters.map((s, k) => {
    const ov = overlays[k];
    const f = ov.parts;
    const drop = poseDrop(s.pose);
    const upperEnd = 58 + drop + 3;
    const st: SitterStats = { count: new Array(9).fill(0), covered: new Array(9).fill(0), upper: 0, upperShown: 0, foreOnArm: 0, foreOnArmHidden: 0, wrong: 0, holes: 0, specks: ov.specks, body: ov.body };
    const armIdx = v.model.parts.map((p, i) => (p.part === 'arm' ? i : -1)).filter((i) => i >= 0);
    for (let y = 0; y < FIG.h; y++)
      for (let x = 0; x < FIG.w; x++) {
        const i = y * FIG.w + x;
        if (!f.px[i * 4 + 3]) continue;
        const X = ov.x0 + x;
        const Y = ov.y0 + y;
        const cx = OX + X;
        const cy = OY + Y;
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        const w = who[cy * W + cx];
        const p = f.part[i];
        st.count[p]++;
        const coveredHere = w === 2;
        if (coveredHere) st.covered[p]++;
        if (w < 2) {
          st.holes++;
          flagged.push([cx, cy]);
        }
        if (y < upperEnd) {
          st.upper++;
          if (!coveredHere) st.upperShown++;
        }
        // the z-buffer self-check: a seat pixel over them is nearer than they are — cast afresh where a box is met
        if (ov.mask[i]) {
          const c = castDepth(v, X, Y);
          const sz = c ? quant(c.z) : ov.seatZ[i];
          if (!(sz > ov.z[i])) {
            st.wrong++;
            flagged.push([cx, cy]);
          }
        }
        // a forearm resting over an armrest
        if (p === BODY.foreCam || p === BODY.foreFar) {
          const r = rayThrough([v.art.ax, v.art.ay], v.model.size, v.facing, X + 0.5, Y + 0.5);
          if (armIdx.some((a) => rayBox(r, v.model.parts[a]))) {
            st.foreOnArm++;
            if (ov.mask[i] && armIdx.includes(ov.by[i])) {
              st.foreOnArmHidden++;
              flagged.push([cx, cy]);
            }
          }
        }
      }
    return st;
  });
  return { cell, who, figures, overlays, sitters: stats, flagged };
}

/* ------------------------------------------------------------------ the checks */

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

/** The proxy's fit standard: IoU per view, and the share of a back's or arm's top-edge columns within 2 px. */
export const FIT_IOU = 0.85;
export const FIT_TOPS = 0.8;

/**
 * What's wrong with a model in a view, by the standard (empty = it holds). See scripts/seat-model.ts for the list:
 *   (a) the proxy's silhouette matches the drawing (IoU ≥ 0.85; backs' and arms' top edges within 2 px)
 *   (b) each sitting point on its cushion's top, the pelvis 0–0.12 tile in front of the back's front face (bottom back
 *       against the backrest), or within 0.1 of the middle of a backless seat
 *   (c) the seat is never drawn over a person where it's behind them (the z-buffer self-check)
 *   (d) a seat with arms: forearms resting on an armrest show
 *   (e) seen from behind, head and shoulders show over a back lower than the shoulders
 *   (f) no see-through pixels in a seated person
 *   (h) no part but the cushion under them intrudes into a sitter's body (bodyVolume: torso to the shoulders, thighs
 *       to the knees; an armrest may run a little under a forearm)
 *   and what an artist would call wrong: from the front, the head and shoulders show and the legs come off the seat
 */
export function modelFindings(v: ModelView, looks: AvatarLoadout[]): { problems: string[]; fit: SilhouetteFit; flagged: Array<[number, number]> } {
  const out: string[] = [];
  const flagged: Array<[number, number]> = [];
  const cushions = cushionTiles(v.model.size, v.facing).length;
  const fit = silhouetteFit(v);
  if (fit.iou < FIT_IOU) out.push(`(a) the proxy's silhouette misses the drawing: IoU ${fit.iou.toFixed(2)} < ${FIT_IOU}`);
  for (const t of fit.tops)
    if (t.within < FIT_TOPS) out.push(`(a) the ${t.kind} (part ${t.part}) top edge is off the drawing's: ${Math.round(t.within * 100)}% of ${t.cols} columns within 2 px (worst ${t.worst} px)`);
  const sits = sitsByCushion(v.model, v.facing);
  if (v.model.sits.length !== cushions) out.push(`(b) ${v.model.sits.length} sitting point(s) for ${cushions} cushion(s)`);
  sits.forEach((s, i) => {
    if (!s) {
      out.push(`(b) cushion ${i}: no sitting point over its tile`);
      return;
    }
    const top = cushionTop(v.model, s[0], s[1]);
    if (top === null || Math.abs(top - s[2]) > 0.5) out.push(`(b) cushion ${i}: the sitting point isn't on the cushion top (z ${s[2]}, cushion ${top ?? 'none'})`);
    // bottom back against the backrest; on a backless seat, in the middle of it (seatModels.ts SIT_GAP)
    const back = backFace(v.model, s[0], s[2]);
    if (back !== null) {
      const gap = back - s[1];
      if (gap < 0 || gap > 0.12) out.push(`(b) cushion ${i}: the pelvis is ${gap.toFixed(2)} tile in front of the back's front face (0–0.12: sit back against it; --sit KEY auto)`);
    } else {
      const span = seatSpan(v.model, s[0]);
      if (span && Math.abs(s[1] - (span.v0 + span.v1) / 2) > 0.1) out.push(`(b) cushion ${i}: on a backless seat the pelvis is ${Math.abs(s[1] - (span.v0 + span.v1) / 2).toFixed(2)} tile off its middle (0.1 at most; --sit KEY auto)`);
    }
  });
  // (h) the sitter's body is theirs: nothing of the seat but the cushion under them stands inside it
  const F = frameFor('front', SIT_POSE_OF[v.style] as Pose);
  const thighLen = Math.abs(F.legNear.m[0] - F.legNear.a[0]) / 32;
  const shoulder = (figSeatRow(poseDrop(SIT_POSE_OF[v.style])) - F.shoulderY) / 2;
  sits.forEach((s, i) => {
    if (!s) return;
    for (const x of intrusions(v.model, bodyVolume(s, thighLen, shoulder, THIGH_TOP))) {
      const p = v.model.parts[x.part];
      out.push(`(h) cushion ${i}: part ${x.part} (${p.part}) stands inside the sitter's ${x.into} (by ${x.by[0].toFixed(2)} × ${x.by[1].toFixed(2)} tile × ${x.by[2].toFixed(1)} px): only the cushion under them may be there`);
    }
  });
  if (out.some((p) => p.startsWith('(b)'))) return { problems: out, fit, flagged };
  const behind = behindView(v.facing);
  const worst = new Map<string, { n: number; lo: boolean; bad: (n: number) => boolean; text: (n: number) => string }>();
  const note = (key: string, n: number, lo: boolean, bad: (n: number) => boolean, text: (n: number) => string) => {
    const w = worst.get(key);
    if (!w) worst.set(key, { n, lo, bad, text });
    else w.n = lo ? Math.min(w.n, n) : Math.max(w.n, n);
  };
  const OX = 100;
  const OY = 100;
  for (let k = 0; k < looks.length; k++) {
    const sitters = modelSitters(v, looks, k);
    const c = composeModel(v, sitters, { size: [v.art.px.w + 200, v.art.px.h + 200], origin: [OX, OY] });
    for (const [x, y] of c.flagged) flagged.push([x - OX, y - OY]);
    c.sitters.forEach((s, i) => {
      note(`${i} wrong`, s.wrong, false, (n) => n > 0, (n) => `(c) cushion ${i}: the seat is drawn over them where it's behind them (${n} px)`);
      if (s.foreOnArm >= 4) note(`${i} fore`, s.foreOnArmHidden / s.foreOnArm, false, (n) => n > 0.1, (n) => `(d) cushion ${i}: a forearm resting on the armrest is hidden (${Math.round(n * 100)}%)`);
      if (behind) {
        const bt = backTop(v.model, s.body.u, s.body.v);
        const shoulder = s.body.z + (figSeatRow(poseDrop(sitters[i].pose)) - (58 + poseDrop(sitters[i].pose))) / 2;
        if (bt !== null && bt < shoulder) note(`${i} upper`, s.upper ? s.upperShown / s.upper : 1, true, (n) => n < 0.9, (n) => `(e) cushion ${i}: from behind, the back is lower than their shoulders, yet ${Math.round((1 - n) * 100)}% of their head and shoulders is hidden`);
      } else {
        note(`${i} upper`, s.upper ? s.upperShown / s.upper : 1, true, (n) => n < 0.95, (n) => `cushion ${i}: from the front, the seat hides their head or shoulders (${Math.round(n * 100)}% show)`);
        const legs = s.count[BODY.thigh] + s.count[BODY.shin];
        const legsShown = legs - s.covered[BODY.thigh] - s.covered[BODY.shin];
        if (legs) note(`${i} legs`, legsShown / legs, true, (n) => n < 0.6, (n) => `cushion ${i}: from the front, their legs are lost in the seat (${Math.round(n * 100)}% show)`);
        // the shins and feet hang in front of the seat: not a pixel of them behind it
        note(`${i} shins`, s.covered[BODY.shin], false, (n) => n > 0, (n) => `cushion ${i}: from the front, the seat covers ${n} px of their shins or feet (they hang in front of it)`);
      }
      note(`${i} holes`, s.holes, false, (n) => n > 0, (n) => `(f) cushion ${i}: ${n} px of them see-through`);
    });
  }
  for (const w of worst.values()) if (w.bad(w.n)) out.push(w.text(w.n));
  return { problems: [...new Set(out)], fit, flagged };
}
