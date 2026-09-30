/**
 * THE SEAT RENDERER: draws a seat from its model (src/shared/world/seatSpec.ts) in any facing, and gives back not just
 * the pixels but, for every pixel, the height at which its view ray meets the seat and which part it shows. The
 * drawing IS the model: there is nothing to fit, and a sitter can be composed against it exactly (seatCompose.ts).
 *
 * Every pixel's view ray (seatModels.ts rayThrough) is cast into the model's parts — boxes, cylinders, rings — and
 * the nearest surface wins (the camera is toward +u/+v and up, so of two hits the higher is the nearer). The surface
 * then decides the tone the way the house style does (art/ART_DIRECTION.md): light from the upper left, so tops are
 * lightest, faces toward screen-left mid, faces toward screen-right darkest; 3–5 tones per material, shadows shifted
 * toward plum, highlights toward cream; a selective outline in the material's own deepest tone; a contact shadow
 * where a nearer part meets a farther one; a rim of light along the upper-left edges of tops. Details (tufting,
 * wood grain, cane weave, seams) are stamped on in the surface's own coordinates, so they turn with the seat.
 *
 * Pure: no canvas, no DOM. The client paints the result into a sprite (sprites/art.ts), scripts write it as a PNG,
 * the server reads that PNG (src/server/art.ts): all three see the same pixels.
 */
import type { Facing } from '../world/scene';
import { projectLocal, rayBox, rayThrough, viewDir, type Ray, type SeatModel } from '../world/seatModels';
import type { BuiltPart, Material, MaterialKind, Materials, MatName } from '../world/seatSpec';
import type { Pixels } from './footing';

export interface SeatArt {
  facing: Facing;
  px: Pixels;
  /** The drawing's anchor: the footprint's back vertex on the floor (whole px). */
  ax: number;
  ay: number;
  /** Per pixel: the height (world px) at which its ray meets the seat; NaN where the drawing is clear. */
  z: Float32Array;
  /** Per pixel: the index of the model part it shows (−1 clear). */
  part: Int16Array;
  /** Per pixel: 0 a top, 1 a side toward screen-right (+x), 2 a side toward screen-left (+y), 3 a curved side. */
  face: Uint8Array;
}

export type RGB = [number, number, number];
const PLUM: RGB = [42, 31, 45];
const CREAM: RGB = [255, 248, 236];
const WHITE: RGB = [255, 253, 246];

export function hexRgb(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

/**
 * A material's ramp: [deep, shadow, base, light, highlight]. Fabrics are soft (little contrast), metals hard, gold
 * five bright tones; every shadow leans plum and every light leans cream (never black or white).
 */
export function ramp(m: Material): RGB[] {
  const b = hexRgb(m.base);
  const K: Record<MaterialKind, [number, number, number, number]> = {
    // deep, shadow, light, highlight (mix toward plum / cream)
    fabric: [0.55, 0.28, 0.16, 0.3],
    velvet: [0.6, 0.36, 0.12, 0.24],
    leather: [0.58, 0.32, 0.18, 0.45],
    vinyl: [0.58, 0.3, 0.26, 0.6],
    wood: [0.6, 0.32, 0.2, 0.36],
    metal: [0.62, 0.36, 0.34, 0.7],
    chrome: [0.7, 0.45, 0.5, 0.92],
    plastic: [0.55, 0.28, 0.24, 0.5],
    iron: [0.5, 0.25, 0.2, 0.35],
    gold: [0.62, 0.32, 0.4, 0.85],
  };
  const k = K[m.kind];
  return [mix(b, PLUM, k[0]), mix(b, PLUM, k[1]), b, mix(b, CREAM, k[2]), mix(b, m.kind === 'chrome' || m.kind === 'gold' || m.kind === 'vinyl' ? WHITE : CREAM, k[3])];
}

/** Which of a part's materials to draw it with. */
function materialOf(mats: Materials, name: MatName): Material {
  return mats[name] ?? mats.frame;
}

/* ------------------------------------------------------------------ ray casting */

interface Hit {
  z: number;
  /** 0 top, 1 side +x, 2 side +y, 3 curved. */
  face: number;
  /** The world-space normal's angle for a curved side (radians). */
  angle: number;
}

/** The world-space direction a local normal (nu, nv) points, placed facing f. */
function worldNormal(f: Facing, nu: number, nv: number): [number, number] {
  switch (f) {
    case 'se':
      return [-nv, nu];
    case 'sw':
      return [-nu, -nv];
    case 'ne':
      return [nu, nv];
    case 'nw':
      return [nv, -nu];
  }
}

function boxHit(r: Ray, p: BuiltPart, f: Facing): Hit | null {
  const h = rayBox(r, p);
  if (!h) return null;
  if (h.face === 'top') return { z: h.hi, face: 0, angle: 0 };
  const [nx, ny] = h.face === 'u' ? worldNormal(f, Math.sign(r.du), 0) : worldNormal(f, 0, Math.sign(r.dv));
  // the two camera-facing sides: +x (toward screen-right) and +y (toward screen-left)
  return { z: h.hi, face: nx > 0.5 ? 1 : ny > 0.5 ? 2 : 1, angle: Math.atan2(ny, nx) };
}

/** A vertical cylinder (or ring) filling the part's box: its top disc, else its side toward the camera. */
function cylHit(r: Ray, p: BuiltPart, f: Facing): Hit | null {
  const cu = (p.u[0] + p.u[1]) / 2;
  const cv = (p.v[0] + p.v[1]) / 2;
  const ru = (p.u[1] - p.u[0]) / 2;
  const rv = (p.v[1] - p.v[0]) / 2;
  const [z0, z1] = p.z;
  const inside = (z: number, k = 1) => {
    const du = (r.u0 + r.du * z - cu) / (ru * k);
    const dv = (r.v0 + r.dv * z - cv) / (rv * k);
    return du * du + dv * dv <= 1;
  };
  const hole = p.shape === 'ring' ? (p.hole ?? 0.7) : 0;
  const normalAt = (z: number, k: number, inward: boolean): number => {
    const du = (r.u0 + r.du * z - cu) / (ru * k);
    const dv = (r.v0 + r.dv * z - cv) / (rv * k);
    const s = inward ? -1 : 1;
    const [nx, ny] = worldNormal(f, (s * du) / ru, (s * dv) / rv);
    return Math.atan2(ny, nx);
  };
  // the roots of |p(z) − c|² = k²: the ray is inside the cylinder between them
  const roots = (k: number): [number, number] | null => {
    const a = (r.du * r.du) / (ru * ru * k * k) + (r.dv * r.dv) / (rv * rv * k * k);
    const b = (2 * ((r.u0 - cu) * r.du)) / (ru * ru * k * k) + (2 * ((r.v0 - cv) * r.dv)) / (rv * rv * k * k);
    const c = ((r.u0 - cu) * (r.u0 - cu)) / (ru * ru * k * k) + ((r.v0 - cv) * (r.v0 - cv)) / (rv * rv * k * k) - 1;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    return [(-b - s) / (2 * a), (-b + s) / (2 * a)];
  };
  if (inside(z1)) {
    if (hole && inside(z1, hole)) {
      // down through the hole: the far wall of the hole faces the camera
      const rr = roots(hole);
      if (rr && rr[0] >= z0 && rr[0] <= z1) return { z: rr[0], face: 3, angle: normalAt(rr[0], hole, true) };
      return null;
    }
    return { z: z1, face: 0, angle: 0 };
  }
  const rr = roots(1);
  if (!rr) return null;
  const zs = rr[1];
  if (zs < z0 || zs > z1) return null;
  if (hole && inside(zs, hole)) return null;
  return { z: zs, face: 3, angle: normalAt(zs, 1, false) };
}

function hit(r: Ray, p: BuiltPart, f: Facing): Hit | null {
  return p.shape === 'cyl' || p.shape === 'ring' ? cylHit(r, p, f) : boxHit(r, p, f);
}

/* ------------------------------------------------------------------ the drawing */

/** The pad of clear pixels round the drawing (room for the outline). */
const PAD = 1;

/** The drawing's bounds and anchor for a model in a facing: every part's projected corners, plus the pad. */
export function seatBounds(model: SeatModel, f: Facing): { w: number; h: number; ax: number; ay: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of model.parts)
    for (const u of p.u)
      for (const v of p.v)
        for (const z of p.z) {
          const [x, y] = projectLocal([0, 0], model.size, f, u, v, z);
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
  const ax = Math.ceil(-x0) + PAD;
  const ay = Math.ceil(-y0) + PAD;
  return { w: Math.ceil(x1) + ax + PAD, h: Math.ceil(y1) + ay + PAD, ax, ay };
}

const tone = (i: number) => Math.max(0, Math.min(4, i));

/** The tone index (0 deep … 4 highlight) a surface takes by which way it faces. */
function faceTone(h: Hit): number {
  if (h.face === 0) return 3;
  if (h.face === 1) return 1;
  if (h.face === 2) return 2;
  // curved: by the normal's angle, in bands (visible normals run from −45° (+x−y) to 135° (−x+y))
  const a = (h.angle * 180) / Math.PI;
  if (a < -15) return 0;
  if (a < 40) return 1;
  if (a < 100) return 2;
  return 3;
}

/**
 * Draw a seat model in a facing with these materials. The model's parts must be BuiltParts (from seatSpec.ts
 * buildSeat), which say each part's shape, material and detail.
 */
export function renderSeat(model: SeatModel, mats: Materials, facing: Facing): SeatArt {
  const parts = model.parts as BuiltPart[];
  const { w, h, ax, ay } = seatBounds(model, facing);
  const N = w * h;
  const z = new Float32Array(N).fill(NaN);
  const part = new Int16Array(N).fill(-1);
  const face = new Uint8Array(N);
  const toneIx = new Int8Array(N);
  const su = new Float32Array(N);
  const sv = new Float32Array(N);
  const ramps = parts.map((p) => ramp(materialOf(mats, p.mat)));
  const anchor: [number, number] = [ax, ay];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = rayThrough(anchor, model.size, facing, x + 0.5, y + 0.5);
      let best: Hit | null = null;
      let bk = -1;
      for (let k = 0; k < parts.length; k++) {
        const hh = hit(r, parts[k], facing);
        if (hh && (!best || hh.z > best.z + 1e-6)) {
          best = hh;
          bk = k;
        }
      }
      if (!best) continue;
      z[i] = best.z;
      part[i] = bk;
      face[i] = best.face;
      toneIx[i] = faceTone(best);
      su[i] = r.u0 + r.du * best.z;
      sv[i] = r.v0 + r.dv * best.z;
    }

  /* ---- shading passes on the tone indices */
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x);
  const solid = (j: number) => j >= 0 && part[j] >= 0;
  // a soft part's corners are rounded: a silhouette pixel with clear pixels on two adjacent sides is cut
  const cut: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (part[i] < 0 || parts[part[i]].shape !== 'soft') continue;
      const l = solid(at(x - 1, y));
      const r = solid(at(x + 1, y));
      const u = solid(at(x, y - 1));
      const d = solid(at(x, y + 1));
      if ((!l && !u) || (!r && !u) || (!l && !d) || (!r && !d)) cut.push(i);
    }
  for (const i of cut) {
    part[i] = -1;
    z[i] = NaN;
  }
  // a soft part's shoulder: the first row of a side face under its top rolls over (a tone lighter)
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (part[i] < 0 || face[i] === 0 || parts[part[i]].shape !== 'soft') continue;
      const up = at(x, y - 1);
      if (solid(up) && part[up] === part[i] && face[up] === 0) toneIx[i] = tone(toneIx[i] + 1);
    }
  // a soft top rolls over: its front edges (toward screen-bottom) drop a tone
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (part[i] < 0 || face[i] !== 0) continue;
      const p = parts[part[i]];
      if (p.shape !== 'soft' && p.shape !== 'cyl') continue;
      const below = at(x, y + 1);
      const bl = at(x - 1, y + 1);
      const br = at(x + 1, y + 1);
      const edge = (j: number) => !solid(j) || part[j] !== part[i] || face[j] !== 0;
      if (edge(below) || edge(bl) || edge(br)) toneIx[i] = tone(toneIx[i] - 1);
    }
  // details, in the surface's own coordinates
  for (let k = 0; k < parts.length; k++) detail(parts[k], k, model, facing, anchor, { w, h, part, face, toneIx, su, sv, z });
  // contact shadow: a pixel next to a nearer part of another kind (or a nearer part in front of it) darkens
  const shadowed = new Uint8Array(N);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (part[i] < 0) continue;
      for (const j of [at(x, y - 1), at(x - 1, y), at(x + 1, y), at(x, y + 1)]) {
        if (!solid(j) || part[j] === part[i]) continue;
        if (z[j] > z[i] + 1.5) {
          shadowed[i] = 1;
          break;
        }
      }
    }
  for (let i = 0; i < N; i++) if (shadowed[i]) toneIx[i] = tone(Math.min(toneIx[i], 2) - 1);
  // the outline: the outermost pixels of the silhouette in the material's deepest tone
  const outline = new Uint8Array(N);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (part[i] < 0) continue;
      if (!solid(at(x, y - 1)) || !solid(at(x - 1, y)) || !solid(at(x + 1, y)) || !solid(at(x, y + 1))) outline[i] = 1;
    }
  // a rim of light just inside the outline along the upper-left edges of tops and lit sides
  const rim = new Uint8Array(N);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (part[i] < 0 || outline[i]) continue;
      if (face[i] === 1) continue;
      const up = at(x, y - 1);
      const left = at(x - 1, y);
      const edgeUp = up >= 0 && outline[up] && part[up] === part[i];
      const edgeLeft = left >= 0 && outline[left] && part[left] === part[i];
      // or the boundary with a farther part above / to the left
      const farUp = solid(up) && part[up] !== part[i] && z[up] < z[i] - 1.5;
      const farLeft = solid(left) && part[left] !== part[i] && z[left] < z[i] - 1.5;
      if (edgeUp || edgeLeft || farUp || farLeft) rim[i] = 1;
    }
  for (let i = 0; i < N; i++) {
    if (rim[i]) toneIx[i] = tone(Math.max(toneIx[i], 3) + (parts[part[i]].shape === 'cyl' || face[i] === 0 ? 1 : 0));
    if (outline[i]) toneIx[i] = 0;
  }

  /* ---- paint */
  const d = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    if (part[i] < 0) continue;
    const c = ramps[part[i]][tone(toneIx[i])];
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = 255;
  }
  return { facing, px: { w, h, d }, ax, ay, z, part, face };
}

interface Buf {
  w: number;
  h: number;
  part: Int16Array;
  face: Uint8Array;
  toneIx: Int8Array;
  su: Float32Array;
  sv: Float32Array;
  z: Float32Array;
}

/** A part's surface detail, stamped where its pixels are. */
function detail(p: BuiltPart, k: number, model: SeatModel, f: Facing, anchor: [number, number], B: Buf) {
  if (p.detail === 'none') return;
  const { w, h, part, face, toneIx, su, sv, z } = B;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x);
  if (p.detail === 'tuft') {
    // buttons on a diamond lattice: a shadow pixel with a light pixel under it — on the top, and on the
    // camera-facing v side (the front of a back cushion)
    const s = 0.15;
    const stamp = (x: number, y: number) => {
      const i = at(x, y);
      if (i < 0 || part[i] !== k) return;
      toneIx[i] = 1;
      const j = at(x, y + 1);
      if (j >= 0 && part[j] === k) toneIx[j] = 4;
    };
    const { dv } = viewDir(f);
    const V = dv < 0 ? p.v[0] : p.v[1];
    // the top
    let row = 0;
    for (let v = p.v[0] + s / 2; v < p.v[1] - s / 4; v += s / 2, row++)
      for (let u = p.u[0] + s / 2 + (row % 2 ? s / 2 : 0); u < p.u[1] - s / 4; u += s) {
        const [x, y] = projectLocal(anchor, model.size, f, u, v, p.z[1]);
        stamp(Math.floor(x), Math.floor(y));
      }
    // the side facing the camera in depth, if it stands tall enough
    if (p.z[1] - p.z[0] >= 6) {
      const zs = 4.5;
      let r2 = 0;
      for (let zz = p.z[0] + 3; zz < p.z[1] - 1.5; zz += zs / 2, r2++)
        for (let u = p.u[0] + s / 2 + (r2 % 2 ? s / 2 : 0); u < p.u[1] - s / 4; u += s) {
          const [x, y] = projectLocal(anchor, model.size, f, u, V, zz);
          const i = at(Math.floor(x), Math.floor(y));
          if (i >= 0 && part[i] === k && face[i] === 2) stamp(Math.floor(x), Math.floor(y));
          else if (i >= 0 && part[i] === k && face[i] === 1) stamp(Math.floor(x), Math.floor(y));
        }
    }
    return;
  }
  if (p.detail === 'grain') {
    // wood: lines along the long axis of the top in the shadow tone, broken now and then
    const alongU = p.u[1] - p.u[0] >= p.v[1] - p.v[0];
    for (let i = 0; i < w * h; i++) {
      if (part[i] !== k || face[i] !== 0) continue;
      const a = alongU ? sv[i] - p.v[0] : su[i] - p.u[0];
      const b = alongU ? su[i] - p.u[0] : sv[i] - p.v[0];
      const line = Math.floor(a / 0.09);
      if (line % 2 !== 1) continue;
      const frac = a / 0.09 - line;
      if (frac > 0.45 && Math.floor(b * 16 + line) % 5 !== 0) toneIx[i] = 2;
    }
    return;
  }
  if (p.detail === 'weave') {
    // cane: a fine checker of light and base on the top
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (part[i] !== k || face[i] !== 0) continue;
        toneIx[i] = (x + y) % 2 ? 2 : 3;
      }
    return;
  }
  if (p.detail === 'seam') {
    // a stitched line a little in from the top's edges
    for (let i = 0; i < w * h; i++) {
      if (part[i] !== k || face[i] !== 0) continue;
      const du = Math.min(su[i] - p.u[0], p.u[1] - su[i]);
      const dv = Math.min(sv[i] - p.v[0], p.v[1] - sv[i]);
      const m = Math.min(du, dv);
      if (m > 0.05 && m < 0.075) toneIx[i] = 2;
    }
    return;
  }
  if (p.detail === 'quilt') {
    // a beanbag's segments: lines from the centre out across the top
    const cu = (p.u[0] + p.u[1]) / 2;
    const cv = (p.v[0] + p.v[1]) / 2;
    for (let i = 0; i < w * h; i++) {
      if (part[i] !== k || face[i] !== 0) continue;
      const a = Math.atan2(sv[i] - cv, su[i] - cu);
      const seg = (a / (Math.PI / 3)) % 1;
      const rr = Math.hypot(su[i] - cu, sv[i] - cv);
      if (rr > 0.1 && Math.abs(seg) < 0.05) toneIx[i] = 2;
    }
    void z;
  }
}
