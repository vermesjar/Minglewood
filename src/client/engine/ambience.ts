/**
 * Ambience: the world living on its own. Time of day and lighting, seasonal weather, wildlife
 * that reacts to people, and Biscuit the town cat. Everything here is cosmetic and local to
 * the renderer, but deterministic where it matters (weather, the cat's rounds) so everyone in
 * a company sees the same sky and the same cat.
 */
import { isoToScreen } from '@shared/iso';
import type { SceneDef, SceneObject } from '@shared/world/scene';
import { terrainAt } from '@shared/world/scene';
import type { WalkGrid } from '@shared/world/walkGrid';
import { findPath, positionAlong, type Tile } from '@shared/world/pathfinding';
import type { ScreenRect } from './depth';
import { makeCanvas } from './sprites/painter';

export type RGB = [number, number, number];

/** A small world-space thing that takes part in depth sorting (birds, the cat). */
export interface Mob {
  id: string;
  x: number;
  y: number;
  rect: ScreenRect;
  draw(c: CanvasRenderingContext2D): void;
  label?: string;
  onClick?(): void;
}

export interface Light {
  x: number; // art px
  y: number;
  r: number;
  color: RGB;
  intensity: number;
  objectId?: string;
  flicker?: number;
  /** Only shines at night (street lamps); otherwise always on (fireplaces, neon). */
  nightOnly?: boolean;
  until?: number;
}

export type WeatherKind = 'clear' | 'rain' | 'snow' | 'leaves' | 'petals';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

/** Local time of day in hours (0–24). `?hour=21` previews another time. */
export function clockHour(now = new Date()): number {
  const o = params.get('hour');
  if (o !== null && !Number.isNaN(Number(o))) return ((Number(o) % 24) + 24) % 24;
  return now.getHours() + now.getMinutes() / 60;
}

export function seasonOf(d = new Date()): Season {
  const m = d.getMonth();
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Weather changes every 3 hours and is the same for everyone. `?weather=rain` previews. */
export function weatherAt(d = new Date()): WeatherKind {
  const o = params.get('weather') as WeatherKind | null;
  if (o && ['clear', 'rain', 'snow', 'leaves', 'petals'].includes(o)) return o;
  const r = hash(Math.floor(d.getTime() / (3 * 3600_000)));
  switch (seasonOf(d)) {
    case 'winter':
      return r < 0.35 ? 'snow' : 'clear';
    case 'spring':
      return r < 0.2 ? 'rain' : 'petals';
    case 'summer':
      return r < 0.12 ? 'rain' : 'clear';
    case 'autumn':
      return r < 0.22 ? 'rain' : 'leaves';
  }
}

const SKY_KEYS: Array<[number, RGB, number]> = [
  [0, [62, 72, 140], 1],
  [4.6, [62, 72, 140], 1],
  [6, [214, 156, 168], 0.5],
  [7.2, [255, 255, 255], 0],
  [17.2, [255, 255, 255], 0],
  [18.6, [255, 196, 146], 0.3],
  [19.8, [156, 124, 176], 0.75],
  [21, [74, 82, 152], 1],
  [24, [62, 72, 140], 1],
];

/** Ambient light color (multiplied over the scene) and how "night" it is (0–1). */
export function skyAt(h: number): { ambient: RGB; night: number } {
  for (let i = 1; i < SKY_KEYS.length; i++) {
    const [h1, c1, n1] = SKY_KEYS[i];
    const [h0, c0, n0] = SKY_KEYS[i - 1];
    if (h <= h1) {
      const k = (h - h0) / (h1 - h0 || 1);
      return { ambient: [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as RGB, night: n0 + (n1 - n0) * k };
    }
  }
  return { ambient: [62, 72, 140], night: 1 };
}

const INTERIOR_AMBIENT: Record<string, RGB> = {
  bright: [255, 255, 255],
  warm: [248, 232, 212],
  festive: [255, 240, 228],
  dim: [156, 136, 130],
  neon: [118, 92, 168],
};

/* ------------------------------------------------------------------ tiny sprites */

let catSheet: HTMLCanvasElement | null = null;
/** 4 frames × 12px: walk A, walk B, sit, sit (tail flick). Right-facing. */
function cat(): HTMLCanvasElement {
  if (catSheet) return catSheet;
  const c = makeCanvas(48, 10);
  const x = c.getContext('2d')!;
  const px = (f: number, a: number, b: number, w: number, h: number, col: string) => {
    x.fillStyle = col;
    x.fillRect(f * 12 + a, b, w, h);
  };
  const O = '#e8913a';
  const D = '#b8642a';
  const K = '#2a1f2d';
  for (let f = 0; f < 2; f++) {
    px(f, 2, 4, 7, 3, O); // body
    px(f, 3, 4, 1, 3, D);
    px(f, 6, 4, 1, 3, D);
    px(f, 8, 2, 3, 3, O); // head
    px(f, 8, 1, 1, 1, O);
    px(f, 10, 1, 1, 1, O);
    px(f, 10, 3, 1, 1, K);
    px(f, 0, f ? 2 : 3, 2, 1, O); // tail
    px(f, 1, f ? 3 : 4, 1, 1, O);
    px(f, f ? 2 : 3, 7, 1, 2, D); // legs
    px(f, f ? 7 : 6, 7, 1, 2, D);
  }
  for (let f = 2; f < 4; f++) {
    px(f, 4, 3, 5, 5, O);
    px(f, 5, 4, 1, 3, D);
    px(f, 7, 1, 3, 3, O);
    px(f, 7, 0, 1, 1, O);
    px(f, 9, 0, 1, 1, O);
    px(f, 9, 2, 1, 1, K);
    px(f, 2, f === 2 ? 7 : 5, 3, 1, O);
    px(f, 2, f === 2 ? 6 : 4, 1, 1, O);
  }
  catSheet = c;
  return c;
}

/* ------------------------------------------------------------------ state */

interface Bird {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: 'ground' | 'flee' | 'gone';
  nextHop: number;
  hop: number;
  flip: boolean;
  color: string;
  respawnAt: number;
}

interface Flutter {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  phase: number;
  color: string;
}

interface Fall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  sway: number;
  color: string;
  landed: number;
}

interface Drop {
  x: number;
  y: number;
  v: number;
  len: number;
  drift: number;
}

interface FishJump {
  x: number;
  y: number;
  start: number;
  dir: number;
}

export class Ambience {
  outdoor = false;
  reducedMotion = false;
  /** Freeze the day at noon (preference). */
  alwaysDay = false;
  private scene: SceneDef | null = null;
  private grid: WalkGrid | null = null;
  private t = 0;
  private birds: Bird[] = [];
  private butterflies: Flutter[] = [];
  private fireflies: Flutter[] = [];
  private falls: Fall[] = [];
  private drops: Drop[] = [];
  private fish: FishJump[] = [];
  private nextFish = 3;
  private water: Tile[] = [];
  private trees: Tile[] = [];
  private flowers: Tile[] = [];
  private openTiles: Tile[] = [];
  private catSpots: Tile[] = [];
  private catPaths = new Map<number, Tile[] | null>();
  private catPet = 0;
  private lightCanvas: HTMLCanvasElement | null = null;
  lights: Light[] = [];
  lightsOff = new Set<string>();
  interiorTheme: string | null = null;
  /** Called when something happens that deserves particles/sound (bird flush, splash, purr). */
  onEvent: ((kind: 'flush' | 'splash' | 'purr' | 'ripple', x: number, y: number) => void) | null = null;

  load(scene: SceneDef, grid: WalkGrid | null) {
    this.scene = scene;
    this.grid = grid;
    this.outdoor = scene.kind === 'outdoor';
    this.interiorTheme = scene.interior?.ambient ?? null;
    this.birds = [];
    this.butterflies = [];
    this.fireflies = [];
    this.falls = [];
    this.drops = [];
    this.fish = [];
    this.catPaths.clear();
    this.water = [];
    this.trees = [];
    this.flowers = [];
    this.openTiles = [];
    this.catSpots = [];
    this.lights = [];
    const s = scene;
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const t = terrainAt(s, x, y);
        if (t === 'W' || t === 'w') {
          // Only water that's surrounded by water, so fish don't jump out of the shore.
          if (['w', 'W'].includes(terrainAt(s, x + 1, y)) && ['w', 'W'].includes(terrainAt(s, x - 1, y)) && ['w', 'W'].includes(terrainAt(s, x, y + 1)))
            this.water.push([x, y]);
        } else if ((t === 'g' || t === 'h' || t === 'm' || t === 'P') && (grid ? grid.walkable(x, y) : true)) this.openTiles.push([x, y]);
      }
    }
    for (const o of s.objects) this.addLight(o);
    if (!this.outdoor) return;
    for (const o of s.objects) {
      if (o.sprite.startsWith('tree/')) this.trees.push([o.x, o.y]);
      if (o.sprite === 'flowerbed') this.flowers.push([o.x, o.y]);
      if (grid && ['bench', 'fountain', 'flowerbed', 'picnic', 'mailbox', 'signpost'].includes(o.sprite)) {
        const n = grid.nearestWalkable(o.x, o.y + (o.d ?? 1), 2);
        if (n) this.catSpots.push([n.x, n.y]);
      }
      if (grid && o.door) this.catSpots.push([o.door.x, o.door.y]);
    }
    for (let i = 0; i < 3; i++) this.spawnFlock(i, 0);
    for (let i = 0; i < 6 && this.flowers.length; i++) {
      const [fx, fy] = this.flowers[i % this.flowers.length];
      this.butterflies.push({ x: fx, y: fy, z: 10, hx: fx + 0.5, hy: fy + 0.5, phase: i * 1.7, color: ['#ffd23f', '#ff9ee6', '#ffffff', '#8fd3ff'][i % 4] });
    }
    for (let i = 0; i < 26 && (this.trees.length || this.openTiles.length); i++) {
      const src = this.trees.length && (i % 2 || !this.openTiles.length) ? this.trees : this.openTiles;
      if (!src.length) break;
      const [fx, fy] = src[Math.floor(Math.random() * src.length)];
      this.fireflies.push({ x: fx + Math.random(), y: fy + Math.random(), z: 6 + Math.random() * 18, hx: fx + 0.5, hy: fy + 0.5, phase: Math.random() * 10, color: '#fff38a' });
    }
  }

  private addLight(o: SceneObject) {
    const cx = o.x + (o.w ?? 1) / 2;
    const cy = o.y + (o.d ?? 1) / 2;
    const at = (z: number) => isoToScreen(cx, cy, z);
    const L = (z: number, r: number, color: RGB, intensity: number, extra: Partial<Light> = {}) => {
      const p = at(z);
      this.lights.push({ x: p.x, y: p.y, r, color, intensity, objectId: o.id, ...extra });
    };
    switch (o.sprite) {
      case 'lamp-post':
        L(30, 78, [255, 214, 150], 0.95, { nightOnly: true });
        break;
      case 'lamp':
        L(20, 64, [255, 218, 160], 0.85);
        break;
      case 'fireplace':
        L(8, 96, [255, 150, 70], 1, { flicker: 1 });
        break;
      case 'lighthouse':
        L(46, 110, [255, 240, 180], 1, { nightOnly: true });
        break;
      case 'arcade-cabinet':
        L(22, 46, o.variant === 'b' ? [95, 243, 255] : [255, 95, 209], 0.9, { flicker: 0.15 });
        break;
      case 'counter':
        L(24, 70, [255, 214, 160], 0.7);
        break;
      case 'server-rack':
        L(20, 36, [120, 255, 170], 0.6, { flicker: 0.2 });
        break;
      case 'speaker':
        L(20, 34, [200, 160, 255], 0.5);
        break;
      case 'building': {
        const w = o.w ?? 1;
        const d = o.d ?? 1;
        const h = o.building?.wallH ?? 30;
        // Light spilling from the front windows and the door.
        const face = o.building?.doorFace === 'right' ? isoToScreen(o.x + w, o.y + d / 2, h * 0.45) : isoToScreen(o.x + w / 2, o.y + d, h * 0.45);
        this.lights.push({ x: face.x, y: face.y, r: Math.max(w, d) * 17, color: [255, 206, 130], intensity: 0.7, objectId: o.id, nightOnly: true });
        if (o.door) {
          const p = isoToScreen(o.door.x + 0.5, o.door.y + 0.5, 6);
          this.lights.push({ x: p.x, y: p.y, r: 44, color: [255, 214, 150], intensity: 0.7, objectId: o.id, nightOnly: true });
        }
        break;
      }
    }
  }

  /** A short-lived light (door opening, a lamp being flicked, a rocket). */
  flash(x: number, y: number, r: number, color: RGB, ms: number, intensity = 1) {
    this.lights.push({ x, y, r, color, intensity, until: performance.now() + ms });
  }

  /* ------------------------------------------------------------------ sky & weather */

  hour() {
    return this.alwaysDay ? 12 : clockHour();
  }

  sky() {
    return skyAt(this.hour());
  }

  weather(): WeatherKind {
    return weatherAt();
  }

  /** Outdoor background behind the island. */
  paintBackground(c: CanvasRenderingContext2D, w: number, h: number) {
    const { ambient, night } = this.sky();
    const g = c.createLinearGradient(0, 0, 0, h);
    const mul = (hex: RGB, k = 1) => `rgb(${Math.round((hex[0] * ambient[0]) / 255 * k)},${Math.round((hex[1] * ambient[1]) / 255 * k)},${Math.round((hex[2] * ambient[2]) / 255 * k)})`;
    const rainy = this.weather() === 'rain';
    g.addColorStop(0, mul(rainy ? [176, 196, 206] : [191, 231, 239]));
    g.addColorStop(1, mul(rainy ? [226, 222, 214] : [247, 236, 217]));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    if (night > 0.4 && !rainy) {
      const a = (night - 0.4) / 0.6;
      for (let i = 0; i < 90; i++) {
        const sx = hash(i * 7 + 1) * w;
        const sy = hash(i * 13 + 5) * h * 0.9;
        const tw = 0.5 + 0.5 * Math.sin(this.t * (1 + hash(i) * 2) + i);
        c.fillStyle = `rgba(255,250,230,${a * (0.25 + tw * 0.6)})`;
        const s = hash(i * 3) > 0.9 ? 2 : 1;
        c.fillRect(Math.round(sx), Math.round(sy), s, s);
      }
    }
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number, actors: Array<{ x: number; y: number }>, serverNow: number) {
    this.t += dt;
    if (!this.scene) return;
    const now = performance.now();
    this.lights = this.lights.filter((l) => !l.until || l.until > now);
    if (!this.outdoor) return;
    const motion = !this.reducedMotion;

    // Birds: hop around, flush when someone comes close, come back later.
    for (const b of this.birds) {
      if (b.state === 'gone') {
        if (serverNow > b.respawnAt) this.respawnBird(b);
        continue;
      }
      if (b.state === 'ground') {
        const near = actors.some((a) => Math.hypot(a.x + 0.5 - b.x, a.y + 0.5 - b.y) < 2.1);
        if (near) {
          b.state = 'flee';
          const a = Math.random() * Math.PI * 2;
          b.vx = Math.cos(a) * 3;
          b.vy = Math.sin(a) * 3;
          b.vz = 55 + Math.random() * 25;
          b.flip = b.vx - b.vy < 0;
          const p = isoToScreen(b.x, b.y);
          this.onEvent?.('flush', p.x, p.y);
          // The rest of the flock follows.
          for (const o of this.birds) {
            if (o !== b && o.state === 'ground' && Math.hypot(o.x - b.x, o.y - b.y) < 2.5) {
              o.state = 'flee';
              o.vx = b.vx + (Math.random() - 0.5);
              o.vy = b.vy + (Math.random() - 0.5);
              o.vz = b.vz * (0.8 + Math.random() * 0.4);
              o.flip = b.flip;
            }
          }
          continue;
        }
        if (motion && this.t > b.nextHop) {
          b.nextHop = this.t + 0.6 + Math.random() * 2.4;
          b.hop = 0.25;
          const nx = b.x + (Math.random() - 0.5) * 0.6;
          const ny = b.y + (Math.random() - 0.5) * 0.6;
          if (this.grid?.walkable(Math.floor(nx), Math.floor(ny))) {
            b.flip = nx - b.x - (ny - b.y) < 0;
            b.x = nx;
            b.y = ny;
          }
        }
        b.hop = Math.max(0, b.hop - dt);
        b.z = b.hop > 0 ? Math.sin((b.hop / 0.25) * Math.PI) * 3 : 0;
      } else {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        if (b.z > 220) {
          b.state = 'gone';
          b.respawnAt = serverNow + 20_000 + Math.random() * 40_000;
        }
      }
    }

    const w = this.weather();
    const night = this.sky().night;
    // Falling leaves / petals from the trees.
    if (motion && (w === 'leaves' || w === 'petals') && this.trees.length && this.falls.length < 36 && Math.random() < dt * 3) {
      const [tx, ty] = this.trees[Math.floor(Math.random() * this.trees.length)];
      const palette = w === 'leaves' ? ['#e0782f', '#d9a441', '#b8462e', '#c9b458'] : ['#ffc6dc', '#ffe0ec', '#ffb3cf'];
      this.falls.push({ x: tx + 0.2 + Math.random() * 0.6, y: ty + 0.2 + Math.random() * 0.6, z: 34 + Math.random() * 20, vx: 0.25 + Math.random() * 0.3, vy: 0.05, sway: Math.random() * 6, color: palette[Math.floor(Math.random() * palette.length)], landed: 0 });
    }
    for (const f of this.falls) {
      if (f.landed) {
        f.landed += dt;
        continue;
      }
      f.z -= dt * 9;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.sway += dt * 3;
      if (f.z <= 0) {
        f.z = 0;
        f.landed = 0.001;
      }
    }
    this.falls = this.falls.filter((f) => f.landed < 4);

    // Screen-space rain / snow drops (positions in 0..1 of the viewport).
    const want = !motion ? 0 : w === 'rain' ? 140 : w === 'snow' ? 90 : 0;
    while (this.drops.length < want) this.drops.push({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.5, len: 6 + Math.random() * 6, drift: Math.random() * 6 });
    if (this.drops.length > want) this.drops.length = want;
    for (const d of this.drops) {
      if (w === 'rain') {
        d.y += d.v * dt * 1.6;
        d.x -= d.v * dt * 0.25;
      } else {
        d.y += d.v * dt * 0.12;
        d.x += Math.sin(this.t + d.drift) * dt * 0.02;
      }
      if (d.y > 1.05) {
        d.y = -0.05;
        d.x = Math.random() * 1.2;
      }
    }
    if (motion && w === 'rain' && this.water.length && Math.random() < dt * 6) {
      const [x, y] = this.water[Math.floor(Math.random() * this.water.length)];
      const p = isoToScreen(x + Math.random(), y + Math.random(), -3);
      this.onEvent?.('ripple', p.x, p.y);
    }

    // Fish jumping in the lake.
    if (motion && this.water.length && this.t > this.nextFish) {
      this.nextFish = this.t + 4 + Math.random() * 7;
      const [x, y] = this.water[Math.floor(Math.random() * this.water.length)];
      const f = { x: x + 0.5, y: y + 0.5, start: this.t, dir: Math.random() < 0.5 ? -1 : 1 };
      this.fish.push(f);
      const p = isoToScreen(f.x, f.y, -3);
      this.onEvent?.('splash', p.x, p.y);
      setTimeout(() => this.onEvent?.('splash', p.x + f.dir * 14, p.y + 4), 700);
    }
    this.fish = this.fish.filter((f) => this.t - f.start < 0.8);

    for (const b of this.butterflies) {
      b.phase += dt;
      b.x = b.hx + Math.sin(b.phase * 0.7) * 1.4 + Math.sin(b.phase * 1.9) * 0.3;
      b.y = b.hy + Math.cos(b.phase * 0.5) * 1.2;
      b.z = 10 + Math.sin(b.phase * 2.3) * 5;
    }
    if (night > 0.3) {
      for (const f of this.fireflies) {
        f.phase += dt;
        f.x = f.hx + Math.sin(f.phase * 0.31 + f.hx) * 1.3;
        f.y = f.hy + Math.cos(f.phase * 0.27 + f.hy) * 1.3;
        f.z = 8 + Math.sin(f.phase * 0.9) * 6;
      }
    }
  }

  private spawnFlock(i: number, serverNow: number) {
    if (!this.openTiles.length) return;
    const [cx, cy] = this.openTiles[Math.floor(hash(i * 31 + Math.floor(serverNow / 60000)) * this.openTiles.length)];
    const n = 3 + (i % 2);
    for (let k = 0; k < n; k++) {
      this.birds.push({
        id: `bird-${i}-${k}`,
        x: cx + 0.2 + Math.random() * 0.8,
        y: cy + 0.2 + Math.random() * 0.8,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        state: 'ground',
        nextHop: Math.random() * 2,
        hop: 0,
        flip: Math.random() < 0.5,
        color: ['#8a6a52', '#6f7b8a', '#a8835c'][(i + k) % 3],
        respawnAt: 0,
      });
    }
  }

  private respawnBird(b: Bird) {
    if (!this.openTiles.length) return;
    const [x, y] = this.openTiles[Math.floor(Math.random() * this.openTiles.length)];
    Object.assign(b, { x: x + Math.random(), y: y + Math.random(), z: 0, vx: 0, vy: 0, vz: 0, state: 'ground' });
  }

  /* ------------------------------------------------------------------ the cat */

  private static CAT_SEG = 45_000;

  /** Biscuit makes the same rounds for everyone: position is a pure function of server time. */
  private catState(serverNow: number): { x: number; y: number; moving: boolean; flip: boolean } | null {
    const spots = this.catSpots;
    if (!this.grid || spots.length < 2) return null;
    const seg = Math.floor(serverNow / Ambience.CAT_SEG);
    const spotOf = (k: number) => spots[Math.floor(hash(k * 2654435761) * spots.length)];
    const from = spotOf(seg - 1);
    let to = spotOf(seg);
    if (to === from) to = spots[(spots.indexOf(from) + 1) % spots.length];
    let path = this.catPaths.get(seg);
    if (path === undefined) {
      path = findPath(this.grid, from, to, { maxNodes: 4000 });
      this.catPaths.set(seg, path);
      if (this.catPaths.size > 6) this.catPaths.delete(this.catPaths.keys().next().value!);
    }
    const elapsed = serverNow - seg * Ambience.CAT_SEG;
    if (!path || path.length < 2) return { x: to[0], y: to[1], moving: false, flip: false };
    const p = positionAlong(path, elapsed, 1.3);
    return { x: p.x, y: p.y, moving: !p.done, flip: p.dir[0] - p.dir[1] < 0 };
  }

  pet() {
    this.catPet = this.t;
  }

  /* ------------------------------------------------------------------ mobs (depth-sorted) */

  mobs(serverNow: number): Mob[] {
    if (!this.outdoor) return [];
    const out: Mob[] = [];
    for (const b of this.birds) {
      if (b.state === 'gone') continue;
      const p = isoToScreen(b.x, b.y, b.z);
      const g = isoToScreen(b.x, b.y);
      const flap = b.state === 'flee' ? Math.floor(this.t * 14) % 2 : 0;
      out.push({
        id: b.id,
        x: b.x - 0.5,
        y: b.y - 0.5,
        rect: { l: p.x - 3, t: p.y - 5, r: p.x + 3, b: g.y + 1 },
        draw: (c) => {
          if (b.z < 60) {
            c.fillStyle = `rgba(40,30,50,${0.2 * (1 - b.z / 60)})`;
            c.fillRect(Math.round(g.x - 1), Math.round(g.y), 3, 1);
          }
          const x = Math.round(p.x);
          const y = Math.round(p.y);
          const d = b.flip ? -1 : 1;
          c.fillStyle = b.color;
          c.fillRect(x - 2, y - 3, 4, 2);
          c.fillRect(x + d * 2 - (d < 0 ? 1 : 0), y - 4, 1, 1);
          c.fillStyle = '#ffb347';
          c.fillRect(x + d * 3 - (d < 0 ? 1 : 0), y - 4, 1, 1);
          c.fillStyle = '#e6d6c2';
          c.fillRect(x - 1, y - 2, 2, 1);
          if (b.state === 'flee') {
            c.fillStyle = b.color;
            c.fillRect(x - 1, flap ? y - 6 : y - 2, 2, flap ? 3 : 2);
          } else if (Math.sin(this.t * 3 + b.x * 7) > 0.92) {
            c.fillRect(x + d * 2 - (d < 0 ? 1 : 0), y - 3, 1, 1); // peck
          }
        },
      });
    }
    const cs = this.catState(serverNow);
    if (cs) {
      const p = isoToScreen(cs.x + 0.5, cs.y + 0.5);
      const petted = this.t - this.catPet < 3;
      const frame = cs.moving && !petted ? Math.floor(this.t * 6) % 2 : Math.sin(this.t * 1.3) > 0.7 || petted ? 3 : 2;
      out.push({
        id: 'cat',
        x: cs.x,
        y: cs.y,
        rect: { l: p.x - 7, t: p.y - 10, r: p.x + 7, b: p.y + 1 },
        label: 'Biscuit, the town cat 🐈',
        onClick: () => {
          this.pet();
          this.onEvent?.('purr', p.x, p.y - 10);
        },
        draw: (c) => {
          c.fillStyle = 'rgba(40,30,50,0.22)';
          c.beginPath();
          c.ellipse(p.x, p.y, 5, 2, 0, 0, Math.PI * 2);
          c.fill();
          const sheet = cat();
          const x = Math.round(p.x - 6);
          const y = Math.round(p.y - 9);
          if (cs.flip) {
            c.save();
            c.translate(x + 12, y);
            c.scale(-1, 1);
            c.drawImage(sheet, frame * 12, 0, 12, 10, 0, 0, 12, 10);
            c.restore();
          } else c.drawImage(sheet, frame * 12, 0, 12, 10, x, y, 12, 10);
        },
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ world-space draws */

  /** Water-level life, drawn right after the ground. */
  drawGround(c: CanvasRenderingContext2D) {
    if (!this.outdoor) return;
    for (const f of this.fish) {
      const k = (this.t - f.start) / 0.8;
      const p = isoToScreen(f.x, f.y, -3);
      const x = p.x + f.dir * 14 * k;
      const y = p.y + 4 * k - Math.sin(k * Math.PI) * 14;
      c.fillStyle = '#c9d6e3';
      c.fillRect(Math.round(x - 2), Math.round(y), 4, 2);
      c.fillStyle = '#8fa3b8';
      c.fillRect(Math.round(x - f.dir * 3), Math.round(y), 1, 2);
    }
    for (const f of this.falls) {
      if (!f.landed) continue;
      const p = isoToScreen(f.x, f.y);
      c.globalAlpha = Math.max(0, 1 - f.landed / 4);
      c.fillStyle = f.color;
      c.fillRect(Math.round(p.x), Math.round(p.y), 2, 1);
    }
    c.globalAlpha = 1;
  }

  /** Airborne things drawn over the scene (leaves, butterflies). */
  drawAir(c: CanvasRenderingContext2D) {
    if (!this.outdoor) return;
    for (const f of this.falls) {
      if (f.landed) continue;
      const p = isoToScreen(f.x, f.y, f.z);
      const sx = Math.sin(f.sway) * 3;
      c.fillStyle = f.color;
      const flat = Math.cos(f.sway * 1.3) > 0;
      c.fillRect(Math.round(p.x + sx), Math.round(p.y), flat ? 2 : 1, flat ? 1 : 2);
    }
    const { night } = this.sky();
    const w = this.weather();
    if (night < 0.5 && w !== 'rain' && w !== 'snow') {
      for (const b of this.butterflies) {
        const p = isoToScreen(b.x, b.y, b.z);
        const open = Math.sin(b.phase * 18) > 0;
        c.fillStyle = b.color;
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (open) {
          c.fillRect(x - 2, y - 1, 2, 2);
          c.fillRect(x + 1, y - 1, 2, 2);
        } else c.fillRect(x - 1, y - 2, 3, 2);
        c.fillStyle = '#2a1f2d';
        c.fillRect(x, y - 1, 1, 2);
      }
    }
  }

  /* ------------------------------------------------------------------ lighting */

  private ambientNow(): { ambient: RGB; night: number } {
    if (this.outdoor) {
      const s = this.sky();
      if (this.weather() === 'rain') s.ambient = s.ambient.map((v) => Math.round(v * 0.86)) as RGB;
      else if (this.weather() === 'snow') s.ambient = [Math.round(s.ambient[0] * 0.95), Math.round(s.ambient[1] * 0.97), s.ambient[2]];
      return s;
    }
    return { ambient: INTERIOR_AMBIENT[this.interiorTheme ?? 'bright'] ?? [255, 255, 255], night: this.interiorTheme === 'dim' || this.interiorTheme === 'neon' ? 0.8 : 0.35 };
  }

  /**
   * Multiply an ambient color over the frame, with lights punched through it, then add a soft
   * bloom. `extra` are per-frame lights (people's glow at night).
   */
  drawLighting(
    c: CanvasRenderingContext2D,
    view: { dpr: number; vw: number; vh: number; zoom: number; camX: number; camY: number },
    extra: Light[],
  ) {
    const { ambient, night } = this.ambientNow();
    const dark = ambient[0] + ambient[1] + ambient[2] < 750;
    const lights = [...this.lights, ...extra].filter((l) => {
      if (l.objectId && this.lightsOff.has(l.objectId)) return false;
      if (l.nightOnly && this.outdoor && night < 0.15) return false;
      return true;
    });
    if (!dark && !lights.some((l) => l.until)) return;
    const scale = 0.5;
    const w = Math.max(1, Math.ceil(view.vw * scale));
    const h = Math.max(1, Math.ceil(view.vh * scale));
    if (!this.lightCanvas) this.lightCanvas = makeCanvas(w, h);
    const lc = this.lightCanvas;
    if (lc.width !== w || lc.height !== h) {
      lc.width = w;
      lc.height = h;
    }
    const x = lc.getContext('2d')!;
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = `rgb(${ambient[0]},${ambient[1]},${ambient[2]})`;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter';
    const toS = (ax: number, ay: number): [number, number] => [((ax - view.camX) * view.zoom + view.vw / 2) * scale, ((ay - view.camY) * view.zoom + view.vh / 2) * scale];
    const strength = this.outdoor ? Math.max(0.35, night) : 1;
    for (const l of lights) {
      const [sx, sy] = toS(l.x, l.y);
      const r = l.r * view.zoom * scale;
      if (sx < -r || sy < -r || sx > w + r || sy > h + r) continue;
      let k = l.intensity * strength;
      if (l.flicker) k *= 1 - l.flicker * 0.5 + Math.sin(this.t * 13 + l.x) * l.flicker * 0.25 + Math.sin(this.t * 7.3 + l.y) * l.flicker * 0.25;
      if (l.until) k *= Math.min(1, (l.until - performance.now()) / 300);
      const g = x.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, `rgba(${l.color[0]},${l.color[1]},${l.color[2]},${k})`);
      g.addColorStop(0.5, `rgba(${l.color[0]},${l.color[1]},${l.color[2]},${k * 0.45})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    c.save();
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    c.imageSmoothingEnabled = true;
    c.globalCompositeOperation = 'multiply';
    c.drawImage(lc, 0, 0, view.vw, view.vh);
    // Bloom: a faint additive halo so lamps read as light sources, not holes.
    if (night > 0.2) {
      c.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        const [sx, sy] = toS(l.x, l.y);
        const r = l.r * view.zoom * 0.35;
        const px = sx / scale;
        const py = sy / scale;
        if (px < -r || py < -r || px > view.vw + r || py > view.vh + r) continue;
        const g = c.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${l.color[0]},${l.color[1]},${l.color[2]},${0.22 * night * l.intensity})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(px - r, py - r, r * 2, r * 2);
      }
    }
    c.restore();
  }

  /** Night sparkle drawn after lighting so it glows: fireflies, the lighthouse beam. */
  drawGlow(c: CanvasRenderingContext2D, lighthouse: { x: number; y: number } | null) {
    if (!this.outdoor) return;
    const { night } = this.sky();
    if (night < 0.3) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const season = seasonOf();
    if (season !== 'winter' && this.weather() !== 'rain') {
      for (const f of this.fireflies) {
        const p = isoToScreen(f.x, f.y, f.z);
        const pulse = Math.max(0, Math.sin(f.phase * 2.2 + f.hx * 3));
        if (pulse < 0.2) continue;
        c.fillStyle = `rgba(255,243,138,${pulse * night * 0.9})`;
        c.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        c.fillStyle = `rgba(255,243,138,${pulse * night * 0.25})`;
        c.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3);
      }
    }
    if (lighthouse) {
      const a = this.t * 0.9;
      const len = 260;
      const spread = 0.16;
      const g = c.createRadialGradient(lighthouse.x, lighthouse.y, 0, lighthouse.x, lighthouse.y, len);
      g.addColorStop(0, `rgba(255,244,190,${0.32 * night})`);
      g.addColorStop(1, 'rgba(255,244,190,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(lighthouse.x, lighthouse.y);
      c.lineTo(lighthouse.x + Math.cos(a - spread) * len, lighthouse.y + Math.sin(a - spread) * len * 0.5);
      c.lineTo(lighthouse.x + Math.cos(a + spread) * len, lighthouse.y + Math.sin(a + spread) * len * 0.5);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  /** Rain and snow in screen space, over everything but the UI. */
  drawWeather(c: CanvasRenderingContext2D, vw: number, vh: number) {
    if (!this.outdoor || !this.drops.length) return;
    const rain = this.weather() === 'rain';
    c.save();
    if (rain) {
      c.strokeStyle = 'rgba(200,220,240,0.45)';
      c.lineWidth = 1;
      c.beginPath();
      for (const d of this.drops) {
        const x = d.x * vw;
        const y = d.y * vh;
        c.moveTo(x, y);
        c.lineTo(x - d.len * 0.25, y + d.len);
      }
      c.stroke();
    } else {
      c.fillStyle = 'rgba(255,255,255,0.85)';
      for (const d of this.drops) {
        const s = d.len > 9 ? 2 : 1.5;
        c.fillRect(Math.round(d.x * vw), Math.round(d.y * vh), s, s);
      }
    }
    c.restore();
  }
}
