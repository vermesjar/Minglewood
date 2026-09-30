/**
 * WHERE PEOPLE SIT IN A DRAWN SEAT, FOUND RATHER THAN PLACED BY EYE.
 *
 * A seat's rig puts each cushion's sitter at a hip point in each drawn view. Placed by hand, they drift: onto an arm,
 * into a corner, perched on the back seen from behind, sunk behind it. Here they're fitted from the part map and the
 * rig findings, the same way for every seat, whoever drew it (the catalog's, the Design Lab's):
 *
 *   ACROSS: each sitter sits on the middle of their own cushion's tile, as the server seats them: the tile's centre
 *   at the cushion's height, from the view's footprint and anchor (the same geometry the rig check holds hips to).
 *   Measured in the floor's across coordinate: on the 2:1 screen the across and depth axes aren't perpendicular, so
 *   a screen projection mixes depth in; and a drawing's own pixels can't say where its cushions are (from behind only
 *   the seat's far part shows, and a pixel's place on screen mixes its height into both floor axes).
 *
 *   DEPTH: along the facing. From behind, the most forward point that still passes every finding in this view and its
 *   mirror: a pelvis rests against the back, below its top, so their hips stay hidden and the torso rises from behind
 *   it; any further forward and they sit on the back's edge. From the front, the passing point nearest where they were
 *   (the thighs on the cushion decide it).
 *
 * Each candidate's front layer is compiled from the part map (the rules in seatParts.ts), so the fit judges what the
 * game would draw. Legs (shown or hidden) are settled last, whichever passes.
 */
import type { Facing } from '../../../shared/world/scene';
import { rigForView, type SeatRig } from '../../../shared/world/seatRigs';
import { compileRig, PART } from './seatParts';
import { RIG_LOOKS, rigCushions, rigFindings, type RigView } from './seatRig';

/** The fitter's own aim for hips showing over a back from behind: well inside the check's PERCHED_MAX. */
const PERCHED_AIM = 0.1;

type Pt = [number, number];

/** The way a sitter faces, on screen, per step (drawing px), and the across axis (between the cushions). */
const FWD: Record<Facing, Pt> = { se: [2, 1], sw: [-2, 1], ne: [2, -1], nw: [-2, -1] };
const ACROSS: Record<Facing, Pt> = { se: [2, -1], nw: [2, -1], sw: [2, 1], ne: [2, 1] };
const behindOf = (f: Facing) => f === 'ne' || f === 'nw';

export interface HipFit {
  rig: SeatRig;
  /** Findings left in this view and its mirror (empty when the fit holds). */
  problems: string[];
  /** Per cushion: where it sits along the facing from its cushion's middle, in steps (+ forward). */
  steps: number[];
}

/** Findings that are about where someone sits (approval and the drawing's fingerprint aren't the fit's business). */
const relevant = (ps: string[]) => ps.filter((p) => !p.includes('audited') && !p.includes('drawing changed'));

export function fitHips(
  v: RigView,
  mirror: RigView | null,
  key: string,
  base: SeatRig,
  parts: ArrayLike<number>,
  opts: { range?: number; span?: number } = {},
): HipFit {
  const { w, h } = v.art.px;
  const f = v.facing;
  const R = opts.range ?? 10;
  const [ax, ay] = ACROSS[f];
  const [fx, fy] = FWD[f];
  // each cushion's middle at the cushion's height, in drawing px (the rig check's inverse, seatRig.ts): on the short
  // axis its tile's middle; on the long axis its share of the seat's span (opts.span, tiles, measured where the seat
  // shows: seatSpan), centred on the seat — a couch's fat arms push its cushions in from the tiles' middles
  const cushions = rigCushions(v.footprint, f);
  const n = cushions.length;
  const along = f === 'ne' || f === 'sw' ? 'x' : 'y';
  const long = Math.max(...v.footprint);
  const span = Math.min(long, opts.span ?? long);
  const tiles = cushions.map((c, i) => {
    const onLong = long / 2 - span / 2 + ((i + 0.5) * span) / n;
    const X = along === 'x' && n > 1 ? onLong : c.x + 0.5;
    const Y = along === 'y' && n > 1 ? onLong : c.y + 0.5;
    return [v.art.ax + 32 * (X - Y), v.art.ay + 16 * (X + Y) - 2 * v.seat] as Pt;
  });
  // where each hip is along the facing from its cushion's middle (in steps; + forward): solve base − middle in the
  // (ACROSS, FWD) basis
  const det = ax * fy - ay * fx;
  const depthOf = (q: Pt, t: Pt) => (ax * (q[1] - t[1]) - ay * (q[0] - t[0])) / det;
  const was = base.hips.map((q, i) => (tiles[i] ? depthOf(q as Pt, tiles[i]) : 0));
  const hips: Pt[] = tiles.map((t) => [...t] as Pt);
  const at = (i: number, s: number): Pt => [Math.round((tiles[i][0] + s * fx) * 2) / 2, Math.round((tiles[i][1] + s * fy) * 2) / 2];

  const judge = (hs: Pt[], legs?: SeatRig['legs']): string[] => {
    const { rig } = compileRig({ ...base, hips: hs }, f, w, h, parts);
    const r = legs ? { ...rig, legs } : rig;
    const out = relevant(rigFindings(v, r, RIG_LOOKS, { perchedMax: PERCHED_AIM }).problems);
    if (mirror) {
      const m = rigForView({ [key]: { [f]: r } }, key, mirror.facing, { mirrored: true, width: mirror.art.px.w })?.rig;
      if (m) out.push(...relevant(rigFindings(mirror, m, RIG_LOOKS, { perchedMax: PERCHED_AIM }).problems).map((p) => `${mirror.facing}: ${p}`));
    }
    return out;
  };
  const notLegs = (ps: string[]) => ps.filter((p) => !/legs/.test(p));
  const mine = (ps: string[], i: number) => ps.some((p) => p.includes(`cushion ${i}:`));

  // DEPTH, a cushion at a time (the others where they are), in half steps from the cushion's middle: from behind the
  // most forward passing step no further forward than the middle (past it the pelvis leaves the back, and the checks
  // have nothing to hold it to); from the front the passing step nearest where it was
  const steps = hips.map(() => 0);
  const tries = Array.from({ length: 4 * R + 1 }, (_, k) => (k - 2 * R) / 2);
  for (let i = 0; i < hips.length; i++) {
    const ranked = behindOf(f)
      ? tries.filter((s) => s <= 0).sort((a, b) => b - a)
      : [...tries].sort((a, b) => Math.abs(a - was[i]) - Math.abs(b - was[i]) || b - a);
    let best: number | null = null;
    for (const s of ranked) {
      const hs = hips.map((q, j) => (j === i ? at(i, s) : q));
      if (!mine(notLegs(judge(hs)), i)) {
        best = s;
        break;
      }
    }
    steps[i] = best ?? 0;
    hips[i] = at(i, steps[i]);
  }
  // legs: whichever setting passes (from behind the body covers them; from the front they must show)
  let legs: SeatRig['legs'] = behindOf(f) ? 'hide' : 'show';
  let problems = judge(hips, legs);
  if (problems.some((p) => /legs/.test(p))) {
    const other = legs === 'hide' ? 'show' : 'hide';
    const alt = judge(hips, other);
    if (alt.length < problems.length) {
      legs = other;
      problems = alt;
    }
  }
  const { rig } = compileRig({ ...base, hips }, f, w, h, parts);
  return { rig: { ...rig, legs }, problems, steps };
}

/**
 * The seat's span along a seat's length, in tiles: where its cushions' top surface runs between the arms, measured in
 * a view that shows it (a front view): each column's topmost seat pixel (the cushion's top), taken at the cushion's
 * height down to the floor.
 * Symmetric by assumption (both arms alike), so it's the length minus the arms, however the view is turned.
 */
export function seatSpan(v: RigView, parts: ArrayLike<number>): number | null {
  const { w, h } = v.art.px;
  const along = v.facing === 'ne' || v.facing === 'sw' ? 'x' : 'y';
  const ls: number[] = [];
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      if (parts[y * w + x] !== PART.seat) continue; // the column's topmost seat pixel: the cushion's top surface
      const a = (x + 0.5 - v.art.ax) / 32;
      const b = (y + 0.5 - v.art.ay + 2 * v.seat) / 16;
      ls.push(along === 'x' ? (a + b) / 2 : (b - a) / 2);
      break;
    }
  if (ls.length < 6) return null;
  ls.sort((p, q) => p - q);
  const lo = ls[Math.floor(ls.length * 0.03)];
  const hi = ls[Math.ceil(ls.length * 0.97) - 1];
  return hi - lo;
}
