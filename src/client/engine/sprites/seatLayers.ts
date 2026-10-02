/**
 * Per-sitter composition against the original furniture pixels. The fitted model
 * labels the visible back, arms, cushion and frame. Upper-body coverage follows
 * those painted part edges; lower-body coverage compares the surface height to
 * the projected thigh, shin and foot, including entry and exit poses.
 *
 * Each occupant gets an individual mask. Furniture is drawn once, so a foreground
 * arm cannot repaint over another occupant. The renderer, compiler checks and
 * Design Lab use this same implementation.
 */
import type { Facing } from '@shared/world/scene';
import type { AvatarLoadout } from '@shared/domain/types';
import { behindView, bodyVolume, intrusions, cushionTiles, cushionTop, projectLocal, towardCamera, viewSits, type ModelPart, type PartKind, type SitPoint } from '@shared/world/seatModels';
import { SIT_POSE_OF, seatSupportLift } from '@shared/world/seats';
import { kneeV, legsFor, THIGH_R, type SitLegs } from '@shared/world/sitLegs';
import { coverRow, FIG, figAx, hipFeet, isSitPoseName, polyMask } from '@shared/world/seatFigure';
import { avatarSurfaceDepth } from './avatarSurfaceDepth';
import { seatDepth, silhouetteFit, type ModelView, type SeatDepth } from './seatModel';
import { renderAvatarLayers } from './avatarQa';
import type { Pose } from './avatarFrame';
import type { Pixels } from './footing';
import { kitFrame, LAYER } from './avatarKit';
import { M } from './pixkit';
import { legsKey } from '@shared/world/sitLegs';

export type Pt = [number, number];

export interface SeatLayers {
  facing: Facing;
  /** Per cushion (seatSpots order): the sitting point, in the model's frame (null: none over that cushion's tile). */
  sits: Array<SitPoint | null>;
  /** Per cushion: where the sitter's seat point is drawn, in the drawing's px. */
  hips: Array<Pt | null>;
  /** Per cushion: how the sitter's legs lie. */
  legs: Array<SitLegs | null>;
  /** Per drawing pixel: 1 where the seat is drawn over its sitters. */
  over: Uint8Array;
  /** Per drawing pixel: the model part it shows (−1: clear). */
  part: Int16Array;
  /** Which of the model's parts go over the sitters in this view. */
  overParts: boolean[];
  /**
   * How far above a sitter's seat point (figure px) the over layer reaches: above it the sitter shows. Undefined: no
   * cap (a view whose over layer was traced by eye: it covers exactly what it was traced to).
   */
  cover: number | undefined;
  /** The over layer is the view's traced polygons (the model's over), not its parts. */
  traced: boolean;
}

/** The figure's shoulder line sits this far above its seat point (figure px): the over layer stops there. */
export const COVER = FIG.hip + FIG.thigh - 58;
/** A back's pixels count as over a sitter only this far (world px) or more above the cushion top. */
export const OVER_ABOVE_CUSHION = 0;

const OVER_FROM_BEHIND: ReadonlySet<PartKind> = new Set(['back', 'wrap', 'other']);
const sideWrap = (p: ModelPart, width: number) => p.part === 'wrap' && (p.u[1] <= width / 2 || p.u[0] >= width / 2);

/** Which parts of a model go over its sitters seen in a facing (see the header). */
export function overParts(v: Pick<ModelView, 'model' | 'facing'>): boolean[] {
  const behind = behindView(v.facing);
  const cam = Math.sign(towardCamera(v.facing).u);
  const mid = v.model.size[0] / 2;
  return v.model.parts.map((p) => {
    // Camera-side arms cover the sitter. Turning the chair around does not
    // make its opposite arm jump in front of the sitter's shoulder or hips.
    if (p.part === 'arm' || sideWrap(p, v.model.size[0])) return ((p.u[0] + p.u[1]) / 2 - mid) * cam > 0;
    return behind && OVER_FROM_BEHIND.has(p.part);
  });
}

const cache = new WeakMap<object, Map<string, SeatLayers>>();
const layerRevision = (v: ModelView) => `${v.facing}|${v.art.ax},${v.art.ay}|${v.style}|${JSON.stringify(v.model)}`;

/** A seat's layers in a view (cached per drawing, facing and model). */
export function seatLayers(v: ModelView): SeatLayers {
  // Validate source bindings even on a warm layer cache. A stale semantic map
  // must not remain drawable simply because the old version rendered once.
  return layersForDepth(v, seatDepth(v), layerRevision(v));
}

function layersForDepth(v: ModelView, D: SeatDepth, key: string): SeatLayers {
  let memo = cache.get(v.art.px.d);
  if (!memo) cache.set(v.art.px.d, (memo = new Map()));
  const had = memo.get(key);
  if (had) return had;
  const ov = overParts(v);
  const traced = v.model.over?.[v.facing];
  let over: Uint8Array;
  if (traced) over = polyMask(D.w, D.h, traced);
  else {
    over = new Uint8Array(D.w * D.h);
    // a back can only be in front of a body above the cushion it sits on: a back box's pixels below that height are
    // the seat's rear (a thick box standing in for a thin rail claims the back of a cane seat) and stay under
    const parts = v.model.parts;
    const cushionZ = Math.max(0, ...parts.filter((p) => p.part === 'seat').map((p) => p.z[1]));
    const behind = behindView(v.facing);
    for (let i = 0; i < over.length; i++) {
      const k = D.part[i];
      if (k < 0) continue;
      const p = parts[k];
      if (ov[k]) {
        if ((p.part === 'back' || p.part === 'wrap') && D.z[i] < cushionZ + OVER_ABOVE_CUSHION) continue;
        over[i] = 1;
      } else if (behind && (p.part === 'seat' || p.part === 'base') && (D.face[i] !== 0 || underPart(parts, D.u[i], D.v[i]))) {
        // from behind, the seat's flank toward the camera (a side face of its box, never its top) is in front of the
        // sitter inside it (an elbow showed through a wingback's side below the arm), and so is cushion top lying
        // under an arm or the back (the corner where an armrest meets a wing is chair, not cushion)
        over[i] = 1;
      }
    }
  }
  // only the drawing's own pixels (a traced polygon may run past its edge)
  for (let i = 0; i < over.length; i++) if (!v.art.px.d[i * 4 + 3]) over[i] = 0;
  const sits = viewSits(v.model, v.facing);
  const anchor: Pt = [v.art.ax, v.art.ay];
  const legs = sits.map((s) => (s ? legsFor(v.model, s, v.style) : null));
  // a back that rises past the sitters' heads hides them whole: no cap (capped, their shoulders showed over its top)
  const tall = legs.length > 0 && legs.every((l) => l?.hidden);
  const out: SeatLayers = {
    facing: v.facing,
    sits,
    hips: sits.map((s) => (s ? (projectLocal(anchor, v.model.size, v.facing, s[0], s[1], s[2]) as Pt) : null)),
    legs,
    over,
    part: D.part,
    overParts: ov,
    cover: traced || tall ? undefined : COVER,
    traced: !!traced,
  };
  memo.set(key, out);
  if (memo.size > 16) memo.delete(memo.keys().next().value!);
  return out;
}

/** The cushion tiles of a model placed in a facing (seatSpots order), for callers that index by tile. */
export const layerTiles = (v: Pick<ModelView, 'model' | 'facing'>) => cushionTiles(v.model.size, v.facing);

/* ------------------------------------------------------------------ the check */

/** An armrest overhangs the box fitted to its silhouette by up to this much (tiles): cushion that close is under it. */
const ARM_OVERHANG = 0.12;

/** Whether a point of the seat's top (local u, v) lies under an arm (or its overhang), the back or a wrap. */
function underPart(parts: ModelPart[], u: number, v: number): boolean {
  for (const p of parts) {
    if (p.part !== 'arm' && p.part !== 'back' && p.part !== 'wrap') continue;
    const m = p.part === 'arm' ? ARM_OVERHANG : 0;
    if (u >= p.u[0] - m && u <= p.u[1] + m && v >= p.v[0] && v <= p.v[1]) return true;
  }
  return false;
}

/** A model's silhouette must cover each drawing at least this well (IoU against the drawing with its gaps filled). */
export const FIT_MIN = 0.8;

/**
 * What's wrong with a seat in one view (empty: it holds) — the one check the gate (scripts/seat-layers.ts --check),
 * the Design Lab and its publish step all run: the model fits the drawing; every cushion has a sitting point, on its
 * cushion seen from the front; the legs stay above the floor and come off the cushion's front; from behind, a seat
 * with a back hides something of its sitters.
 */
export function seatProblems(v: ModelView): string[] {
  const out: string[] = [];
  const m = v.model;
  const behind = behindView(v.facing);
  const fit = silhouetteFit(v);
  if (fit.iou < FIT_MIN) out.push(`the model's silhouette misses the drawing (IoU ${fit.iou.toFixed(2)} < ${FIT_MIN}): refit it`);
  const L = seatLayers(v);
  L.sits.forEach((s, i) => {
    if (!s) {
      out.push(`cushion ${i} has no sitting point over its tile`);
      return;
    }
    const legs = L.legs[i]!;
    const supportHeight = seatSupportLift(m.parts, s[0], s[1], 1) + 8;
    if (supportHeight > s[2] + 0.5) out.push(`cushion ${i}: a raised neighbouring cushion intersects the pelvis (support ${supportHeight}, sitting height ${s[2]})`);
    const collisions = intrusions(m, bodyVolume(s, legs.reach, 13.5, 3));
    if (collisions.length) out.push(`cushion ${i}: furniture intrudes into the sitter (${collisions.map((c) => `${m.parts[c.part].part}/${c.into}`).join(', ')})`);
    const kneeZ = s[2] + THIGH_R + legs.rise;
    if (kneeZ - legs.drop < -0.01) out.push(`cushion ${i}: the feet go through the floor`);
    // (from behind a sitter is drawn deeper, under the backrest: the cushion and knee rules are the front's)
    if (behind) return;
    const top = cushionTop(m, s[0], s[1]);
    if (top === null || Math.abs(top - s[2]) > 0.5) out.push(`cushion ${i}: the sitting point isn't on the cushion (z ${s[2]}, cushion ${top ?? 'none'})`);
    const cushion = m.parts.filter((p) => p.part === 'seat' && s[0] >= p.u[0] && s[0] <= p.u[1] && s[1] >= p.v[0] && s[1] <= p.v[1] && p.z[1] >= s[2] - 0.5);
    const front = Math.min(...cushion.map((p) => p.v[0]));
    const kv = kneeV(s, legs);
    if (cushion.length && kv > front - 0.01) out.push(`cushion ${i}: the knees are inside the cushion (at v ${kv.toFixed(2)}, its front ${front.toFixed(2)}): sit them further forward`);
  });
  if (behind && m.parts.some((p) => p.part === 'back') && !L.over.some((x) => x)) out.push('from behind, nothing of it goes over its sitters');
  return out;
}

/* ------------------------------------------------------------------ composing (sheets, the Design Lab) */

export interface SeatSitter {
  look: AvatarLoadout;
  /** Which cushion (seatSpots order). */
  cushion: number;
}

const sitterMasks = new WeakMap<ModelView, { revision: string; depth: SeatDepth; masks: Map<string, Uint8Array> }>();

/**
 * Furniture occlusion belongs to an individual figure, never to the entire couch.
 * Upper-body overlap follows the authored furniture parts. Below the hips we compare
 * the seat surface with the actual bent legs, including shins and shoes in rear views.
 * This keeps the original painted edges while allowing feet through open chair frames.
 */
export function sitterMask(v: ModelView, look: AvatarLoadout, facing: Facing, pose: Pose, feet: Pt, legs: SitLegs | undefined, hipHeight = legs ? legs.hang + legs.drop - legs.rise : 0): Uint8Array {
  const D = seatDepth(v);
  const revision = layerRevision(v);
  let memo = sitterMasks.get(v);
  if (!memo || memo.revision !== revision || memo.depth !== D)
    sitterMasks.set(v, (memo = { revision, depth: D, masks: new Map() }));
  const fx = Math.round(feet[0]);
  const fy = Math.round(feet[1]);
  const key = `${JSON.stringify(look)}|${facing}|${pose}|${fx},${fy}|${legsKey(legs)}|${hipHeight}`;
  const had = memo.masks.get(key);
  if (had) return had;
  const L = layersForDepth(v, D, revision);
  const fig = renderAvatarLayers(look, facing, pose, legs);
  if (D.source === 'authored') {
    const body = avatarSurfaceDepth(look, facing, pose, legs);
    const mask = new Uint8Array(FIG.w * FIG.h);
    const x0 = fx - figAx(facing), y0 = fy - FIG.feet;
    for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) {
      const i = y * FIG.w + x, X = x0 + x, Y = y0 + y;
      if (!fig.px[i * 4 + 3] || X < 0 || Y < 0 || X >= D.w || Y >= D.h) continue;
      const j = Y * D.w + X;
      if (!v.art.px.d[j * 4 + 3]) continue;
      if (!Number.isFinite(body.z[i]) || !Number.isFinite(D.z[j]))
        throw new Error(`Unresolved authored seating depth at furniture ${X},${Y}, avatar ${x},${y}`);
      mask[i] = D.z[j] > hipHeight + body.z[i] ? 1 : 0;
    }
    memo.masks.set(key, mask);
    if (memo.masks.size > 128) memo.masks.delete(memo.masks.keys().next().value!);
    return mask;
  }
  const F = kitFrame(look, behindView(facing) ? 'back' : 'front', pose, legs);
  const hips = M().rrect(F.hx - 9, F.waistY - 1, F.hx + 10, F.hipY + 3, 2);
  const mirrored = facing === 'sw' || facing === 'nw';
  const x0 = fx - figAx(facing);
  const y0 = fy - FIG.feet;
  const cap = L.cover === undefined ? -Infinity : coverRow(pose, L.cover);
  const hipZ = hipHeight;
  // Rear upholstery must compare against the actual painted body surface.
  // A nearest-joint height misses the rounded knee; expanding the hip patch
  // also incorrectly promotes descending shin pixels into the pelvis.
  // Compiler v4 introduces the new placement/body-contact contract. Published
  // older rigs retain their reviewed rendering until a specific visual defect
  // justifies migration; a shared fix must not silently rewrite accepted seats.
  const rearSupportBody = D.source === 'semantic' &&
    ((v.model.compiler?.version ?? 0) >= 4 || v.model.bodyContact?.version === 1) && behindView(v.facing)
    ? avatarSurfaceDepth(look, facing, pose, legs) : undefined;
  // A settled sitter is supported by the cushion, with thighs above its top
  // and shins beyond its front. Comparing only vertical heights at the shin
  // loses that front/back relationship and cuts a cushion-shaped wedge from
  // the leg. Apply this relation only when placement and knee clearance prove
  // it; approaching/crouching figures and rear views still need depth tests.
  const settled = legs && isSitPoseName(pose) && facing === v.facing && !behindView(v.facing)
    ? L.sits.find((s, c) => {
      if (!s || !L.hips[c]) return false;
      const placed = hipFeet(L.hips[c]!, v.style);
      return placed[0] === fx && placed[1] === fy && Math.abs(hipZ - s[2] - THIGH_R) < 0.01;
    }) : undefined;
  const supporting = v.model.parts.map(p => !!settled && !!legs && p.part === 'seat' &&
    settled[0] >= p.u[0] && settled[0] <= p.u[1] && settled[1] >= p.v[0] && settled[1] <= p.v[1] &&
    Math.abs(settled[2] - p.z[1]) <= 0.5 && kneeV(settled, legs) < p.v[0]);
  const segments = [F.legFar, F.legNear].flatMap((leg) => {
    // During the step and crouch the upright frame supplies actual joint
    // heights. Those feet must not flash through an upholstered seat's skirt.
    const kneeZ = legs ? hipZ + legs.rise : hipZ - (leg.m[1] - leg.a[1]) / 2;
    const ankleZ = legs ? kneeZ - legs.drop + 2.5 : hipZ - (leg.b[1] - leg.a[1]) / 2;
    return [
    { a: leg.a, b: leg.m, za: hipZ, zb: kneeZ },
    { a: leg.m, b: leg.b, za: kneeZ, zb: ankleZ },
    { a: leg.b, b: [leg.b[0], leg.b[1] + 5] as Pt, za: ankleZ, zb: ankleZ - 2.5 },
  ]; });
  const mask = new Uint8Array(FIG.w * FIG.h);
  for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) {
    const i = y * FIG.w + x;
    if (!fig.px[i * 4 + 3]) continue;
    const X = x0 + x;
    const Y = y0 + y;
    if (X < 0 || Y < 0 || X >= D.w || Y >= D.h) continue;
    const j = Y * D.w + X;
    if (!v.art.px.d[j * 4 + 3]) continue;
    const partIndex = D.part[j];
    if (partIndex >= 0 && supporting[partIndex]) continue;
    // A backrest is behind a settled sitter seen from the front, including
    // their pelvis. Its tall proxy cannot promote its painted lower fringe
    // over the pants while the upper-body branch correctly keeps it behind.
    if (settled && partIndex >= 0 && v.model.parts[partIndex].part === 'back') continue;
    // An explicitly identified outside back or wrap is the foreground shell
    // in a rear view. Its low fitted box must not let pelvis pixels punch
    // through the painted shell. The open supporting well has its own seat
    // label and continues to use support/depth rules; proxy guesses do not
    // receive this stronger source-surface relation.
    if (D.source === 'semantic' && behindView(v.facing) && partIndex >= 0 &&
        ['back', 'wrap'].includes(v.model.parts[partIndex].part) && !sideWrap(v.model.parts[partIndex], v.model.size[0])) {
      mask[i] = y >= cap ? 1 : 0;
      continue;
    }
    // A near arm is a foreground rail, for the pelvis and legs as well as
    // the torso. Do not let a limb-height approximation punch through it.
    if (partIndex >= 0 && (v.model.parts[partIndex].part === 'arm' ||
        D.source === 'semantic' && sideWrap(v.model.parts[partIndex], v.model.size[0]))) {
      mask[i] = L.overParts[partIndex] && y >= cap ? 1 : 0;
      continue;
    }
    const owner = fig.owner[i];
    if (rearSupportBody && partIndex >= 0 &&
        ['seat', 'base'].includes(v.model.parts[partIndex].part)) {
      const bodyZ = hipZ + rearSupportBody.z[i];
      if (!Number.isFinite(bodyZ) || !Number.isFinite(D.z[j]))
        throw new Error(`Unresolved seating support depth at furniture ${X},${Y}, avatar ${x},${y}`);
      mask[i] = D.z[j] > bodyZ ? 1 : 0;
      continue;
    }
    const bodyX = mirrored ? FIG.w - 1 - x : x;
    // Preserve the actual rounded pelvis and its one-pixel outline. A bounding
    // rectangle also includes empty rounded corners, where a descending shin
    // can legitimately pass behind the cushion.
    const hipVolume = owner === LAYER.legs && (hips.has(bodyX, y) ||
      hips.has(bodyX - 1, y) || hips.has(bodyX + 1, y) || hips.has(bodyX, y - 1) || hips.has(bodyX, y + 1));
    const pelvis = hipVolume || owner === LAYER.pelvis || (owner === LAYER.outline &&
      [i - 1, i + 1, i - FIG.w, i + FIG.w].some(k => k >= 0 && k < fig.owner.length && fig.owner[k] === LAYER.pelvis));
    if (pelvis) {
      // The pants' hip patch is painted over the leg strokes. It must retain
      // its own height when the rear-view shin projects into the same pixels.
      const z = hipZ + (F.hipY - y) / 2;
      mask[i] = D.z[j] > z + 1.25 ? 1 : 0;
      continue;
    }
    const lower = owner === LAYER.legs || owner === LAYER.shoes || (owner === LAYER.outline && y >= F.hipY - 2);
    if (!lower || y < F.hipY - 2) {
      const part = D.part[j] >= 0 ? v.model.parts[D.part[j]].part : undefined;
      const support = part === 'seat' || part === 'base';
      const bodyZ = hipZ + (F.hipY - y) / 2;
      // A visible cushion under an open back is still below the body. Its
      // proximity to the back/arm cannot promote it into a torso occluder.
      mask[i] = y >= cap && (!support || D.z[j] > bodyZ + 1.25) ? L.over[j] : 0;
      continue;
    }
    const px = mirrored ? FIG.w - 1 - x : x;
    let distance = Infinity;
    let z = hipZ;
    for (const s of segments) {
      const dx = s.b[0] - s.a[0];
      const dy = s.b[1] - s.a[1];
      const t = Math.max(0, Math.min(1, ((px - s.a[0]) * dx + (y - s.a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = (px - s.a[0] - t * dx) ** 2 + (y - s.a[1] - t * dy) ** 2;
      if (d < distance) {
        distance = d;
        z = s.za + t * (s.zb - s.za);
      }
    }
    // Give the limb its thickness; equal-depth upholstery supports it, rather than cutting into it.
    mask[i] = D.z[j] > z + 1.25 ? 1 : 0;
  }
  memo.masks.set(key, mask);
  if (memo.masks.size > 128) memo.masks.delete(memo.masks.keys().next().value!);
  return mask;
}

/**
 * A seat and its sitters composed the way the game draws them (WorldView): the seat's drawing, each sitter's figure
 * (their legs laid on it) with its seat point on their cushion's hip, back to front, then the over layer — kept off
 * every sitter above its cover. `pad`: drawing px of room round the drawing (heads rise above it). Pure.
 */
export function composeSeat(v: ModelView, sitters: SeatSitter[], pad = 48): { px: Pixels; origin: Pt } {
  const { px: art } = v.art;
  const W = art.w + pad * 2;
  const H = art.h + pad * 2;
  const d = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, src: ArrayLike<number>, i: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H || !src[i + 3]) return;
    const o = (y * W + x) * 4;
    d[o] = src[i];
    d[o + 1] = src[i + 1];
    d[o + 2] = src[i + 2];
    d[o + 3] = 255;
  };
  for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) put(x + pad, y + pad, art.d, (y * art.w + x) * 4);
  const L = seatLayers(v);
  const tiles = layerTiles(v);
  const pose = SIT_POSE_OF[v.style] as Pose;
  const placed = sitters
    .map((s, k) => ({ s, k }))
    .filter(({ s }) => L.hips[s.cushion])
    .sort((a, b) => tiles[a.s.cushion].x + tiles[a.s.cushion].y - (tiles[b.s.cushion].x + tiles[b.s.cushion].y));
  for (const { s } of placed) {
    const feet = hipFeet(L.hips[s.cushion]!, v.style);
    const x0 = feet[0] - figAx(v.facing) + pad;
    const y0 = feet[1] - FIG.feet + pad;
    const legs = L.legs[s.cushion]!;
    const fig = renderAvatarLayers(s.look, v.facing, pose, legs).px;
    const mask = sitterMask(v, s.look, v.facing, pose, feet, legs);
    for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) {
      const i = y * FIG.w + x;
      if (!mask[i]) put(x0 + x, y0 + y, fig, i * 4);
    }
  }
  return { px: { w: W, h: H, d }, origin: [pad, pad] };
}
