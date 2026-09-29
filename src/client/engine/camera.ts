/** 2D camera over art space. `zoom` = CSS pixels per art pixel. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 2;
  tx = 0;
  ty = 0;
  tzoom = 2;
  minZoom = 1;
  maxZoom = 4;
  bounds = { l: -1000, t: -1000, r: 1000, b: 1000 };
  lastManual = 0;
  /**
   * Zoom levels at which art pixels land on whole device pixels (e.g. 2/dpr for 64-px-per-tile art).
   * When set, zooming steps between these levels so pixel art never scales unevenly.
   */
  pixelStep = 0;

  /** The pixel-perfect zoom nearest to z (rounded down), never below one step. */
  snap(z: number): number {
    if (!this.pixelStep) return z;
    return Math.max(this.pixelStep, Math.floor(z / this.pixelStep + 1e-6) * this.pixelStep);
  }

  toScreen(ax: number, ay: number, vw: number, vh: number): [number, number] {
    return [(ax - this.x) * this.zoom + vw / 2, (ay - this.y) * this.zoom + vh / 2];
  }

  toWorld(sx: number, sy: number, vw: number, vh: number): [number, number] {
    return [(sx - vw / 2) / this.zoom + this.x, (sy - vh / 2) / this.zoom + this.y];
  }

  jump(x: number, y: number, zoom = this.zoom) {
    this.x = this.tx = x;
    this.y = this.ty = y;
    this.zoom = this.tzoom = zoom;
    this.clamp();
  }

  panTo(x: number, y: number) {
    this.tx = x;
    this.ty = y;
  }

  panBy(dx: number, dy: number) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.tx = this.x;
    this.ty = this.y;
    this.lastManual = performance.now();
    this.clamp();
  }

  zoomAt(factor: number, sx: number, sy: number, vw: number, vh: number) {
    let nz = Math.max(this.minZoom, Math.min(this.maxZoom, this.tzoom * factor));
    if (this.pixelStep) {
      const k = this.tzoom / this.pixelStep;
      nz = (factor > 1 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) * this.pixelStep;
      nz = Math.max(this.snap(this.minZoom) || this.pixelStep, Math.min(this.snap(this.maxZoom), nz));
    }
    const [wx, wy] = this.toWorld(sx, sy, vw, vh);
    this.tzoom = nz;
    // keep the point under the cursor fixed once zoom settles
    this.tx = wx - (sx - vw / 2) / nz;
    this.ty = wy - (sy - vh / 2) / nz;
    this.lastManual = performance.now();
  }

  update(dt: number, reducedMotion: boolean) {
    const k = reducedMotion ? 1 : 1 - Math.pow(0.0008, dt);
    this.zoom += (this.tzoom - this.zoom) * k;
    // Land exactly on the target so pixel art settles on whole pixels.
    if (Math.abs(this.tzoom - this.zoom) < 0.003) this.zoom = this.tzoom;
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.clamp();
  }

  private clamp() {
    const b = this.bounds;
    this.x = Math.max(b.l, Math.min(b.r, this.x));
    this.y = Math.max(b.t, Math.min(b.b, this.y));
    this.tx = Math.max(b.l, Math.min(b.r, this.tx));
    this.ty = Math.max(b.t, Math.min(b.b, this.ty));
  }
}
