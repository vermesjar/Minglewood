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
/**
 * The town stands on an island: a thick skirt of earth and rock under its front edges, going down into the sea
 * (WorldView draws the sea, the mist and the far hills around it at this depth below the ground).
 */
export const SEA_DROP = 46;
const CLIFF = SEA_DROP + 3;
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
  /**
   * Moving water (outdoors): ripple-crest and sparkle frames over the lake at art density (1 px = 1 art px),
   * phases of one travelling wave; the view cross-fades them. `x`, `y`: the frames' top-left in art space.
   */
  water?: { frames: HTMLCanvasElement[]; x: number; y: number };
  /** Still streaming in (outdoors): the detailed raster fills in over a flat first coat, a slice per frame. */
  pending?: boolean;
  /** Resolves when the layer is complete. */
  done?: Promise<void>;
  /** Finish the remaining work synchronously (review renders). */
  finishNow?: () => void;
  /** Where the camera is (art-space y), so the ground streams in there first. */
  focusY?: number;
}

/** The travelling ripple on open water at phase `ph` (radians); crests where it exceeds ~1.4. */
const rippleAt = (px: number, py: number, ph: number) =>
  Math.sin(px * 0.16 + py * 0.62 + Math.sin(py * 0.05 + px * 0.01) * 3 + ph) + 0.6 * Math.sin(px * 0.035 - py * 0.21 + ph * 0.5);
const RIPPLE_FRAMES = 6;

type RGB = [number, number, number];
const C = (hex: string): RGB => hexToRgb(hex);

const PAL = {
  grass: C('#7cc26a'),
  grass2: C('#6db35d'),
  grassDark: C('#5f9f52'),
  grassLight: C('#8fd07a'),
  meadow: C('#86c872'),
  path: C('#d8c6a6'),
  trail: C('#cfb07c'),
  trailDark: C('#ad8f5f'),
  trailLight: C('#e2cb98'),
  pathDark: C('#bca885'),
  pathLight: C('#e8dcc2'),
  curb: C('#a8977a'),
  pathJoint: C('#9f8a67'),
  plaza: C('#e6d3b3'),
  plaza2: C('#dfc9a5'),
  plazaJoint: C('#b7a07b'),
  plazaRing: C('#cdb28a'),
  coping: C('#e4ddcd'),
  quay: C('#a39a8b'),
  quayDark: C('#7d7568'),
  quayWet: C('#5b6664'),
  sand: C('#efd9a4'),
  wetSand: C('#d9bd86'),
  foam: C('#e9f7fb'),
  shallow: C('#74c8e6'),
  water: C('#58b4de'),
  mid: C('#4aa3d4'),
  deep: C('#3f96c9'),
  abyss: C('#347fb6'),
  lily: C('#5fae5a'),
  lilyDark: C('#3f8a47'),
  dock: C('#b98250'),
  dirt: C('#8a5a3b'),
  dirtDark: C('#6b4428'),
  stone: C('#8f8578'),
};

const FLOWER_Y = C('#ffd23f');
const FLOWER_P = C('#ff9ec4');
const FLOWER_W = C('#fffaf0');
const LILY_FLOWER = C('#f7a8c8');

function shade([r, g, b]: RGB, k: number): RGB {
  return [r * k, g * k, b * k];
}

const frac = (v: number) => v - Math.floor(v);
const isWater = (c: string) => c === 'w' || c === 'W';
const isLand = (c: string) => c !== ' ' && !isWater(c);
const isPaved = (c: string) => c === 'p' || c === 'P' || c === 'd';

/** Hashed lattice values, cached per seed (value noise reads each one thousands of times). */
const LAT = 160;
const LAT_OFF = 8;
const lattices: Array<Float32Array | undefined> = [];
function lattice(x: number, y: number, seed: number): number {
  const ix = x + LAT_OFF;
  const iy = y + LAT_OFF;
  if (ix < 0 || iy < 0 || ix >= LAT || iy >= LAT || seed < 0 || seed > 255) return hash2(x, y, seed);
  let a = lattices[seed];
  if (!a) {
    a = new Float32Array(LAT * LAT).fill(-1);
    lattices[seed] = a;
  }
  const i = iy * LAT + ix;
  let v = a[i];
  if (v < 0) {
    v = hash2(x, y, seed);
    a[i] = v;
  }
  return v;
}

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
  const a = lattice(x0, y0, seed);
  const b = lattice(x0 + 1, y0, seed);
  const c = lattice(x0, y0 + 1, seed);
  const d = lattice(x0 + 1, y0 + 1, seed);
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
    if (f > 0.985) return hash2(s.px, s.py, 5) > 0.5 ? FLOWER_Y : FLOWER_P;
    if (f < 0.012) return FLOWER_W;
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
  // Square setts, four to a tile, exactly on the tile grid: a strong joint along every tile edge (drawn on
  // each tile's two upper edges, so every edge gets one), a finer one between the setts inside it.
  if (fx < 0.045 || fy < 0.045) return PAL.pathJoint;
  const u = frac(fx * 2);
  const v = frac(fy * 2);
  if ((u < 0.055 && fx > 0.25) || (v < 0.055 && fy > 0.25)) return PAL.pathDark;
  const k = 0.94 + hash2(s.tx * 2 + Math.floor(fx * 2), s.ty * 2 + Math.floor(fy * 2), 5) * 0.1;
  // each sett is lit along its upper edges and shaded along its lower ones
  if (u > 0.9 || v > 0.9) return shade(PAL.path, 0.93 * k);
  if ((u > 0.055 && u < 0.17) || (v > 0.055 && v < 0.17)) return shade(PAL.pathLight, k);
  return shade(PAL.path, k);
}

/**
 * A garden trail: packed earth and fine gravel, lighter where feet wear it down the middle, with scattered
 * pebbles; `v` is the trail's coverage here (its edge is ~0.4), so the margins darken into the grass.
 */
function trailColor(s: Sample, v: number): RGB {
  const n = vnoise(s.gx, s.gy, 0.9, 41) + (dither(s.sx, s.sy) - 0.5) * 0.12;
  let base = v < 0.47 ? PAL.trailDark : v > 0.62 && n > 0.45 ? PAL.trailLight : PAL.trail;
  const h = hash2(s.px, s.py, 43);
  if (h > 0.985) base = shade(PAL.trailLight, 1.06); // a pale pebble…
  else if (h < 0.02 || hash2(s.px, s.py - 1, 43) > 0.985) base = shade(base, 0.82); // …and its shadow
  return base;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Plaza paving: one flagstone per tile, as a Habbo floor is laid: a dark joint on every tile edge, each slab
 * lit along its upper edges and shaded along its lower ones, alternate slabs a shade apart, so the ground
 * shows the grid people and furniture stand on. The slabs round the fountain are a darker stone.
 */
function plazaColor(s: Sample, fountain: Box | null): RGB {
  const fx = frac(s.gx);
  const fy = frac(s.gy);
  if (fx < 0.045 || fy < 0.045) return PAL.plazaJoint;
  const ring = !!fountain && s.tx >= fountain.x0 - 1 && s.tx < fountain.x1 + 1 && s.ty >= fountain.y0 - 1 && s.ty < fountain.y1 + 1;
  const base = ring ? PAL.plazaRing : (s.tx + s.ty) % 2 ? PAL.plaza : PAL.plaza2;
  const k = 0.975 + hash2(s.tx, s.ty, 6) * 0.05;
  if (fx < 0.11 || fy < 0.11) return shade(base, 1.06 * k);
  if (fx > 0.94 || fy > 0.94) return shade(base, 0.9 * k);
  const g = hash2(s.px, s.py, 7);
  return shade(base, k * (g > 0.975 ? 0.95 : g < 0.015 ? 1.04 : 1));
}

function landColor(c: string, s: Sample, T: (x: number, y: number) => string, fountain: Box | null): RGB {
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
      // decking on the tile grid: four planks to a tile, every plank butted on the tile edge (a joist under
      // each), so the pier shows its tiles like the streets do
      const fx = frac(s.gx);
      const fy = frac(s.gy);
      if (fx < 0.045 || fy < 0.045) return shade(PAL.dirtDark, 0.85);
      if (frac(fy * 4) < 0.1) return PAL.dirtDark;
      const plank = Math.floor(fy * 4);
      const nail = fx > 0.07 && fx < 0.1 && frac(fy * 4) > 0.4 && frac(fy * 4) < 0.6;
      return nail ? PAL.dirtDark : shade(PAL.dock, 0.95 + hash2(s.tx, plank + s.ty * 4, 1) * 0.1);
    }
    default:
      return PAL.grass;
  }
}

/** Sedimentary bands in the island's skirt, top to bottom (they repeat). */
const STRATA = [C('#a87a4d'), C('#8d5f3b'), C('#c39668'), C('#7a5134'), C('#b3875a'), C('#94663f')];
const SOIL = C('#6a452c');
const ROOT = C('#4a2f1c');
const ROCK = C('#8b8276');
const ROCK_DARK = C('#6d665d');
const ROCK_WET = C('#546360');
const FOAM = C('#f2fbfd');

/**
 * The island's skirt, `k` art px below its edge (`along`: tiles along that edge; `right`: the right-hand face,
 * turned from the light): a grass lip with tufts hanging over, dark topsoil threaded with roots, wavy bands of
 * sediment, then bedrock that darkens and goes green where the sea wets it, and a broken line of foam at the
 * waterline.
 */
function skirtColor(k: number, along: number, right: boolean, px: number, py: number): RGB | null {
  if (k > SEA_DROP + 1) return null;
  const col = Math.floor(along * 16); // one art px column along the face
  const lit = right ? 0.8 : 1;
  if (k >= SEA_DROP) return hash2(col >> 1, k, 61) > 0.3 ? FOAM : shade(ROCK_WET, 0.9);
  // the grass lip, with tufts hanging over the soil
  const tuft = hash2(col, 0, 53) > 0.72 ? 1 + Math.floor(hash2(col, 1, 53) * 3) : 0;
  if (k <= 2 + tuft) return shade(k === 1 ? PAL.grass : PAL.grassDark, lit * (k > 2 ? 0.85 : 1));
  // roots: a few strands hanging down through the topsoil
  const rootLen = hash2(col >> 1, 2, 54) > 0.86 ? 5 + Math.floor(hash2(col >> 1, 3, 54) * 12) : 0;
  const wobble = Math.round(Math.sin(k * 0.7 + col) * 0.6);
  if (rootLen && k < 3 + rootLen && ((col + wobble) & 1) === 0) return shade(ROOT, lit);
  const wav = Math.sin(along * 1.3) * 1.6 + (vnoise(along * 4, 0.5, 1.7, 55) - 0.5) * 5;
  const d = k + wav;
  if (d < 12) {
    const pebble = hash2(px, py, 56) > 0.965;
    return shade(pebble ? PAL.dirt : SOIL, lit * (0.96 + hash2(col, k, 57) * 0.06));
  }
  if (d < 34) {
    const band = Math.floor((d - 12) / 5.4);
    const into = (d - 12) / 5.4 - band;
    const base = STRATA[band % STRATA.length];
    // each band's top is lit, its bottom in shadow; the odd stone embedded in it
    const k2 = into < 0.18 ? 1.08 : into > 0.85 ? 0.88 : 1;
    const stone = hash2(px >> 1, py >> 1, 58) > 0.975;
    return shade(stone ? ROCK : base, lit * k2);
  }
  // bedrock: blocky, cracked, wetter toward the sea
  const row = Math.floor((d - 34) / 5);
  const cell = Math.floor(along * 3 + hash2(row, 0, 59) * 0.9);
  const crack = frac(along * 3 + hash2(row, 0, 59) * 0.9) < 0.07 || frac((d - 34) / 5) < 0.12;
  const wet = k > SEA_DROP - 7;
  const base = wet ? ROCK_WET : hash2(cell, row, 60) > 0.5 ? ROCK : shade(ROCK, 0.93);
  return shade(crack ? ROCK_DARK : base, lit * (wet ? 0.9 : 1) * (1 - Math.max(0, k - 34) * 0.006));
}

function waterColor(depth: number, s: Sample): RGB {
  // four depth tones from the (interpolated) distance to shore; band edges curve with the shore and are
  // dithered so they read as a gradient in pixel art, not stair-steps
  const d = depth + (dither(s.sx, s.sy) - 0.5) * 0.35;
  let base = d < 0.9 ? PAL.shallow : d < 2.0 ? PAL.water : d < 3.4 ? PAL.mid : d < 4.8 ? PAL.deep : PAL.abyss;
  // the troughs of the ripple stay in the ground (a slow texture); crests and sparkles move on their own
  // layer (GroundLayer.water)
  if (rippleAt(s.px, s.py, 0) < -1.45) base = shade(base, 0.95);
  return base;
}

/**
 * Outdoor terrain rasterizer. `scale` is canvas px per art px: 2 matches the art density (64 px per floor
 * tile); the layer reports it so the view can draw it at world size.
 */
/**
 * The town's ground is expensive to rasterize (millions of pixels) and never changes while you're there:
 * built once per scene (and object layout, which casts the contact shadows) and scale, then reused.
 */
const outdoorCache = new Map<string, { key: string; layer: GroundLayer }>();
/** How long the last town ground took to build (ms): the terrain raster and the lake's ripple frames. */
export const groundStats = { raster: 0, raster2: 0, water: 0, longestSlice: 0, flat: 0 };

export function renderOutdoorGround(scene: SceneDef, scale = 1): GroundLayer {
  let sig = 0;
  for (const o of scene.objects) sig = (Math.imul(sig, 31) + o.x * 131 + o.y * 7 + (o.w ?? 1) * 3 + (o.eventDecor ? 1 : 0) + o.id.length) | 0;
  const key = `${scale}|${scene.width}x${scene.height}|${scene.objects.length}|${sig}|${scene.tiles.join('').length}`;
  const hit = outdoorCache.get(scene.id);
  if (hit && hit.key === key) return hit.layer;
  const layer = streamOutdoor(scene, scale);
  outdoorCache.set(scene.id, { key, layer });
  return layer;
}

/**
 * The town's ground, built without ever stalling a frame: a flat coat of tile colours at once; then the
 * detailed raster at art density, band by band nearest the camera first; then the lake's ripple frames; then
 * (for `scale` 2) the crisp 2× raster, built off to the side and swapped in whole when it's done. Each piece
 * of work is a few-ms slice between frames.
 */
function streamOutdoor(scene: SceneDef, scale: number): GroundLayer {
  const t0 = performance.now();
  const lo = rasterizeOutdoor(scene, 1, true);
  const layer: GroundLayer = { canvas: lo.canvas, minX: lo.minX, minY: lo.minY, wallHits: [], scale: 1, pending: true };
  groundStats.flat = performance.now() - t0;
  groundStats.raster = 0;
  groundStats.raster2 = 0;
  groundStats.water = 0;
  groundStats.longestSlice = 0;
  let hi: ReturnType<typeof rasterizeOutdoor> | null = null;
  let water: ReturnType<typeof waterMotionJob> | null = null;
  const jobs: Array<(budget: number) => boolean> = [
    (b) => {
      const t = performance.now();
      const done = lo.step(b, layer.focusY);
      groundStats.raster += performance.now() - t;
      return done;
    },
    (b) => {
      const t = performance.now();
      water ??= lo.water();
      const done = water.step(b);
      groundStats.water += performance.now() - t;
      if (done) layer.water = water.result();
      return done;
    },
  ];
  if (scale > 1)
    jobs.push((b) => {
      const t = performance.now();
      hi ??= rasterizeOutdoor(scene, scale, false);
      const done = hi.step(b, layer.focusY);
      groundStats.raster2 += performance.now() - t;
      if (done) {
        layer.canvas = hi.canvas;
        layer.scale = scale;
      }
      return done;
    });
  let job = 0;
  /** Up to `budget` ms of the remaining work; true once everything is done. */
  const step = (budget: number): boolean => {
    const start = performance.now();
    while (job < jobs.length && performance.now() - start < budget) {
      if (jobs[job](Math.max(1, budget - (performance.now() - start)))) job++;
    }
    groundStats.longestSlice = Math.max(groundStats.longestSlice, performance.now() - start);
    if (job < jobs.length) return false;
    layer.pending = false;
    return true;
  };
  layer.finishNow = () => {
    while (!step(7));
  };
  // one slice per macrotask, yielding to the event loop in between so frames and input keep flowing
  layer.done = new Promise<void>((resolve) => {
    const run = () => {
      if (step(7)) resolve();
      else setTimeout(run, 0);
    };
    setTimeout(run, 0);
  });
  return layer;
}

function rasterizeOutdoor(scene: SceneDef, scale: number, flatCoat: boolean) {
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
  const flatTiles: string[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) flatTiles.push(scene.tiles[y]?.[x] ?? ' ');
  const T = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? ' ' : flatTiles[y * W + x]);
  // Natural edges (water, sand, grass) are drawn from a smoothed field, not tile by tile, so shores curve;
  // streets, the plaza and the pier keep their crisp tile edges. Only tiles near water pay for it.
  const natural = (c: string) => c === 'w' || c === 'W' || c === 's' || c === 'g' || c === 'h' || c === 'm' || c === 't';
  const wet = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (['w', 'W', 's'].includes(T(x + dx, y + dy))) wet[y * W + x] = 1;
  // Blurred water / sand coverage (tile resolution, ~1-tile Gaussian): its 0.5 contour is a smooth curve
  // that follows the authored shore, so banks bend instead of stepping tile by tile.
  const blur = (src: Float32Array) => {
    const k = [1, 4, 6, 4, 1];
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    const at = (a: Float32Array, x: number, y: number) => a[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tmp[y * W + x] = k.reduce((acc, w, i) => acc + w * at(src, x + i - 2, y), 0) / 16;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = k.reduce((acc, w, i) => acc + w * at(tmp, x, y + i - 2), 0) / 16;
    return out;
  };
  const waterF = new Float32Array(W * H);
  const sandF = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = T(x, y);
      waterF[y * W + x] = isWater(c) ? 1 : 0;
      sandF[y * W + x] = isWater(c) || c === 's' ? 1 : 0;
    }
  const waterB = blur(waterF);
  // Garden trails: a lightly blurred coverage field whose ~0.4 contour wanders, so trails have soft, organic
  // edges instead of tile steps. `trailish`: tiles on or beside one (only they pay for it).
  const trailF = new Float32Array(W * H);
  const trailish = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (T(x, y) === 't') {
        trailF[y * W + x] = 1;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) trailish[(y + dy) * W + x + dx] = 1;
      }
  const trailB = (() => {
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    const at = (a: Float32Array, x: number, y: number) => a[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tmp[y * W + x] = (at(trailF, x - 1, y) + 2 * at(trailF, x, y) + at(trailF, x + 1, y)) / 4;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = (at(tmp, x, y - 1) + 2 * at(tmp, x, y) + at(tmp, x, y + 1)) / 4;
    return out;
  })();
  const sandB = blur(sandF);
  const sampleF = (f: Float32Array, gx: number, gy: number) => {
    const cx = gx - 0.5;
    const cy = gy - 0.5;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const fx = cx - x0;
    const fy = cy - y0;
    const v = (x: number, y: number) => f[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    return (v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx) * (1 - fy) + (v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx) * fy;
  };
  const trailAt = (gx: number, gy: number) => sampleF(trailB, gx, gy) + (vnoise(gx, gy, 0.9, 37) - 0.5) * 0.2;
  const classAt = (gx: number, gy: number): string => {
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    const own = T(tx, ty);
    if (own !== ' ' && trailish[ty * W + tx] && (own === 't' || own === 'g' || own === 'h' || own === 'm')) {
      if (trailAt(gx, gy) > 0.4) return 't';
      if (own === 't') return 'g';
    }
    if (!natural(own) || !wet[ty * W + tx]) return own;
    // next to a street or the pier: keep the authored, crisp edge
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!natural(T(tx + dx, ty + dy)) && T(tx + dx, ty + dy) !== ' ') return own;
    const n = (vnoise(gx, gy, 0.8, 31) - 0.5) * 0.12;
    if (sampleF(waterB, gx, gy) + n > 0.5) return 'w';
    if (sampleF(sandB, gx, gy) + n * 0.8 > 0.5) return 's';
    return own === 's' || own === 'w' || own === 'W' ? 'g' : own;
  };
  const f = scene.objects.find((o) => o.sprite === 'fountain');
  const fountain = f ? footprint(f) : null;
  // distance to shore for water tiles (in tiles), for depth tones and lily pads
  const shore = new Float32Array(W * H).fill(99);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!isWater(T(x, y))) continue;
      let best = 99;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (isLand(T(x + dx, y + dy))) best = Math.min(best, Math.hypot(dx, dy));
      shore[y * W + x] = best;
    }

  // distance to shore, bilinear between tile centres (land counts as 0)
  const shoreAt = (gx: number, gy: number) => {
    const cx = gx - 0.5;
    const cy = gy - 0.5;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const fx = cx - x0;
    const fy = cy - y0;
    const v = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 4 : isWater(T(x, y)) ? Math.min(6, shore[y * W + x]) : 0);
    return (v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx) * (1 - fy) + (v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx) * fy;
  };

  // Only the map's diamond and the bank / cliff band under its front edges hold pixels: for each canvas
  // column, the rows between the diamond's top and its bottom plus the cliff (half the canvas is empty).
  const rowLo = new Int32Array(cw);
  const rowHi = new Int32Array(cw);
  for (let sx = 0; sx < cw; sx++) {
    const u = (minX + (sx + 0.5) / S) / 16; // x - y at this column
    const lo = Math.abs(u); // x + y at the diamond's top edge
    const hi = Math.min(2 * W - u, 2 * H + u); // …and its bottom edge
    if (hi < lo) {
      rowLo[sx] = 1;
      rowHi[sx] = 0;
      continue;
    }
    rowLo[sx] = Math.max(0, Math.floor((lo * 8 - minY) * S) - 1);
    rowHi[sx] = Math.min(ch - 1, Math.ceil((hi * 8 + CLIFF + WATER_DROP + 2 - minY) * S));
  }
  const iso = { x: 0, y: 0 };
  const toIso = (ax: number, ay: number) => {
    const a = ax / 16;
    const b = ay / 8;
    iso.x = (a + b) / 2;
    iso.y = (b - a) / 2;
    return iso;
  };
  const smp: Sample = { gx: 0, gy: 0, tx: 0, ty: 0, px: 0, py: 0, sx: 0, sy: 0 };

  /** Rasterize canvas rows [ya, yb) into `d` (a band buffer cw wide). */
  const rasterRows = (ya: number, yb: number, d: Uint8ClampedArray) => {
  for (let sy = ya; sy < yb; sy++) {
    for (let sx = 0; sx < cw; sx++) {
      if (sy < rowLo[sx] || sy > rowHi[sx]) continue;
      const ax = minX + (sx + 0.5) / S;
      const ay = minY + (sy + 0.5) / S;
      const px = Math.floor(ax - minX);
      const py = Math.floor(ay - minY);
      let rgb: RGB | null = null;

      const gi = toIso(ax, ay);
      const gx0 = gi.x;
      const gy0 = gi.y;
      const tx = Math.floor(gx0);
      const ty = Math.floor(gy0);
      const inMap = tx >= 0 && ty >= 0 && tx < W && ty < H;
      const c = inMap ? classAt(gx0, gy0) : ' ';
      smp.gx = gx0;
      smp.gy = gy0;
      smp.tx = tx;
      smp.ty = ty;
      smp.px = Math.floor((ax - minX) * 2);
      smp.py = Math.floor((ay - minY) * 2);
      smp.sx = sx;
      smp.sy = sy;
      if (isLand(c)) {
        rgb = c === 't' ? trailColor(smp, trailAt(gx0, gy0)) : landColor(c, smp, T, fountain);
        // a quay: pale coping stones along paving that meets the water, a joint every half tile
        if (c === 'p' || c === 'P') {
          const ex = frac(gx0);
          const ey = frac(gy0);
          const cope = 0.13;
          const along = ex > 1 - cope && isWater(T(tx + 1, ty)) ? gy0 : ey > 1 - cope && isWater(T(tx, ty + 1)) ? gx0 : ex < cope && isWater(T(tx - 1, ty)) ? gy0 : ey < cope && isWater(T(tx, ty - 1)) ? gx0 : -1;
          if (along >= 0) {
            const inner = ex > 1 - cope ? ex < 1 - cope + 0.03 : ey > 1 - cope ? ey < 1 - cope + 0.03 : ex < cope ? ex > cope - 0.03 : ey > cope - 0.03;
            rgb = frac(along * 2) < 0.05 || inner ? shade(PAL.coping, 0.84) : shade(PAL.coping, 0.97 + hash2(Math.floor(along * 2), tx + ty, 12) * 0.06);
          }
        }
        // grass trodden flat along a trail's margins
        if ((c === 'g' || c === 'h' || c === 'm') && trailish[ty * W + tx] && trailAt(gx0, gy0) > 0.3) rgb = shade(rgb, 0.93);
        if (c === 's' && wet[ty * W + tx]) {
          // the wet band just above the waterline
          const w2 = classAt(gx0 + 0.22, gy0 + 0.22);
          if (isWater(w2) || isWater(classAt(gx0 - 0.18, gy0 + 0.18)) || isWater(classAt(gx0 + 0.18, gy0 - 0.18))) rgb = PAL.wetSand;
        }
        // a soft shadow line where grass meets sand or a path, for readability
        const ex = frac(gx0);
        const ey = frac(gy0);
        if ((c === 'g' || c === 'h' || c === 'm') && (ex > 0.95 || ey > 0.95)) {
          const n = ex > 0.95 ? T(tx + 1, ty) : T(tx, ty + 1);
          if (n === 's') rgb = shade(rgb, 0.92);
        }
      } else {
        // Bank below a land tile edge?
        for (let k = 1; k <= WATER_DROP + 1 && !rgb; k++) {
          const u = toIso(ax, ay - k);
          if (Math.floor(u.x) < W && Math.floor(u.y) < H && isLand(classAt(u.x, u.y))) {
            const above = T(Math.floor(u.x), Math.floor(u.y));
            if (above === 'p' || above === 'P') {
              // the quay's dressed-stone face: blocks half a tile long, a wet dark line at the water
              const along = frac(u.x) > frac(u.y) ? u.y : u.x;
              const joint = frac(along * 2 + (k % 2) * 0.5) < 0.07;
              rgb = k > WATER_DROP ? PAL.quayWet : joint ? PAL.quayDark : shade(PAL.quay, (frac(u.x) > frac(u.y) ? 0.86 : 1) * (0.96 + hash2(Math.floor(along * 2), k, 13) * 0.08));
            } else rgb = k <= 1 ? PAL.dirt : PAL.dirtDark;
          }
        }
        if (!rgb) {
          const wv0 = toIso(ax, ay - WATER_DROP);
          const wv = { x: wv0.x, y: wv0.y };
          const wx = Math.floor(wv.x);
          const wy = Math.floor(wv.y);
          const wc = classAt(wv.x, wv.y);
          if (isWater(wc)) {
            const sd = shore[wy * W + wx] ?? 99;
            const ws: Sample = { ...smp, gx: wv.x, gy: wv.y, tx: wx, ty: wy };
            // depth follows the (interpolated) distance to shore, so every band forms smooth contours
            const depth = shoreAt(wv.x, wv.y) + (vnoise(wv.x, wv.y, 1.3, 33) - 0.5) * 0.9;
            rgb = waterColor(depth, ws);
            // a thin broken foam line where the water laps the sand
            const edge = shoreAt(wv.x, wv.y);
            if (edge < 0.32 && hash2(px >> 1, py, 8) > 0.35) rgb = PAL.foam;
            else if (edge < 0.55 && hash2(px, py >> 1, 9) > 0.8) rgb = shade(PAL.shallow, 1.1);
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
                  if (r < 0.08 && hash2(cx, cy, 22) > 0.6) rgb = LILY_FLOWER;
                }
              }
            }
          }
        }
      }
      if (!rgb) {
        // Diorama cliff under the map's front edges.
        for (let k = 1; k <= CLIFF && !rgb; k++) {
          if (inMap) break; // the cliff hangs only below the map's front edges
          const u = toIso(ax, ay - k);
          const ux = Math.floor(u.x);
          const uy = Math.floor(u.y);
          const onMap = ux >= 0 && uy >= 0 && ux < W && uy < H;
          if (!onMap) continue;
          const onFront = ux === W - 1 || uy === H - 1;
          if (!onFront) continue;
          const rightFace = frac(u.x) > frac(u.y);
          rgb = skirtColor(k, rightFace ? u.y : u.x, rightFace, px, py);
          break;
        }
      }
      if (!rgb) continue;
      const i = ((sy - ya) * cw + sx) * 4;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255;
    }
  }
  };

  // Soft contact shadows under objects, bucketed by the canvas rows they touch (drawn with their band).
  const shadows = scene.objects
    .filter((o) => !(o.sprite === 'reeds' || o.sprite === 'boat' || o.eventDecor))
    .map((o) => {
      const fp = footprint(o);
      const cx = (fp.x0 + fp.x1) / 2;
      const cy = (fp.y0 + fp.y1) / 2;
      const rw = ((fp.x1 - fp.x0 + fp.y1 - fp.y0) / 2) * 16 * (o.building ? 1.08 : 0.8);
      const x = (cx - cy) * 16 + (o.building ? -4 : 0);
      const y = (cx + cy) * 8 + (o.building ? 3 : 1);
      return { x, y, rw, building: !!o.building, y0: (y - rw / 2 - minY) * S, y1: (y + rw / 2 - minY) * S };
    });
  const shadowRows = (ya: number, yb: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, ya, cw, yb - ya);
    ctx.clip();
    ctx.scale(S, S);
    ctx.translate(-minX, -minY);
    for (const sh of shadows) {
      if (sh.y1 < ya || sh.y0 > yb) continue;
      ctx.fillStyle = sh.building ? 'rgba(40,30,50,0.20)' : 'rgba(40,30,50,0.16)';
      ctx.beginPath();
      ctx.ellipse(sh.x, sh.y, sh.rw, sh.rw / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  // A flat first coat, instantly: every tile its terrain's base colour, so the town is there from the first
  // frame while the detailed raster streams in over it.
  if (flatCoat) {
    ctx.save();
    ctx.scale(S, S);
    ctx.translate(-minX, -minY);
    const flat: Record<string, RGB> = { g: PAL.grass, h: PAL.grass2, m: PAL.meadow, p: PAL.path, t: PAL.trail, P: PAL.plaza, s: PAL.sand, w: PAL.water, W: PAL.deep, d: PAL.dock };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const col = flat[T(x, y)] ?? PAL.grass;
        ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        ctx.beginPath();
        ctx.moveTo((x - y) * 16, (x + y) * 8 - 0.5);
        ctx.lineTo((x + 1 - y) * 16 + 0.5, (x + 1 + y) * 8);
        ctx.lineTo((x - y) * 16, (x + y + 2) * 8 + 0.5);
        ctx.lineTo((x - y - 1) * 16 - 0.5, (x + y + 1) * 8);
        ctx.closePath();
        ctx.fill();
      }
    ctx.restore();
  }

  // ~20k pixels a band, so one slice stays a few ms whatever the scale; the band nearest the camera goes next
  const BAND = Math.max(2, Math.floor(20000 / cw));
  const todo: number[] = [];
  for (let y = 0; y < ch; y += BAND) todo.push(y);
  const buf = new ImageData(cw, BAND);
  /** Up to `budget` ms of bands; true once all are done. `focusY`: the camera's art-space y. */
  const step = (budget: number, focusY?: number): boolean => {
    const start = performance.now();
    while (todo.length && performance.now() - start < budget) {
      const fy = focusY === undefined ? ch / 2 : (focusY - minY) * S;
      let best = 0;
      for (let i = 1; i < todo.length; i++) if (Math.abs(todo[i] + BAND / 2 - fy) < Math.abs(todo[best] + BAND / 2 - fy)) best = i;
      const ya = todo[best];
      todo[best] = todo[todo.length - 1];
      todo.pop();
      const yb = Math.min(ch, ya + BAND);
      buf.data.fill(0);
      rasterRows(ya, yb, buf.data);
      ctx.putImageData(buf, 0, ya, 0, 0, cw, yb - ya);
      shadowRows(ya, yb);
    }
    return todo.length === 0;
  };
  return { canvas, minX, minY, step, water: () => waterMotionJob(scene, classAt, shoreAt, minX, minY) };
}

/**
 * Ripple frames for the lake: for every open-water art pixel (not the bank drop), a light crest where the
 * travelling ripple peaks at that frame's phase, and a rare bright sparkle on a crest.
 */
function waterMotionJob(
  scene: SceneDef,
  classAt: (gx: number, gy: number) => string,
  shoreAt: (gx: number, gy: number) => number,
  gMinX: number,
  gMinY: number,
): { step: (budget: number) => boolean; result: () => GroundLayer['water'] } {
  const { width: W, height: H } = scene;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!isWater(terrainAt(scene, x, y))) continue;
      x0 = Math.min(x0, (x - y - 1) * 16);
      x1 = Math.max(x1, (x - y + 1) * 16);
      y0 = Math.min(y0, (x + y) * 8);
      y1 = Math.max(y1, (x + y + 2) * 8 + WATER_DROP);
    }
  if (x0 === Infinity) return { step: () => true, result: () => undefined };
  const w = Math.ceil(x1 - x0);
  const h = Math.ceil(y1 - y0);
  const frames = Array.from({ length: RIPPLE_FRAMES }, () => {
    const cv = makeCanvas(w, h);
    return { cv, img: cv.getContext('2d')!.createImageData(w, h) };
  });
  const iso = { x: 0, y: 0 };
  const toIso = (ax: number, ay: number) => {
    const a = ax / 16;
    const b = ay / 8;
    iso.x = (a + b) / 2;
    iso.y = (b - a) / 2;
    return iso;
  };
  let py = 0;
  const step = (budget: number) => {
    const start = performance.now();
    for (; py < h && performance.now() - start < budget; py++)
      for (let px = 0; px < w; px++) {
        const ax = x0 + px + 0.5;
        const ay = y0 + py + 0.5;
        const wv = toIso(ax, ay - WATER_DROP);
        const wx = wv.x;
        const wy = wv.y;
        const tt = terrainAt(scene, Math.floor(wx), Math.floor(wy));
        if (tt !== 'w' && tt !== 'W' && tt !== 's') continue; // grass and paths: no water here
        if (!isWater(classAt(wx, wy))) continue;
        // not on the bank drop under a land edge
        let bank = false;
        for (let k = 1; k <= WATER_DROP + 1 && !bank; k++) {
          const u = toIso(ax, ay - k);
          if (isLand(classAt(u.x, u.y))) bank = true;
        }
        if (bank || shoreAt(wx, wy) < 0.55) continue;
        // same art-space hashing coordinates as the ground rasterizer
        const hx = Math.floor((ax - gMinX) * 2);
        const hy = Math.floor((ay - gMinY) * 2);
        const i = (py * w + px) * 4;
        for (let f = 0; f < RIPPLE_FRAMES; f++) {
          const wave = rippleAt(hx, hy, (f / RIPPLE_FRAMES) * Math.PI * 2);
          if (wave <= 1.42) continue;
          const d = frames[f].img.data;
          const spark = wave > 1.5 && hash2(hx >> 1, hy + f * 131, 41) > 0.94;
          d[i] = spark ? 244 : 214;
          d[i + 1] = spark ? 251 : 240;
          d[i + 2] = 255;
          d[i + 3] = spark ? 235 : 70;
        }
      }
    return py >= h;
  };
  return {
    step,
    result: () => ({ frames: frames.map(({ cv, img }) => (cv.getContext('2d')!.putImageData(img, 0, 0), cv)), x: x0, y: y0 }),
  };
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
