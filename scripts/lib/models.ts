/**
 * The seat models from Node (src/shared/world/seatModels.ts): art/seat-models.json read and written under its own
 * lock in a compact, diffable layout (one line per part), and each seat's drawings resolved exactly as the game
 * resolves them (scripts/lib/rigs.ts viewArt: its own drawing for a facing, else its partner's mirrored; small
 * seats centred).
 */
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Facing } from '../../src/shared/world/scene';
import { tidyModel, type SeatModel, type SeatModels } from '../../src/shared/world/seatModels';
import type { ModelView } from '../../src/client/engine/sprites/seatModel';
import { profileOf, viewArt, type Sprites } from './rigs';

export const MODELS_FILE = 'art/seat-models.json';
const LOCK = 'art/.seat-models.lock';

export function readModels(path = MODELS_FILE): SeatModels {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SeatModels) : {};
}

const n = (x: number) => String(x);
const span = (s: readonly [number, number]) => `[${n(s[0])}, ${n(s[1])}]`;

/** The file's layout: seats in order, a model's fields in order, a part per line. */
export function formatModels(r: SeatModels): string {
  const keys = Object.keys(r).sort();
  const seat = (k: string) => {
    const m = tidyModel(r[k]);
    const lines = [`    "size": [${m.size[0]}, ${m.size[1]}]`];
    lines.push(`    "parts": [\n${m.parts.map((p) => `      {"part": "${p.part}", "u": ${span(p.u)}, "v": ${span(p.v)}, "z": ${span(p.z)}}`).join(',\n')}\n    ]`);
    lines.push(`    "sits": [${m.sits.map((s) => `[${s.map(n).join(', ')}]`).join(', ')}]`);
    if (m.views) lines.push(`    "views": ${JSON.stringify(m.views)}`);
    if (m.over) lines.push(`    "over": ${JSON.stringify(m.over)}`);
    if (m.fitted) lines.push(`    "fitted": "${m.fitted}"`);
    if (m.reviewed) lines.push(`    "reviewed": "${m.reviewed}"`);
    if (m.drawings) lines.push(`    "drawings": ${JSON.stringify(m.drawings)}`);
    if (m.note) lines.push(`    "note": ${JSON.stringify(m.note)}`);
    return `  "${k}": {\n${lines.join(',\n')}\n  }`;
  };
  return `{\n${keys.map(seat).join(',\n')}\n}\n`;
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Read, change and write the models under their lock (the Design Lab publishes into the same file). */
export function withModels<T>(fn: (r: SeatModels) => T, path = MODELS_FILE): T {
  let fd = -1;
  for (let i = 0; i < 600 && fd < 0; i++) {
    try {
      fd = openSync(LOCK, 'wx');
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 60_000) unlinkSync(LOCK);
      } catch {
        /* gone already */
      }
      sleep(100);
    }
  }
  if (fd < 0) throw new Error('seat models lock timed out');
  try {
    const r = readModels(path);
    const out = fn(r);
    const text = formatModels(r);
    JSON.parse(text); // never write what can't be read back
    writeFileSync(path, text);
    return out;
  } finally {
    closeSync(fd);
    unlinkSync(LOCK);
  }
}

/** One view of a seat with its model, as the game draws it (plus the drawing's file and fingerprint). */
export function modelView(M: Sprites, key: string, f: Facing, model: SeatModel, spritesDir?: string): ModelView & { mirrored: boolean; print: string; file: string } {
  const v = viewArt(M, key, f, spritesDir);
  const p = profileOf(M, key);
  return { art: v.art, facing: f, model, style: p.sitStyle, mirrored: v.mirrored, print: v.print, file: v.file };
}
