/**
 * A Design Lab seat's rig, checked on its staged drawings before it's published and written into art/seat-rigs.json
 * after (the seat rig standard: src/shared/world/seatRigs.ts). The same check scripts/seat-rig.ts --check runs on
 * the catalog, so what the Lab publishes passes the gate.
 *
 *   npx tsx scripts/lab-rig.ts --entries <draft>/stage/entries.json --sprites <draft>/stage/sprites --key KEY \
 *       --rig <draft>/stage/rig.json [--write]
 *
 * rig.json is the draft's seatRig (rigLab.ts DraftRig: each own view's rig and a "looks right" tick per facing).
 * Every facing must be rigged, ticked and hold; --write then stores each own view, audited, with its drawing's
 * fingerprint. Prints one JSON object: {"ok", "problems": [...], "written"?}.
 */
import { readFileSync } from 'node:fs';
import type { Facing } from '../src/shared/world/scene';
import { rigForView, RIG_FACINGS, RIG_MIRROR, tidyRig, type SeatRig } from '../src/shared/world/seatRigs';
import { checkRigView } from '../src/client/engine/sprites/seatRig';
import { ownFacings, rigView, withRigs, type Sprites } from './lib/rigs';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

try {
  const key = arg('--key')!;
  const sprites = arg('--sprites')!;
  const M = JSON.parse(readFileSync(arg('--entries')!, 'utf8')) as Sprites;
  const draft = JSON.parse(readFileSync(arg('--rig')!, 'utf8')) as { views: Partial<Record<Facing, SeatRig>>; ok: Partial<Record<Facing, string>> };
  if (!M[key]) throw new Error(`no entry for ${key}`);
  const problems: string[] = [];
  const own = ownFacings(M, key);
  for (const f of own) if (!draft.views?.[f]) problems.push(`${f}: not rigged`);
  for (const f of RIG_FACINGS) {
    const v = rigView(M, key, f, sprites);
    const r = rigForView({ [key]: draft.views ?? {} }, key, f, { mirrored: v.mirrored, width: v.art.px.w });
    if (!r) continue;
    if (!draft.ok?.[f]) problems.push(`${f}: not ticked "looks right"`);
    for (const p of checkRigView(v, r.rig)) problems.push(`${f}: ${p}`);
  }
  let written: string[] | undefined;
  if (!problems.length && process.argv.includes('--write')) {
    written = withRigs((rigs) => {
      const out: Partial<Record<Facing, SeatRig>> = {};
      for (const f of own) {
        // audited when both it and the facing drawn as its mirror were ticked
        const days = [draft.ok[f], own.includes(RIG_MIRROR[f]) ? undefined : draft.ok[RIG_MIRROR[f]]].filter((d): d is string => !!d);
        out[f] = tidyRig({ ...draft.views[f]!, audited: days.sort().pop(), drawing: rigView(M, key, f, sprites).print });
      }
      rigs[key] = out;
      return Object.keys(out);
    });
  }
  console.log(JSON.stringify({ ok: !problems.length, problems, ...(written ? { written } : {}) }));
  process.exit(problems.length ? 1 : 0);
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: (err as Error).message, problems: [] }));
  process.exit(2);
}
