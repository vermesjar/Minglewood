/**
 * The seat standard, checked: a seat drawing in one facing, with a sitter on every cushion, composed exactly
 * as the game draws it (WorldView: seat, sitters back to front, then — seen from behind — the backrest over
 * them) and measured against the drawing. Pure: pixels in, findings out, so it works on a draft that isn't in
 * the manifest yet (the Design Lab) as well as on the catalogue (scripts/seat-fit.ts, the model check).
 *
 *   front (se / sw)  the thighs rest on the seat: seat right under them, no air gap
 *   back (ne / nw)   the sitter sits in the seat: the bottom of their hips is tucked behind the seat (its
 *                    backrest or its cushion's near lip), never showing on top of a backrest or over
 *                    nothing, and their head shows
 *   every cushion    each sitter on their own cushion (a couch seats two side by side, not stacked)
 *
 * Fitting: the cushion's centre, a pixel read off the front drawing, gives the height and the front view's
 * hip depth (profileFromPoint); the back views' hip depth is then fitted to the back drawings (fitBackDepth).
 */
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import { BACK_COVER_UP, seenFromBehind, SIT_DROP, SIT_POSE_OF, type SeatProfile } from '@shared/world/seats';
import { renderAvatar } from './avatarQa';
import type { Pose } from './avatarFrame';
import type { Pixels } from './footing';
import { backrestMask, sitterOrigin, thighContact, type SeatArt } from './seatFit';

/** The sitters the check seats (two looks, so a couch's pair can be told apart). */
export const CHECK_LOOKS: AvatarLoadout[] = [
  { hair: 'hair.short', hairColor: '#3b2518', top: 'top.tee', topColor: '#e0503f', bottom: 'bottom.jeans', bottomColor: '#1f2a44' } as AvatarLoadout,
  { hair: 'hair.long', hairColor: '#d9a35b', top: 'top.hoodie', topColor: '#2bb3a3', bottom: 'bottom.chinos', bottomColor: '#3a3a46', body: 'body.b' } as AvatarLoadout,
];

export interface Spot {
  x: number;
  y: number;
  facing: Facing;
}

/**
 * A seat placed facing a way: its footprint as placed (a long seat runs across the way it faces: a sofa
 * facing ne or sw lies along x) and its cushions, one per tile.
 */
export function seatPlacement(footprint: readonly [number, number], facing: Facing): { w: number; d: number; spots: Spot[] } {
  const long = Math.max(...footprint);
  const across = facing === 'ne' || facing === 'sw';
  const w = across ? long : Math.min(...footprint);
  const d = across ? Math.min(...footprint) : long;
  const spots: Spot[] = [];
  for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) spots.push({ x, y, facing });
  return { w, d, spots };
}

/**
 * Height and front-view hip depth from the front drawing (facing se or sw, as the game resolves it): the
 * centre of the first cushion's top face is the projection of the cushion's centre, (0.5 + t, 0.5) facing se,
 * (0.5, 0.5 + t) facing sw, at the cushion's height.
 */
export function profileFromPoint(art: SeatArt, facing: 'se' | 'sw', cushion: readonly [number, number]): { seat: number; seatDepth: number } {
  const t = ((facing === 'se' ? 1 : -1) * (cushion[0] - art.ax)) / 32;
  const seat = (art.ay + 16 + 16 * t - cushion[1]) / 2;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { seat: r(seat), seatDepth: r(t) };
}

export interface SeatView {
  /** The drawing as the game uses it in this facing (its own, or its partner's mirrored), anchor included. */
  art: SeatArt;
  facing: Facing;
  footprint: readonly [number, number];
  /** The backrest line for this drawing (already mirrored with it), if the seat has one. */
  line?: ReadonlyArray<readonly [number, number]>;
}

const FIG_W = 88;
const FIG_H = 112;
const figures = new Map<string, Uint8ClampedArray>();
function figure(look: AvatarLoadout, k: number, facing: Facing, pose: Pose): Uint8ClampedArray {
  const key = `${k}|${facing}|${pose}`;
  if (!figures.has(key)) figures.set(key, renderAvatar(look, facing, pose));
  return figures.get(key)!;
}

interface Composition {
  cell: Pixels;
  /** Per cell pixel: 1 seat, 2 seat drawn over the sitters (backrest). */
  seatAt: Uint8Array;
  /** Per cell pixel: which sitter shows there (1-based, back to front). */
  sitterAt: Uint8Array;
  /** Each sitter, back to front: their cushion's index and hip point in the cell. */
  sitters: Array<{ index: number; hip: [number, number]; top: number }>;
  size: number;
}

function compose(view: SeatView, profile: SeatProfile, size: number, [OX, OY]: [number, number], looks: AvatarLoadout[]): Composition {
  const { art, facing } = view;
  const { w, d, spots } = seatPlacement(view.footprint, facing);
  const pose = SIT_POSE_OF[profile.sitStyle];
  const cell: Pixels = { w: size, h: size, d: new Uint8ClampedArray(size * size * 4) };
  const seatAt = new Uint8Array(size * size);
  const sitterAt = new Uint8Array(size * size);
  const put = (X: number, Y: number, src: ArrayLike<number>, i: number) => {
    if (X < 0 || Y < 0 || X >= size || Y >= size) return false;
    const o = (Y * size + X) * 4;
    cell.d[o] = src[i];
    cell.d[o + 1] = src[i + 1];
    cell.d[o + 2] = src[i + 2];
    cell.d[o + 3] = 255;
    return true;
  };
  const mask = seenFromBehind(facing) ? backrestMask(art, w, d, profile, facing as 'ne' | 'nw', view.line) : null;
  for (let y = 0; y < art.px.h; y++)
    for (let x = 0; x < art.px.w; x++) {
      const i = (y * art.px.w + x) * 4;
      if (!art.px.d[i + 3]) continue;
      const X = OX - art.ax + x;
      const Y = OY - art.ay + y;
      if (put(X, Y, art.px.d, i)) seatAt[Y * size + X] = 1;
    }
  const order = spots.map((s, index) => ({ s, index })).sort((a, b) => a.s.x + a.s.y - (b.s.x + b.s.y));
  const sitters: Composition['sitters'] = [];
  // each sitter's body columns, and the row above which the seat doesn't cover them (WorldView.drawBackrest)
  const uncovered: Array<{ l: number; r: number; cut: number }> = [];
  order.forEach(({ s, index }, k) => {
    const fig = figure(looks[k % looks.length], k % looks.length, facing, pose);
    const o = sitterOrigin(s, profile, { x: 0, y: 0 });
    let top = size;
    for (let y = 0; y < FIG_H; y++)
      for (let x = 0; x < FIG_W; x++) {
        const i = (y * FIG_W + x) * 4;
        if (!fig[i + 3]) continue;
        const X = OX + o.x + x;
        const Y = OY + o.y + y;
        if (put(X, Y, fig, i)) {
          sitterAt[Y * size + X] = k + 1;
          top = Math.min(top, Y);
        }
      }
    const hipY = OY + o.y + 82 + SIT_DROP[profile.sitStyle];
    sitters.push({ index, hip: [OX + o.x + (o.mirrored ? FIG_W - 1 - 41 : 41), hipY], top });
    const ax = OX + o.x + (o.mirrored ? FIG_W - 45 : 45);
    uncovered.push({ l: ax - 24, r: ax + 24, cut: hipY - 2 * BACK_COVER_UP });
  });
  if (mask)
    for (let y = 0; y < art.px.h; y++)
      for (let x = 0; x < art.px.w; x++) {
        if (!mask[y * art.px.w + x]) continue;
        const X = OX - art.ax + x;
        const Y = OY - art.ay + y;
        if (uncovered.some((u) => X >= u.l && X < u.r && Y < u.cut)) continue;
        if (put(X, Y, art.px.d, (y * art.px.w + x) * 4)) seatAt[Y * size + X] = 2;
      }
  return { cell, seatAt, sitterAt, sitters, size };
}

/**
 * Seen from behind, how a sitter meets their seat, over their pelvis (the columns either side of the hip
 * point): the share of it showing on top of a backrest (perched), over nothing (floating), and how much of
 * their head shows.
 */
function backMetrics(c: Composition, k: number) {
  const { size, sitterAt, seatAt } = c;
  const s = c.sitters[k];
  let cols = 0;
  let tucked = 0;
  let perched = 0;
  let floating = 0;
  for (let X = s.hip[0] - 7; X <= s.hip[0] + 7; X++) {
    if (X < 0 || X >= size) continue;
    let bottom = -1;
    for (let Y = size - 1; Y >= 0; Y--)
      if (sitterAt[Y * size + X] === k + 1) {
        bottom = Y;
        break;
      }
    if (bottom < 0) continue;
    cols++;
    if (seatAt[bottom * size + X] === 2) {
      tucked++; // tucked behind the backrest or the cushion's lip
      continue;
    }
    const under = [1, 2, 3].map((dy) => (bottom + dy < size ? seatAt[(bottom + dy) * size + X] : 0));
    if (under.includes(1)) continue; // on the cushion
    if (under.includes(2)) perched++;
    else floating++;
  }
  // the head, shoulders and upper back (the top 34 rows of the figure)
  let head = 0;
  let shown = 0;
  for (let Y = s.top; Y < Math.min(size, s.top + 34); Y++)
    for (let X = 0; X < size; X++)
      if (sitterAt[Y * size + X] === k + 1) {
        head++;
        if (seatAt[Y * size + X] !== 2) shown++;
      }
  const n = Math.max(1, cols);
  return { tucked: tucked / n, perched: perched / n, floating: floating / n, head: head ? shown / head : 1 };
}

export interface ViewCheck {
  problems: string[];
  /** The composition as drawn, `size` square, the seat's back vertex at `origin`. */
  cell: Pixels;
}

/** Check one facing of a seat: compose it with a sitter on every cushion and measure. */
export function checkSeatView(view: SeatView, profile: SeatProfile, opts: { size?: number; origin?: [number, number]; looks?: AvatarLoadout[] } = {}): ViewCheck {
  const c = compose(view, profile, opts.size ?? 150, opts.origin ?? [75, 95], opts.looks ?? CHECK_LOOKS);
  const problems: string[] = [];
  if (!seenFromBehind(view.facing))
    for (const { index } of c.sitters) {
      const spot = seatPlacement(view.footprint, view.facing).spots[index];
      const t = thighContact(view.art, spot, profile, { x: 0, y: 0 });
      if (t.coverage < 0.75)
        problems.push(`cushion ${index}: thighs ${t.gap > 2 ? `float ${t.gap.toFixed(1)}px above the seat` : t.sunk > 2 ? `sunk ${t.sunk.toFixed(1)}px into the seat` : 'not carried'} (${Math.round(t.coverage * 100)}% supported)`);
    }
  else
    c.sitters.forEach(({ index }, k) => {
      const m = backMetrics(c, k);
      if (m.perched > 0.2) problems.push(`cushion ${index}: sits on top of the backrest (${Math.round(m.perched * 100)}% of the hips)`);
      if (m.tucked < 0.6) problems.push(`cushion ${index}: perched on the seat, not sunk into it (${Math.round(m.tucked * 100)}% of the hips tucked)`);
      if (m.floating > 0.3) problems.push(`cushion ${index}: hips float (${Math.round(m.floating * 100)}% over nothing)`);
      if (m.head < 0.9) problems.push(`cushion ${index}: hidden by the seat (${Math.round(m.head * 100)}% of the head, shoulders and upper back show)`);
    });
  const hips = c.sitters.map((s) => s.hip[0]);
  if (hips.length > 1 && Math.abs(hips[0] - hips[1]) < 20) problems.push('sitters stacked on one cushion');
  return { problems, cell: c.cell };
}

/**
 * The back views' hip depth, fitted to the back drawings: the hips as they are seen from the front
 * (seatDepth), eased back toward the backrest only as far as it takes for them to sit in the seat rather than
 * on top of its back — the least move that works in every back view, else the one that comes closest.
 * (The figure's legs are short for its furniture, so the two views can't share one depth.)
 */
export function fitBackDepth(views: SeatView[], profile: SeatProfile): number {
  if (!profile.backrest || !views.length) return profile.seatDepth;
  let best = { t: profile.seatDepth, score: Infinity };
  for (let step = 0; step <= 30; step++) {
    const t = Math.round((profile.seatDepth - step * 0.02) * 100) / 100;
    const p = { ...profile, backDepth: t };
    let score = 0;
    let ok = true;
    for (const v of views) {
      const c = compose(v, p, 150, [75, 95], CHECK_LOOKS);
      c.sitters.forEach((_, k) => {
        const m = backMetrics(c, k);
        ok &&= m.perched <= 0.2 && m.floating <= 0.3 && m.head >= 0.9;
        score = Math.max(score, m.perched + Math.max(0, m.floating - 0.3) + Math.max(0, 0.9 - m.head));
      });
    }
    if (ok) return t;
    if (score < best.score) best = { t, score };
  }
  return best.t;
}
