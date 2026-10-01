/** Stage blinded art-direction alternatives for a source-ambiguous shared contour.
 * This is an authoring decision, never a claim of recovered source truth or approval.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomInt, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { loadManifest } from './lib/manifest';
import type { Sprites } from './lib/seats';
import { modelView, requireDiagnosticModelPath } from './lib/models';
import { seatSurfaceMapProblems } from '../src/client/engine/sprites/seatModel';
import type { SeatModel } from '../src/shared/world/seatModels';
import type { Facing } from '../src/shared/world/scene';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const specFile = arg('spec'), modelsFile = arg('models'), out = arg('out');
if (!specFile || !modelsFile || !out) throw new Error('Usage: --spec FILE --models FILE --out DIRECTORY');
const spec = JSON.parse(readFileSync(specFile, 'utf8')) as { key: string; facing: Facing; drawing: string;
  modelParts: string; ambiguity: string; points: [number, number][]; options: { part: number; face: number; intent: string }[] };
const model = JSON.parse(readFileSync(modelsFile, 'utf8'))[spec.key] as SeatModel;
const source = model?.surfaces?.[spec.facing];
if (!source || source.drawing !== spec.drawing || JSON.stringify(model.parts) !== spec.modelParts || typeof spec.ambiguity !== 'string' || !spec.ambiguity.trim())
  throw new Error('An exact source-bound ambiguity declaration is required.');
const view = modelView(loadManifest().sprites as unknown as Sprites, spec.key, spec.facing, model);
const problems = seatSurfaceMapProblems(source, view.art.px, model);
if (problems.length) throw new Error(problems.join('; '));
if (!Array.isArray(spec.points) || !spec.points.length || spec.points.length > 64 ||
    spec.points.some(p => !Array.isArray(p) || p.length !== 2) || new Set(spec.points.map(p => p.join(','))).size !== spec.points.length)
  throw new Error('Provide 1–64 unique ambiguous source coordinates.');
for (const [x, y] of spec.points) if (!Number.isInteger(x) || !Number.isInteger(y) ||
    x < 0 || y < 0 || x >= source.width || y >= source.height || !view.art.px.d[(y * source.width + x) * 4 + 3])
  throw new Error('Every ambiguous point must be an opaque pixel in the exact source drawing.');
if (!Array.isArray(spec.options) || spec.options.length < 2 || spec.options.length > 4) throw new Error('Provide 2–4 explicit physical ownership alternatives.');
for (const option of spec.options) if (!option || !Number.isInteger(option.part) || !model.parts[option.part] ||
    ![0, 1, 2].includes(option.face) || typeof option.intent !== 'string' || !option.intent.trim()) throw new Error('Invalid alternative physical identity.');
if (new Set(spec.options.map(o => `${o.part}:${o.face}`)).size !== spec.options.length)
  throw new Error('Physical ownership alternatives must be distinct.');
requireDiagnosticModelPath(resolve(out, 'decision-private.json'));
if (existsSync(resolve(out, 'decision-private.json')) || spec.options.some((_, i) => existsSync(resolve(out, String.fromCharCode(65 + i), 'models.json')))) throw new Error('Existing blind trial is immutable; use another output directory.');
const options = spec.options.map((option, index) => ({ ...option, index }));
for (let i = options.length - 1; i > 0; i--) { const j = randomInt(i + 1); [options[i], options[j]] = [options[j], options[i]]; }
mkdirSync(out, { recursive: true });
const trials = options.map((option, index) => {
  const label = String.fromCharCode(65 + index), candidate = structuredClone(model), map = candidate.surfaces![spec.facing]!;
  for (const [x, y] of spec.points) map.labels[y * map.width + x] = 1 + option.part * 3 + option.face;
  const file = resolve(out, label, 'models.json');
  requireDiagnosticModelPath(file); mkdirSync(resolve(out, label), { recursive: true });
  writeFileSync(file, JSON.stringify({ [spec.key]: candidate }));
  return { label, file, option };
});
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(resolve(out, 'decision-private.json'), JSON.stringify({ status: 'UNREVIEWED_AUTHORING_ALTERNATIVES',
  spec: { path: resolve(specFile), sha256: digest(specFile) }, models: { path: resolve(modelsFile), sha256: digest(modelsFile) }, trials }, null, 2));
console.log(JSON.stringify({ status: 'UNREVIEWED', trials: trials.map(({ label, file }) => ({ label, file })) }));
