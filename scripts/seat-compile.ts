/** Compile seating from the drawings and declaration; never reads the old seat models. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MODEL_FACINGS, SEAT_LOOKS } from '../src/shared/world/seatModels';
import { compileSeat } from '../src/client/engine/sprites/seatCompiler';
import { composeSeat, seatLayers } from '../src/client/engine/sprites/seatLayers';
import { modelView, withModels, formatModels, readModels, requireDiagnosticModelPath } from './lib/models';
import { profileOf, seatKeys, viewArt, type Sprites } from './lib/seats';
import { loadManifest } from './lib/manifest';
import { blank, writePng } from './lib/png';
import { paste, row, stack } from './lib/draw';
import { text } from './lib/font';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const M = arg('entries') ? JSON.parse(readFileSync(arg('entries')!, 'utf8')) as Sprites : loadManifest().sprites as unknown as Sprites;
const keys = (arg('keys') ?? arg('key'))?.split(',') ?? seatKeys(M);
const out = arg('out') ?? 'art/review/seat-compiler';
requireDiagnosticModelPath(out);
requireDiagnosticModelPath(`${out}/models.json`);
if (arg('model')) requireDiagnosticModelPath(arg('model')!);
mkdirSync(out, { recursive: true });
const results: Record<string, ReturnType<typeof compileSeat>> = {};
const publishedModels = readModels();
for (const key of keys) {
  const entry = M[key] as (typeof M)[string] & { sameFromBehind?: boolean };
  if (entry.facings && !entry.sameFromBehind && (!(entry.facings.se || entry.facings.sw) || !(entry.facings.ne || entry.facings.nw)))
    throw new Error(`${key}: seating needs both front and rear drawings before compilation or publication`);
  const p = profileOf(M, key);
  const surfaces = entry.seatModel?.surfaces !== undefined ? entry.seatModel.surfaces : publishedModels[key]?.surfaces;
  const result = compileSeat({ key, family: p.seatKind, size: M[key].footprint, seat: p.seat, style: p.sitStyle, backrest: p.backrest, arms: !!p.arms,
    ...(surfaces !== undefined ? { surfaces } : {}),
    views: MODEL_FACINGS.map((facing) => ({ facing, art: viewArt(M, key, facing, arg('sprites')).art })) });
  results[key] = result;
  const rows = SEAT_LOOKS.map((look, index) => row(MODEL_FACINGS.map((f) => {
    const v = modelView(M, key, f, result.model, arg('sprites'));
    const comp = composeSeat(v, seatLayers(v).sits.map((_, cushion) => ({ cushion, look: SEAT_LOOKS[(index + cushion) % SEAT_LOOKS.length] ?? look })), 48).px;
    const img = blank(comp.w, comp.h, [205,184,154], 255);
    paste(img, comp, 0, 0);
    return img;
  })));
  const title = blank(rows[0].w, 16, [34,28,42], 255);
  text(title, 3, 3, key, [244,221,172], 1);
  writePng(`${out}/${key}.png`, stack([title, ...rows]));
  if (arg('model')) writeFileSync(arg('model')!, JSON.stringify({ model: result.model, compiled: result.version, problems: result.problems }, null, 2));
  console.error(`${key}: ${result.problems.length ? result.problems.join('; ') : 'passed'}`);
}
writeFileSync(`${out}/models.json`, formatModels(Object.fromEntries(Object.entries(results).map(([k,v]) => [k,v.model]))));
writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 2));
const problems = Object.entries(results).flatMap(([k,v]) => v.problems.map((p) => `${k}: ${p}`));
if (process.argv.includes('--write') && !problems.length) {
  withModels((models) => { for (const [key, r] of Object.entries(results)) models[key] = r.model; }, undefined, Object.fromEntries(Object.keys(results).map(key => [key, M[key].seatVerification])));
}
console.log(JSON.stringify({ ok: !problems.length, problems, keys, out }));
process.exitCode = problems.length ? 1 : 0;
