import type { SceneDef, SceneObject } from './scene';
import { buildTown, TOWN_ID } from './northstarTown';
import { buildInteriors } from './interiors';
import { giveUses } from './uses';

export { TOWN_ID };

let cache: Map<string, SceneDef> | null = null;

/** All scenes of the demo world, built once (deterministic). */
export function allScenes(): Map<string, SceneDef> {
  if (!cache) {
    cache = new Map();
    cache.set(TOWN_ID, buildTown());
    for (const s of buildInteriors()) cache.set(s.id, s);
    // what clicking each thing does comes from what it is (uses.ts), the same everywhere
    for (const s of cache.values()) giveUses(s);
  }
  return cache;
}

export function getScene(id: string): SceneDef | undefined {
  return allScenes().get(id);
}

/** The building object in town that leads to `roomId`. */
export function buildingForRoom(roomId: string): SceneObject | undefined {
  return getScene(TOWN_ID)?.objects.find((o) => o.roomId === roomId);
}

export function findObject(sceneId: string, objectId: string): SceneObject | undefined {
  return getScene(sceneId)?.objects.find((o) => o.id === objectId);
}
