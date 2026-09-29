/**
 * Ground rendering. Terrain and floors are rasterized per pixel (inverse iso projection) so the
 * result is crisp pixel art without polygon seams. Interior walls and wall-mounted objects are
 * painted onto the same static layer. Re-rendered only when a scene or its event decor changes.
 */
import { hash2 } from '@shared/world/builders';
import { screenToIso } from '@shared/iso';
import type { InteriorTheme, SceneDef, SceneObject } from '@shared/world/scene';
import { footprint, terrainAt } from '@shared/world/scene';
import { darken, hexToRgb, lighten, mix, INK } from './sprites/color';
import { makeCanvas } from './sprites/painter';
import { rugTexture } from './sprites/furniture';

export const WALL_H = 62;
const CLIFF = 18;
const WATER_DROP = 3;

export interface WallHit {
  obj: SceneObject;
  poly: Array<[number, number]>; // art space
}

export interface GroundLayer {
  canvas: HTMLCanvasElement;
  minX: number;
  minY: number;
  wallHits: WallHit[];
  /** Canvas px per art px (outdoor terrain can be rasterized at the 2× art density). */
  scale?: number;
}

type RGB = [number, number, number];
const C = (hex: string): RGB => hexToRgb(hex);

const PAL = {
  grass: C('#7cc26a'),
  grass2: C('#6db35d'),
  grassDark: C('#5f9f52'),
  grassLight: C('#8fd07a'),
  meadow: C('#86c872'),
  path: C('#d8c6a6'),
  pathDark: C('#bca885'),
  pathLight: C('#e8dcc2'),
  curb: C('#a8977a'),
  plaza: C('#e6d3b3'),
  plaza2: C('#d9c29d'),
  plazaRing: C('#c9ae86'),
  sand: C('#efd9a4'),
  water: C('#58b4de'),
  deep: C('#3f96c9'),
  lily: C('#5fae5a'),
  lilyDark: C('#3f8a47'),
  dock: C('#b98250'),
  dirt: C('#8a5a3b'),
  dirtDark: C('#6b4428'),
  stone: C('#8f8578'),
};

function shade([r, g, b]: RGB, k: number): RGB {
  return [r * k, g * k, b * k];
}

const frac = (v: number) => v - Math.floor(v);
const isWater = (c: string) => c === 'w' || c === 'W';
const isLand = (c: string) => c !== ' ' && !isWater(c);
const isPaved = (c: string) => c === 'p' || c === 'P' || c === 'd';

/** Smooth value noise over tile space (bilinear between hashed lattice points), 0..1. */
function vnoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** 2×2 ordered dither: pixel art never blends tones, it interleaves them. */
const BAYER = [0.125, 0.625, 0.875, 0.375];
const dither = (px: number, py: number) => BAYER[(px & 1) + (py & 1) * 2];

interface Sample {
  gx: number; // iso position (tiles)
  gy: number;
  tx: number;
  ty: number;
  px: number; // art-space pixel (for hashing, scale-independent)
  py: number;
  sx: number; // canvas pixel (for dithering at the render density)
  sy: number;
}

function grassColor(c: string, s: Sample): RGB {
  // organic patches of three greens (no tile-shaped blocks), dithered where they meet
  const n = vnoise(s.gx, s.gy, 3.2, 7) * 0.65 + vnoise(s.gx, s.gy, 1.1, 8) * 0.35;
  const t = n + (dither(s.sx, s.sy) - 0.5) * 0.08;
  let base = c === 'm' ? PAL.meadow : t < 0.36 ? PAL.grass2 : t > 0.66 ? PAL.grassLight : PAL.grass;
  // blades: short dark strokes and a few light tips
  const h = hash2(s.px, s.py >> 1, 9);
  if (h > 0.972) base = shade(base, 0.86);
  else if (h < 0.018) base = shade(base, 1.12);
  if (c === 'm') {
    const f = hash2(s.px >> 1, s.py >> 1, 4);
    if (f > 0.985) return hash2(s.px, s.py, 5) > 0.5 ? C('#ffd23f') : C('#ff9ec4');
    if (f < 0.012) return C('#fffaf0');
  }
  return base;
}

function pathColor(s: Sample, T: (x: number, y: number) => string): RGB {
  const fx = frac(s.gx);
  const fy = frac(s.gy);
  // a curb where the path meets grass, so streets read crisply
  const edge = 0.07;
  const grassAt = (dx: number, dy: number) => !isPaved(T(s.tx + dx, s.ty + dy)) && isLand(T(s.tx + dx, s.ty + dy));
  if ((fx < edge && grassAt(-1, 0)) || (fx > 1 - edge && grassAt(1, 0)) || (fy < edge && grassAt(0, -1)) || (fy > 1 - edge && grassAt(0, 1)))
    return PAL.curb;
  // rounded cobbles, three to a tile, in a running bond
  const row = Math.floor(fy * 3);
  const cx = fx * 3 + (row % 2) * 0.5;
  const u = frac(cx);
  const v = frac(fy * 3);
  const mortar = u < 0.1 || v < 0.12;
  if (mortar) return PAL.pathDark;
  const k = 0.94 + hash2(s.tx * 3 + Math.floor(cx), s.ty * 3 + row, 5) * 0.1;
  const lit = v < 0.3 && u > 0.2 && u < 0.7; // a highlight on the upper edge of each stone
  return shade(lit ? PAL.pathLight : PAL.path, k);
}

function plazaColor(s: Sample, fountain: { x: number; y: number } | null): RGB {
  // rings of darker setts radiating from the fountain, big flagstones elsewhere
  if (fountain) {
    const r = Math.hypot(s.gx - fountain.x, s.gy - fountain.y);
    if ((r > 3.0 && r < 3.3) || (r > 5.1 && r < 5.35)) return PAL.plazaRing;
    if (r < 3.0) {
      const a = Math.atan2(s.gy - fountain.y, s.gx - fountain.x);
      const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24);
      const ring = Math.floor(r * 3);
      if (frac(r * 3) < 0.12) return shade(PAL.plaza2, 0.9);
      return (seg + ring) % 2 ? PAL.plaza : PAL.plaza2;
    }
  }
  const fx = frac(s.gx * 2);
  const fy = frac(s.gy * 2);
  if (fx < 0.06 || fy < 0.06) return shade(PAL.plaza2, 0.9);
  const k = 0.97 + hash2(Math.floor(s.gx * 2), Math.floor(s.gy * 2), 6) * 0.06;
  return shade((Math.floor(s.gx * 2) + Math.floor(s.gy * 2)) % 2 ? PAL.plaza : PAL.plaza2, k);
}

function landColor(c: string, s: Sample, T: (x: number, y: number) => string, fountain: { x: number; y: number } | null): RGB {
  switch (c) {
    case 'g':
    case 'h':
    case 'm':
      return grassColor(c, s);
    case 'p':
      return pathColor(s, T);
    case 'P':
      return plazaColor(s, fountain);
    case 's': {
      const t = hash2(s.px, s.py, 2);
      return t > 0.93 ? shade(PAL.sand, 0.9) : t < 0.04 ? shade(PAL.sand, 1.05) : PAL.sand;
    }
    case 'd': {
      const fx = frac(s.gx);
      const fy = frac(s.gy);
      const seam = frac(fy * 5) < 0.14;
      const end = frac(fx * 1.5 + (Math.floor(fy * 5) % 2) * 0.5) < 0.04;
      return seam || end ? PAL.dirtDark : shade(PAL.dock, 0.95 + hash2(s.tx, Math.floor(fy * 5) + s.ty * 5, 1) * 0.1);
    }
    default:
      return PAL.grass;
  }
}

function waterColor(deep: boolean, s: Sample, shoreDist: number): RGB {
  // deeper toward the middle, with long soft wave glints
  let base = deep ? PAL.deep : PAL.water;
  if (!deep && shoreDist > 1.5) base = shade(base, 0.96);
  const wave = Math.sin(s.px * 0.18 + s.py * 0.7 + Math.sin(s.py * 0.07) * 3) + Math.sin(s.px * 0.04 - s.py * 0.25);
  if (wave > 1.78) return shade(base, 1.16);
  if (wave < -1.9) return shade(base, 0.93);
  return base;
}

/**
 * Outdoor terrain rasterizer. `scale` is canvas px per art px: 2 matches the art density (64 px per floor
 * tile); the layer reports it so the view can draw it at world size.
 */
export function renderOutdoorGround(scene: SceneDef, scale = 1): GroundLayer {
  const { width: W, height: H } = scene;
  const S = scale;
  const minX = -H * 16 - 8;
  const maxX = W * 16 + 8;
  const minY = -12;
  const maxY = (W + H) * 8 + CLIFF + 8;
  const cw = Math.ceil((maxX - minX) * S);
  const ch = Math.ceil((maxY - minY) * S);
  const canvas = makeCanvas(cw, ch);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const T = (x: number, y: number) => terrainAt(scene, x, y);
  const f = scene.objects.find((o) => o.sprite === 'fountain');
  const fountain = f ? { x: f.x + (f.w ?? 1) / 2, y: f.y + (f.d ?? 1) / 2 } : null;
  // distance to shore for water tiles (in tiles), for depth tones and lily pads
  const shore = new Float32Array(W * H).fill(99);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!isWater(T(x, y))) continue;
      let best = 99;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (isLand(T(x + dx, y + dy))) best = Math.min(best, Math.hypot(dx, dy));
      shore[y * W + x] = best;
    }

  for (let sy = 0; sy < ch; sy++) {
    for (let sx = 0; sx < cw; sx++) {
      const ax = minX + (sx + 0.5) / S;
      const ay = minY + (sy + 0.5) / S;
      const px = Math.floor(ax - minX);
      const py = Math.floor(ay - minY);
      let rgb: RGB | null = null;

      const g = screenToIso(ax, ay);
      const tx = Math.floor(g.x);
      const ty = Math.floor(g.y);
      const c = T(tx, ty);
      const smp: Sample = { gx: g.x, gy: g.y, tx, ty, px: Math.floor((ax - minX) * 2), py: Math.floor((ay - minY) * 2), sx, sy };
      if (isLand(c)) {
        rgb = landColor(c, smp, T, fountain);
        // a soft shadow line where grass meets sand or a path, for readability
        const ex = frac(g.x);
        const ey = frac(g.y);
        if ((c === 'g' || c === 'h' || c === 'm') && (ex > 0.95 || ey > 0.95)) {
          const n = ex > 0.95 ? T(tx + 1, ty) : T(tx, ty + 1);
          if (n === 's') rgb = shade(rgb, 0.92);
        }
      } else {
        // Bank below a land tile edge?
        for (let k = 1; k <= WATER_DROP + 1 && !rgb; k++) {
          const u = screenToIso(ax, ay - k);
          if (isLand(T(Math.floor(u.x), Math.floor(u.y)))) rgb = k <= 1 ? PAL.dirt : PAL.dirtDark;
        }
        if (!rgb) {
          const wv = screenToIso(ax, ay - WATER_DROP);
          const wx = Math.floor(wv.x);
          const wy = Math.floor(wv.y);
          const wc = T(wx, wy);
          if (isWater(wc)) {
            const sd = shore[wy * W + wx] ?? 99;
            const ws: Sample = { ...smp, gx: wv.x, gy: wv.y, tx: wx, ty: wy };
            rgb = waterColor(wc === 'W', ws, sd);
            // foam near the shore
            const near = [T(wx + 1, wy), T(wx - 1, wy), T(wx, wy + 1), T(wx, wy - 1)].some(isLand);
            if (near && hash2(px >> 1, py, 8) > 0.55) rgb = shade(rgb, 1.22);
            // lily pads in the shallows: little round pads with a notch, a pink flower on a few
            if (sd > 1 && sd < 3.2 && wc === 'w') {
              const cx = Math.floor(wv.x * 2.2);
              const cy = Math.floor(wv.y * 2.2);
              if (hash2(cx, cy, 21) > 0.86) {
                const ox = frac(wv.x * 2.2) - 0.5;
                const oy = frac(wv.y * 2.2) - 0.5;
                const r = Math.hypot(ox, oy);
                if (r < 0.3 && !(ox > 0.02 && Math.abs(oy) < 0.05)) {
                  rgb = r > 0.22 ? PAL.lilyDark : PAL.lily;
                  if (r < 0.08 && hash2(cx, cy, 22) > 0.6) rgb = C('#f7a8c8');
                }
              }
            }
          }
        }
      }
      if (!rgb) {
        // Diorama cliff under the map's front edges.
        for (let k = 1; k <= CLIFF && !rgb; k++) {
          const u = screenToIso(ax, ay - k);
          const ux = Math.floor(u.x);
          const uy = Math.floor(u.y);
          const inMap = ux >= 0 && uy >= 0 && ux < W && uy < H;
          if (!inMap) continue;
          const onFront = ux === W - 1 || uy === H - 1;
          if (!onFront) continue;
          const tc = T(ux, uy);
          const rightFace = frac(u.x) > frac(u.y);
          const fc = rightFace ? 0.82 : 1;
          if (isWater(tc)) rgb = shade(k < 6 ? PAL.water : k < 12 ? PAL.dirt : PAL.stone, fc * (k < 6 ? 0.85 : 1));
          else rgb = shade(k < 3 ? PAL.grassDark : k < 12 ? PAL.dirt : PAL.stone, fc);
          if (k > 12 && hash2(px, py, 6) > 0.8) rgb = shade(rgb, 0.85);
        }
      }
      if (!rgb) continue;
      const i = (sy * cw + sx) * 4;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Soft contact shadows under objects.
  ctx.save();
  ctx.scale(S, S);
  ctx.translate(-minX, -minY);
  for (const o of scene.objects) {
    if (o.sprite === 'reeds' || o.sprite === 'boat' || o.eventDecor) continue;
    const fp = footprint(o);
    const cx = (fp.x0 + fp.x1) / 2;
    const cy = (fp.y0 + fp.y1) / 2;
    const ssx = (cx - cy) * 16;
    const ssy = (cx + cy) * 8;
    const rw = ((fp.x1 - fp.x0 + fp.y1 - fp.y0) / 2) * 16 * (o.building ? 1.08 : 0.8);
    ctx.fillStyle = o.building ? 'rgba(40,30,50,0.20)' : 'rgba(40,30,50,0.16)';
    ctx.beginPath();
    ctx.ellipse(ssx + (o.building ? -4 : 0), ssy + (o.building ? 3 : 1), rw, rw / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  return { canvas, minX, minY, wallHits: [], scale: S };
}

/* -------------------------------------------------------------------- interiors */

function floorColor(t: InteriorTheme, fx: number, fy: number, tx: number, ty: number, px: number, py: number): RGB {
  const a = C(t.floor);
  const b = C(t.floorAlt);
  switch (t.floorPattern) {
    case 'planks': {
      const row = Math.floor(fy * 4);
      const seam = frac(fy * 4) < 0.12;
      const end = frac(fx + (row % 2) * 0.5 + hash2(ty, row, 2) * 0.3) < 0.05;
      if (seam || end) return shade(b, 0.88);
      const k = 0.96 + hash2(tx + (row % 3), ty * 4 + row, 7) * 0.08;
      return shade(hash2(px >> 2, py, 3) > 0.9 ? b : a, k);
    }
    case 'checker':
      return (tx + ty) % 2 ? a : b;
    case 'tiles': {
      if (frac(fx) < 0.05 || frac(fy) < 0.05) return shade(b, 0.92);
      return a;
    }
    case 'carpet':
    default: {
      const n = hash2(px, py, 5);
      return n > 0.9 ? shade(a, 1.05) : n < 0.1 ? b : a;
    }
  }
}

type Face = 'left' | 'right';

/** Paints in a wall's face space: u (tiles along the wall), v (px up). */
function onWall(ctx: CanvasRenderingContext2D, ox: number, oy: number, face: Face, draw: (c: CanvasRenderingContext2D) => void) {
  ctx.save();
  if (face === 'right') ctx.setTransform(16, 8, 0, -1, ox, oy);
  else ctx.setTransform(-16, 8, 0, -1, ox, oy);
  draw(ctx);
  ctx.restore();
}

function wallPoly(ox: number, oy: number, face: Face, u0: number, u1: number, v0: number, v1: number, minX: number, minY: number): Array<[number, number]> {
  const pt = (u: number, v: number): [number, number] =>
    face === 'right' ? [ox + u * 16 + minX, oy + u * 8 - v + minY] : [ox - u * 16 + minX, oy + u * 8 - v + minY];
  return [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)];
}

function rect(c: CanvasRenderingContext2D, u: number, v: number, du: number, dv: number, fill: string) {
  c.fillStyle = fill;
  c.fillRect(u, v, du, dv);
}

/** Draw a wall-mounted item in face space; returns its interactive v-range. */
export function drawWallItem(c: CanvasRenderingContext2D, o: SceneObject, u0: number, span: number, ctx: InteriorRenderContext): [number, number] {
  const u1 = u0 + span;
  const mid = (u0 + u1) / 2;
  switch (o.sprite) {
    case 'window': {
      rect(c, u0 + 0.1, 16, span - 0.2, 30, INK);
      rect(c, u0 + 0.14, 17, span - 0.28, 28, '#fbf6ea');
      const g = c.createLinearGradient(0, 44, 0, 20);
      g.addColorStop(0, '#9fdcff');
      g.addColorStop(1, '#e8f7ff');
      c.fillStyle = g;
      c.fillRect(u0 + 0.2, 19, span - 0.4, 25);
      rect(c, mid - 0.03, 19, 0.06, 25, '#fbf6ea');
      rect(c, u0 + 0.2, 30, span - 0.4, 1.5, '#fbf6ea');
      rect(c, u0 + 0.3, 38, 0.3, 2, '#ffffff');
      rect(c, u0 + 0.1, 14, span - 0.2, 2.5, darken('#fbf6ea', 0.2));
      return [14, 46];
    }
    case 'plaque': {
      const metal = o.variant === 'silver' ? '#c9d2da' : '#e8b93f';
      rect(c, u0 + 0.2, 24, 0.6, 16, '#6b4428');
      rect(c, u0 + 0.26, 25.5, 0.48, 13, '#8a5a3b');
      rect(c, u0 + 0.32, 29, 0.36, 6, metal);
      rect(c, u0 + 0.36, 33, 0.28, 1, darken(metal, 0.35));
      rect(c, u0 + 0.36, 31, 0.2, 1, darken(metal, 0.35));
      rect(c, u0 + 0.44, 36, 0.12, 2, metal);
      return [24, 40];
    }
    case 'frame':
      if (o.variant === 'rocket' || o.variant === 'photo' || o.variant === 'star') {
        rect(c, u0 + 0.12, 24, 0.76, 17, '#e8b93f');
        rect(c, u0 + 0.17, 25.3, 0.66, 14.4, o.variant === 'rocket' ? '#1f2a44' : o.variant === 'star' ? '#2c4a63' : '#bfe7ef');
        if (o.variant === 'rocket') {
          rect(c, u0 + 0.46, 29, 0.08, 8, '#f4f1ea');
          rect(c, u0 + 0.47, 37, 0.06, 1.5, '#e0503f');
          rect(c, u0 + 0.4, 29, 0.06, 2, '#e0503f');
          rect(c, u0 + 0.54, 29, 0.06, 2, '#e0503f');
          rect(c, u0 + 0.46, 27, 0.08, 2, '#ff8a3d');
          rect(c, u0 + 0.25, 35, 0.04, 1, '#fffaf0');
          rect(c, u0 + 0.7, 32, 0.04, 1, '#fffaf0');
        } else if (o.variant === 'star') {
          rect(c, u0 + 0.46, 28, 0.08, 9, '#ffd23f');
          rect(c, u0 + 0.34, 31.5, 0.32, 2, '#ffd23f');
        } else {
          rect(c, u0 + 0.17, 25.3, 0.66, 4, '#7cc26a');
          for (let i = 0; i < 4; i++) {
            rect(c, u0 + 0.24 + i * 0.14, 29, 0.08, 4, ['#e0503f', '#3f8fd8', '#f2c14e', '#9b6bd6'][i]);
            rect(c, u0 + 0.24 + i * 0.14, 33, 0.08, 2, '#e8b088');
          }
        }
        return [24, 41];
      }
    {
      const pal: Record<string, string[]> = {
        garage: ['#8a7a66', '#c9b79a', '#5a4a3a'],
        customer: ['#fffaf0', '#3a3a46', '#e0503f'],
        lisbon: ['#ffd23f', '#3f8fd8', '#e27c62'],
        team: ['#9fd0ff', '#e8b088', '#5a3825'],
        lake: ['#58b4de', '#7cc26a', '#fffaf0'],
        hackathon: ['#1a1330', '#7cf57c', '#5ff3ff'],
      };
      const p = pal[o.variant ?? 'lake'] ?? pal.lake;
      rect(c, u0 + 0.12, 24, 0.76, 17, '#6b4428');
      rect(c, u0 + 0.18, 25.5, 0.64, 14, p[0]);
      rect(c, u0 + 0.2, 27, 0.25, 5, p[1]);
      rect(c, u0 + 0.5, 30, 0.25, 6, p[2]);
      rect(c, u0 + 0.3, 34, 0.35, 2, p[1]);
      return [24, 41];
    }
    case 'menu-board':
      rect(c, u0 + 0.1, 22, span - 0.2, 22, '#6b4428');
      rect(c, u0 + 0.15, 23.5, span - 0.3, 19, '#2e3a33');
      for (let i = 0; i < 5; i++) rect(c, u0 + 0.3, 38 - i * 3.5, 0.4 + ((i * 37) % 7) * 0.08, 1, i === 0 ? '#ffd23f' : '#fffaf0');
      return [22, 44];
    case 'logo-wall': {
      rect(c, u0 + 0.2, 20, span - 0.4, 26, '#2c4a63');
      const cx = mid;
      rect(c, cx - 0.06, 26, 0.12, 16, '#ffd23f');
      rect(c, cx - 0.4, 33, 0.8, 2.5, '#ffd23f');
      rect(c, cx - 0.2, 29, 0.4, 9, '#ffd23f');
      return [20, 46];
    }
    case 'elevator':
      rect(c, u0 + 0.1, 0, span - 0.2, 40, '#8f9aa6');
      rect(c, u0 + 0.2, 0, span / 2 - 0.22, 36, '#c9d2da');
      rect(c, mid + 0.02, 0, span / 2 - 0.22, 36, '#b9c3cc');
      rect(c, mid - 0.15, 42, 0.3, 4, '#2a2f3a');
      rect(c, mid - 0.05, 43, 0.1, 2, '#ffb347');
      return [0, 46];
    case 'bulletin':
      rect(c, u0 + 0.1, 20, span - 0.2, 24, '#8a5a3b');
      rect(c, u0 + 0.15, 21.5, span - 0.3, 21, '#c9a06a');
      ['#ffd23f', '#ff9ec4', '#9fdcff', '#b8f28f', '#fffaf0'].forEach((col, i) =>
        rect(c, u0 + 0.25 + (i % 3) * 0.5, 25 + Math.floor(i / 3) * 9, 0.35, 6, col),
      );
      return [20, 44];
    case 'whiteboard':
      rect(c, u0 + 0.1, 18, span - 0.2, 28, '#8e8a84');
      rect(c, u0 + 0.14, 19.5, span - 0.28, 25, '#fdfdfb');
      rect(c, u0 + 0.4, 34, 0.5, 6, '#3f8fd8');
      rect(c, u0 + 1.3, 34, 0.5, 6, '#e0503f');
      rect(c, u0 + 2.2, 34, 0.5, 6, '#2bb3a3');
      rect(c, u0 + 0.9, 36.5, 0.4, 1, '#3a3a46');
      rect(c, u0 + 1.8, 36.5, 0.4, 1, '#3a3a46');
      rect(c, u0 + 1.3, 24, 0.5, 5, '#f2a93b');
      rect(c, u0 + 1.54, 29, 0.03, 5, '#3a3a46');
      rect(c, u0 + 0.2, 16.5, span - 0.4, 1.5, '#8e8a84');
      return [16, 46];
    case 'kanban': {
      rect(c, u0 + 0.1, 16, span - 0.2, 30, '#fdfdfb');
      rect(c, u0 + 0.1, 16, span - 0.2, 1, '#8e8a84');
      const cols = 3;
      const cw = (span - 0.4) / cols;
      for (let i = 0; i < cols; i++) {
        rect(c, u0 + 0.2 + i * cw, 42, cw - 0.1, 2, '#2f3b5c');
        const notes = [3, 4, 2][i];
        for (let k = 0; k < notes; k++)
          rect(c, u0 + 0.25 + i * cw + (k % 2) * 0.35, 36 - Math.floor(k / 2) * 7 - (k % 2) * 2, 0.28, 5, ['#ffd23f', '#ff9ec4', '#b8f28f'][i]);
      }
      return [16, 46];
    }
    case 'screen': {
      rect(c, u0 + 0.1, 20, span - 0.2, 22, '#1d2433');
      rect(c, u0 + 0.16, 21.5, span - 0.32, 19, '#11304a');
      c.save();
      c.scale(1 / 16, 1);
      c.fillStyle = '#7cf5ff';
      c.font = 'bold 9px monospace';
      c.textAlign = 'center';
      c.scale(1, -1);
      c.fillText('T-9', mid * 16, -28);
      c.restore();
      rect(c, u0 + 0.3, 25, span - 0.6, 1.5, '#ff8a3d');
      return [20, 42];
    }
    case 'pennant': {
      const col = o.variant === 'mobile' ? '#3f8fd8' : '#f2a93b';
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(u0 + 0.2, 44);
      c.lineTo(u0 + 0.8, 44);
      c.lineTo(u0 + 0.5, 30);
      c.closePath();
      c.fill();
      rect(c, u0 + 0.15, 44, 0.7, 1.5, '#6b4428');
      return [30, 46];
    }
    case 'banner': {
      const text = (ctx.bannerText ?? o.label ?? '').toUpperCase();
      const festive = !!ctx.bannerText;
      rect(c, u0, 40, span, 12, festive ? '#e24c9c' : '#5e3b5c');
      for (let u = u0; u < u1; u += 0.3) {
        c.fillStyle = festive ? '#ffd23f' : '#e8b93f';
        c.beginPath();
        c.moveTo(u, 40);
        c.lineTo(u + 0.3, 40);
        c.lineTo(u + 0.15, 36);
        c.closePath();
        c.fill();
      }
      c.save();
      c.scale(1 / 16, -1);
      c.fillStyle = '#fffaf0';
      c.font = 'bold 8px sans-serif';
      c.textAlign = 'center';
      c.fillText(text.slice(0, 26), mid * 16, -43);
      c.restore();
      return [36, 52];
    }
    case 'lantern-string': {
      rect(c, u0, 50, span, 0.8, INK);
      const colors = ['#ffcf5a', '#ff8a3d', '#e24c9c', '#3ec7e0'];
      let i = 0;
      for (let u = u0 + 0.2; u < u1; u += 0.45, i++) rect(c, u, 44 + (i % 2), 0.2, 5, colors[i % colors.length]);
      return [0, 0];
    }
    case 'neon': {
      c.save();
      c.shadowColor = '#ff5fd1';
      c.shadowBlur = 8;
      c.scale(1 / 16, -1);
      c.font = 'bold 13px sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#ffb3ec';
      c.fillText(o.label ?? '', mid * 16, -30);
      c.restore();
      return [26, 44];
    }
    case 'moodboard': {
      rect(c, u0 + 0.1, 18, span - 0.2, 28, '#e8d9bd');
      const cols = ['#e27c62', '#f2c14e', '#7cc576', '#3f8fd8', '#e27ca7', '#9b6bd6', '#2bb3a3', '#fffaf0'];
      let k = 0;
      for (let u = u0 + 0.25; u < u1 - 0.4; u += 0.45)
        for (let v = 22; v < 42; v += 7, k++) rect(c, u, v, 0.35, 5, cols[(k * 5) % cols.length]);
      return [18, 46];
    }
    case 'swatches': {
      const cols = ['#e27c62', '#f2c14e', '#7cc576', '#3f8fd8', '#9b6bd6', '#2a1f2d'];
      cols.forEach((col, i) => rect(c, u0 + 0.2 + i * ((span - 0.4) / cols.length), 20, (span - 0.4) / cols.length - 0.05, 24, col));
      return [20, 44];
    }
    case 'sign-quiet':
      rect(c, u0 + 0.2, 28, 0.6, 10, '#47785a');
      rect(c, u0 + 0.28, 29.5, 0.44, 7, '#eadfc9');
      rect(c, u0 + 0.46, 30.5, 0.08, 5, '#47785a');
      return [28, 38];
    case 'door': {
      rect(c, u0 + 0.08, 0, 0.84, 38, ctx.theme.trim);
      rect(c, u0 + 0.14, 0, 0.72, 35, '#3a2a2a');
      rect(c, u0 + 0.14, 0, 0.72, 4, '#4a3838');
      rect(c, u0 + 0.3, 40, 0.4, 5, '#2fbf71');
      rect(c, u0 + 0.36, 41.2, 0.28, 2.4, '#dff7e8');
      return [0, 46];
    }
  }
  return [20, 44];
}

export interface InteriorRenderContext {
  theme: InteriorTheme;
  activeDecor: ReadonlySet<string>;
  bannerText?: string;
}

export function renderInteriorGround(scene: SceneDef, rc: Omit<InteriorRenderContext, 'theme'>): GroundLayer {
  const theme = scene.interior!;
  const ctxInfo: InteriorRenderContext = { ...rc, theme };
  const { width: W, height: H } = scene;
  const thick = 0.25;
  const minX = -H * 16 - thick * 16 - 6;
  const maxX = W * 16 + thick * 16 + 6;
  const minY = -WALL_H - 14;
  const maxY = (W + H) * 8 + 12;
  const cw = maxX - minX;
  const ch = maxY - minY;
  const canvas = makeCanvas(cw, ch);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const SLAB = 7;
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const ax = px + minX + 0.5;
      const ay = py + minY + 0.5;
      const g = screenToIso(ax, ay);
      const tx = Math.floor(g.x);
      const ty = Math.floor(g.y);
      let rgb: RGB | null = null;
      if (tx >= 0 && ty >= 0 && tx < W && ty < H) {
        rgb = floorColor(theme, frac(g.x), frac(g.y), tx, ty, px, py);
        // ambient occlusion near the back walls
        if (g.x < 0.35 || g.y < 0.35) rgb = shade(rgb, 0.88);
      } else {
        for (let k = 1; k <= SLAB && !rgb; k++) {
          const u = screenToIso(ax, ay - k);
          const ux = Math.floor(u.x);
          const uy = Math.floor(u.y);
          if (ux < 0 || uy < 0 || ux >= W || uy >= H) continue;
          if (ux !== W - 1 && uy !== H - 1) continue;
          const right = frac(u.x) > frac(u.y);
          rgb = shade(C(theme.floorAlt), right ? 0.62 : 0.75);
          if (k === 1) rgb = shade(rgb, 1.15);
        }
      }
      if (!rgb) continue;
      const i = (py * cw + px) * 4;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const ox = -minX;
  const oy = -minY;

  // Flat floor objects: rugs and stages.
  const P = (x: number, y: number, z = 0): [number, number] => [ox + (x - y) * 16, oy + (x + y) * 8 - z];
  const poly = (pts: Array<[number, number, number]>, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    pts.forEach(([x, y, z], i) => {
      const [sx, sy] = P(x, y, z);
      if (i) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    ctx.closePath();
    ctx.fill();
  };
  for (const o of scene.objects.filter((x) => x.flat)) {
    const f = footprint(o);
    if (o.sprite === 'rug') {
      const t = rugTexture(o.variant ?? '');
      poly([[f.x0 + 0.1, f.y0 + 0.1, 0], [f.x1 - 0.1, f.y0 + 0.1, 0], [f.x1 - 0.1, f.y1 - 0.1, 0], [f.x0 + 0.1, f.y1 - 0.1, 0]], t.border);
      poly([[f.x0 + 0.25, f.y0 + 0.25, 0], [f.x1 - 0.25, f.y0 + 0.25, 0], [f.x1 - 0.25, f.y1 - 0.25, 0], [f.x0 + 0.25, f.y1 - 0.25, 0]], t.base);
      if (o.variant === 'logo') {
        const cx = (f.x0 + f.x1) / 2;
        const cy = (f.y0 + f.y1) / 2;
        poly([[cx - 0.8, cy, 0], [cx, cy - 0.3, 0], [cx + 0.8, cy, 0], [cx, cy + 0.3, 0]], t.accent);
        poly([[cx - 0.3, cy, 0], [cx, cy - 0.8, 0], [cx + 0.3, cy, 0], [cx, cy + 0.8, 0]], t.accent);
      } else {
        for (let x = f.x0 + 0.5; x < f.x1 - 0.4; x += 0.5)
          poly([[x, f.y0 + 0.35, 0], [x + 0.08, f.y0 + 0.35, 0], [x + 0.08, f.y1 - 0.35, 0], [x, f.y1 - 0.35, 0]], t.accent);
      }
    } else if (o.sprite === 'stage') {
      const h = 6;
      const wood = '#7a4a2e';
      poly([[f.x0, f.y1, 0], [f.x1, f.y1, 0], [f.x1, f.y1, h], [f.x0, f.y1, h]], darken(wood, 0.1));
      poly([[f.x1, f.y0, 0], [f.x1, f.y1, 0], [f.x1, f.y1, h], [f.x1, f.y0, h]], darken(wood, 0.3));
      poly([[f.x0, f.y0, h], [f.x1, f.y0, h], [f.x1, f.y1, h], [f.x0, f.y1, h]], '#b0784a');
      for (let y = f.y0 + 0.33; y < f.y1; y += 0.33)
        poly([[f.x0, y, h], [f.x1, y, h], [f.x1, y + 0.03, h], [f.x0, y + 0.03, h]], '#94623a');
      poly([[f.x0, f.y1 - 0.06, h], [f.x1, f.y1 - 0.06, h], [f.x1, f.y1, h], [f.x0, f.y1, h]], '#d9a066');
    }
  }

  // Walls.
  const wallRight = darken(theme.wall, 0.07);
  onWall(ctx, ox, oy, 'right', (c) => {
    rect(c, 0, 0, W, WALL_H, wallRight);
    for (let u = 0.5; u < W; u += 1) rect(c, u, 5, 0.04, WALL_H - 8, darken(wallRight, 0.04));
    rect(c, 0, 0, W, 4, theme.trim);
    rect(c, 0, WALL_H - 3, W, 3, darken(wallRight, 0.1));
  });
  onWall(ctx, ox, oy, 'left', (c) => {
    rect(c, 0, 0, H, WALL_H, theme.wall);
    for (let u = 0.5; u < H; u += 1) rect(c, u, 5, 0.04, WALL_H - 8, darken(theme.wall, 0.04));
    rect(c, 0, 0, H, 4, darken(theme.trim, 0.1));
    rect(c, 0, WALL_H - 3, H, 3, darken(theme.wall, 0.1));
  });
  // Wall tops and end caps.
  const top = theme.wallTop;
  poly([[0, 0, WALL_H], [W, 0, WALL_H], [W, -thick, WALL_H], [-thick, -thick, WALL_H]], top);
  poly([[0, 0, WALL_H], [-thick, -thick, WALL_H], [-thick, H, WALL_H], [0, H, WALL_H]], lighten(top, 0.08));
  poly([[W, -thick, 0], [W, 0, 0], [W, 0, WALL_H], [W, -thick, WALL_H]], darken(top, 0.25));
  poly([[-thick, H, 0], [0, H, 0], [0, H, WALL_H], [-thick, H, WALL_H]], darken(top, 0.1));

  // Wall items.
  const wallHits: WallHit[] = [];
  for (const o of scene.objects.filter((x) => x.wall)) {
    if (o.eventDecor && !rc.activeDecor.has(o.eventDecor)) continue;
    const face: Face = o.wall === 'right' ? 'right' : 'left';
    const u0 = face === 'right' ? o.x : o.y;
    const span = face === 'right' ? (o.w ?? 1) : (o.d ?? o.w ?? 1);
    let range: [number, number] = [0, 0];
    onWall(ctx, ox, oy, face, (c) => {
      range = drawWallItem(c, o, u0, span, ctxInfo);
    });
    if (o.actions?.length && range[1] > range[0]) {
      wallHits.push({ obj: o, poly: wallPoly(ox, oy, face, u0, u0 + span, range[0], range[1], minX, minY) });
    }
  }

  // Ambient tint per room mood.
  const tint: Record<InteriorTheme['ambient'], string | null> = {
    warm: 'rgba(255,190,120,0.06)',
    bright: null,
    dim: 'rgba(40,50,30,0.10)',
    neon: 'rgba(120,60,200,0.10)',
    festive: 'rgba(255,150,200,0.05)',
  };
  const tc = tint[theme.ambient];
  if (tc) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = tc;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'source-over';
  }
  void mix;
  return { canvas, minX, minY, wallHits };
}
