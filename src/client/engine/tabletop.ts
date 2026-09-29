/**
 * Table games played on the drawing itself: a pool break and an air-hockey shot.
 *
 * The painted pieces are lifted off the drawing and moved (the cue ball, the puck, both mallets), the painted
 * rack is covered with felt while its balls are out, and after a while the table puts itself back the way it
 * was painted. Everything is placed in the drawing's own pixels (unmirrored) on its playing surface, so the
 * game plays true whichever way the table is turned.
 */
import type { Effects } from './effects';
import { makeCanvas, type Sprite } from './sprites/painter';

type P = [number, number];
/** A box in drawing px, inclusive: x0, y0, x1, y1. */
type Box = [number, number, number, number];

export interface TableSpec {
  game: 'pool' | 'hockey';
  /** The playing surface (the felt, the air deck) by three corners: its origin, the corner along its length, the corner across it. */
  surface: [P, P, P];
  /** Painted pieces lifted off and moved. Pool: the cue ball. Hockey: the puck, the near mallet, the far mallet. */
  pieces: Array<{ at: P; box: Box }>;
  /** Painted things covered while a game is on (the racked balls), and their centre. */
  cover?: { at: P; box: Box };
}

export const TABLES: Record<string, TableSpec> = {
  'pool-table.sw.png': {
    game: 'pool',
    surface: [[15, 35], [103, 77], [61, 13]],
    pieces: [{ at: [95, 41.5], box: [92, 38, 98, 45] }],
    cover: { at: [51, 32], box: [34, 20, 67, 44] },
  },
  'pool-table.ne.png': {
    game: 'pool',
    surface: [[14, 37], [99, 81], [62, 13]],
    pieces: [{ at: [54, 37.5], box: [50, 34, 58, 41] }],
    cover: { at: [107, 53], box: [91, 40, 125, 66] },
  },
  'air-hockey.sw.png': {
    game: 'hockey',
    surface: [[11, 17], [63, 43], [31, 8]],
    pieces: [
      { at: [52, 32], box: [48, 29, 56, 35] },
      { at: [64.5, 35], box: [59, 30, 70, 40] },
      { at: [30, 13.5], box: [25, 9, 35, 18] },
    ],
  },
  'air-hockey.ne.png': {
    game: 'hockey',
    surface: [[11, 19], [61, 48], [33, 8]],
    pieces: [
      { at: [45, 21.5], box: [40, 19, 50, 24] },
      { at: [61.5, 38.5], box: [56, 33, 67, 44] },
      { at: [34, 13.5], box: [29, 8, 39, 19] },
    ],
  },
};

/** Pool: the cue ball reaches the rack; the balls stay out this long, then the table is racked again. */
export const POOL_HIT = 0.28;
export const POOL_RERACK = 20;
/** Hockey: the mallet meets the puck; the puck is back in play (as painted) after this. */
const HOCKEY_STRIKE = 0.16;
const HOCKEY_RESET = 3.2;
const FADE = 0.8;

const BALL_COLORS = ['#f2c230', '#2f5fd0', '#d8402f', '#7a4bc4', '#f07a2a', '#16704a', '#8c2a2a'];

interface Body {
  s: number;
  t: number;
  vs: number;
  vt: number;
  r: number;
  /** A lifted piece of the drawing (index into pieces), or a ball drawn from scratch. */
  piece?: number;
  color?: string;
  stripe?: boolean;
  /** Headed for this pocket or goal (s, t): it drops in when it gets there. */
  into?: P;
  /** When it dropped in (age), shrinking into the pocket. */
  sank?: number;
  /** Kinematic: moved along a path rather than rolling (a mallet in a hand). */
  path?: (age: number) => P;
}

export class TableGame {
  private readonly O: P;
  private readonly A: P;
  private readonly B: P;
  private readonly LA: number;
  private readonly LB: number;
  private base?: HTMLCanvasElement;
  private baseCue?: HTMLCanvasElement;
  private pieces: HTMLCanvasElement[] = [];
  private bodies: Body[] = [];
  private startedAt = -Infinity;
  private detail = '';
  private broken = false;
  private goalAt = -Infinity;
  private goalEnd: P = [0, 0];
  private blockedAt = -Infinity;

  constructor(
    private readonly sprite: Sprite,
    private readonly spec: TableSpec,
    private readonly effects: Effects,
  ) {
    const [o, a, b] = spec.surface;
    this.O = o;
    this.A = [a[0] - o[0], a[1] - o[1]];
    this.B = [b[0] - o[0], b[1] - o[1]];
    this.LA = Math.hypot(...this.A);
    this.LB = Math.hypot(...this.B);
  }

  /** Seconds into the current game, or Infinity when none is on. */
  private age(now: number) {
    const a = now - this.startedAt;
    return a < this.length() + FADE ? a : Infinity;
  }

  private length() {
    return this.spec.game === 'pool' ? POOL_RERACK : HOCKEY_RESET;
  }

  /** Drawing px → surface (s along its length, t across, both in drawing px). */
  private toST(p: P): P {
    const [x, y] = [p[0] - this.O[0], p[1] - this.O[1]];
    const [a, b] = [this.A, this.B];
    const det = a[0] * b[1] - a[1] * b[0];
    const u = (x * b[1] - y * b[0]) / det;
    const v = (a[0] * y - a[1] * x) / det;
    return [u * this.LA, v * this.LB];
  }

  /** Surface → drawing px. */
  private toXY(s: number, t: number): P {
    const u = s / this.LA;
    const v = t / this.LB;
    return [this.O[0] + this.A[0] * u + this.B[0] * v, this.O[1] + this.A[1] * u + this.B[1] * v];
  }

  /** Lift the pieces off the drawing and fill where they (and the rack) were with the surface around them. */
  private build() {
    if (this.base) return;
    const sp = this.sprite;
    const W = sp.canvas.width;
    const H = sp.canvas.height;
    const src = sp.canvas.getContext('2d')?.getImageData(0, 0, W, H);
    if (!src) return;
    const d = src.data;
    const lum = (i: number) => [Math.min(d[i], d[i + 1], d[i + 2]), Math.max(d[i], d[i + 1], d[i + 2])];
    // the surface itself (anything else in a piece's box is the piece: the ball and its shadow)
    const ground =
      this.spec.game === 'pool'
        ? (i: number) => d[i + 1] >= 100 && d[i + 1] > d[i] + 60 && d[i + 1] > d[i + 2] + 25
        : (i: number) => lum(i)[0] >= 150 && lum(i)[1] - lum(i)[0] < 60;
    // the surface in plain light, with no shade cast on it: what a gap is filled from
    const clean =
      this.spec.game === 'pool'
        ? (i: number) => d[i + 1] >= 135 && d[i + 1] > d[i] + 80 && d[i + 1] > d[i + 2] + 40
        : (i: number) => lum(i)[0] >= 210 && lum(i)[1] - lum(i)[0] < 40;
    // the air deck's painted centre line stays where it is
    const marking = (i: number) => this.spec.game === 'hockey' && d[i + 2] >= 200 && d[i + 1] >= 150 && d[i] < 200 && d[i + 2] > d[i] + 30;
    /** Well inside the playing surface (off the cushions and their shade). */
    const inside = (x: number, y: number, inset: number) => {
      const [s, t] = this.toST([x + 0.5, y + 0.5]);
      return s >= inset && s <= this.LA - inset && t >= inset && t <= this.LB - inset;
    };
    /** Canvas pixels in a box (drawing px) that pass a test. */
    const take = (box: Box, test: (i: number) => boolean, inset?: number) => {
      const out: number[] = [];
      for (let y = Math.max(0, box[1]); y <= Math.min(H - 1, box[3]); y++)
        for (let x = Math.max(0, box[0]); x <= Math.min(W - 1, box[2]); x++) {
          const cx = sp.mirrored ? W - 1 - x : x;
          const i = (y * W + cx) * 4;
          if (d[i + 3] < 100 || !test(i)) continue;
          if (inset !== undefined && !inside(x, y, inset)) continue;
          out.push(y * W + cx);
        }
      return out;
    };
    const pieceIdx = this.spec.pieces.map((p) => take(p.box, (i) => !ground(i) && !marking(i)));
    // where a piece or the rack was, and the shade it cast
    const shade = (box: Box) => take(box, (i) => !clean(i) && !marking(i), 1.5);
    this.pieces = pieceIdx.map((idx) => {
      const cv = makeCanvas(W, H);
      const g = cv.getContext('2d')!;
      const img = g.createImageData(W, H);
      for (const k of idx) for (let j = 0; j < 4; j++) img.data[k * 4 + j] = d[k * 4 + j];
      g.putImageData(img, 0, 0);
      return cv;
    });
    const fill = (idx: number[]) => {
      const out = new Uint8ClampedArray(d);
      const hole = new Uint8Array(W * H);
      const filled = new Uint8Array(W * H);
      for (const k of idx) hole[k] = 1;
      const known = (k: number) => !hole[k] && (filled[k] === 1 || (out[k * 4 + 3] >= 100 && clean(k * 4)));
      // fill from the edges in, each pixel the average of the surface already around it
      let left = idx.filter((k) => hole[k]);
      for (let pass = 0; pass < 40 && left.length; pass++) {
        const done: Array<[number, number, number, number]> = [];
        for (const k of left) {
          const x = k % W;
          const y = (k - x) / W;
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              const nx = x + ox;
              const ny = y + oy;
              if ((!ox && !oy) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const q = ny * W + nx;
              if (!known(q)) continue;
              r += out[q * 4];
              g += out[q * 4 + 1];
              b += out[q * 4 + 2];
              n++;
            }
          if (n) done.push([k, r / n, g / n, b / n]);
        }
        if (!done.length) break;
        for (const [k, r, g, b] of done) {
          out[k * 4] = r;
          out[k * 4 + 1] = g;
          out[k * 4 + 2] = b;
          out[k * 4 + 3] = 255;
          hole[k] = 0;
          filled[k] = 1;
        }
        left = left.filter((k) => hole[k]);
      }
      const cv = makeCanvas(W, H);
      cv.getContext('2d')!.putImageData(new ImageData(out, W, H), 0, 0);
      return cv;
    };
    const lifted = [...pieceIdx.flat(), ...this.spec.pieces.flatMap((p) => shade(p.box))];
    this.base = fill([...lifted, ...(this.spec.cover ? shade(this.spec.cover.box) : [])]);
    if (this.spec.game === 'pool') this.baseCue = fill(lifted);
  }

  /** A game starts: pool's detail is how many drop on the break ("2", with "s" for a scratch); hockey's is goal, bank or blocked. */
  start(now: number, detail = '') {
    this.build();
    if (!this.base) return;
    this.startedAt = now;
    this.detail = detail;
    this.broken = false;
    this.goalAt = -Infinity;
    this.blockedAt = -Infinity;
    this.shot = undefined;
    const home = this.spec.pieces.map((p) => this.toST(p.at));
    if (this.spec.game === 'pool') {
      const [cs, ct] = home[0];
      const [rs, rt] = this.rackAt();
      const T = POOL_HIT;
      this.bodies = [{ s: cs, t: ct, vs: (rs - cs) / T, vt: (rt - ct) / T, r: 3, piece: 0 }];
      return;
    }
    this.startHockey(home);
  }

  /** Where the cue ball meets the rack: the front ball's edge. */
  private rackAt(): P {
    const [rs, rt] = this.toST(this.spec.cover!.at);
    const [cs, ct] = this.toST(this.spec.pieces[0].at);
    const [ds, dt] = norm([rs - cs, rt - ct]);
    const back = 2.67 * 5.2 * 0.866 + 5.2;
    return [rs - ds * back, rt - dt * back];
  }

  private pockets(): P[] {
    const [L, B] = [this.LA, this.LB];
    return [
      [0, 0],
      [L / 2, 0],
      [L, 0],
      [0, B],
      [L / 2, B],
      [L, B],
    ];
  }

  /** The break: fifteen balls racked where the painted ones were, then away across the felt. */
  private breakRack() {
    this.broken = true;
    const sunk = Math.max(0, Math.min(3, parseInt(this.detail, 10) || 0));
    const scratch = this.detail.includes('s');
    const [rs, rt] = this.toST(this.spec.cover!.at);
    const cue = this.bodies[0];
    const [ds, dt] = norm([rs - cue.s, rt - cue.t]);
    const [ns, nt] = [-dt, ds];
    const gap = 5.2;
    const apex: P = [rs - ds * 2.67 * gap * 0.866, rt - dt * 2.67 * gap * 0.866];
    // the 8 in the middle, the rest shuffled
    const order = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].sort(() => Math.random() - 0.5);
    order.splice(4, 0, 8);
    const balls: Body[] = [];
    let n = 0;
    for (let i = 0; i < 5; i++)
      for (let j = 0; j <= i; j++) {
        const num = order[n++];
        const s = apex[0] + ds * i * gap * 0.866 + ns * (j - i / 2) * gap;
        const t = apex[1] + dt * i * gap * 0.866 + nt * (j - i / 2) * gap;
        balls.push({ s, t, vs: 0, vt: 0, r: 2.5, color: num === 8 ? '#15151c' : BALL_COLORS[(num - 1) % 8], stripe: num > 8 });
      }
    // away from the cue ball, fanned out, some quicker than others
    for (const b of balls) {
      const [ox, oy] = norm([b.s - (apex[0] - ds * gap), b.t - (apex[1] - dt * gap)]);
      const spread = (Math.random() - 0.5) * 1.1;
      const dirS = ox * Math.cos(spread) - oy * Math.sin(spread);
      const dirT = ox * Math.sin(spread) + oy * Math.cos(spread);
      const v = 40 + Math.random() * 70;
      b.vs = dirS * v + ds * 12;
      b.vt = dirT * v + dt * 12;
    }
    // the ones the server says drop head for pockets of their own
    const free = this.pockets().sort(() => Math.random() - 0.5);
    for (const b of [...balls].sort(() => Math.random() - 0.5).slice(0, sunk)) this.aim(b, free.pop()!);
    cue.vs *= 0.12;
    cue.vt *= 0.12;
    cue.vs += (Math.random() - 0.5) * 8;
    cue.vt += (Math.random() - 0.5) * 8;
    if (scratch && free.length) this.aim(cue, free.pop()!);
    this.bodies = [cue, ...balls];
    const [x, y] = this.toXY(cue.s, cue.t);
    this.spark([x, y], '#ffffff', 4);
  }

  /** Send a ball rolling so it just reaches a pocket. */
  private aim(b: Body, pocket: P) {
    const [ds, dt] = [pocket[0] - b.s, pocket[1] - b.t];
    const dist = Math.hypot(ds, dt);
    const v = POOL_FRICTION * dist * 1.25 + 6;
    b.vs = (ds / dist) * v;
    b.vt = (dt / dist) * v;
    b.into = pocket;
  }

  private startHockey(home: P[]) {
    const [puck, near, far] = home;
    // the goal at the far mallet's end
    const farEnd = far[0] < this.LA / 2 ? 0 : this.LA;
    this.goalEnd = [farEnd, this.LB / 2];
    const how = this.detail || 'goal';
    let target: P = [farEnd, this.LB / 2];
    // a bank shot: aimed at the goal's reflection in a side rail
    if (how === 'bank') target = [farEnd, Math.random() < 0.5 ? -this.LB / 2 : this.LB * 1.5];
    const [as, at] = norm([target[0] - puck[0], target[1] - puck[1]]);
    const V = 120;
    const rp = 3.5;
    const rm = 4.5;
    const contact: P = [puck[0] - as * (rp + rm), puck[1] - at * (rp + rm)];
    const nearPath = (age: number): P => {
      const k = age < HOCKEY_STRIKE ? ease(age / HOCKEY_STRIKE) : age < HOCKEY_STRIKE + 0.6 ? 1 - ease((age - HOCKEY_STRIKE) / 0.6) : 0;
      return [near[0] + (contact[0] - near[0]) * k, near[1] + (contact[1] - near[1]) * k];
    };
    // the other mallet lunges to where the puck will cross its line: in time when it's blocked, late otherwise
    const line = far[0] + (farEnd === 0 ? rm + rp : -(rm + rp));
    const cross = at === 0 || as === 0 ? far[1] : puck[1] + ((line - puck[0]) / as) * at;
    const meet = Math.max(rm, Math.min(this.LB - rm, how === 'blocked' ? cross : far[1] + (cross - far[1]) * 0.55));
    const farPath = (age: number): P => {
      const go = HOCKEY_STRIKE + (how === 'blocked' ? 0 : 0.12);
      const k = age < go ? 0 : age < go + 0.25 ? ease((age - go) / 0.25) : age < 1.4 ? 1 : age < 2 ? 1 - ease((age - 1.4) / 0.6) : 0;
      return [far[0], far[1] + (meet - far[1]) * k];
    };
    this.bodies = [
      { s: puck[0], t: puck[1], vs: 0, vt: 0, r: rp, piece: 0 },
      { s: near[0], t: near[1], vs: 0, vt: 0, r: rm, piece: 1, path: nearPath },
      { s: far[0], t: far[1], vs: 0, vt: 0, r: rm, piece: 2, path: farPath },
    ];
    this.shot = { vs: as * V, vt: at * V, how, line, fired: false };
  }

  /** The hockey shot, struck when the mallet meets the puck. */
  private shot?: { vs: number; vt: number; how: string; line: number; fired: boolean };

  update(dt: number, now: number) {
    const age = this.age(now);
    if (age === Infinity) return;
    const pool = this.spec.game === 'pool';
    if (pool && !this.broken && age >= POOL_HIT) this.breakRack();
    const shot = this.shot;
    if (!pool && shot && !shot.fired && age >= HOCKEY_STRIKE) {
      shot.fired = true;
      const puck = this.bodies[0];
      puck.vs = shot.vs;
      puck.vt = shot.vt;
      if (shot.how !== 'blocked') puck.into = this.goalEnd;
      const [x, y] = this.toXY(puck.s, puck.t);
      this.spark([x, y], '#bff6ff', 3);
    }
    const friction = Math.exp(-(pool ? (this.broken ? POOL_FRICTION : 0) : 0.35) * dt);
    for (const b of this.bodies) {
      if (b.sank !== undefined) continue;
      if (b.path) {
        [b.s, b.t] = b.path(age);
        continue;
      }
      b.s += b.vs * dt;
      b.t += b.vt * dt;
      // into a pocket, or into the goal slot
      if (b.into) {
        const near = Math.hypot(b.s - b.into[0], b.t - b.into[1]) < (pool ? 4.5 : this.LB * 0.3);
        const atEnd = pool || b.s <= b.r || b.s >= this.LA - b.r;
        if (near && atEnd) {
          b.sank = age;
          b.s = Math.max(0, Math.min(this.LA, b.s));
          b.t = Math.max(0, Math.min(this.LB, b.t));
          if (!pool) this.goalAt = age;
          continue;
        }
      }
      // the far mallet in the way
      if (!pool && shot?.how === 'blocked' && this.blockedAt === -Infinity && b.piece === 0 && (shot.vs < 0 ? b.s <= shot.line : b.s >= shot.line)) {
        this.blockedAt = age;
        b.vs = -b.vs * 0.55;
        b.vt = b.vt * 0.6 + (Math.random() - 0.5) * 20;
        const [x, y] = this.toXY(b.s, b.t);
        this.spark([x, y], '#ffffff', 6);
      }
      if (b.s < b.r || b.s > this.LA - b.r) {
        b.vs = -b.vs * 0.9;
        b.s = Math.max(b.r, Math.min(this.LA - b.r, b.s));
      }
      if (b.t < b.r || b.t > this.LB - b.r) {
        b.vt = -b.vt * 0.9;
        b.t = Math.max(b.r, Math.min(this.LB - b.r, b.t));
      }
      b.vs *= friction;
      b.vt *= friction;
    }
  }

  private spark(p: P, color: string, n: number) {
    const [x, y] = this.world(p);
    for (let i = 0; i < n; i++)
      this.effects.add({ x: x + (Math.random() - 0.5) * 2, y: y - 1, vx: (Math.random() - 0.5) * 24, vy: -8 - Math.random() * 14, max: 0.35, size: 1, color, gravity: 60, kind: 'square' });
  }

  /** Drawing px → world px (set by the caller each draw; the table never moves). */
  private world: (p: P) => [number, number] = (p) => p;

  /**
   * Draw the table itself while a game is on: with its pieces lifted (and the rack covered once it's broken),
   * fading back to the painting as it's put back. Returns false when no game is on.
   */
  drawBase(c: CanvasRenderingContext2D, x0: number, y0: number, now: number): boolean {
    const age = this.age(now);
    if (age === Infinity || !this.base) return false;
    const sp = this.sprite;
    const k = sp.scale ?? 1;
    const [W, H] = [sp.canvas.width / k, sp.canvas.height / k];
    const pool = this.spec.game === 'pool';
    c.drawImage(pool && !this.broken && this.baseCue ? this.baseCue : this.base, x0, y0, W, H);
    const back = (age - this.length()) / FADE;
    if (back > 0) {
      c.globalAlpha = Math.min(1, back);
      c.drawImage(sp.canvas, x0, y0, W, H);
      c.globalAlpha = 1;
    }
    return true;
  }

  /** The balls, the puck and the mallets, over the table; a goal lights its end up. */
  drawOver(c: CanvasRenderingContext2D, dx: number, dy: number, at: (p: P) => [number, number], now: number) {
    this.world = at;
    const age = this.age(now);
    if (age === Infinity || !this.base) return;
    const sp = this.sprite;
    const k = sp.scale ?? 1;
    const [W, H] = [sp.canvas.width / k, sp.canvas.height / k];
    const snap = (v: number) => Math.round(v * k) / k;
    const fade = 1 - Math.max(0, Math.min(1, (age - this.length()) / FADE));
    c.globalAlpha = fade;
    // the goal light: the end of the table glows and GOAL! rises over it
    if (this.goalAt > -Infinity) {
      const g = age - this.goalAt;
      if (g < 1.6) {
        const [gx, gy] = at(this.toXY(...this.goalEnd));
        c.save();
        c.globalCompositeOperation = 'lighter';
        const pulse = (1 - g / 1.6) * (0.6 + 0.4 * Math.sin(g * 18));
        const grad = c.createRadialGradient(gx, gy, 0, gx, gy, 12);
        grad.addColorStop(0, `rgba(255,120,210,${0.9 * pulse})`);
        grad.addColorStop(1, 'rgba(255,120,210,0)');
        c.fillStyle = grad;
        c.fillRect(gx - 12, gy - 12, 24, 24);
        c.restore();
        label(c, 'GOAL!', gx, gy - 10 - g * 6, Math.min(1, (1.6 - g) * 2) * fade, '#ff7ad9');
      }
    }
    const order = [...this.bodies].sort((a, b) => this.toXY(a.s, a.t)[1] - this.toXY(b.s, b.t)[1]);
    for (const b of order) {
      const p = this.toXY(b.s, b.t);
      let scale = 1;
      if (b.sank !== undefined) {
        scale = 1 - (age - b.sank) / 0.2;
        if (scale <= 0) continue;
      }
      const [wx, wy] = at(p);
      c.save();
      c.globalAlpha = fade * (b.sank !== undefined ? Math.max(0, scale) : 1);
      if (scale !== 1) {
        c.translate(wx, wy);
        c.scale(scale, scale);
        c.translate(-wx, -wy);
      }
      if (b.piece !== undefined) {
        const [hx, hy] = at(this.spec.pieces[b.piece].at);
        // a puck flying leaves a streak behind it
        if (!b.path && Math.hypot(b.vs, b.vt) > 50 && b.sank === undefined)
          for (const [back, a] of [[0.05, 0.3], [0.025, 0.55]]) {
            const [tx, ty] = at(this.toXY(b.s - b.vs * back, b.t - b.vt * back));
            c.globalAlpha = fade * a;
            c.drawImage(this.pieces[b.piece], snap(dx + tx - hx), snap(dy + ty - hy), W, H);
          }
        c.globalAlpha = fade * (b.sank !== undefined ? Math.max(0, scale) : 1);
        c.drawImage(this.pieces[b.piece], snap(dx + wx - hx), snap(dy + wy - hy), W, H);
      } else {
        const img = ballImage(b.color ?? '#fff', !!b.stripe);
        const n = img.width;
        c.drawImage(ballShadow(n), snap(wx - n / 2 / k + 1 / k), snap(wy - n / 2 / k + 1 / k), n / k, n / k);
        c.drawImage(img, snap(wx - n / 2 / k), snap(wy - n / 2 / k), n / k, n / k);
      }
      c.restore();
    }
    c.globalAlpha = 1;
  }
}

const POOL_FRICTION = 1.3;

function norm([x, y]: P): P {
  const d = Math.hypot(x, y) || 1;
  return [x / d, y / d];
}

function ease(k: number) {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
}

/** A word over the table (GOAL!), pixel-font style: bright with a dark edge. */
export function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number, color: string) {
  if (alpha <= 0) return;
  c.save();
  c.globalAlpha = alpha;
  c.font = 'bold 6px "Courier New", monospace';
  c.textAlign = 'center';
  c.lineJoin = 'round';
  c.lineWidth = 2;
  c.strokeStyle = '#2a1f2d';
  c.strokeText(text, x, y);
  c.fillStyle = color;
  c.fillText(text, x, y);
  c.restore();
}

const balls = new Map<string, HTMLCanvasElement>();
/**
 * A pool ball at the drawing's own size (5 px: a dark rim, its colour, a highlight up and to the left; a
 * stripe is white with a band of colour).
 */
function ballImage(color: string, stripe: boolean): HTMLCanvasElement {
  const key = `${color}${stripe ? 's' : ''}`;
  let cv = balls.get(key);
  if (cv) return cv;
  const rows = stripe ? ['.ooo.', 'owhwo', 'occco', 'owwdo', '.ooo.'] : ['.ooo.', 'ohcco', 'occco', 'occdo', '.ooo.'];
  const pal: Record<string, string> = { o: 'rgba(22,14,20,0.92)', c: color, h: shade(color, 0.55), d: shade(color, -0.35), w: '#f4efe2' };
  if (stripe) pal.h = '#ffffff';
  cv = makeCanvas(5, 5);
  const g = cv.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      g.fillStyle = pal[ch];
      g.fillRect(x, y, 1, 1);
    }),
  );
  balls.set(key, cv);
  return cv;
}

const shadows = new Map<number, HTMLCanvasElement>();
function ballShadow(n: number): HTMLCanvasElement {
  let cv = shadows.get(n);
  if (cv) return cv;
  cv = makeCanvas(n, n);
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(0,30,14,0.45)';
  g.fillRect(1, 0, n - 2, n);
  g.fillRect(0, 1, n, n - 2);
  shadows.set(n, cv);
  return cv;
}

/** Lighter (k > 0, toward white) or darker (k < 0, toward black). */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)));
  return `rgb(${ch.join(',')})`;
}
