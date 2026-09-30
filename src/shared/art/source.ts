/**
 * The art catalog as data any side can read: the manifest (THE MODEL SPEC, src/shared/models.ts) and each
 * drawing's pixels. The client reads them from the images it has loaded (sprites/art.ts), the server and the
 * scripts from the PNGs on disk, and every rule that needs to know what a drawing looks like — which wall piece a
 * tall plant hides (src/shared/world/wallPieces.ts) — runs on this, so all sides agree to the pixel.
 */
import type { Facing, SceneObject } from '../world/scene';
import { MIRROR_OF, type Manifest, type ModelSpec } from '../models';
import { centredAnchor, silhouette, type Pixels } from './footing';

export interface ArtSource {
  /** The catalog, or null before it has loaded. */
  manifest(): Manifest | null;
  /** A drawing's pixels (RGBA), or null if it isn't there. */
  pixels(file: string): Pixels | null;
}

/** The catalog entry a scene object is drawn from (a variant without art of its own is drawn as its family). */
export function artEntry(m: Manifest | null, o: { sprite: string; variant?: string }): { key: string; spec: ModelSpec } | null {
  if (!m) return null;
  if (o.variant && m.sprites[`${o.sprite}.${o.variant}`]) return { key: `${o.sprite}.${o.variant}`, spec: m.sprites[`${o.sprite}.${o.variant}`] };
  return m.sprites[o.sprite] ? { key: o.sprite, spec: m.sprites[o.sprite] } : null;
}

const mirrored = (p: Pixels): Pixels => {
  const d = new Uint8Array(p.d.length);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) d.set(p.d.subarray((y * p.w + x) * 4, (y * p.w + x) * 4 + 4), (y * p.w + (p.w - 1 - x)) * 4);
  return { w: p.w, h: p.h, d };
};

/**
 * The drawing the game stands on a floor object's footprint, resolved exactly as the client draws it (art.ts
 * artSprite): the facing's drawing or its partner's mirrored, a long single drawing mirrored when turned, small
 * pieces centred on their footprint, otherwise the drawing's anchor (the footprint's back vertex). Null for wall
 * art and anything without art.
 */
export function placedDrawing(art: ArtSource, o: SceneObject): { img: Pixels; ax: number; ay: number; scale: number } | null {
  const m = art.manifest();
  const e = artEntry(m, o)?.spec;
  if (!m || !e || e.wall) return null;
  const facing: Facing = o.facing ?? 'se';
  let rec: { file: string; anchor?: [number, number] } | undefined = e.file ? { file: e.file, anchor: e.anchor } : undefined;
  let mirror = !!e.file && e.footprint[0] !== e.footprint[1] && (o.w ?? 1) === e.footprint[1] && (o.d ?? 1) === e.footprint[0];
  if (e.facings) {
    rec = e.facings[facing];
    if (!rec && e.facings[MIRROR_OF[facing]]) {
      rec = e.facings[MIRROR_OF[facing]];
      mirror = true;
    }
    rec ??= Object.values(e.facings)[0];
  }
  const src = rec ? art.pixels(rec.file) : null;
  if (!rec || !src) return null;
  const img = mirror ? mirrored(src) : src;
  const S = m.scale;
  const w = o.w ?? 1;
  const d = o.d ?? 1;
  const centred = centredAnchor(img, w, d, S);
  let ax: number;
  let ay: number;
  if (centred) [ax, ay] = centred;
  else if (rec.anchor) {
    [ax, ay] = rec.anchor;
    if (mirror) ax = img.w - ax;
  } else {
    const bottom = img.h - (e.pad ?? 0);
    ax = e.fit === 'stand' ? img.w / 2 - (w - d) * 8 * S : d * 16 * S;
    ay = e.fit === 'stand' ? bottom - (w + d) * 4 * S : bottom - (w + d) * 8 * S;
  }
  return { img, ax, ay, scale: S };
}

type Bounds = { l: number; r: number; t: number; b: number };
const bounds = new WeakMap<Pixels, Bounds | null>();

/** A wall drawing's size and opaque bounds (drawing px), or null if it isn't there. */
export function wallDrawingSize(art: ArtSource, o: { sprite: string; variant?: string }): { w: number; h: number; bbox: Bounds | null; spec: ModelSpec } | null {
  const e = artEntry(art.manifest(), o)?.spec;
  if (!e?.wall || !e.file) return null;
  const p = art.pixels(e.file);
  if (!p) return null;
  if (!bounds.has(p)) bounds.set(p, silhouette(p));
  return { w: p.w, h: p.h, bbox: bounds.get(p)!, spec: e };
}
