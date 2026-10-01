/** Publish an exactly reviewed model against existing catalog art, without refitting it. */
import { readFileSync } from 'node:fs';
import { loadManifest } from './lib/manifest';
import { MODELS_FILE, modelView, withModels } from './lib/models';
import { profileOf, viewArt, type Sprites } from './lib/seats';
import { publishedSeatSourceStatus } from '../src/client/engine/sprites/seatCompiler';
import { seatProblems } from '../src/client/engine/sprites/seatLayers';
import { MODEL_FACINGS, modelShapeProblems, type SeatModel } from '../src/shared/world/seatModels';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const key = arg('key'), modelsFile = arg('models'), contract = arg('contract'), bundle = arg('bundle');
if (!key || !modelsFile || !contract || !bundle)
  throw new Error('Usage: --key KEY --models FILE --contract FILE --bundle FILE');
const model = JSON.parse(readFileSync(modelsFile, 'utf8'))[key] as SeatModel | undefined;
const sprites = loadManifest().sprites as unknown as Sprites, entry = sprites[key];
if (!model || !entry) throw new Error('Reviewed model and existing catalog entry are required.');
const profile = profileOf(sprites, key);
const status = publishedSeatSourceStatus(model, { key, family: profile.seatKind, size: entry.footprint,
  seat: profile.seat, style: profile.sitStyle, backrest: profile.backrest, arms: !!profile.arms,
  views: MODEL_FACINGS.map(facing => ({ facing, art: viewArt(sprites, key, facing).art })) });
if (status === 'stale') throw new Error(`${key}: reviewed geometry no longer matches current catalog art/declaration.`);
const problems = [...modelShapeProblems(model, Math.round(entry.footprint[0] * entry.footprint[1])),
  ...MODEL_FACINGS.flatMap(facing => seatProblems(modelView(sprites, key, facing, model)))];
if (problems.length) throw new Error(problems.join('; '));
// The common writer checks the complete bundle under its lock, including the
// exact serialized model. A legacy revision remains explicitly legacy.
withModels(models => { models[key] = model; }, MODELS_FILE, { [key]: { contract, bundle } });
console.log(`${key}: published exact independently reviewed model (${status}).`);
