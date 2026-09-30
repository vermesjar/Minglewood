/**
 * Moving water on a drawing: the Founders' Fountain's sheets and spouts pour, its jets shoot up and spill,
 * its pools ripple, its lily pads bob, and by day the sun glints off it.
 *
 * The painted water is lifted off the drawing, the way the pool balls are in tabletop.ts: every water pixel is
 * read once and placed on the drawing's own water ramp (its darkest blue up to its foam white), and each frame
 * the water is repainted from that ramp, stepped lighter or darker by what the water is doing there — bright
 * and dark dashes running down the falling sheets and up the jets, foam churning where water lands, rings
 * spreading from it, crests travelling out across the pools. Only the drawing's own colours are used and every
 * change is a whole drawing pixel, so it stays crisp pixel art at every zoom. Lily pads are lifted off whole
 * and float a pixel up and down, the water under them filled in from round about.
 *
 * After dark the water catches the lamplight (WorldView's lamp model): a lamp beyond the water lays a glitter
 * path of warm crests towards the viewer, and gold glints wink where the lamps reach, all on the town's glow
 * layer (the one lit windows are on), so whatever stands in front hides it.
 */
import { makeCanvas, type Sprite } from './sprites/painter';

type P = [number, number];
/** A box in drawing px (unmirrored), inclusive: x0, y0, x1, y1. */
type Box = [number, number, number, number];

export interface WaterSpec {
  /** Pools of still-ish water: their extent, where their ripples spread out from, and the ripples' spacing (px). */
  pools: Array<{ box: Box; centre: P; wave: number }>;
  /**
   * Moving water: falling sheets and spouts (dir 1) and jets shooting up (dir -1), found as the bright water in
   * `box`. `land` is where it meets a pool (foam churns in an ellipse `foam` [rx, ry] round it, rings spread
   * from it, drops splash up out of it); a jet's `tip` spills drops back down beside it.
   */
  streams: Array<{ box: Box; dir: 1 | -1; speed: number; land: P; foam: P; tip?: P }>;
  /** Where water wells up and bubbles (round the fountain's finial). */
  wells?: Array<{ at: P; r: number }>;
  /** Where a tossed coin lands: open water, in view (else the open water nearest where it's thrown). */
  coin?: P;
  /** Still water with nothing pouring into it: a small ring this many times a second somewhere on it (a drip, a breath of wind). */
  drips?: number;
}

/** Studied off the drawings at 4× (see docs/ambient-life.md). */
export const WATERWORKS: Record<string, WaterSpec> = {
  'fountain.png': {
    pools: [
      // the top bowl round the finial, the middle basin, the lower basin with its lily pads
      { box: [84, 33, 124, 47], centre: [101, 40], wave: 4 },
      { box: [70, 58, 136, 80], centre: [102, 70], wave: 5 },
      { box: [36, 96, 170, 154], centre: [103, 128], wave: 7 },
    ],
    streams: [
      // the two sheets spilling over the top bowl's lip into the middle basin
      { box: [85, 43, 94, 68], dir: 1, speed: 20, land: [87, 73], foam: [6, 3] },
      { box: [111, 43, 120, 68], dir: 1, speed: 20, land: [118, 73], foam: [6, 3] },
      // the lions' spouts into the lower basin
      { box: [74, 93, 81, 128], dir: 1, speed: 28, land: [77, 133], foam: [8, 3] },
      { box: [125, 92, 131, 128], dir: 1, speed: 28, land: [128, 133], foam: [8, 3] },
      // the two jets rising out of the lower basin either side
      { box: [61, 82, 68, 112], dir: -1, speed: 30, land: [65, 117], foam: [7, 3], tip: [64, 82] },
      { box: [138, 82, 144, 111], dir: -1, speed: 30, land: [141, 116], foam: [7, 3], tip: [142, 82] },
    ],
    wells: [{ at: [97, 41], r: 2 }],
    // in front of the pedestal, beside the coins already painted on the bottom
    coin: [110, 138],
  },
  // the bird bath: still water, ripples crossing it and now and then a ring (a drip, the bird drinking)
  'birdbath.png': {
    pools: [{ box: [5, 9, 37, 18], centre: [21, 14], wave: 3 }],
    streams: [],
    drips: 0.7,
  },
};

export function hasWaterworks(file: string | undefined): boolean {
  return !!file && !!WATERWORKS[file];
}

/** A light the water can catch: where its pool of light falls (world px), its reach and how bright it is now. */
export interface WaterLight {
  x: number;
  y: number;
  r: number;
  k: number;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** It lands (and is gone) when it falls back past this line. */
  floor: number;
  /** A small ring where it lands, if that's on a pool. */
  ring: boolean;
}

interface Ring {
  x: number;
  y: number;
  age: number;
  life: number;
  r0: number;
  r1: number;
}

interface Pad {
  /** Its pixels as drawn: drawing x, y and the canvas colour (packed). */
  px: Array<[number, number, number]>;
  period: number;
  phase: number;
  drift: number;
  dx: number;
  dy: number;
}

/** Stream textures: dashes of lighter and darker water per column, this long before they repeat. */
const TEX = 18;
/** Frames of water per second (the repaint rate; drops and rings move every frame they're drawn). */
const FPS = 30;
const WARM = [255, 190, 104];
const GOLD = [255, 228, 150];

export class Waterworks {
  private readonly W: number;
  private readonly H: number;
  /** The drawing's water ramp, darkest first, as packed canvas colours (and brightened for a hover). */
  private ramp: number[] = [];
  private rampHover: number[] = [];
  /** Per canvas pixel: -1 not animated water; else its place on the ramp. */
  private level: Int8Array;
  // pools
  private poolCi: number[] = [];
  private poolRamp: number[] = [];
  /** The pixel's own colour as drawn (0 under a pad), kept wherever the water is as painted this frame. */
  private poolOrig: number[] = [];
  private poolR: number[] = [];
  private poolNoise: number[] = [];
  private poolSpeed: number[] = [];
  /** A pixel under a lily pad: which pad (-1 for open water). */
  private poolPad: number[] = [];
  private isPool: Uint8Array;
  // streams
  private streamCi: number[] = [];
  private streamRamp: number[] = [];
  private streamOrig: number[] = [];
  private streamY: number[] = [];
  private streamTex: number[] = [];
  private streamSpeed: number[] = [];
  private tex: Int8Array;
  // foam where water lands and wells up
  private foamCi: number[] = [];
  private foamRamp: number[] = [];
  private foamOrig: number[] = [];
  private foamE: number[] = [];
  private pads: Pad[] = [];
  private drops: Drop[] = [];
  private rings: Ring[] = [];
  /** Glints on the water: the sun's (white, painted) or a lamp's (gold, on the glow layer). */
  private sparks: Array<{ x: number; y: number; age: number; warm: boolean }> = [];
  private readonly out: ImageData;
  private readonly out32: Uint32Array;
  private readonly glow: ImageData;
  private readonly glow32: Uint32Array;
  /** How brightly each pixel was lit up this frame (0 none … 3), for the night glints. */
  private lift: Uint8Array;
  private readonly layer: HTMLCanvasElement;
  private readonly glowLayer: HTMLCanvasElement;
  private t = 0;
  private painted = -1;
  private paintedHover = false;
  private glowPainted = -1;
  private acc: number[];
  /** Lamp reach per pixel (0…), for the lamps it was worked out for. */
  private lamps: { key: string; w: Float32Array } | null = null;
  private readonly ok: boolean;
  /** The ramp's top step (its foam white). */
  private top = 0;

  constructor(
    private readonly sprite: Sprite,
    private readonly spec: WaterSpec,
  ) {
    const W = (this.W = sprite.canvas.width);
    const H = (this.H = sprite.canvas.height);
    this.level = new Int8Array(W * H).fill(-1);
    this.isPool = new Uint8Array(W * H);
    this.lift = new Uint8Array(W * H);
    this.tex = new Int8Array(0);
    this.layer = makeCanvas(W, H);
    this.glowLayer = makeCanvas(W, H);
    this.out = new ImageData(W, H);
    this.out32 = new Uint32Array(this.out.data.buffer);
    this.glow = new ImageData(W, H);
    this.glow32 = new Uint32Array(this.glow.data.buffer);
    this.acc = spec.streams.map((_, i) => i * 0.37);
    this.ok = this.build();
  }

  /** Canvas index of a drawing pixel (the canvas is the drawing mirrored when the piece is turned). */
  private ci(x: number, y: number): number {
    return y * this.W + (this.sprite.mirrored ? this.W - 1 - x : x);
  }

  /** Read the drawing's water: its ramp, the pools, streams, foam and lily pads. */
  private build(): boolean {
    const { W, H, spec } = this;
    const src = this.sprite.canvas.getContext('2d')?.getImageData(0, 0, W, H);
    if (!src) return false;
    const d = src.data;
    const d32 = new Uint32Array(d.buffer);
    const inBox = (b: Box, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
    const inAny = (x: number, y: number) => spec.pools.some((p) => inBox(p.box, x, y)) || spec.streams.some((s) => inBox(s.box, x, y));
    // the water: blue-cyan and saturated, or the pale foam
    const water = new Uint8Array(W * H);
    const colors = new Map<number, number>();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ci = this.ci(x, y);
        const i = ci * 4;
        if (d[i + 3] < 128 || !isWater(d[i], d[i + 1], d[i + 2]) || !inAny(x, y)) continue;
        water[ci] = 1;
        colors.set(d32[ci], (colors.get(d32[ci]) ?? 0) + 1);
      }
    if (colors.size < 3) return false;
    // the ramp: its own colours by brightness, each a step (a drawing with more than seven blues has them
    // grouped by rank into seven, each step the commonest colour of its group)
    const lum = (c: number) => (c & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + ((c >> 16) & 255) * 0.11;
    const sorted = [...colors.keys()].sort((a, b) => lum(a) - lum(b));
    const steps = Math.min(7, sorted.length);
    const stepOf = new Map<number, number>();
    const best: Array<[number, number]> = Array.from({ length: steps }, () => [0, -1]);
    sorted.forEach((c, i) => {
      const s = Math.floor((i * steps) / sorted.length);
      stepOf.set(c, s);
      const n = colors.get(c)!;
      if (n > best[s][1]) best[s] = [c, n];
    });
    this.ramp = best.map((b) => (b[0] | 0xff000000) >>> 0);
    this.rampHover = this.ramp.map((c) => brighten(c));
    const top = steps - 1;
    const bright = Math.ceil(steps / 2);
    const rampAt = (ci: number) => stepOf.get(d32[ci]) ?? 0;

    // streams: the bright water in each stream's box. Each column gets its own dashes, over pulses the whole
    // stream shares (bands of light and shade across it), all running along it at the stream's speed
    const texes: number[] = [];
    const claimed = new Uint8Array(W * H);
    spec.streams.forEach((s, si) => {
      const rnd = mulberry(si * 977 + 13);
      const pulse = pulses(rnd);
      const col = new Map<number, number>();
      for (let y = s.box[1]; y <= s.box[3]; y++)
        for (let x = s.box[0]; x <= s.box[2]; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const ci = this.ci(x, y);
          if (!water[ci] || claimed[ci] || rampAt(ci) < bright) continue;
          claimed[ci] = 1;
          let off = col.get(x);
          if (off === undefined) {
            off = texes.length;
            col.set(x, off);
            texes.push(...dashes(rnd).map((v, j) => Math.max(-1, Math.min(2, v + pulse[j]))));
          }
          this.streamCi.push(ci);
          this.streamRamp.push(rampAt(ci));
          this.streamOrig.push(d32[ci] >>> 0);
          this.streamY.push(y * s.dir);
          this.streamTex.push(off);
          this.streamSpeed.push(s.speed);
          this.level[ci] = rampAt(ci);
        }
    });
    this.tex = Int8Array.from(texes);

    // pools: the rest of the water, each pixel's distance out from the pool's centre in ripple spacings
    const poolOf = new Int16Array(W * H).fill(-1);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ci = this.ci(x, y);
        if (!water[ci] || claimed[ci]) continue;
        const pi = spec.pools.findIndex((p) => inBox(p.box, x, y));
        if (pi < 0) continue;
        poolOf[ci] = pi;
      }
    // lily pads: islands in a pool that are mostly leaf, lifted off whole; the water under them filled in
    const padOf = new Int16Array(W * H).fill(-1);
    const seen = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ci = this.ci(x, y);
        if (seen[ci] || water[ci] || d[ci * 4 + 3] < 128) continue;
        const pi = spec.pools.findIndex((p) => inBox(p.box, x, y));
        if (pi < 0) continue;
        const island = this.island(x, y, d, water, seen);
        if (!island) continue;
        const pad: Pad = { px: [], period: 3.2 + ((this.pads.length * 0.73) % 1.6), phase: this.pads.length * 1.9, drift: 9 + ((this.pads.length * 2.3) % 5), dx: 0, dy: 0 };
        for (const [ix, iy] of island) {
          const k = this.ci(ix, iy);
          pad.px.push([ix, iy, d32[k] >>> 0]);
          padOf[k] = this.pads.length;
          poolOf[k] = pi;
        }
        this.pads.push(pad);
      }
    // the water under the pads, from the water round about: the middle step of what's already known next to it
    const known = new Int8Array(W * H).fill(-1);
    for (let ci = 0; ci < W * H; ci++) if (poolOf[ci] >= 0 && padOf[ci] < 0) known[ci] = rampAt(ci);
    for (let pass = 0; pass < 40; pass++) {
      const fill: Array<[number, number]> = [];
      for (let ci = 0; ci < W * H; ci++) {
        if (padOf[ci] < 0 || known[ci] >= 0) continue;
        const around = [ci - 1, ci + 1, ci - W, ci + W].filter((n) => n >= 0 && n < W * H && known[n] >= 0).map((n) => known[n]);
        if (around.length) fill.push([ci, around.sort((a, b) => a - b)[around.length >> 1]]);
      }
      if (!fill.length) break;
      for (const [ci, v] of fill) known[ci] = v;
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ci = this.ci(x, y);
        const pi = poolOf[ci];
        if (pi < 0) continue;
        const p = spec.pools[pi];
        const r = Math.hypot((x - p.centre[0]) / 2, y - p.centre[1]);
        this.poolCi.push(ci);
        this.poolRamp.push(padOf[ci] >= 0 ? Math.max(0, known[ci]) : rampAt(ci));
        this.poolOrig.push(padOf[ci] >= 0 ? 0 : d32[ci] >>> 0);
        this.poolR.push(r / p.wave);
        this.poolNoise.push(hash(x >> 1, y));
        this.poolSpeed.push(3 / p.wave);
        this.poolPad.push(padOf[ci]);
        this.isPool[ci] = 1;
        if (padOf[ci] < 0) this.level[ci] = rampAt(ci);
      }

    // foam: the water round each place a stream lands, and round a well
    const foamAt = (cx: number, cy: number, rx: number, ry: number) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const ci = this.ci(x, y);
          const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
          if (!water[ci] || e > 1 || padOf[ci] >= 0) continue;
          this.foamCi.push(ci);
          this.foamRamp.push(rampAt(ci));
          this.foamOrig.push(d32[ci] >>> 0);
          this.foamE.push(e);
        }
    };
    for (const s of spec.streams) foamAt(s.land[0], s.land[1], s.foam[0], s.foam[1]);
    for (const w of spec.wells ?? []) foamAt(w.at[0], w.at[1], w.r + 1, w.r);
    this.top = top;
    return this.streamCi.length > 0 || this.poolCi.length > 0;
  }


  /**
   * A lily pad: the island of non-water pixels at (x, y) inside a pool, if it's small, afloat (water all round,
   * nothing see-through beside it) and mostly leaf. Marks what it visits either way.
   */
  private island(x: number, y: number, d: Uint8ClampedArray, water: Uint8Array, seen: Uint8Array): Array<[number, number]> | null {
    const { W, H } = this;
    const out: Array<[number, number]> = [];
    const stack: Array<[number, number]> = [[x, y]];
    seen[this.ci(x, y)] = 1;
    let afloat = true;
    let leaf = 0;
    while (stack.length) {
      const [px, py] = stack.pop()!;
      out.push([px, py]);
      const i = this.ci(px, py) * 4;
      if (isLeaf(d[i], d[i + 1], d[i + 2])) leaf++;
      for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
          afloat = false;
          continue;
        }
        const n = this.ci(nx, ny);
        if (d[n * 4 + 3] < 128) afloat = false;
        if (seen[n] || water[n] || d[n * 4 + 3] < 128) continue;
        seen[n] = 1;
        stack.push([nx, ny]);
      }
    }
    return afloat && out.length >= 20 && out.length <= 400 && leaf >= out.length * 0.25 ? out : null;
  }

  /**
   * Stir the water: drops fly, rings spread, glints twinkle. `sun` 0…1 (white glints by day), `night` 0…1
   * (gold ones from the lamps).
   */
  update(dt: number, sun: number, night = 0) {
    if (!this.ok) return;
    this.t += dt;
    const rnd = Math.random;
    this.spec.streams.forEach((s, i) => {
      // splashes up out of the foam where it lands, and now and then a ring spreading from it
      this.acc[i] += dt;
      const splashes = s.dir > 0 ? 7 : 5;
      if (rnd() < dt * splashes) {
        const x = s.land[0] + (rnd() - 0.5) * s.foam[0];
        this.drops.push({ x, y: s.land[1] - 1, vx: (x - s.land[0]) * 3 + (rnd() - 0.5) * 6, vy: -18 - rnd() * 16, floor: s.land[1], ring: false });
      }
      if (this.acc[i] > 0.7) {
        this.acc[i] = rnd() * 0.3;
        this.rings.push({ x: s.land[0], y: s.land[1], age: 0, life: 1.2, r0: s.foam[0] * 0.6, r1: s.foam[0] * 2.1 });
      }
      // a jet spills drops off its tip, falling back beside it into the pool
      if (s.tip && rnd() < dt * 9) {
        const side = rnd() < 0.5 ? -1 : 1;
        this.drops.push({ x: s.tip[0] + side, y: s.tip[1] - 1, vx: side * (5 + rnd() * 9), vy: -6 - rnd() * 10, floor: s.land[1] - 2 + rnd() * 5, ring: true });
      }
    });
    if (this.spec.drips && this.poolCi.length && rnd() < dt * this.spec.drips) {
      const i = Math.floor(rnd() * this.poolCi.length);
      if (this.poolPad[i] < 0) {
        const ci = this.poolCi[i];
        const cx = ci % this.W;
        this.rings.push({ x: this.sprite.mirrored ? this.W - 1 - cx : cx, y: Math.floor(ci / this.W), age: 0, life: 0.9, r0: 0.5, r1: 3.5 });
      }
    }
    for (const w of this.spec.wells ?? [])
      if (rnd() < dt * 6) this.drops.push({ x: w.at[0] + (rnd() - 0.5) * w.r * 2, y: w.at[1] - 1, vx: (rnd() - 0.5) * 8, vy: -10 - rnd() * 8, floor: w.at[1] + 1, ring: false });
    for (const p of this.drops) {
      p.vy += 150 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.drops = this.drops.filter((p) => {
      if (p.vy < 0 || p.y < p.floor) return true;
      if (p.ring && this.isPool[this.ci(clampInt(p.x, this.W), clampInt(p.y, this.H))])
        this.rings.push({ x: p.x, y: p.y, age: 0, life: 0.5, r0: 1, r1: 3 });
      return false;
    });
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);
    // a glint winks on the water here and there: the sun's by day, the lamps' (gold) after dark, most where
    // the lamps reach
    for (const s of this.sparks) s.age += dt;
    this.sparks = this.sparks.filter((s) => s.age < 0.45);
    const lamplit = night > 0.05 && !!this.lamps;
    const rate = 4.5 * sun + (lamplit ? 7 * night : 0);
    if (this.poolCi.length && rnd() < dt * rate) {
      const warm = lamplit && rnd() * rate > 4.5 * sun;
      // a few tries for a lit-up spot: the brighter water by day, where a lamp's light lies after dark
      for (let tries = 0; tries < 12; tries++) {
        const all = this.poolCi.length + this.streamCi.length;
        const k = Math.floor(rnd() * all);
        const ci = k < this.poolCi.length ? this.poolCi[k] : this.streamCi[k - this.poolCi.length];
        if (this.level[ci] < 2 || (warm && rnd() > (this.lamps?.w[ci] ?? 0))) continue;
        const x = ci % this.W;
        this.sparks.push({ x: this.sprite.mirrored ? this.W - 1 - x : x, y: Math.floor(ci / this.W), age: 0, warm });
        break;
      }
    }
    // the pads: a pixel up on a slow swell, and drifting a pixel to and fro
    for (const p of this.pads) {
      p.dy = Math.sin((this.t / p.period) * Math.PI * 2 + p.phase) > 0.35 ? -1 : 0;
      const dr = Math.sin((this.t / p.drift) * Math.PI * 2 + p.phase * 0.7);
      p.dx = dr > 0.9 ? 1 : dr < -0.9 ? -1 : 0;
    }
  }

  /** Where a coin tossed towards a drawing point lands (drawing px). */
  coinSpot(x: number, y: number): P {
    return this.spec.coin ?? this.openWater(x, y);
  }

  /** The open water nearest a drawing point (clear of pads and streams for a few pixels round), in drawing px. */
  openWater(x: number, y: number): P {
    const key = `${Math.round(x)},${Math.round(y)}`;
    let hit = this.open.get(key);
    if (!hit) this.open.set(key, (hit = this.findOpen(x, y)));
    return hit;
  }

  private open = new Map<string, P>();

  private findOpen(x: number, y: number): P {
    const { W, H } = this;
    let best: P = [x, y];
    let bd = Infinity;
    const open = (px: number, py: number) => {
      if (px < 0 || py < 0 || px >= W || py >= H) return false;
      const ci = this.ci(px, py);
      return !!this.isPool[ci] && this.level[ci] >= 0;
    };
    for (let i = 0; i < this.poolCi.length; i++) {
      if (this.poolPad[i] >= 0) continue;
      const ci = this.poolCi[i];
      const cx = ci % W;
      const px = this.sprite.mirrored ? W - 1 - cx : cx;
      const py = Math.floor(ci / W);
      const dd = Math.hypot(px - x, (py - y) * 2);
      if (dd >= bd) continue;
      if (![[-3, 0], [3, 0], [0, -2], [0, 2], [-2, -1], [2, 1], [-2, 1], [2, -1]].every(([dx, dy]) => open(px + dx, py + dy))) continue;
      bd = dd;
      best = [px, py];
    }
    return best;
  }

  /** A coin (or anything) dropped in at a drawing point: foam, rings and a splash of drops. */
  splash(x: number, y: number) {
    if (!this.ok) return;
    for (let i = 0; i < 3; i++) this.rings.push({ x, y, age: -i * 0.22, life: 1.3, r0: 1.5, r1: 11 });
    for (let i = 0; i < 9; i++) this.drops.push({ x: x + (Math.random() - 0.5) * 3, y: y - 1, vx: (Math.random() - 0.5) * 22, vy: -22 - Math.random() * 18, floor: y + 1, ring: false });
  }

  /** Repaint the water for now (at most FPS times a second). */
  private paint(hover: boolean) {
    const frame = Math.floor(this.t * FPS);
    if (frame === this.painted && hover === this.paintedHover) return;
    this.painted = frame;
    this.paintedHover = hover;
    const { W, H, out32, level, lift, top, t } = this;
    const col = hover ? this.rampHover : this.ramp;
    out32.fill(0);
    lift.fill(0);
    // a pixel onto the ramp; where it comes out on its own step it keeps its colour as drawn
    const set = (ci: number, v: number, up: number, base = -1, orig = 0) => {
      const s = v < 0 ? 0 : v > top ? top : v;
      out32[ci] = s === base && orig ? (hover ? brighten(orig) : orig) : col[s];
      level[ci] = s;
      if (up > lift[ci]) lift[ci] = up;
    };
    // pools: crests travelling outward, a darker trough behind each, broken up so they read as ripples
    const moved = this.pads.map((p) => p.dx !== 0 || p.dy !== 0);
    for (let i = 0; i < this.poolCi.length; i++) {
      const pad = this.poolPad[i];
      if (pad >= 0 && !moved[pad]) continue;
      const n = this.poolNoise[i];
      const f = frac(this.poolR[i] - t * this.poolSpeed[i] + n * 0.35);
      let v = 0;
      if (f < 0.13 && n > 0.22) v = 1;
      else if (f > 0.5 && f < 0.6 && n > 0.45) v = -1;
      set(this.poolCi[i], this.poolRamp[i] + v, v > 0 ? 1 : 0, this.poolRamp[i], this.poolOrig[i]);
    }
    // rings spreading on the pools (under the pads)
    for (const r of this.rings) {
      if (r.age < 0) continue;
      const k = r.age / r.life;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      const inc = k < 0.45 ? 2 : 1;
      const n = Math.max(12, Math.ceil(rad * 7));
      for (let a = 0; a < n; a++) {
        if (k > 0.7 && a % 2) continue;
        const th = (a / n) * Math.PI * 2;
        const x = Math.round(r.x + Math.cos(th) * rad);
        const y = Math.round(r.y + Math.sin(th) * rad * 0.5);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const ci = this.ci(x, y);
        if (!this.isPool[ci] || level[ci] < 0 || out32[ci] === 0) continue;
        set(ci, level[ci] + inc, 1);
      }
    }
    // the pads, where the swell has them
    this.pads.forEach((p, pi) => {
      if (!moved[pi]) return;
      for (const [x, y, c] of p.px) {
        const nx = x + p.dx;
        const ny = y + p.dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ci = this.ci(nx, ny);
        out32[ci] = hover ? brighten(c) : c;
        level[ci] = -1;
        lift[ci] = 0;
      }
    });
    // streams: dashes of light and shade running down the sheets and spouts, up the jets
    for (let i = 0; i < this.streamCi.length; i++) {
      const s = Math.floor(this.streamY[i] - t * this.streamSpeed[i]);
      const v = this.tex[this.streamTex[i] + (((s % TEX) + TEX) % TEX)];
      set(this.streamCi[i], this.streamRamp[i] + v, v > 0 ? v : 0, this.streamRamp[i], this.streamOrig[i]);
    }
    // foam: churning where water lands, whiter towards the middle
    const tick = Math.floor(t * 12);
    for (let i = 0; i < this.foamCi.length; i++) {
      const h = hash(this.foamCi[i], tick);
      const e = this.foamE[i];
      let v = 0;
      if (h < 0.3 - e * 0.15) v = 1 + (e < 0.35 && h < 0.12 ? 1 : 0);
      else if (h > 0.78 + e * 0.1) v = -1;
      set(this.foamCi[i], this.foamRamp[i] + v, v, this.foamRamp[i], this.foamOrig[i]);
    }
    // a jet's height breathes: a pixel or two of spray above its tip
    for (const s of this.spec.streams) {
      if (!s.tip) continue;
      const up = Math.floor(2.4 * (0.5 + 0.5 * Math.sin(t * 5.3 + s.tip[0])));
      for (let k = 1; k <= up; k++) {
        const y = s.tip[1] - k;
        if (y < 0) break;
        const ci = this.ci(s.tip[0], y);
        out32[ci] = col[top - (k > 1 ? 1 : 0)];
        lift[ci] = 2;
      }
    }
    // drops in the air
    for (const p of this.drops) {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const ci = this.ci(x, y);
      out32[ci] = col[top];
      lift[ci] = 3;
      // falling fast: a short streak behind it
      if (p.vy > 30 && y > 0) {
        const c2 = this.ci(x, y - 1);
        if (!out32[c2] || level[c2] >= 0) {
          out32[c2] = col[top - 1];
          lift[c2] = Math.max(lift[c2], 2);
        }
      }
    }
    // glints: a pixel, a four-point star, a pixel. The sun's are painted white; a lamp's lifts the water a
    // step here and shines gold on the glow layer (drawGlow)
    for (const s of this.sparks)
      sparkPixels(s).forEach(([x, y], j) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const ci = this.ci(x, y);
        if (!s.warm) out32[ci] = j === 0 ? 0xffffffff : col[top];
        else if (out32[ci] && level[ci] >= 0) set(ci, level[ci] + 1, 1);
      });
    this.layer.getContext('2d')!.putImageData(this.out, 0, 0);
  }

  /** Draw the water over its drawing, the drawing's top-left at world (x0, y0). */
  draw(c: CanvasRenderingContext2D, x0: number, y0: number, hover = false) {
    if (!this.ok) return;
    this.paint(hover);
    const k = this.sprite.scale ?? 1;
    c.drawImage(this.layer, x0, y0, this.W / k, this.H / k);
  }

  /**
   * The water catching the lamplight, on the town's glow layer: the lit-up pixels (crests, dashes, foam, drops)
   * glint warm, as much as the lamps reach them. `lamps` in world px.
   */
  drawGlow(g: CanvasRenderingContext2D, x0: number, y0: number, lamps: WaterLight[]) {
    if (!this.ok) return;
    const k = this.sprite.scale ?? 1;
    // only the lamps whose light reaches this far
    const cx = x0 + this.W / k / 2;
    const cy = y0 + this.H / k / 2;
    const near = lamps.filter((l) => Math.hypot(l.x - cx, l.y - cy) < l.r * 2 + this.W / k);
    if (!near.length) return;
    this.paint(this.paintedHover);
    const w = this.lampReach(x0, y0, near, k);
    // the lamps' own breathing (their flicker, how far the evening has come)
    const now = near.reduce((a, l) => a + l.k, 0) / near.length;
    const frame = this.painted * 16 + Math.round(now * 15);
    if (frame !== this.glowPainted) {
      this.glowPainted = frame;
      const { glow32, lift, level, out32 } = this;
      const bright = this.top - 1;
      glow32.fill(0);
      for (let ci = 0; ci < lift.length; ci++) {
        if (!out32[ci]) continue;
        // lit-up water glints; the palest of the falling water holds a little of the light even between dashes
        const up = lift[ci];
        const base = up ? 0.3 + up * 0.2 : level[ci] >= bright ? 0.14 : 0;
        const a = Math.min(1, base * w[ci] * now);
        if (a < 0.04) continue;
        glow32[ci] = packed(WARM, a);
      }
      // the lamps' glints, gold
      for (const s of this.sparks) {
        if (!s.warm) continue;
        sparkPixels(s).forEach(([x, y], j) => {
          if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
          glow32[this.ci(x, y)] = packed(j ? WARM : GOLD, (j ? 0.7 : 1) * now);
        });
      }
      this.glowLayer.getContext('2d')!.putImageData(this.glow, 0, 0);
    }
    g.drawImage(this.glowLayer, x0, y0, this.W / k, this.H / k);
  }

  /**
   * How much lamplight each pixel of water catches. A lamp beyond the water, seen across it, lays a glitter path
   * of its reflection on the ripples, running from it towards the viewer (down the screen) and widening as it
   * comes; a lamp on the near side reflects away from the viewer and adds only its share of the general glow.
   * Worked out once for where the lamps stand (their reach `r` from the lamp model).
   */
  private lampReach(x0: number, y0: number, lamps: WaterLight[], k: number): Float32Array {
    const key = `${x0},${y0}|${lamps.map((l) => `${Math.round(l.x)},${Math.round(l.y)},${Math.round(l.r)}`).join(';')}`;
    if (this.lamps?.key === key) return this.lamps.w;
    const { W, H } = this;
    const w = new Float32Array(W * H);
    for (let ci = 0; ci < W * H; ci++) {
      const px = x0 + (ci % W) / k;
      const py = y0 + Math.floor(ci / W) / k;
      let s = 0.18;
      for (const l of lamps) {
        const along = py - l.y;
        if (along <= 0 || along > l.r * 3) continue;
        const spread = 6 + along * 0.18;
        const across = (px - l.x) / spread;
        s += Math.exp(-across * across) * (1 - along / (l.r * 3)) * 1.2;
      }
      w[ci] = Math.min(1, s);
    }
    this.lamps = { key, w };
    return w;
  }
}

function isWater(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === 0 || b < r || g < r) return false;
  const s = (mx - mn) / mx;
  const v = mx / 255;
  // hue between cyan and blue
  const h = mx === b ? 240 - (60 * (g - r)) / Math.max(1, mx - mn) : 120 + (60 * (b - r)) / Math.max(1, mx - mn);
  return h >= 183 && h <= 210 && (s >= 0.3 || (v >= 0.88 && s >= 0.08));
}

function isLeaf(r: number, g: number, b: number): boolean {
  return g > r + 10 && g > b + 20;
}

/** A glint's pixels: one, then a four-point star at its brightest, then one again. */
function sparkPixels(s: { x: number; y: number; age: number }): P[] {
  return s.age > 0.1 && s.age < 0.3 ? [[s.x, s.y], [s.x - 1, s.y], [s.x + 1, s.y], [s.x, s.y - 1], [s.x, s.y + 1]] : [[s.x, s.y]];
}

/** An RGB colour at an alpha, packed for an ImageData's Uint32 view (little-endian ABGR). */
function packed(c: number[], a: number): number {
  return ((Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
}

/** A column of dashes: a lighter run, a darker run and a stray light pixel, the rest the water as painted. */
function dashes(rnd: () => number): number[] {
  const t = new Array<number>(TEX).fill(0);
  const a = Math.floor(rnd() * TEX);
  const len = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < len; i++) t[(a + i) % TEX] = i === 1 && rnd() < 0.5 ? 2 : 1;
  const b = (a + len + 3 + Math.floor(rnd() * 4)) % TEX;
  const dark = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < dark; i++) t[(b + i) % TEX] = -1;
  t[(b + dark + 2 + Math.floor(rnd() * 3)) % TEX] = 1;
  return t;
}

/** Pulses down a whole stream: two bands of lighter water across it, each with a darker line trailing it. */
function pulses(rnd: () => number): number[] {
  const t = new Array<number>(TEX).fill(0);
  const a = Math.floor(rnd() * TEX);
  for (const at of [a, a + 8 + Math.floor(rnd() * 3)]) {
    t[at % TEX] = 1;
    t[(at + 1) % TEX] = 1;
    t[(at + 3) % TEX] = -1;
  }
  return t;
}

function frac(v: number) {
  return v - Math.floor(v);
}

function clampInt(v: number, n: number) {
  return Math.max(0, Math.min(n - 1, Math.round(v)));
}

function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** A packed canvas colour lifted the way a hovered piece is (painter.highlightOf). */
function brighten(c: number): number {
  const r = Math.min(255, (c & 255) + 28);
  const g = Math.min(255, ((c >> 8) & 255) + 24);
  const b = Math.min(255, ((c >> 16) & 255) + 12);
  return ((c & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
}
