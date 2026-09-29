/**
 * A Design Lab seat, calibrated and checked on its staged drawings before it's published — the same fit
 * scripts/seat-fit.ts applies to the catalog (src/client/studio/seatLab.ts), so what the lab publishes passes it.
 *
 *   npx tsx scripts/lab-seat.ts --entries <draft>/stage/entries.json --sprites <draft>/stage/sprites \
 *       --key KEY --cushion X,Y [--cover]
 *
 * Prints one JSON object: {"profile": SeatProfile, "problems": {facing: [...]}} (or {"error"}).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Facing } from '@shared/world/scene';
import { fitSeat, type Drawings } from '../src/client/studio/seatLab';
import { readPng } from './lib/png';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

try {
  const key = arg('--key')!;
  const sprites = arg('--sprites')!;
  const entries = JSON.parse(readFileSync(arg('--entries')!, 'utf8')) as Record<string, Record<string, unknown>>;
  const e = entries[key] as {
    footprint: [number, number];
    file?: string;
    anchor?: [number, number];
    facings?: Partial<Record<Facing, { file: string; anchor: [number, number] }>>;
    sitStyle?: 'chair' | 'stool' | 'lounge' | 'floor';
    backrest?: boolean;
  };
  if (!e) throw new Error(`no entry for ${key}`);
  const [cx, cy] = (arg('--cushion') ?? '').split(',').map(Number);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) throw new Error('--cushion X,Y');
  const load = (file: string) => readPng(existsSync(join(sprites, file)) ? join(sprites, file) : join('public/art/sprites', file));
  const drawings: Drawings = {};
  if (e.file) drawings.one = { px: load(e.file), anchor: e.anchor ?? [0, 0] };
  for (const [f, rec] of Object.entries(e.facings ?? {})) if (rec) drawings[f as Facing] = { px: load(rec.file), anchor: rec.anchor };
  const fit = fitSeat(drawings, e.footprint, { sitStyle: e.sitStyle ?? 'chair', backrest: e.backrest ?? true }, { cushion: [cx, cy], cover: process.argv.includes('--cover') });
  if (!fit) throw new Error('no drawing to calibrate');
  console.log(JSON.stringify({ profile: fit.profile, problems: Object.fromEntries(fit.views.map((v) => [v.facing, v.problems])) }));
} catch (err) {
  console.log(JSON.stringify({ error: (err as Error).message }));
  process.exit(2);
}
