/** Small deterministic helpers used to author scenes procedurally from data. */

/** Deterministic hash → [0,1). Same input, same world, on server and client. */
export function hash2(x: number, y: number, seed = 1): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class TileCanvas {
  readonly rows: string[][];
  constructor(
    readonly width: number,
    readonly height: number,
    fill: string,
  ) {
    this.rows = Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
  }
  get(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return ' ';
    return this.rows[y][x];
  }
  set(x: number, y: number, c: string): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.rows[y][x] = c;
  }
  rect(x0: number, y0: number, w: number, h: number, c: string): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
  }
  /** L-shaped path: first along x, then along y. Never paves water. */
  path(ax: number, ay: number, bx: number, by: number, c = 'p', width = 1): void {
    const sx = Math.sign(bx - ax) || 1;
    const sy = Math.sign(by - ay) || 1;
    for (let x = ax; x !== bx + sx; x += sx) for (let k = 0; k < width; k++) this.pave(x, ay + k, c);
    for (let y = ay; y !== by + sy; y += sy) for (let k = 0; k < width; k++) this.pave(bx + k, y, c);
  }
  /**
   * A winding footpath through `pts` (a smooth Catmull-Rom curve, not an L): every tile whose centre lies
   * within `width / 2` of the curve. Never paves water, the pier or a street (a trail runs up to them).
   */
  trail(pts: Array<[number, number]>, c = 't', width = 1.6): void {
    const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    const r = width / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      const steps = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 6);
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const u2 = u * u;
        const u3 = u2 * u;
        const cr = (a: number, b: number, c2: number, d: number) =>
          0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u2 + (-a + 3 * b - 3 * c2 + d) * u3);
        const x = cr(p0[0], p1[0], p2[0], p3[0]);
        const y = cr(p0[1], p1[1], p2[1], p3[1]);
        for (let ty = Math.floor(y - r); ty <= Math.ceil(y + r); ty++)
          for (let tx = Math.floor(x - r); tx <= Math.ceil(x + r); tx++) {
            if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > r) continue;
            if (this.get(tx, ty) === 'p') continue;
            this.pave(tx, ty, c);
          }
      }
    }
  }
  private pave(x: number, y: number, c: string) {
    const cur = this.get(x, y);
    if (cur === 'w' || cur === 'W' || cur === 'd' || cur === 'P') return;
    this.set(x, y, c);
  }
  toStrings(): string[] {
    return this.rows.map((r) => r.join(''));
  }
}
