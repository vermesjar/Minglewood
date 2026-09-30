/**
 * A seat drawing's natural pieces (pixel art: a few shades per material, dark outlines between parts): what the
 * outlines enclose, the outlines dissolved into the pieces either side, specks merged away. The Design Lab picks
 * pieces to put in front of a sitter; the seat rig's checks tell the seat's top surface from what rises above it.
 */
import type { Pt } from '@shared/world/seatRigs';
import type { Pixels } from './footing';

export interface Pieces {
  /** Per pixel: its piece (1…n), 0 for air. */
  labels: Int32Array;
  n: number;
  /** A point inside each piece (for its number), and its size in px; index = piece. */
  at: Pt[];
  size: number[];
}

const lum = (d: ArrayLike<number>, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/**
 * The drawing's natural pieces. Pixel art is drawn in a few shades per material with dark outlines between
 * parts, so: colours are grouped into shades (k-means), same-shade pixels that touch make a blob, thin blobs
 * (outlines, seams: mostly a pixel wide) dissolve into the pieces either side, and specks merge into the
 * neighbour they share the most edge with. `cuts` then split pieces through given pixels (shift-click).
 */
export function segment(px: Pixels, cuts: ReadonlyArray<readonly [number, number, 'h' | 'v']> = [], minPiece = 12, contrast = 0.86): Pieces {
  const { w, h, d } = px;
  const N = w * h;
  const opaque = (i: number) => d[i * 4 + 3] > 0;
  const cols: number[] = [];
  for (let i = 0; i < N; i++) if (opaque(i)) cols.push(i);
  // lines: pixels clearly darker than what's around them (outlines, seams, creases), and the near-black
  const L = new Float32Array(N);
  for (const i of cols) L[i] = lum(d, i * 4);
  const line = new Uint8Array(N);
  for (const i of cols) {
    const x = i % w;
    const y = (i - x) / w;
    let sum = 0;
    let n = 0;
    for (let v = y - 2; v <= y + 2; v++)
      for (let u = x - 2; u <= x + 2; u++) {
        if (u < 0 || v < 0 || u >= w || v >= h) continue;
        const j = v * w + u;
        if (!opaque(j)) continue;
        sum += L[j];
        n++;
      }
    if (L[i] < 28 || L[i] < contrast * (sum / n)) line[i] = 1;
  }
  // pieces: what the lines enclose (4-connected), then the lines dissolve into the pieces either side
  const lab = new Int32Array(N);
  let n = 0;
  for (const s0 of cols) {
    if (lab[s0] || line[s0]) continue;
    lab[s0] = ++n;
    const q = [s0];
    while (q.length) {
      const i = q.pop()!;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w])
        if (j >= 0 && j < N && !lab[j] && opaque(j) && !line[j]) {
          lab[j] = n;
          q.push(j);
        }
    }
  }
  const nb8 = (i: number) => {
    const x = i % w;
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= w) continue;
        const j = i + dy * w + dx;
        if (j >= 0 && j < N) out.push(j);
      }
    return out;
  };
  // specks first (a lone lit pixel between lines isn't a piece): they become line too
  {
    const size = new Map<number, number>();
    for (const i of cols) if (lab[i]) size.set(lab[i], (size.get(lab[i]) ?? 0) + 1);
    for (const i of cols) if (lab[i] && size.get(lab[i])! < 4) lab[i] = 0;
  }
  for (let pass = 0; pass < 16; pass++) {
    const next = lab.slice();
    let left = 0;
    for (const i of cols) {
      if (lab[i]) continue;
      const votes = new Map<number, number>();
      for (const j of nb8(i)) if (lab[j]) votes.set(lab[j], (votes.get(lab[j]) ?? 0) + (Math.abs(L[j] - L[i]) < 60 ? 2 : 1));
      let best = 0;
      let bv = 0;
      for (const [k, v] of votes) if (v > bv) [best, bv] = [k, v];
      if (best) next[i] = best;
      else left++;
    }
    lab.set(next);
    if (!left) break;
  }
  // a drawing that's all line (tiny, or very dark) is one piece
  for (const i of cols) if (!lab[i]) lab[i] = n + 1;
  // specks merge into the neighbour they share the most edge with (diagonals count), until none are left
  for (let pass = 0; pass < 24; pass++) {
    const size = new Map<number, number>();
    for (const i of cols) size.set(lab[i], (size.get(lab[i]) ?? 0) + 1);
    const small = new Set([...size].filter(([, v]) => v < minPiece).map(([k]) => k));
    if (!small.size || size.size < 2) break;
    const edges = new Map<number, Map<number, number>>();
    for (const i of cols) {
      const k = lab[i];
      if (!small.has(k)) continue;
      for (const j of nb8(i)) {
        if (!opaque(j) || lab[j] === k) continue;
        const e = edges.get(k) ?? new Map<number, number>();
        e.set(lab[j], (e.get(lab[j]) ?? 0) + 1);
        edges.set(k, e);
      }
    }
    const into = new Map<number, number>();
    for (const k of [...small].sort((x, y) => size.get(x)! - size.get(y)!)) {
      let best = 0;
      let bv = -1;
      for (const [o, v] of edges.get(k) ?? []) {
        const score = v + (size.get(o)! >= minPiece ? 0.5 : 0);
        if (score > bv && !into.has(o)) [best, bv] = [o, score];
      }
      if (best) into.set(k, best);
    }
    if (!into.size) break;
    for (const i of cols) if (into.has(lab[i])) lab[i] = into.get(lab[i])!;
  }
  // cuts: split the piece through (x, y) along a row ('h': the part above stays) or a column ('v': the left stays)
  let top = Math.max(0, ...lab);
  for (const [cx, cy, dir] of cuts) {
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) continue;
    const k = lab[y0 * w + x0];
    if (!k) continue;
    top++;
    for (const i of cols) {
      if (lab[i] !== k) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (dir === 'h' ? y >= y0 : x >= x0) lab[i] = top;
    }
  }
  // number the pieces top to bottom, left to right (by where their middle is)
  const acc = new Map<number, { sx: number; sy: number; n: number }>();
  for (const i of cols) {
    const a = acc.get(lab[i]) ?? { sx: 0, sy: 0, n: 0 };
    a.sx += i % w;
    a.sy += Math.floor(i / w);
    a.n++;
    acc.set(lab[i], a);
  }
  const order = [...acc.entries()].sort(([, a], [, b]) => Math.round(a.sy / a.n / 6) - Math.round(b.sy / b.n / 6) || a.sx / a.n - b.sx / b.n);
  const renum = new Map(order.map(([k], i) => [k, i + 1]));
  const labels = new Int32Array(N);
  for (const i of cols) labels[i] = renum.get(lab[i])!;
  const count = order.length;
  const size = new Array<number>(count + 1).fill(0);
  const at: Pt[] = new Array(count + 1).fill([0, 0]);
  const best = new Array<number>(count + 1).fill(Infinity);
  for (const i of cols) size[labels[i]]++;
  // each piece's number goes on its pixel nearest its middle
  for (const [k, a] of acc) {
    const id = renum.get(k)!;
    const mx = a.sx / a.n;
    const my = a.sy / a.n;
    for (const i of cols) {
      if (labels[i] !== id) continue;
      const x = i % w;
      const y = (i - x) / w;
      const dd = (x - mx) ** 2 + (y - my) ** 2;
      if (dd < best[id]) {
        best[id] = dd;
        at[id] = [x + 0.5, y + 0.5];
      }
    }
  }
  return { labels, n: count, at, size };
}

