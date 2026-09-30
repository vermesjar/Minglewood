/**
 * THE PROJECTION CHECK: is a drawing in the game's 2:1 isometric projection?
 *
 * The world is drawn in 2:1 dimetric: an edge along either floor axis runs 2 px across for each 1 px down, a slope
 * of ±0.5 (26.6°). A piece drawn with a flatter or perspective camera (gpt-image's habit) has its floor-parallel
 * edges at other slopes (the old office chair's ran at 0.19–0.35), and a person drawn on the true 2:1 grid looks
 * turned 15–25° against it.
 *
 * How it measures (scripts/model-check.ts runs it on every drawing):
 *   1. Edge points. Between every two vertically adjacent pixels where the silhouette starts or ends, or the
 *      colour steps by more than EDGE_RGB, there's a near-horizontal edge point (vertical edges make none, so they
 *      never count). Each point has a polarity (silhouette top/bottom, lighter/darker below), and a point in the
 *      middle of three stacked steps is texture (mesh, weave, dither), not an edge.
 *   2. Straight edges. For each polarity, a Hough transform over slopes −0.9 … 0.9 (step 0.01) with 1 px bands
 *      finds runs of edge points along a line: at least MIN_RUN px across, gaps of at most one column, MIN_COVER of
 *      its columns present. Candidates are taken longest first; one whose points are mostly taken already is
 *      dropped. Each kept edge's slope is a least-squares fit of its points.
 *   3. Verdict. An edge is 'iso' within ISO_TOL of ±0.5, 'flat' below ±FLAT (a round top's tangent, a world
 *      diagonal: neither for nor against), 'off' otherwise. A drawing fails when its off edges are long
 *      (≥ MIN_OFF px across in all) and the long near-horizontal edges don't cluster at ±0.5: the off length is
 *      more than OFF_SHARE of the off + iso length. Round and organic pieces have few long straight edges and pass
 *      for want of evidence.
 */
import { blank, type Img } from './png';
import { line, paste, rect, type RGB } from './draw';
import { text } from './font';

export const ISO = 0.5;
export const ISO_TOL = 0.07;
/** |slope| below this is horizontal: neutral. */
export const FLAT = 0.1;
/** |slope| above this isn't near-horizontal (legs, posts, a roof's rake): ignored. */
export const STEEP = 0.9;
/** RGB distance between vertically adjacent pixels that makes an edge point. */
const EDGE_RGB = 44;
/** A straight edge spans at least this many px across (drawings are at scale 2: a tile is 64 px wide). */
export const MIN_RUN = 12;
/** …and has an edge point in at least this share of its columns. */
const MIN_COVER = 0.8;
/** …and bows away from its chord by at most this (px): arcs aren't edges. */
const MAX_SAG = 0.45;
/** The Hough transform's slope step (bands overlap by half a px, so a 64 px edge falls in one). */
const SLOPE_STEP = 0.02;
/** A side's slopes cluster within ±MODE_NEAR of their peak (kernel bandwidth MODE_BW). */
const MODE_BW = 0.05;
const MODE_NEAR = 0.06;
/** A side fails when its peak is off ±0.5 and weighs at least this (two 12 px edges)… */
export const MIN_EVIDENCE = 24;
/** …outweighs its edges on ±0.5, and is at least this share of all the drawing's edges (a long bench's two short
 *  ends don't judge it). */
const MIN_SHARE = 0.12;

export type EdgeKind = 'iso' | 'off' | 'flat';

export interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  slope: number;
  /** px across */
  len: number;
  kind: EdgeKind;
  /** what it edges: the silhouette's top or bottom, or a step to a lighter or darker colour below */
  group: 'top' | 'bottom' | 'lighter' | 'darker';
  /** how far it bows from its chord (px) */
  sag?: number;
  /** its stair: the lengths of its horizontal runs, first and last aside */
  runs?: number[];
  /** in a part the verdict doesn't read (a narrow base: a star base's legs point every way) */
  ignored?: boolean;
}

export interface Projection {
  edges: Edge[];
  isoLen: number;
  offLen: number;
  flatLen: number;
  /** where the falling (+) and rising (−) edges that aren't flat cluster, or null */
  pos: number | null;
  neg: number | null;
  falling: Side;
  rising: Side;
  /** why it fails, or null */
  problem: string | null;
}

export function kindOf(slope: number): EdgeKind {
  const a = Math.abs(slope);
  if (a < FLAT) return 'flat';
  return Math.abs(a - ISO) <= ISO_TOL ? 'iso' : 'off';
}

/** Near-horizontal edge points of a drawing, grouped by polarity: [x, y] at the boundary between two rows. */
function edgePoints(img: Img): Array<{ x: number[]; y: number[] }> {
  const { w, h, d } = img;
  const groups = [0, 1, 2, 3].map(() => ({ x: [] as number[], y: [] as number[] }));
  // step[y * w + x]: the polarity group + 1 of the boundary between rows y and y + 1, or 0
  const step = new Uint8Array(w * h);
  const lum = (i: number) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  for (let y = 0; y + 1 < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = i + w * 4;
      const a = d[i + 3] > 0;
      const b = d[j + 3] > 0;
      if (a !== b) step[y * w + x] = b ? 1 : 2; // the silhouette's top / bottom
      else if (a && b) {
        const dist = Math.hypot(d[i] - d[j], d[i + 1] - d[j + 1], d[i + 2] - d[j + 2]);
        if (dist > EDGE_RGB) step[y * w + x] = lum(j) > lum(i) ? 3 : 4;
      }
    }
  for (let y = 0; y + 1 < h; y++)
    for (let x = 0; x < w; x++) {
      const s = step[y * w + x];
      if (!s) continue;
      // texture: a colour step with colour steps right above and below it (mesh, weave)
      if (s > 2 && y > 0 && y + 2 < h && step[(y - 1) * w + x] > 2 && step[(y + 1) * w + x] > 2) continue;
      groups[s - 1].x.push(x + 0.5);
      groups[s - 1].y.push(y + 1);
    }
  return groups;
}

interface Cand {
  pts: Int32Array;
  n: number;
  err: number;
}

/** Least squares y = slope·x + c over some points, with the mean squared residual. */
function fit(xs: Float64Array, ys: Float64Array, pts: ArrayLike<number>): { slope: number; c: number; err: number } {
  let mx = 0;
  let my = 0;
  for (let i = 0; i < pts.length; i++) {
    mx += xs[pts[i]];
    my += ys[pts[i]];
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < pts.length; i++) {
    sxx += (xs[pts[i]] - mx) ** 2;
    sxy += (xs[pts[i]] - mx) * (ys[pts[i]] - my);
  }
  const slope = sxx ? sxy / sxx : 0;
  const c = my - slope * mx;
  let err = 0;
  for (let i = 0; i < pts.length; i++) err += (ys[pts[i]] - slope * xs[pts[i]] - c) ** 2;
  return { slope, c, err: err / pts.length };
}

/** How far a run bows away from its chord (px): the sagitta of a parabola fitted through it. An arc (a round
 *  seat's rim, a bentwood back) bows; a straight edge, stair-stepped or not, doesn't. */
function sagitta(xs: Float64Array, ys: Float64Array, pts: ArrayLike<number>): number {
  const n = pts.length;
  const x0 = xs[pts[0]];
  const half = (xs[pts[n - 1]] - x0) / 2;
  if (half <= 0) return 0;
  // normal equations for y = a·t² + b·t + c, t centred on the run
  const S = [0, 0, 0, 0, 0];
  const T = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const t = (xs[pts[i]] - x0 - half) / half;
    const y = ys[pts[i]];
    let tp = 1;
    for (let k = 0; k < 5; k++) {
      S[k] += tp;
      if (k < 3) T[k] += tp * y;
      tp *= t;
    }
  }
  const M = [
    [S[4], S[3], S[2], T[2]],
    [S[3], S[2], S[1], T[1]],
    [S[2], S[1], S[0], T[0]],
  ];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-9) return 0;
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return Math.abs(M[0][3] / M[0][0]); // |a|: t runs -1 … 1, so a is the bow at the ends against the middle
}

/** The lengths of a run's horizontal steps (its stair), the partial first and last aside. */
function stairRuns(xs: Float64Array, ys: Float64Array, pts: ArrayLike<number>): number[] {
  const runs: number[] = [];
  let len = 1;
  for (let i = 1; i < pts.length; i++) {
    if (ys[pts[i]] === ys[pts[i - 1]] && xs[pts[i]] - xs[pts[i - 1]] === 1) len++;
    else {
      runs.push(len + (xs[pts[i]] - xs[pts[i - 1]] > 1 && ys[pts[i]] === ys[pts[i - 1]] ? xs[pts[i]] - xs[pts[i - 1]] - 1 : 0));
      len = 1;
    }
  }
  runs.push(len);
  return runs.slice(1, -1);
}

/** The straight near-horizontal edges of one polarity group. */
function straightEdges(xs: Float64Array, ys: Float64Array, width: number, group: Edge['group']): Edge[] {
  const n = xs.length;
  if (n < MIN_RUN * MIN_COVER) return [];
  const cands: Cand[] = [];
  const W = width + 4;
  const keys = new Float64Array(2 * n);
  for (let k = -Math.round(STEEP / SLOPE_STEP); k <= Math.round(STEEP / SLOPE_STEP); k++) {
    const s = k * SLOPE_STEP;
    // bands 1 px high, overlapping by half: band b holds offsets c = y - s·x in [b/2, b/2 + 1); a point is in two
    const off = Math.ceil(STEEP * width * 2) + 4;
    for (let p = 0; p < n; p++) {
      const bin = Math.floor((ys[p] - s * xs[p]) * 2) + off;
      const xi = Math.floor(xs[p]);
      keys[2 * p] = (bin * W + xi) * n + p;
      keys[2 * p + 1] = ((bin - 1) * W + xi) * n + p;
    }
    keys.sort();
    let start = 0;
    const run: number[] = [];
    let prevBand = -1;
    let prevX = -9;
    const flush = () => {
      if (run.length >= MIN_RUN * MIN_COVER) {
        const across = xs[run[run.length - 1]] - xs[run[0]] + 1;
        if (across >= MIN_RUN && run.length >= across * MIN_COVER) {
          const pts = Int32Array.from(run);
          cands.push({ pts, n: pts.length, err: fit(xs, ys, pts).err });
        }
      }
      run.length = 0;
    };
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const p = key % n;
      const cell = (key - p) / n;
      const band = Math.floor(cell / W);
      const xi = cell - band * W;
      if (band !== prevBand || xi - prevX > 2) flush();
      run.push(p);
      prevBand = band;
      prevX = xi;
      start = i;
    }
    void start;
    flush();
  }
  cands.sort((a, b) => b.n - a.n || a.err - b.err);
  const taken = new Uint8Array(n);
  const edges: Edge[] = [];
  for (const c of cands) {
    let free = 0;
    for (let i = 0; i < c.n; i++) if (!taken[c.pts[i]]) free++;
    if (free < c.n * 0.7) continue;
    const sag = sagitta(xs, ys, c.pts);
    if (sag > MAX_SAG) continue;
    for (let i = 0; i < c.n; i++) taken[c.pts[i]] = 1;
    const f = fit(xs, ys, c.pts);
    const x0 = xs[c.pts[0]] - 0.5;
    const x1 = xs[c.pts[c.n - 1]] + 0.5;
    edges.push({ x0, y0: f.slope * x0 + f.c, x1, y1: f.slope * x1 + f.c, slope: f.slope, len: x1 - x0, kind: kindOf(f.slope), group, sag, runs: stairRuns(xs, ys, c.pts) });
  }
  return edges;
}

/** One side's slopes (the rising or the falling edges): where they cluster. Each edge weighs len²/MIN_RUN, so long
 *  structural edges (a desk top, a couch's seat) outweigh short clutter on them (a book set at an angle). */
export interface Side {
  /** the |slope| its edges cluster at (a length-weighted kernel density's peak), or null without edges */
  mode: number | null;
  /** weight within ±MODE_NEAR of the mode, within ISO_TOL of ±0.5, and in all */
  atMode: number;
  atIso: number;
  total: number;
}

const weight = (e: Edge) => (e.len * e.len) / MIN_RUN;

export function side(edges: Edge[]): Side {
  const es = edges.filter((e) => e.kind !== 'flat');
  const total = es.reduce((t, e) => t + weight(e), 0);
  if (!es.length) return { mode: null, atMode: 0, atIso: 0, total };
  let best = -1;
  let mode = 0;
  for (let k = Math.round(FLAT * 100); k <= Math.round(STEEP * 100); k++) {
    const s = k / 100;
    let dens = 0;
    for (const e of es) dens += weight(e) * Math.exp(-(((Math.abs(e.slope) - s) / MODE_BW) ** 2) / 2);
    if (dens > best) [best, mode] = [dens, s];
  }
  const near = (c: number, w: number) => es.filter((e) => Math.abs(Math.abs(e.slope) - c) <= w).reduce((t, e) => t + weight(e), 0);
  return { mode, atMode: near(mode, MODE_NEAR), atIso: near(ISO, ISO_TOL), total };
}

export const fmtSlope = (s: number | null) => (s === null ? '-' : `${s >= 0 ? '+' : '-'}${Math.abs(s).toFixed(2)}`);

/** Whether one side's edges cluster off the projection: on a clear peak away from ±0.5 that outweighs what's on it. */
function offSide(s: Side, all: number): boolean {
  return s.mode !== null && Math.abs(s.mode - ISO) > ISO_TOL + 0.005 && s.atMode >= MIN_EVIDENCE && s.atMode > s.atIso && s.atMode >= MIN_SHARE * all;
}

/** The projection of one drawing: its straight near-horizontal edges and the verdict. `skipBelow`: edges whose
 *  middle is below this row are measured but not judged (a centred piece's narrow base: a star base's legs, a
 *  pedestal's round foot). */
export function projection(img: Img, o: { skipBelow?: number } = {}): Projection {
  const groups = ['top', 'bottom', 'lighter', 'darker'] as const;
  const all = edgePoints(img).flatMap((g, i) => straightEdges(Float64Array.from(g.x), Float64Array.from(g.y), img.w, groups[i]));
  if (o.skipBelow !== undefined) for (const e of all) if ((e.y0 + e.y1) / 2 > o.skipBelow) e.ignored = true;
  const edges = all.filter((e) => !e.ignored);
  const sum = (k: EdgeKind) => edges.filter((e) => e.kind === k).reduce((t, e) => t + e.len, 0);
  const isoLen = sum('iso');
  const offLen = sum('off');
  const flatLen = sum('flat');
  const falling = side(edges.filter((e) => e.slope > 0));
  const rising = side(edges.filter((e) => e.slope < 0));
  const total = falling.total + rising.total;
  const off = [falling, rising].map((s) => offSide(s, total));
  let problem: string | null = null;
  if (off[0] || off[1]) {
    const say = (s: Side, sign: string, bad: boolean) =>
      s.mode === null ? `${sign}: none` : `${sign}${s.mode.toFixed(2)}${bad ? ' (off)' : ''}`;
    const worst = edges
      .filter((e) => e.kind === 'off')
      .sort((a, b) => b.len - a.len)
      .slice(0, 5)
      .map((e) => `${fmtSlope(e.slope)}x${Math.round(e.len)}`);
    problem =
      `not drawn in 2:1 isometric: its near-horizontal edges cluster at ${say(falling, '+', off[0])} / ${say(rising, '-', off[1])}, ` +
      `want ±${ISO.toFixed(2)} ±${ISO_TOL} (${Math.round(offLen)} px of straight edges off it, ${Math.round(isoLen)} on it; ` +
      `longest off: ${worst.join(' ')})`;
  }
  return { edges: all, isoLen, offLen, flatLen, pos: falling.mode, neg: rising.mode === null ? null : -rising.mode, falling, rising, problem };
}

const EDGE_COLOUR: Record<EdgeKind, RGB> = { iso: [60, 220, 110], off: [255, 60, 70], flat: [90, 150, 255] };

/** A drawing at `s`× on a neutral ground with its straight edges drawn over it (green on the projection, red
 *  off it, blue horizontal, grey not judged) and caption lines under it: a cell of the projection audit sheet. */
export function overlay(img: Img, p: Projection, s: number, caption: string[]): Img {
  const capH = caption.length * 12 + 4;
  const W = Math.max(img.w * s + 8, ...caption.map((c) => c.length * 8 + 8));
  const out = blank(W, img.h * s + 8 + capH, [58, 56, 66], 255);
  rect(out, 4, 4, img.w * s, img.h * s, [150, 148, 160]);
  paste(out, img, 4, 4, s);
  for (const e of p.edges) line(out, 4 + e.x0 * s, 4 + e.y0 * s, 4 + e.x1 * s, 4 + e.y1 * s, e.ignored ? [120, 118, 130] : EDGE_COLOUR[e.kind], 2);
  caption.forEach((c, i) => text(out, 4, img.h * s + 10 + i * 12, c, i ? [200, 198, 210] : [255, 255, 255], 2));
  return out;
}
