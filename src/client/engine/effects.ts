/** Particles and ambient life (fountain spray, smoke, confetti, ducks, cloud shadows). */
import { isoToScreen } from '@shared/iso';
import type { SceneDef } from '@shared/world/scene';
import { makeCanvas } from './sprites/painter';

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
  kind: 'square' | 'circle' | 'heart' | 'note' | 'star' | 'ring';
  spin?: number;
}

export type BurstKind = 'confetti' | 'hearts' | 'sparkle' | 'dust' | 'water' | 'paint' | 'notes' | 'sparks' | 'stars' | 'gold' | 'crumbs' | 'smoke';

interface Emitter {
  kind: 'spray' | 'smoke' | 'steam' | 'fire' | 'confetti' | 'glow' | 'music';
  x: number;
  y: number;
  acc: number;
  rate: number;
  /** Object or room this emitter belongs to, so props and occupancy can tune it. */
  id?: string;
  base?: number;
  color?: string;
  boostUntil?: number;
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

export class Effects {
  private particles: Particle[] = [];
  private emitters: Emitter[] = [];
  private ducks: Duck[] = [];
  private clouds: Array<{ x: number; y: number; r: number; v: number }> = [];
  private t = 0;
  outdoor = false;
  lighthouse: { x: number; y: number } | null = null;
  reducedMotion = false;

  load(scene: SceneDef, opts: { party: boolean }) {
    this.particles = [];
    this.emitters = [];
    this.ducks = [];
    this.clouds = [];
    this.lighthouse = null;
    this.outdoor = scene.kind === 'outdoor';
    const at = (x: number, y: number, z: number) => {
      const s = isoToScreen(x, y, z);
      return { x: s.x, y: s.y };
    };
    for (const o of scene.objects) {
      const cx = o.x + (o.w ?? 1) / 2;
      const cy = o.y + (o.d ?? 1) / 2;
      if (o.sprite === 'fountain') this.emitters.push({ kind: 'spray', ...at(cx, cy, 24), acc: 0, rate: 26 });
      if (o.sprite === 'fireplace') this.emitters.push({ kind: 'fire', ...at(cx, cy + 0.4, 4), acc: 0, rate: 14, base: 14, id: o.id });
      if (o.sprite === 'speaker') this.emitters.push({ kind: 'music', ...at(cx, cy, 26), acc: 0, rate: 0.9, base: 0.9, id: o.id, color: '#9b6bd6' });
      if (o.sprite === 'counter') this.emitters.push({ kind: 'steam', ...at(o.x + 2.6, o.y + 0.5, 30), acc: 0, rate: 3 });
      if (o.sprite === 'lighthouse') this.lighthouse = at(cx, cy, 46);
      if (o.building?.extras.includes('chimney')) {
        const b = o.building;
        const w = o.w ?? 1;
        const d = o.d ?? 1;
        const rh = b.roofStyle === 'flat' ? 5 : Math.round(Math.min(w, d) * 7 + 6);
        const chy = b.roofStyle === 'gable' && w >= d ? d * 0.3 : d * 0.35;
        this.emitters.push({ kind: 'smoke', ...at(o.x + w * 0.72 + 0.22, o.y + chy + 0.22, b.wallH + rh * 1.1 + 8), acc: 0, rate: 1.2, base: 1.2, id: o.roomId });
      }
    }
    if (opts.party && scene.kind === 'interior') {
      const s = at(scene.width / 2, scene.height / 2, 70);
      this.emitters.push({ kind: 'confetti', ...s, acc: 0, rate: 10 });
    }
    if (this.outdoor) {
      this.ducks = [
        { cx: 38, cy: 31, rx: 3, ry: 2, phase: 0, speed: 0.12 },
        { cx: 38.6, cy: 31.4, rx: 3, ry: 2, phase: 0.5, speed: 0.12 },
        { cx: 35, cy: 40, rx: 2, ry: 3, phase: 2, speed: 0.09 },
        { cx: 43, cy: 24, rx: 1.5, ry: 2.5, phase: 1, speed: 0.1 },
      ];
      for (let i = 0; i < 4; i++) this.clouds.push({ x: -800 + i * 520, y: 120 + (i % 2) * 260, r: 150 + i * 30, v: 5 + i });
    }
  }

  /** Chimneys puff harder when a building is busy. */
  setOccupancy(counts: Map<string, number>) {
    for (const e of this.emitters) {
      if (e.kind === 'smoke' && e.id) e.rate = (e.base ?? 1) + Math.min(4, (counts.get(e.id) ?? 0) * 0.9);
    }
  }

  /** A speaker's current track (null = silence). */
  setMusic(id: string, color: string | null) {
    const e = this.emitters.find((x) => x.id === id && x.kind === 'music');
    if (!e) return;
    e.color = color ?? e.color;
    e.rate = color ? (e.base ?? 1) : 0;
  }

  /** Temporarily multiply an emitter (a stoked fire). */
  boost(id: string, until: number) {
    const e = this.emitters.find((x) => x.id === id);
    if (e) e.boostUntil = until;
  }

  ring(x: number, y: number, color = 'rgba(255,255,255,0.8)', size = 6, max = 0.9) {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0, max, size, color, gravity: 0, kind: 'ring' });
  }

  burst(x: number, y: number, kind: BurstKind, n = 24, color?: string) {
    if (this.reducedMotion) n = Math.min(n, 6);
    const r = Math.random;
    const push = (p: Partial<Particle>) =>
      this.particles.push({ x, y, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: '#fff', gravity: 0, kind: 'square', ...p });
    if (kind !== 'confetti' && kind !== 'hearts' && kind !== 'sparkle') {
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        switch (kind) {
          case 'dust':
            push({ x: x + (r() - 0.5) * 6, vx: (r() - 0.5) * 14, vy: -4 - r() * 6, max: 0.5 + r() * 0.3, size: 1.5 + r(), color: 'rgba(214,196,168,0.7)', gravity: 6, kind: 'circle' });
            break;
          case 'smoke':
            push({ x: x + (r() - 0.5) * 10, vx: (r() - 0.5) * 16, vy: -10 - r() * 10, max: 1 + r() * 0.6, size: 2 + r() * 2, color: 'rgba(235,230,222,0.7)', gravity: -4, kind: 'circle' });
            break;
          case 'water':
            push({ vx: Math.cos(a) * (10 + r() * 20), vy: -30 - r() * 30, max: 0.7 + r() * 0.3, size: 1, color: r() > 0.4 ? '#8fd3ff' : '#e8f7ff', gravity: 140 });
            break;
          case 'paint':
            push({ vx: Math.cos(a) * (20 + r() * 40), vy: Math.sin(a) * 20 - 30, max: 0.9 + r() * 0.5, size: 2, color: color ?? CONFETTI[i % CONFETTI.length], gravity: 110 });
            break;
          case 'notes':
            push({ x: x + (r() - 0.5) * 10, vx: (r() - 0.5) * 16, vy: -14 - r() * 12, max: 1.6 + r() * 0.6, size: 1, color: color ?? '#9b6bd6', gravity: -2, kind: 'note', spin: r() * 6 });
            break;
          case 'sparks':
            push({ x: x + (r() - 0.5) * 12, vx: (r() - 0.5) * 40, vy: -40 - r() * 50, max: 0.6 + r() * 0.6, size: 1, color: r() > 0.5 ? '#ffd23f' : '#ff8a3d', gravity: 60 });
            break;
          case 'stars':
            push({ vx: Math.cos(a) * (30 + r() * 30), vy: Math.sin(a) * (30 + r() * 30) - 20, max: 0.7 + r() * 0.4, size: 2, color: r() > 0.3 ? '#fff4b0' : '#ffffff', gravity: 30, kind: 'star' });
            break;
          case 'gold':
            push({ vx: Math.cos(a) * (8 + r() * 24), vy: -20 - r() * 30, max: 1 + r() * 0.5, size: 1, color: r() > 0.5 ? '#ffd23f' : '#fff4b0', gravity: 40, kind: r() > 0.6 ? 'star' : 'square' });
            break;
          case 'crumbs':
            push({ vx: (r() - 0.5) * 30, vy: -20 - r() * 20, max: 0.6, size: 1, color: r() > 0.5 ? '#f7d9a8' : '#e24c9c', gravity: 120 });
            break;
        }
      }
      return;
    }
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
      const now = Date.now();
      for (const e of this.emitters) {
        e.acc += dt * e.rate * (e.boostUntil && now < e.boostUntil ? 3.2 : 1);
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
      if (c.x > 1400) c.x = -1400;
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
      case 'music':
        this.particles.push({ x: e.x + (r() - 0.5) * 8, y: e.y, vx: (r() - 0.5) * 8, vy: -10 - r() * 6, life: 0, max: 2.2, size: 1, color: e.color ?? '#9b6bd6', gravity: -1, kind: 'note', spin: r() * 6 });
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
    // water sparkles
    for (let i = 0; i < 18; i++) {
      const k = Math.floor(t * 2 + i * 7.3);
      const hx = 30 + ((k * 73 + i * 131) % 15);
      const hy = 16 + ((k * 37 + i * 91) % 28);
      const s = isoToScreen(hx + 0.5, hy + 0.5, -3);
      const ph = (t * 2 + i) % 1;
      if (ph > 0.5) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(Math.round(s.x), Math.round(s.y), ph < 0.25 ? 1 : 2, 1);
    }
  }

  /** Drawn in world space after objects. */
  drawOver(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, Math.min(1, a * 1.5));
      ctx.fillStyle = p.color;
      if (p.kind === 'ring') {
        const k = p.life / p.max;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * (0.4 + k * 1.4), p.size * (0.2 + k * 0.7), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'note') {
        const x = Math.round(p.x + Math.sin(p.life * 3 + (p.spin ?? 0)) * 3);
        const y = Math.round(p.y);
        ctx.fillRect(x, y, 2, 2);
        ctx.fillRect(x + 1, y - 4, 1, 4);
        ctx.fillRect(x + 2, y - 4, 1, 1);
      } else if (p.kind === 'star') {
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y - 1, 1, 3);
      } else if (p.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + p.life * 0.4), 0, Math.PI * 2);
        ctx.fill();
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
    if (this.lighthouse) {
      const on = Math.sin(this.t * 2.2) > 0.6;
      if (on) {
        const g = ctx.createRadialGradient(this.lighthouse.x, this.lighthouse.y, 1, this.lighthouse.x, this.lighthouse.y, 22);
        g.addColorStop(0, 'rgba(255,240,170,0.9)');
        g.addColorStop(1, 'rgba(255,240,170,0)');
        ctx.fillStyle = g;
        ctx.fillRect(this.lighthouse.x - 22, this.lighthouse.y - 22, 44, 44);
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
