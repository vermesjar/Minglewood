/**
 * Team-owned decoration. Teams make their room theirs by placing furniture from a small catalog, turned any of
 * four ways (every model works from each: docs/furniture.md), and by hanging things on its two back walls (the
 * Wall category: every piece of wall art in the art catalog, and windows). Placement is validated identically on
 * server and client:
 *   - floor pieces: inside the room, on free walkable tiles, never cutting off the door or any seat, the piece
 *     itself usable (its working face open to the floor you can walk to), and never hiding a wall piece;
 *   - wall pieces: on the wall, never over another wall piece, the door or a memory-wall slot, and never hidden
 *     behind something tall (the same rule the layout check uses: src/shared/world/wallPieces.ts).
 */
import { footprintFacing, wallFit, type Manifest } from '../models';
import { wallDrawingSize, type ArtSource } from '../art/source';
import { MEMORY_SLOTS } from './memory';
import type { Facing, SceneDef, SceneObject } from './scene';
import { footprint, isSeat } from './scene';
import { FACING_VEC, seatSpots } from './seats';
import { withUseActions } from './uses';
import { WalkGrid } from './walkGrid';
import { hides, silhouetteOf, standing, wallBox, wallBoxes, wallSpan, type WallFace } from './wallPieces';

export type { WallFace };

export interface Decoration {
  id: string;
  roomId: string;
  itemId: string;
  /**
   * A floor piece: the tile it stands on. A wall piece: where its span starts along its wall, the way authored
   * wall objects have it: x along the right wall (y 0), y along the left wall (x 0).
   */
  x: number;
  y: number;
  /** Which way it was turned (decorate mode's R / ↻); older pieces without one keep their item's default. */
  facing?: Facing;
  /** Hung on a wall (the Wall category): which one. Absent: floor furniture (everything saved before walls). */
  wall?: WallFace;
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
  /** [width, depth] in tiles (models.ts), default 1×1. A wall piece's width is its span along the wall. */
  footprint?: [number, number];
  sit?: boolean;
  /** Used from any side (a plant, a lamp, a bell); otherwise from the tiles in front of it. */
  anySide?: boolean;
  /** A precious showpiece earned by a company milestone. */
  heirloom?: boolean;
  /** Hangs on a wall (the Wall category). */
  wall?: boolean;
  /** The walls it may hang on (default both). */
  walls?: WallFace[];
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

/* ------------------------------------------------------------------ the Wall category */

/** Windows: drawn in code (interior.ts drawWindow), with the live view outside and the sun through them. */
export const WINDOW_ITEMS: DecorItem[] = [
  { id: 'wall:window', name: 'Window', sprite: 'window', footprint: [2, 1], wall: true },
  { id: 'wall:window-small', name: 'Small window', sprite: 'window', variant: 'small', footprint: [1, 1], wall: true },
];

let wallItems: DecorItem[] = [...WINDOW_ITEMS];
let wallById = new Map(wallItems.map((d) => [d.id, d]));

/**
 * Fill the Wall category from the art catalog: every model of category 'wall-art' (a piece published from the
 * Design Lab joins it as soon as the manifest has it), after the windows. Called wherever the manifest is loaded:
 * the client's art.ts and the server's art source.
 */
export function registerWallArt(m: Manifest | null) {
  const art: DecorItem[] = Object.entries(m?.sprites ?? {})
    .filter(([, e]) => e.category === 'wall-art' && e.wall && e.file)
    .map(([key, e]) => {
      const [sprite, ...variant] = key.split('.');
      return { id: `wall:${key}`, name: e.name, sprite, variant: variant.length ? variant.join('.') : undefined, footprint: [e.footprint[0], 1] as [number, number], wall: true, walls: e.wall!.walls };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  wallItems = [...WINDOW_ITEMS, ...art];
  wallById = new Map(wallItems.map((d) => [d.id, d]));
}

/** The Wall category, in palette order. */
export const wallCatalog = (): readonly DecorItem[] => wallItems;

/** A catalog item, floor or wall. */
export const decorItem = (id: string): DecorItem | undefined => DECOR_BY_ID.get(id) ?? wallById.get(id);

/** How many tiles of wall a wall piece spans. */
export const wallSpanOf = (item: DecorItem): number => item.footprint?.[0] ?? 1;

/** Where a wall piece's span starts along its wall. */
export const wallAt = (d: Pick<Decoration, 'wall' | 'x' | 'y'>): number => (d.wall === 'left' ? d.y : d.x);

/**
 * The scene object for a placed piece: turned the way it was placed, covering the tiles it covers that way, and
 * doing what that kind of thing does wherever it stands (uses.ts: a placed arcade cabinet plays like the room's own,
 * a placed board takes notes). A wall piece hangs like an authored one: `wall`, and its span as w (right wall) or
 * d (left wall).
 */
export function decorObject(d: Decoration): SceneObject | null {
  const item = decorItem(d.itemId);
  if (!item) return null;
  const label = `${item.name} · added by the team`;
  if (d.wall || item.wall) {
    if (!d.wall || !item.wall) return null;
    const span = wallSpanOf(item);
    const right = d.wall === 'right';
    return withUseActions({
      id: `decor-${d.id}`,
      sprite: item.sprite,
      variant: item.variant,
      wall: d.wall,
      x: right ? d.x : 0,
      y: right ? 0 : d.y,
      ...(span !== 1 ? (right ? { w: span } : { d: span }) : {}),
      label,
    });
  }
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
    label,
    actions: item.sit ? [{ kind: 'sit' }] : undefined,
  });
}

/** The scene without one team piece (moving it: it mustn't collide with itself). */
export function withoutDecoration(scene: SceneDef, id: string): SceneDef {
  return { ...scene, objects: scene.objects.filter((o) => o.id !== `decor-${id}`) };
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
 * footprint and the way it faces count; without it, a 1×1 piece at (x, y). With `art` (the client's loaded art,
 * the server's from disk: the same drawings), a piece that would stand in front of a wall piece and hide it is
 * refused too.
 */
export function placementProblem(
  scene: SceneDef,
  x: number,
  y: number,
  occupied: ReadonlySet<string> = new Set(),
  piece?: SceneObject,
  art?: ArtSource,
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
  // Nothing on the walls may end up hidden behind it.
  if (placed && art) {
    const sil = silhouetteOf(placed, art);
    for (const w of wallBoxes(scene, art)) if (hides(sil, w)) return `It would hide the ${thing(w.obj)} on the wall.`;
  }
  return null;
}

/** What people call a scene object, in a sentence. */
function thing(o: SceneObject | undefined): string {
  if (!o) return 'piece';
  if (o.sprite === 'window') return 'window';
  if (o.sprite === 'door') return 'door';
  const name = (o.label?.split(' · ')[0] ?? o.sprite.replace(/-/g, ' ')).replace(/^the /i, '');
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** The scene object a wall piece would be at `at` on `face` (a ghost, or what's about to be placed). */
export function wallPiece(item: DecorItem, face: WallFace, at: number, id = 'ghost'): SceneObject | null {
  return decorObject({ id, roomId: '', itemId: item.id, wall: face, x: face === 'right' ? at : 0, y: face === 'left' ? at : 0, placedBy: '', placedAt: '' });
}

/**
 * Why a wall piece can't hang at `at` along `face` (its span's first tile), or null if it can: on the wall, clear
 * of every other wall piece, the door and the memory-wall slots, drawn to the wall art standard, and not hidden
 * behind anything standing in the room.
 */
export function wallPlacementProblem(scene: SceneDef, item: DecorItem, face: WallFace, at: number, art: ArtSource): string | null {
  if (scene.kind !== 'interior' || !scene.interior) return 'Decorations go inside rooms.';
  if (!item.wall) return 'That goes on the floor.';
  if (face !== 'left' && face !== 'right') return 'That spot is off the wall.';
  if (item.walls && !item.walls.includes(face)) return `That one hangs on the ${item.walls[0]} wall.`;
  const span = wallSpanOf(item);
  const len = face === 'right' ? scene.width : scene.height;
  if (!Number.isInteger(at) || at < 0 || at + span > len) return 'That spot is off the wall.';
  for (const o of scene.objects) {
    const s = wallSpan(o);
    if (!s || s.face !== face || at >= s.at + s.span || s.at >= at + span) continue;
    return o.sprite === 'door' ? 'Keep the door clear.' : `The ${thing(o)} hangs there.`;
  }
  for (const slot of MEMORY_SLOTS[scene.id] ?? []) if (slot.wall === face && slot.at >= at && slot.at < at + span) return 'That stretch is kept for the memory wall.';
  const piece = wallPiece(item, face, at);
  const box = piece && wallBox(piece, art);
  if (!piece || !box) return 'That piece can’t hang here.';
  const drawing = wallDrawingSize(art, piece);
  if (drawing && wallFit(drawing.spec.wall!, drawing, span, drawing.bbox).problems.length) return 'That piece is drawn too big for its span (the wall art standard).';
  for (const t of standing(scene, art))
    if (hides(t.sil, box)) return t.obj ? `The ${thing(t.obj)} in front would hide it.` : 'Someone works in front of that stretch of wall.';
  return null;
}
