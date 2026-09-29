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
