/**
 * The seat models from Node (src/shared/world/seatModels.ts): art/seat-models.json read and written under its own
 * lock in a compact, diffable layout (one line per part), and each seat's drawings resolved exactly as the game
 * resolves them (scripts/lib/seats.ts viewArt: its own drawing for a facing, else its partner's mirrored; small
 * seats centred).
 */
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireSeatPublicationEvidence, type SeatVerificationReference } from './seat-publication';
import { canonical } from './seat-verification';
import type { Facing } from '../../src/shared/world/scene';
import { tidyModel, type SeatModel, type SeatModels } from '../../src/shared/world/seatModels';
import type { ModelView } from '../../src/client/engine/sprites/seatModel';
import { profileOf, viewArt, type Sprites } from './seats';

export const MODELS_FILE = 'art/seat-models.json';
const LOCK = 'art/.seat-models.lock';

/** Diagnostic CLI outputs cannot be used as an alternate publication route. */
export function requireDiagnosticModelPath(path: string): void {
  const normalize = (p: string) => resolve(p).replace(/\\/g, '/').toLowerCase();
  const target = normalize(path), publicRoot = normalize('public');
  if (target === normalize(MODELS_FILE) || target === publicRoot || target.startsWith(publicRoot + '/'))
    throw new Error('Diagnostic output cannot replace published assets; use --write with independent evidence.');
}

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
    if (m.compiler) lines.push(`    "compiler": ${JSON.stringify(m.compiler)}`);
    if (m.bodyContact) lines.push(`    "bodyContact": ${JSON.stringify(m.bodyContact)}`);
    lines.push(`    "parts": [\n${m.parts.map((p) => `      {"part": "${p.part}", "u": ${span(p.u)}, "v": ${span(p.v)}, "z": ${span(p.z)}}`).join(',\n')}\n    ]`);
    lines.push(`    "sits": [${m.sits.map((s) => `[${s.map(n).join(', ')}]`).join(', ')}]`);
    if (m.views) lines.push(`    "views": ${JSON.stringify(m.views)}`);
    if (m.over) lines.push(`    "over": ${JSON.stringify(m.over)}`);
    if (m.fitted) lines.push(`    "fitted": "${m.fitted}"`);
    if (m.reviewed) lines.push(`    "reviewed": "${m.reviewed}"`);
    if (m.drawings) lines.push(`    "drawings": ${JSON.stringify(m.drawings)}`);
    if (m.surfaces) lines.push(`    "surfaces": ${JSON.stringify(m.surfaces)}`);
    if (m.note) lines.push(`    "note": ${JSON.stringify(m.note)}`);
    return `  "${k}": {\n${lines.join(',\n')}\n  }`;
  };
  return `{\n${keys.map(seat).join(',\n')}\n}\n`;
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Read, change and write the models under their lock (the Design Lab publishes into the same file). */
export function withModels<T>(fn: (r: SeatModels) => T, path = MODELS_FILE, evidence: Record<string, SeatVerificationReference | undefined> = {}): T {
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
    const previous = structuredClone(r);
    const out = fn(r);
    const text = formatModels(r);
    const serialized = JSON.parse(text) as SeatModels; // validate exactly the bytes that will be written
    // Unknown future geometry cannot disappear before the gate compares identity.
    const preserved = (raw: unknown, saved: unknown, path: string, top = false) => {
      if (!raw || typeof raw !== 'object') return;
      for (const [field, value] of Object.entries(raw)) {
        const emptyOptional = top && ['views', 'over', 'drawings'].includes(field) && value && typeof value === 'object' && !Object.keys(value).length;
        if (value === undefined || (top && ['fitted', 'reviewed', 'note'].includes(field)) || emptyOptional) continue;
        if (!saved || typeof saved !== 'object' || !Object.prototype.hasOwnProperty.call(saved, field))
          throw new Error(`${path}: model serialization would discard field ${field}; publication refused.`);
        preserved(value, (saved as Record<string, unknown>)[field], `${path}.${field}`);
      }
    };
    for (const [key, raw] of Object.entries(r)) preserved(raw, serialized[key], key, true);
    for (const key of Object.keys(previous)) if (!serialized[key]) throw new Error(`${key}: seat model removal requires the asset-removal workflow.`);
    for (const [key, model] of Object.entries(serialized)) {
      if (previous[key] && canonical(previous[key]) === canonical(model)) continue;
      requireSeatPublicationEvidence(key, model, previous[key], evidence[key]);
    }
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
