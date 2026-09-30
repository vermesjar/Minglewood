/**
 * The seat standard. Every seat object has one or more SPOTS — one per cushion (a two-seat couch has two)
 * — each a tile of its footprint with the way a sitter faces. Seat tiles are furniture: you can't walk
 * through or stand on them. You path to a seat spot as the last step of a walk and sit there; standing up
 * steps you back off onto the floor.
 *
 * Facing: se = +x, sw = +y, ne = −y, nw = −x. A seat without its own facing (stools, beanbags) turns
 * toward the table or counter beside it, else toward the room (sw).
 */
import { footprint, isSeat, isSolid, type Facing, type SceneDef, type SceneObject } from './scene';

/**
 * The seat profile — how a piece of seat art is sat in. Every seat's art carries one (public/art/manifest.json,
 * fitted against the drawing by scripts/seat-fit.ts); these family defaults cover art that doesn't yet.
 *   seat       height of the cushion surface where the hips rest, world px above the floor
 *   seatDepth  seen from the front (se / sw): where along the seat's facing the hips rest, in tiles from the
 *              tile centre (+ = forward) — the cushion's centre, so the thighs lie along it to the front edge
 *   backDepth  seen from behind (ne / nw), for a seat with a backrest: the hips against the backrest (the
 *              crease between the backrest and the cushion, plus half a pelvis), so it hides the seat of their
 *              pants; defaults to seatDepth. The figure's legs are short for its furniture, so no one depth
 *              gives both views their contact — each view is composed on its own, as sprite games do.
 *   sitStyle   chair | stool | lounge | floor: which sitting pose the legs take (avatarFrame SIT_POSE)
 *   backrest   whether something stands between a sitter who faces away and us (a backrest, a beanbag's
 *              rolled back): the part of the drawing that isn't cushion is drawn over them (seatFit.ts)
 *   backLine   only where colour can't tell backrest from cushion: the backrest's top edge traced in each
 *              drawn back view (ne / nw, that drawing's own px, left to right); a mirrored view mirrors it
 *   arms       whether it has arms: seen from the front, its near arm stands between its sitter and us (the
 *              seat rig must draw it over them: src/shared/world/seatRigs.ts)
 */
export type SitStyle = 'chair' | 'stool' | 'lounge' | 'floor';

export interface SeatProfile {
  seat: number;
  seatDepth: number;
  backDepth: number;
  sitStyle: SitStyle;
  backrest: boolean;
  backLine?: Partial<Record<'ne' | 'nw', Array<[number, number]>>>;
  arms?: boolean;
}

/** The manifest fields that make up a seat profile (the model spec's seat section). */
export const SEAT_FIELDS = ['seat', 'seatDepth', 'backDepth', 'sitStyle', 'backrest', 'backLine', 'arms'] as const;

type FamilyProfile = Omit<SeatProfile, 'backDepth' | 'backLine'>;
const FAMILY: Array<[RegExp, FamilyProfile]> = [
  [/^stool/, { seat: 16, seatDepth: 0, sitStyle: 'stool', backrest: false }],
  [/^beanbag/, { seat: 9, seatDepth: 0, sitStyle: 'floor', backrest: true }],
  [/^ottoman/, { seat: 8, seatDepth: 0, sitStyle: 'chair', backrest: false }],
  [/^(couch|armchair)/, { seat: 10, seatDepth: 0.1, sitStyle: 'lounge', backrest: true, arms: true }],
  [/^bench/, { seat: 10, seatDepth: 0, sitStyle: 'chair', backrest: false }],
  [/^heirloom-throne/, { seat: 13, seatDepth: 0.15, sitStyle: 'chair', backrest: true, arms: true }],
];
const DEFAULT_PROFILE: FamilyProfile = { seat: 12, seatDepth: 0, sitStyle: 'chair', backrest: true };

/** A seat's profile: its art's own values over its family's defaults. */
export function seatProfile(sprite: string, own: Partial<SeatProfile> = {}): SeatProfile {
  const base = FAMILY.find(([re]) => re.test(sprite))?.[1] ?? DEFAULT_PROFILE;
  const seatDepth = own.seatDepth ?? base.seatDepth;
  return {
    seat: own.seat ?? base.seat,
    seatDepth,
    backDepth: own.backDepth ?? seatDepth,
    sitStyle: own.sitStyle ?? base.sitStyle,
    backrest: own.backrest ?? base.backrest,
    ...(own.backLine ? { backLine: own.backLine } : {}),
    ...((own.arms ?? base.arms) ? { arms: true } : {}),
  };
}

/** Sitting poses by style (the character frame's pose names). */
export const SIT_POSE_OF: Record<SitStyle, 'sit' | 'sit-stool' | 'sit-lounge' | 'sit-floor'> = {
  chair: 'sit',
  stool: 'sit-stool',
  lounge: 'sit-lounge',
  floor: 'sit-floor',
};
/** How far each sitting style lowers the upper body in the figure (sprite px at 2× density). */
export const SIT_DROP: Record<SitStyle, number> = { chair: 6, stool: 6, lounge: 7, floor: 8 };
/** Figure geometry the seat standard relies on (sprite px, see avatarFrame.ts): feet anchor, standing hip line, thigh radius. */
const FEET_Y = 104;
const HIP_Y = 82;
const THIGH_R = 3;

/** The underside of a sitter's thighs, in world px above their feet anchor, for a sitting style. */
export function sitThigh(style: SitStyle): number {
  return (FEET_Y - (HIP_Y + SIT_DROP[style] + THIGH_R)) / 2;
}

/**
 * Seen from behind, a sitter sinks this far into the seat (world px): the cushion's near edge — drawn back
 * over them — takes the bottom of their hips, as a body weighs into a seat, instead of a flat-bottomed
 * figure perched on top.
 */
export const BACK_SINK = 1.5;
/**
 * Seen from behind, a seat covers its sitter only up to this far above their hips (world px): however tall
 * the back, their head, shoulders and upper back show above it, the way a seated person reads from behind
 * (the figure is small for its furniture, so a tall back would otherwise leave only a head).
 */
export const BACK_COVER_UP = 6;

/** How far a sitter's figure is lifted off the floor so their thighs rest on the cushion (world px). */
export function sitterLift(p: SeatProfile, facing?: Facing): number {
  return p.seat - sitThigh(p.sitStyle) - (facing && seenFromBehind(facing) ? BACK_SINK : 0);
}

/**
 * Getting into and out of a seat, `k` of the way in (0 standing … 1 seated): in a crouch with the feet on the
 * floor until CROUCH_UNTIL, then up into the seat — from about where the seated feet meet the floor, a touch
 * past it (SETTLE world px) and settling; getting up, lifted off the cushion a touch, then down into the crouch.
 * `lift` is how high the seat lifts its sitter. (The renderer and the rig sheets move a sitter the same way.)
 */
export const CROUCH_UNTIL = 0.35;
export const SETTLE = 2;
export function sitMotion(k: number, sittingDown: boolean, lift: number): { inSeat: boolean; lift: number } {
  const inSeat = k >= CROUCH_UNTIL;
  if (!inSeat) return { inSeat, lift: 0 };
  const u = (k - CROUCH_UNTIL) / (1 - CROUCH_UNTIL);
  const rise = Math.min(1, u / 0.6);
  const settle = Math.max(0, (u - 0.6) / 0.4);
  return {
    inSeat,
    lift: sittingDown
      ? 0.6 * lift + (0.4 * lift + SETTLE) * (1 - (1 - rise) * (1 - rise)) - SETTLE * settle * settle * (3 - 2 * settle)
      : lift + SETTLE * (1 - u * (2 - u)),
  };
}

/** Whether a sitter facing this way is seen from behind (the camera looks from the south: +x +y is toward us). */
export const seenFromBehind = (f: Facing) => f === 'ne' || f === 'nw';

/** Where a sitter's hips are, in fractional tile coordinates (the figure stands on this point, lifted). */
export function sitterPoint(spot: { x: number; y: number; facing: Facing }, p: SeatProfile): { x: number; y: number } {
  const [dx, dy] = FACING_VEC[spot.facing];
  const depth = seenFromBehind(spot.facing) ? p.backDepth : p.seatDepth;
  return { x: spot.x + 0.5 + dx * depth, y: spot.y + 0.5 + dy * depth };
}

export interface SeatSpot {
  x: number;
  y: number;
  facing: Facing;
  /** Which cushion, 0-based, along the seat. */
  index: number;
}

export const FACING_VEC: Record<Facing, [number, number]> = { se: [1, 0], sw: [0, 1], ne: [0, -1], nw: [-1, 0] };

/** The facing of a seat: its own, else toward the table or counter it sits at, else toward the room. */
export function seatFacing(o: SceneObject, scene?: SceneDef): Facing {
  if (o.facing) return o.facing;
  if (scene) {
    for (const f of ['ne', 'nw', 'se', 'sw'] as Facing[]) {
      const [dx, dy] = FACING_VEC[f];
      const tx = o.x + dx;
      const ty = o.y + dy;
      const hit = scene.objects.find((s) => s !== o && !s.wall && isSolid(s) && !isSeat(s) && !s.z && tx >= s.x && tx < s.x + (s.w ?? 1) && ty >= s.y && ty < s.y + (s.d ?? 1));
      if (hit) return f;
    }
  }
  return 'sw';
}

/** Every place to sit on a seat object (empty for anything that isn't a seat). */
export function seatSpots(o: SceneObject, scene?: SceneDef): SeatSpot[] {
  if (!isSeat(o)) return [];
  const f = footprint(o);
  const facing = seatFacing(o, scene);
  const out: SeatSpot[] = [];
  for (let y = f.y0; y < f.y1; y++) for (let x = f.x0; x < f.x1; x++) out.push({ x, y, facing, index: out.length });
  return out;
}

/** The seat object and spot at a tile, if any. */
export function seatSpotAt(scene: SceneDef, x: number, y: number): { seat: SceneObject; spot: SeatSpot } | null {
  for (const o of scene.objects) {
    if (!isSeat(o)) continue;
    const spot = seatSpots(o, scene).find((s) => s.x === x && s.y === y);
    if (spot) return { seat: o, spot };
  }
  return null;
}

/** The floor tile in front of a spot. */
export function frontOf(spot: SeatSpot): [number, number] {
  const [dx, dy] = FACING_VEC[spot.facing];
  return [spot.x + dx, spot.y + dy];
}

/**
 * Where you can step off a seat when you stand up, best first: forward (off a couch facing open floor), back
 * (out from a chair pulled up to a table, off a stool at the bar), then to either side.
 */
export function stepOffTiles(spot: SeatSpot): Array<[number, number]> {
  const [dx, dy] = FACING_VEC[spot.facing];
  return [
    [spot.x + dx, spot.y + dy],
    [spot.x - dx, spot.y - dy],
    [spot.x + dy, spot.y + dx],
    [spot.x - dy, spot.y - dx],
  ];
}
