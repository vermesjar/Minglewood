/**
 * SEAT COMPOSITION: a sitter against their seat, pixel by pixel, from exact depth on both sides.
 *
 * The seat's side is its render (seatRender.ts): every pixel knows the height at which its view ray meets the seat.
 * The sitter's side is the figure's own body in the seat's frame: the head, torso and arms stand on a vertical
 * billboard through the pelvis; the thighs run from the hip toward the knees along the legs the seat gave them
 * (sitLegs.ts); the shins drop from the knees to the soles. Each figure pixel is labelled by the part that painted
 * it (the avatar kit's layer map), so a leg pixel takes its depth from the leg it's on and everything else from the
 * billboard. Where the seat's surface meets the ray higher (nearer the camera) than the sitter's does, the seat is
 * drawn over them; everywhere else they show. There is no cover line, no traced polygon and no whole-part rule: a
 * wingback's near arm hides an elbow exactly where it stands in front of it, a backrest seen from behind hides
 * exactly the back it stands in front of, and the feet are hidden under the seat from behind because the seat is
 * between them and us.
 *
 * Pure (pixels in, masks out): the renderer (WorldView), the grading tools and the Design Lab share it.
 */
import type { Facing } from '../world/scene';
import { localToWorld, rayBillboard, rayThrough, type Ray, type SeatModel, type SitPoint } from '../world/seatModels';
import { THIGH_R, type SitLegs } from '../world/sitLegs';
import { FIG, figAx, figSeatRow, hipFeet, type Pt } from '../world/seatFigure';
import { SIT_DROP, type SitStyle } from '../world/seats';
import type { SeatArt } from './seatRender';
import type { Pixels } from './footing';

/** The avatar kit's layer ids the depth model needs (avatarKit.ts LAYER: legs 6, shoes 7). */
export const LEG_LAYERS: ReadonlySet<number> = new Set([6, 7]);

/** Ties go to the sitter (world px): a cushion top under the pelvis is theirs to sit on, not to be drawn over by. */
export const DEPTH_EPS = 0.35;
/** The body (head, torso) stands as a vertical cylinder this wide (tiles) round the pelvis (a head is 22 figure px across: 0.49 tile square to the view); outside it (a hat’s brim, a hand held out) the body is a billboard. */
export const BODY_R = 0.27;

/**
 * The height at which a ray meets a vertical cylinder of radius r round (qu, qv), from the camera: past its axis
 * by the chord (the ray climbs toward the camera at √2/16 tile per px), or, when the ray misses it, the billboard
 * through the axis.
 */
export function rayBody(ray: Ray, qu: number, qv: number, r: number): number {
  const zc = rayBillboard(ray, qu, qv);
  const du = ray.u0 + ray.du * zc - qu;
  const dv = ray.v0 + ray.dv * zc - qv;
  const d2 = du * du + dv * dv;
  if (d2 >= r * r) return zc;
  return zc + (Math.sqrt(r * r - d2) * 16) / Math.SQRT2;
}

/** A rendered figure as the compositor needs it: its pixels and the layer that painted each. */
export interface Figure {
  px: Uint8ClampedArray | Uint8Array;
  owner: Uint8Array;
}

/** Where a sitter's figure goes in a seat's drawing, and how its rows map onto the body in the seat's frame. */
export interface Placement {
  /** The figure canvas's top-left in the drawing's px. */
  x0: number;
  y0: number;
  /** The figure's seat point (pelvis underside) in the drawing's px. */
  hip: Pt;
  /** The rows (figure px) of the hip joint, the knees and the soles. */
  hipRow: number;
  kneeRow: number;
  soleRow: number;
  /** The figure is the kit's drawing mirrored (facing sw or nw). */
  mirror: boolean;
}

/** The pose row offsets the frame uses (avatarFrame.ts): the hip joint is 3 px above the seat point. */
const HIP_ABOVE_SEAT = FIG.thigh;

/** Where a sitter's figure stands in the drawing for a sitting point, and its leg rows. */
export function placeFigure(art: Pick<SeatArt, 'ax' | 'ay'>, model: Pick<SeatModel, 'size'>, facing: Facing, sit: SitPoint, legs: SitLegs, style: SitStyle): Placement {
  const hip = projectHip(art, model, facing, sit);
  const [fx, fy] = hipFeet(hip, style);
  const x0 = fx - figAx(facing);
  const y0 = fy - FIG.feet;
  const seatRow = figSeatRow(poseDropOf(style));
  const hipRow = seatRow - HIP_ABOVE_SEAT;
  const behind = facing === 'ne' || facing === 'nw';
  const kneeRow = hipRow + (behind ? -16 : 16) * legs.reach - 2 * legs.rise;
  const soleRow = kneeRow + (behind ? -16 : 16) * legs.toe + 2 * legs.drop;
  return { x0, y0, hip, hipRow, kneeRow, soleRow, mirror: facing === 'sw' || facing === 'nw' };
}

const poseDropOf = (style: SitStyle) => SIT_DROP[style];

/** The drawing px a sitting point projects to. */
export function projectHip(art: Pick<SeatArt, 'ax' | 'ay'>, model: Pick<SeatModel, 'size'>, facing: Facing, sit: SitPoint): Pt {
  const [u, v, z] = sit;
  const p = localToWorld(model.size, facing, u, v);
  return [art.ax + 32 * (p.x - p.y), art.ay + 16 * (p.x + p.y) - 2 * z];
}

/**
 * The height (world px) at which the view ray through a figure pixel meets the sitter's body, for a figure placed
 * at `P` on sitting point `sit` with `legs`. `layer`: the kit layer that painted the pixel.
 */
export function figureDepth(art: Pick<SeatArt, 'ax' | 'ay'>, model: Pick<SeatModel, 'size'>, facing: Facing, sit: SitPoint, legs: SitLegs, P: Placement, fx: number, fy: number, layer: number): number {
  const [u, v, z] = sit;
  const X = P.x0 + fx + 0.5;
  const Y = P.y0 + fy + 0.5;
  const ray = rayThrough([art.ax, art.ay], model.size, facing, X, Y);
  if (LEG_LAYERS.has(layer)) {
    const kneeZ = z + THIGH_R + legs.rise;
    const thigh = (t: number) => z + THIGH_R + Math.max(0, Math.min(1, t)) * legs.rise + THIGH_R;
    const shin = (s: number) => Math.max(0, kneeZ - Math.max(0, Math.min(1, s)) * legs.drop) + 1;
    const t = P.kneeRow === P.hipRow ? 1 : (fy - P.hipRow) / (P.kneeRow - P.hipRow);
    const sh = P.soleRow === P.kneeRow ? 1 : (fy - P.kneeRow) / (P.soleRow - P.kneeRow);
    if (P.kneeRow >= P.hipRow) return fy <= P.kneeRow ? thigh(t) : shin(sh);
    // from behind the knees are above the hips and the shins hang down past them: between the two rows a pixel
    // under the knees' columns is shin, the rest thigh; below the hips it's all shin
    if (fy < P.kneeRow) return thigh(1);
    if (fy > P.hipRow) return shin(sh);
    const kx = 32 * legs.reach + 32 * legs.toe * Math.max(0, sh);
    const near = P.mirror ? 87 - (45 - 4 + kx) : 45 - 4 + kx;
    const far = P.mirror ? 87 - (45 + 4 + kx) : 45 + 4 + kx;
    return Math.abs(fx - near) <= 4 || Math.abs(fx - far) <= 4 ? shin(sh) : thigh(t);
  }
  // the body: a vertical cylinder round the pelvis (a billboard beyond its width)
  return rayBody(ray, u, v, BODY_R);
}

export interface OverMask {
  /** The figure's top-left in the drawing's px. */
  x0: number;
  y0: number;
  /** Per figure pixel (FIG.w × FIG.h): 1 where the seat is drawn over the sitter. */
  mask: Uint8Array;
  /** How many of the figure's pixels the seat covers, and how many it has. */
  covered: number;
  total: number;
}

/**
 * What of the seat goes over a sitter: for every pixel of their figure, whether the seat's surface meets the view
 * ray nearer the camera than their body does.
 */
export function overMask(art: SeatArt, model: Pick<SeatModel, 'size'>, sit: SitPoint, legs: SitLegs, style: SitStyle, fig: Figure): OverMask {
  const P = placeFigure(art, model, art.facing, sit, legs, style);
  const mask = new Uint8Array(FIG.w * FIG.h);
  let covered = 0;
  let total = 0;
  for (let fy = 0; fy < FIG.h; fy++)
    for (let fx = 0; fx < FIG.w; fx++) {
      const fi = fy * FIG.w + fx;
      if (!fig.px[fi * 4 + 3]) continue;
      total++;
      const X = P.x0 + fx;
      const Y = P.y0 + fy;
      if (X < 0 || Y < 0 || X >= art.px.w || Y >= art.px.h) continue;
      const sz = art.z[Y * art.px.w + X];
      if (Number.isNaN(sz)) continue;
      const bz = figureDepth(art, model, art.facing, sit, legs, P, fx, fy, fig.owner[fi]);
      if (sz > bz + DEPTH_EPS) {
        mask[fi] = 1;
        covered++;
      }
    }
  return { x0: P.x0, y0: P.y0, mask, covered, total };
}

/**
 * What of the seat goes over someone standing or crouching on its tile (not sitting): their body one vertical
 * billboard at local (u, v), their figure's feet at `feet` in the drawing's px.
 */
export function billboardMask(art: SeatArt, model: Pick<SeatModel, 'size'>, feet: Pt, at: { u: number; v: number }, fig: Figure, facing: Facing): OverMask {
  const x0 = Math.round(feet[0]) - figAx(facing);
  const y0 = Math.round(feet[1]) - FIG.feet;
  const mask = new Uint8Array(FIG.w * FIG.h);
  let covered = 0;
  let total = 0;
  for (let fy = 0; fy < FIG.h; fy++)
    for (let fx = 0; fx < FIG.w; fx++) {
      const fi = fy * FIG.w + fx;
      if (!fig.px[fi * 4 + 3]) continue;
      total++;
      const X = x0 + fx;
      const Y = y0 + fy;
      if (X < 0 || Y < 0 || X >= art.px.w || Y >= art.px.h) continue;
      const sz = art.z[Y * art.px.w + X];
      if (Number.isNaN(sz)) continue;
      const bz = rayBody(rayThrough([art.ax, art.ay], model.size, art.facing, X + 0.5, Y + 0.5), at.u, at.v, BODY_R);
      if (sz > bz + DEPTH_EPS) {
        mask[fi] = 1;
        covered++;
      }
    }
  return { x0, y0, mask, covered, total };
}

export interface Sitter {
  /** Which cushion (seatSpots order). */
  cushion: number;
  fig: Figure;
}

export interface Composed {
  px: Pixels;
  /** Where the drawing's (0, 0) landed in the composition. */
  origin: Pt;
  /** Per composed pixel: −1 the seat (or clear), else the index of the sitter whose pixel shows. */
  who: Int16Array;
}

/**
 * A seat and its sitters composed exactly as the game draws them (WorldView drawSeatFront): the seat, then each
 * sitter back to front — their figure, then the seat's pixels that are nearer than their body — so the result is a
 * true depth composite. `pad`: clear px round the drawing (heads rise above it, feet may hang below).
 */
export function composeSeat(art: SeatArt, model: SeatModel, style: SitStyle, sitsByCushion: Array<SitPoint | null>, legsByCushion: Array<SitLegs | null>, sitters: Sitter[], pad = 48): Composed {
  const { px } = art;
  const W = px.w + pad * 2;
  const H = px.h + pad * 2;
  const d = new Uint8ClampedArray(W * H * 4);
  const who = new Int16Array(W * H).fill(-1);
  const put = (x: number, y: number, src: ArrayLike<number>, i: number, k: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H || !src[i + 3]) return;
    const o = (y * W + x) * 4;
    d[o] = src[i];
    d[o + 1] = src[i + 1];
    d[o + 2] = src[i + 2];
    d[o + 3] = 255;
    who[y * W + x] = k;
  };
  for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) put(x + pad, y + pad, px.d, (y * px.w + x) * 4, -1);
  // sitters back to front: by their sitting point's nearness (x + y in the world)
  const order = sitters
    .map((s, k) => ({ s, k, sit: sitsByCushion[s.cushion], legs: legsByCushion[s.cushion] }))
    .filter((e) => e.sit && e.legs)
    .sort((a, b) => nearness(model, art.facing, a.sit!) - nearness(model, art.facing, b.sit!));
  for (const { s, k, sit, legs } of order) {
    const M = overMask(art, model, sit!, legs!, style, s.fig);
    for (let fy = 0; fy < FIG.h; fy++)
      for (let fx = 0; fx < FIG.w; fx++) {
        const fi = fy * FIG.w + fx;
        if (!s.fig.px[fi * 4 + 3]) continue;
        const X = M.x0 + fx;
        const Y = M.y0 + fy;
        if (M.mask[fi]) {
          // the seat over them: the drawing's own pixel again
          if (X >= 0 && Y >= 0 && X < px.w && Y < px.h) put(X + pad, Y + pad, px.d, (Y * px.w + X) * 4, -1);
        } else put(X + pad, Y + pad, s.fig.px, fi * 4, k);
      }
  }
  return { px: { w: W, h: H, d }, origin: [pad, pad], who };
}

function nearness(model: Pick<SeatModel, 'size'>, f: Facing, s: SitPoint): number {
  const p = localToWorld(model.size, f, s[0], s[1]);
  return p.x + p.y;
}
