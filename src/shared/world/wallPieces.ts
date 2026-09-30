/**
 * What hangs on a room's two back walls, where exactly, and what hides it — one set of rules for the layout
 * check (scripts/room-map.ts), decorate-mode placement on the client and the server's check of the same, so all
 * three agree to the pixel.
 *
 * A wall piece covers a box on its wall: u along the wall (tiles; the right wall runs along x, the left along y)
 * and v up it (wall units, art px above the floor). Wall art's box comes from its drawing, by THE WALL ART
 * STANDARD (models.ts wallFit); windows, doors and procedural pieces have fixed bands.
 *
 * OCCLUSION. A standing thing (floor furniture, resolved to the drawing the client draws; a procedural piece's
 * box; a staffer at a work spot) hides a wall piece when, over a real stretch of the piece's width, its silhouette
 * rises more than a few px above the piece's lower edge on screen. A pole beside a frame doesn't count; a shade
 * in front of it does.
 */
import { WALL_PX_PER_TILE, wallFit, type Manifest } from '../models';
import type { ArtSource } from '../art/source';
import { placedDrawing, wallDrawingSize } from '../art/source';
import { MEMORY_SLOTS, type MemorySlot } from './memory';
import { footprint, type SceneDef, type SceneObject } from './scene';

export type WallFace = 'left' | 'right';

export interface WallBox {
  name: string;
  face: WallFace;
  /** Along the wall, tiles. */
  u0: number;
  u1: number;
  /** Up the wall, wall units above the floor. */
  v0: number;
  v1: number;
  obj?: SceneObject;
}

/** Height bands (wall units) of wall pieces drawn in code (ground.ts drawWallItem, interior.ts drawWindow/drawDoor). */
export const PROC_BAND: Record<string, [number, number]> = {
  window: [13, 50],
  door: [0, 46],
  plaque: [24, 40],
  frame: [24, 41],
  'menu-board': [22, 44],
  'logo-wall': [20, 46],
  elevator: [0, 46],
  bulletin: [20, 44],
  whiteboard: [16, 46],
  kanban: [16, 46],
  screen: [20, 42],
  pennant: [30, 46],
  banner: [36, 52],
  neon: [26, 44],
  moodboard: [18, 46],
  swatches: [20, 44],
  'sign-quiet': [28, 38],
};

/** Wall furniture meant to stand behind someone working (the shelving behind a bar), not signage. */
export const BEHIND_STAFF: ReadonlySet<string> = new Set(['backbar']);

/** Which wall a wall object hangs on, where its span starts along it and how many tiles it spans. */
export function wallSpan(o: SceneObject): { face: WallFace; at: number; span: number } | null {
  if (!o.wall) return null;
  return { face: o.wall, at: o.wall === 'right' ? o.x : o.y, span: o.wall === 'right' ? (o.w ?? 1) : (o.d ?? o.w ?? 1) };
}

/** The box a wall object covers on its wall. */
export function wallBox(o: SceneObject, art: ArtSource): WallBox | null {
  const s = wallSpan(o);
  if (!s) return null;
  const { face, at, span } = s;
  const name = `${o.sprite}${o.variant ? '.' + o.variant : ''}`;
  const drawing = o.sprite === 'window' || o.sprite === 'door' ? null : wallDrawingSize(art, o);
  if (drawing) {
    // what shows of it: its opaque pixels, where the standard hangs its drawing
    const { vis } = wallFit(drawing.spec.wall!, drawing, span, drawing.bbox);
    // the left wall's pieces are drawn mirrored about their span (so they read the right way round: interior.ts)
    const a = vis.l / WALL_PX_PER_TILE;
    const b = vis.r / WALL_PX_PER_TILE;
    const [u0, u1] = face === 'right' ? [at + a, at + b] : [at + span - b, at + span - a];
    return { name, face, u0, u1, v0: vis.v0, v1: vis.v1, obj: o };
  }
  const band = PROC_BAND[o.sprite] ?? [20, 44];
  const m = o.sprite === 'window' ? 0.16 : 0.1;
  return { name, face, u0: at + m, u1: at + span - m, v0: band[0], v1: band[1], obj: o };
}

/** Where a memory-wall artifact will hang (the procedural frame's band). */
export function slotBox(slot: MemorySlot): WallBox {
  return { name: `memory slot ${slot.wall}:${slot.at}`, face: slot.wall, u0: slot.at + 0.14, u1: slot.at + 0.86, v0: PROC_BAND.frame[0], v1: PROC_BAND.frame[1] };
}

/* ------------------------------------------------------------------ what stands in front */

/** A standing thing as the camera sees it: for each screen column (world px), the highest point it reaches. */
export type Silhouette = Map<number, number>;

/** Procedural pieces (no art yet): the footprint's diamond raised to a typical height. */
const PROC_HEIGHT: Record<string, number> = { counter: 21, stage: 0, rug: 0, chair: 30, desk: 30, bookshelf: 52 };

function boxSilhouette(o: SceneObject, height: number): Silhouette {
  const f = footprint(o);
  const out: Silhouette = new Map();
  const l = (f.x0 - f.y1) * 16;
  const r = (f.x1 - f.y0) * 16;
  const top = (f.x0 + f.y0) * 8 - (o.z ?? 0) - height;
  for (let sx = Math.ceil(l) + 2; sx < r - 2; sx++) out.set(sx, top);
  return out;
}

/** A person on a tile (feet at the tile centre): about 42 world px tall standing, 36 seated; 22 wide. */
export function personSilhouette(x: number, y: number, seated = false): Silhouette {
  const cx = (x - y) * 16;
  const top = (x + y + 1) * 8 - (seated ? 36 : 42);
  const out: Silhouette = new Map();
  for (let sx = cx - 10; sx <= cx + 10; sx++) out.set(sx, top);
  return out;
}

const silCache = new WeakMap<Manifest, Map<string, Silhouette>>();

/** A floor object's silhouette: its drawing as the client places it, read per pixel column, else its box. */
export function silhouetteOf(o: SceneObject, art: ArtSource): Silhouette {
  const m = art.manifest();
  const key = `${o.sprite}|${o.variant ?? ''}|${o.facing ?? ''}|${o.w ?? 1}|${o.d ?? 1}|${o.x}|${o.y}|${o.z ?? 0}`;
  let cache = m ? silCache.get(m) : undefined;
  if (m && !cache) silCache.set(m, (cache = new Map()));
  const hit = cache?.get(key);
  if (hit) return hit;
  const p = placedDrawing(art, o);
  let out: Silhouette;
  if (!p) out = boxSilhouette(o, PROC_HEIGHT[o.sprite] ?? 30);
  else {
    // the footprint's back vertex at floor level, on screen (world px)
    const bx = (o.x - o.y) * 16;
    const by = (o.x + o.y) * 8 - (o.z ?? 0);
    out = new Map();
    const { img, ax, ay, scale: S } = p;
    for (let x = 0; x < img.w; x++)
      for (let y = 0; y < img.h; y++)
        if (img.d[(y * img.w + x) * 4 + 3] > 0) {
          const sx = Math.floor(bx + (x - ax) / S);
          const sy = by + (y - ay) / S;
          out.set(sx, Math.min(out.get(sx) ?? Infinity, sy));
          break;
        }
  }
  cache?.set(key, out);
  return out;
}

/** Everything standing in a room that could hide a wall: floor objects and the staff at their work spots. */
export function standing(s: SceneDef, art: ArtSource): Array<{ what: string; sil: Silhouette; obj?: SceneObject }> {
  const out: Array<{ what: string; sil: Silhouette; obj?: SceneObject }> = [];
  for (const o of s.objects) {
    if (o.wall || o.flat) continue;
    out.push({ what: `${o.id} (${o.sprite}${o.variant ? '.' + o.variant : ''} at ${o.x},${o.y})`, sil: silhouetteOf(o, art), obj: o });
  }
  for (const n of s.npcs ?? []) for (const sp of n.spots) out.push({ what: `NPC ${n.name} at ${sp.x},${sp.y}`, sil: personSilhouette(sp.x, sp.y, !!sp.sit) });
  return out;
}

/** How much a silhouette hides a wall piece: the covered width (world px) and the highest rise over its edge. */
export function occlusion(sil: Silhouette, w: WallBox): { width: number; rise: number } {
  const [lo, hi] = w.face === 'right' ? [w.u0 * 16, w.u1 * 16] : [-w.u1 * 16, -w.u0 * 16];
  let width = 0;
  let rise = 0;
  for (const [sx, top] of sil) {
    if (sx < lo || sx >= hi) continue;
    const bottom = (w.face === 'right' ? sx / 2 : -sx / 2) - w.v0; // the wall piece's lower edge on screen
    const r = bottom - top;
    if (r > 2) {
      width++;
      rise = Math.max(rise, r);
    }
  }
  return { width, rise };
}

/** Whether a silhouette really hides a wall piece: a sliver at the edge of a frame is fine, a chunk of it is not. */
export function hides(sil: Silhouette, w: WallBox): { width: number; rise: number } | null {
  const o = occlusion(sil, w);
  return o.width >= Math.min(6, (w.u1 - w.u0) * 16 * 0.25) && o.rise > 3 ? o : null;
}

/** The wall pieces a room shows (signage and art: not the shelving behind a bar). */
export function wallBoxes(s: SceneDef, art: ArtSource): WallBox[] {
  return s.objects
    .filter((o) => o.wall && !BEHIND_STAFF.has(o.sprite))
    .map((o) => wallBox(o, art))
    .filter((w): w is WallBox => !!w);
}

/** Every wall piece (and empty memory-wall slot) something standing hides, as sentences (scripts/room-map.ts). */
export function wallOcclusions(s: SceneDef, art: ArtSource): string[] {
  const walls = wallBoxes(s, art);
  for (const slot of MEMORY_SLOTS[s.id] ?? []) walls.push(slotBox(slot));
  const tall = standing(s, art);
  const out: string[] = [];
  for (const w of walls)
    for (const t of tall) {
      const h = hides(t.sil, w);
      if (h) out.push(`${s.id}: ${t.what} hides ${w.name} on the ${w.face} wall (${h.width}px wide, rises ${Math.round(h.rise)}px over its bottom edge)`);
    }
  return out;
}

/** Placed wall art whose drawing doesn't fit the span it was given (a squeeze): the wall art standard. */
export function wallFitProblems(s: SceneDef, art: ArtSource): string[] {
  const out: string[] = [];
  for (const o of s.objects) {
    const sp = wallSpan(o);
    if (!sp || o.sprite === 'window' || o.sprite === 'door') continue;
    const d = wallDrawingSize(art, o);
    if (!d) continue;
    for (const p of wallFit(d.spec.wall!, d, sp.span, d.bbox).problems) out.push(`${s.id}: ${o.id} (${o.sprite}${o.variant ? '.' + o.variant : ''} on the ${sp.face} wall at ${sp.at}, span ${sp.span}): ${p}`);
  }
  return out;
}
