/**
 * Pixel masks as seat-rig front polygons (src/shared/world/seatRigs.ts). A rig's front layer is the drawing's
 * pixels inside its polygons (a pixel is in when its centre is; each polygon even-odd, polygons unioned).
 *
 *   maskToPolys  EXACT: every blob's outline along pixel edges, holes included (each blob's loops joined into one
 *                even-odd polygon), collinear points dropped — frontMask(maskToPolys(m)) is m, pixel for pixel.
 *                What the Design Lab stores when you pick pieces and brush pixels.
 *   traceMask    SIMPLIFIED: each blob's outer outline only, Douglas–Peucker to `tol` px — a few editable points,
 *                for seeding a rig by hand (scripts/seat-rig.ts --init).
 */
type Pt = [number, number];

/** Blobs of a mask (4-connected), each as a list of pixel indices. */
function blobs(mask: ArrayLike<number>, w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h);
  const out: number[][] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const blob: number[] = [];
    const q = [s];
    seen[s] = 1;
    while (q.length) {
      const i = q.pop()!;
      blob.push(i);
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w])
        if (j >= 0 && j < w * h && mask[j] && !seen[j]) {
          seen[j] = 1;
          q.push(j);
        }
    }
    out.push(blob);
  }
  return out;
}

/**
 * A blob's boundary as closed loops of pixel-corner points: every edge between a blob pixel and a pixel outside
 * it, chained end to start. However the loops pair up at a pinch, each boundary edge is in exactly one loop, so
 * the even-odd rule over all of them gives back exactly the blob.
 */
function loops(blob: number[], w: number): Pt[][] {
  const inside = new Set(blob);
  const has = (x: number, y: number) => x >= 0 && x < w && y >= 0 && inside.has(y * w + x);
  // directed edges keyed by their start corner: the blob on the right of each (clockwise outer loops)
  const next = new Map<string, Pt[]>();
  const add = (a: Pt, b: Pt) => {
    const k = `${a[0]},${a[1]}`;
    const l = next.get(k);
    if (l) l.push(b);
    else next.set(k, [b]);
  };
  let count = 0;
  for (const i of blob) {
    const x = i % w;
    const y = (i - x) / w;
    const sides: Array<[boolean, Pt, Pt]> = [
      [has(x, y - 1), [x, y], [x + 1, y]],
      [has(x + 1, y), [x + 1, y], [x + 1, y + 1]],
      [has(x, y + 1), [x + 1, y + 1], [x, y + 1]],
      [has(x - 1, y), [x, y + 1], [x, y]],
    ];
    for (const [shared, a, b] of sides)
      if (!shared) {
        add(a, b);
        count++;
      }
  }
  const out: Pt[][] = [];
  while (count > 0) {
    const [startKey, ends] = [...next.entries()].find(([, l]) => l.length)!;
    const start = startKey.split(',').map(Number) as Pt;
    const loop: Pt[] = [start];
    let at = start;
    let b = ends.pop()!;
    count--;
    while (b[0] !== start[0] || b[1] !== start[1]) {
      loop.push(b);
      at = b;
      const l = next.get(`${at[0]},${at[1]}`);
      if (!l || !l.length) break;
      b = l.pop()!;
      count--;
    }
    out.push(dropCollinear(loop));
  }
  return out;
}

function dropCollinear(loop: Pt[]): Pt[] {
  if (loop.length < 4) return loop;
  const out: Pt[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[(i - 1 + loop.length) % loop.length];
    const b = loop[i];
    const c = loop[(i + 1) % loop.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}

/**
 * Exact polygons for a mask: one even-odd polygon per blob — its outline and its holes, each loop closed and
 * reached from the first loop's start and back along the same line (a bridge crossed twice counts for nothing).
 */
export function maskToPolys(mask: ArrayLike<number>, w: number, h: number): Pt[][] {
  return blobs(mask, w, h).map((blob) => {
    const [first, ...rest] = loops(blob, w);
    const out: Pt[] = [...first, first[0]];
    for (const l of rest) out.push(...l, l[0], first[0]);
    return out;
  });
}

function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [x1, y1] = pts[a];
    const [x2, y2] = pts[b];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    let best = -1;
    let dist = tol;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const d = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / len;
      if (d > dist) {
        dist = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A few editable points per blob: its outer outline, simplified to `tol` px; blobs under `minArea` px dropped. */
export function traceMask(mask: ArrayLike<number>, w: number, h: number, tol = 1.2, minArea = 6): Pt[][] {
  const out: Pt[][] = [];
  for (const blob of blobs(mask, w, h)) {
    if (blob.length < minArea) continue;
    // the outer loop is the one through the blob's first pixel's top-left corner (the topmost-leftmost corner)
    const first = Math.min(...blob);
    const fx = first % w;
    const fy = (first - fx) / w;
    const outer = loops(blob, w).find((l) => l.some(([x, y]) => x === fx && y === fy));
    if (!outer || outer.length < 3) continue;
    let far = 0;
    let fd = -1;
    outer.forEach(([x, y], i) => {
      const d = (x - outer[0][0]) ** 2 + (y - outer[0][1]) ** 2;
      if (d > fd) {
        fd = d;
        far = i;
      }
    });
    const a = simplify(outer.slice(0, far + 1), tol);
    const b = simplify([...outer.slice(far), outer[0]], tol);
    const poly = [...a.slice(0, -1), ...b.slice(0, -1)];
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}
