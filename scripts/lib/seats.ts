/**
 * The catalog's seats from Node: which kinds there are, each one's drawing in a facing resolved exactly as the game
 * resolves it (art.ts: its own drawing for a facing, else its partner's mirrored; small seats centred), and its
 * profile. The seat tools (seat-model.ts, seat-layers.ts) and the Design Lab's publish check (lab-model.ts) share it.
 */
import { existsSync } from 'node:fs';
import { centredAnchor, type Pixels } from '../../src/client/engine/sprites/footing';
import { allScenes } from '../../src/shared/world';
import { isSeat, type Facing } from '../../src/shared/world/scene';
import { drawingPrint } from '../../src/shared/world/seatFigure';
import type { SeatModel } from '../../src/shared/world/seatModels';
import type { SeatVerificationReference } from './seat-publication';
import { seatProfile, type SeatProfile } from '../../src/shared/world/seats';
import { mirrorImg, readPng } from './png';

export interface Entry extends Partial<SeatProfile> {
  file?: string;
  anchor?: [number, number];
  facings?: Partial<Record<Facing, { file: string; anchor: [number, number] }>>;
  footprint: [number, number];
  wall?: unknown;
  seatModel?: SeatModel;
  /** Transient local publication proof; never copied into the public manifest. */
  seatVerification?: SeatVerificationReference;
}
export type Sprites = Record<string, Entry>;

const MIRROR: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };

/** Every seat kind: anything sat on in any scene (as the game resolves its art), and any art with a seat height. */
export function seatKeys(M: Sprites): string[] {
  const keys = new Set<string>();
  for (const s of allScenes().values()) for (const o of s.objects) if (isSeat(o)) keys.add(o.variant && M[`${o.sprite}.${o.variant}`] ? `${o.sprite}.${o.variant}` : o.sprite);
  for (const [k, e] of Object.entries(M)) if (e.seat !== undefined) keys.add(k);
  return [...keys].filter((k) => M[k]).sort();
}

/** A seat's placement in a facing: its footprint as placed (a long seat runs across the way it faces). */
export function placed(footprint: readonly [number, number], f: Facing): { w: number; d: number } {
  const long = Math.max(...footprint);
  const across = f === 'ne' || f === 'sw';
  return { w: across ? long : Math.min(...footprint), d: across ? Math.min(...footprint) : long };
}

export interface ViewArt {
  /** The drawing as the game draws it in this facing (mirrored where it is), and its anchor. */
  art: { px: Pixels; ax: number; ay: number };
  /** The drawing is its partner facing's, mirrored. */
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
    if (!rec && e.facings[MIRROR[f]]) {
      rec = e.facings[MIRROR[f]];
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

/** A seat's profile as the game reads it (art.ts: its own, else a sibling's, over its family's defaults). */
export function profileOf(M: Sprites, key: string): SeatProfile {
  const sprite = key.split('.')[0];
  const own = M[key];
  const sibling = own?.seat === undefined ? Object.entries(M).find(([k, e]) => (k === sprite || k.startsWith(`${sprite}.`)) && e.seat !== undefined)?.[1] : undefined;
  const e = own?.seat !== undefined ? own : (sibling ?? own);
  return seatProfile(sprite, { seat: e?.seat, sitStyle: e?.sitStyle, backrest: e?.backrest, arms: e?.arms, seatKind: e?.seatKind });
}
