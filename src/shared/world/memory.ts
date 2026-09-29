/**
 * Organizational memory in space. Each interior has "memory wall" slots; when a company
 * commemorates something (a launch, an award, an offsite), the artifact takes the next free slot
 * in the chosen room and becomes a clickable object with its story. Old worlds fill up; new ones
 * don't — that difference is the point.
 */
import type { HistoricalArtifact } from '../domain/types';
import type { SceneDef, SceneObject } from './scene';

export interface MemorySlot {
  wall: 'left' | 'right';
  at: number;
}

/** Free wall spots per interior: clear of authored wall items, and not hidden behind tall furniture. */
export const MEMORY_SLOTS: Record<string, MemorySlot[]> = {
  hq: [{ wall: 'right', at: 9 }, { wall: 'right', at: 0 }, { wall: 'left', at: 10 }, { wall: 'left', at: 11 }],
  cafe: [{ wall: 'right', at: 0 }, { wall: 'left', at: 0 }, { wall: 'right', at: 10 }, { wall: 'left', at: 9 }],
  eng: [{ wall: 'right', at: 5 }, { wall: 'right', at: 8 }, { wall: 'left', at: 1 }, { wall: 'left', at: 6 }, { wall: 'left', at: 7 }],
  launch: [{ wall: 'right', at: 8 }, { wall: 'right', at: 11 }, { wall: 'right', at: 0 }, { wall: 'left', at: 6 }],
  events: [{ wall: 'right', at: 11 }, { wall: 'right', at: 15 }, { wall: 'left', at: 1 }, { wall: 'left', at: 5 }],
  focus: [{ wall: 'left', at: 1 }, { wall: 'left', at: 2 }, { wall: 'left', at: 5 }, { wall: 'left', at: 6 }],
  arcade: [{ wall: 'left', at: 0 }, { wall: 'left', at: 1 }, { wall: 'right', at: 11 }],
  design: [{ wall: 'right', at: 5 }, { wall: 'right', at: 6 }, { wall: 'left', at: 6 }, { wall: 'left', at: 5 }],
};

const STYLE: Record<HistoricalArtifact['kind'], { sprite: string; variant: string }> = {
  launch: { sprite: 'frame', variant: 'rocket' },
  award: { sprite: 'plaque', variant: 'gold' },
  offsite: { sprite: 'frame', variant: 'photo' },
  milestone: { sprite: 'frame', variant: 'star' },
  tenure: { sprite: 'plaque', variant: 'silver' },
  tradition: { sprite: 'frame', variant: 'lake' },
};

export function slotKey(s: MemorySlot) {
  return `${s.wall}:${s.at}`;
}

/** Next free slot in a room, or null when its memory wall is full. */
export function nextFreeSlot(roomId: string, artifacts: HistoricalArtifact[]): MemorySlot | null {
  const used = new Set(
    artifacts.filter((a) => a.sceneId === roomId && a.placement).map((a) => slotKey(a.placement!)),
  );
  return (MEMORY_SLOTS[roomId] ?? []).find((s) => !used.has(slotKey(s))) ?? null;
}

/** Scene objects for artifacts placed on memory walls. */
export function memoryObjects(sceneId: string, artifacts: HistoricalArtifact[]): SceneObject[] {
  return artifacts
    .filter((a) => a.sceneId === sceneId && a.placement)
    .map((a) => {
      const { wall, at } = a.placement!;
      const style = STYLE[a.kind];
      return {
        id: a.objectId,
        sprite: style.sprite,
        variant: style.variant,
        wall,
        x: wall === 'right' ? at : 0,
        y: wall === 'left' ? at : 0,
        label: a.title,
        artifactId: a.id,
        actions: [{ kind: 'artifact' as const, artifactId: a.id }],
      };
    });
}

/** The scene as it looks today: authored objects plus everything the company has added since. */
export function sceneWithMemory(scene: SceneDef, artifacts: HistoricalArtifact[]): SceneDef {
  const extra = memoryObjects(scene.id, artifacts);
  return extra.length ? { ...scene, objects: [...scene.objects, ...extra] } : scene;
}
