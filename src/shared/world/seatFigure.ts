/**
 * The seated figure as the seat code sees it: the avatar frame's geometry (src/client/engine/sprites/avatarFrame.ts)
 * that sitting relies on, in sprite px at 2× density (64 px per floor tile). Pure: shared by the renderer, the seat
 * layers, the tools and the Design Lab.
 */
import type { Facing } from './scene';
import { SIT_DROP, type SitStyle } from './seats';

export type Pt = [number, number];

/**
 * The figure's canvas (88 × 128 sprite px) and its feet anchor at (45, 104) — (43, 104) mirrored, for a figure facing
 * sw or nw. Its seat point: the underside of the pelvis, centred between the hips, at HIP_Y + the pose's drop + the
 * thigh's radius.
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
 * Whether a seat's over layer covers someone in this pose when it's seen from the front: once they crouch to sit, and
 * while they sit — not while they still stand or walk on its tile (from behind it always does).
 */
export const coveredPose = (pose: string) => pose === 'crouch' || isSitPoseName(pose);

/** The figure's seat point row for a pose that lowers the body by `drop` (sprite px). */
export const figSeatRow = (drop: number) => FIG.hip + drop + FIG.thigh;
/** The figure's seat point row when seated in a style. */
export const figSeatRowFor = (style: SitStyle) => figSeatRow(SIT_DROP[style]);
/** The figure's anchor column: mirrored for a sitter facing sw or nw. */
export const figAx = (facing: Facing) => (facing === 'sw' || facing === 'nw' ? FIG.axMirrored : FIG.ax);

/** Where a sitter's figure anchor (their feet) goes in a seat's drawing for a hip point (whole px). */
export function hipFeet(hip: readonly [number, number], style: SitStyle): Pt {
  return [Math.round(hip[0]), Math.round(hip[1]) - figSeatRowFor(style) + FIG.feet];
}

/**
 * The figure row (sprite px) above which a sitter in `pose` shows over their seat's over layer, for a layer that
 * reaches `cover` px above their seat point.
 */
export function coverRow(pose: string, cover: number): number {
  return figSeatRow(poseDrop(pose)) - cover;
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

/** A w × h mask of the pixels whose centre is inside any of the polygons (each even-odd, the polygons unioned). */
export function polyMask(w: number, h: number, polys: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const poly of polys) {
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
 * A fingerprint of a drawing's pixels (FNV-1a over RGBA, 8 hex digits): a seat model remembers the drawings it was
 * passed on, and the check fails it once the seat is redrawn.
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
