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
      this.ducks = [
        { cx: 38, cy: 31, rx: 3, ry: 2, phase: 0, speed: 0.12 },
        { cx: 38.6, cy: 31.4, rx: 3, ry: 2, phase: 0.5, speed: 0.12 },
        { cx: 35, cy: 40, rx: 2, ry: 3, phase: 2, speed: 0.09 },
        { cx: 43, cy: 24, rx: 1.5, ry: 2.5, phase: 1, speed: 0.1 },
      ];
      for (let i = 0; i < 4; i++) this.clouds.push({ x: -800 + i * 520, y: 120 + (i % 2) * 260, r: 150 + i * 30, v: 5 + i });
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
