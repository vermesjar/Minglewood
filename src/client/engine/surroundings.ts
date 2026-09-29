/**
 * What lies around the town: it stands on an island in a calm sea. Behind the ground layer (whose skirt goes
 * down to the waterline, SEA_DROP art px below the ground) the view draws the sea — clear by the island, paling
 * into mist as it recedes up the view — a horizon a little above the island's far corner with low hills along
 * it, and the sky above. Everything follows the time of day (stars come out at night) and is anchored to the
 * world, so it pans with the town.
 */
import { isoToScreen } from '@shared/iso';
import { hash2 } from '@shared/world/builders';
import { SEA_DROP } from './ground';
import type { Sky } from './weather';

interface Palette {
  /** The sky, overhead and at the horizon. */
  sky: [string, string];
  /** The sea by the island, and far out where it meets the mist. */
  near: string;
  far: string;
  shallow: string;
  /** The far hills: the nearer range, the farther one. */
  hill: [string, string];
  foam: string;
}

const PALETTES: Record<Sky['phase'], Palette> = {
  day: { sky: ['#8ccbe8', '#e3f0ea'], near: '#3f95c6', far: '#a6d3e0', shallow: '#8ad6e4', hill: ['#8db5ae', '#b2cfd0'], foam: '#f4fcff' },
  dawn: { sky: ['#d9aeb4', '#fbe2cd'], near: '#6a9dc2', far: '#dcc4c6', shallow: '#a3d0dc', hill: ['#ae98a3', '#d2babb'], foam: '#fff3ec' },
  dusk: { sky: ['#5f5390', '#efb08e'], near: '#4f6c9c', far: '#cf9c9a', shallow: '#86a6c6', hill: ['#6a5577', '#a07b8f'], foam: '#f7e1dc' },
  night: { sky: ['#141c3d', '#3a4270'], near: '#243d74', far: '#3c4979', shallow: '#3c6199', hill: ['#252a4b', '#343a62'], foam: '#c7d6f2' },
};

/** The flat fill behind everything (screen space): the sky's overhead colour. */
export function skyColor(sky: Sky): string {
  return PALETTES[sky.phase].sky[0];
}

/**
 * Where the sea meets the sky: art px below the island's far corner, so the far woods stand against the sky
 * and the sea opens out beside the island.
 */
const HORIZON = 60;

/** Low hills along the horizon: x offset from the island's far corner, width and height (art px). */
const HILLS: Array<{ x: number; w: number; h: number; far: boolean }> = [
  { x: -1500, w: 900, h: 46, far: true },
  { x: -900, w: 700, h: 70, far: true },
  { x: -620, w: 520, h: 38, far: false },
  { x: 380, w: 980, h: 84, far: true },
  { x: 900, w: 560, h: 44, far: false },
  { x: 1500, w: 820, h: 58, far: true },
  { x: -80, w: 420, h: 30, far: false },
];

function hillPath(c: CanvasRenderingContext2D, bx: number, by: number, w: number, h: number, seed: number) {
  c.beginPath();
  c.moveTo(bx - w / 2, by + 1);
  const n = 32;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // a soft mound with a few shoulders
    const env = Math.sin(t * Math.PI) ** 0.7;
    const bumps = 1 + 0.16 * Math.sin(t * 7 + seed) + 0.08 * Math.sin(t * 19 + seed * 2.3);
    c.lineTo(bx - w / 2 + t * w, by - h * env * bumps);
  }
  c.lineTo(bx + w / 2, by + 1);
  c.closePath();
}

/**
 * Sky, horizon, sea and the island's foot, in world space (the camera transform already applied), under the
 * ground layer. `view`: the visible world rectangle; `t`: seconds (foam and stars move).
 */
export function drawSurroundings(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  sky: Sky,
  view: { l: number; t: number; r: number; b: number },
  t: number,
  still: boolean,
) {
  const p = PALETTES[sky.phase];
  const top = isoToScreen(0, 0);
  const hy = top.y + HORIZON; // the horizon
  const l = view.l - 8;
  const r = view.r + 8;
  // sky: overhead colour high up, paling to the horizon haze
  if (view.t < hy) {
    const g = c.createLinearGradient(0, hy - 700, 0, hy);
    g.addColorStop(0, p.sky[0]);
    g.addColorStop(1, p.sky[1]);
    c.fillStyle = g;
    c.fillRect(l, Math.min(view.t, hy - 700) - 8, r - l, hy - Math.min(view.t, hy - 700) + 9);
    if (sky.phase === 'night' || sky.phase === 'dusk') drawStars(c, hy, sky, t, still);
  }
  // sea: haze at the horizon, clearing toward the island and in front of it
  if (view.b > hy) {
    const g = c.createLinearGradient(0, hy, 0, top.y + SEA_DROP + H * 8);
    g.addColorStop(0, p.sky[1]);
    g.addColorStop(0.18, p.far);
    g.addColorStop(0.75, p.near);
    g.addColorStop(1, p.near);
    c.fillStyle = g;
    c.fillRect(l, hy, r - l, Math.max(0, view.b - hy) + 8);
    // ripples: short light strokes, closer together and fainter toward the horizon, drifting slowly
    c.save();
    c.fillStyle = p.foam;
    const drift = still ? 0 : t * 4;
    for (let row = 0; row < 90; row++) {
      const d = row / 90; // 0 at the horizon
      const y = hy + 6 + d * d * 2400;
      if (y < view.t - 4 || y > view.b + 4) continue;
      const gap = 40 + d * 180;
      const off = hash2(row, 0, 72) * gap + drift * (0.3 + d);
      c.globalAlpha = 0.08 + d * 0.14;
      for (let x = l - (((l - off) % gap) + gap) % gap; x < r; x += gap) {
        const j = hash2(Math.floor((x - off) / gap), row, 73);
        if (j < 0.45) continue;
        c.fillRect(Math.round(x + j * gap * 0.5), Math.round(y), 3 + Math.round(d * 9 * j), 1);
      }
    }
    c.restore();
  }
  // hills along the horizon, the farther ones paler, mist at their feet
  for (const [i, hl] of HILLS.entries()) {
    const bx = top.x + hl.x;
    if (bx + hl.w / 2 < l || bx - hl.w / 2 > r) continue;
    hillPath(c, bx, hy, hl.w, hl.h, i * 1.7 + 0.4);
    const hg = c.createLinearGradient(0, hy - hl.h, 0, hy);
    hg.addColorStop(0, hl.far ? p.hill[1] : p.hill[0]);
    hg.addColorStop(1, p.sky[1]);
    c.fillStyle = hg;
    c.fill();
  }

  // the island's foot: shallows round it and foam where the sea laps the skirt
  const L = isoToScreen(0, H);
  const B = isoToScreen(W, H);
  const R = isoToScreen(W, 0);
  const front = (off: number) => {
    c.beginPath();
    c.moveTo(L.x - off * 2, L.y + SEA_DROP - off);
    c.lineTo(B.x, B.y + SEA_DROP + off);
    c.lineTo(R.x + off * 2, R.y + SEA_DROP - off);
  };
  c.save();
  c.lineJoin = 'round';
  c.strokeStyle = p.shallow;
  for (const [w, a] of [
    [40, 0.22],
    [22, 0.35],
    [10, 0.5],
  ] as const) {
    c.globalAlpha = a;
    c.lineWidth = w;
    front(2);
    c.stroke();
  }
  // foam: broken lines drifting slowly along the shore
  c.strokeStyle = p.foam;
  c.lineWidth = 1.2;
  c.globalAlpha = 0.85;
  c.setLineDash([7, 5, 3, 6]);
  c.lineDashOffset = still ? 0 : -t * 3;
  front(2);
  c.stroke();
  c.globalAlpha = 0.4;
  c.setLineDash([4, 9, 2, 12]);
  c.lineDashOffset = still ? 0 : t * 2;
  front(6);
  c.stroke();
  c.restore();
}

/** Stars above the horizon at night (fewer at dusk), twinkling slowly, thinning toward the haze. */
function drawStars(c: CanvasRenderingContext2D, hy: number, sky: Sky, t: number, still: boolean) {
  const k = sky.phase === 'night' ? 1 : 0.3;
  c.save();
  for (let i = 0; i < 160; i++) {
    const x = (hash2(i, 1, 71) - 0.5) * 4200;
    const d = hash2(i, 2, 71);
    const y = hy - 30 - d * 640;
    const tw = still ? 0.8 : 0.55 + 0.45 * Math.sin(t * (0.5 + hash2(i, 3, 71)) + i);
    c.globalAlpha = k * tw * Math.min(1, d * 2.5);
    c.fillStyle = hash2(i, 4, 71) > 0.8 ? '#ffe9c4' : '#e8efff';
    const s = hash2(i, 5, 71) > 0.9 ? 1.5 : 1;
    c.fillRect(Math.round(x), Math.round(y), s, s);
  }
  c.restore();
}
