/**
 * Isometric depth ordering.
 *
 * Static objects have non-overlapping footprints, so "A is behind B" is well defined when their
 * screen boxes overlap: A.x1 <= B.x0 or A.y1 <= B.y0. We topologically sort statics once per
 * scene, then insert moving actors after the last overlapping static that is behind them.
 */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScreenRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export function behind(a: Box, b: Box): boolean {
  return a.x1 <= b.x0 + 1e-3 || a.y1 <= b.y0 + 1e-3;
}

export function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}

export function topoSort<T extends { box: Box; rect: ScreenRect }>(items: T[]): T[] {
  const n = items.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = items[i];
      const b = items[j];
      if (!rectsOverlap(a.rect, b.rect)) continue;
      const ab = behind(a.box, b.box);
      const ba = behind(b.box, a.box);
      if (ab && !ba) {
        out[i].push(j);
        indeg[j]++;
      } else if (ba && !ab) {
        out[j].push(i);
        indeg[i]++;
      }
    }
  }
  const key = (i: number) => items[i].box.x1 + items[i].box.y1;
  const ready = [...Array(n).keys()].filter((i) => indeg[i] === 0).sort((a, b) => key(a) - key(b));
  const order: number[] = [];
  const done = new Uint8Array(n);
  while (order.length < n) {
    let i = ready.shift();
    if (i === undefined) {
      // cycle: fall back to the smallest-key remaining item
      let best = -1;
      for (let k = 0; k < n; k++) if (!done[k] && (best < 0 || key(k) < key(best))) best = k;
      i = best;
    }
    if (done[i]) continue;
    done[i] = 1;
    order.push(i);
    for (const j of out[i]) {
      if (--indeg[j] === 0 && !done[j]) {
        let p = 0;
        while (p < ready.length && key(ready[p]) <= key(j)) p++;
        ready.splice(p, 0, j);
      }
    }
  }
  return order.map((i) => items[i]);
}
