/**
 * SEAT PARTS: the one thing a seat's drawing needs authored — which of its pixels are the BACK, the SEAT, an ARM or a
 * LEG — and fixed rules that turn that into the seat's layers (the rig the game draws: what's in front of a sitter).
 *
 * Pure (no fs, no DOM): images are {w, h, d} RGBA, a part map is one byte per pixel (PART). scripts/seat-parts.ts
 * (the CLI: regions, labels, transfer, compile, propose), scripts/lab-parts.ts (the Design Lab's staged drawings at
 * publish) and the Lab's Parts panel (src/client/studio/PartsPanel.tsx) all run this one copy.
 *
 *   1. regions(img)                      the drawing's natural colour regions, numbered 1…N in reading order
 *   2. partsFromLabels(lab, labels)      regions → the part map ({"back": [1, 4], "seat": [2], …}; unlisted: other),
 *      paintPoly / paintPixels           plus paint: a polygon or brush that sets a part over a region split in two
 *      transferParts(src, a, b)          a variant drawn in the same shape takes another's part map
 *   3. compileFront(f, w, h, parts, hips) the fixed rules → the front layer (1 where a pixel is drawn over sitters)
 *      compileRig(base, f, w, h, parts)  … as the rig art/seat-rigs.json stores (front polygons, legs; hips kept)
 *   4. hips stay hand-placed (in the rig).
 *
 * THE RULES (the same for every seat), relative to each sitter's pelvis (the rig hip):
 *   An arm counts only below its own top edge (a forearm rests ON it), and only the arm on the camera's side of the
 *   sitter (down-left along the seat's width in se/nw drawings, down-right in sw/ne); the far arm is beyond them. Near
 *   or far is decided per arm blob (a connected run of arm pixels), by where its middle lies from the nearest sitter.
 *   Seen from behind: the back → in front, always; the near arm → in front; seat and legs → in front below the hips.
 *   Seen from the front: only the near arm is in front. The seat is under you, your legs hang over its front edge,
 *   the back and the far arm are behind you.
 *
 * Part maps on disk are PNGs, art/seat-parts/KEY.FACING.png, one colour per part (PART_RGB); a Lab draft keeps its
 * maps as run-length strings (partsToString).
 */
import { frontMask, fromBehind, inPoly, tidyRig, type Pt, type SeatRig } from '@shared/world/seatRigs';
import type { Facing } from '@shared/world/scene';
import { maskToPolys } from './rigTrace';

/** An RGBA image: w × h, 4 bytes a pixel. */
export interface PartImg {
  w: number;
  h: number;
  d: Uint8Array | Uint8ClampedArray;
}

export const PART = { none: 0, back: 1, seat: 2, arm: 3, leg: 4, other: 5 } as const;
export type PartName = Exclude<keyof typeof PART, 'none'>;
export type PartId = (typeof PART)[keyof typeof PART];
/** The authored parts, in the order the Lab cycles them on a click. */
export const PART_NAMES: PartName[] = ['back', 'seat', 'arm', 'leg', 'other'];
/** A part map's colours (the PNGs in art/seat-parts). */
export const PART_RGB: Record<number, [number, number, number]> = { 0: [0, 0, 0], 1: [230, 60, 60], 2: [60, 110, 240], 3: [60, 200, 90], 4: [240, 200, 40], 5: [150, 150, 150] };

/**
 * A labelling: region numbers per part (unlisted regions are "other"), and paint over them: a polygon's pixels set to a
 * part — only those like a colour (`like` RGB, within `tol`), when given.
 */
export type PartLabels = Partial<Record<PartName, number[]>> & { paint?: Array<{ part: PartName; poly: Pt[]; like?: [number, number, number]; tol?: number }> };

const lum = (d: ArrayLike<number>, i: number) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];

/* ------------------------------------------------------------------ regions */

/** How regions split: a pixel darker than `outline` (luma) is outline; neighbours closer than `close` (RGB L1) join. */
export interface RegionOpts {
  outline?: number;
  close?: number;
}

/** Natural regions of a pixel-art drawing: fills of similar colour, split by its dark outline; tiny ones merged. 0 = air. */
export function regions(img: PartImg, opts: RegionOpts = {}): Int32Array {
  const { w, h, d } = img;
  const OUTLINE = opts.outline ?? 22;
  const CLOSE = opts.close ?? 30;
  const lab = new Int32Array(w * h).fill(-1);
  const opaque = (p: number) => d[p * 4 + 3] >= 128;
  const outline = (p: number) => lum(d, p * 4) < OUTLINE;
  const close = (a: number, b: number) => {
    const i = a * 4;
    const j = b * 4;
    return Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) < CLOSE;
  };
  let n = 0;
  for (let p = 0; p < w * h; p++) {
    if (!opaque(p) || outline(p) || lab[p] >= 0) continue;
    const stack = [p];
    lab[p] = n;
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % w;
      const y = (q / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const r = Y * w + X;
        if (lab[r] >= 0 || !opaque(r) || outline(r) || !close(q, r)) continue;
        lab[r] = n;
        stack.push(r);
      }
    }
    n++;
  }
  // outline and unassigned pixels join their most common labelled neighbour (repeat until settled)
  for (let pass = 0; pass < 6; pass++)
    for (let p = 0; p < w * h; p++) {
      if (!opaque(p) || lab[p] >= 0) continue;
      const count = new Map<number, number>();
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx;
          const Y = y + dy;
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const l = lab[Y * w + X];
          if (l >= 0) count.set(l, (count.get(l) ?? 0) + 1);
        }
      let best = -1;
      let bc = 0;
      for (const [l, c] of count)
        if (c > bc) {
          best = l;
          bc = c;
        }
      if (best >= 0) lab[p] = best;
    }
  // merge regions under 8 px into their biggest neighbour
  const size = new Map<number, number>();
  for (const l of lab) if (l >= 0) size.set(l, (size.get(l) ?? 0) + 1);
  for (let p = 0; p < w * h; p++) {
    const l = lab[p];
    if (l < 0 || (size.get(l) ?? 0) >= 8) continue;
    const x = p % w;
    const y = (p / w) | 0;
    let best = -1;
    let bs = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const m = lab[Y * w + X];
      if (m >= 0 && m !== l && (size.get(m) ?? 0) > bs) {
        best = m;
        bs = size.get(m)!;
      }
    }
    if (best >= 0) for (let q = 0; q < w * h; q++) if (lab[q] === l) lab[q] = best;
  }
  // renumber 1..N in reading order
  const map = new Map<number, number>();
  for (let p = 0; p < w * h; p++) if (lab[p] >= 0 && !map.has(lab[p])) map.set(lab[p], map.size + 1);
  for (let p = 0; p < w * h; p++) lab[p] = lab[p] >= 0 ? map.get(lab[p])! : 0;
  return lab;
}

/** Each region's size (px) and centroid (drawing px, pixel centres), index = region number (0 unused). */
export function regionInfo(lab: Int32Array, w: number): { n: number; size: number[]; at: Pt[] } {
  let n = 0;
  for (const l of lab) if (l > n) n = l;
  const size = new Array<number>(n + 1).fill(0);
  const sx = new Array<number>(n + 1).fill(0);
  const sy = new Array<number>(n + 1).fill(0);
  for (let p = 0; p < lab.length; p++) {
    const l = lab[p];
    if (!l) continue;
    size[l]++;
    sx[l] += (p % w) + 0.5;
    sy[l] += ((p / w) | 0) + 0.5;
  }
  const at: Pt[] = size.map((s, l) => (s ? [sx[l] / s, sy[l] / s] : [0, 0]));
  return { n, size, at };
}

/* a tiny 3×5 digit font for the region numbers */
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function text(img: PartImg, x: number, y: number, s: string, c: [number, number, number], k = 2) {
  let cx = x;
  for (const ch of s) {
    const g = DIGITS[+ch];
    for (let r = 0; r < 5; r++)
      for (let q = 0; q < 3; q++)
        if (g[r * 3 + q] === '1')
          for (let dy = 0; dy < k; dy++)
            for (let dx = 0; dx < k; dx++) {
              const X = cx + q * k + dx;
              const Y = y + r * k + dy;
              if (X >= 0 && Y >= 0 && X < img.w && Y < img.h) img.d.set([...c, 255], (Y * img.w + X) * 4);
            }
    cx += 4 * k;
  }
}

function blankImg(w: number, h: number, rgb: [number, number, number], a: number): PartImg {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([rgb[0], rgb[1], rgb[2], a], i * 4);
  return { w, h, d };
}

/**
 * The regions drawn for a reader (a person or a vision model): the drawing at Z×, a touch darkened, each region's
 * edge in white and its number in yellow at its middle (scripts/seat-parts.ts --regions; the AI proposal's picture).
 */
export function regionSheet(img: PartImg, lab: Int32Array, Z = 10): PartImg {
  const out = blankImg(img.w * Z, img.h * Z, [40, 40, 50], 255);
  const cx = new Map<number, [number, number, number]>();
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const p = y * img.w + x;
      const l = lab[p];
      if (!l) continue;
      const s = cx.get(l) ?? [0, 0, 0];
      cx.set(l, [s[0] + x, s[1] + y, s[2] + 1]);
      const i = p * 4;
      // the drawing, a touch darkened, with each region's edge drawn
      const edge = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ].some(([dx, dy]) => {
        const X = x + dx;
        const Y = y + dy;
        return X < 0 || Y < 0 || X >= img.w || Y >= img.h || lab[Y * img.w + X] !== l;
      });
      for (let dy = 0; dy < Z; dy++)
        for (let dx = 0; dx < Z; dx++) {
          const border = edge && (dx === 0 || dy === 0 || dx === Z - 1 || dy === Z - 1);
          const c = border ? [255, 255, 255] : [img.d[i] * 0.8, img.d[i + 1] * 0.8, img.d[i + 2] * 0.8];
          out.d.set([c[0], c[1], c[2], 255], ((y * Z + dy) * out.w + x * Z + dx) * 4);
        }
    }
  for (const [l, [sx, sy, n]] of cx) {
    const x = Math.round((sx / n) * Z);
    const y = Math.round((sy / n) * Z);
    text(out, x - 4, y - 5, String(l), [0, 0, 0], 3);
    text(out, x - 5, y - 6, String(l), [255, 255, 0], 3);
  }
  return out;
}

/** The drawing alone at Z× on the same dark ground (the proposal's second picture: the seat without the overlay). */
export function plainSheet(img: PartImg, Z = 10): PartImg {
  const out = blankImg(img.w * Z, img.h * Z, [40, 40, 50], 255);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      if (img.d[i + 3] < 128) continue;
      for (let dy = 0; dy < Z; dy++) for (let dx = 0; dx < Z; dx++) out.d.set([img.d[i], img.d[i + 1], img.d[i + 2], 255], ((y * Z + dy) * out.w + x * Z + dx) * 4);
    }
  return out;
}

/** The zoom a proposal's pictures are drawn at: 8–10×, about a thousand px across. */
export const proposalZoom = (img: { w: number; h: number }) => Math.max(8, Math.min(10, Math.floor(1100 / Math.max(img.w, img.h))));

/** A view as a vision model is told about it beside its pictures (art/studio.py vision-parts: its meta.json). */
export interface ProposalMeta {
  facing: Facing;
  name: string;
  width: number;
  height: number;
  zoom: number;
  cushions: number;
  sitStyle: string;
  backrest: boolean;
  arms: boolean;
  regions: Array<{ id: number; at: Pt; size: number }>;
}

/** The meta for a view's proposal: which way it's seen, the seat's facts, and where each region is (whole px). */
export function proposalMeta(img: { w: number; h: number }, lab: Int32Array, v: Omit<ProposalMeta, 'width' | 'height' | 'zoom' | 'regions'>): ProposalMeta {
  const info = regionInfo(lab, img.w);
  return {
    ...v,
    width: img.w,
    height: img.h,
    zoom: proposalZoom(img),
    regions: Array.from({ length: info.n }, (_, i) => ({ id: i + 1, at: [Math.round(info.at[i + 1][0]), Math.round(info.at[i + 1][1])] as Pt, size: info.size[i + 1] })),
  };
}

/* ------------------------------------------------------------------ part maps */

/** A labelling applied to a drawing's regions: every region pixel "other" unless listed; then the paint (`img` for its colours). */
export function partsFromLabels(lab: Int32Array, w: number, spec: PartLabels, img?: PartImg): Uint8Array {
  const parts = new Uint8Array(lab.length);
  for (let p = 0; p < parts.length; p++) {
    if (!lab[p]) continue;
    parts[p] = PART.other;
    for (const [name, list] of Object.entries(spec)) if (name !== 'paint' && Array.isArray(list) && (list as number[]).includes(lab[p])) parts[p] = PART[name as PartName];
  }
  for (const { part, poly, like, tol } of spec.paint ?? []) paintPoly(parts, lab, w, poly, PART[part], like && img ? likeColour(img, like, tol) : undefined);
  return parts;
}

/**
 * Paint: every drawn pixel (a region's) whose centre is inside `poly` (drawing px) becomes `part` — only those `only`
 * lets through, when given (likeColour: a spindle among the back's slats). In place.
 */
export function paintPoly(parts: Uint8Array, lab: ArrayLike<number>, w: number, poly: ReadonlyArray<readonly [number, number]>, part: number, only?: (p: number) => boolean): Uint8Array {
  for (let p = 0; p < parts.length; p++) if (lab[p] && inPoly(poly, (p % w) + 0.5, ((p / w) | 0) + 0.5) && (!only || only(p))) parts[p] = part;
  return parts;
}

/** Brush paint: the drawn pixels within `r` px (a disc) of each point become `part` (only those `only` lets through). In place. */
export function paintPixels(parts: Uint8Array, lab: ArrayLike<number>, w: number, h: number, pts: ReadonlyArray<readonly [number, number]>, part: number, r = 0, only?: (p: number) => boolean): Uint8Array {
  for (const [px, py] of pts)
    for (let y = Math.floor(py - r); y <= Math.floor(py + r); y++)
      for (let x = Math.floor(px - r); x <= Math.floor(px + r); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h || !lab[y * w + x]) continue;
        if ((x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 > (r + 0.5) ** 2 && !(Math.floor(px) === x && Math.floor(py) === y)) continue;
        if (only && !only(y * w + x)) continue;
        parts[y * w + x] = part;
      }
  return parts;
}

/** Pixels like one colour (RGB L1 distance under `tol`): paint that takes only a material's own pixels. */
export function likeColour(img: PartImg, rgb: readonly [number, number, number], tol = 40): (p: number) => boolean {
  return (p) => Math.abs(img.d[p * 4] - rgb[0]) + Math.abs(img.d[p * 4 + 1] - rgb[1]) + Math.abs(img.d[p * 4 + 2] - rgb[2]) < tol;
}

/** One region set to a part, whole (the Lab's click). In place. */
export function setRegion(parts: Uint8Array, lab: Int32Array, region: number, part: number): Uint8Array {
  for (let p = 0; p < parts.length; p++) if (lab[p] === region) parts[p] = part;
  return parts;
}

/** A region's part: the one most of its pixels have (0 for none). */
export function regionPart(parts: ArrayLike<number>, lab: Int32Array, region: number): number {
  const n = new Array<number>(6).fill(0);
  for (let p = 0; p < lab.length; p++) if (lab[p] === region) n[parts[p]]++;
  let best = 0;
  for (let k = 1; k < 6; k++) if (n[k] > n[best]) best = k;
  return best;
}

/** The part after another on a click: back → seat → arm → leg → other → back (air → back). */
export function nextPart(part: number): number {
  const i = PART_NAMES.findIndex((n) => PART[n] === part);
  return PART[PART_NAMES[(i + 1) % PART_NAMES.length]];
}

/** A part map from its PNG's pixels: each opaque pixel the part of the nearest colour, air where transparent. */
export function decodeParts(img: PartImg): Uint8Array {
  const out = new Uint8Array(img.w * img.h);
  for (let p = 0; p < img.w * img.h; p++) {
    const i = p * 4;
    if (img.d[i + 3] < 128) continue;
    let best = 0;
    let bd = Infinity;
    for (const [k, c] of Object.entries(PART_RGB)) {
      const dd = Math.abs(img.d[i] - c[0]) + Math.abs(img.d[i + 1] - c[1]) + Math.abs(img.d[i + 2] - c[2]);
      if (dd < bd) {
        bd = dd;
        best = +k;
      }
    }
    out[p] = best;
  }
  return out;
}

/** A part map as its PNG's pixels (PART_RGB, transparent air). */
export function encodeParts(w: number, h: number, parts: ArrayLike<number>): PartImg {
  const img = blankImg(w, h, [0, 0, 0], 0);
  for (let p = 0; p < w * h; p++) if (parts[p]) img.d.set([...PART_RGB[parts[p]], 255], p * 4);
  return img;
}

/**
 * A variant drawn in the same shape (a beanbag in another colour) takes a part map: each of `b`'s drawn pixels the part
 * of the nearest labelled pixel of `src` (the part map over drawing `a`, same facing) within 4 px, else "other".
 */
export function transferParts(src: ArrayLike<number>, a: { w: number; h: number }, b: PartImg): Uint8Array {
  const out = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (b.d[(y * b.w + x) * 4 + 3] < 128) continue;
      let best = 0;
      let bd = Infinity;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const X = x + dx;
          const Y = y + dy;
          if (X < 0 || Y < 0 || X >= a.w || Y >= a.h) continue;
          const l = src[Y * a.w + X];
          if (l && dx * dx + dy * dy < bd) {
            bd = dx * dx + dy * dy;
            best = l;
          }
        }
      out[y * b.w + x] = best || PART.other;
    }
  return out;
}

/** A part map as text, for a Lab draft: row-major runs "part*count" (a run of one: "part"), e.g. "0*120,5*3,2". */
export function partsToString(parts: ArrayLike<number>): string {
  const out: string[] = [];
  for (let p = 0; p < parts.length; ) {
    let q = p;
    while (q < parts.length && parts[q] === parts[p]) q++;
    out.push(q - p === 1 ? String(parts[p]) : `${parts[p]}*${q - p}`);
    p = q;
  }
  return out.join(',');
}

/** partsToString's text back to a part map of `n` pixels (null when it doesn't read or doesn't fit). */
export function partsFromString(s: string, n: number): Uint8Array | null {
  const out = new Uint8Array(n);
  let p = 0;
  for (const run of s ? s.split(',') : []) {
    const m = /^([0-5])(?:\*(\d+))?$/.exec(run);
    if (!m) return null;
    const k = m[2] ? +m[2] : 1;
    if (p + k > n) return null;
    out.fill(+m[1], p, p + k);
    p += k;
  }
  return p === n ? out : null;
}

/** How far two part maps of one drawing agree: the share of its drawn pixels given the same part, and per part. */
export function partAgreement(a: ArrayLike<number>, b: ArrayLike<number>): { share: number; drawn: number; perPart: Record<PartName, { a: number; b: number; both: number }> } {
  const perPart = Object.fromEntries(PART_NAMES.map((n) => [n, { a: 0, b: 0, both: 0 }])) as Record<PartName, { a: number; b: number; both: number }>;
  let drawn = 0;
  let same = 0;
  for (let p = 0; p < a.length; p++) {
    if (!a[p] && !b[p]) continue;
    drawn++;
    if (a[p] === b[p]) same++;
    const na = PART_NAMES.find((n) => PART[n] === a[p]);
    const nb = PART_NAMES.find((n) => PART[n] === b[p]);
    if (na) perPart[na].a++;
    if (nb) perPart[nb].b++;
    if (na && na === nb) perPart[na].both++;
  }
  return { share: drawn ? same / drawn : 1, drawn, perPart };
}

/* ------------------------------------------------------------------ the rules */

/**
 * Across the seat, the side nearer the camera: down-left on screen in the se and nw drawings, down-right in sw and ne
 * (the seat's width runs along a floor axis, drawn at 2:1; its camera end is the lower one). An arm on that side is
 * between the camera and the sitter's side; the far arm is beyond them. Judged along that axis, not by screen x alone:
 * seen from behind, a far arm reaches forward and so can sit straight above the sitter on screen.
 */
export const nearAxis = (f: Facing): [number, number] => (f === 'se' || f === 'nw' ? [-2, 1] : [2, 1]);

/** The sitter nearest a point (screen distance), among the hips. */
function nearestHip(hips: ReadonlyArray<readonly [number, number]>, x: number, y: number): readonly [number, number] {
  let hip = hips[0];
  for (const q of hips) if (Math.hypot(q[0] - x, q[1] - y) < Math.hypot(hip[0] - x, hip[1] - y)) hip = q;
  return hip;
}

/**
 * Each arm (a connected run of arm pixels) near or far as a whole: by where its middle lies from the sitter nearest to
 * it — not pixel by pixel, which would put the tip of a far arm's roll on the near side. 1 per near arm pixel.
 */
export function armSides(f: Facing, w: number, h: number, parts: ArrayLike<number>, hips: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const across = nearAxis(f);
  const armNear = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  if (!hips.length) return armNear;
  for (let p0 = 0; p0 < w * h; p0++) {
    if (parts[p0] !== PART.arm || seen[p0]) continue;
    const blob: number[] = [];
    const stack = [p0];
    seen[p0] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      blob.push(q);
      const qx = q % w;
      const qy = (q / w) | 0;
      for (const [ddx, ddy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const X = qx + ddx;
        const Y = qy + ddy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const r = Y * w + X;
        if (!seen[r] && parts[r] === PART.arm) {
          seen[r] = 1;
          stack.push(r);
        }
      }
    }
    const cx = blob.reduce((a, q) => a + (q % w) + 0.5, 0) / blob.length;
    const cy = blob.reduce((a, q) => a + ((q / w) | 0) + 0.5, 0) / blob.length;
    const hip = nearestHip(hips, cx, cy);
    const near = (cx - hip[0]) * across[0] + (cy - hip[1]) * across[1] > 0;
    if (near) for (const q of blob) armNear[q] = 1;
  }
  return armNear;
}

/** The fixed rules: a part map and the hips → the front layer (1 where the drawing's pixel is drawn over sitters). */
export function compileFront(f: Facing, w: number, h: number, parts: ArrayLike<number>, hips: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const behind = fromBehind(f);
  const front = new Uint8Array(w * h);
  if (!hips.length) return front;
  // an arm's top edge per column: a forearm rests ON the arm, so its top two rows stay behind the sitter
  const armTop = new Int32Array(w).fill(1e9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (parts[y * w + x] === PART.arm && armTop[x] > y) armTop[x] = y;
  const armNear = armSides(f, w, h, parts, hips);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const part = parts[p];
      if (!part || part === PART.other) continue;
      // the nearest sitter (screen distance) and where this pixel lies from them
      const hip = nearestHip(hips, x, y);
      const dy = y + 0.5 - hip[1];
      const nearSide = armNear[p] === 1;
      const armBody = part === PART.arm && y >= armTop[x] + 2;
      let on = false;
      if (behind)
        // the back is between you and the camera; so are the near arm (below its top), and the seat and legs
        // below your hips (their camera-side half: nearer, at the same height, is lower on screen)
        on = part === PART.back || (armBody && nearSide) || ((part === PART.seat || part === PART.leg) && dy > 0);
      // from the front only the near arm (below its top) is ever in front: the seat is under you, your legs hang
      // over its front edge, the back and the far arm are behind you, and the legs stand below your feet
      else on = armBody && nearSide;
      if (on) front[p] = 1;
    }
  return front;
}

/**
 * A view's rig compiled from its part map: `base` (its hips, and anything else it carries: surface, drawing…) with the
 * front layer the rules give, as exact polygons; legs hidden from behind when it has a back, else shown; no cover of its
 * own (the rules decide what covers). A look that compiles to what was approved keeps its approval (`unchanged`);
 * any change is unaudited, for a person to look at again.
 */
export function compileRig(base: SeatRig, f: Facing, w: number, h: number, parts: ArrayLike<number>): { rig: SeatRig; unchanged: boolean } {
  const front = compileFront(f, w, h, parts, base.hips);
  const g: SeatRig = { ...base, front: maskToPolys(front, w, h) };
  delete (g as { cover?: number }).cover;
  // from behind, a back hides the legs; a backless seat has no back to hide them (and its body covers them anyway)
  g.legs = fromBehind(f) && Array.prototype.some.call(parts, (p: number) => p === PART.back) ? 'hide' : 'show';
  const unchanged = JSON.stringify(g.front) === JSON.stringify(base.front) && g.legs === base.legs && base.cover === undefined;
  if (!unchanged) delete (g as { audited?: string }).audited;
  return { rig: tidyRig(g), unchanged };
}

/** Whether a stored rig's front layer is exactly what its part map compiles to (the publish check's "compiled"). */
export function isCompiled(rig: Pick<SeatRig, 'front' | 'hips'>, f: Facing, w: number, h: number, parts: ArrayLike<number>): boolean {
  const want = compileFront(f, w, h, parts, rig.hips);
  const have = frontMask(w, h, rig.front);
  for (let i = 0; i < want.length; i++) if (want[i] !== have[i]) return false;
  return true;
}
