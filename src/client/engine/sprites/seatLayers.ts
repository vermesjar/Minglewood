/**
 * SEAT LAYERS: how people are drawn into a seat — Habbo's way, the seat's drawing in two layers, one behind its
 * sitters and one over them — worked out from the seat's 3D model (src/shared/world/seatModels.ts), the same for
 * every facing — unless a view's drawing needs its over layer traced by eye (the model's over).
 *
 * Every pixel of the drawing is labelled with the part of the model it shows (its view ray cast into the model's
 * boxes: seatModel.ts seatDepth). A WHOLE PART goes over the people sitting in it or behind them, by where it stands:
 *   the arm on the camera's side      over (it's between them and us, seen from any side)
 *   the back, a wrap, a crest          over when the seat is seen from behind, else behind them
 *   the seat's and base's flanks       over when seen from behind (their side faces toward the camera wrap the sitter)
 *   everything else                    behind them (the cushion they sit on, the base, legs, the far arm)
 * The split follows the drawing's own pixels, so its edges are the artist's. Nothing is decided pixel by pixel
 * against a body, so a box a little off the drawing never cuts into a person: it can only move an edge between parts.
 *
 * Over them, a seat never hides a sitter's head: the over layer stops at their shoulders (COVER), so a wingback seen
 * from behind shows who's in it — unless its back rises past the head anyway (sitLegs `hidden`: a throne), when it
 * covers exactly what it covers and the head shows over its top on its own.
 *
 * Each cushion's sitter sits on its sitting point (the model's `sits`), drawn with its figure's seat point exactly
 * where the point projects, and their legs laid on the seat by sitLegs.ts: thighs to just past the front edge,
 * shins down toward the floor.
 *
 * Pure (pixels in, masks and points out): the renderer (WorldView), the seat tools and the Design Lab share it.
 */
import type { Facing } from '@shared/world/scene';
import type { AvatarLoadout } from '@shared/domain/types';
import { behindView, cushionTiles, cushionTop, projectLocal, towardCamera, viewSits, type ModelPart, type PartKind, type SitPoint } from '@shared/world/seatModels';
import { SIT_POSE_OF } from '@shared/world/seats';
import { kneeV, legsFor, THIGH_R, type SitLegs } from '@shared/world/sitLegs';
import { coverRow, FIG, figAx, hipFeet, polyMask } from '@shared/world/seatFigure';
import { seatDepth, silhouetteFit, type ModelView } from './seatModel';
import { renderAvatarLayers } from './avatarQa';
import type { Pose } from './avatarFrame';
import type { Pixels } from './footing';

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

/** Which parts of a model go over its sitters seen in a facing (see the header). */
export function overParts(v: Pick<ModelView, 'model' | 'facing'>): boolean[] {
  const behind = behindView(v.facing);
  const cam = Math.sign(towardCamera(v.facing).u);
  const mid = v.model.size[0] / 2;
  return v.model.parts.map((p) => {
    // from the front the near arm is in front of the sitter and the far one behind them; from behind the sitter is
    // inside the arms, so both are in front (an elbow beside the far arm showed over it)
    if (p.part === 'arm') return behind || ((p.u[0] + p.u[1]) / 2 - mid) * cam > 0;
    return behind && OVER_FROM_BEHIND.has(p.part);
  });
}

const cache = new WeakMap<object, Map<string, SeatLayers>>();

/** A seat's layers in a view (cached per drawing, facing and model). */
export function seatLayers(v: ModelView): SeatLayers {
  let memo = cache.get(v.art.px.d);
  if (!memo) cache.set(v.art.px.d, (memo = new Map()));
  const key = `${v.facing}|${v.art.ax},${v.art.ay}|${v.style}|${JSON.stringify(v.model)}`;
  const had = memo.get(key);
  if (had) return had;
  const D = seatDepth(v);
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
  const who = new Int16Array(W * H).fill(-1);
  const put = (x: number, y: number, src: ArrayLike<number>, i: number, k: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H || !src[i + 3]) return;
    const o = (y * W + x) * 4;
    d[o] = src[i];
    d[o + 1] = src[i + 1];
    d[o + 2] = src[i + 2];
    d[o + 3] = 255;
    who[y * W + x] = k;
  };
  for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) put(x + pad, y + pad, art.d, (y * art.w + x) * 4, -1);
  const L = seatLayers(v);
  const tiles = layerTiles(v);
  const pose = SIT_POSE_OF[v.style] as Pose;
  const placed = sitters
    .map((s, k) => ({ s, k }))
    .filter(({ s }) => L.hips[s.cushion])
    .sort((a, b) => tiles[a.s.cushion].x + tiles[a.s.cushion].y - (tiles[b.s.cushion].x + tiles[b.s.cushion].y));
  const figs: Array<{ x0: number; y0: number; px: ArrayLike<number> }> = [];
  for (const { s, k } of placed) {
    const [fx, fy] = hipFeet(L.hips[s.cushion]!, v.style);
    const x0 = fx - figAx(v.facing) + pad;
    const y0 = fy - FIG.feet + pad;
    const fig = renderAvatarLayers(s.look, v.facing, pose, L.legs[s.cushion] ?? undefined).px;
    for (let y = 0; y < FIG.h; y++) for (let x = 0; x < FIG.w; x++) put(x0 + x, y0 + y, fig, (y * FIG.w + x) * 4, k);
    figs[k] = { x0, y0, px: fig };
  }
  const capRow = L.cover === undefined ? -Infinity : coverRow(pose, L.cover);
  for (let y = 0; y < art.h; y++)
    for (let x = 0; x < art.w; x++) {
      const i = y * art.w + x;
      if (!L.over[i]) continue;
      const X = x + pad;
      const Y = y + pad;
      // above the cover, a sitter's own pixels show over the seat
      const k = who[Y * W + X];
      const f = k >= 0 ? figs[k] : undefined;
      if (f && Y - f.y0 < capRow) continue;
      put(X, Y, art.d, i * 4, -1);
    }
  return { px: { w: W, h: H, d }, origin: [pad, pad] };
}
