/**
 * A Design Lab seat's model (the seat model standard: src/shared/world/seatModels.ts), checked on its staged drawings
 * before it's published and written into art/seat-models.json after: the gate's own check (sprites/seatLayers.ts
 * seatProblems, as scripts/seat-layers.ts --check runs it on the catalog) in every facing, so what the Lab publishes
 * passes the gate.
 *
 *   node --no-maglev --import tsx scripts/lab-model.ts --entries <draft>/stage/entries.json \
 *       --sprites <draft>/stage/sprites --key KEY --model <draft>/stage/model.json [--write]
 *
 * model.json is the cached draft model. A stale cache, or one with legacy overrides, is replaced by automatic
 * compilation. Every facing must pass; --write stores the result and drawing fingerprints. No review stamp or
 * manually authored geometry is required. Prints {"ok", "model", "problems": [...], "written"?}.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { compileSeat, seatCompileSignature, SEAT_COMPILER_VERSION } from '../src/client/engine/sprites/seatCompiler';
import { profileOf, viewArt } from './lib/seats';
import { MODEL_FACINGS, modelShapeProblems, tidyModel, type SeatModel } from '../src/shared/world/seatModels';
import { seatProblems } from '../src/client/engine/sprites/seatLayers';
import { modelView, withModels, requireDiagnosticModelPath } from './lib/models';
import type { Sprites } from './lib/seats';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

try {
  requireDiagnosticModelPath(arg('--model')!);
  const key = arg('--key')!;
  const sprites = arg('--sprites')!;
  const M = JSON.parse(readFileSync(arg('--entries')!, 'utf8')) as Sprites;
  const draft = JSON.parse(readFileSync(arg('--model')!, 'utf8')) as { model?: SeatModel; reviewed?: string };
  const e = M[key];
  if (!e) throw new Error(`no entry for ${key}`);
  if (e.facings && !e.sameFromBehind && (!(e.facings.se || e.facings.sw) || !(e.facings.ne || e.facings.nw))) throw new Error('Seating needs both front and rear drawings.');
  const problems: string[] = [];
  const profile = profileOf(M, key);
  const input = { key, family: profile.seatKind, size: e.footprint, seat: profile.seat, style: profile.sitStyle, backrest: profile.backrest, arms: !!profile.arms,
    views: MODEL_FACINGS.map((facing) => ({ facing, art: viewArt(M, key, facing, sprites).art })) };
  let m = draft.model;
  if (m?.compiler?.version !== SEAT_COMPILER_VERSION || m.compiler.source !== seatCompileSignature(input) || m.views || m.over) {
    m = compileSeat({ ...input, ...(m?.surfaces !== undefined ? { surfaces: m.surfaces } : {}) }).model;
    writeFileSync(arg('--model')!, JSON.stringify({ model: m }, null, 2));
  }
  if (!m) problems.push('Automatic seating compilation produced no model.');
  else {
    const shape = modelShapeProblems(m, Math.round(e.footprint[0] * e.footprint[1]));
    for (const p of shape) problems.push(p);
    if (m.size[0] !== e.footprint[0] || m.size[1] !== e.footprint[1]) problems.push(`the model is ${m.size.join('×')}, the piece ${e.footprint.join('×')}`);
    if (!problems.length) for (const f of MODEL_FACINGS) for (const p of seatProblems(modelView(M, key, f, m, sprites))) problems.push(`${f}: ${p}`);

  }
  let written: string | undefined;
  if (!problems.length && m && process.argv.includes('--write')) {
    withModels((ms) => {
      ms[key] = tidyModel({ ...m, reviewed: draft.reviewed, drawings: Object.fromEntries(MODEL_FACINGS.map((f) => [f, modelView(M, key, f, m, sprites).print])) });
    }, undefined, { [key]: e.seatVerification });
    written = key;
  }
  console.log(JSON.stringify({ ok: !problems.length, model: m, problems, ...(written ? { written } : {}) }));
  process.exit(problems.length ? 1 : 0);
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: (err as Error).message, problems: [] }));
  process.exit(2);
}
