/**
 * A Design Lab seat's model (the seat model standard: src/shared/world/seatModels.ts), checked on its staged drawings
 * before it's published and written into art/seat-models.json after: the gate's own check (sprites/seatLayers.ts
 * seatProblems, as scripts/seat-layers.ts --check runs it on the catalog) in every facing, so what the Lab publishes
 * passes the gate.
 *
 *   node --no-maglev --import tsx scripts/lab-model.ts --entries <draft>/stage/entries.json \
 *       --sprites <draft>/stage/sprites --key KEY --model <draft>/stage/model.json [--write]
 *
 * model.json is the draft's seatModel (ModelPanel.tsx DraftModel: { model, reviewed? }, the model with any per-view
 * sitting points and traced over layers). Every facing must hold and the model must be reviewed ("Passed" in the
 * Lab, by the reviewer); --write then stores it with the day it was reviewed and its drawings' fingerprints. Prints
 * one JSON object: {"ok", "problems": [...], "written"?}.
 */
import { readFileSync } from 'node:fs';
import { MODEL_FACINGS, modelShapeProblems, tidyModel, type SeatModel } from '../src/shared/world/seatModels';
import { seatProblems } from '../src/client/engine/sprites/seatLayers';
import { modelView, withModels } from './lib/models';
import type { Sprites } from './lib/seats';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

try {
  const key = arg('--key')!;
  const sprites = arg('--sprites')!;
  const M = JSON.parse(readFileSync(arg('--entries')!, 'utf8')) as Sprites;
  const draft = JSON.parse(readFileSync(arg('--model')!, 'utf8')) as { model?: SeatModel; reviewed?: string };
  const e = M[key];
  if (!e) throw new Error(`no entry for ${key}`);
  const problems: string[] = [];
  const m = draft.model;
  if (!m) problems.push('no model: fit one in How people sit in it (Auto-fit, then tune)');
  else {
    const shape = modelShapeProblems(m, Math.round(e.footprint[0] * e.footprint[1]));
    for (const p of shape) problems.push(p);
    if (m.size[0] !== e.footprint[0] || m.size[1] !== e.footprint[1]) problems.push(`the model is ${m.size.join('×')}, the piece ${e.footprint.join('×')}`);
    if (!problems.length) for (const f of MODEL_FACINGS) for (const p of seatProblems(modelView(M, key, f, m, sprites))) problems.push(`${f}: ${p}`);
    if (!draft.reviewed || !/^\d{4}-\d{2}-\d{2}$/.test(draft.reviewed)) problems.push('not reviewed: the reviewer passes it in How people sit in it');
  }
  let written: string | undefined;
  if (!problems.length && m && process.argv.includes('--write')) {
    withModels((ms) => {
      ms[key] = tidyModel({ ...m, reviewed: draft.reviewed, drawings: Object.fromEntries(MODEL_FACINGS.map((f) => [f, modelView(M, key, f, m, sprites).print])) });
    });
    written = key;
  }
  console.log(JSON.stringify({ ok: !problems.length, problems, ...(written ? { written } : {}) }));
  process.exit(problems.length ? 1 : 0);
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: (err as Error).message, problems: [] }));
  process.exit(2);
}
