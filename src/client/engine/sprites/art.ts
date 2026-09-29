/**
 * Image-backed sprites: the finished art from `art/studio.py` (public/art/manifest.json +
 * public/art/sprites/*.png), drawn at 2× density (64 px per floor tile). Anything without art falls
 * back to the procedural painter, so art can land one object at a time.
 */
import type { Facing, SceneObject } from '@shared/world/scene';
import { makeCanvas, type Sprite } from './painter';
import { centredAnchor } from './footing';

interface ArtFile {
  file: string;
  /** Image pixel of the footprint's back corner (tile x0,y0 at floor level). */
  anchor?: [number, number];
}

interface ArtEntry {
  file?: string;
  anchor?: [number, number];
  /** Per-facing art; a missing facing is the mirror of its partner (se↔sw, ne↔nw). */
  facings?: Partial<Record<Facing, ArtFile>>;
  footprint: [number, number];
  /** anchor: exact anchors from the construction guide (the default for generated art).
   *  diamond: art fills the footprint (left edge = left corner, bottom = front corner).
   *  stand: the art's bottom-centre stands on the footprint's centre. */
  fit?: 'anchor' | 'diamond' | 'stand';
  pad?: number;
  /** Wall-mounted flat art: painted into the wall texture between v0..v1 art px above the floor. */
  wall?: { v: [number, number]; margin?: number };
  /** A light source in the sprite (image px): lamps glow here. */
  light?: { x: number; y: number; r?: number };
  /** Seat surface height above the floor, in art px (chairs, sofas, stools). */
  seat?: number;
  /** A mask of what lights up at night (lit windows, lanterns, bulbs), same size and anchor as the drawing. */
  glow?: string;
  /** Points in the drawing (image px) that give off something: chimney smoke, fountain spray, beacons. */
  emitters?: Array<{ kind: 'smoke' | 'spray' | 'blink' | 'beam'; x: number; y: number }>;
}

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
      for (const f of Object.values(e.facings ?? {})) if (f) files.add(f.file);
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
  } catch {
    manifest = null;
  }
}

function entryFor(o: SceneObject): ArtEntry | null {
  if (!manifest) return null;
  return (o.variant ? manifest.sprites[`${o.sprite}.${o.variant}`] : undefined) ?? manifest.sprites[o.sprite] ?? null;
}

/** Flat wall art for a wall-mounted object, if it has been drawn. */
/** Every piece of finished art: key → footprint, the facings it was drawn in, and whether it hangs on a wall. */
export function artCatalog(): Array<{ key: string; footprint: [number, number]; facings: Facing[]; wall: boolean }> {
  if (!manifest) return [];
  return Object.entries(manifest.sprites).map(([key, e]) => ({
    key,
    footprint: e.footprint,
    facings: Object.keys(e.facings ?? {}) as Facing[],
    wall: !!e.wall,
  }));
}

export function wallArt(o: SceneObject): { img: HTMLImageElement; v: [number, number]; margin?: number } | null {
  const e = entryFor(o);
  if (!e?.wall || !e.file) return null;
  const img = images.get(e.file);
  return img ? { img, v: e.wall.v, margin: e.wall.margin } : null;
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
  const e = entryFor(o);
  if (!e?.light || !manifest) return null;
  const s = artSprite(o);
  if (!s) return null;
  const S = manifest.scale;
  const [primary] = e.file ? [{ file: e.file, anchor: e.anchor }] : Object.values(e.facings ?? {});
  const img = primary ? images.get(primary.file) : undefined;
  if (!img) return null;
  // The light is authored on the primary drawing; mirrored rotations reflect it.
  const lx = s.mirrored ? img.width - e.light.x : e.light.x;
  return { dx: (lx - s.ax) / S, dy: (e.light.y - s.ay) / S, r: (e.light.r ?? 40) / S };
}

/** The finished art for a scene object, or null to fall back to procedural drawing. */
export function artSprite(o: SceneObject): Sprite | null {
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
  // the night-glow mask and emitters follow the drawing (mirrored with it)
  const glowImg = e.glow ? images.get(e.glow) : undefined;
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
  const emitters = e.emitters?.map((m) => ({ kind: m.kind, x: mirror ? img.width - m.x : m.x, y: m.y }));
  return { canvas, ax, ay, mask, scale: S, mirrored: mirror, file: rec.file, glow, emitters };
}
