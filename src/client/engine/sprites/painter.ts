/**
 * IsoPainter: draws isometric primitives into an offscreen canvas at art resolution
 * (1 tile = 32×16 px), then "crispens" it into pixel art (hard alpha + ink outline).
 *
 * Local space: x/y in tiles relative to the sprite's footprint origin, z in art pixels.
 * All placeholder art in Minglewood is generated this way; professional art can replace any
 * sprite key later without touching the engine.
 */
import { darken, hexToRgb, INK, lighten } from './color';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Pixel in the canvas that corresponds to the footprint origin (tile x0,y0 at z=0). */
  ax: number;
  ay: number;
  /** Alpha mask for pixel-accurate hit testing. */
  mask: Uint8Array;
  /** Pre-rendered hover highlight (bright outline). */
  highlight?: HTMLCanvasElement;
  /** Canvas pixels per art pixel: 1 for classic sprites, 2 for the hi-res art (64 px per floor tile). */
  scale?: number;
  /** Drawn as the mirror of its partner rotation (art.ts). */
  mirrored?: boolean;
  /** The art drawing it was made from (art.ts), for per-drawing animation points. */
  file?: string;
  /** What lights up at night (lit windows, lanterns), same size and anchor as the canvas. */
  glow?: HTMLCanvasElement;
  /** Points (canvas px) that give off smoke, spray, a blinking beacon or a lighthouse beam. */
  emitters?: Array<{ kind: 'smoke' | 'spray' | 'blink' | 'beam'; x: number; y: number }>;
}

/** Draws a sprite with its anchor at art-space (x, y), at its own pixel density. */
export function blit(c: CanvasRenderingContext2D, s: Sprite, x: number, y: number, canvas: HTMLCanvasElement = s.canvas, inset = 0) {
  const k = s.scale ?? 1;
  c.drawImage(canvas, x - (s.ax + inset) / k, y - (s.ay + inset) / k, canvas.width / k, canvas.height / k);
}

/** Sprite size in art pixels. */
export function spriteSize(s: Sprite): { w: number; h: number } {
  const k = s.scale ?? 1;
  return { w: s.canvas.width / k, h: s.canvas.height / k };
}

export type P3 = [number, number, number];

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export class IsoPainter {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly ox: number;
  readonly oy: number;

  /** `scale` 2 paints at the hi-res density (64 px per floor tile) while coordinates stay in art px. */
  constructor(fw: number, fd: number, height: number, pad = 3, extraW = 0, readonly scale = 1) {
    const w = (fw + fd) * 16 + pad * 2 + extraW * 2;
    const h = (fw + fd) * 8 + height + pad * 2;
    this.canvas = makeCanvas(w * scale, h * scale);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(scale, scale);
    this.ox = fd * 16 + pad + extraW;
    this.oy = height + pad;
  }

  p(x: number, y: number, z = 0): [number, number] {
    return [this.ox + (x - y) * 16, this.oy + (x + y) * 8 - z];
  }

  poly(points: P3[], fill: string) {
    const c = this.ctx;
    c.beginPath();
    points.forEach(([x, y, z], i) => {
      const [sx, sy] = this.p(x, y, z);
      if (i === 0) c.moveTo(sx, sy);
      else c.lineTo(sx, sy);
    });
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }

  /** Axis-aligned iso box with automatic face shading. */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    color: string,
    o: { top?: string; left?: string; right?: string } = {},
  ) {
    const top = o.top ?? lighten(color, 0.14);
    const left = o.left ?? color;
    const right = o.right ?? darken(color, 0.18);
    if (h > 0) {
      this.poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], left);
      this.poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], right);
    }
    this.poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], top);
  }

  /** Rectangle on a vertical face. face 'left' = plane y=plane (u runs along x), 'right' = plane x=plane (u along y). */
  faceRect(face: 'left' | 'right', plane: number, u: number, z: number, du: number, dz: number, fill: string) {
    if (face === 'left') this.poly([[u, plane, z], [u + du, plane, z], [u + du, plane, z + dz], [u, plane, z + dz]], fill);
    else this.poly([[plane, u, z], [plane, u + du, z], [plane, u + du, z + dz], [plane, u, z + dz]], fill);
  }

  /** Iso circle on a horizontal plane. */
  ellipse(cx: number, cy: number, z: number, r: number, fill: string) {
    const [sx, sy] = this.p(cx, cy, z);
    const c = this.ctx;
    c.beginPath();
    c.ellipse(sx, sy, r * 16 * Math.SQRT2, r * 8 * Math.SQRT2, 0, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
  }

  /** Upright cylinder. */
  cylinder(cx: number, cy: number, z: number, r: number, h: number, color: string, topColor?: string) {
    const [sx, sy] = this.p(cx, cy, z);
    const rx = r * 16 * Math.SQRT2;
    const ry = r * 8 * Math.SQRT2;
    const c = this.ctx;
    const g = c.createLinearGradient(sx - rx, 0, sx + rx, 0);
    g.addColorStop(0, lighten(color, 0.1));
    g.addColorStop(0.55, color);
    g.addColorStop(1, darken(color, 0.25));
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(sx, sy, rx, ry, 0, 0, Math.PI);
    c.lineTo(sx - rx, sy - h);
    c.ellipse(sx, sy - h, rx, ry, 0, Math.PI, 0, true);
    c.closePath();
    c.fill();
    c.fillStyle = topColor ?? lighten(color, 0.15);
    c.beginPath();
    c.ellipse(sx, sy - h, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
  }

  /** Raw screen-space pixel rect relative to the footprint origin projection of (x,y,z). */
  px(x: number, y: number, z: number, dx: number, dy: number, w: number, h: number, fill: string) {
    const [sx, sy] = this.p(x, y, z);
    const k = this.scale;
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(Math.round((sx + dx) * k) / k, Math.round((sy + dy) * k) / k, w, h);
  }

  finish(opts: { outline?: boolean; outlineColor?: string } = {}): Sprite {
    const s = finishSprite(this.canvas, this.ox * this.scale, this.oy * this.scale, opts);
    if (this.scale !== 1) s.scale = this.scale;
    return s;
  }
}

/** Hard alpha + optional 1px outline, and build the hit mask / highlight. */
export function finishSprite(
  canvas: HTMLCanvasElement,
  ax: number,
  ay: number,
  opts: { outline?: boolean; outlineColor?: string } = {},
): Sprite {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
  if (opts.outline !== false) {
    const [or, og, ob] = hexToRgb(opts.outlineColor ?? INK);
    const solid = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] ? 1 : 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        const n =
          (x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w]);
        if (n) {
          d[i * 4] = or;
          d[i * 4 + 1] = og;
          d[i * 4 + 2] = ob;
          d[i * 4 + 3] = 235;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] ? 1 : 0;
  return { canvas, ax, ay, mask };
}

/** Lazily builds a highlighted copy: sprite brightened with a warm glow outline. */
export function highlightOf(s: Sprite): HTMLCanvasElement {
  if (s.highlight) return s.highlight;
  const { width: w, height: h } = s.canvas;
  const c = makeCanvas(w + 4, h + 4);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(s.canvas, 2, 2);
  const img = ctx.getImageData(0, 0, w + 4, h + 4);
  const d = img.data;
  const W = w + 4;
  const solid = new Uint8Array(W * (h + 4));
  for (let i = 0; i < solid.length; i++) solid[i] = d[i * 4 + 3] ? 1 : 0;
  for (let y = 0; y < h + 4; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (solid[i]) {
        d[i * 4] = Math.min(255, d[i * 4] + 28);
        d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] + 24);
        d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] + 12);
        continue;
      }
      let n = false;
      for (let k = 1; k <= 2 && !n; k++) {
        n =
          (x >= k && !!solid[i - k]) ||
          (x < W - k && !!solid[i + k]) ||
          (y >= k && !!solid[i - k * W]) ||
          (y < h + 4 - k && !!solid[i + k * W]);
      }
      if (n) {
        d[i * 4] = 255;
        d[i * 4 + 1] = 236;
        d[i * 4 + 2] = 140;
        d[i * 4 + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  s.highlight = c;
  return c;
}

/** Deterministic per-sprite noise. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
