/**
 * The seat rigs from Node (src/shared/world/seatRigs.ts): art/seat-rigs.json read and written under its own lock,
 * in a compact, diffable layout (one line per point list), and each seat's drawings resolved exactly as the game
 * resolves them (art.ts: its own drawing for a facing, else its partner's mirrored; small seats centred).
 */
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { centredAnchor } from '../../src/client/engine/sprites/footing';
import type { RigArt, RigView } from '../../src/client/engine/sprites/seatRig';
import { rigCushions, wrapsSitter } from '../../src/client/engine/sprites/seatRig';
import { allScenes } from '../../src/shared/world';
import { isSeat, type Facing } from '../../src/shared/world/scene';
import { seatProfile, type SeatProfile } from '../../src/shared/world/seats';
import { drawingPrint, RIG_FACINGS, RIG_MIRROR, type FrontRegion, type SeatRig, type SeatRigs } from '../../src/shared/world/seatRigs';
import { mirrorImg, readPng } from './png';

export const RIGS_FILE = 'art/seat-rigs.json';
const LOCK = 'art/.seat-rigs.lock';

export function readRigs(path = RIGS_FILE): SeatRigs {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SeatRigs) : {};
}

const pts = (p: ReadonlyArray<readonly [number, number]>) => `[${p.map(([x, y]) => `[${x}, ${y}]`).join(', ')}]`;

/** The file's layout: seats and facings in order, a rig's fields in order, each point list on one line. */
export function formatRigs(r: SeatRigs): string {
  const keys = Object.keys(r).sort();
  const seat = (k: string) => {
    const views = RIG_FACINGS.filter((f) => r[k][f]).map((f) => {
      const g = r[k][f]!;
      // a region is a polygon, or {"pts": polygon, "cover": n | null}
      const region = (p: FrontRegion) => (Array.isArray(p) ? pts(p) : `{"pts": ${pts(p.pts)}${p.cover !== undefined ? `, "cover": ${p.cover === null ? 'null' : p.cover}` : ''}}`);
      const list = (name: string, items: string[]) => `      "${name}": [${items.length ? `\n${items.map((t) => `        ${t}`).join(',\n')}\n      ` : ''}]`;
      const lines = [`      "hips": ${pts(g.hips)}`, list('front', g.front.map(region))];
      if (g.surface) lines.push(list('surface', g.surface.map(pts)));
      if (g.cover !== undefined) lines.push(`      "cover": ${g.cover}`);
      lines.push(`      "legs": "${g.legs}"`);
      if (g.tallBack) lines.push(`      "tallBack": true`);
      if (g.audited) lines.push(`      "audited": "${g.audited}"`);
      if (g.drawing) lines.push(`      "drawing": "${g.drawing}"`);
      return `    "${f}": {\n${lines.join(',\n')}\n    }`;
    });
    return `  "${k}": {\n${views.join(',\n')}\n  }`;
  };
  return `{\n${keys.map(seat).join(',\n')}\n}\n`;
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Read, change and write the rigs under their lock (the Design Lab publishes into the same file). */
export function withRigs<T>(fn: (r: SeatRigs) => T, path = RIGS_FILE): T {
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
  if (fd < 0) throw new Error('seat rigs lock timed out');
  try {
    const r = readRigs(path);
    const out = fn(r);
    const text = formatRigs(r);
    JSON.parse(text); // never write what can't be read back
    writeFileSync(path, text);
    return out;
  } finally {
    closeSync(fd);
    unlinkSync(LOCK);
  }
}

/* ------------------------------------------------------------------ the catalog's seats */

export interface Entry extends Partial<SeatProfile> {
  file?: string;
  anchor?: [number, number];
  facings?: Partial<Record<Facing, { file: string; anchor: [number, number] }>>;
  footprint: [number, number];
  wall?: unknown;
}
export type Sprites = Record<string, Entry>;

/** Every seat kind: anything sat on in any scene (as the game resolves its art), and any art with a seat height. */
export function seatKeys(M: Sprites): string[] {
  const keys = new Set<string>();
  for (const s of allScenes().values()) for (const o of s.objects) if (isSeat(o)) keys.add(o.variant && M[`${o.sprite}.${o.variant}`] ? `${o.sprite}.${o.variant}` : o.sprite);
  for (const [k, e] of Object.entries(M)) if (e.seat !== undefined) keys.add(k);
  return [...keys].filter((k) => M[k]).sort();
}

/** Which scenes seat people on a kind, and in which facings (for the report). */
export function sceneUses(M: Sprites): Map<string, Set<Facing>> {
  const out = new Map<string, Set<Facing>>();
  for (const s of allScenes().values())
    for (const o of s.objects) {
      if (!isSeat(o)) continue;
      const k = o.variant && M[`${o.sprite}.${o.variant}`] ? `${o.sprite}.${o.variant}` : o.sprite;
      if (!out.has(k)) out.set(k, new Set());
    }
  return out;
}

/** A seat's placement in a facing: its footprint as placed (a long seat runs across the way it faces). */
export function placed(footprint: readonly [number, number], f: Facing): { w: number; d: number } {
  const long = Math.max(...footprint);
  const across = f === 'ne' || f === 'sw';
  return { w: across ? long : Math.min(...footprint), d: across ? Math.min(...footprint) : long };
}

export interface ViewArt {
  art: RigArt;
  /** The drawing is its partner's, mirrored: this view's rig is the partner's mirrored, unless it has its own. */
  mirrored: boolean;
  /** The file drawn, and the fingerprint of its pixels as this view uses them (before mirroring). */
  file: string;
  print: string;
}

/** The drawing the game uses for a seat in a facing (art.ts artSprite), anchor included. */
export function viewArt(M: Sprites, key: string, f: Facing, spritesDir = 'public/art/sprites'): ViewArt {
  const e = M[key];
  const { w, d } = placed(e.footprint, f);
  let rec = e.file ? { file: e.file, anchor: e.anchor! } : undefined;
  let mirror = !!e.file && e.footprint[0] !== e.footprint[1] && w === e.footprint[1] && d === e.footprint[0];
  if (e.facings) {
    rec = e.facings[f];
    if (!rec && e.facings[RIG_MIRROR[f]]) {
      rec = e.facings[RIG_MIRROR[f]];
      mirror = true;
    }
    rec ??= Object.values(e.facings)[0]!;
  }
  const load = (file: string) => readPng(existsSync(`${spritesDir}/${file}`) ? `${spritesDir}/${file}` : `public/art/sprites/${file}`);
  const raw = load(rec!.file);
  const print = drawingPrint(raw.w, raw.h, raw.d);
  const img = mirror ? mirrorImg(raw) : raw;
  const px = { w: img.w, h: img.h, d: new Uint8ClampedArray(img.d.buffer, img.d.byteOffset, img.d.length) };
  const c = e.wall ? null : centredAnchor(px, w, d, 2);
  let [ax, ay] = c ?? rec!.anchor;
  if (!c && mirror) ax = img.w - ax;
  return { art: { px, ax, ay }, mirrored: mirror, file: rec!.file, print };
}

/** The facings that need a rig of their own: those whose drawing isn't a partner's mirrored. */
export function ownFacings(M: Sprites, key: string): Facing[] {
  return RIG_FACINGS.filter((f) => !viewArt(M, key, f).mirrored);
}

/** A seat's profile as the game reads it (art.ts: its own, else a sibling's, over its family's defaults). */
export function profileOf(M: Sprites, key: string): SeatProfile {
  const sprite = key.split('.')[0];
  const own = M[key];
  const sibling = own?.seat === undefined ? Object.entries(M).find(([k, e]) => (k === sprite || k.startsWith(`${sprite}.`)) && e.seat !== undefined)?.[1] : undefined;
  const e = own?.seat !== undefined ? own : (sibling ?? own);
  return seatProfile(sprite, { seat: e?.seat, seatDepth: e?.seatDepth, backDepth: e?.backDepth, sitStyle: e?.sitStyle, backrest: e?.backrest, backLine: e?.backLine, arms: e?.arms });
}

/** One view of a seat, ready to compose and check. */
export function rigView(M: Sprites, key: string, f: Facing, spritesDir?: string): RigView & { mirrored: boolean; print: string; file: string } {
  const v = viewArt(M, key, f, spritesDir);
  const p = profileOf(M, key);
  // a back view's backrest line is traced on the drawn back view (its partner's, when this one is its mirror)
  const drawnBack = (v.mirrored ? RIG_MIRROR[f] : f) as 'ne' | 'nw';
  const wraps = (f === 'ne' || f === 'nw') && wrapsSitter(p.backLine?.[drawnBack]);
  return { art: v.art, facing: f, footprint: M[key].footprint, style: p.sitStyle, seat: p.seat, backrest: p.backrest, arms: !!p.arms, wraps, mirrored: v.mirrored, print: v.print, file: v.file };
}

export { rigCushions };
export type { SeatRig };
