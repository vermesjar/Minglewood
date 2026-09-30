/** Small raster helpers for review sheets (scripts/seat-grade.ts): plot, rectangles, lines, pasting, stacking. */
import { blank, type Img } from './png';

export type RGB = [number, number, number];

export function plot(img: Img, x: number, y: number, c: RGB, a = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.d[i] = Math.round(img.d[i] * (1 - a) + c[0] * a);
  img.d[i + 1] = Math.round(img.d[i + 1] * (1 - a) + c[1] * a);
  img.d[i + 2] = Math.round(img.d[i + 2] * (1 - a) + c[2] * a);
  img.d[i + 3] = 255;
}

export function rect(img: Img, x: number, y: number, w: number, h: number, c: RGB, a = 1) {
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) plot(img, x + u, y + v, c, a);
}

export function line(img: Img, x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1, dash = 0) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    if (dash && Math.floor(i / dash) % 2) continue;
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    for (let v = 0; v < t; v++) for (let u = 0; u < t; u++) plot(img, x + u - (t >> 1), y + v - (t >> 1), c);
  }
}

/** Paste RGBA pixels at (x, y), each pixel s × s, over whatever is there (transparent pixels skipped). */
export function paste(img: Img, src: { w: number; h: number; d: ArrayLike<number> }, x: number, y: number, s = 1) {
  for (let v = 0; v < src.h; v++)
    for (let u = 0; u < src.w; u++) {
      const i = (v * src.w + u) * 4;
      if (!src.d[i + 3]) continue;
      rect(img, x + u * s, y + v * s, s, s, [src.d[i], src.d[i + 1], src.d[i + 2]]);
    }
}

/** Stack images top to bottom. */
export function stack(blocks: Img[], bg: RGB = [24, 20, 30], gap = 6): Img {
  const W = Math.max(...blocks.map((b) => b.w));
  const H = blocks.reduce((s, b) => s + b.h + gap, 0);
  const sheet = blank(W, H, bg, 255);
  let y = 0;
  for (const b of blocks) {
    paste(sheet, b, 0, y);
    y += b.h + gap;
  }
  return sheet;
}

/** Lay images left to right. */
export function row(blocks: Img[], bg: RGB = [24, 20, 30], gap = 12): Img {
  const W = blocks.reduce((s, b) => s + b.w + gap, 0);
  const H = Math.max(...blocks.map((b) => b.h));
  const out = blank(W, H, bg, 255);
  let x = 0;
  for (const b of blocks) {
    paste(out, b, x, 0);
    x += b.w + gap;
  }
  return out;
}

/** An image scaled up by an integer factor (nearest neighbour). */
export function scaled(src: Img, s: number): Img {
  const out = blank(src.w * s, src.h * s, [0, 0, 0], 0);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const i = (Math.floor(y / s) * src.w + Math.floor(x / s)) * 4;
      const o = (y * out.w + x) * 4;
      for (let k = 0; k < 4; k++) out.d[o + k] = src.d[i + k];
    }
  return out;
}
