/**
 * SEAT LAYERS: how people are drawn into a seat — Habbo's way, the seat's drawing in two layers, one behind its
 * sitters and one over them — worked out from the seat's 3D model (src/shared/world/seatModels.ts), the same for
 * every facing, never traced by hand.
 *
 * Every pixel of the drawing is labelled with the part of the model it shows (its view ray cast into the model's
 * boxes: seatModel.ts seatDepth). A WHOLE PART goes over the people sitting in it or behind them, by where it stands:
 *   the arm on the camera's side      over (it's between them and us, seen from any side)
 *   the back, a wrap, a crest          over when the seat is seen from behind, else behind them
 *   everything else                    behind them (the cushion they sit on, the base, legs, the far arm)
 * The split follows the drawing's own pixels, so its edges are the artist's. Nothing is decided pixel by pixel
 * against a body, so a box a little off the drawing never cuts into a person: it can only move an edge between parts.
 *
 * Over them, a seat never hides a sitter's head: the over layer stops at their shoulders (COVER), so a wingback or a
 * throne seen from behind shows who's in it.
 *
 * Each cushion's sitter sits on its sitting point (the model's `sits`), drawn with its figure's seat point exactly
 * where the point projects, and their legs laid on the seat by sitLegs.ts: thighs to just past the front edge,
 * shins down toward the floor.
 *
 * Pure (pixels in, masks and points out): the renderer (WorldView), the seat tools and the Design Lab share it.
 */
import type { Facing } from '@shared/world/scene';
import { behindView, cushionTiles, projectLocal, sitsByCushion, towardCamera, type PartKind, type SitPoint } from '@shared/world/seatModels';
import { legsFor, type SitLegs } from '@shared/world/sitLegs';
import { FIG } from '@shared/world/seatRigs';
import { seatDepth, type ModelView } from './seatModel';

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
  /** How far above a sitter's seat point (figure px) the over layer reaches: above it the sitter shows. */
  cover: number;
}

/** The figure's shoulder line sits this far above its seat point (figure px): the over layer stops there. */
export const COVER = FIG.hip + FIG.thigh - 58;

const OVER_FROM_BEHIND: ReadonlySet<PartKind> = new Set(['back', 'wrap', 'other']);

/** Which parts of a model go over its sitters seen in a facing (see the header). */
export function overParts(v: Pick<ModelView, 'model' | 'facing'>): boolean[] {
  const behind = behindView(v.facing);
  const cam = Math.sign(towardCamera(v.facing).u);
  const mid = v.model.size[0] / 2;
  return v.model.parts.map((p) => {
    if (p.part === 'arm') return ((p.u[0] + p.u[1]) / 2 - mid) * cam > 0;
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
  const over = new Uint8Array(D.w * D.h);
  const ov = overParts(v);
  for (let i = 0; i < over.length; i++) if (D.part[i] >= 0 && ov[D.part[i]]) over[i] = 1;
  const sits = sitsByCushion(v.model, v.facing);
  const anchor: Pt = [v.art.ax, v.art.ay];
  const out: SeatLayers = {
    facing: v.facing,
    sits,
    hips: sits.map((s) => (s ? (projectLocal(anchor, v.model.size, v.facing, s[0], s[1], s[2]) as Pt) : null)),
    legs: sits.map((s) => (s ? legsFor(v.model, s, v.style) : null)),
    over,
    part: D.part,
    overParts: ov,
    cover: COVER,
  };
  memo.set(key, out);
  if (memo.size > 16) memo.delete(memo.keys().next().value!);
  return out;
}

/** The cushion tiles of a model placed in a facing (seatSpots order), for callers that index by tile. */
export const layerTiles = (v: Pick<ModelView, 'model' | 'facing'>) => cushionTiles(v.model.size, v.facing);
