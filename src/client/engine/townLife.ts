/**
 * The small life of the town, all in world (art) space and deterministic in where it lives (so every visitor
 * sees the same garden busy): butterflies over the flower beds and meadow flowers by day, pigeons pecking on
 * the plaza that flutter up when someone walks through them, now and then a flock of birds crossing high over
 * the town with their shadows running over the ground, leaves and blossom drifting down from the trees, and at
 * dusk and night fireflies over the meadows and the shore (drawn after the dimming, so they glow).
 */
import { isoToScreen } from '@shared/iso';
import { hash2 } from '@shared/world/builders';
import { footprint, terrainAt, type SceneDef, type SceneObject } from '@shared/world/scene';
import type { Sprite } from './sprites/painter';

interface Butterfly {
  cx: number; // home (world px)
  cy: number;
  seed: number;
  color: string;
}
interface Pigeon {
  x: number; // tile coords
  y: number;
  tx: number; // where it's going (fluttering) or pecking
  ty: number;
  fly: number; // 0 on the ground, >0 seconds left in the air
  seed: number;
  face: number;
}
interface Leaf {
  x: number;
  y: number;
  ground: number; // world y where it lands
  vx: number;
  life: number;
  max: number;
  color: string;
  seed: number;
}
interface Flock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  n: number;
  seed: number;
}

const WINGS = ['#fff8e6', '#ffd23f', '#ff9a3d', '#8ec5ff', '#f7a8c8'];
const LEAVES = ['#7cc26a', '#a7cf5a', '#e2b84a', '#c98a3a'];
const PETALS = ['#ffc4dc', '#ffd9e8', '#f7a8c8'];

export class TownLife {
  private butterflies: Butterfly[] = [];
  private pigeons: Pigeon[] = [];
  private plaza: Array<[number, number]> = [];
  private trees: Array<{ x: number; y: number; ground: number; blossom: boolean }> = [];
  private leaves: Leaf[] = [];
  private flocks: Flock[] = [];
  private fireflies: Array<{ x: number; y: number; seed: number }> = [];
  private nextFlock = 8;
  private leafAcc = 0;
  private t = 0;
  private span = 1400;

  load(scene: SceneDef, statics: Array<{ obj: SceneObject; sprite: Sprite; dx: number; dy: number }>) {
    this.butterflies = [];
    this.pigeons = [];
    this.plaza = [];
    this.trees = [];
    this.leaves = [];
    this.flocks = [];
    this.fireflies = [];
    if (scene.kind !== 'outdoor') return;
    this.span = (scene.width + scene.height) * 8 + 400;
    const centre = (o: SceneObject) => {
      const f = footprint(o);
      return isoToScreen((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2);
    };
    // butterflies: one or two over each bed of flowers
    for (const o of scene.objects) {
      const flowers =
        o.sprite === 'flowerbed' ||
        o.sprite === 'wildflowers' ||
        o.sprite === 'flower-cart' ||
        (o.sprite === 'garden-bed' && o.variant !== 'veg') ||
        (o.sprite === 'bush' && o.variant === 'flower');
      if (!flowers) continue;
      const h = hash2(o.x, o.y, 81);
      const n = o.sprite === 'bush' ? (h > 0.7 ? 1 : 0) : h > 0.55 ? 2 : 1;
      const c = centre(o);
      for (let i = 0; i < n; i++)
        this.butterflies.push({ cx: c.x, cy: c.y, seed: o.x * 13.1 + o.y * 7.7 + i * 3.3, color: WINGS[Math.floor(hash2(o.x + i, o.y, 82) * WINGS.length)] });
    }
    // trees shed leaves (cherries: petals)
    for (const st of statics) {
      if (!st.obj.sprite.startsWith('tree')) continue;
      const k = st.sprite.scale ?? 1;
      const w = st.sprite.canvas.width / k;
      const h = st.sprite.canvas.height / k;
      const g = centre(st.obj);
      this.trees.push({ x: st.dx + w / 2, y: st.dy + h * 0.35, ground: g.y, blossom: st.obj.variant === 'b' && st.obj.sprite === 'tree/round' });
    }
    // pigeons on the open plaza round the fountain
    const fountain = scene.objects.find((o) => o.sprite === 'fountain');
    if (fountain) {
      const taken = new Set<string>();
      for (const o of scene.objects) {
        const f = footprint(o);
        for (let y = f.y0 - 1; y <= f.y1; y++) for (let x = f.x0 - 1; x <= f.x1; x++) taken.add(`${x},${y}`);
      }
      for (let y = fountain.y - 5; y <= fountain.y + 8; y++)
        for (let x = fountain.x - 5; x <= fountain.x + 8; x++) if (terrainAt(scene, x, y) === 'P' && !taken.has(`${x},${y}`)) this.plaza.push([x, y]);
      for (let i = 0; i < Math.min(6, this.plaza.length); i++) {
        const [x, y] = this.plaza[Math.floor(hash2(i, 3, 83) * this.plaza.length)];
        const px = x + hash2(i, 4, 83) * 0.8;
        const py = y + hash2(i, 5, 83) * 0.8;
        this.pigeons.push({ x: px, y: py, tx: px, ty: py, fly: 0, seed: i * 1.7, face: hash2(i, 6, 83) > 0.5 ? 1 : -1 });
      }
    }
    // fireflies over the meadows, the trails and the shore
    for (let i = 0, tries = 0; i < 170 && tries < 8000; tries++) {
      const x = Math.floor(hash2(tries, 1, 84) * scene.width);
      const y = Math.floor(hash2(tries, 2, 84) * scene.height);
      const c = terrainAt(scene, x, y);
      if (c !== 'm' && c !== 't' && c !== 's' && !((c === 'g' || c === 'h') && hash2(x, y, 85) > 0.8)) continue;
      const p = isoToScreen(x + hash2(tries, 3, 84), y + hash2(tries, 4, 84));
      this.fireflies.push({ x: p.x, y: p.y, seed: tries * 0.61 });
      i++;
    }
  }

  update(dt: number, people: Array<{ x: number; y: number }>, night: number) {
    this.t += dt;
    const r = Math.random;
    // pigeons: peck about, hop now and then, and take off when someone walks up
    for (const p of this.pigeons) {
      if (p.fly > 0) {
        p.fly -= dt;
        const k = Math.min(1, dt * 1.6);
        p.x += (p.tx - p.x) * k;
        p.y += (p.ty - p.y) * k;
        if (p.fly <= 0) {
          p.x = p.tx;
          p.y = p.ty;
        }
        continue;
      }
      const near = people.some((a) => Math.hypot(a.x + 0.5 - p.x, a.y + 0.5 - p.y) < 1.4);
      if ((near || r() < dt * 0.02) && this.plaza.length) {
        const [x, y] = this.plaza[Math.floor(r() * this.plaza.length)];
        p.tx = x + r() * 0.8;
        p.ty = y + r() * 0.8;
        p.fly = 1.6;
        p.face = p.tx - p.ty > p.x - p.y ? 1 : -1;
      } else if (r() < dt * 0.25) {
        // a hop
        p.x += (r() - 0.5) * 0.3;
        p.y += (r() - 0.5) * 0.3;
        p.face = r() > 0.5 ? 1 : -1;
      }
    }
    // leaves drift down: a few a second across the town, blossom from the cherries
    if (this.trees.length && night < 0.9) {
      this.leafAcc += dt * 5;
      while (this.leafAcc > 1) {
        this.leafAcc -= 1;
        const tr = this.trees[Math.floor(r() * this.trees.length)];
        const pal = tr.blossom ? PETALS : LEAVES;
        this.leaves.push({ x: tr.x + (r() - 0.5) * 24, y: tr.y + (r() - 0.5) * 12, ground: tr.ground + (r() - 0.3) * 10, vx: 3 + r() * 5, life: 0, max: 9, color: pal[Math.floor(r() * pal.length)], seed: r() * 10 });
      }
    }
    for (const l of this.leaves) {
      l.life += dt;
      if (l.y < l.ground) {
        l.y += dt * 9;
        l.x += (l.vx + Math.sin(l.life * 2.4 + l.seed) * 10) * dt;
      }
    }
    this.leaves = this.leaves.filter((l) => l.life < l.max);
    // a flock crosses the sky every half minute or so, by day
    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.nextFlock = 25 + r() * 30;
      if (night < 0.7) {
        const fromLeft = r() > 0.5;
        this.flocks.push({ x: fromLeft ? -this.span : this.span, y: 100 + r() * this.span * 0.6, vx: (fromLeft ? 1 : -1) * (46 + r() * 16), vy: (r() - 0.5) * 12, n: 5 + Math.floor(r() * 5), seed: r() * 10 });
      }
    }
    for (const f of this.flocks) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.flocks = this.flocks.filter((f) => Math.abs(f.x) < this.span + 200);
  }

  /** With the other things drawn over the objects (before the time of day dims the scene). */
  draw(ctx: CanvasRenderingContext2D, night: number, still: boolean) {
    const t = still ? 0 : this.t;
    // leaves and petals: two pixels, turning as they fall, fading once they've settled
    for (const l of this.leaves) {
      const settled = l.y >= l.ground;
      ctx.globalAlpha = Math.min(1, (l.max - l.life) / 2);
      ctx.fillStyle = l.color;
      const turn = Math.sin(l.life * 5 + l.seed) > 0;
      ctx.fillRect(Math.round(l.x), Math.round(l.y), settled || turn ? 2 : 1, settled || turn ? 1 : 2);
    }
    ctx.globalAlpha = 1;
    // pigeons: a grey body with a darker head, bobbing as they peck; wings out in flight
    for (const p of this.pigeons) {
      const s = isoToScreen(p.x, p.y);
      const air = p.fly > 0 ? Math.sin((1.6 - p.fly) / 1.6 * Math.PI) * 14 : 0;
      const x = Math.round(s.x);
      const y = Math.round(s.y - air);
      if (air > 0) {
        ctx.fillStyle = 'rgba(40,30,50,0.18)';
        ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y), 3, 1);
        const flap = Math.sin(this.t * 30) > 0;
        ctx.fillStyle = '#8b8f9c';
        ctx.fillRect(x - 3, y - (flap ? 3 : 1), 2, 1);
        ctx.fillRect(x + 2, y - (flap ? 3 : 1), 2, 1);
      } else {
        ctx.fillStyle = 'rgba(40,30,50,0.2)';
        ctx.fillRect(x - 1, y, 4, 1);
      }
      const peck = air === 0 && Math.sin(t * 3 + p.seed * 5) > 0.6 ? 1 : 0;
      ctx.fillStyle = '#9ea3b0';
      ctx.fillRect(x - 1, y - 3, 3, 2);
      ctx.fillStyle = '#6f7384';
      ctx.fillRect(p.face > 0 ? x + 2 : x - 2, y - 4 + peck, 1, 2);
      ctx.fillStyle = '#c9ccd6';
      ctx.fillRect(x, y - 3, 1, 1);
    }
    const day = 1 - night;
    if (day > 0.2) {
      // butterflies: wandering loops over their flowers, wings beating, landing now and then
      ctx.globalAlpha = Math.min(1, day * 1.2);
      for (const b of this.butterflies) {
        const u = t * 0.5 + b.seed;
        const rest = Math.sin(u * 0.7) > 0.8; // sitting on a flower, wings slowly opening and closing
        const x = b.cx + (rest ? Math.sin(Math.floor(u * 0.7 / (Math.PI * 2)) * 2.1) * 6 : Math.sin(u * 1.3) * 11 + Math.sin(u * 3.1) * 4);
        const y = b.cy + (rest ? -8 : Math.cos(u * 1.1) * 5 - 13 + Math.sin(u * 4.3) * 3);
        const open = rest ? Math.sin(t * 2 + b.seed) > 0 : Math.sin(t * 22 + b.seed * 3) > 0;
        const X = Math.round(x);
        const Y = Math.round(y);
        ctx.fillStyle = b.color;
        if (open) {
          ctx.fillRect(X - 3, Y - 2, 3, 2);
          ctx.fillRect(X + 1, Y - 2, 3, 2);
          ctx.fillRect(X - 2, Y, 2, 1);
          ctx.fillRect(X + 1, Y, 2, 1);
        } else ctx.fillRect(X - 1, Y - 3, 3, 2);
        ctx.fillStyle = '#3a2a2a';
        ctx.fillRect(X, Y - 1, 1, 2);
      }
      ctx.globalAlpha = 1;
      // flocks: little dark wings in a loose V, their shadows sliding over the ground below
      for (const f of this.flocks) {
        const dir = Math.sign(f.vx);
        for (let i = 0; i < f.n; i++) {
          const row = Math.ceil(i / 2);
          const side = i % 2 ? 1 : -1;
          const bx = f.x - dir * row * 9 + Math.sin(t * 0.8 + i) * 2;
          const by = f.y + side * row * 6;
          const alt = 150;
          ctx.fillStyle = 'rgba(40,30,50,0.10)';
          ctx.fillRect(Math.round(bx) - 2, Math.round(by), 4, 1);
          const flap = Math.sin(t * 9 + i * 1.3 + f.seed) > 0;
          const X = Math.round(bx);
          const Y = Math.round(by - alt);
          ctx.fillStyle = '#3d3a48';
          ctx.fillRect(X, Y, 1, 1);
          ctx.fillRect(X - 2, Y - (flap ? 1 : 0), 2, 1);
          ctx.fillRect(X + 1, Y - (flap ? 1 : 0), 2, 1);
        }
      }
    }
  }

  /** After the dimming: fireflies, glowing at dusk and through the night. */
  drawLights(ctx: CanvasRenderingContext2D, night: number, still: boolean) {
    if (night < 0.3 || !this.fireflies.length) return;
    const t = still ? 0 : this.t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.fireflies) {
      const blink = Math.sin(t * (0.9 + (f.seed % 0.7)) + f.seed * 7);
      if (blink < 0.2) continue;
      const a = (blink - 0.2) / 0.8 * night;
      const x = f.x + Math.sin(t * 0.4 + f.seed) * 9;
      const y = f.y - 10 + Math.sin(t * 0.55 + f.seed * 2) * 5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
      g.addColorStop(0, `rgba(210,255,120,${0.7 * a})`);
      g.addColorStop(0.4, `rgba(190,245,110,${0.25 * a})`);
      g.addColorStop(1, 'rgba(190,245,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 7, y - 7, 14, 14);
      ctx.fillStyle = `rgba(250,255,200,${a})`;
      ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
    }
    ctx.restore();
  }
}
