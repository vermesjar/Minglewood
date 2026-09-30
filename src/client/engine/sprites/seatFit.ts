/**
 * Seat fit: pure pixel maths for the seat standard (src/shared/world/seats.ts), shared by the renderer
 * (WorldView draws the backrest over a sitter who faces away) and the fit tool (scripts/seat-fit.ts measures
 * every seat kind in every facing), so both agree exactly.
 *
 * Coordinates: sprite px at 2× density, origin at the seat footprint's back vertex on the floor (the drawing's
 * anchor). A sitter's figure is 88 × 112 with its feet anchor at (45, 104) (mirrored for sw/nw: 43).
 */
import type { Facing } from '@shared/world/scene';
import { sitterLift, sitterPoint, SIT_POSE_OF, type SeatProfile } from '@shared/world/seats';
import { frameFor } from './avatarFrame';
import type { Pixels } from './footing';

/** A seat drawing as the game places it: pixels and its anchor (the footprint's back vertex). */
export interface SeatArt {
  px: Pixels;
  ax: number;
  ay: number;
}

const THIGH_R = 3;
const FIG_W = 88;
const FEET = 104;

const solid = (p: Pixels, x: number, y: number) => x >= 0 && y >= 0 && x < p.w && y < p.h && p.d[(y * p.w + x) * 4 + 3] > 0;

/** Is a drawing pixel inside the footprint diamond lifted to height `h` (world px)? */
export function inDiamond(art: SeatArt, x: number, y: number, w: number, d: number, h: number): boolean {
  // back vertex at (ax, ay − 2h); tile axes: +x → (+32, +16), +y → (−32, +16) sprite px
  const X = x + 0.5 - art.ax;
  const Y = y + 0.5 - (art.ay - 2 * h);
  const tx = (X / 32 + Y / 16) / 2;
  const ty = (Y / 16 - X / 32) / 2;
  return tx >= 0 && tx <= w && ty >= 0 && ty <= d;
}

/**
 * Seen from behind (the sitter faces away), what of a seat is drawn over its sitter: everything except the
 * cushion behind them — the backrest, and the cushion's near lip that their hips sink behind (a backless
 * bench or stool has only that). The cushion behind them is what lies inside the footprint at cushion
 * height, beyond the sitter's hips (the part nearer us than they are can't be behind them), and — with a
 * backrest — isn't the backrest's own colour; the backrest's
 * colours are read from what stands above the cushion's highest point, which can only be backrest or arms,
 * by how common each is there. (A bentwood chair's rattan seat shows through its hoop
 * behind the sitter; a sofa's upholstery is all one colour, so all of it covers.) Two corrections: each
 * pixel goes with the majority around it (a thin trim on a backrest is backrest, a light fleck in rattan is
 * cushion), and the dark outline along a cushion's far edge, against the air, is the cushion's (else it
 * would draw a line across the sitter's back).
 *
 * Colour can't tell a backrest from its cushion when both are the same upholstery and the back is too low to
 * rise above the cushion's far corner (a banquet chair, a low curved sofa). Such a drawing is calibrated with
 * `line`: its backrest's top edge, traced in the drawing (sprite px, left to right); everything under the
 * line, across its span, is backrest. A line across the top of the drawing makes all of it cover the sitter
 * (a beanbag: you sink into it, its rolled back and sides around you).
 */
export function backrestMask(
  art: SeatArt,
  w: number,
  d: number,
  profile: SeatProfile,
  facing: 'ne' | 'nw',
  line?: ReadonlyArray<readonly [number, number]>,
): Uint8Array {
  const { px } = art;
  const W = px.w;
  const mask = new Uint8Array(W * px.h);
  const top = Math.floor(art.ay - 2 * profile.seat); // the cushion's highest point on screen
  // colour histograms (5 bits a channel): what stands above the cushion, and what lies inside its footprint
  const above = new Map<number, [number, number, number, number]>();
  const inside = new Map<number, [number, number, number, number]>();
  let nAbove = 0;
  let nInside = 0;
  const key = (i: number) => ((px.d[i] >> 3) << 10) | ((px.d[i + 1] >> 3) << 5) | (px.d[i + 2] >> 3);
  const count = (m: typeof above, i: number) => {
    const k = key(i);
    const e = m.get(k);
    if (e) e[3]++;
    else m.set(k, [px.d[i], px.d[i + 1], px.d[i + 2], 1]);
  };
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!px.d[i + 3]) continue;
      if (y < top) {
        count(above, i);
        nAbove++;
      } else if (inDiamond(art, x, y, w, d, profile.seat)) {
        count(inside, i);
        nInside++;
      }
    }
  const share = (m: typeof above, n: number, c: readonly number[]) => {
    let sum = 0;
    for (const e of m.values()) if ((e[0] - c[0]) ** 2 + (e[1] - c[1]) ** 2 + (e[2] - c[2]) ** 2 < 26 * 26) sum += e[3];
    return n ? sum / n : 0;
  };
  // a colour is the backrest's when it's at least half as common up there as it is on the cushion: a stray
  // highlight on a bentwood hoop that matches its rattan seat doesn't make the seat backrest
  const verdict = new Map<number, boolean>();
  for (const [k, e] of inside) verdict.set(k, share(above, nAbove, e) >= 0.5 * share(inside, nInside, e));
  const backLike = (i: number) => profile.backrest && (verdict.get(key(i)) ?? true);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < px.h ? (y * W + x) * 4 : -1);
  const air = (x: number, y: number) => {
    const i = at(x, y);
    return i < 0 || !px.d[i + 3];
  };
  const dark = (x: number, y: number) => {
    const i = at(x, y);
    return i >= 0 && px.d[i + 3] > 0 && px.d[i] + px.d[i + 1] + px.d[i + 2] < 120;
  };
  const raw = new Uint8Array(W * px.h);
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (px.d[i + 3] && inDiamond(art, x, y, w, d, profile.seat) && !backLike(i)) raw[y * W + x] = 1;
    }
  // by majority over a 5 × 5 neighbourhood: a textured cushion (rattan) keeps its odd light pixel, a thin
  // trim or highlight on the backrest goes with the backrest
  // beyond the hips: on the cushion plane, farther along the way the seat faces than the sitter's hip point
  const hipPlane = 0.5 - profile.backDepth;
  const beyond = (x: number, y: number) => {
    const X = x + 0.5 - art.ax;
    const Y = y + 0.5 - (art.ay - 2 * profile.seat);
    return facing === 'ne' ? (Y / 16 - X / 32) / 2 < hipPlane : (X / 32 + Y / 16) / 2 < hipPlane;
  };
  const cushion = new Uint8Array(W * px.h);
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < W; x++) {
      if (air(x, y) || !inDiamond(art, x, y, w, d, profile.seat) || !beyond(x, y)) continue;
      let n = 0;
      let c = 0;
      for (let v = y - 2; v <= y + 2; v++)
        for (let u = x - 2; u <= x + 2; u++) {
          if (air(u, v)) continue;
          n++;
          c += raw[v * W + u];
        }
      if (c * 2 > n) cushion[y * W + x] = 1;
    }
  const isCushion = (x: number, y: number) => at(x, y) >= 0 && cushion[y * W + x] === 1;
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < W; x++) {
      if (air(x, y) || cushion[y * W + x]) continue;
      // a cushion's outline against the air goes with the cushion
      if (dark(x, y) && isCushion(x, y + 1) && air(x, y - 1)) continue;
      mask[y * W + x] = 1;
    }
  if (line && line.length > 1)
    for (let x = Math.max(0, Math.ceil(line[0][0])); x <= Math.min(W - 1, Math.floor(line[line.length - 1][0])); x++) {
      const k = Math.max(1, line.findIndex(([lx]) => lx >= x));
      const [x0, y0] = line[k - 1];
      const [x1, y1] = line[k];
      const top = x1 === x0 ? Math.min(y0, y1) : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      for (let y = Math.max(0, Math.ceil(top)); y < px.h; y++) if (!air(x, y)) mask[y * W + x] = 1;
    }
  return mask;
}

/**
 * The seat's SURFACE in a drawing — the top of the cushion (or cane, or slats) a person sits on: the pixels that
 * lie inside the footprint at the cushion's height and aren't the backrest's or arms' colours (read, as
 * backrestMask reads them, off what stands above the cushion's highest point), each going with the majority
 * around it. The seat rig's checks use it: from behind, the surface must never be drawn over a sitter's hips
 * nor show between their torso and the seat; from the front, their thighs must lie on it. Where the seat is one
 * colour with its back (a sofa, a beanbag), nothing is told apart from behind (its surface is hidden by the back
 * there anyway); `geometric` then takes everything inside the footprint at cushion height (for the front views).
 */
export function seatSurface(art: SeatArt, w: number, d: number, seat: number, backrest: boolean, geometric: boolean): Uint8Array {
  const { px } = art;
  const W = px.w;
  const top = Math.floor(art.ay - 2 * seat);
  const above = new Map<number, [number, number, number, number]>();
  const inside = new Map<number, [number, number, number, number]>();
  let nAbove = 0;
  let nInside = 0;
  const key = (i: number) => ((px.d[i] >> 3) << 10) | ((px.d[i + 1] >> 3) << 5) | (px.d[i + 2] >> 3);
  const count = (m: typeof above, i: number) => {
    const k = key(i);
    const e = m.get(k);
    if (e) e[3]++;
    else m.set(k, [px.d[i], px.d[i + 1], px.d[i + 2], 1]);
  };
  const diamond = new Uint8Array(W * px.h);
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!px.d[i + 3]) continue;
      // (what stands above the cushion's highest point can only be backrest or arms)
      if (y < top) {
        count(above, i);
        nAbove++;
      } else if (inDiamond(art, x, y, w, d, seat)) {
        count(inside, i);
        nInside++;
      }
      if (inDiamond(art, x, y, w, d, seat)) diamond[y * W + x] = 1;
    }
  const share = (m: typeof above, n: number, c: readonly number[]) => {
    let sum = 0;
    for (const e of m.values()) if ((e[0] - c[0]) ** 2 + (e[1] - c[1]) ** 2 + (e[2] - c[2]) ** 2 < 26 * 26) sum += e[3];
    return n ? sum / n : 0;
  };
  const verdict = new Map<number, boolean>();
  for (const [k, e] of inside) verdict.set(k, backrest && nAbove > 0 && share(above, nAbove, e) >= 0.5 * share(inside, nInside, e));
  const raw = new Uint8Array(W * px.h);
  for (let i = 0; i < raw.length; i++) if (diamond[i] && !verdict.get(key(i * 4))) raw[i] = 1;
  const out = new Uint8Array(W * px.h);
  let n = 0;
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < W; x++) {
      if (!diamond[y * W + x]) continue;
      let all = 0;
      let c = 0;
      for (let v = y - 2; v <= y + 2; v++)
        for (let u = x - 2; u <= x + 2; u++) {
          if (u < 0 || v < 0 || u >= W || v >= px.h || !diamond[v * W + u]) continue;
          all++;
          c += raw[v * W + u];
        }
      if (c * 2 > all) {
        out[y * W + x] = 1;
        n++;
      }
    }
  if (geometric && n < 0.25 * nInside) return diamond;
  return out;
}

/** A backrest line traced in a drawing, for the drawing's mirror image (width `w`). */
export const mirrorLine = (line: ReadonlyArray<readonly [number, number]>, w: number): Array<[number, number]> =>
  line.map(([x, y]): [number, number] => [w - 1 - x, y]).reverse();

/** Where a sitter's figure goes, relative to the seat's back vertex (sprite px), as the game rounds it. */
export function sitterOrigin(spot: { x: number; y: number; facing: Facing }, profile: SeatProfile, seat: { x: number; y: number }) {
  const p = sitterPoint(spot, profile);
  const lift = sitterLift(profile, spot.facing);
  const wx = Math.round(((p.x - seat.x) - (p.y - seat.y)) * 16);
  const wy = Math.round(((p.x - seat.x) + (p.y - seat.y)) * 8 - lift);
  const mirrored = spot.facing === 'sw' || spot.facing === 'nw';
  const ax = mirrored ? FIG_W - 45 : 45;
  return { x: 2 * wx - ax, y: 2 * wy - FEET, mirrored };
}

export interface Contact {
  /** Thigh samples with the seat right under them (no air gap). */
  coverage: number;
  /** Mean air gap under the thighs (sprite px, 0 = touching). */
  gap: number;
  /** Mean seat pixels inside the thigh's own thickness (informational: a backrest or arm behind reads the same). */
  sunk: number;
  samples: Array<{ x: number; y: number; gap: number; sunk: number }>;
}

/**
 * How a sitter's thighs meet the seat, seen from the front (se / sw): samples along the near thigh, from the
 * hip toward the knee, each checked for seat pixels just under the thigh's underside (support) and inside the
 * thigh's thickness (sunk). Stools and beanbags are read nearer the hip (their thighs slope off the seat).
 */
export function thighContact(art: SeatArt, spot: { x: number; y: number; facing: Facing }, profile: SeatProfile, seat: { x: number; y: number }): Contact {
  const pose = SIT_POSE_OF[profile.sitStyle];
  const F = frameFor('front', pose);
  const o = sitterOrigin(spot, profile, seat);
  const upto = profile.sitStyle === 'stool' ? 0.4 : profile.sitStyle === 'floor' ? 0.6 : 0.9;
  const samples: Contact['samples'] = [];
  for (let k = 0; k <= 8; k++) {
    const t = (k / 8) * upto;
    const u = F.legNear.a[0] + (F.legNear.m[0] - F.legNear.a[0]) * t;
    const v = F.legNear.a[1] + (F.legNear.m[1] - F.legNear.a[1]) * t + THIGH_R;
    const x = Math.round(o.x + (o.mirrored ? FIG_W - 1 - u : u)) + art.ax;
    const y = Math.round(o.y + v) + art.ay;
    let gap = 15;
    for (let r = -1; r < 15; r++)
      if (solid(art.px, x, y + r)) {
        gap = Math.max(0, r);
        break;
      }
    let sunk = 0;
    for (let r = y - 2 * THIGH_R; r <= y - 2; r++) if (solid(art.px, x, r)) sunk++;
    samples.push({ x, y, gap, sunk });
  }
  const ok = samples.filter((s) => s.gap <= 2).length;
  return {
    coverage: ok / samples.length,
    gap: samples.reduce((a, s) => a + s.gap, 0) / samples.length,
    sunk: samples.reduce((a, s) => a + s.sunk, 0) / samples.length,
    samples,
  };
}

/**
 * A seat's profile from its drawing: the cushion's centre — the centre of the cushion's top face, a pixel in
 * the front drawing — gives the cushion height and where the hips go, by the isometric projection (the top
 * face's centroid is the projection of the cushion's centre). `facing` is the drawing's facing (se or sw).
 */
export function profileFromPoint(art: SeatArt, point: [number, number], facing: 'se' | 'sw'): { seat: number; seatDepth: number } {
  const [x, y] = point;
  // the first cushion's centre line: (0.5 + t, 0.5) facing se, (0.5, 0.5 + t) facing sw
  const t = facing === 'se' ? (x - art.ax) / 32 : (art.ax - x) / 32;
  const floorY = art.ay + 16 + 16 * t;
  return { seat: +((floorY - y) / 2).toFixed(2), seatDepth: +t.toFixed(2) };
}
