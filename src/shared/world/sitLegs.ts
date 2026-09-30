/**
 * HOW A SITTER'S LEGS LIE, worked out from the seat itself (its model: seatModels.ts) in 3D, so the figure is drawn
 * the way the seat is built in every facing.
 *
 * From the hip joint (the thigh's centre line, THIGH_R above the cushion under the pelvis):
 *   reach  the thighs run forward, level (or tilted by `rise`), to the knees just past the seat's front edge — so
 *          the shins hang in front of the seat, never inside it (tiles, horizontal)
 *   rise   how far the knees are above the hip joint (world px): a beanbag lifts them, a stool lets them fall
 *   drop   from the knees' centre down to the soles (world px): to the floor when a shin can reach it (up to
 *          SHIN_MAX), else they hang
 *   toe    how far forward of the knees the feet are (tiles): the shins lean out a little
 *   hang   how far the soles are off the floor (world px): 0 when the shins reach it, else they hang (a stool)
 *   hidden seen from behind, the seat's back rises past the sitter's head (BACK_HIDES: a throne), hiding them
 * Seen from behind the legs run away from the camera: the thighs lie out along the seat to the knees whatever the
 * seat, so a sitter reads as facing the way the seat does (without them, someone in a single chair seen from behind
 * looked turned against it), and nothing shows below the knees (avatarFrame BackLegs). A back that hides the sitter,
 * or a chair tall enough that the feet hang, tucks the legs out of sight.
 * The avatar kit projects these with the world's own projection (32 px across and 16 px down per tile, 2 px up per
 * world px), so a thigh pointing toward the camera reads foreshortened at the floor's 2:1, never as a leg stuck out
 * sideways.
 */
import type { SeatModel, SitPoint } from './seatModels';
import type { SitStyle } from './seats';

export interface SitLegs {
  reach: number;
  rise: number;
  drop: number;
  toe: number;
  hang: number;
  hidden?: boolean;
}

/** The thigh's radius (world px): the hip joint and the thighs' centre line are this far above the cushion. */
export const THIGH_R = 1.5;
/** The knees' centre stands this far (tiles) past the seat's front edge: the shins clear its front face. */
export const KNEE_OUT = 0.04;
/** The longest a sitter's shin reaches, knee centre to sole (world px); a taller seat leaves the feet hanging. */
export const SHIN_MAX = 11;
/** The shortest and longest a thigh is drawn (tiles, horizontal): a stool's knees still come forward. */
export const REACH_MIN = 0.16;
export const REACH_MAX = 0.56;

/**
 * Legs for a sitting style with no seat to read (a portrait, a wheelchair's frame, a seat without a model): the
 * figure's own proportions on a seat of the style's usual height.
 */
export const NATURAL_LEGS: Record<SitStyle, SitLegs> = {
  chair: { reach: 0.24, rise: 0, drop: 8, toe: 0.03, hang: 0 },
  lounge: { reach: 0.28, rise: 0.5, drop: 8, toe: 0.05, hang: 0 },
  stool: { reach: 0.2, rise: -1.5, drop: 8, toe: 0.02, hang: 8 },
  floor: { reach: 0.3, rise: 2.5, drop: 8, toe: 0.12, hang: 0 },
};

/**
 * A back (or wrap) rising this far above the cushion (world px) is past the middle of a sitter's head (the figure's
 * head spans 13.5 … 24.5 above the cushion): seen from behind it hides them, legs and all.
 */
export const BACK_HIDES = 19;

/** Half the width of a sitter's two legs together (tiles): what their shins take up across the seat. */
export const LEGS_HALF = 0.1;

/**
 * The front of the seat in front of a sitter at u: the least v of every part their shins would hang through — the
 * cushion, the frame or skirt under it, a post — at the height of the shins (z0 … z1), across their legs' width.
 */
function frontAt(m: Pick<SeatModel, 'parts'>, u: number, v: number, z0: number, z1: number): number {
  let front = Infinity;
  for (const p of m.parts) {
    if (p.part === 'back' || p.part === 'wrap') continue;
    if (p.u[1] <= u - LEGS_HALF || p.u[0] >= u + LEGS_HALF || p.z[1] <= z0 || p.z[0] >= z1 || p.v[0] > v) continue;
    front = Math.min(front, p.v[0]);
  }
  return Number.isFinite(front) ? front : v;
}

/** The legs of someone sitting at `s` on a seat of this model, sat in with `style`. */
export function legsFor(m: Pick<SeatModel, 'parts'>, s: SitPoint, style: SitStyle): SitLegs {
  const [u, v, z] = s;
  const base = NATURAL_LEGS[style];
  const kneeZ = z + THIGH_R + base.rise;
  const drop = Math.max(2, Math.min(SHIN_MAX, kneeZ));
  const knee = frontAt(m, u, v, kneeZ - drop, kneeZ) - KNEE_OUT;
  const reach = Math.max(REACH_MIN, Math.min(REACH_MAX, v - knee));
  const hidden = m.parts.some((p) => (p.part === 'back' || p.part === 'wrap') && u >= p.u[0] && u <= p.u[1] && p.z[1] - z >= BACK_HIDES);
  return { reach: round(reach, 100), rise: base.rise, drop: round(drop, 2), toe: base.toe, hang: round(Math.max(0, kneeZ - drop), 2), ...(hidden ? { hidden } : {}) };
}

/** Where the knees are in the seat's depth (local v) for someone sitting at `s` with these legs. */
export const kneeV = (s: SitPoint, legs: SitLegs) => s[1] - legs.reach;

const round = (n: number, k: number) => Math.round(n * k) / k;

/** A short stable key for caches. */
export const legsKey = (l: SitLegs | undefined) => (l ? `${l.reach},${l.rise},${l.drop},${l.toe},${l.hang}${l.hidden ? ',h' : ''}` : '');
