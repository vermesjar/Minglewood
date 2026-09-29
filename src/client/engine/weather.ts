/**
 * Sky and weather for the world outside the windows. Time of day follows the viewer's clock; the weather
 * changes every three hours and is the same for everyone (seeded by the time slot), so coworkers see the
 * same rain. Window views are painted as tiny pixel canvases at wall-texture density and sheared onto the
 * wall, so they stay as crisp as the room around them. Clouds are positioned along the whole wall, so they
 * drift continuously from one window into the next.
 */
import { hash2 } from '@shared/world/builders';
import type { WindowView } from './interior';

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'clouds' | 'rain' | 'snow';

export interface Sky {
  phase: Phase;
  weather: Weather;
  /** Sunlight strength on the floor, 0..1. */
  sun: number;
  /** How much lamps glow, 0..1. */
  lamp: number;
}

let override: Partial<Sky> | null = null;

/** Force a sky (sprite lab, demos). Pass null to follow the clock again. */
export function setSkyOverride(o: Partial<Sky> | null) {
  override = o;
}

export function skyAt(date = new Date()): Sky {
  const h = date.getHours() + date.getMinutes() / 60;
  const phase: Phase = h < 5.5 || h >= 21 ? 'night' : h < 8 ? 'dawn' : h < 18 ? 'day' : 'dusk';
  const slot = Math.floor(date.getTime() / (3 * 3600_000));
  const r = hash2(slot, 7, 13);
  const winter = [10, 11, 0, 1].includes(date.getMonth());
  let weather: Weather = r < 0.45 ? 'clear' : r < 0.75 ? 'clouds' : winter ? 'snow' : 'rain';
  if (override?.weather) weather = override.weather;
  const ph = override?.phase ?? phase;
  const base = ph === 'day' ? 1 : ph === 'night' ? 0 : 0.6;
  const w = weather === 'clear' ? 1 : weather === 'clouds' ? 0.55 : weather === 'snow' ? 0.5 : 0.28;
  const sun = base * w;
  const lamp = ph === 'night' ? 1 : ph === 'day' ? 0.35 + (1 - w) * 0.35 : 0.75;
  return { phase: ph, weather, sun, lamp, ...override };
}

type RGB = [number, number, number];
const SKY: Record<Phase, [RGB, RGB]> = {
  dawn: [
    [239, 160, 150],
    [255, 226, 176],
  ],
  day: [
    [98, 178, 232],
    [206, 236, 252],
  ],
  dusk: [
    [92, 78, 150],
    [255, 158, 110],
  ],
  night: [
    [14, 22, 52],
    [40, 58, 104],
  ],
};
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/** Pixel density of the view canvases (matches the wall textures). */
const TU = 32;
const TV = 2;
const views = new Map<string, HTMLCanvasElement>();

/**
 * Paint one window's view for time `t` (seconds) into its cached canvas and return it. The canvas maps
 * x → u along the wall (TU px per tile), y → down from the top of the glass (TV px per art px).
 */
export function windowView(w: WindowView, key: string, t: number, sky: Sky): HTMLCanvasElement {
  const cw = Math.max(2, Math.round((w.u1 - w.u0) * TU));
  const ch = Math.max(2, Math.round((w.v1 - w.v0) * TV));
  let canvas = views.get(key);
  if (!canvas || canvas.width !== cw || canvas.height !== ch) {
    canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    views.set(key, canvas);
  }
  const c = canvas.getContext('2d')!;
  const wet = sky.weather === 'rain' ? 0.45 : sky.weather === 'clouds' || sky.weather === 'snow' ? 0.22 : 0;
  const grey: RGB = sky.phase === 'night' ? [30, 34, 52] : [150, 158, 172];
  const [top, bot] = SKY[sky.phase];
  // Banded sky: five hard steps, like the rest of the pixel art.
  const bands = 5;
  for (let b = 0; b < bands; b++) {
    const col = lerp(lerp(top, bot, b / (bands - 1)), grey, wet);
    c.fillStyle = css(col);
    c.fillRect(0, Math.floor((b * ch) / bands), cw, Math.ceil(ch / bands) + 1);
  }
  const ux = (x: number) => w.u0 + x / TU; // canvas x → wall u
  // Sun or moon and stars.
  if (sky.weather !== 'rain') {
    if (sky.phase === 'night') {
      for (let x = 0; x < cw; x++)
        for (let y = 0; y < ch * 0.7; y++) {
          const hsh = hash2(Math.floor(ux(x) * TU), y, 17);
          if (hsh > 0.992) {
            const tw = 0.55 + 0.45 * Math.sin(t * 2 + hsh * 50);
            c.fillStyle = `rgba(255,248,220,${tw})`;
            c.fillRect(x, y, 1, 1);
          }
        }
      disc(c, cw * 0.7, ch * 0.22, 4, [246, 240, 214], [214, 208, 180]);
    } else if (sky.weather === 'clear') {
      const sx = sky.phase === 'dawn' ? cw * 0.2 : sky.phase === 'dusk' ? cw * 0.82 : cw * 0.3;
      const sy = sky.phase === 'day' ? ch * 0.2 : ch * 0.55;
      disc(c, sx, sy, 5, [255, 244, 190], [255, 214, 120]);
    }
  }
  // Clouds, placed along the whole wall so they drift from one window into the next.
  const cloud: RGB = sky.phase === 'night' ? [70, 82, 118] : sky.weather === 'rain' ? [170, 176, 190] : [255, 252, 246];
  const shade: RGB = lerp(cloud, [120, 120, 150], 0.35);
  const nClouds = sky.weather === 'clear' ? 2 : sky.weather === 'clouds' ? 5 : 7;
  const span = 16;
  for (let k = 0; k < nClouds; k++) {
    const speed = 0.02 + hash2(k, 3, 9) * 0.025;
    const cu = ((hash2(k, 1, 4) * span + t * speed) % span) - 1.5; // wall u of the cloud's centre
    const cy = (0.12 + hash2(k, 2, 5) * 0.4) * ch;
    const r = (0.25 + hash2(k, 5, 6) * 0.3) * TU;
    const x0 = (cu - w.u0) * TU;
    if (x0 + r * 2 < 0 || x0 - r * 2 > cw) continue;
    for (let x = Math.floor(x0 - r * 1.6); x < x0 + r * 1.6; x++) {
      if (x < 0 || x >= cw) continue;
      for (let y = Math.floor(cy - r * 0.6); y < cy + r * 0.5; y++) {
        if (y < 0 || y >= ch) continue;
        const dx = (x - x0) / r;
        const dy = (y - cy) / (r * 0.45);
        const m = Math.max(1 - (dx * dx + dy * dy), 1 - ((dx + 0.7) ** 2 + (dy - 0.25) ** 2) * 1.6, 1 - ((dx - 0.75) ** 2 + (dy - 0.3) ** 2) * 1.8);
        if (m <= 0) continue;
        c.fillStyle = css(dy > 0.25 ? shade : cloud, sky.phase === 'night' ? 0.8 : 0.95);
        c.fillRect(x, y, 1, 1);
      }
    }
  }
  // The far shore: a treeline and the lake, continuous across windows.
  const hill: RGB = lerp(sky.phase === 'night' ? [24, 44, 40] : [70, 128, 86], grey, wet * 0.6);
  const hillDark: RGB = lerp(hill, [30, 40, 50], 0.35);
  const lake: RGB = lerp(sky.phase === 'night' ? [30, 50, 92] : [74, 150, 200], grey, wet * 0.5);
  for (let x = 0; x < cw; x++) {
    const u = ux(x);
    const tree = Math.floor(3 + 2.5 * Math.sin(u * 3.1) + 2 * Math.sin(u * 7.3 + 1) + (hash2(Math.floor(u * 8), 3, 2) > 0.6 ? 2 : 0));
    const shore = ch - 8;
    c.fillStyle = css(hillDark);
    c.fillRect(x, shore - tree, 1, tree);
    c.fillStyle = css(hill);
    c.fillRect(x, shore - tree + 1, 1, Math.max(0, tree - 2));
    c.fillStyle = css(lake);
    c.fillRect(x, shore, 1, 8);
    // glints on the water
    if (sky.phase !== 'night' && sky.weather !== 'rain' && hash2(Math.floor(u * TU), Math.floor(t * 1.5), 5) > 0.94) {
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.fillRect(x, shore + 2 + (x % 4), 1, 1);
    }
  }
  // Precipitation.
  if (sky.weather === 'rain') {
    c.fillStyle = 'rgba(214,226,255,0.75)';
    for (let k = 0; k < cw * 0.9; k++) {
      const sx = hash2(k, 1, 31) * (cw + 20);
      const sp = 60 + hash2(k, 2, 31) * 40;
      const y = ((hash2(k, 3, 31) * ch + t * sp) % (ch + 6)) - 3;
      const x = Math.floor(sx - (y * 0.35)) % (cw + 20);
      for (let j = 0; j < 3; j++) c.fillRect(x - Math.floor(j * 0.35), Math.floor(y) + j, 1, 1);
    }
  } else if (sky.weather === 'snow') {
    c.fillStyle = 'rgba(255,255,255,0.95)';
    for (let k = 0; k < cw * 0.6; k++) {
      const sp = 6 + hash2(k, 2, 41) * 6;
      const y = ((hash2(k, 3, 41) * ch + t * sp) % (ch + 2)) - 1;
      const x = Math.floor(hash2(k, 1, 41) * cw + Math.sin(t * 0.8 + k) * 2);
      c.fillRect(x, Math.floor(y), 1, 1);
    }
  } else if (sky.phase === 'day' && sky.weather === 'clear') {
    // an occasional pair of birds
    const bu = ((t * 0.12) % 12) - 2;
    const bx = (bu - w.u0) * TU;
    const by = ch * 0.3 + Math.sin(t) * 2;
    c.fillStyle = 'rgba(40,40,60,0.8)';
    for (const [ox, oy] of [
      [0, 0],
      [6, 3],
    ]) {
      const flap = Math.sin(t * 8 + ox) > 0 ? 1 : 0;
      c.fillRect(bx + ox - 1, by + oy - flap, 1, 1);
      c.fillRect(bx + ox, by + oy, 1, 1);
      c.fillRect(bx + ox + 1, by + oy - flap, 1, 1);
    }
  }
  return canvas;
}

function disc(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: RGB, rim: RGB) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (d > r * r) continue;
      c.fillStyle = css(d > (r - 1) * (r - 1) ? rim : col);
      c.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
    }
}
