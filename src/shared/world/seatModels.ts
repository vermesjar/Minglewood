/**
 * THE SEAT MODEL: every seat's 3D shape as a few boxes (a proxy), one per catalog seat key, shared by all four
 * facings: it says where each cushion is, what of the seat stands between a sitter and the camera in each view (the
 * seat layers: src/client/engine/sprites/seatLayers.ts) and how a sitter's legs lie on it (sitLegs.ts).
 *
 * art/seat-models.json: { [catalog key]: SeatModel }.
 *
 * THE LOCAL FRAME. u runs across the seat (0 … W tiles, W = the footprint's width), v is the depth from the seat's
 * FRONT edge (0) to its back (D tiles, the footprint's depth), z is up in world px (1 world px = 2 drawing px of
 * rise). Each part is an axis-aligned box [u0, u1] × [v0, v1] × [z0, z1]:
 *   seat  a cushion block: its top (z1) is the cushion a sitter rests on
 *   back  the backrest (a seat without one has none)
 *   arm   an armrest
 *   leg   a leg, a post
 *   base  the frame or skirt under the cushion
 *   wrap  what wraps round a sitter (a beanbag's rolled back)
 *   other anything else (a throne's crest)
 * `sits`: one sitting point per cushion, [u, v, z] — the middle of the underside of the sitter's pelvis, z the
 * cushion top under it — as the seat is seen from the FRONT. The figure's seat point (FIG seat row) is drawn exactly
 * where it projects. `backV`: per cushion, the pelvis's depth seen from BEHIND. The figure is small for its furniture, so
 * no one depth serves both views: from the front a sitter sits forward, knees at the front edge (the legs show); from
 * behind, deep under the backrest (it hides their hips; their head and shoulders show) — each view composed on its
 * own, as sprite games do (sitFor).
 *
 * LOCAL → WORLD. Placed facing f, the seat covers w × d tiles (placedSize) from its footprint's back vertex, its
 * front edge on the side it faces (FACING_VEC), u turning with it (a rotation, never a mirror):
 *   se (+x): x = w − v, y = u        sw (+y): x = w − u, y = d − v
 *   ne (−y): x = u,     y = v        nw (−x): x = v,     y = d − u
 * WORLD → DRAWING (projectLocal): (ax + 32 (x − y), ay + 16 (x + y) − 2 z), the drawing's anchor being
 * the footprint's back vertex on the floor.
 *
 * CAMERA DEPTH. The projection sends (x, y, z) and (x + t, y + t, z + 16 t) to the same pixel, so the view ray through
 * a drawing pixel (px, py) is, at height z:
 *     x − y = (px − ax) / 32,      x + y = (py − ay) / 16 + z / 8
 * and along it the camera is toward +x, +y and up: of two points on the same pixel, the higher is the nearer. So
 * the depth buffer stores, per pixel, the HEIGHT z AT WHICH ITS RAY MEETS THE SURFACE (world px): a seat pixel is
 * drawn over a person's pixel only where the seat's surface meets the ray higher (nearer) than the person's does.
 * Between pixels (ordering whole objects, docs/furniture.md), the orthographic depth of the 2:1 camera — 30°
 * above the floor, a tile 19.6 world px long — is nearness(x, y, z) = x + y + z / 24 (tiles).
 *
 * Pure: the renderer (WorldView), the model tools (scripts/seat-model.ts) and the Design Lab share it.
 */
import type { AvatarLoadout } from '../domain/types';
import type { Facing } from './scene';

/**
 * The people every seat is shown and checked with (sheets, checks, the live spec): short hair and a tee; long hair;
 * a bulky coat and a wide hat (the widest, tallest silhouette the wardrobe makes).
 */
export const SEAT_LOOKS: AvatarLoadout[] = [
  { hair: 'hair.short', hairColor: '#3b2518', top: 'top.tee', topColor: '#e0503f', bottom: 'bottom.jeans', bottomColor: '#1f2a44' } as AvatarLoadout,
  { hair: 'hair.long', hairColor: '#d9a35b', top: 'top.hoodie', topColor: '#2bb3a3', bottom: 'bottom.chinos', bottomColor: '#3a3a46', body: 'body.b' } as AvatarLoadout,
  {
    hair: 'hair.curly',
    hairColor: '#241812',
    top: 'top.puffer',
    topColor: '#7a5cc4',
    bottom: 'bottom.cargo',
    bottomColor: '#4a4a36',
    headwear: 'hat.cowboy',
    headwearColor: '#8a5a2b',
    skin: '#8d5a3b',
  } as AvatarLoadout,
];

export type PartKind = 'seat' | 'back' | 'arm' | 'leg' | 'base' | 'wrap' | 'other';
export const PART_KINDS: PartKind[] = ['seat', 'back', 'arm', 'leg', 'base', 'wrap', 'other'];

export type Span = [number, number];
export interface ModelPart {
  part: PartKind;
  u: Span;
  v: Span;
  z: Span;
}

export type SitPoint = [number, number, number];

export interface SeatModel {
  /** [W, D]: the footprint as the catalog gives it (width across the front, depth front to back), tiles. */
  size: [number, number];
  parts: ModelPart[];
  /** One per cushion: [u, v, z], seen from the front. */
  sits: SitPoint[];
  /**
   * Where a view draws its sitters, when the drawing needs them somewhere the standard wouldn't put them: per facing,
   * per cushion (seatSpots order), the pelvis's [u, v] (on the cushion's own height). Generated art isn't exact 3D:
   * each drawing is composed on its own, and this is what its eye says (default: sitFor's standard).
   */
  views?: Partial<Record<Facing, Array<[number, number]>>>;
  /**
   * What of a view's drawing goes over its sitters, when the model's parts can't say it exactly: per facing, polygons in
   * that facing's drawing px (as the game draws it, mirrored where it is) — traced by eye along the drawing's own edges.
   * Without it the model's parts decide (sprites/seatLayers.ts).
   */
  over?: Partial<Record<Facing, Array<Array<[number, number]>>>>;
  /** The day scripts/seat-model.ts --fit seeded it (a fit is never reviewed). */
  fitted?: string;
  /** The day the lead reviewer read its sheet and live screenshots and passed it (scripts/seat-model.ts --review). */
  reviewed?: string;
  /** Fingerprints (seatFigure.drawingPrint) of the drawings it was reviewed on, by facing: a redrawn seat needs review. */
  drawings?: Partial<Record<Facing, string>>;
  /** A word from whoever tuned it. */
  note?: string;
}

export type SeatModels = Record<string, SeatModel>;

export const MODEL_FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];
/** Seen from behind: the camera looks from the south, so a sitter facing ne or nw has their back to it. */
export const behindView = (f: Facing) => f === 'ne' || f === 'nw';

/** The tiles a seat covers placed facing `f`: x-extent w, y-extent d (se / nw turn the footprint). */
export function placedSize(size: readonly [number, number], f: Facing): { w: number; d: number } {
  const [W, D] = size;
  return f === 'se' || f === 'nw' ? { w: D, d: W } : { w: W, d: D };
}

/** Local (u, v) → world (x, y), tiles from the footprint's back vertex. */
export function localToWorld(size: readonly [number, number], f: Facing, u: number, v: number): { x: number; y: number } {
  const { w, d } = placedSize(size, f);
  switch (f) {
    case 'se':
      return { x: w - v, y: u };
    case 'sw':
      return { x: w - u, y: d - v };
    case 'ne':
      return { x: u, y: v };
    case 'nw':
      return { x: v, y: d - u };
  }
}

/** World (x, y) → local (u, v). */
export function worldToLocal(size: readonly [number, number], f: Facing, x: number, y: number): { u: number; v: number } {
  const { w, d } = placedSize(size, f);
  switch (f) {
    case 'se':
      return { u: y, v: w - x };
    case 'sw':
      return { u: w - x, v: d - y };
    case 'ne':
      return { u: x, v: y };
    case 'nw':
      return { u: d - y, v: x };
  }
}

/** A local point in the drawing's px (anchor: the footprint's back vertex on the floor). */
export function projectLocal(anchor: readonly [number, number], size: readonly [number, number], f: Facing, u: number, v: number, z: number): [number, number] {
  const { x, y } = localToWorld(size, f, u, v);
  return [anchor[0] + 32 * (x - y), anchor[1] + 16 * (x + y) - 2 * z];
}

/** The world point (tiles from the back vertex) drawn at (px, py) at height z. */
export function drawingAt(anchor: readonly [number, number], px: number, py: number, z: number): { x: number; y: number } {
  const a = (px - anchor[0]) / 32;
  const b = (py - anchor[1]) / 16 + z / 8;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** The orthographic camera depth of a world point (tiles; larger is nearer the camera). See the header. */
export const nearness = (x: number, y: number, z: number) => x + y + z / 24;

/**
 * A view ray in the local frame: at height z it passes (u0 + du z, v0 + dv z). du and dv are ±1/16: the camera is
 * toward +u when du > 0, toward the front (−v) when dv < 0 (seen from the front).
 */
export interface Ray {
  u0: number;
  v0: number;
  du: number;
  dv: number;
}

/** Which way the camera is in the local frame, per z px: seen from the front dv < 0, from behind dv > 0. */
export function viewDir(f: Facing): { du: number; dv: number } {
  switch (f) {
    case 'se':
      return { du: 1 / 16, dv: -1 / 16 };
    case 'sw':
      return { du: -1 / 16, dv: -1 / 16 };
    case 'ne':
      return { du: 1 / 16, dv: 1 / 16 };
    case 'nw':
      return { du: -1 / 16, dv: 1 / 16 };
  }
}

/** The view ray through a point of the drawing (px, py: a pixel's centre is (i + 0.5, j + 0.5)). */
export function rayThrough(anchor: readonly [number, number], size: readonly [number, number], f: Facing, px: number, py: number): Ray {
  const p = drawingAt(anchor, px, py, 0);
  const { u, v } = worldToLocal(size, f, p.x, p.y);
  return { u0: u, v0: v, ...viewDir(f) };
}

/** Which face of a box a ray meets it by, from the camera: its top, or the side facing the camera across (u) or in depth (v). */
export type Face = 'top' | 'u' | 'v';

/**
 * Where a ray passes through a box: the heights it's inside it over, [lo, hi]; hi is where it meets it from the
 * camera (the camera-facing surface), and `face` which face that is. Null when it misses.
 */
export function rayBox(r: Ray, b: Pick<ModelPart, 'u' | 'v' | 'z'>): { lo: number; hi: number; face: Face } | null {
  // u(z) in [u0, u1]
  const ua = (b.u[0] - r.u0) / r.du;
  const ub = (b.u[1] - r.u0) / r.du;
  const va = (b.v[0] - r.v0) / r.dv;
  const vb = (b.v[1] - r.v0) / r.dv;
  const uLo = Math.min(ua, ub);
  const uHi = Math.max(ua, ub);
  const vLo = Math.min(va, vb);
  const vHi = Math.max(va, vb);
  const lo = Math.max(uLo, vLo, b.z[0]);
  const hi = Math.min(uHi, vHi, b.z[1]);
  if (!(lo <= hi)) return null;
  const face: Face = hi === b.z[1] ? 'top' : hi === uHi ? 'u' : 'v';
  return { lo, hi, face };
}

/** The height at which a ray meets a face's plane, extended past the box (for a pixel no box covers). */
export function rayPlane(r: Ray, b: Pick<ModelPart, 'u' | 'v' | 'z'>, face: Face): number {
  if (face === 'top') return b.z[1];
  if (face === 'u') {
    // the camera-facing u side: u1 when the camera is toward +u
    const U = r.du > 0 ? b.u[1] : b.u[0];
    return (U - r.u0) / r.du;
  }
  const V = r.dv > 0 ? b.v[1] : b.v[0];
  return (V - r.v0) / r.dv;
}

/**
 * Where a ray meets a billboard: a vertical plane through the local point (qu, qv) square to the camera's
 * horizontal direction — how a flat figure stands in the world.
 */
export function rayBillboard(r: Ray, qu: number, qv: number): number {
  const su = Math.sign(r.du);
  const sv = Math.sign(r.dv);
  return -((r.u0 - qu) * su + (r.v0 - qv) * sv) / (Math.abs(r.du) + Math.abs(r.dv));
}

/** The horizontal unit step toward the camera in the local frame (tiles). */
export function towardCamera(f: Facing): { u: number; v: number } {
  const { du, dv } = viewDir(f);
  return { u: Math.sign(du) / Math.SQRT2, v: Math.sign(dv) / Math.SQRT2 };
}

/** A box's 8 corners projected into the drawing, and their convex hull (how the box is drawn). */
export function boxHull(anchor: readonly [number, number], size: readonly [number, number], f: Facing, b: Pick<ModelPart, 'u' | 'v' | 'z'>): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const u of b.u) for (const v of b.v) for (const z of b.z) pts.push(projectLocal(anchor, size, f, u, v, z));
  return hull(pts);
}

/** The projected edges of a box that aren't hidden behind the box itself (for the sheets' overlays). */
export function boxEdges(anchor: readonly [number, number], size: readonly [number, number], f: Facing, b: Pick<ModelPart, 'u' | 'v' | 'z'>): Array<{ a: [number, number]; b: [number, number]; hidden: boolean }> {
  const { du, dv } = viewDir(f);
  // the corner farthest from the camera: its three edges are hidden (the box is convex)
  const farU = du > 0 ? b.u[0] : b.u[1];
  const farV = dv > 0 ? b.v[0] : b.v[1];
  const farZ = b.z[0];
  const out: Array<{ a: [number, number]; b: [number, number]; hidden: boolean }> = [];
  const P = (u: number, v: number, z: number) => projectLocal(anchor, size, f, u, v, z);
  // the three edges that meet at the far corner run between two hidden faces (the bottom and the far sides)
  for (const v of b.v) for (const z of b.z) out.push({ a: P(b.u[0], v, z), b: P(b.u[1], v, z), hidden: v === farV && z === farZ });
  for (const u of b.u) for (const z of b.z) out.push({ a: P(u, b.v[0], z), b: P(u, b.v[1], z), hidden: u === farU && z === farZ });
  for (const u of b.u) for (const v of b.v) out.push({ a: P(u, v, b.z[0]), b: P(u, v, b.z[1]), hidden: u === farU && v === farV });
  return out;
}

export function hull(pts: Array<[number, number]>): Array<[number, number]> {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [];
  for (const q of s) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: Array<[number, number]> = [];
  for (const q of s.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** The cushion tiles of a seat placed facing `f`, in seatSpots order (y then x), tiles from the back vertex. */
export function cushionTiles(size: readonly [number, number], f: Facing): Array<{ x: number; y: number }> {
  const { w, d } = placedSize(size, f);
  const out: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) out.push({ x, y });
  return out;
}

/**
 * The sitting points in seatSpots order for a facing (cushion i sits at out[i]): each cushion takes the sitting
 * point over its tile. Null for a cushion no sitting point lies over (the check reports it).
 */
export function sitsByCushion(m: Pick<SeatModel, 'size' | 'sits'>, f: Facing): Array<SitPoint | null> {
  return cushionTiles(m.size, f).map((t) => {
    const hit = m.sits.find(([u, v]) => {
      const p = localToWorld(m.size, f, u, v);
      return p.x >= t.x && p.x < t.x + 1 && p.y >= t.y && p.y < t.y + 1;
    });
    return hit ?? null;
  });
}

/**
 * THE KINDS OF SEAT, read off the model — what decides how a sitter is composed seen from BEHIND, where a square-on
 * figure meets the seat's own drawing of its back (no per-seat numbers: a new seat from the Lab gets the same
 * treatment as the catalog's):
 *   long     the cushion runs LONG_CUSHION or more across (a couch, a bench): the sitter forward onto the cushion,
 *            at the middle of its depth, their thighs out along it
 *   padded   a thick back (PADDED_BACK deep or more): a tub chair, a wingback, a throne — the drawing's padding
 *            wraps the sitter, so the pelvis sits inside the back's box, at its middle, and the torso rises out of
 *            the padding (a tub's rim is low but thick: it still swallows the hips)
 *   open     everything else (a dining chair, an office chair, a beanbag): on the cushion just in front of the back's
 *            face (BACK_GAP), the back rail across the lower back
 *   backless a stool, an ottoman: a little behind the cushion's middle
 * (Fitted to what read right in game across the catalog, 2026-09-30: sunk into a thin back a sitter read as standing
 * in the chair; perched in front of a thick one, as sitting too far forward with the padding behind them.)
 */
export type SeatKind = 'long' | 'padded' | 'open' | 'backless';
export const LONG_CUSHION = 1.2;
export const PADDED_BACK = 0.25;
export const BACK_GAP = 0.04;

/** The back (or wrap) part behind a sitter at u on a cushion at z whose front face backFace found, if any. */
function backPart(m: Pick<SeatModel, 'parts'>, u: number, z: number): ModelPart | null {
  const face = backFace(m, u, z);
  if (face === null) return null;
  return m.parts.find((p) => (p.part === 'back' || p.part === 'wrap') && u >= p.u[0] - 0.02 && u <= p.u[1] + 0.02 && p.z[1] > z + 2 && p.v[0] === face) ?? null;
}

export function seatKind(m: Pick<SeatModel, 'parts'>, u: number, z: number): SeatKind {
  const blocks = m.parts.filter((p) => p.part === 'seat' && p.z[1] >= z - 0.5 && u >= p.u[0] - 0.05 && u <= p.u[1] + 0.05);
  if (blocks.length && Math.max(...blocks.map((p) => p.u[1])) - Math.min(...blocks.map((p) => p.u[0])) >= LONG_CUSHION) return 'long';
  const back = backPart(m, u, z);
  if (!back) return 'backless';
  return back.v[1] - back.v[0] >= PADDED_BACK ? 'padded' : 'open';
}

/** Where the standard puts a sitter's pelvis in depth seen from BEHIND, at u on a cushion at z, by the seat's kind. */
export function backSitV(m: Pick<SeatModel, 'parts'>, u: number, z: number): number | null {
  const s = seatSpan(m, u);
  if (!s) return null;
  const kind = seatKind(m, u, z);
  if (kind === 'padded') {
    const b = backPart(m, u, z)!;
    return (b.v[0] + b.v[1]) / 2;
  }
  if (kind === 'long') return (s.v0 + s.v1) / 2;
  const back = backFace(m, u, z);
  const v = kind === 'open' && back !== null ? back - BACK_GAP : (s.v0 + s.v1) / 2 + 0.1;
  return Math.min(v, s.v1 - 0.05);
}

/** The sitting point a facing draws a cushion's sitter with, by the standard: its own from the front, just in front of the backrest from behind. */
export function sitFor(m: Pick<SeatModel, 'parts'>, s: SitPoint, f: Facing): SitPoint {
  if (!behindView(f)) return s;
  return [s[0], backSitV(m, s[0], s[2]) ?? s[1], s[2]];
}

/**
 * The sitting points in seatSpots order for a facing, as that view draws them: the view's own (`views`), else the
 * standard's (sitFor); null for a cushion without one.
 */
export function viewSits(m: Pick<SeatModel, 'parts' | 'size' | 'sits' | 'views'>, f: Facing): Array<SitPoint | null> {
  const own = m.views?.[f];
  return sitsByCushion(m, f).map((s, c) => {
    if (!s) return null;
    const p = own?.[c];
    return p ? [p[0], p[1], s[2]] : sitFor(m, s, f);
  });
}

/** Where a sitting point lies in the world (tiles from the back vertex) and how high (world px). */
export function sitWorld(m: Pick<SeatModel, 'size'>, f: Facing, s: SitPoint): { x: number; y: number; z: number } {
  const p = localToWorld(m.size, f, s[0], s[1]);
  return { x: p.x, y: p.y, z: s[2] };
}

/** The cushion top under a local point: the highest seat block over it (null: none). */
export function cushionTop(m: Pick<SeatModel, 'parts'>, u: number, v: number): number | null {
  let top: number | null = null;
  for (const p of m.parts) if (p.part === 'seat' && u >= p.u[0] && u <= p.u[1] && v >= p.v[0] && v <= p.v[1]) top = Math.max(top ?? -Infinity, p.z[1]);
  return top;
}

/**
 * The usable depth of the cushion under a sitting point: from the front of the seat block under it to the front of
 * whatever stands behind it (the back, a wrap), or the block's own back when nothing does.
 */
export function seatDepthAt(m: Pick<SeatModel, 'parts'>, u: number, v: number, z: number): { v0: number; v1: number } | null {
  const blocks = m.parts.filter((p) => p.part === 'seat' && u >= p.u[0] && u <= p.u[1] && v >= p.v[0] && v <= p.v[1]);
  if (!blocks.length) return null;
  const v0 = Math.min(...blocks.map((b) => b.v[0]));
  let v1 = Math.max(...blocks.map((b) => b.v[1]));
  for (const p of m.parts)
    if ((p.part === 'back' || p.part === 'wrap' || p.part === 'other') && u >= p.u[0] && u <= p.u[1] && p.z[1] > z + 2 && p.v[0] > v0 && p.v[0] < v1) v1 = p.v[0];
  return { v0, v1 };
}

/** The front edge of the seat at a u (the least v of the seat blocks there), for where a sitter's legs come off it. */
export function frontEdge(m: Pick<SeatModel, 'parts'>, u: number): number {
  let v = Infinity;
  for (const p of m.parts) if (p.part === 'seat' && u >= p.u[0] - 0.02 && u <= p.u[1] + 0.02) v = Math.min(v, p.v[0]);
  return Number.isFinite(v) ? v : 0;
}

/**
 * HOW PEOPLE SIT (the standard): bottom back against the backrest, knees at the seat's front. A sitter's pelvis is
 * SIT_GAP (a torso's half-depth) in front of the back's front face, so their back rests against it; on a backless
 * seat, halfway across the seat block. Their knees are at the front of the seat, so their shins and feet hang in front
 * of it whatever the figure's own (short) thighs say; the thighs lie on the cushion between.
 */
export const SIT_GAP = 0.1;

/** The front face of the back (or wrap) behind a sitter at u, sitting on a cushion at z: null for a backless seat. */
export function backFace(m: Pick<SeatModel, 'parts'>, u: number, z: number): number | null {
  const blocks = m.parts.filter((p) => p.part === 'seat' && u >= p.u[0] - 0.02 && u <= p.u[1] + 0.02);
  const front = blocks.length ? Math.min(...blocks.map((b) => b.v[0])) : 0;
  let v: number | null = null;
  for (const p of m.parts)
    if ((p.part === 'back' || p.part === 'wrap') && u >= p.u[0] - 0.02 && u <= p.u[1] + 0.02 && p.z[1] > z + 2 && p.v[0] > front + 0.05) v = Math.min(v ?? Infinity, p.v[0]);
  return v;
}

/** The seat blocks' span in depth at u (front to back), or null where there are none. */
export function seatSpan(m: Pick<SeatModel, 'parts'>, u: number): { v0: number; v1: number } | null {
  const blocks = m.parts.filter((p) => p.part === 'seat' && u >= p.u[0] - 0.02 && u <= p.u[1] + 0.02);
  if (!blocks.length) return null;
  return { v0: Math.min(...blocks.map((b) => b.v[0])), v1: Math.max(...blocks.map((b) => b.v[1])) };
}

/**
 * A sitter's thighs reach this far (tiles) from the pelvis to the knees at most, when they're placed: the figure is small
 * for its furniture, so on a seat deeper than that they sit forward, knees at the front, rather than back against the
 * backrest with their legs lost in the cushion.
 */
export const SEAT_REACH = 0.36;
/** The knees stand this far past the seat's front (tiles): the shins clear its front face (sitLegs.ts KNEE_OUT). */
const KNEE_PAST = 0.04;

/**
 * Where the standard puts a sitter's pelvis in depth, at u on a cushion at z: back against the backrest (SIT_GAP in
 * front of it) — or, on a backless seat, its middle — unless their thighs wouldn't reach the front from there; then as
 * far back as they do (SEAT_REACH from the knees just past the front).
 */
export function standardSitV(m: Pick<SeatModel, 'parts'>, u: number, z: number): number | null {
  const back = backFace(m, u, z);
  const s = seatSpan(m, u);
  const ideal = back !== null ? back - SIT_GAP : s ? (s.v0 + s.v1) / 2 : null;
  if (ideal === null || !s) return ideal;
  // the front of the cushion they sit on (the seat blocks level with it)
  const cushion = m.parts.filter((p) => p.part === 'seat' && u >= p.u[0] - 0.02 && u <= p.u[1] + 0.02 && p.z[1] >= z - 0.5);
  const front = cushion.length ? Math.min(...cushion.map((p) => p.v[0])) : s.v0;
  return Math.min(ideal, front - KNEE_PAST + SEAT_REACH);
}

/**
 * Where a sitter's knees are in depth: just in front of the seat's front — of every part but the back — so nothing of
 * the seat is ever in front of their shins and feet.
 */
export function kneeFace(m: Pick<SeatModel, 'parts'>): number {
  let v = Infinity;
  for (const p of m.parts) if (p.part !== 'back' && p.part !== 'wrap') v = Math.min(v, p.v[0]);
  return (Number.isFinite(v) ? v : 0) - 0.03;
}

/** The tallest armrest on one side of a sitter (side: +1 toward larger u), or null. */
export function armTop(m: Pick<SeatModel, 'parts'>, u: number, side: number): number | null {
  let top: number | null = null;
  for (const p of m.parts) if (p.part === 'arm' && ((p.u[0] + p.u[1]) / 2 - u) * side > 0) top = Math.max(top ?? -Infinity, p.z[1]);
  return top;
}

/** The tallest back (or wrap) behind a sitting point, or null. */
export function backTop(m: Pick<SeatModel, 'parts'>, u: number, v: number): number | null {
  let top: number | null = null;
  for (const p of m.parts) if ((p.part === 'back' || p.part === 'wrap') && u >= p.u[0] - 0.05 && u <= p.u[1] + 0.05 && p.v[1] > v) top = Math.max(top ?? -Infinity, p.z[1]);
  return top;
}

/**
 * A sitter's body as boxes in the seat's frame, sitting at `s`: the torso (pelvis to shoulders, the torso's width
 * and depth) and the thighs (forward from the pelvis to the knees, both legs' width, as thick as a thigh). `thighLen`
 * (tiles) and `shoulder` (world px above the cushion) come from the pose; `thighTop` is a thigh's thickness.
 */
export function bodyVolume(s: SitPoint, thighLen: number, shoulder: number, thighTop: number): Array<{ name: 'torso' | 'thighs'; box: Pick<ModelPart, 'u' | 'v' | 'z'> }> {
  const [u, v, z] = s;
  return [
    { name: 'torso', box: { u: [u - 0.17, u + 0.17], v: [v - 0.1, v + 0.1], z: [z + 0.5, z + shoulder] } },
    { name: 'thighs', box: { u: [u - 0.12, u + 0.12], v: [v - thighLen, v], z: [z + 0.5, z + thighTop] } },
  ];
}

/**
 * The parts that intrude into a sitter's body (bodyVolume): overlapping it by more than 0.02 tile across and in depth
 * and 0.5 px in height — an armrest by more than 0.06 tile across (its top may run under a forearm resting on it).
 * The seat block under them never does: its top is the cushion they sit on.
 */
export function intrusions(m: Pick<SeatModel, 'parts'>, body: ReturnType<typeof bodyVolume>): Array<{ part: number; into: 'torso' | 'thighs'; by: [number, number, number] }> {
  const out: Array<{ part: number; into: 'torso' | 'thighs'; by: [number, number, number] }> = [];
  const over = (a: Span, b: Span) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  m.parts.forEach((p, k) => {
    for (const { name, box } of body) {
      const ou = over(p.u, box.u);
      const ov = over(p.v, box.v);
      const oz = over(p.z, box.z);
      if (ou > (p.part === 'arm' ? 0.06 : 0.02) && ov > 0.02 && oz > 0.5) {
        out.push({ part: k, into: name, by: [ou, ov, oz] });
        break;
      }
    }
  });
  return out;
}

/** What's wrong with a model's shape (not its fit): empty when it's well-formed. */
export function modelShapeProblems(x: unknown, cushions?: number): string[] {
  const out: string[] = [];
  const m = x as Partial<SeatModel> | null;
  if (!m || typeof m !== 'object') return ['not an object'];
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const span = (s: unknown) => Array.isArray(s) && s.length === 2 && s.every(num) && (s[0] as number) <= (s[1] as number);
  if (!Array.isArray(m.size) || m.size.length !== 2 || !m.size.every((n) => num(n) && n > 0)) out.push('size: [W, D] in tiles');
  if (!Array.isArray(m.parts) || !m.parts.length) out.push('parts: a list of boxes');
  else
    m.parts.forEach((p, i) => {
      if (!p || !PART_KINDS.includes(p.part)) out.push(`part ${i}: part is one of ${PART_KINDS.join(', ')}`);
      if (!span(p?.u) || !span(p?.v) || !span(p?.z)) out.push(`part ${i}: u, v and z are [from, to] with from ≤ to`);
    });
  if (Array.isArray(m.parts) && !m.parts.some((p) => p?.part === 'seat')) out.push('parts: no seat block');
  if (!Array.isArray(m.sits) || !m.sits.every((s) => Array.isArray(s) && s.length === 3 && s.every(num))) out.push('sits: a list of [u, v, z]');
  else if (cushions !== undefined && m.sits.length !== cushions) out.push(`sits: ${m.sits.length} for ${cushions} cushion(s)`);
  if (m.views !== undefined) {
    const pt = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(num);
    for (const [f, list] of Object.entries(m.views ?? {}))
      if (!MODEL_FACINGS.includes(f as Facing) || !Array.isArray(list) || !list.every(pt) || list.length !== m.sits?.length) out.push(`views.${f}: one [u, v] per cushion`);
  }
  for (const k of ['fitted', 'reviewed'] as const) if (m[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(m[k]))) out.push(`${k}: YYYY-MM-DD`);
  return out;
}

/** A model as it's stored: numbers rounded (tiles to 0.005, px to 0.05), keys in a fixed order. */
export function tidyModel(m: SeatModel): SeatModel {
  const t = (n: number) => Math.round(n * 200) / 200;
  const z = (n: number) => Math.round(n * 20) / 20;
  return {
    size: [m.size[0], m.size[1]],
    parts: m.parts.map((p) => ({ part: p.part, u: [t(p.u[0]), t(p.u[1])], v: [t(p.v[0]), t(p.v[1])], z: [z(p.z[0]), z(p.z[1])] })),
    sits: m.sits.map(([u, v, h]) => [t(u), t(v), z(h)] as SitPoint),
    ...(m.over && Object.keys(m.over).length
      ? { over: Object.fromEntries(MODEL_FACINGS.filter((f) => m.over![f]).map((f) => [f, m.over![f]!.map((poly) => poly.map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2] as [number, number]))])) }
      : {}),
    ...(m.views && Object.keys(m.views).length
      ? { views: Object.fromEntries(MODEL_FACINGS.filter((f) => m.views![f]).map((f) => [f, m.views![f]!.map(([u, v]) => [t(u), t(v)] as [number, number])])) }
      : {}),
    ...(m.fitted ? { fitted: m.fitted } : {}),
    ...(m.reviewed ? { reviewed: m.reviewed } : {}),
    ...(m.drawings && Object.keys(m.drawings).length ? { drawings: m.drawings } : {}),
    ...(m.note ? { note: m.note } : {}),
  };
}
