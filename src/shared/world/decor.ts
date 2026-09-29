/**
 * Team-owned decoration. Teams make their room theirs by placing furniture from a small catalog, turned any of
 * four ways (every model works from each: docs/furniture.md). Placement is validated identically on server and
 * client: inside the room, on free walkable tiles, never cutting off the door or any seat, and with the piece
 * itself usable (its working face open to the floor you can walk to).
 */
import { footprintFacing } from '../models';
import type { Facing, SceneDef, SceneObject } from './scene';
import { footprint, isSeat } from './scene';
import { FACING_VEC, seatSpots } from './seats';
import { withUseActions } from './uses';
import { WalkGrid } from './walkGrid';

export interface Decoration {
  id: string;
  roomId: string;
  itemId: string;
  x: number;
  y: number;
  /** Which way it was turned (decorate mode's R / ↻); older pieces without one keep their item's default. */
  facing?: Facing;
  placedBy: string;
  placedAt: string;
}

export interface DecorItem {
  id: string;
  name: string;
  sprite: string;
  variant?: string;
  /** The way it faces when first picked (it can be turned any of four ways). */
  facing?: Facing;
  /** [width, depth] in tiles (models.ts), default 1×1. */
  footprint?: [number, number];
  sit?: boolean;
  /** Used from any side (a plant, a lamp, a bell); otherwise from the tiles in front of it. */
  anySide?: boolean;
  /** A precious showpiece earned by a company milestone. */
  heirloom?: boolean;
}

export const DECOR_CATALOG: DecorItem[] = [
  { id: 'plant-small', name: 'Potted plant', sprite: 'plant', variant: 'a', anySide: true },
  { id: 'plant-tall', name: 'Tall plant', sprite: 'plant', variant: 'b', anySide: true },
  { id: 'lamp', name: 'Floor lamp', sprite: 'lamp', anySide: true },
  { id: 'beanbag-orange', name: 'Orange beanbag', sprite: 'beanbag', variant: 'orange', sit: true },
  { id: 'beanbag-purple', name: 'Purple beanbag', sprite: 'beanbag', variant: 'purple', sit: true },
  { id: 'beanbag-cyan', name: 'Cyan beanbag', sprite: 'beanbag', variant: 'cyan', sit: true },
  { id: 'armchair-mustard', name: 'Mustard armchair', sprite: 'armchair', variant: 'mustard', facing: 'se', sit: true },
  { id: 'armchair-green', name: 'Green armchair', sprite: 'armchair', variant: 'green', facing: 'sw', sit: true },
  { id: 'stool', name: 'Stool', sprite: 'stool', sit: true },
  { id: 'easel', name: 'Easel', sprite: 'easel', variant: 'b', facing: 'se' },
  { id: 'balloons', name: 'Balloons', sprite: 'balloons', variant: 'b', anySide: true },
  { id: 'arcade', name: 'Arcade cabinet', sprite: 'arcade-cabinet', variant: 'cyan', facing: 'sw' },
  // Heirlooms: the jewelry of a company's world.
  { id: 'heirloom-throne', name: 'Founders’ Throne', sprite: 'heirloom-throne', facing: 'sw', sit: true, heirloom: true },
  { id: 'heirloom-dragonlamp', name: 'Jade Dragon Lamp', sprite: 'heirloom-dragonlamp', facing: 'sw', heirloom: true, anySide: true },
  { id: 'heirloom-gold', name: 'Gold Reserve', sprite: 'heirloom-gold', heirloom: true, anySide: true },
  { id: 'heirloom-globe', name: 'Crystal Globe', sprite: 'heirloom-globe', heirloom: true, anySide: true },
  { id: 'heirloom-bell', name: 'Launch Bell', sprite: 'heirloom-bell', heirloom: true, anySide: true },
  { id: 'heirloom-trophy', name: 'Keystone Trophy', sprite: 'heirloom-trophy', heirloom: true, anySide: true },
];

export const DECOR_BY_ID = new Map(DECOR_CATALOG.map((d) => [d.id, d]));
export const MAX_DECOR_PER_ROOM = 16;
export const FACINGS: readonly Facing[] = ['se', 'sw', 'ne', 'nw'];

/** A quarter-turn clockwise on screen: the front goes lower right → lower left → upper left → upper right. */
export const TURN: Record<Facing, Facing> = { se: 'sw', sw: 'nw', nw: 'ne', ne: 'se' };

/** The facing a piece is placed with when none is chosen. */
export const defaultFacing = (item: DecorItem): Facing => item.facing ?? 'sw';

/**
 * The scene object for a placed piece: turned the way it was placed, covering the tiles it covers that way, and
 * doing what that kind of thing does wherever it stands (uses.ts: a placed arcade cabinet plays like the room's own).
 */
export function decorObject(d: Decoration): SceneObject | null {
  const item = DECOR_BY_ID.get(d.itemId);
  if (!item) return null;
  const facing = d.facing ?? item.facing;
  const [w, dd] = footprintFacing({ footprint: item.footprint ?? [1, 1] }, facing ?? 'sw');
  return withUseActions({
    id: `decor-${d.id}`,
    sprite: item.sprite,
    variant: item.variant,
    facing,
    x: d.x,
    y: d.y,
    ...(w !== 1 || dd !== 1 ? { w, d: dd } : {}),
    label: `${item.name} · added by the team`,
    actions: item.sit ? [{ kind: 'sit' }] : undefined,
  });
}

export function decorObjects(roomId: string, decorations: Decoration[]): SceneObject[] {
  return decorations
    .filter((d) => d.roomId === roomId)
    .map(decorObject)
    .filter((o): o is SceneObject => !!o);
}

/** The floor tiles in front of an object's working face. */
function frontTiles(o: SceneObject): Array<[number, number]> {
  if (!o.facing) return [];
  const f = footprint(o);
  const [dx, dy] = FACING_VEC[o.facing];
  const out: Array<[number, number]> = [];
  if (dx) for (let y = f.y0; y < f.y1; y++) out.push([dx > 0 ? f.x1 : f.x0 - 1, y]);
  else for (let x = f.x0; x < f.x1; x++) out.push([x, dy > 0 ? f.y1 : f.y0 - 1]);
  return out;
}

/**
 * Why a placement is not allowed, or null if it's fine. `piece` is what's being placed (decorObject), so its
 * footprint and the way it faces count; without it, a 1×1 piece at (x, y).
 */
export function placementProblem(
  scene: SceneDef,
  x: number,
  y: number,
  occupied: ReadonlySet<string> = new Set(),
  piece?: SceneObject,
): string | null {
  if (scene.kind !== 'interior' || !scene.interior) return 'Decorations go inside rooms.';
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'That spot is outside the room.';
  const w = piece?.w ?? 1;
  const d = piece?.d ?? 1;
  const tiles: Array<[number, number]> = [];
  for (let ty = y; ty < y + d; ty++) for (let tx = x; tx < x + w; tx++) tiles.push([tx, ty]);
  if (tiles.some(([tx, ty]) => tx < 0 || ty < 0 || tx >= scene.width || ty >= scene.height)) return 'That spot is outside the room.';
  const doorY = scene.interior.doorY;
  if (tiles.some(([tx, ty]) => tx <= 1 && Math.abs(ty - doorY) <= 1)) return 'Keep the doorway clear.';
  const grid = new WalkGrid(scene);
  const seatTiles = new Set(scene.objects.filter(isSeat).flatMap((o) => seatSpots(o, scene).map((s) => `${s.x},${s.y}`)));
  for (const [tx, ty] of tiles) {
    if (!grid.walkable(tx, ty) || seatTiles.has(`${tx},${ty}`)) return 'Something is already there.';
    if (occupied.has(`${tx},${ty}`)) return 'Someone is standing there.';
  }
  // The door must still reach every seat and most of the floor.
  for (const [tx, ty] of tiles) grid.set(tx, ty, false);
  const placed = piece ? { ...piece, x, y } : null;
  if (placed && isSeat(placed)) for (const s of seatSpots(placed, scene)) seatTiles.add(`${s.x},${s.y}`);
  const seen = new Set<string>();
  const queue: Array<[number, number]> = [[0, doorY]];
  seen.add(`0,${doorY}`);
  while (queue.length) {
    const [cx, cy] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      const seat = seatTiles.has(k);
      if (!grid.walkable(nx, ny) && !seat) continue;
      seen.add(k);
      if (!seat) queue.push([nx, ny]);
    }
  }
  for (const k of seatTiles) if (!seen.has(k)) return 'That would block someone’s seat.';
  let walkable = 0;
  for (let yy = 0; yy < scene.height; yy++) for (let xx = 0; xx < scene.width; xx++) if (grid.walkable(xx, yy)) walkable++;
  if (seen.size < walkable * 0.9) return 'That would cut off part of the room.';
  // The piece itself must be usable: something you use or sit on faces floor you can walk to.
  if (placed?.actions?.length) {
    const reachable = ([tx, ty]: [number, number]) => grid.walkable(tx, ty) && seen.has(`${tx},${ty}`);
    const item = DECOR_BY_ID.get(placed.id.replace(/^decor-/, '')) ?? DECOR_CATALOG.find((i) => i.sprite === placed.sprite && i.variant === placed.variant);
    const front = frontTiles(placed);
    const around: Array<[number, number]> = [];
    const f = footprint(placed);
    for (let ty = f.y0; ty < f.y1; ty++) around.push([f.x0 - 1, ty], [f.x1, ty]);
    for (let tx = f.x0; tx < f.x1; tx++) around.push([tx, f.y0 - 1], [tx, f.y1]);
    const usable = !item?.anySide && front.length ? front.some(reachable) : around.some(reachable);
    if (!usable) return front.length && !item?.anySide ? 'Its front would face a wall or furniture: turn it (R) or move it.' : 'Nobody could reach it there.';
  }
  return null;
}
