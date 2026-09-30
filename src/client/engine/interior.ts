/**
 * Interior shell renderer at 2× density (64 px per floor tile). Floors, walls, wall caps and the floor
 * slab are rasterized per pixel, so every edge is a clean 2:1 pixel staircase — no smeared vector edges.
 * Walls are painted as flat textures (u along the wall, v up it) and sheared onto the wall plane pixel for
 * pixel, which keeps boards, frames and windows crisp. Window glass is left transparent: WorldView paints
 * the live view outside (sky, weather) underneath. A separate light layer holds sunlight patches and lamp
 * pools so they can follow the weather without re-rendering the room.
 */
import { hash2 } from '@shared/world/builders';
import { isoToScreen, screenToIso } from '@shared/iso';
import type { InteriorTheme, SceneDef, SceneObject } from '@shared/world/scene';
import { footprint } from '@shared/world/scene';
import { hexToRgb } from './sprites/color';
import { makeCanvas } from './sprites/painter';
import { rugTexture } from './sprites/furniture';
import { artLight, wallArt } from './sprites/art';
import { drawWallItem, WALL_H, type GroundLayer, type InteriorRenderContext, type WallHit } from './ground';

/** Canvas px per art px. */
export const SHELL_SCALE = 2;
const S = SHELL_SCALE;
/** Wall texture density: px per tile along the wall, px per art px up the wall. */
const TU = 16 * S;
const TV = S;
const THICK = 0.25;
const SLAB = 7;

type RGB = [number, number, number];
const C = (hex: string): RGB => hexToRgb(hex);
const mul = ([r, g, b]: RGB, k: number): RGB => [r * k, g * k, b * k];
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const PLUM: RGB = [42, 29, 51];
const CREAM: RGB = [255, 248, 236];
const dark = (c: RGB, t: number) => mixc(c, PLUM, t);
const light = (c: RGB, t: number) => mixc(c, CREAM, t);
const frac = (v: number) => v - Math.floor(v);

export interface WindowView {
  face: 'left' | 'right';
  /** Glass rectangle in wall space: u in tiles along the wall, v in art px above the floor. */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export interface LampLight {
  id: string;
  x: number;
  y: number;
  /** This lamp's warm pool on the floor (screen-blended while the lamp is on). */
  pool: HTMLCanvasElement;
  /** Art-space position of the pool canvas's top-left corner. */
  ax: number;
  ay: number;
}

export interface InteriorLayer extends GroundLayer {
  scale: number;
  /** Sunlight through the windows, drawn with 'screen' at weather-dependent strength. */
  sun: HTMLCanvasElement;
  windows: WindowView[];
  lamps: LampLight[];
}

/* ------------------------------------------------------------------ floors */

interface FloorSample {
  id: number;
  rgb: RGB;
}

function floorSample(t: InteriorTheme, gx: number, gy: number, px: number, py: number): FloorSample {
  const a = C(t.floor);
  const b = C(t.floorAlt);
  const tx = Math.floor(gx);
  const ty = Math.floor(gy);
  switch (t.floorPattern) {
    case 'planks': {
      // Three boards per tile running along x, staggered joints, per-board tone, broken grain.
      const row = Math.floor(gy * 3);
      const off = hash2(row, 11, 3) * 2.3;
      const len = 1.6 + hash2(row, 5, 9) * 1.4;
      const seg = Math.floor((gx + off) / len);
      const h = hash2(row, seg, 21);
      let rgb = mixc(a, b, h * 0.55);
      rgb = mul(rgb, 0.95 + hash2(seg, row, 4) * 0.09);
      const across = frac(gy * 3);
      const along = (gx + off) / len - seg;
      const g1 = 0.3 + hash2(row, seg, 7) * 0.4;
      if (Math.abs(across - g1) < 0.07 && hash2(Math.floor(along * 9), row + seg * 7, 2) > 0.35) rgb = dark(rgb, 0.1);
      if (Math.abs(across - g1 - 0.22) < 0.05 && hash2(Math.floor(along * 6), row, 8) > 0.6) rgb = dark(rgb, 0.06);
      // a whisper of polish near the board's lit edge
      if (across > 0.8) rgb = light(rgb, 0.05);
      return { id: row * 4096 + seg, rgb };
    }
    case 'checker': {
      const odd = (tx + ty) % 2 !== 0;
      let rgb = odd ? a : b;
      const fx = frac(gx);
      const fy = frac(gy);
      if (fx < 0.14 && fy < 0.14) rgb = light(rgb, 0.22); // glaze glint at the lit corner
      else if (fx + fy < 0.5) rgb = light(rgb, 0.06);
      return { id: tx * 4096 + ty, rgb };
    }
    case 'tiles': {
      let rgb = mul(a, 0.97 + hash2(tx, ty, 3) * 0.05);
      if (hash2(Math.floor(gx * 14), Math.floor(gy * 14), 5) > 0.93) rgb = hash2(px, py, 1) > 0.5 ? dark(b, 0.05) : light(a, 0.25); // terrazzo chips
      if (frac(gx) < 0.1 && frac(gy) < 0.1) rgb = light(rgb, 0.12);
      return { id: tx * 4096 + ty, rgb };
    }
    case 'carpet':
    default: {
      // Low-contrast woven texture with a twill diagonal.
      let rgb = a;
      if ((px + py * 2) % 6 === 0) rgb = light(rgb, 0.05);
      else if ((px + py * 2) % 6 === 3) rgb = dark(rgb, 0.05);
      if (hash2(px >> 2, py >> 1, 9) > 0.965) rgb = mixc(rgb, b, 0.5);
      return { id: 0, rgb };
    }
  }
}

function seamColor(t: InteriorTheme, base: RGB): RGB {
  switch (t.floorPattern) {
    case 'planks':
      return dark(C(t.floorAlt), 0.25);
    case 'checker':
    case 'tiles':
      return light(mixc(C(t.floor), C(t.floorAlt), 0.5), 0.35);
    default:
      return base;
  }
}

/* ------------------------------------------------------------------ rugs */

interface Rug {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  base: RGB;
  border: RGB;
  accent: RGB;
  logo: boolean;
}

/** Distance from the centre to the edge of a five-pointed star along the direction `theta` (0 = a point). */
function starRadius(theta: number, R: number, Ri: number): number {
  const step = Math.PI / 5;
  const t = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const k = Math.floor(t / step);
  const [r0, r1] = k % 2 === 0 ? [R, Ri] : [Ri, R];
  const x0 = r0 * Math.sin(k * step);
  const y0 = r0 * Math.cos(k * step);
  const ex = r1 * Math.sin((k + 1) * step) - x0;
  const ey = r1 * Math.cos((k + 1) * step) - y0;
  const dx = Math.sin(t);
  const dy = Math.cos(t);
  return (x0 * ey - y0 * ex) / (dx * ey - dy * ex);
}

function rugColor(r: Rug, gx: number, gy: number, px: number): RGB | null {
  const inset = 0.1;
  const x0 = r.x0 + inset;
  const x1 = r.x1 - inset;
  const y0 = r.y0 + inset;
  const y1 = r.y1 - inset;
  // Fringe on the short ends (along x).
  if (gy >= y0 + 0.08 && gy <= y1 - 0.08 && ((gx >= x0 - 0.1 && gx < x0) || (gx > x1 && gx <= x1 + 0.1)))
    return px % 3 === 0 ? null : light(r.accent, 0.4);
  if (gx < x0 || gx > x1 || gy < y0 || gy > y1) return null;
  const d = Math.min(gx - x0, x1 - gx, gy - y0, y1 - gy);
  if (d < 0.05) return dark(r.border, 0.25);
  if (d < 0.24) {
    // border band with a running motif
    if (d > 0.11 && d < 0.14) return r.accent;
    const along = gx - x0 + (gy - y0);
    return frac(along * 3) < 0.5 && d > 0.15 && d < 0.21 ? mixc(r.border, r.accent, 0.35) : r.border;
  }
  if (d < 0.27) return dark(r.base, 0.2);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const nx = (gx - cx) / ((x1 - x0) / 2);
  const ny = (gy - cy) / ((y1 - y0) / 2);
  const m = Math.abs(nx) + Math.abs(ny);
  if (r.logo) {
    // The company star, lying flat on the floor with a point toward the back wall, inside a thin gold ring.
    const dx = gx - cx;
    const dy = gy - cy;
    const pp = (dx - dy) / Math.SQRT2;
    const qq = -(dx + dy) / Math.SQRT2;
    const rr = Math.hypot(pp, qq);
    const R = Math.min(x1 - x0, y1 - y0) * 0.3;
    const edge = starRadius(Math.atan2(pp, qq), R, R * 0.42);
    if (rr < edge) return rr > edge - 0.07 ? dark(r.accent, 0.25) : rr < edge * 0.35 ? light(r.accent, 0.2) : r.accent;
    if (Math.abs(rr - R * 1.22) < 0.035) return r.accent;
  } else {
    if (m < 0.34) return m > 0.28 ? r.border : m < 0.12 ? r.accent : light(r.base, 0.12);
    if (m > 0.4 && m < 0.44) return mixc(r.base, r.accent, 0.45);
  }
  // quiet lattice in the field
  const la = frac((gx - x0) * 2 + (gy - y0) * 2);
  const lb = frac((gx - x0) * 2 - (gy - y0) * 2);
  if (la < 0.05 || lb < 0.05) return dark(r.base, 0.08);
  return r.base;
}

/* ------------------------------------------------------------------ walls */

function wallTexture(scene: SceneDef, face: 'left' | 'right', rc: InteriorRenderContext, hits: WallHit[], windows: WindowView[]): HTMLCanvasElement {
  const theme = rc.theme;
  const len = face === 'right' ? scene.width : scene.height;
  const canvas = makeCanvas(len * TU, WALL_H * TV);
  const c = canvas.getContext('2d')!;
  // (u tiles, v art px up from the floor)
  c.setTransform(TU, 0, 0, -TV, 0, WALL_H * TV);
  const px = 1 / TU; // one texture pixel, in u
  const vp = 1 / TV; // one texture pixel, in v
  const wall = theme.wall;
  const trim = theme.trim;
  const R = (u: number, v: number, du: number, dv: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(u, v, du, dv);
  };
  const hex = (rgb: RGB) => `rgb(${rgb.map((n) => Math.round(Math.max(0, Math.min(255, n)))).join(',')})`;
  const W = C(wall);
  const T = C(trim);
  const lower = mixc(W, T, 0.28);

  // Upper wall: plaster/wallpaper with a soft pinstripe.
  R(0, 0, len, WALL_H, hex(W));
  for (let u = 0; u < len; u += 0.25) R(u + 0.12, 26, px, WALL_H - 30, hex(dark(W, 0.05)));
  for (let u = 0; u < len; u += 0.5)
    for (let v = 30; v < WALL_H - 6; v += 8) R(u + 0.24 + ((v / 8) % 2) * 0.25, v, px * 2, vp * 2, hex(light(W, 0.25)));
  // Wainscot with raised panels.
  R(0, 4, len, 21, hex(lower));
  for (let u = 0; u < len; u += 0.5) {
    R(u + 0.06, 8, 0.38, 13, hex(light(lower, 0.08)));
    R(u + 0.06, 20.5, 0.38, vp, hex(light(lower, 0.3)));
    R(u + 0.06, 8, px, 13, hex(light(lower, 0.25)));
    R(u + 0.44 - px, 8, px, 13, hex(dark(lower, 0.22)));
    R(u + 0.06, 8, 0.38, vp, hex(dark(lower, 0.25)));
  }
  // Chair rail, baseboard, crown.
  R(0, 25, len, 2, hex(T));
  R(0, 27 - vp, len, vp, hex(light(T, 0.35)));
  R(0, 0, len, 4.5, hex(dark(T, 0.1)));
  R(0, 4.5 - vp, len, vp, hex(light(T, 0.3)));
  R(0, WALL_H - 4, len, 4, hex(T));
  R(0, WALL_H - 4, len, vp, hex(dark(T, 0.3)));
  R(0, WALL_H - 1, len, vp, hex(light(T, 0.3)));

  // Wall-mounted things.
  for (const o of scene.objects) {
    if (o.wall !== face) continue;
    if (o.eventDecor && !rc.activeDecor.has(o.eventDecor)) continue;
    const u0 = face === 'right' ? o.x : o.y;
    const span = face === 'right' ? (o.w ?? 1) : (o.d ?? o.w ?? 1);
    const range = paintWallPiece(c, o, face, u0, span, rc, windows);
    // what you can click: anything with something to do, and (in decorate mode) a team's own pieces
    if ((o.actions?.length || o.id.startsWith('decor-')) && range[1] > range[0]) {
      const pt = (u: number, v: number): [number, number] => (face === 'right' ? [u * 16, u * 8 - v] : [-u * 16, u * 8 - v]);
      hits.push({ obj: o, poly: [pt(u0, range[0]), pt(u0 + span, range[0]), pt(u0 + span, range[1]), pt(u0, range[1])] });
    }
  }
  return canvas;
}

/**
 * Paint one wall piece into a wall texture (u tiles, v wall units: the transform wallTexture sets) over the span
 * [u0, u0 + span); returns the v range it covers. Wall art hangs by THE WALL ART STANDARD (models.ts wallFit): its
 * drawing at exactly 2:1, one drawing px to one texture px, centred in its span.
 */
function paintWallPiece(
  c: CanvasRenderingContext2D,
  o: SceneObject,
  face: 'left' | 'right',
  u0: number,
  span: number,
  rc: InteriorRenderContext,
  windows: WindowView[],
): [number, number] {
  const art = wallArt(o);
  // The left wall's texture runs right-to-left on screen (u grows toward the viewer's left), so anything
  // hung there is drawn mirrored about its own span: pictures, signs and text read the right way round on
  // both walls, from one drawing.
  const readable = (draw: () => [number, number]): [number, number] => {
    if (face !== 'left') return draw();
    c.save();
    c.transform(-1, 0, 0, 1, 2 * u0 + span, 0);
    const r = draw();
    c.restore();
    return r;
  };
  if (o.sprite === 'window') return drawWindow(c, u0, span, rc.theme, windows, face);
  if (o.sprite === 'door') return drawDoor(c, u0, rc.theme);
  if (art) {
    const [v0, v1] = art.v;
    return readable(() => {
      c.save();
      c.translate(u0 + art.margin, v1);
      // exactly 1/TU tile and 1/TV unit per drawing px: the texture's own grid, so no pixel column is ever dropped
      c.scale(art.width / art.img.width, -(v1 - v0) / art.img.height);
      c.imageSmoothingEnabled = false;
      c.drawImage(art.img, 0, 0);
      c.restore();
      return [v0, v1];
    });
  }
  return readable(() => drawWallItem(c, o, u0, span, rc));
}

/**
 * One wall piece on its own, drawn exactly as the wall paints it (for decorate mode's ghost and palette): a
 * transparent texture `span` tiles long and the wall's height, TU px per tile and TV per wall unit, u = 0 at the
 * span's start, as it lies in `face`'s texture (mirrored on the left, like the wall). A window's glass shows sky.
 * Draw it onto a wall with wallPieceTransform.
 */
export function wallPieceImage(o: SceneObject, face: 'left' | 'right', rc: InteriorRenderContext): { canvas: HTMLCanvasElement; range: [number, number] } {
  const span = face === 'right' ? (o.w ?? 1) : (o.d ?? o.w ?? 1);
  const canvas = makeCanvas(span * TU, WALL_H * TV);
  const c = canvas.getContext('2d')!;
  c.setTransform(TU, 0, 0, -TV, 0, WALL_H * TV);
  const glass: WindowView[] = [];
  const range = paintWallPiece(c, o, face, 0, span, rc, glass);
  c.globalCompositeOperation = 'destination-over';
  for (const g of glass) {
    const sky = c.createLinearGradient(0, g.v1, 0, g.v0);
    sky.addColorStop(0, '#bfe6ff');
    sky.addColorStop(1, '#eaf7ff');
    c.fillStyle = sky;
    c.fillRect(g.u0, g.v0, g.u1 - g.u0, g.v1 - g.v0);
  }
  return { canvas, range };
}

/** The art-space transform that lays a wallPieceImage on `face` with its span starting at u0 (the shell's own mapping). */
export function wallPieceTransform(face: 'left' | 'right', u0: number): [number, number, number, number, number, number] {
  // texture px (tx, ty) → u = u0 + tx/TU along the wall, v = WALL_H − ty/TV up it → art (±16u, 8u − v)
  return face === 'right' ? [16 / TU, 8 / TU, 0, 1 / TV, 16 * u0, 8 * u0 - WALL_H] : [-16 / TU, 8 / TU, 0, 1 / TV, -16 * u0, 8 * u0 - WALL_H];
}

/** A recessed window with frame, sill and mullions; the glass is cut out for the live view. */
function drawWindow(c: CanvasRenderingContext2D, u0: number, span: number, theme: InteriorTheme, windows: WindowView[], face: 'left' | 'right'): [number, number] {
  const px = 1 / TU;
  const frame = '#f7efe0';
  const frameDark = '#cdbfa6';
  const g0 = u0 + 0.16;
  const g1 = u0 + span - 0.16;
  const v0 = 18;
  const v1 = 47;
  // outer casing and a trim-colored surround
  c.fillStyle = theme.trim;
  c.fillRect(u0 + 0.06, v0 - 3.5, span - 0.12, v1 - v0 + 6);
  c.fillStyle = frame;
  c.fillRect(u0 + 0.09, v0 - 2, span - 0.18, v1 - v0 + 3.5);
  c.fillStyle = frameDark;
  c.fillRect(u0 + 0.09, v0 - 2, span - 0.18, 0.5);
  // sill
  c.fillStyle = frame;
  c.fillRect(u0 + 0.02, v0 - 5, span - 0.04, 2.5);
  c.fillStyle = frameDark;
  c.fillRect(u0 + 0.02, v0 - 5, span - 0.04, 0.5);
  c.fillStyle = '#ffffff';
  c.fillRect(u0 + 0.02, v0 - 3, span - 0.04, 0.5);
  // cut the glass
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fillRect(g0, v0, g1 - g0, v1 - v0);
  c.restore();
  // recess shadow on the top and the lit-side jamb
  c.fillStyle = 'rgba(60,40,50,0.35)';
  c.fillRect(g0, v1 - 2, g1 - g0, 2);
  c.fillRect(g0, v0, px * 2, v1 - v0);
  // mullions
  c.fillStyle = frame;
  const mid = (g0 + g1) / 2;
  c.fillRect(mid - px, v0, px * 2, v1 - v0);
  c.fillRect(g0, v0 + (v1 - v0) * 0.55, g1 - g0, 1);
  c.fillStyle = frameDark;
  c.fillRect(mid + px, v0, px, v1 - v0);
  // glass reflections
  c.fillStyle = 'rgba(255,255,255,0.28)';
  for (const [a, w] of [
    [0.18, 0.05],
    [0.3, 0.02],
  ] as const) {
    c.beginPath();
    const ua = g0 + (g1 - g0) * a;
    c.moveTo(ua, v1);
    c.lineTo(ua + w * span, v1);
    c.lineTo(ua + w * span - 0.25, v0 + 6);
    c.lineTo(ua - 0.25, v0 + 6);
    c.closePath();
    c.fill();
  }
  windows.push({ face, u0: g0, u1: g1, v0, v1 });
  return [v0 - 5, v1 + 3];
}

function drawDoor(c: CanvasRenderingContext2D, u0: number, theme: InteriorTheme): [number, number] {
  const px = 1 / TU;
  const wood = '#6b4230';
  const T = theme.trim;
  c.fillStyle = T;
  c.fillRect(u0 + 0.05, 0, 0.9, 41);
  c.fillStyle = '#fff4e0';
  c.fillRect(u0 + 0.05, 40, 0.9, 0.5);
  c.fillStyle = wood;
  c.fillRect(u0 + 0.12, 0, 0.76, 38);
  // two raised panels
  for (const [v, h] of [
    [4, 14],
    [21, 14],
  ] as const) {
    c.fillStyle = '#7d4f38';
    c.fillRect(u0 + 0.2, v, 0.6, h);
    c.fillStyle = '#9a6446';
    c.fillRect(u0 + 0.2, v + h - 0.5, 0.6, 0.5);
    c.fillRect(u0 + 0.2, v, px, h);
    c.fillStyle = '#4a2c20';
    c.fillRect(u0 + 0.8 - px, v, px, h);
    c.fillRect(u0 + 0.2, v, 0.6, 0.5);
  }
  // brass knob
  c.fillStyle = '#d99a2b';
  c.fillRect(u0 + 0.74, 18, px * 3, 2);
  c.fillStyle = '#ffe89a';
  c.fillRect(u0 + 0.74, 19.5, px, 0.5);
  // exit sign
  c.fillStyle = '#1f6b44';
  c.fillRect(u0 + 0.33, 43, 0.34, 5);
  c.fillStyle = '#7ff0b0';
  c.fillRect(u0 + 0.37, 44.5, 0.26, 2);
  return [0, 48];
}

/* ------------------------------------------------------------------ the shell */

export function renderInteriorShell(scene: SceneDef, rc: InteriorRenderContext): InteriorLayer {
  const theme = rc.theme;
  const { width: W, height: H } = scene;
  const minX = -H * 16 - THICK * 16 - 4;
  const maxX = W * 16 + THICK * 16 + 4;
  const minY = -WALL_H - THICK * 8 - 6;
  const maxY = (W + H) * 8 + SLAB + 4;
  const cw = Math.ceil((maxX - minX) * S);
  const ch = Math.ceil((maxY - minY) * S);
  const canvas = makeCanvas(cw, ch);
  const sunCanvas = makeCanvas(cw, ch);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const sunImg = sunCanvas.getContext('2d')!.createImageData(cw, ch);
  const sd = sunImg.data;

  const wallHits: WallHit[] = [];
  const windows: WindowView[] = [];
  const texR = wallTexture(scene, 'right', rc, wallHits, windows);
  const texL = wallTexture(scene, 'left', rc, wallHits, windows);
  const tdR = texR.getContext('2d')!.getImageData(0, 0, texR.width, texR.height).data;
  const tdL = texL.getContext('2d')!.getImageData(0, 0, texL.width, texL.height).data;

  const rugs: Rug[] = scene.objects
    .filter((o) => o.sprite === 'rug' && o.flat)
    .map((o) => {
      const f = footprint(o);
      const t = rugTexture(o.variant ?? '');
      return { ...f, base: C(t.base), border: C(t.border), accent: C(t.accent), logo: o.variant === 'logo' };
    });
  // Soft contact shadows: every standing thing sits on a little pool of plum shade, offset away from the light.
  const shadows = scene.objects
    .filter((o) => !o.wall && !o.flat && !(o.eventDecor && !rc.activeDecor.has(o.eventDecor)))
    .map((o) => {
      const f = footprint(o);
      const small = ['chair', 'stool', 'lamp', 'plant', 'speaker', 'easel'].includes(o.sprite);
      const k = small ? 0.62 : 0.92;
      return { cx: (f.x0 + f.x1) / 2 + 0.1, cy: (f.y0 + f.y1) / 2 + 0.06, rx: ((f.x1 - f.x0) / 2) * k, ry: ((f.y1 - f.y0) / 2) * k };
    });
  // Each lamp gets its own small pool canvas so it can be switched on and off on its own.
  const POOL = 2.8;
  const lampPools = scene.objects
    .filter((o) => o.sprite === 'lamp' || !!artLight(o))
    .map((o) => {
      const x = o.x + 0.5;
      const y = o.y + 0.5;
      const cxA = (x - y) * 16;
      const cyA = (x + y) * 8;
      const ax = cxA - POOL * 23;
      const ay = cyA - POOL * 12;
      const w = Math.ceil(POOL * 46 * S);
      const h = Math.ceil(POOL * 24 * S);
      const img = new ImageData(w, h);
      return { id: o.id, x, y, ax, ay, w, h, img };
    });
  // Sun patches: each window's light falls into the room as a parallelogram, split by the mullions.
  const patches = windows.map((w) => {
    const reach = 2.4;
    const skew = 0.9;
    return { w, reach, skew };
  });

  const tint: Record<InteriorTheme['ambient'], [RGB, number] | null> = {
    warm: [[255, 200, 140], 0.07],
    bright: null,
    dim: [[60, 80, 50], 0.1],
    neon: [[130, 70, 210], 0.12],
    festive: [[255, 160, 200], 0.05],
  };
  const amb = tint[theme.ambient];

  const put = (i: number, rgb: RGB, a = 255) => {
    let c = rgb;
    if (amb) c = mixc(c, amb[0], amb[1]);
    d[i] = Math.max(0, Math.min(255, c[0]));
    d[i + 1] = Math.max(0, Math.min(255, c[1]));
    d[i + 2] = Math.max(0, Math.min(255, c[2]));
    d[i + 3] = a;
  };
  const inFloor = (gx: number, gy: number) => gx >= 0 && gy >= 0 && gx < W && gy < H;
  const at = (px: number, py: number) => {
    const ax = minX + (px + 0.5) / S;
    const ay = minY + (py + 0.5) / S;
    return screenToIso(ax, ay);
  };
  const idAt = (px: number, py: number) => {
    const g = at(px, py);
    return inFloor(g.x, g.y) ? floorSample(theme, g.x, g.y, px, py).id : -1;
  };

  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const i = (py * cw + px) * 4;
      const ax = minX + (px + 0.5) / S;
      const ay = minY + (py + 0.5) / S;
      const g = screenToIso(ax, ay);
      if (inFloor(g.x, g.y)) {
        const fs = floorSample(theme, g.x, g.y, px, py);
        let rgb = fs.rgb;
        if (theme.floorPattern !== 'carpet') {
          const up = idAt(px, py - 1);
          const left = idAt(px - 1, py);
          if ((up !== -1 && up !== fs.id) || (left !== -1 && left !== fs.id)) rgb = seamColor(theme, rgb);
        }
        for (const r of rugs) {
          const rc2 = rugColor(r, g.x, g.y, px);
          if (rc2) rgb = rc2;
        }
        // ambient occlusion along the back walls, in three hard steps
        const ao = Math.min(g.x, g.y);
        if (ao < 0.12) rgb = dark(rgb, 0.3);
        else if (ao < 0.3) rgb = dark(rgb, 0.17);
        else if (ao < 0.55) rgb = dark(rgb, 0.07);
        for (const s of shadows) {
          const e = ((g.x - s.cx) / s.rx) ** 2 + ((g.y - s.cy) / s.ry) ** 2;
          if (e < 1) rgb = dark(rgb, e < 0.55 ? 0.24 : 0.14);
          else if (e < 1.4) rgb = dark(rgb, 0.06);
        }
        put(i, rgb);
        // light layers (floor only)
        for (const l of lampPools) {
          const r = Math.hypot(g.x - l.x, g.y - l.y);
          const a = r < 0.8 ? 120 : r < 1.5 ? 80 : r < 2.2 ? 46 : r < POOL ? 20 : 0;
          if (!a) continue;
          const lx = Math.floor((ax - l.ax) * S);
          const ly = Math.floor((ay - l.ay) * S);
          if (lx < 0 || ly < 0 || lx >= l.w || ly >= l.h) continue;
          const k = (ly * l.w + lx) * 4;
          l.img.data[k] = 255;
          l.img.data[k + 1] = 196;
          l.img.data[k + 2] = 120;
          l.img.data[k + 3] = a;
        }
        for (const p of patches) {
          const w = p.w;
          // patch-local coordinates: s along the window, t into the room
          let s: number;
          let t: number;
          if (w.face === 'right') {
            t = g.y / p.reach;
            s = (g.x - p.skew * g.y - w.u0) / (w.u1 - w.u0);
          } else {
            t = g.x / p.reach;
            s = (g.y - p.skew * g.x - w.u0) / (w.u1 - w.u0);
          }
          if (t < 0.12 || t > 1 || s < 0 || s > 1) continue;
          if (Math.abs(s - 0.5) < 0.035 || Math.abs(t - 0.52) < 0.03) continue;
          const a = t < 0.45 ? 92 : t < 0.8 ? 68 : 40;
          if (a > sd[i + 3]) {
            sd[i] = 255;
            sd[i + 1] = 232;
            sd[i + 2] = 170;
            sd[i + 3] = a;
          }
        }
        continue;
      }
      // Right wall (plane y = 0) and left wall (plane x = 0).
      if (ax >= 0) {
        const u = ax / 16;
        const z = u * 8 - ay;
        if (u < W && z >= 0 && z < WALL_H) {
          const tx = Math.min(texR.width - 1, Math.floor(u * TU));
          const ty = Math.min(texR.height - 1, Math.floor((WALL_H - z) * TV));
          const ti = (ty * texR.width + tx) * 4;
          if (tdR[ti + 3] === 0) continue; // window glass: the live view shows through
          let rgb: RGB = [tdR[ti], tdR[ti + 1], tdR[ti + 2]];
          rgb = dark(rgb, 0.1 + (u < 0.35 ? 0.1 : 0) + (z < 6 ? 0.06 : 0));
          put(i, rgb, tdR[ti + 3]);
          continue;
        }
      }
      if (ax < 0.5) {
        const u = -ax / 16;
        const z = u * 8 - ay;
        if (u >= 0 && u < H && z >= 0 && z < WALL_H) {
          const tx = Math.min(texL.width - 1, Math.floor(u * TU));
          const ty = Math.min(texL.height - 1, Math.floor((WALL_H - z) * TV));
          const ti = (ty * texL.width + tx) * 4;
          if (tdL[ti + 3] === 0) continue;
          let rgb: RGB = [tdL[ti], tdL[ti + 1], tdL[ti + 2]];
          rgb = dark(rgb, (u < 0.35 ? 0.1 : 0) + (z < 6 ? 0.06 : 0));
          put(i, rgb, tdL[ti + 3]);
          continue;
        }
      }
      // Wall tops (thickness) and the free end caps.
      const top = screenToIso(ax, ay + WALL_H);
      const capTop = C(theme.wallTop);
      if (top.y >= -THICK && top.y < 0 && top.x >= -THICK && top.x < W) {
        put(i, top.y > -0.05 || top.x > W - 0.04 ? light(capTop, 0.2) : capTop);
        continue;
      }
      if (top.x >= -THICK && top.x < 0 && top.y >= -THICK && top.y < H) {
        put(i, top.x > -0.05 || top.y > H - 0.04 ? light(capTop, 0.28) : light(capTop, 0.08));
        continue;
      }
      // end cap of the right wall (plane x = W, facing +x) and of the left wall (plane y = H, facing +y)
      {
        const y = W - ax / 16; // on the plane x = W, y runs from 0 back to -THICK
        const z = (W + y) * 8 - ay;
        if (y < 0 && y >= -THICK && z >= 0 && z < WALL_H) {
          put(i, dark(capTop, 0.3));
          continue;
        }
        const xx = (ax + H * 16) / 16; // x offset (negative) from the corner at y = H
        const z2 = H * 8 + xx * 8 - ay;
        if (xx < 0 && xx >= -THICK && z2 >= 0 && z2 < WALL_H) {
          put(i, dark(capTop, 0.15));
          continue;
        }
      }
      // Floor slab under the front edges.
      for (let k = 1; k <= SLAB * S; k++) {
        const u = at(px, py - k);
        if (!inFloor(u.x, u.y)) continue;
        const onRight = u.x >= W - 0.08;
        const onLeft = u.y >= H - 0.08;
        if (!onRight && !onLeft) break;
        const right = frac(u.x) > frac(u.y) && onRight;
        let rgb = dark(C(theme.floorAlt), right ? 0.42 : 0.28);
        if (k <= 2) rgb = light(C(theme.floor), 0.12);
        else if (px % 12 === 0) rgb = dark(rgb, 0.12);
        put(i, rgb);
        break;
      }
    }
  }

  // Stage platforms (Lantern Hall), drawn pixel by pixel at the shell's density like everything else:
  // polished honey boards with staggered plank joints and a bright front lip with footlights, over a pleated
  // plum velvet skirt with a brass rail, a shaded end panel, and a dark contact line on the floor.
  for (const o of scene.objects.filter((ob) => ob.flat && ob.sprite === 'stage')) {
    const f = footprint(o);
    const h = 6;
    const pal = {
      board: C('#b98252'),
      boardAlt: C('#ad7648'),
      seam: C('#7a4c30'),
      back: C('#8f5f3c'),
      lip: C('#e9b87c'),
      brass: C('#dcb04e'),
      brassD: C('#a8741f'),
      velvet: C('#7a2f52'),
      velvetD: C('#5b2140'),
      velvetL: C('#94406a'),
      kick: C('#3a1a2c'),
      bulb: C('#fff0b8'),
      socket: C('#5a3a22'),
    };
    const corners = [
      isoToScreen(f.x0, f.y0, h),
      isoToScreen(f.x1, f.y0, h),
      isoToScreen(f.x1, f.y1, 0),
      isoToScreen(f.x0, f.y1, 0),
      isoToScreen(f.x0, f.y1, h),
    ];
    const px0 = Math.max(0, Math.floor((Math.min(...corners.map((q) => q.x)) - minX) * S) - 1);
    const px1 = Math.min(cw - 1, Math.ceil((Math.max(...corners.map((q) => q.x)) - minX) * S) + 1);
    const py0 = Math.max(0, Math.floor((Math.min(...corners.map((q) => q.y)) - minY) * S) - 1);
    const py1 = Math.min(ch - 1, Math.ceil((Math.max(...corners.map((q) => q.y)) - minY) * S) + 1);
    const hash = (x: number, y: number) => {
      let n = Math.imul(x * 374761393 + y * 668265263, 1274126177);
      n ^= n >>> 13;
      return ((n >>> 0) % 1000) / 1000;
    };
    for (let py = py0; py <= py1; py++)
      for (let px = px0; px <= px1; px++) {
        const ax = minX + (px + 0.5) / S;
        const ay = minY + (py + 0.5) / S;
        let rgb: RGB | null = null;
        // the top at height h
        const tx = (ax / 16 + (ay + h) / 8) / 2;
        const ty = ((ay + h) / 8 - ax / 16) / 2;
        if (tx >= f.x0 && tx < f.x1 && ty >= f.y0 && ty < f.y1) {
          const plank = Math.floor((ty - f.y0) * 4);
          const along = tx - f.x0 + ((plank * 0.61) % 1.4);
          if (ty > f.y1 - 0.08) {
            // the front lip, with a footlight every tile
            const fx = (tx - f.x0) % 1;
            rgb = fx > 0.47 && fx < 0.53 ? pal.bulb : fx > 0.44 && fx < 0.56 ? pal.socket : pal.lip;
          } else if (ty < f.y0 + 0.05) rgb = pal.back;
          else if (((ty - f.y0) * 4) % 1 < 0.1 || along % 1.4 < 0.035) rgb = pal.seam;
          else {
            rgb = plank % 2 ? pal.boardAlt : pal.board;
            const g = hash(Math.floor(tx * 24), plank);
            if (g > 0.86) rgb = dark(rgb, 0.08);
            else if (g < 0.1) rgb = light(rgb, 0.08);
            if (tx > f.x1 - 0.05) rgb = light(rgb, 0.12);
          }
        } else {
          // the front face (the y = y1 plane)
          const fx = ax / 16 + f.y1;
          const fz = (fx + f.y1) * 8 - ay;
          if (fx >= f.x0 && fx <= f.x1 && fz >= 0 && fz <= h) {
            if (fz > h - 1) rgb = pal.brass;
            else if (fz > h - 1.5) rgb = pal.brassD;
            else if (fz < 0.5) rgb = pal.kick;
            else {
              const pleat = ((fx - f.x0) * 10) % 1;
              rgb = pleat < 0.18 ? pal.velvetD : pleat < 0.42 ? pal.velvetL : pal.velvet;
            }
          } else {
            // the end face (the x = x1 plane), in shade
            const ey = f.x1 - ax / 16;
            const ez = (f.x1 + ey) * 8 - ay;
            if (ey >= f.y0 && ey <= f.y1 && ez >= 0 && ez <= h) {
              if (ez > h - 1) rgb = pal.brassD;
              else if (ez < 0.5) rgb = pal.kick;
              else rgb = ((ey - f.y0) * 10) % 1 < 0.2 ? dark(pal.velvetD, 0.15) : pal.velvetD;
            }
          }
        }
        if (rgb) put((py * cw + px) * 4, rgb);
      }
  }
  ctx.putImageData(img, 0, 0);

  // A 1 px plum outline around the whole diorama (not around the window openings).
  const out = ctx.getImageData(0, 0, cw, ch);
  const od = out.data;
  const solid = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) solid[i] = od[i * 4 + 3] > 0 ? 1 : 0;
  const glass = (px: number, py: number) => {
    const ax = minX + (px + 0.5) / S;
    const ay = minY + (py + 0.5) / S;
    const u = Math.abs(ax) / 16;
    const z = u * 8 - ay;
    return z > 0 && z < WALL_H && u < Math.max(W, H);
  };
  for (let py = 1; py < ch - 1; py++)
    for (let px = 1; px < cw - 1; px++) {
      const k = py * cw + px;
      if (solid[k]) continue;
      if (!(solid[k - 1] || solid[k + 1] || solid[k - cw] || solid[k + cw])) continue;
      if (glass(px, py)) continue;
      od[k * 4] = 29;
      od[k * 4 + 1] = 21;
      od[k * 4 + 2] = 34;
      od[k * 4 + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
  sunCanvas.getContext('2d')!.putImageData(sunImg, 0, 0);
  const lamps: LampLight[] = lampPools.map((l) => {
    const pool = makeCanvas(l.w, l.h);
    pool.getContext('2d')!.putImageData(l.img, 0, 0);
    return { id: l.id, x: l.x, y: l.y, pool, ax: l.ax, ay: l.ay };
  });

  return { canvas, minX, minY, wallHits, scale: S, sun: sunCanvas, windows, lamps };
}
