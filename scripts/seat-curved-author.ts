/** Stage source-only curved authoring and validate its exact source-bound result. No publication. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MODEL_FACINGS, type SeatModel } from '../src/shared/world/seatModels';
import { authoredGeometrySignature } from '../src/shared/world/seatSurfaceAuthored';
import { resolveSeatSurfaceMap, seatDepth } from '../src/client/engine/sprites/seatModel';
import { attachSeatSurfaces } from '../src/client/engine/sprites/seatCompiler';
import { modelView } from './lib/models';
import type { Sprites } from './lib/seats';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); if (i < 0) throw new Error(`--${name} required`); return process.argv[i + 1]; };
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const key = arg('key'), inputEntries = read(arg('entries')), entries = (inputEntries.sprites ?? inputEntries) as Sprites, models = read(arg('models'));
const model = models[key] as SeatModel, sprites = arg('sprites'), requestFile = arg('request');
const views = MODEL_FACINGS.map(facing => modelView(entries, key, facing, model, sprites));
if (views.some(view => view.style !== 'floor')) throw new Error('Rolled-rim authoring requires floor seating');
const request = { version: 1, key, style: 'floor', geometry: authoredGeometrySignature(model),
  model: { size: model.size, parts: model.parts, sits: model.sits },
  views: Object.fromEntries(views.map(view => {
    const surface = resolveSeatSurfaceMap(view);
    if (!surface || surface.version !== 1) throw new Error('Fresh source-only identity maps are required; existing authored depths cannot be silently regenerated');
    return [view.facing, { width: view.art.px.w, height: view.art.px.h, anchor: [view.art.ax, view.art.ay], rgba: Array.from(view.art.px.d), surface }];
  })) };
if (process.argv.includes('--prepare')) writeFileSync(requestFile, JSON.stringify(request));
else {
  const original = readFileSync(requestFile), result = read(arg('result'));
  if (original.toString('utf8') !== JSON.stringify(request)) throw new Error('Curved authoring source geometry or beauty changed');
  const hash = createHash('sha256').update(original).digest('hex');
  if (result.sourceInputsSha256 !== hash || result.status !== 'UNREVIEWED_AUTHORED_INTENT') throw new Error('Missing exact authored source receipt');
  for (const facing of MODEL_FACINGS) {
    const map = result.surfaces?.[facing];
    if (map?.version !== 2 || map.authored?.sourceInputsSha256 !== hash || map.authored?.generatorSha256 !== result.generatorSha256 ||
        JSON.stringify(map.labels) !== JSON.stringify(request.views[facing].surface.labels)) throw new Error('Authored result changed source identity or provenance');
  }
  const attached = attachSeatSurfaces(model, { surfaces: result.surfaces, views, style: 'floor' });
  for (const view of views) seatDepth({ ...view, model: attached });
  writeFileSync(arg('out'), JSON.stringify(attached));
}
