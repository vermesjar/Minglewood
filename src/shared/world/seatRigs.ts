/**
 * THE SEAT RIG: how a person sits in a seat's drawing, authored and audited per drawn view — the way Habbo
 * furniture carries its own layers — never inferred from the flat picture.
 *
 * art/seat-rigs.json: { [catalog key]: { [facing]: SeatRig } }, keyed by the catalog's sprite key
 * ("couch.green", "chair.cafe") and the facing the seat is placed in (se / sw / ne / nw). A facing the game
 * draws as its partner's drawing mirrored (a chair drawn se and nw is drawn sw and ne by mirroring) takes the
 * partner's rig mirrored, unless it has an entry of its own. A drawing used unmirrored in several facings (a
 * round stool) has an entry for each: the sitter faces a different way on it each time.
 *
 * Everything is in the drawing's own pixels (sprite px, 2× density: 64 px per floor tile), x right, y down,
 * a pixel (i, j) covering [i, i+1] × [j, j+1]:
 *
 *   hips    one per cushion, in seatSpots order: where the middle of the sitter's seat — the underside of the
 *           pelvis, between the hips — rests on the cushion. The figure is drawn with its own seat point there
 *           (FIG_SEAT), snapped to the drawing's pixel grid.
 *   front   regions: the seat's pixels inside them are drawn OVER its sitters (a pixel is in when its centre
 *           is; each polygon even-odd, the regions unioned) — seen from the front, the near armrest and a chair's
 *           near legs; from behind, the backrest frame, the near arm, the seat's back rim and the legs. Whatever they
 *           don't cover, the sitter is drawn over. A region is a polygon [[x, y], …], or {"pts": [[x, y], …],
 *           "cover": n | null} to give it a cover of its own (null: no cap at all).
 *   cover   optional: how far up a sitter (drawing px above their hips) the front layer may reach — the default for
 *           every region without its own. Above it the sitter shows over that region — every pixel of them up
 *           there, and only theirs: a back drawn taller than a seated person's lower back never hides their
 *           shoulders and head. (On a couch from behind: a low cap on the backrest, none on the near arm roll.)
 *           Where regions with different covers overlap, a pixel takes the most generous (none beats any cap).
 *           Seen from the front, a person still standing on the seat's tile (before they crouch to sit) isn't
 *           covered at all; from behind, they are (the back hides a person standing behind it).
 *   legs    'show': the sitter's legs come forward off the cushion and must show (seen from the front);
 *           'hide': the seat's front layer hides them (seen from behind; a seat you sink into). A sitter is always
 *           drawn whole — a seat hides what it hides by drawing over them, never by cutting them — so every pixel
 *           of a seated person is theirs or the seat's front layer, never a hole.
 *   surface optional, polygons like `front`: the seat's top SURFACE in this view — the cushion, cane or slats a
 *           sitter rests on. The checks keep it out from over a sitter's hips (seen from behind, only the backrest
 *           frame, the seat's back rim and the legs go over a sitter) and lay the thighs on it (from the front). Without
 *           it, it's read off the drawing's colours (seatFit.seatSurface); set it where the colours can't tell (an
 *           upholstered back and seat in one fabric: [] when no seat surface shows from this side).
 *   audited the day a person checked this view on its rig sheet (scripts/seat-rig.ts --sheet) and it read right.
 *   drawing a fingerprint of the drawing it was rigged on (drawingPrint): a redrawn seat needs its rig redone.
 *
 * Pure: the renderer (WorldView), the rig tools (scripts/seat-rig.ts) and the Design Lab share it.
 */
import type { Facing } from './scene';
import { SIT_DROP, type SitStyle } from './seats';

export type Pt = [number, number];
export type RigLegs = 'show' | 'hide';

/** A front region: a polygon, or a polygon with a cover of its own (null: no cap). */
export type FrontRegion = Pt[] | { pts: Pt[]; cover?: number | null };

export interface SeatRig {
  hips: Pt[];
  front: FrontRegion[];
  /** Where colour can't tell it: the seat's top surface in this view (what a sitter rests on), for the checks. */
  surface?: Pt[][];
  cover?: number;
  legs: RigLegs;
  /**
   * Seen from behind, a back taller than a seated person (a throne): it hides them, as it would, and the check's
   * "enough of their head shows" is waived. Set by the reviewer, never to get around a bad rig.
   */
  tallBack?: boolean;
  audited?: string;
  drawing?: string;
}

export type SeatRigs = Record<string, Partial<Record<Facing, SeatRig>>>;

export const RIG_FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];
export const RIG_MIRROR: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };
/** Seen from behind: the sitter faces away (the camera looks from the south). */
export const fromBehind = (f: Facing) => f === 'ne' || f === 'nw';

/**
 * The seated figure (avatarFrame): 88 × 128 sprite px, its feet anchor at (45, 104) — (43, 104) mirrored, for
 * a sitter facing sw or nw. Its seat point: the underside of the pelvis, centred between the hips, at
 * HIP_Y + the pose's drop + the thigh's radius.
 */
export const FIG = { w: 88, h: 128, ax: 45, axMirrored: 43, feet: 104, hip: 82, thigh: 3 } as const;

/** How far a pose lowers the figure's body (avatarFrame's DROP): the sitting poses, and the crouch into a seat. */
export function poseDrop(pose: string): number {
  switch (pose) {
    case 'sit':
      return SIT_DROP.chair;
    case 'sit-stool':
      return SIT_DROP.stool;
    case 'sit-lounge':
      return SIT_DROP.lounge;
    case 'sit-floor':
      return SIT_DROP.floor;
    case 'crouch':
      return 3;
    default:
      return 0;
  }
}
export const isSitPoseName = (pose: string) => pose === 'sit' || pose.startsWith('sit-');
/**
 * Whether a seat's front layer covers someone in this pose when it's seen from the front: once they crouch to
 * sit, and while they sit — not while they still stand or walk on its tile (from behind it always does).
 */
export const coveredPose = (pose: string) => pose === 'crouch' || isSitPoseName(pose);

/** The figure's seat point row for a pose that lowers the body by `drop` (sprite px). */
export const figSeatRow = (drop: number) => FIG.hip + drop + FIG.thigh;
/** The figure's seat point row when seated in a style. */
export const figSeatRowFor = (style: SitStyle) => figSeatRow(SIT_DROP[style]);
/** The figure's anchor column: mirrored for a sitter facing sw or nw. */
export const figAx = (facing: Facing) => (facing === 'sw' || facing === 'nw' ? FIG.axMirrored : FIG.ax);

/** Where the figure's top-left goes in the drawing (whole px, on the drawing's grid) for a hip point. */
export function figureAt(hip: readonly [number, number], facing: Facing, style: SitStyle): Pt {
  return [Math.round(hip[0]) - figAx(facing), Math.round(hip[1]) - figSeatRowFor(style)];
}

/** Where a rigged sitter's figure anchor (their feet) goes in the drawing, for a hip point (whole px). */
export function rigFeet(hip: readonly [number, number], style: SitStyle): Pt {
  return [Math.round(hip[0]), Math.round(hip[1]) - figSeatRowFor(style) + FIG.feet];
}

/**
 * Between a drawing and the world: the drawing's anchor is the seat's footprint back vertex on the floor, so a
 * point (x, y) tiles from that vertex, z world px up, is drawn at (ax + 32 (x − y), ay + 16 (x + y) − 2 z).
 */
export function worldToDrawing(anchor: readonly [number, number], x: number, y: number, z = 0): Pt {
  return [anchor[0] + 32 * (x - y), anchor[1] + 16 * (x + y) - 2 * z];
}

/** The world point (tiles from the footprint's back vertex) that, lifted `lift` world px, is drawn at (px, py). */
export function drawingToWorld(anchor: readonly [number, number], px: number, py: number, lift: number): { x: number; y: number } {
  const a = (px - anchor[0]) / 32; // x − y
  const b = (py - anchor[1] + 2 * lift) / 16; // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** A rig for the mirror image of its drawing (`width` px wide): x → width − x, cushions in the same order. */
export function mirrorRig(r: SeatRig, width: number): SeatRig {
  const m = ([x, y]: readonly [number, number]): Pt => [width - x, y];
  return {
    ...r,
    hips: r.hips.map(m),
    front: r.front.map((g) => (Array.isArray(g) ? g.map(m) : { ...g, pts: g.pts.map(m) })),
    ...(r.surface ? { surface: r.surface.map((poly) => poly.map(m)) } : {}),
  };
}

/**
 * The rig for a seat seen facing `facing`, in the pixels of the drawing the game uses there: its own entry, else
 * — when that drawing is its partner's mirrored — the partner's rig mirrored.
 */
export function rigForView(
  rigs: SeatRigs,
  key: string,
  facing: Facing,
  view: { mirrored: boolean; width: number },
): { rig: SeatRig; from: Facing; derived: boolean } | null {
  const own = rigs[key]?.[facing];
  if (own) return { rig: own, from: facing, derived: false };
  const partner = RIG_MIRROR[facing];
  const theirs = view.mirrored ? rigs[key]?.[partner] : undefined;
  return theirs ? { rig: mirrorRig(theirs, view.width), from: partner, derived: true } : null;
}

/** Is a point inside a polygon (even-odd)? */
export function inPoly(poly: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A region's polygon. */
export const regionPts = (g: FrontRegion): Pt[] => (Array.isArray(g) ? g : g.pts);
/** A region's cover: its own (null: none), else the rig's. */
export const regionCover = (g: FrontRegion, rigCover: number | undefined): number | undefined =>
  Array.isArray(g) || g.cover === undefined ? rigCover : (g.cover ?? undefined);

/**
 * The front layer split by cover: every front pixel in exactly one layer, the one of the most generous cover
 * among the regions it's in (no cap beats any cap, a higher cap a lower one). `cover` undefined: no cap.
 */
export function frontLayers(w: number, h: number, rig: Pick<SeatRig, 'front' | 'cover'>): Array<{ cover: number | undefined; mask: Uint8Array }> {
  const best = new Float64Array(w * h).fill(-1);
  for (const g of rig.front) {
    const c = regionCover(g, rig.cover);
    const v = c === undefined ? Infinity : c;
    const m = frontMask(w, h, [regionPts(g)]);
    for (let i = 0; i < m.length; i++) if (m[i] && v > best[i]) best[i] = v;
  }
  const by = new Map<number, Uint8Array>();
  for (let i = 0; i < best.length; i++) {
    if (best[i] < 0) continue;
    let m = by.get(best[i]);
    if (!m) by.set(best[i], (m = new Uint8Array(w * h)));
    m[i] = 1;
  }
  return [...by.entries()].sort(([a], [b]) => a - b).map(([c, mask]) => ({ cover: c === Infinity ? undefined : c, mask }));
}

/** The front layer's mask over a w × h drawing: 1 where a pixel's centre is inside any front region. */
export function frontMask(w: number, h: number, regions: ReadonlyArray<FrontRegion | ReadonlyArray<readonly [number, number]>>): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const g of regions) {
    const poly = (Array.isArray(g) ? g : (g as { pts: Pt[] }).pts) as ReadonlyArray<readonly [number, number]>;
    if (poly.length < 3) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, Math.ceil(x1)); x++) if (inPoly(poly, x + 0.5, y + 0.5)) m[y * w + x] = 1;
  }
  return m;
}

/**
 * The figure row (sprite px) above which a sitter in `pose` shows over their seat's front layer, for a rig that
 * caps its cover at `cover` px above their seat point: the front layer never covers any of their pixels up there.
 */
export function coverRow(pose: string, cover: number): number {
  return figSeatRow(poseDrop(pose)) - cover;
}

/**
 * A fingerprint of a drawing's pixels (FNV-1a over RGBA, 8 hex digits): a rig remembers the drawing it was
 * made on, and the check fails it once the seat is redrawn.
 */
export function drawingPrint(w: number, h: number, rgba: ArrayLike<number>): string {
  let hsh = 0x811c9dc5;
  const mix = (v: number) => {
    hsh ^= v & 255;
    hsh = Math.imul(hsh, 16777619) >>> 0;
  };
  mix(w);
  mix(w >> 8);
  mix(h);
  mix(h >> 8);
  for (let i = 0; i < w * h * 4; i++) mix(rgba[i]);
  return hsh.toString(16).padStart(8, '0');
}

/** What's wrong with a rig's shape (not its fit): empty when it's well-formed. */
export function rigShapeProblems(r: unknown, cushions?: number): string[] {
  const out: string[] = [];
  const v = r as Partial<SeatRig> | null;
  const pt = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
  if (!v || typeof v !== 'object') return ['not an object'];
  if (!Array.isArray(v.hips) || !v.hips.every(pt)) out.push('hips: a list of [x, y]');
  else if (cushions !== undefined && v.hips.length !== cushions) out.push(`hips: ${v.hips.length} for ${cushions} cushion(s)`);
  const region = (g: unknown): boolean => {
    if (Array.isArray(g)) return g.every(pt);
    if (!g || typeof g !== 'object') return false;
    const o = g as { pts?: unknown; cover?: unknown };
    return Array.isArray(o.pts) && o.pts.every(pt) && (o.cover === undefined || o.cover === null || (typeof o.cover === 'number' && Number.isFinite(o.cover) && o.cover >= 0));
  };
  if (!Array.isArray(v.front) || !v.front.every(region)) out.push('front: a list of polygons [[x, y], …] or {"pts": [[x, y], …], "cover": n | null}');
  else if (v.front.some((g) => regionPts(g as FrontRegion).length < 3)) out.push('front: a polygon needs 3 points or more');
  if (v.surface !== undefined && (!Array.isArray(v.surface) || !v.surface.every((poly) => Array.isArray(poly) && poly.length >= 3 && poly.every(pt)))) out.push('surface: a list of polygons, each 3 or more [x, y]');
  if (v.cover !== undefined && (typeof v.cover !== 'number' || !Number.isFinite(v.cover) || v.cover < 0)) out.push('cover: a number of px ≥ 0');
  if (v.legs !== 'show' && v.legs !== 'hide') out.push("legs: 'show' or 'hide'");
  if (v.audited !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(v.audited))) out.push('audited: YYYY-MM-DD');
  return out;
}

/** A rig as it's stored: rounded to half pixels, keys in a fixed order. */
export function tidyRig(r: SeatRig): SeatRig {
  const q = (n: number) => Math.round(n * 2) / 2;
  const p = ([x, y]: readonly [number, number]): Pt => [q(x), q(y)];
  return {
    hips: r.hips.map(p),
    front: r.front
      .filter((g) => regionPts(g).length >= 3)
      .map((g) => (Array.isArray(g) ? g.map(p) : { pts: g.pts.map(p), ...(g.cover !== undefined ? { cover: g.cover === null ? null : q(g.cover) } : {}) })),
    ...(r.surface ? { surface: r.surface.filter((poly) => poly.length >= 3).map((poly) => poly.map(p)) } : {}),
    ...(r.cover !== undefined ? { cover: q(r.cover) } : {}),
    legs: r.legs,
    ...(r.tallBack ? { tallBack: true } : {}),
    ...(r.audited ? { audited: r.audited } : {}),
    ...(r.drawing ? { drawing: r.drawing } : {}),
  };
}

/**
 * The facings of a catalog seat that need a rig of their own (its manifest entry, as art.ts draws it): those
 * with a drawing of their own, or drawn with another facing's drawing unmirrored (a round stool); a facing drawn
 * as its partner's mirror takes the partner's rig.
 */
export function ownRigFacings(e: { file?: string; footprint: readonly [number, number]; facings?: Partial<Record<Facing, unknown>> }): Facing[] {
  return RIG_FACINGS.filter((f) => {
    if (e.facings) return !!e.facings[f] || !e.facings[RIG_MIRROR[f]];
    const long = Math.max(...e.footprint);
    const across = f === 'ne' || f === 'sw';
    const w = across ? long : Math.min(...e.footprint);
    return !(e.footprint[0] !== e.footprint[1] && w === e.footprint[1]);
  });
}

/** A catalog seat's rig: none yet, some views proposed (not every one audited), or every view audited. */
export function rigStatus(e: Parameters<typeof ownRigFacings>[0], rigs?: Partial<Record<Facing, SeatRig>>): 'unrigged' | 'proposed' | 'audited' {
  const own = ownRigFacings(e);
  if (!rigs || !own.some((f) => rigs[f])) return 'unrigged';
  return own.every((f) => rigs[f]?.audited) ? 'audited' : 'proposed';
}
