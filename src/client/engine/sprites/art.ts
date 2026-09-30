/**
 * Image-backed sprites: the finished art from `art/studio.py` (public/art/manifest.json +
 * public/art/sprites/*.png), drawn at 2× density (64 px per floor tile). Anything without art falls
 * back to the procedural painter, so art can land one object at a time.
 */
import type { Facing, SceneObject } from '@shared/world/scene';
import { makeCanvas, type Sprite } from './painter';
import { centredAnchor } from './footing';
import { seatProfile, type SeatProfile } from '@shared/world/seats';
import type { SeatModel } from '@shared/world/seatModels';
import { isCatalogSeat, seatArtOf, seatBuildOf } from '@shared/art/seatCatalog';
import type { Drawing, ModelSpec, Rotation } from '@shared/models';
import { WALL_PX_PER_TILE, wallFit, type Manifest as WallManifest } from '@shared/models';
import { registerWallArt } from '@shared/world/decor';
import type { Pixels } from '@shared/art/footing';
import type { ArtSource } from '@shared/art/source';

/** A drawing of a model and a manifest entry: THE MODEL SPEC (src/shared/models.ts). */
type ArtFile = Drawing;
type ArtEntry = ModelSpec;
export type { Rotation };

interface Manifest {
  scale: number;
  sprites: Record<string, ArtEntry>;
}

const MIRROR: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };

let manifest: Manifest | null = null;
const images = new Map<string, HTMLImageElement>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Fetch the manifest and every image once, before the first scene is built. Never throws. */
export async function loadArt(base = ''): Promise<void> {
  try {
    const res = await fetch(`${base}/art/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    const m = (await res.json()) as Manifest;
    const files = new Set<string>();
    for (const e of Object.values(m.sprites)) {
      if (e.file) files.add(e.file);
      if (e.glow) files.add(e.glow);
      for (const f of Object.values(e.facings ?? {})) {
        if (f) files.add(f.file);
        if (f?.glow) files.add(f.glow);
      }
    }
    const bust = `?v=${Date.now().toString(36)}`;
    await Promise.all(
      [...files].map(async (f) => {
        const img = await loadImage(`${base}/art/sprites/${f}${import.meta.env.DEV ? bust : ''}`);
        if (img) images.set(f, img);
      }),
    );
    manifest = m;
    lightCache.clear();
    seatProfiles.clear();
    pixelCache.clear();
    // the Wall category follows the catalog (decor.ts): a piece just published from the Design Lab is in it
    registerWallArt(m as WallManifest);
  } catch {
    manifest = null;
  }
}

function entryFor(o: SceneObject): ArtEntry | null {
  if (!manifest) return null;
  return (o.variant ? manifest.sprites[`${o.sprite}.${o.variant}`] : undefined) ?? manifest.sprites[o.sprite] ?? null;
}

/** The catalog key an object's art comes from (a variant without art of its own is drawn as its family). */
function keyFor(o: SceneObject): string | null {
  if (!manifest) return null;
  if (o.variant && manifest.sprites[`${o.sprite}.${o.variant}`]) return `${o.sprite}.${o.variant}`;
  return manifest.sprites[o.sprite] ? o.sprite : null;
}

/**
 * The game draws seats Habbo's way, in layers — the seat behind its sitters and what of it stands between them and us
 * over them — from the seat's own model (src/shared/world/seatSpec.ts): every catalog seat is built and drawn from
 * its spec (src/shared/art/seatCatalog.ts), so its pixels and its depth are one thing (sprites/seatLayers.ts).
 */

/** The seat's model (the framework's build of it), or null for anything that isn't a catalog seat. */
export function artSeatModel(o: SceneObject): SeatModel | null {
  const key = keyFor(o) ?? (o.variant ? `${o.sprite}.${o.variant}` : o.sprite);
  return seatBuildOf(key)?.model ?? null;
}

/** The catalog key a seat is built from, or null. */
export function artSeatKey(o: SceneObject): string | null {
  const key = keyFor(o) ?? (o.variant ? `${o.sprite}.${o.variant}` : o.sprite);
  return isCatalogSeat(key) ? key : null;
}

const seatSprites = new Map<string, Sprite>();

/** A catalog seat's sprite in a facing: its render painted into a canvas (once per key and facing). */
function seatSpriteFor(key: string, facing: Facing): Sprite | null {
  const k = `${key}|${facing}`;
  const had = seatSprites.get(k);
  if (had) return had;
  const art = seatArtOf(key, facing);
  if (!art) return null;
  const { w, h } = art.px;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  img.data.set(art.px.d);
  ctx.putImageData(img, 0, 0);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = art.px.d[i * 4 + 3] > 0 ? 1 : 0;
  const sp: Sprite = { canvas, ax: art.ax, ay: art.ay, mask, scale: 2, file: `${key}.${facing}.png` };
  seatSprites.set(k, sp);
  return sp;
}

/** Flat wall art for a wall-mounted object, if it has been drawn. */
/** Every piece of finished art: key → footprint, the facings it was drawn in, and whether it hangs on a wall. */
export function artCatalog(): Array<{ key: string; footprint: [number, number]; facings: Facing[]; wall: boolean; rotation?: Rotation }> {
  if (!manifest) return [];
  return Object.entries(manifest.sprites).map(([key, e]) => ({
    key,
    footprint: e.footprint,
    facings: Object.keys(e.facings ?? {}) as Facing[],
    wall: !!e.wall,
    rotation: e.rotation,
  }));
}

/**
 * Flat wall art for a wall-mounted object, if it has been drawn, hung by THE WALL ART STANDARD (models.ts
 * wallFit): at exactly 2:1 (32 drawing px per tile along the wall, 2 per wall unit up it, the wall texture's own
 * density, so it's painted pixel for pixel and never squeezed), centred in its span. `margin`: tiles from the
 * span's start to the drawing's left edge (a whole drawing px); `width`: the drawing's width in tiles; `v`: its
 * bottom and top, wall units above the floor.
 */
export function wallArt(o: SceneObject): { img: HTMLImageElement; v: [number, number]; margin: number; width: number } | null {
  const e = entryFor(o);
  if (!e?.wall || !e.file) return null;
  const img = images.get(e.file);
  if (!img) return null;
  const span = o.wall === 'left' ? (o.d ?? o.w ?? 1) : (o.w ?? 1);
  const fit = wallFit(e.wall, { w: img.width, h: img.height }, span);
  return { img, v: [fit.v0, fit.v1], margin: fit.left / WALL_PX_PER_TILE, width: img.width / WALL_PX_PER_TILE };
}

/**
 * The client's art as an ArtSource (src/shared/art/source.ts): the manifest and the loaded images' pixels, for the
 * rules decorate mode shares with the server (what a tall plant hides on the wall).
 */
const pixelCache = new Map<string, Pixels | null>();
export const clientArt: ArtSource = {
  manifest: () => manifest as WallManifest | null,
  pixels(file: string) {
    if (pixelCache.has(file)) return pixelCache.get(file)!;
    const img = images.get(file);
    let px: Pixels | null = null;
    if (img) {
      const c = makeCanvas(img.width, img.height);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      px = { w: img.width, h: img.height, d: ctx.getImageData(0, 0, img.width, img.height).data };
    }
    pixelCache.set(file, px);
    return px;
  },
};

/**
 * A standing piece's height and layer as its model declares them (world px from its base to its top), for the depth
 * by proxy prototype (docs/furniture.md): null for anything without finished art, a rug or wall art.
 */
export function artBody(o: SceneObject): { height: number; layer: string } | null {
  const e = entryFor(o);
  if (!e || !Number.isFinite(e.height) || e.layer === 'floor' || e.layer === 'wall' || e.wall) return null;
  return { height: e.height, layer: e.layer };
}

/**
 * How high this seat's surface is, in art px, if its art says so. A variant drawn without a seat height
 * borrows its sibling's (a blue couch sits like the green one).
 */
export function artSeat(o: SceneObject): number | null {
  const own = entryFor(o)?.seat;
  if (own !== undefined) return own;
  if (!entryFor(o) || !manifest) return null;
  const sibling = Object.entries(manifest.sprites).find(([k, e]) => (k === o.sprite || k.startsWith(`${o.sprite}.`)) && e.seat !== undefined);
  return sibling?.[1].seat ?? null;
}

/**
 * How a seat is sat in (the seat standard): its art's profile over its family's defaults. A variant drawn
 * without its own profile borrows its sibling's (a blue couch sits like the green one).
 */
const seatProfiles = new Map<string, SeatProfile>();
export function artSeatProfile(o: SceneObject): SeatProfile {
  const key = `${o.sprite}.${o.variant ?? ''}`;
  let p = seatProfiles.get(key);
  if (!p) seatProfiles.set(key, (p = seatProfileOf(o)));
  return p;
}

function seatProfileOf(o: SceneObject): SeatProfile {
  const own = entryFor(o);
  const sibling =
    own?.seat === undefined && manifest
      ? Object.entries(manifest.sprites).find(([k, e]) => (k === o.sprite || k.startsWith(`${o.sprite}.`)) && e.seat !== undefined)?.[1]
      : undefined;
  const e = own?.seat !== undefined ? own : (sibling ?? own);
  return seatProfile(o.sprite, { seat: e?.seat, sitStyle: e?.sitStyle, backrest: e?.backrest, arms: e?.arms });
}

/** Where a lamp's light comes from, relative to the sprite's anchor, in art px (follows mirroring). */
const lightCache = new Map<string, { dx: number; dy: number; r: number } | null>();

export function artLight(o: SceneObject): { dx: number; dy: number; r: number } | null {
  const key = `${o.sprite}|${o.variant ?? ''}|${o.facing ?? ''}|${o.w ?? 1}|${o.d ?? 1}`;
  if (lightCache.has(key)) return lightCache.get(key)!;
  const r = computeLight(o);
  lightCache.set(key, r);
  return r;
}

function computeLight(o: SceneObject): { dx: number; dy: number; r: number } | null {
  if (!manifest) return null;
  const s = artSprite(o);
  if (!s?.light) return null;
  const S = manifest.scale;
  return { dx: (s.light.x - s.ax) / S, dy: (s.light.y - s.ay) / S, r: s.light.r / S };
}

/** The finished art for a scene object, or null to fall back to procedural drawing. */
export function artSprite(o: SceneObject): Sprite | null {
  // a seat is drawn from its spec, not from a file (the PNGs in the catalog are the same render, for the server)
  const seatKey = artSeatKey(o);
  if (seatKey) return seatSpriteFor(seatKey, o.facing ?? 'se');
  const e = entryFor(o);
  if (!e || !manifest) return null;
  const facing = o.facing ?? 'se';
  let rec: ArtFile | undefined = e.file ? { file: e.file, anchor: e.anchor } : undefined;
  // A single drawing of a non-square piece (a 2×1 table) turned 90° is its mirror image.
  let mirror = !!e.file && e.footprint[0] !== e.footprint[1] && (o.w ?? 1) === e.footprint[1] && (o.d ?? 1) === e.footprint[0];
  if (e.facings) {
    rec = e.facings[facing];
    if (!rec && e.facings[MIRROR[facing]]) {
      rec = e.facings[MIRROR[facing]];
      mirror = true;
    }
    rec ??= Object.values(e.facings)[0];
  }
  const img = rec ? images.get(rec.file) : undefined;
  if (!rec || !img) return null;
  const S = manifest.scale;
  const canvas = makeCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  if (mirror) {
    ctx.translate(img.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  let ax: number;
  let ay: number;
  // The furniture standard: a small piece (an espresso machine, a lamp, an ornament) stands with its base
  // centred on its footprint, whatever the drawing's own anchor says. Large pieces fill their footprint and
  // keep the anchor their construction guide gave them.
  const centred = e.wall ? null : centredAnchor({ w: img.width, h: img.height, d: data }, o.w ?? 1, o.d ?? 1, S);
  if (centred) {
    [ax, ay] = centred;
  } else if (rec.anchor) {
    [ax, ay] = rec.anchor;
    // Mirroring swaps the footprint's axes; its back corner stays the top vertex, reflected.
    if (mirror) ax = img.width - ax;
  } else {
    const w = o.w ?? 1;
    const d = o.d ?? 1;
    const bottom = img.height - (e.pad ?? 0);
    ax = e.fit === 'stand' ? img.width / 2 - (w - d) * 8 * S : d * 16 * S;
    ay = e.fit === 'stand' ? bottom - (w + d) * 4 * S : bottom - (w + d) * 8 * S;
  }
  // the lamp, night-glow mask and emitters follow the drawing (mirrored with it): the drawing's own if it has
  // them, else the entry's (authored on its first drawing, so only valid for that drawing and its mirror)
  const first = e.file ? e.file : Object.values(e.facings ?? {})[0]?.file;
  const ownOrFirst = <T,>(own: T | undefined, shared: T | undefined): T | undefined => own ?? (rec.file === first ? shared : undefined);
  const lightAt = ownOrFirst(rec.light, e.light);
  const light = lightAt ? { x: mirror ? img.width - lightAt.x : lightAt.x, y: lightAt.y, r: lightAt.r ?? 40 } : undefined;
  const glowFile = ownOrFirst(rec.glow, e.glow);
  const glowImg = glowFile ? images.get(glowFile) : undefined;
  let glow: HTMLCanvasElement | undefined;
  if (glowImg) {
    glow = makeCanvas(img.width, img.height);
    const g = glow.getContext('2d')!;
    if (mirror) {
      g.translate(img.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(glowImg, 0, 0);
  }
  const emitters = ownOrFirst(rec.emitters, e.emitters)?.map((m) => ({ kind: m.kind, x: mirror ? img.width - m.x : m.x, y: m.y }));
  return { canvas, ax, ay, mask, scale: S, mirrored: mirror, file: rec.file, glow, emitters, light };
}
