/**
 * Seat lab rooms (development only): one small room per catalog seat kind, `seatlab-<key>` (seatlab-couch.green),
 * with that seat placed in all four facings — where the in-game spec (tests/e2e/seat-models.spec.ts) walks a bot up
 * to each and sits it down with real clicks, and takes the live screenshots every seat model is judged by. A room per
 * kind keeps agents working on different seats out of each other's shots.
 *
 * The server only lets anyone into one outside production (socketServer 'enter'); nothing in the product links here.
 */
import type { Facing, InteriorTheme, SceneDef, SceneObject } from './scene';
import { placedSize } from './seatModels';

export const SEAT_LAB = 'seatlab-';
export const isSeatLab = (id: string) => id.startsWith(SEAT_LAB);

/** Where each facing's copy stands, far enough apart that no two share a screenshot. */
export const SEAT_LAB_SPOTS: Record<Facing, [number, number]> = { se: [3, 3], sw: [8, 3], ne: [3, 9], nw: [9, 9] };

const THEME: InteriorTheme = {
  floor: '#c9a47e',
  floorAlt: '#bf9872',
  floorPattern: 'planks',
  wall: '#f3dcb8',
  wallTop: '#8a5a3b',
  trim: '#6b3f2a',
  doorY: 6,
  ambient: 'bright',
};

/**
 * A seat's footprint [width, depth]: given in the id (`seatlab-<key>~2x1`), else its family's (couches and benches
 * are two cushions wide). Never read from art/seat-models.json: the dev server imports this file, and a model saved
 * every few seconds by the fitting tools would restart it under everyone's bots.
 */
function sizeOf(key: string, given?: string): [number, number] {
  const m = given?.match(/^(\d)x(\d)$/);
  if (m) return [Number(m[1]), Number(m[2])];
  return /^(couch|bench|sofa)/.test(key) ? [2, 1] : [1, 1];
}

const cache = new Map<string, SceneDef>();

/** The lab room for a scene id `seatlab-<key>` (undefined for any other id). */
export function seatLabScene(id: string): SceneDef | undefined {
  if (!isSeatLab(id)) return undefined;
  const had = cache.get(id);
  if (had) return had;
  const [key, given] = id.slice(SEAT_LAB.length).split('~');
  if (!/^[a-z][\w-]*(\.[\w-]+)?$/.test(key)) return undefined;
  const dot = key.indexOf('.');
  const sprite = dot < 0 ? key : key.slice(0, dot);
  const variant = dot < 0 ? undefined : key.slice(dot + 1);
  const size = sizeOf(key, given);
  const objects: SceneObject[] = (Object.keys(SEAT_LAB_SPOTS) as Facing[]).map((facing) => {
    const [x, y] = SEAT_LAB_SPOTS[facing];
    const { w, d } = placedSize(size, facing);
    return { id: `${id}-${facing}`, sprite, ...(variant ? { variant } : {}), x, y, w, d, facing, label: `${key} ${facing}`, actions: [{ kind: 'sit' }] };
  });
  objects.push({ id: `${id}-door`, sprite: 'door', wall: 'left', x: 0, y: THEME.doorY, label: 'Exit to town', actions: [{ kind: 'exit' }] });
  const scene: SceneDef = {
    id,
    kind: 'interior',
    name: `Seat lab: ${key}`,
    width: 13,
    height: 13,
    tiles: Array.from({ length: 13 }, () => '.'.repeat(13)),
    spawn: { x: 0, y: THEME.doorY },
    objects,
    interior: THEME,
  };
  cache.set(id, scene);
  return scene;
}
