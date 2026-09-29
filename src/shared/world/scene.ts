/**
 * Scene format — plain JSON-serializable data so a future visual world builder can edit it.
 * A scene is either the outdoor world or a building interior.
 */
import type { OrgEvent } from '../domain/types';

/** Terrain legend (one char per tile). */
export const TERRAIN = {
  g: 'grass',
  h: 'grass-dark',
  m: 'meadow',
  p: 'path',
  P: 'plaza',
  s: 'sand',
  w: 'water',
  W: 'deep',
  d: 'dock',
  // interior floors
  '.': 'floor',
  ',': 'floor-alt',
  ' ': 'void',
} as const;
export type TerrainChar = keyof typeof TERRAIN;

export const UNWALKABLE_TERRAIN = new Set<string>(['w', 'W', ' ']);

export type Facing = 'se' | 'sw' | 'ne' | 'nw';

export type ObjectAction =
  | { kind: 'enter'; roomId: string }
  | { kind: 'exit' }
  | { kind: 'sit' }
  | { kind: 'artifact'; artifactId: string }
  | { kind: 'info'; title: string; body: string }
  | { kind: 'activity'; label: string; body: string }
  | { kind: 'link'; label: string; body: string }
  /** Hands you something to carry around (a coffee from the espresso machine). */
  | { kind: 'vend'; item: string; label: string }
  /** Switches something on or off for everyone in the room (lamps). `on` is its starting state. */
  | { kind: 'toggle'; label: string; on?: boolean }
  /** Walk up and ring it (the launch bell): a little celebration everyone in the room sees. */
  | { kind: 'ring'; label: string };

/** Height of a counter's top surface in art px — things stacked on a counter rest at this z. */
export const COUNTER_TOP = 20.5;

export type BuildingExtra =
  | 'awning'
  | 'chimney'
  | 'flag'
  | 'neon'
  | 'solar'
  | 'clock'
  | 'skylight'
  | 'columns'
  | 'lanterns'
  | 'ivy'
  | 'antenna'
  | 'porch'
  | 'marquee';

export interface BuildingSpec {
  wallH: number; // art px
  wall: string;
  wallAccent: string;
  roof: string;
  roofStyle: 'gable' | 'hip' | 'flat';
  trim: string;
  window: string;
  /** Which visible face the door is on ('left' = +y face, 'right' = +x face) and where along it. */
  doorFace: 'left' | 'right';
  doorAt: number;
  extras: BuildingExtra[];
  awningColors?: [string, string];
  floors?: number;
}

export interface SceneObject {
  id: string;
  /** Asset key, resolved by the client's sprite registry (e.g. "tree/pine", "chair"). */
  sprite: string;
  x: number;
  y: number;
  w?: number;
  d?: number;
  /** Blocks movement. Defaults to true for non-flat objects. */
  solid?: boolean;
  /** Rendered on the floor layer beneath everything (rugs, mats, stage). */
  flat?: boolean;
  /** Wall-mounted (interiors): which back wall. Position along the wall is x (right) or y (left). */
  wall?: 'left' | 'right';
  facing?: Facing;
  variant?: string;
  /** Resting height in art px when stacked on something (an espresso machine on a counter). */
  z?: number;
  label?: string;
  actions?: ObjectAction[];
  /** Only rendered while an event with this decor is active in the linked room. */
  eventDecor?: OrgEvent['decor'];
  artifactId?: string;
  building?: BuildingSpec;
  roomId?: string;
  /** The walkable tile in front of a building door. */
  door?: { x: number; y: number };
}

export interface SceneDef {
  id: string;
  kind: 'outdoor' | 'interior';
  name: string;
  width: number;
  height: number;
  tiles: string[];
  spawn: { x: number; y: number };
  objects: SceneObject[];
  interior?: InteriorTheme;
}

export interface InteriorTheme {
  floor: string;
  floorAlt: string;
  floorPattern: 'planks' | 'checker' | 'carpet' | 'tiles';
  wall: string;
  wallTop: string;
  trim: string;
  /** Tile on the left wall where the exit door sits (x = 0). */
  doorY: number;
  ambient: 'warm' | 'bright' | 'dim' | 'neon' | 'festive';
}

export function terrainAt(scene: SceneDef, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= scene.width || y >= scene.height) return ' ';
  return scene.tiles[y][x] ?? ' ';
}

export function footprint(o: SceneObject): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: o.x, y0: o.y, x1: o.x + (o.w ?? 1), y1: o.y + (o.d ?? 1) };
}

export function isSolid(o: SceneObject): boolean {
  if (o.wall) return false;
  if (o.solid !== undefined) return o.solid;
  return !o.flat;
}

/** Seats you can sit on: the seat tile itself is walkable for pathing to it. */
export function isSeat(o: SceneObject): boolean {
  return !!o.actions?.some((a) => a.kind === 'sit');
}
