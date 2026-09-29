/**
 * Living furniture: small per-object animations, declared per drawing and anchored to points in the
 * drawing's own pixels (so they follow mirrored rotations and the furniture standard's centring).
 *
 * Each piece gets only what it would really do — steam from the espresso machine's wand, koi in the
 * aquarium, flames in the fireplace, LEDs on the server rack — and nothing is loud: slow, sparse, small.
 * Particle effects (steam, flames, bubbles, notes) go through Effects; the rest is drawn right after the
 * object in depth order, clipped to its glass or screen.
 */
import type { SceneObject } from '@shared/world/scene';
import type { Effects } from './effects';
import type { Sprite } from './sprites/painter';
import { worldTimeNow } from './weather';

type P = [number, number];
type Quad = [P, P, P, P];

export type AnimSpec =
  /** Wisps rising from a point every so often. */
  | { kind: 'steam'; at: P; every: number }
  /** A puff when a drink is made (triggered, see `trigger`). */
  | { kind: 'brew'; at: P[] }
  /** Koi swimming behind glass (quad: top-left, top-right, bottom-right, bottom-left). */
  | { kind: 'fish'; glass: Quad; n: number }
  /** Bubbles rising behind glass. */
  | { kind: 'bubbles'; glass: Quad; every: number }
  | { kind: 'flames'; at: P; spread: number; rate: number }
  /** Little lights winking on and off. */
  | { kind: 'blink'; at: P[]; colors: string[] }
  /** A soft pulsing glow (lanterns, neon); several colours cycle slowly. */
  | { kind: 'glow'; at: P; r: number; color: string; speed: number; cycle?: string[] }
  /** Music notes drifting up. */
  | { kind: 'notes'; at: P; every: number }
  /** Marquee lights chasing along a line. */
  | { kind: 'chase'; from: P; to: P; n: number; colors: string[] }
  /** A screen in attract mode: a rolling scanline and a breathing brightness. */
  | { kind: 'screen'; quad: Quad }
  /** A pendulum swinging in its window (the painted one is covered with the window's colour first). */
  | { kind: 'pendulum'; pivot: P; len: number; bob: number; clear: Quad; amp: number }
  /** A clock face showing the real time (the painted hands are covered with the face's colour first). */
  | { kind: 'clockface'; at: P; rx: number; ry: number; paper: string }
  /** Light rippling through water behind glass. */
  | { kind: 'shimmer'; glass: Quad }
  /** Lines of code scrolling on a monitor. */
  | { kind: 'code'; quad: Quad; colors: string[] }
  /** Little candle flames flickering. */
  | { kind: 'candles'; at: P[] }
  /** The whole piece bobs gently (balloons). */
  | { kind: 'bob'; amp: number; period: number }
  /** Rung (the launch bell): the piece shakes and rings spread from a point. */
  | { kind: 'ring'; at: P };

const ARCADE_SW: AnimSpec[] = [
  { kind: 'screen', quad: [[13, 25], [32, 31], [32, 48], [13, 43]] },
  { kind: 'blink', at: [[14, 50], [19, 52], [24, 54]], colors: ['#ff5b6e', '#5bd2ff', '#ffe66b'] },
  { kind: 'glow', at: [24, 9], r: 12, color: '255,150,230', speed: 1.1 },
];
const DESK_SW: AnimSpec[] = [
  { kind: 'code', quad: [[28, 4], [47, 11], [47, 29], [28, 22]], colors: ['#7ee0a8', '#8ab8ff', '#e0c07e'] },
  { kind: 'code', quad: [[53, 13], [77, 22], [77, 39], [53, 30]], colors: ['#8ab8ff', '#7ee0a8', '#ff9fd0'] },
];
const ARCADE_NE: AnimSpec[] = [];

/** Specs by drawing file (sw/se drawings are the fronts; ne/nw the backs). */
const BY_FILE: Record<string, AnimSpec[]> = {
  'espresso.sw.png': [
    { kind: 'steam', at: [37, 30], every: 3.2 },
    { kind: 'brew', at: [[10, 31], [37, 30]] },
  ],
  'espresso.ne.png': [
    { kind: 'steam', at: [20, 6], every: 3.6 },
    { kind: 'brew', at: [[20, 6]] },
  ],
  'heirloom-aquarium.sw.png': [
    { kind: 'shimmer', glass: [[10, 19], [64, 34], [64, 60], [10, 45]] },
    { kind: 'fish', glass: [[10, 19], [64, 34], [64, 60], [10, 45]], n: 3 },
    { kind: 'bubbles', glass: [[10, 19], [64, 34], [64, 60], [10, 45]], every: 0.9 },
  ],
  'heirloom-aquarium.ne.png': [
    { kind: 'shimmer', glass: [[10, 23], [66, 39], [66, 66], [10, 51]] },
    { kind: 'fish', glass: [[10, 23], [66, 39], [66, 66], [10, 51]], n: 3 },
    { kind: 'bubbles', glass: [[10, 23], [66, 39], [66, 66], [10, 51]], every: 0.9 },
  ],
  'fireplace.sw.png': [{ kind: 'flames', at: [30, 60], spread: 7, rate: 10 }],
  'heirloom-dragonlamp.se.png': [{ kind: 'glow', at: [40, 37], r: 9, color: '255,214,140', speed: 1.3 }],
  'heirloom-dragonlamp.nw.png': [{ kind: 'glow', at: [10, 27], r: 9, color: '255,214,140', speed: 1.3 }],
  'server-rack.sw.png': [
    { kind: 'blink', at: [[6, 31], [6, 37], [6, 44], [7, 51], [7, 57], [7, 62], [7, 67], [19, 78], [20, 84]], colors: ['#6bff8e', '#6bff8e', '#ffb347'] },
  ],
  'server-rack.ne.png': [{ kind: 'blink', at: [[33, 42], [33, 47], [33, 53], [34, 58], [34, 63]], colors: ['#6bff8e', '#ffb347'] }],
  'jukebox.sw.png': [
    { kind: 'glow', at: [19, 26], r: 12, color: '255,110,210', speed: 0.8, cycle: ['255,110,210', '110,220,255', '180,130,255'] },
    { kind: 'notes', at: [19, 4], every: 2.4 },
  ],
  'jukebox.ne.png': [{ kind: 'glow', at: [46, 30], r: 8, color: '255,110,210', speed: 0.8, cycle: ['255,110,210', '110,220,255', '180,130,255'] }],
  'clock-grand.se.png': [
    { kind: 'pendulum', pivot: [22, 52], len: 31, bob: 3, clear: [[17, 52], [27, 52], [27, 90], [17, 90]], amp: 0.14 },
    { kind: 'clockface', at: [24, 34], rx: 3.5, ry: 5, paper: 'rgb(237,214,181)' },
  ],
  'desk.sw.png': DESK_SW,
  'desk.light.sw.png': DESK_SW,
  'desk.wood.sw.png': DESK_SW,
  'cake-table.sw.png': [{ kind: 'candles', at: [[21, 2], [24, 1], [27, 2]] }],
  'balloons.se.png': [{ kind: 'bob', amp: 1, period: 3 }],
  'balloons.nw.png': [{ kind: 'bob', amp: 1, period: 3 }],
  'balloons.b.se.png': [{ kind: 'bob', amp: 1, period: 3.4 }],
  'balloons.b.nw.png': [{ kind: 'bob', amp: 1, period: 3.4 }],
  'balloons.c.se.png': [{ kind: 'bob', amp: 1, period: 2.7 }],
  'balloons.c.nw.png': [{ kind: 'bob', amp: 1, period: 2.7 }],
  'balloons.png': [{ kind: 'bob', amp: 1, period: 3 }],
  'balloons.b.png': [{ kind: 'bob', amp: 1, period: 3.4 }],
  'balloons.c.png': [{ kind: 'bob', amp: 1, period: 2.7 }],
  'heirloom-bell.png': [{ kind: 'ring', at: [22, 26] }],
  'claw-machine.sw.png': [{ kind: 'chase', from: [7, 12], to: [44, 13], n: 9, colors: ['#ffe66b', '#ff6bd5'] }],
  'claw-machine.ne.png': [{ kind: 'chase', from: [3, 11], to: [40, 11], n: 9, colors: ['#ffe66b', '#ff6bd5'] }],
  'arcade-cabinet.sw.png': ARCADE_SW,
  'arcade-cabinet.ne.png': ARCADE_NE,
};
for (const c of ['cyan', 'gold', 'lime', 'orange', 'pink']) {
  BY_FILE[`arcade-cabinet.${c}.sw.png`] = ARCADE_SW;
  BY_FILE[`arcade-cabinet.${c}.ne.png`] = ARCADE_NE;
}

export function hasAnimation(file: string | undefined): boolean {
  return !!file && !!BY_FILE[file]?.length;
}

interface Fish {
  u: number;
  v: number;
  dir: number;
  speed: number;
  phase: number;
  color: string;
  patch: string;
}

interface Live {
  obj: SceneObject;
  sprite: Sprite;
  dx: number;
  dy: number;
  specs: AnimSpec[];
  /** Drawing px → world px. */
  at: (p: P) => [number, number];
  clock: number[];
  fish: Fish[];
  seed: number;
  /** Colour sampled from the drawing, for pendulum windows. */
  fill?: string;
  /** When it was last rung (this.t seconds). */
  rungAt?: number;
}

const KOI: Array<[string, string]> = [
  ['#ff7a2f', '#fff4e6'],
  ['#fff4e6', '#ff5a36'],
  ['#ffb03b', '#2a1f2d'],
];

export class ObjectAnimations {
  private live = new Map<string, Live>();
  private t = 0;

  constructor(
    private readonly effects: Effects,
    private readonly isOn: (id: string) => boolean,
  ) {}

  /** Pick up every object in the scene that has something to do. */
  load(statics: Array<{ obj: SceneObject; sprite: Sprite; dx: number; dy: number }>) {
    this.live.clear();
    for (const st of statics) {
      const specs = st.sprite.file ? BY_FILE[st.sprite.file] : undefined;
      if (!specs?.length) continue;
      const k = st.sprite.scale ?? 1;
      const w = st.sprite.canvas.width;
      const at = (p: P): [number, number] => [st.dx + (st.sprite.mirrored ? w - p[0] : p[0]) / k, st.dy + p[1] / k];
      const seed = (st.obj.x * 31 + st.obj.y * 17) % 97;
      const live: Live = { obj: st.obj, sprite: st.sprite, dx: st.dx, dy: st.dy, specs, at, clock: specs.map((_, i) => (seed * 0.37 + i) % 3), fish: [], seed };
      for (const s of specs) {
        if (s.kind === 'fish')
          for (let i = 0; i < s.n; i++) {
            const [color, patch] = KOI[(seed + i) % KOI.length];
            live.fish.push({ u: 0.15 + ((seed * 7 + i * 29) % 70) / 100, v: 0.3 + ((i * 23 + seed) % 45) / 100, dir: i % 2 ? 1 : -1, speed: 0.05 + (i % 3) * 0.018, phase: i * 1.7, color, patch });
          }
        if (s.kind === 'pendulum') live.fill = sampleColor(st.sprite, s.clear);
      }
      this.live.set(st.obj.id, live);
    }
  }

  /** A one-off moment on an object: 'brew' (an espresso machine pulling a shot), 'ring' (the bell). */
  trigger(objectId: string, what: 'brew' | 'ring') {
    const l = this.live.get(objectId);
    if (!l) return;
    if (what === 'ring') {
      l.rungAt = this.t;
      return;
    }
    for (const s of l.specs) {
      if (s.kind !== 'brew' || what !== 'brew') continue;
      for (const p of s.at) {
        const [x, y] = l.at(p);
        for (let i = 0; i < 14; i++)
          this.effects.add({ x: x + (Math.random() - 0.5) * 3, y: y - Math.random() * 2, vx: (Math.random() - 0.5) * 7, vy: -9 - Math.random() * 9, max: 1.4 + Math.random() * 0.9, size: 1.4 + Math.random() * 1.2, color: 'rgba(255,255,255,0.7)', gravity: -2 });
      }
    }
  }

  update(dt: number, reducedMotion: boolean) {
    this.t += dt;
    if (reducedMotion) return;
    for (const l of this.live.values()) {
      const on = this.isOn(l.obj.id);
      l.specs.forEach((s, i) => {
        l.clock[i] += dt;
        if (s.kind === 'steam' && l.clock[i] > s.every) {
          l.clock[i] = -Math.random() * s.every * 0.5;
          const [x, y] = l.at(s.at);
          for (let k = 0; k < 3; k++)
            this.effects.add({ x: x + (Math.random() - 0.5) * 1.5, y: y - k * 1.2, vx: (Math.random() - 0.5) * 2, vy: -5 - Math.random() * 3, max: 1.6 + Math.random() * 0.6, size: 1 + Math.random() * 0.6, color: 'rgba(255,255,255,0.45)', gravity: -0.5 });
        }
        if (s.kind === 'flames' && on) {
          l.clock[i] += dt * s.rate;
          while (l.clock[i] > 1) {
            l.clock[i] -= 1;
            const [x, y] = l.at(s.at);
            this.effects.add({ x: x + (Math.random() - 0.5) * s.spread, y, vx: (Math.random() - 0.5) * 3, vy: -6 - Math.random() * 6, max: 0.55 + Math.random() * 0.3, size: 1, color: Math.random() > 0.5 ? '#ffb347' : '#ffd23f', gravity: -4, kind: 'square' });
          }
        }
        if (s.kind === 'bubbles' && l.clock[i] > s.every) {
          l.clock[i] = -Math.random() * s.every;
          const g = s.glass;
          const u = 0.15 + Math.random() * 0.7;
          const bottom = lerp2(lerp2(g[3], g[2], u), lerp2(g[0], g[1], u), 0.08);
          const top = lerp2(lerp2(g[3], g[2], u), lerp2(g[0], g[1], u), 0.9);
          const [x, y] = l.at(bottom);
          const [, ty] = l.at(top);
          const rise = (y - ty) / 2.2;
          this.effects.add({ x, y, vx: 0, vy: -rise, max: 2.1, size: 0.6, color: 'rgba(225,245,255,0.8)', gravity: 0 });
        }
        if (s.kind === 'notes' && on && l.clock[i] > s.every) {
          l.clock[i] = -Math.random();
          const [x, y] = l.at(s.at);
          this.effects.add({ x, y, vx: (Math.random() - 0.3) * 4, vy: -7, max: 2.2, size: 2, color: Math.random() > 0.5 ? '#ff8ad8' : '#8ae2ff', gravity: 0, kind: 'note' });
        }
      });
      for (const f of l.fish) {
        f.u += f.dir * f.speed * dt;
        if (f.u > 0.88 || f.u < 0.12) {
          f.dir = -f.dir;
          f.u = Math.max(0.12, Math.min(0.88, f.u));
        }
        f.v += Math.sin(this.t * 0.7 + f.phase) * 0.02 * dt;
        f.v = Math.max(0.2, Math.min(0.8, f.v));
      }
    }
  }

  /** How far to nudge an object's whole drawing this frame (world px): balloons bob, a rung bell shakes. */
  offset(objectId: string, reducedMotion: boolean): [number, number] {
    const l = this.live.get(objectId);
    if (!l || reducedMotion) return [0, 0];
    let dx = 0;
    let dy = 0;
    for (const s of l.specs) {
      if (s.kind === 'bob') dy += Math.round(Math.sin((this.t / s.period) * Math.PI * 2 + l.seed) * s.amp * 2) / 2;
      if (s.kind === 'ring' && l.rungAt !== undefined) {
        const age = this.t - l.rungAt;
        if (age < 1.4) dx += Math.round(Math.sin(age * 28) * (1.4 - age) * 1.2);
      }
    }
    return [dx, dy];
  }

  /** Draw an object's inline animations; called right after the object itself is drawn. */
  drawFor(c: CanvasRenderingContext2D, objectId: string, reducedMotion: boolean) {
    const l = this.live.get(objectId);
    if (!l) return;
    const on = this.isOn(l.obj.id);
    const t = reducedMotion ? 0 : this.t;
    const k = l.sprite.scale ?? 1;
    const px = 1 / k; // one drawing pixel, in world px
    for (const s of l.specs) {
      switch (s.kind) {
        case 'fish': {
          c.save();
          clipQuad(c, s.glass.map(l.at) as Quad);
          for (const f of l.fish) {
            const p = l.at(lerp2(lerp2(s.glass[0], s.glass[3], f.v), lerp2(s.glass[1], s.glass[2], f.v), f.u));
            const wig = Math.round(Math.sin(t * 4 + f.phase));
            const dir = (l.sprite.mirrored ? -1 : 1) * f.dir;
            c.fillStyle = f.color;
            c.fillRect(p[0] - 2 * px, p[1] - px + wig * 0.25 * px, 5 * px, 2 * px);
            c.fillStyle = f.patch;
            c.fillRect(p[0] + (dir > 0 ? 0 : -px), p[1] - px, 2 * px, px);
            c.fillStyle = f.color;
            c.fillRect(p[0] + (dir > 0 ? -3 : 3) * px, p[1] - px + (wig > 0 ? 0 : px), px, px); // tail flick
          }
          c.restore();
          break;
        }
        case 'blink': {
          s.at.forEach((p, i) => {
            const period = 1.1 + ((l.seed + i * 13) % 7) * 0.35;
            const lit = ((t + i * 0.37) % period) / period < 0.62;
            if (!lit) return;
            const [x, y] = l.at(p);
            c.fillStyle = s.colors[i % s.colors.length];
            c.fillRect(x - px / 2, y - px / 2, px, px);
          });
          break;
        }
        case 'glow': {
          if (!on) break;
          const [x, y] = l.at(s.at);
          const color = s.cycle ? mixCycle(s.cycle, t * 0.12 + l.seed * 0.1) : s.color;
          const a = 0.16 + 0.1 * Math.sin(t * s.speed + l.seed) + 0.04 * Math.sin(t * 3.1 * s.speed);
          const r = s.r * px;
          const g = c.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(${color},${a})`);
          g.addColorStop(1, `rgba(${color},0)`);
          c.save();
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = g;
          c.fillRect(x - r, y - r, r * 2, r * 2);
          c.restore();
          break;
        }
        case 'chase': {
          for (let i = 0; i < s.n; i++) {
            const lit = Math.floor(t * 4) % 3 === i % 3;
            const [x, y] = l.at(lerp2(s.from, s.to, i / (s.n - 1)));
            c.fillStyle = lit ? s.colors[0] : s.colors[1];
            c.globalAlpha = lit ? 1 : 0.55;
            c.fillRect(x - px / 2, y - px / 2, px, px);
          }
          c.globalAlpha = 1;
          break;
        }
        case 'screen': {
          c.save();
          const q = s.quad.map(l.at) as Quad;
          clipQuad(c, q);
          const top = Math.min(...q.map((p) => p[1]));
          const bottom = Math.max(...q.map((p) => p[1]));
          const left = Math.min(...q.map((p) => p[0]));
          const right = Math.max(...q.map((p) => p[0]));
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = `rgba(120,200,255,${0.05 + 0.04 * Math.sin(t * 1.7 + l.seed)})`;
          c.fillRect(left, top, right - left, bottom - top);
          const band = top + ((t * 9 + l.seed) % (bottom - top + 6)) - 3;
          c.fillStyle = 'rgba(255,255,255,0.13)';
          c.fillRect(left, band, right - left, px * 2);
          c.restore();
          break;
        }
        case 'pendulum': {
          const q = s.clear.map(l.at) as Quad;
          c.save();
          clipQuad(c, q);
          c.fillStyle = l.fill ?? '#3a2618';
          c.fillRect(Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), 40, 60);
          const [ox, oy] = l.at(s.pivot);
          const ang = Math.sin(t * 2.4) * s.amp;
          const len = s.len * px;
          const bx = ox + Math.sin(ang) * len * (l.sprite.mirrored ? -1 : 1);
          const by = oy + Math.cos(ang) * len;
          c.strokeStyle = '#c9a24a';
          c.lineWidth = px;
          c.beginPath();
          c.moveTo(ox, oy);
          c.lineTo(bx, by);
          c.stroke();
          c.fillStyle = '#e8c46a';
          c.beginPath();
          c.arc(bx, by, s.bob * px, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#fff2c0';
          c.fillRect(bx - px, by - px * 1.5, px, px);
          c.restore();
          break;
        }
        case 'clockface': {
          // the real time, on a face whose painted hands are covered first
          const [x, y] = l.at(s.at);
          c.fillStyle = s.paper;
          c.beginPath();
          c.ellipse(x, y, s.rx * px, s.ry * px, 0, 0, Math.PI * 2);
          c.fill();
          const now = worldTimeNow(); // the world clock, the same for everyone
          const mins = now.minutes;
          const hours = (now.hours % 12) + mins / 60;
          const flip = l.sprite.mirrored ? -1 : 1;
          const hand = (turn: number, len: number, w: number) => {
            const a = turn * Math.PI * 2;
            c.strokeStyle = '#2a1f2d';
            c.lineWidth = w * px;
            c.beginPath();
            c.moveTo(x, y);
            c.lineTo(x + Math.sin(a) * s.rx * len * px * flip, y - Math.cos(a) * s.ry * len * px);
            c.stroke();
          };
          hand(hours / 12, 0.55, 1);
          hand(mins / 60, 0.85, 0.8);
          c.fillStyle = '#b8872e';
          c.fillRect(x - px / 2, y - px / 2, px, px);
          break;
        }
        case 'shimmer': {
          c.save();
          const q = s.glass.map(l.at) as Quad;
          clipQuad(c, q);
          c.globalCompositeOperation = 'lighter';
          const left = Math.min(...q.map((p) => p[0]));
          const right = Math.max(...q.map((p) => p[0]));
          const top = Math.min(...q.map((p) => p[1]));
          const bottom = Math.max(...q.map((p) => p[1]));
          for (let i = 0; i < 3; i++) {
            const phase = (t * 0.18 + i / 3 + l.seed * 0.01) % 1;
            const x = left + phase * (right - left + 20) - 10;
            const g = c.createLinearGradient(x - 6, top, x + 6, bottom);
            g.addColorStop(0, 'rgba(200,245,255,0)');
            g.addColorStop(0.5, 'rgba(200,245,255,0.09)');
            g.addColorStop(1, 'rgba(200,245,255,0)');
            c.fillStyle = g;
            c.fillRect(left, top, right - left, bottom - top);
          }
          c.restore();
          break;
        }
        case 'code': {
          c.save();
          const q = s.quad.map(l.at) as Quad;
          clipQuad(c, q);
          const rows = 7;
          const scroll = Math.floor(t / 1.5 + l.seed);
          for (let r = 0; r < rows; r++) {
            const line = scroll + r;
            const indent = ((line * 7) % 3) * 0.12;
            const len = 0.25 + (((line * 13) % 7) / 7) * 0.55;
            const v = (r + 0.6) / (rows + 0.4);
            const a = l.at(lerp2(lerp2(s.quad[0], s.quad[3], v), lerp2(s.quad[1], s.quad[2], v), 0.08 + indent));
            const b = l.at(lerp2(lerp2(s.quad[0], s.quad[3], v), lerp2(s.quad[1], s.quad[2], v), Math.min(0.94, 0.08 + indent + len)));
            c.strokeStyle = s.colors[line % s.colors.length];
            c.globalAlpha = 0.55;
            c.lineWidth = px;
            c.beginPath();
            c.moveTo(a[0], a[1]);
            c.lineTo(b[0], b[1]);
            c.stroke();
          }
          c.restore();
          break;
        }
        case 'candles': {
          s.at.forEach((p, i) => {
            const [x, y] = l.at(p);
            const flick = Math.floor(t * 9 + i * 3) % 3;
            c.fillStyle = flick === 0 ? '#ffe28a' : '#ffb347';
            const h = flick === 2 ? 2.5 : 2;
            c.fillRect(x - px / 2, y - px * h, px, px * h);
          });
          break;
        }
        case 'ring': {
          if (l.rungAt === undefined) break;
          const age = t - l.rungAt;
          if (age > 1.6 || age < 0) break;
          const [x, y] = l.at(s.at);
          for (let i = 0; i < 3; i++) {
            const k = age * 1.5 - i * 0.25;
            if (k <= 0 || k > 1) continue;
            c.strokeStyle = `rgba(255,236,160,${(1 - k) * 0.8})`;
            c.lineWidth = px * 1.5;
            c.beginPath();
            c.ellipse(x, y, (6 + k * 18) * px * 2, (4 + k * 12) * px * 2, 0, -Math.PI * 0.85, -Math.PI * 0.15);
            c.stroke();
          }
          break;
        }
      }
    }
  }
}


/** A colour sliding slowly around a cycle of "r,g,b" colours. */
function mixCycle(colors: string[], t: number): string {
  const n = colors.length;
  const f = ((t % n) + n) % n;
  const a = colors[Math.floor(f)].split(',').map(Number);
  const b = colors[(Math.floor(f) + 1) % n].split(',').map(Number);
  const k = f - Math.floor(f);
  return a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',');
}

function lerp2(a: P, b: P, t: number): P {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipQuad(c: CanvasRenderingContext2D, q: Quad) {
  c.beginPath();
  c.moveTo(q[0][0], q[0][1]);
  for (let i = 1; i < 4; i++) c.lineTo(q[i][0], q[i][1]);
  c.closePath();
  c.clip();
}

/** The most common colour inside a quad of a drawing (unmirrored drawing px). */
function sampleColor(sprite: Sprite, q: Quad): string {
  const ctx = sprite.canvas.getContext('2d');
  if (!ctx) return '#3a2618';
  const w = sprite.canvas.width;
  const xs = q.map((p) => (sprite.mirrored ? w - p[0] : p[0]));
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(w, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[1]))));
  const y1 = Math.min(sprite.canvas.height, Math.ceil(Math.max(...q.map((p) => p[1]))));
  if (x1 <= x0 || y1 <= y0) return '#3a2618';
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const count = new Map<string, number>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const key = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) return '#3a2618';
  const [r, g, b] = best.split(',').map((v) => Number(v) * 8 + 4);
  return `rgb(${r},${g},${b})`;
}
