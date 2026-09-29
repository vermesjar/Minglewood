/** Particles and ambient life (fountain spray, smoke, confetti, ducks, cloud shadows). */
import { isoToScreen } from '@shared/iso';
import { terrainAt, type SceneDef, type SceneObject } from '@shared/world/scene';
import { hash2 } from '@shared/world/builders';
import { makeCanvas, type Sprite } from './sprites/painter';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  kind: 'square' | 'circle' | 'heart' | 'note';
  spin?: number;
}

interface Emitter {
  kind: 'spray' | 'smoke' | 'steam' | 'fire' | 'confetti' | 'glow';
  x: number;
  y: number;
  acc: number;
  rate: number;
}

interface Duck {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  phase: number;
  speed: number;
}

const CONFETTI = ['#e24c9c', '#3ec7e0', '#ffd23f', '#7cc576', '#ff8a3d', '#9b6bd6'];

let duckCanvas: HTMLCanvasElement | null = null;
/** 16×8 sheet: right-facing duck on the left half, mirrored on the right half. */
function duckSheet(): HTMLCanvasElement {
  if (!duckCanvas) {
    const c = makeCanvas(16, 8);
    const x = c.getContext('2d')!;
    const px = (a: number, b: number, w: number, h: number, col: string) => {
      x.fillStyle = col;
      x.fillRect(a, b, w, h);
    };
    px(1, 3, 5, 3, '#fffaf0');
    px(0, 3, 1, 1, '#fffaf0');
    px(4, 1, 2, 2, '#fffaf0');
    px(5, 1, 1, 1, '#2a1f2d');
    px(6, 2, 1, 1, '#ff9f1c');
    px(2, 4, 3, 1, '#e3dccf');
    px(1, 6, 5, 1, '#bfe6f7');
    x.save();
    x.translate(16, 0);
    x.scale(-1, 1);
    x.drawImage(c, 0, 0, 8, 8, 0, 0, 8, 8);
    x.restore();
    duckCanvas = c;
  }
  return duckCanvas;
}

const isWater = (scene: SceneDef, x: number, y: number) => {
  const t = terrainAt(scene, x, y);
  return t === 'w' || t === 'W';
};

function waterTiles(scene: SceneDef): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < scene.height; y++) for (let x = 0; x < scene.width; x++) if (isWater(scene, x, y)) out.push([x, y]);
  return out;
}

/**
 * Where ducks paddle: open water two to four tiles from the shore (so their loop never touches land), picked
 * deterministically so everyone sees the same ducks, spread apart. The first has a companion.
 */
function duckCircuits(scene: SceneDef): Duck[] {
  const W = scene.width;
  const H = scene.height;
  const dist = new Int16Array(W * H).fill(-1);
  const queue: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!isWater(scene, x, y)) {
        dist[y * W + x] = 0;
        queue.push(y * W + x);
      }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || dist[ny * W + nx] >= 0) continue;
      dist[ny * W + nx] = dist[i] + 1;
      queue.push(ny * W + nx);
    }
  }
  const candidates: Array<{ x: number; y: number; d: number; h: number }> = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = dist[y * W + x];
      if (d >= 2 && d <= 4) candidates.push({ x, y, d, h: hash2(x, y, 23) });
    }
  candidates.sort((a, b) => a.h - b.h);
  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (picked.length >= 4) break;
    if (picked.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= 6)) picked.push(c);
  }
  const ducks: Duck[] = [];
  picked.forEach((c, i) => {
    const r = Math.min(2.2, c.d - 1.2);
    const duck = { cx: c.x + 0.5, cy: c.y + 0.5, rx: r, ry: r * 0.75, phase: c.h * 6.28, speed: 0.08 + (i % 3) * 0.02 };
    ducks.push(duck);
    if (i === 0) ducks.push({ ...duck, phase: duck.phase + 0.5 }); // a pair
  });
  return ducks;
}

export class Effects {
  private particles: Particle[] = [];
  private emitters: Emitter[] = [];
  private ducks: Duck[] = [];
  private clouds: Array<{ x: number; y: number; r: number; v: number }> = [];
  private t = 0;
  outdoor = false;
  lighthouse: { x: number; y: number } | null = null;
  reducedMotion = false;

  /** The town's water tiles (for ducks and glints), found once per scene. */
  private water: Array<[number, number]> = [];
  /** Beacons that pulse (antenna lights, tower tops), in world px. */
  private blinks: Array<{ x: number; y: number; phase: number }> = [];
  /** How dark it is outside, 0 (day) … 1 (night): beacons, the lighthouse beam. Set every frame. */
  night = 0;
  private cloudSpan = 1400;

  /**
   * Set up a scene's ambient life. Things with finished art give off smoke, spray and light from the points
   * their drawing marks (manifest `emitters`); the procedural buildings keep their computed chimneys.
   */
  load(scene: SceneDef, opts: { party: boolean }, statics: Array<{ obj: SceneObject; sprite: Sprite; dx: number; dy: number }> = []) {
    this.particles = [];
    this.emitters = [];
    this.ducks = [];
    this.clouds = [];
    this.blinks = [];
    this.water = [];
    this.lighthouse = null;
    this.outdoor = scene.kind === 'outdoor';
    const at = (x: number, y: number, z: number) => {
      const s = isoToScreen(x, y, z);
      return { x: s.x, y: s.y };
    };
    const drawn = new Map(statics.map((st) => [st.obj.id, st]));
    for (const o of scene.objects) {
      const st = drawn.get(o.id);
      const marks = st?.sprite.emitters;
      if (st && marks) {
        const k = st.sprite.scale ?? 1;
        for (const m of marks) {
          const p = { x: st.dx + m.x / k, y: st.dy + m.y / k };
          if (m.kind === 'smoke') this.emitters.push({ kind: 'smoke', ...p, acc: 0, rate: 2.2 });
          else if (m.kind === 'spray') this.emitters.push({ kind: 'spray', ...p, acc: 0, rate: 26 });
          else if (m.kind === 'blink') this.blinks.push({ ...p, phase: (o.x * 7 + o.y * 3) % 10 / 10 });
          else if (m.kind === 'beam') this.lighthouse = p;
        }
        continue;
      }
      if (st?.sprite.file) continue; // finished art without emitters gives off nothing
      const cx = o.x + (o.w ?? 1) / 2;
      const cy = o.y + (o.d ?? 1) / 2;
      if (o.sprite === 'fountain') this.emitters.push({ kind: 'spray', ...at(cx, cy, 24), acc: 0, rate: 26 });
      // (fireplaces, espresso machines and other living furniture animate through animations.ts)
      if (o.sprite === 'lighthouse') this.lighthouse = at(cx, cy, 46);
      if (o.building?.extras.includes('chimney')) {
        const b = o.building;
        const w = o.w ?? 1;
        const d = o.d ?? 1;
        const rh = b.roofStyle === 'flat' ? 5 : Math.round(Math.min(w, d) * 7 + 6);
        const chy = b.roofStyle === 'gable' && w >= d ? d * 0.3 : d * 0.35;
        this.emitters.push({ kind: 'smoke', ...at(o.x + w * 0.72 + 0.22, o.y + chy + 0.22, b.wallH + rh * 1.1 + 8), acc: 0, rate: 2.2 });
      }
    }
    if (opts.party && scene.kind === 'interior') {
      const s = at(scene.width / 2, scene.height / 2, 70);
      this.emitters.push({ kind: 'confetti', ...s, acc: 0, rate: 10 });
    }
    if (this.outdoor) {
      this.water = waterTiles(scene);
      this.ducks = duckCircuits(scene);
      // clouds drift across the whole town, not just its top
      const span = (scene.width + scene.height) * 8;
      this.cloudSpan = (scene.width + scene.height) * 16 * 0.5 + 500;
      for (let i = 0; i < 7; i++)
        this.clouds.push({ x: -this.cloudSpan + i * ((this.cloudSpan * 2) / 7), y: 80 + ((i * 0.37) % 1) * (span * 1.6), r: 150 + (i % 3) * 40, v: 4 + (i % 4) });
    }
  }

  /** A single particle in world (art) space, for animations.ts. */
  add(p: { x: number; y: number; vx?: number; vy?: number; max: number; size: number; color: string; gravity?: number; kind?: Particle['kind'] }) {
    this.particles.push({ vx: 0, vy: 0, gravity: 0, kind: 'circle', life: 0, ...p });
  }

  burst(x: number, y: number, kind: 'confetti' | 'hearts' | 'sparkle', n = 24) {
    if (this.reducedMotion) n = Math.min(n, 6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 50;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 50,
        life: 0,
        max: 1.2 + Math.random() * 0.8,
        size: kind === 'hearts' ? 3 : 2,
        color: kind === 'hearts' ? '#ff6b9a' : kind === 'sparkle' ? '#fff4b0' : CONFETTI[i % CONFETTI.length],
        gravity: kind === 'hearts' ? -10 : 90,
        kind: kind === 'hearts' ? 'heart' : 'square',
      });
    }
  }

  update(dt: number) {
    this.t += dt;
    if (!this.reducedMotion) {
      for (const e of this.emitters) {
        e.acc += dt * e.rate;
        while (e.acc > 1) {
          e.acc -= 1;
          this.emit(e);
        }
      }
    }
    for (const p of this.particles) {
      p.life += dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > this.cloudSpan) c.x = -this.cloudSpan;
    }
  }

  private emit(e: Emitter) {
    const r = Math.random;
    switch (e.kind) {
      case 'spray':
        this.particles.push({ x: e.x + (r() - 0.5) * 2, y: e.y, vx: (r() - 0.5) * 18, vy: -28 - r() * 10, life: 0, max: 0.9, size: 1, color: r() > 0.5 ? '#e8f7ff' : '#9fdcff', gravity: 70, kind: 'square' });
        break;
      case 'smoke':
        this.particles.push({ x: e.x, y: e.y, vx: 4 + r() * 4, vy: -8 - r() * 4, life: 0, max: 3.5, size: 3 + r() * 2, color: 'rgba(240,236,230,0.55)', gravity: -1, kind: 'circle' });
        break;
      case 'steam':
        this.particles.push({ x: e.x + (r() - 0.5) * 4, y: e.y, vx: (r() - 0.5) * 3, vy: -6, life: 0, max: 2, size: 2, color: 'rgba(255,255,255,0.6)', gravity: -1, kind: 'circle' });
        break;
      case 'fire':
        this.particles.push({ x: e.x + (r() - 0.5) * 10, y: e.y, vx: (r() - 0.5) * 4, vy: -12 - r() * 8, life: 0, max: 0.7, size: 2, color: r() > 0.5 ? '#ffb347' : '#ffd23f', gravity: -5, kind: 'square' });
        break;
      case 'confetti':
        this.particles.push({ x: e.x + (r() - 0.5) * 260, y: e.y - r() * 20, vx: (r() - 0.5) * 10, vy: 12 + r() * 10, life: 0, max: 5, size: 2, color: CONFETTI[Math.floor(r() * CONFETTI.length)], gravity: 2, kind: 'square', spin: r() * 6 });
        break;
      case 'glow':
        break;
    }
  }

  /** Drawn in world (art) space, before objects: water-level life. */
  drawUnder(ctx: CanvasRenderingContext2D) {
    if (!this.outdoor) return;
    const t = this.t;
    for (const d of this.ducks) {
      const a = d.phase + t * d.speed;
      const x = d.cx + Math.cos(a) * d.rx;
      const y = d.cy + Math.sin(a) * d.ry;
      const s = isoToScreen(x + 0.5, y + 0.5, -3);
      const vx = -Math.sin(a) * d.rx;
      const vy = Math.cos(a) * d.ry;
      const flip = vx - vy < 0;
      const bob = Math.round(Math.sin(t * 3 + d.phase) * 0.6);
      ctx.drawImage(duckSheet(), flip ? 8 : 0, 0, 8, 8, Math.round(s.x - 4), Math.round(s.y - 7 + bob), 8, 8);
    }
    // glints on the water: a few at a time, each a short-lived two-pixel twinkle somewhere on the lake
    const n = this.water.length;
    if (n && !this.reducedMotion) {
      const count = Math.min(60, Math.round(n / 12));
      for (let i = 0; i < count; i++) {
        const k = Math.floor(t * 0.9 + i * 7.3);
        const [wx, wy] = this.water[(k * 7919 + i * 104729) % n];
        const ox = hash2(k, i, 5);
        const oy = hash2(i, k, 9);
        const s = isoToScreen(wx + ox, wy + oy, -3);
        const ph = (t * 0.9 + i * 0.37) % 1;
        if (ph > 0.45) continue;
        ctx.fillStyle = `rgba(255,255,255,${ph < 0.1 || ph > 0.35 ? 0.45 : 0.85})`;
        ctx.fillRect(Math.round(s.x), Math.round(s.y), ph > 0.12 && ph < 0.33 ? 2 : 1, 0.5);
      }
    }
  }

  /** Drawn in world space after objects. */
  drawOver(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, Math.min(1, a * 1.5));
      ctx.fillStyle = p.color;
      if (p.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + p.life * 0.4), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'note') {
        // an eighth note: head, stem, flag
        const x = Math.round(p.x);
        const y = Math.round(p.y + Math.sin(p.life * 5) * 0.8);
        ctx.fillRect(x - 1, y, 2, 2);
        ctx.fillRect(x + 1, y - 4, 1, 5);
        ctx.fillRect(x + 2, y - 4, 1, 1);
      } else if (p.kind === 'heart') {
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        ctx.fillRect(x - 2, y - 1, 2, 2);
        ctx.fillRect(x + 1, y - 1, 2, 2);
        ctx.fillRect(x - 1, y, 3, 2);
        ctx.fillRect(x, y + 2, 1, 1);
      } else {
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.spin ? (Math.sin(p.life * p.spin) > 0 ? p.size : 1) : p.size);
      }
    }
    ctx.globalAlpha = 1;
    // beacons: a small red light pulsing about once a second, with a halo that shows at night
    for (const b of this.blinks) {
      const k = 0.5 + 0.5 * Math.sin((this.t + b.phase) * Math.PI * 2);
      const on = this.reducedMotion ? 1 : k * k;
      if (this.night > 0.05) {
        const r = 7;
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
        g.addColorStop(0, `rgba(255,90,70,${0.55 * on * this.night})`);
        g.addColorStop(1, 'rgba(255,90,70,0)');
        ctx.fillStyle = g;
        ctx.fillRect(b.x - r, b.y - r, r * 2, r * 2);
      }
      ctx.fillStyle = `rgba(255,${Math.round(70 + 60 * on)},60,${0.35 + 0.65 * on})`;
      ctx.fillRect(Math.round(b.x * 2) / 2 - 0.5, Math.round(b.y * 2) / 2 - 0.5, 1, 1);
    }
    if (this.lighthouse) {
      const L = this.lighthouse;
      if (this.night > 0.05) {
        // a beam sweeping slowly round the lantern: a long soft wedge that swings across the lake
        const turn = this.reducedMotion ? 0.3 : (this.t / 9) % 1;
        const ang = turn * Math.PI * 2;
        const dir = Math.cos(ang); // screen x of the beam's far end
        const depth = Math.sin(ang); // + toward the viewer, − away
        const len = 150 + 60 * Math.abs(dir);
        const ex = L.x + dir * len;
        const ey = L.y + depth * len * 0.35 + 6;
        const spread = 10 + 8 * Math.abs(depth);
        const a = this.night * (depth > 0 ? 0.26 : 0.14);
        const g = ctx.createLinearGradient(L.x, L.y, ex, ey);
        g.addColorStop(0, `rgba(255,244,190,${a})`);
        g.addColorStop(1, 'rgba(255,244,190,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(L.x, L.y);
        ctx.lineTo(ex - (ey - L.y) * (spread / len), ey + (ex - L.x) * (spread / len));
        ctx.lineTo(ex + (ey - L.y) * (spread / len), ey - (ex - L.x) * (spread / len));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // the lamp itself: steady at night, a slow wink by day
      const on = this.night > 0.05 ? 0.85 + 0.15 * Math.sin(this.t * 3) : Math.max(0, Math.sin(this.t * 2.2) - 0.6) * 2.5;
      if (on > 0.02) {
        const r = 10 + 10 * this.night;
        const g = ctx.createRadialGradient(L.x, L.y, 1, L.x, L.y, r);
        g.addColorStop(0, `rgba(255,240,170,${0.9 * on})`);
        g.addColorStop(1, 'rgba(255,240,170,0)');
        ctx.fillStyle = g;
        ctx.fillRect(L.x - r, L.y - r, r * 2, r * 2);
      }
    }
    if (this.outdoor && !this.reducedMotion) {
      for (const c of this.clouds) {
        ctx.fillStyle = 'rgba(40,50,90,0.05)';
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, c.r, c.r * 0.45, 0, 0, Math.PI * 2);
        ctx.ellipse(c.x + c.r * 0.6, c.y + 20, c.r * 0.6, c.r * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
