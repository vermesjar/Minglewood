/**
 * Where you stand to use something. Every interactive object is used from the floor tile in front of its
 * working face (an espresso machine facing the room is used from the room side, never from behind the bar);
 * failing that, from the reachable tile next to it that's quickest to walk to.
 */
import { findPath, type Tile } from './pathfinding';
import { FACING_VEC } from './seats';
import { footprint, type SceneObject } from './scene';
import type { WalkGrid } from './walkGrid';

/** Floor tiles touching an object's footprint, those in front of its facing first. */
export function approachTiles(o: SceneObject): Tile[] {
  const f = footprint(o);
  const front: Tile[] = [];
  const rest: Tile[] = [];
  const [fx, fy] = o.facing ? FACING_VEC[o.facing] : [0, 0];
  for (let y = f.y0 - 1; y <= f.y1; y++)
    for (let x = f.x0 - 1; x <= f.x1; x++) {
      const inside = x >= f.x0 && x < f.x1 && y >= f.y0 && y < f.y1;
      if (inside) continue;
      const diag = (x < f.x0 || x >= f.x1) && (y < f.y0 || y >= f.y1);
      if (diag) continue; // edge-adjacent only: you face what you use
      const isFront = (fx > 0 && x === f.x1) || (fx < 0 && x === f.x0 - 1) || (fy > 0 && y === f.y1) || (fy < 0 && y === f.y0 - 1);
      (isFront ? front : rest).push([x, y]);
    }
  return [...front, ...rest];
}

/**
 * The best tile to use an object from, walking from `from`: a reachable front tile if there is one (the
 * shortest walk among them), else the reachable side tile with the shortest walk. Null if none is reachable.
 */
export function approach(grid: WalkGrid, from: Tile, o: SceneObject): { tile: Tile; path: Tile[] } | null {
  const tiles = approachTiles(o).filter(([x, y]) => grid.walkable(x, y) || (x === from[0] && y === from[1]));
  const f = o.facing ? FACING_VEC[o.facing] : null;
  const fp = footprint(o);
  const isFront = ([x, y]: Tile) =>
    !!f && ((f[0] > 0 && x === fp.x1) || (f[0] < 0 && x === fp.x0 - 1) || (f[1] > 0 && y === fp.y1) || (f[1] < 0 && y === fp.y0 - 1));
  let best: { tile: Tile; path: Tile[]; cost: number } | null = null;
  for (const t of tiles) {
    const path = t[0] === from[0] && t[1] === from[1] ? [from] : findPath(grid, from, t);
    if (!path) continue;
    const cost = path.length + (isFront(t) ? 0 : 1000);
    if (!best || cost < best.cost) best = { tile: t, path, cost };
  }
  return best && { tile: best.tile, path: best.path };
}
