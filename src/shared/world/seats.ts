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
 * The seat profile — what a seat's manifest entry says about sitting in it (the model spec's seat section); how people
 * are placed and drawn in it is its spec's build (src/shared/world/seatSpec.ts, src/client/engine/sprites/seatLayers.ts).
 *   seat       height of the cushion surface where the hips rest, world px above the floor (it seeds the model's fit)
 *   sitStyle   chair | stool | lounge | floor: which sitting pose the figure takes (avatarFrame SIT_POSE) and how its
 *              legs lie (sitLegs.ts)
 *   backrest   whether it has a back (the fit gives its model one)
 *   arms       whether it has arms (the fit gives its model a pair)
 */
export type SitStyle = 'chair' | 'stool' | 'lounge' | 'floor';

export interface SeatProfile {
  seat: number;
  sitStyle: SitStyle;
  backrest: boolean;
  arms?: boolean;
}

/** The manifest fields that make up a seat profile (the model spec's seat section). */
export const SEAT_FIELDS = ['seat', 'sitStyle', 'backrest', 'arms'] as const;

const FAMILY: Array<[RegExp, SeatProfile]> = [
  [/^stool/, { seat: 16, sitStyle: 'stool', backrest: false }],
  [/^beanbag/, { seat: 9, sitStyle: 'floor', backrest: true }],
  [/^ottoman/, { seat: 8, sitStyle: 'chair', backrest: false }],
  [/^(couch|armchair)/, { seat: 10, sitStyle: 'lounge', backrest: true, arms: true }],
  [/^bench/, { seat: 10, sitStyle: 'chair', backrest: false }],
  [/^heirloom-throne/, { seat: 13, sitStyle: 'chair', backrest: true, arms: true }],
];
const DEFAULT_PROFILE: SeatProfile = { seat: 12, sitStyle: 'chair', backrest: true };

/** A seat's profile: its art's own values over its family's defaults. */
export function seatProfile(sprite: string, own: Partial<SeatProfile> = {}): SeatProfile {
  const base = FAMILY.find(([re]) => re.test(sprite))?.[1] ?? DEFAULT_PROFILE;
  return {
    seat: own.seat ?? base.seat,
    sitStyle: own.sitStyle ?? base.sitStyle,
    backrest: own.backrest ?? base.backrest,
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

/** How far a sitter's figure is lifted off the floor so their thighs rest on the cushion (world px). */
export function sitterLift(p: SeatProfile): number {
  return p.seat - sitThigh(p.sitStyle);
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

/**
 * Where a sitter's hips are on a seat without a model (fractional tile coordinates: the figure stands on this point,
 * lifted): the middle of its tile. Every catalog seat has a model (the gate); this is only for art that has none yet.
 */
export function sitterPoint(spot: { x: number; y: number }): { x: number; y: number } {
  return { x: spot.x + 0.5, y: spot.y + 0.5 };
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
 * THE SEAT SPACING RULE (Carter: "leave some space where chairs don't sit right in front of items like the coffee
 * table"). The tile in front of every seat is clear floor, where a sitter's legs and feet go — except that a chair
 * or a stool may be pulled right up to what you sit at: a desk, a dining or work table, a counter, a bar. A couch,
 * armchair, beanbag, ottoman, bench or throne never has anything right in front of it (a coffee table goes a tile
 * away), and no seat faces a low table, a lamp or a plant. The layout check (scripts/room-map.ts) and decorate mode
 * (decor.ts) both hold rooms to it.
 */
const PULLS_UP = /^(chair|stool)/;
const SIT_AT = /^(desk|table-long|table-round|table-high|umbrella-table|counter|workbench|bar)/;

/** What stands on a tile (standing, solid, not on top of something else), if anything. */
function standingAt(scene: SceneDef, x: number, y: number, not?: SceneObject): SceneObject | undefined {
  return scene.objects.find((o) => {
    if (o === not || !isSolid(o) || o.z) return false;
    const f = footprint(o);
    return x >= f.x0 && x < f.x1 && y >= f.y0 && y < f.y1;
  });
}

/** Why a seat breaks the spacing rule in this scene (one line per cushion that does), empty if it doesn't. */
export function seatSpacingProblems(seat: SceneObject, scene: SceneDef): string[] {
  const out: string[] = [];
  for (const spot of seatSpots(seat, scene)) {
    const [fx, fy] = frontOf(spot);
    const hit = standingAt(scene, fx, fy, seat);
    if (!hit) continue;
    if (PULLS_UP.test(seat.sprite) && SIT_AT.test(hit.sprite)) continue;
    const name = (o: SceneObject) => `${o.id ?? o.sprite} (${o.sprite}${o.variant ? `.${o.variant}` : ''})`;
    out.push(`${name(seat)} cushion ${spot.index} at ${spot.x},${spot.y} faces ${name(hit)} right in front of it: leave a tile of floor`);
  }
  return out;
}

/** Every seat spacing problem in a scene. */
export function spacingProblems(scene: SceneDef): string[] {
  return scene.objects.filter(isSeat).flatMap((o) => seatSpacingProblems(o, scene));
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
