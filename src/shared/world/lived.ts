/**
 * A scene "as lived in": the authored layout plus everything the company has added since —
 * artifacts on memory walls and furniture teams placed themselves.
 */
import type { HistoricalArtifact } from '../domain/types';
import type { SceneDef } from './scene';
import { memoryObjects } from './memory';
import { decorObjects, type Decoration } from './decor';

export function livedScene(base: SceneDef, artifacts: HistoricalArtifact[], decorations: Decoration[]): SceneDef {
  const extra = [...memoryObjects(base.id, artifacts), ...decorObjects(base.id, decorations)];
  return extra.length ? { ...base, objects: [...base.objects, ...extra] } : base;
}
