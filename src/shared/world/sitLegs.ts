/**
 * HOW A SITTER'S LEGS LIE, worked out from the seat itself (its model: seatModels.ts) in 3D, so the figure is drawn
 * the way the seat is built in every facing.
 *
 * From the hip joint (the thigh's centre line, THIGH_R above the cushion under the pelvis):
 *   reach  the thighs run forward, level (or tilted by `rise`), to the knees just past the seat's front edge — so
 *          the shins hang in front of the seat, never inside it (tiles, horizontal)
 *   rise   how far the knees are above the hip joint (world px): a beanbag lifts them, a stool lets them fall
 *   drop   from the knees' centre down to the soles (world px): to the floor, or to the seat's footrest, when a shin
 *          can reach it (up to SHIN_MAX), else they hang
 *   toe    how far forward of the knees the feet are (tiles): the shins lean out a little
 *   hang   how far the soles are off the floor (world px): 0 when the shins reach the floor
 *   rest   the footrest's top the soles are on, if the seat has one (world px)
 * Seen from behind the legs run away from the camera, and the seat hides what of them stands behind it — worked out
 * pixel by pixel against the seat's own depth (src/shared/art/seatCompose.ts), never by rule.
 * The avatar kit projects these with the world's own projection (32 px across and 16 px down per tile, 2 px up per
 * world px), so a thigh pointing toward the camera reads foreshortened at the floor's 2:1, never as a leg stuck out
 * sideways.
 */
import type { SeatModel, SitPoint } from './seatModels';
import { KNEE_OUT, SHIN_MAX } from './seatSpec';
import type { SitStyle } from './seats';

export interface SitLegs {
  reach: number;
  rise: number;
  drop: number;
  toe: number;
  hang: number;
  rest?: number;
}

/** The thigh's radius (world px): the hip joint and the thighs' centre line are this far above the cushion. */
export const THIGH_R = 1.5;
/** The shortest and longest a thigh is drawn (tiles, horizontal): a stool's knees still come forward. */
export const REACH_MIN = 0.16;
export const REACH_MAX = 0.56;
export { KNEE_OUT, SHIN_MAX };

/**
 * Legs for a sitting style with no seat to read (a portrait, a wheelchair's frame, a seat without a model): the
 * figure's own proportions on a seat of the style's usual height.
 */
export const NATURAL_LEGS: Record<SitStyle, SitLegs> = {
  chair: { reach: 0.3, rise: 0, drop: 10, toe: 0.03, hang: 0 },
  lounge: { reach: 0.32, rise: 0.5, drop: 10, toe: 0.05, hang: 0 },
  stool: { reach: 0.28, rise: -1.5, drop: 10, toe: 0.02, hang: 0 },
  floor: { reach: 0.4, rise: 2.5, drop: 8.5, toe: 0.12, hang: 0 },
};

/** Half the width of a sitter's two legs together (tiles): what their shins take up across the seat. */
export const LEGS_HALF = 0.1;

/**
 * The front of the seat in front of a sitter at u: the least v of every part their shins would hang through — the
 * cushion, the frame or skirt under it, a post — at the height of the shins (z0 … z1), across their legs' width. A
 * footrest doesn't count: the shins come down onto it.
 */
function frontAt(m: Pick<SeatModel, 'parts'>, u: number, v: number, z0: number, z1: number): number {
  let front = Infinity;
  for (const p of m.parts) {
    if (p.part === 'back' || p.part === 'wrap' || p.part === 'rest') continue;
    if (p.u[1] <= u - LEGS_HALF || p.u[0] >= u + LEGS_HALF || p.z[1] <= z0 || p.z[0] >= z1 || p.v[0] > v) continue;
    front = Math.min(front, p.v[0]);
  }
  return Number.isFinite(front) ? front : v;
}

/** The legs of someone sitting at `s` on a seat of this model, sat in with `style`. */
export function legsFor(m: Pick<SeatModel, 'parts' | 'rest'>, s: SitPoint, style: SitStyle): SitLegs {
  const [u, v, z] = s;
  const base = NATURAL_LEGS[style];
  const kneeZ = z + THIGH_R + base.rise;
  const floor = m.rest ?? 0;
  const drop = Math.max(2, Math.min(SHIN_MAX, kneeZ - floor));
  const knee = frontAt(m, u, v, kneeZ - drop, kneeZ) - KNEE_OUT;
  const reach = Math.max(REACH_MIN, Math.min(REACH_MAX, v - knee));
  return {
    reach: round(reach, 100),
    rise: base.rise,
    drop: round(drop, 2),
    toe: base.toe,
    hang: round(Math.max(0, kneeZ - drop - floor), 2),
    ...(m.rest !== undefined ? { rest: m.rest } : {}),
  };
}

/** Where the knees are in the seat's depth (local v) for someone sitting at `s` with these legs. */
export const kneeV = (s: SitPoint, legs: SitLegs) => s[1] - legs.reach;

/** The soles' height (world px) for these legs. */
export const soleZ = (s: SitPoint, legs: SitLegs) => s[2] + THIGH_R + legs.rise - legs.drop;

const round = (n: number, k: number) => Math.round(n * k) / k;

/** A short stable key for caches. */
export const legsKey = (l: SitLegs | undefined) => (l ? `${l.reach},${l.rise},${l.drop},${l.toe},${l.hang}` : '');
