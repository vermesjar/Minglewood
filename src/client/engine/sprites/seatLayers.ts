/**
 * SEAT VIEWS for the renderer: a catalog seat as the game draws it in a facing — its render (the pixels and, per
 * pixel, the height its view ray meets the seat: src/shared/art/seatRender.ts) with its model — and, from that, where
 * each cushion's sitter goes, how their legs lie (src/shared/world/sitLegs.ts) and which of the seat's pixels are
 * drawn back over them (src/shared/art/seatCompose.ts). Nothing here is a rule about seats: it's all read off the
 * model and settled pixel by pixel.
 *
 * Pure apart from its caches: WorldView, the review tools and the Design Lab share it.
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { seatArtOf, seatBuildOf } from '@shared/art/seatCatalog';
import { billboardMask, composeSeat, overMask, projectHip, type Composed, type OverMask } from '@shared/art/seatCompose';
import type { SeatArt } from '@shared/art/seatRender';
import { sitsByCushion, type SeatModel, type SitPoint } from '@shared/world/seatModels';
import { SIT_POSE_OF, type SitStyle } from '@shared/world/seats';
import { legsFor, legsKey, type SitLegs } from '@shared/world/sitLegs';
import { FIG, figSeatRow, type Pt } from '@shared/world/seatFigure';
import { SIT_DROP } from '@shared/world/seats';
import { renderAvatarLayers } from './avatarQa';
import type { Pose } from './avatarFrame';

/** One view of a catalog seat: its render in a facing, its model and how it's sat in. */
export interface ModelView {
  key: string;
  art: SeatArt;
  facing: Facing;
  model: SeatModel;
  style: SitStyle;
}

/** The view of a catalog seat in a facing, or null for anything that isn't a catalog seat. */
export function modelViewFor(key: string, facing: Facing): ModelView | null {
  const b = seatBuildOf(key);
  const art = seatArtOf(key, facing);
  if (!b || !art) return null;
  return { key, art, facing, model: b.model, style: b.style };
}

/** How far a sitter's figure is lifted on a sitting point (world px): their feet this far under the pelvis. */
export function liftForSit(s: SitPoint, style: SitStyle): number {
  return s[2] - (FIG.feet - figSeatRow(SIT_DROP[style])) / 2;
}

export interface SeatSitting {
  /** Per cushion (seatSpots order): the sitting point (null: none over that cushion's tile). */
  sits: Array<SitPoint | null>;
  /** Per cushion: where the sitter's seat point is drawn, in the drawing's px. */
  hips: Array<Pt | null>;
  /** Per cushion: how the sitter's legs lie. */
  legs: Array<SitLegs | null>;
}

const sittingCache = new Map<string, SeatSitting>();

/** Where everyone sits in a seat view and how their legs lie. */
export function seatSitting(v: ModelView): SeatSitting {
  const k = `${v.key}|${v.facing}`;
  const had = sittingCache.get(k);
  if (had) return had;
  const sits = sitsByCushion(v.model, v.facing);
  const out: SeatSitting = {
    sits,
    hips: sits.map((s) => (s ? projectHip(v.art, v.model, v.facing, s) : null)),
    legs: sits.map((s) => (s ? legsFor(v.model, s, v.style) : null)),
  };
  sittingCache.set(k, out);
  return out;
}

const overCache = new Map<string, OverMask>();
const remember = (k: string, m: OverMask) => {
  overCache.set(k, m);
  if (overCache.size > 400) overCache.delete(overCache.keys().next().value!);
  return m;
};

/**
 * What of the seat is drawn over the sitter of a cushion, for a look in a sitting pose: the seat's pixels nearer
 * the camera than their body. Null when the cushion has no sitting point.
 */
export function sitterOver(v: ModelView, cushion: number, look: AvatarLoadout, pose: Pose): OverMask | null {
  const S = seatSitting(v);
  const sit = S.sits[cushion];
  const legs = S.legs[cushion];
  if (!sit || !legs) return null;
  const k = `${v.key}|${v.facing}|${cushion}|${pose}|${legsKey(legs)}|${JSON.stringify(look)}`;
  const had = overCache.get(k);
  if (had) return had;
  const fig = renderAvatarLayers(look, v.facing, pose, legs);
  return remember(k, overMask(v.art, v.model, sit, legs, v.style, fig));
}

/**
 * What of the seat is drawn over someone standing (or crouching) on its tile, their figure's feet at `feet` in the
 * drawing's px and their body a billboard at local (u, v), lifted `lift` px: the moment before sitting and after
 * standing up.
 */
export function standerOver(v: ModelView, feet: Pt, at: { u: number; v: number }, look: AvatarLoadout, pose: Pose, facing: Facing): OverMask {
  const k = `${v.key}|${v.facing}|stand|${pose}|${facing}|${feet[0]},${feet[1]}|${at.u.toFixed(3)},${at.v.toFixed(3)}|${JSON.stringify(look)}`;
  const had = overCache.get(k);
  if (had) return had;
  const fig = renderAvatarLayers(look, facing, pose);
  return remember(k, billboardMask(v.art, v.model, feet, at, fig, facing));
}

export interface SeatSitter {
  look: AvatarLoadout;
  /** Which cushion (seatSpots order). */
  cushion: number;
}

/** A seat and its sitters composed the way the game draws them (for sheets, checks and the Design Lab). */
export function composeView(v: ModelView, sitters: SeatSitter[], pad = 48): Composed {
  const S = seatSitting(v);
  const pose = SIT_POSE_OF[v.style] as Pose;
  return composeSeat(
    v.art,
    v.model,
    v.style,
    S.sits,
    S.legs,
    sitters.filter((s) => S.sits[s.cushion] && S.legs[s.cushion]).map((s) => ({ cushion: s.cushion, fig: renderAvatarLayers(s.look, v.facing, pose, S.legs[s.cushion]!) })),
    pad,
  );
}

/** Forget every cached mask (the tools rebuild after editing specs). */
export function resetSeatViews() {
  sittingCache.clear();
  overCache.clear();
}
