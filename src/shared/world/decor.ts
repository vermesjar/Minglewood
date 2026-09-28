/**
 * Team-owned decoration. Teams make their room theirs by placing furniture from a small catalog.
 * Placement is validated identically on server and client: inside the room, on a free walkable
 * tile, and never cutting off the door or any seat.
 */
import type { SceneDef, SceneObject } from './scene';
import { isSeat } from './scene';
import { WalkGrid } from './walkGrid';

export interface Decoration {
  id: string;
  roomId: string;
  itemId: string;
  x: number;
  y: number;
  placedBy: string;
  placedAt: string;
}

export interface DecorItem {
  id: string;
  name: string;
  sprite: string;
  variant?: string;
  facing?: SceneObject['facing'];
  sit?: boolean;
}

export const DECOR_CATALOG: DecorItem[] = [
  { id: 'plant-small', name: 'Potted plant', sprite: 'plant', variant: 'a' },
  { id: 'plant-tall', name: 'Tall plant', sprite: 'plant', variant: 'b' },
  { id: 'lamp', name: 'Floor lamp', sprite: 'lamp' },
  { id: 'beanbag-orange', name: 'Orange beanbag', sprite: 'beanbag', variant: 'orange', sit: true },
  { id: 'beanbag-purple', name: 'Purple beanbag', sprite: 'beanbag', variant: 'purple', sit: true },
  { id: 'beanbag-cyan', name: 'Cyan beanbag', sprite: 'beanbag', variant: 'cyan', sit: true },
  { id: 'armchair-mustard', name: 'Mustard armchair', sprite: 'armchair', variant: 'mustard', facing: 'se', sit: true },
  { id: 'armchair-green', name: 'Green armchair', sprite: 'armchair', variant: 'green', facing: 'sw', sit: true },
  { id: 'stool', name: 'Stool', sprite: 'stool', sit: true },
  { id: 'easel', name: 'Easel', sprite: 'easel', variant: 'b', facing: 'se' },
  { id: 'balloons', name: 'Balloons', sprite: 'balloons', variant: 'b' },
  { id: 'arcade', name: 'Arcade cabinet', sprite: 'arcade-cabinet', variant: 'cyan', facing: 'sw' },
];

export const DECOR_BY_ID = new Map(DECOR_CATALOG.map((d) => [d.id, d]));
export const MAX_DECOR_PER_ROOM = 16;

export function decorObject(d: Decoration): SceneObject | null {
  const item = DECOR_BY_ID.get(d.itemId);
  if (!item) return null;
  return {
    id: `decor-${d.id}`,
    sprite: item.sprite,
    variant: item.variant,
    facing: item.facing,
    x: d.x,
    y: d.y,
    label: `${item.name} · added by the team`,
    actions: item.sit ? [{ kind: 'sit' }] : undefined,
  };
}

export function decorObjects(roomId: string, decorations: Decoration[]): SceneObject[] {
  return decorations
    .filter((d) => d.roomId === roomId)
    .map(decorObject)
    .filter((o): o is SceneObject => !!o);
}

/** Why a placement is not allowed, or null if it's fine. */
export function placementProblem(scene: SceneDef, x: number, y: number, occupied: ReadonlySet<string> = new Set()): string | null {
  if (scene.kind !== 'interior' || !scene.interior) return 'Decorations go inside rooms.';
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= scene.width || y >= scene.height)
    return 'That spot is outside the room.';
  const doorY = scene.interior.doorY;
  if (x <= 1 && Math.abs(y - doorY) <= 1) return 'Keep the doorway clear.';
  const grid = new WalkGrid(scene);
  if (!grid.walkable(x, y)) return 'Something is already there.';
  if (scene.objects.some((o) => isSeat(o) && o.x === x && o.y === y)) return 'Something is already there.';
  if (occupied.has(`${x},${y}`)) return 'Someone is standing there.';
  // The door must still reach every seat and most of the floor.
  grid.set(x, y, false);
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
      const seat = scene.objects.some((o) => isSeat(o) && o.x === nx && o.y === ny);
      if (!grid.walkable(nx, ny) && !seat) continue;
      seen.add(k);
      if (!seat) queue.push([nx, ny]);
    }
  }
  for (const o of scene.objects) {
    if (isSeat(o) && !seen.has(`${o.x},${o.y}`)) return 'That would block someone’s seat.';
  }
  let walkable = 0;
  for (let yy = 0; yy < scene.height; yy++) for (let xx = 0; xx < scene.width; xx++) if (grid.walkable(xx, yy)) walkable++;
  if (seen.size < walkable * 0.9) return 'That would cut off part of the room.';
  return null;
}
