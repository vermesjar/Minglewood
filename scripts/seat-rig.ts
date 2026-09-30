/**
 * Seat rigs (src/shared/world/seatRigs.ts, art/seat-rigs.json): how people sit in every seat drawing, authored
 * and audited per drawn view, and checked.
 *
 *   npx tsx scripts/seat-rig.ts --init KEY|all [--force]   seed rigs from today's inference (unaudited): hips from
 *                                                         the seat profile's hip point, front polygons from the
 *                                                         backrest mask (back views) or a near-arm guess (front)
 *   npx tsx scripts/seat-rig.ts --sheet KEY|all           art/review/rigs/<key>.png: each view at 6× with a pixel
 *                                                         grid, the hips and the front polygons; the seated result
 *                                                         at play scale (2×) and 4× for three looks, every
 *                                                         cushion taken; and sit-down → seated → stand-up
 *   npx tsx scripts/seat-rig.ts --check                   every seat kind in any scene or the catalog, in every
 *                                                         facing, has an audited rig that holds (exit 1 if not)
 *   npx tsx scripts/seat-rig.ts --audit KEY[:FACING]      stamp views audited today (after reading their sheet)
 *   npx tsx scripts/seat-rig.ts --list                    every seat's views and their state
 */
import { existsSync, mkdirSync } from 'node:fs';
import type { Facing } from '../src/shared/world/scene';
import { FIG, frontMask, fromBehind, inPoly, regionPts, rigForView, RIG_FACINGS, tidyRig, worldToDrawing, type SeatRig, type SeatRigs } from '../src/shared/world/seatRigs';
import { checkRigView, composeRig, inferRig, RIG_LOOKS, rigFindings, rigSurface, seatedSitters, sitFrames, type RigSitter } from '../src/client/engine/sprites/seatRig';
import { loadManifest } from './lib/manifest';
import { blank, writePng, type Img } from './lib/png';
import { text } from './lib/font';
import { ownFacings, placed, profileOf, readRigs, rigView, seatKeys, withRigs, type Sprites } from './lib/rigs';

const M = loadManifest().sprites as unknown as Sprites;
const KEYS = seatKeys(M);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const pick = (v: string | undefined) => (!v || v === 'all' ? KEYS : v.split(',').filter((k) => KEYS.includes(k) || (console.error(`no seat ${k}`), false)));
const today = () => new Date().toISOString().slice(0, 10);

type View = ReturnType<typeof rigView>;

/* ------------------------------------------------------------------ seeding */

/** Today's inference as a first draft (seatRig.ts inferRig), stamped with the drawing it was made on. */
function seed(key: string, f: Facing): SeatRig {
  const v = rigView(M, key, f);
  return { ...inferRig(v, profileOf(M, key), v.mirrored).rig, drawing: v.print };
}

/* ------------------------------------------------------------------ drawing helpers */

type RGB = [number, number, number];
function plot(img: Img, x: number, y: number, c: RGB, a = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.d[i] = Math.round(img.d[i] * (1 - a) + c[0] * a);
  img.d[i + 1] = Math.round(img.d[i + 1] * (1 - a) + c[1] * a);
  img.d[i + 2] = Math.round(img.d[i + 2] * (1 - a) + c[2] * a);
  img.d[i + 3] = 255;
}
function rect(img: Img, x: number, y: number, w: number, h: number, c: RGB, a = 1) {
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) plot(img, x + u, y + v, c, a);
}
function line(img: Img, x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1, dash = 0) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    if (dash && Math.floor(i / dash) % 2) continue;
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    for (let v = 0; v < t; v++) for (let u = 0; u < t; u++) plot(img, x + u - (t >> 1), y + v - (t >> 1), c);
  }
}
/** Paste RGBA pixels at (x, y), each pixel s × s, over whatever is there (transparent pixels skipped). */
function paste(img: Img, src: { w: number; h: number; d: ArrayLike<number> }, x: number, y: number, s = 1) {
  for (let v = 0; v < src.h; v++)
    for (let u = 0; u < src.w; u++) {
      const i = (v * src.w + u) * 4;
      if (!src.d[i + 3]) continue;
      rect(img, x + u * s, y + v * s, s, s, [src.d[i], src.d[i + 1], src.d[i + 2]]);
    }
}

const FLOOR: RGB = [201, 164, 126];
const INK: RGB = [246, 234, 214];
const MUTED: RGB = [150, 140, 160];
const BAD: RGB = [240, 90, 80];
const GOOD: RGB = [120, 220, 140];

/* ------------------------------------------------------------------ the sheet */

/** The bounds (drawing px) of a view with everyone seated: the drawing and each figure's box. */
function bounds(v: View, sitters: RigSitter[]) {
  let l = 0;
  let t = 0;
  let r = v.art.px.w;
  let b = v.art.px.h;
  for (const s of sitters) {
    const ax = s.facing === 'sw' || s.facing === 'nw' ? FIG.axMirrored : FIG.ax;
    l = Math.min(l, s.feet[0] - ax + 16);
    r = Math.max(r, s.feet[0] - ax + FIG.w - 16);
    t = Math.min(t, s.feet[1] - FIG.feet + 22);
    b = Math.max(b, s.feet[1] - FIG.feet + FIG.h - 4);
  }
  return { l: l - 4, t: t - 4, r: r + 4, b: b + 4 };
}

/** One composition, cropped to `box`, on the floor colour. */
function cellOf(v: View, rig: SeatRig, sitters: RigSitter[], box: ReturnType<typeof bounds>, flagged: Array<[number, number]> = []): Img {
  const W = box.r - box.l;
  const H = box.b - box.t;
  const c = composeRig(v.art, rig, sitters, { size: [W, H], origin: [-box.l, -box.t] });
  const img = blank(W, H, FLOOR, 255);
  paste(img, c.cell, 0, 0);
  // what the check flags, in red
  for (const [x, y] of flagged) plot(img, x - box.l, y - box.t, [255, 30, 30], 0.85);
  return img;
}

/** Sit-down → seated → stand-up on cushion 0 (seatRig.ts sitFrames: as WorldView moves a sitter). */
const motion = (v: View, rig: SeatRig) => sitFrames(v, rig, RIG_LOOKS[0]);

/** The 6× panel: the drawing on a checker, the front layer tinted, the pixel grid, polygons, hips, cover, silhouettes. */
function bigPanel(v: View, rig: SeatRig, Z = 6, plain = false, flagged: Array<[number, number]> = []): Img {
  const { px } = v.art;
  const PAD = 26;
  const img = blank(px.w * Z + PAD + 8, px.h * Z + PAD + 8, [34, 30, 42], 255);
  const X = (x: number) => PAD + x * Z;
  const Y = (y: number) => PAD + y * Z;
  const mask = frontMask(px.w, px.h, rig.front);
  const surface = rigSurface(v);
  // everyone seated (look 0): where their figure lies, as a faint silhouette under the grid
  const sitters = seatedSitters(v, rig, RIG_LOOKS, 0);
  const comp = composeRig(v.art, rig, sitters, { size: [px.w, px.h], origin: [0, 0], front: mask });
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) {
      const i = (y * px.w + x) * 4;
      const chk: RGB = (x + y) % 2 ? [62, 56, 72] : [54, 48, 64];
      let c: RGB = px.d[i + 3] ? [px.d[i], px.d[i + 1], px.d[i + 2]] : chk;
      if (!plain && mask[y * px.w + x] && px.d[i + 3]) c = [Math.round(c[0] * 0.55 + 0 * 0.45), Math.round(c[1] * 0.55 + 230 * 0.45), Math.round(c[2] * 0.55 + 255 * 0.45)];
      rect(img, X(x), Y(y), Z, Z, c);
      // where a sitter shows over the seat (outside the front layer): a light dot
      if (!plain && comp.who[y * px.w + x] >= 3) rect(img, X(x) + 2, Y(y) + 2, Z - 4, Z - 4, [255, 214, 90], 0.55);
      // the seat's surface as the checks read it: a green corner
      if (!plain && surface[y * px.w + x]) rect(img, X(x), Y(y), 2, 2, [60, 230, 90]);
    }
  if (!plain) for (const [x, y] of flagged) if (x >= 0 && y >= 0 && x < px.w && y < px.h) rect(img, X(x) + 1, Y(y) + 1, Z - 2, Z - 2, [255, 30, 30], 0.8);
  // grid: every px faint, every 10 px strong and labelled
  for (let x = 0; x <= px.w; x++) line(img, X(x), Y(0), X(x), Y(px.h), x % 10 ? [20, 18, 26] : [120, 110, 140]);
  for (let y = 0; y <= px.h; y++) line(img, X(0), Y(y), X(px.w), Y(y), y % 10 ? [20, 18, 26] : [120, 110, 140]);
  for (let x = 0; x <= px.w; x += 10) text(img, X(x) - 4, 4, String(x), INK, 2);
  for (let y = 0; y <= px.h; y += 10) text(img, 2, Y(y) - 4, String(y).padStart(3, ' '), INK, 2);
  if (plain) return img;
  // the footprint on the floor, and the cushion plane at the seat's height
  const { w, d } = placed(v.footprint, v.facing);
  const P = (x: number, y: number, z = 0) => worldToDrawing([v.art.ax, v.art.ay], x, y, z);
  for (const [z, c] of [
    [0, [240, 240, 255]],
    [v.seat, [140, 255, 160]],
  ] as Array<[number, RGB]>) {
    const q = [P(0, 0, z), P(w, 0, z), P(w, d, z), P(0, d, z)];
    q.forEach((a, i) => line(img, X(a[0]), Y(a[1]), X(q[(i + 1) % 4][0]), Y(q[(i + 1) % 4][1]), c, 1, 4));
  }
  // front polygons
  rig.front.forEach((g, pi) => {
    const poly = regionPts(g);
    // a region with a cover of its own is outlined orange and labelled with it (C- : no cap)
    const own = !Array.isArray(g) && g.cover !== undefined;
    const col: RGB = own ? [255, 160, 40] : [255, 60, 220];
    poly.forEach((a, i) => line(img, X(a[0]), Y(a[1]), X(poly[(i + 1) % poly.length][0]), Y(poly[(i + 1) % poly.length][1]), col, 2));
    poly.forEach((a) => rect(img, X(a[0]) - 3, Y(a[1]) - 3, 7, 7, col));
    const c = poly.reduce((s, a) => [s[0] + a[0] / poly.length, s[1] + a[1] / poly.length], [0, 0]);
    const label = `F${pi}${own ? ` C${(g as { cover: number | null }).cover ?? '-'}` : ''}`;
    if (inPoly(poly, c[0], c[1])) text(img, X(c[0]) - 3, Y(c[1]) - 5, label, [255, 255, 255], 2);
    else text(img, X(poly[0][0]) + 4, Y(poly[0][1]) + 4, label, [255, 255, 255], 2);
  });
  // hips, and each sitter's cover line
  rig.hips.forEach(([hx, hy], i) => {
    const x = X(hx);
    const y = Y(hy);
    line(img, x - 14, y, x + 14, y, [255, 230, 40], 2);
    line(img, x, y - 14, x, y + 14, [255, 230, 40], 2);
    text(img, x + 5, y + 5, `H${i}`, [255, 230, 40], 2);
    if (rig.cover !== undefined) line(img, X(Math.round(hx) - 24), Y(Math.round(hy) - rig.cover), X(Math.round(hx) + 24), Y(Math.round(hy) - rig.cover), [255, 150, 40], 2, 6);
  });
  return img;
}

/** Stack images top to bottom. */
function stack(blocks: Img[]): Img {
  const W = Math.max(...blocks.map((b) => b.w));
  const H = blocks.reduce((s, b) => s + b.h + 6, 0);
  const sheet = blank(W, H, [24, 20, 30], 255);
  let y = 0;
  for (const b of blocks) {
    paste(sheet, { w: b.w, h: b.h, d: b.d }, 0, y);
    y += b.h + 6;
  }
  return sheet;
}

function drawSheet(key: string, rigs: SeatRigs, out: string, perView?: (f: Facing, img: Img) => void) {
  const views = RIG_FACINGS.map((f) => ({ f, v: rigView(M, key, f) }));
  const blocks: Img[] = [];
  const header = blank(1400, 40, [24, 20, 30], 255);
  const p = profileOf(M, key);
  text(header, 8, 8, `${key}   ${p.sitStyle}  seat ${p.seat}${p.backrest ? '  backrest' : ''}${p.arms ? '  arms' : ''}`, INK, 3);
  blocks.push(header);
  for (const { f, v } of views) {
    const r = rigForView(rigs, key, f, { mirrored: v.mirrored, width: v.art.px.w });
    // a view drawn as its partner's mirror, with no rig of its own, is exactly its partner's mirrored: shown once
    if (r?.derived) continue;
    const first = blocks.length;
    const head = blank(1400, 30, [24, 20, 30], 255);
    if (!r) {
      text(head, 8, 8, `${f}: NO RIG (npx tsx scripts/seat-rig.ts --init ${key})`, BAD, 2);
      blocks.push(head);
      continue;
    }
    const rig = r.rig;
    const found = rigFindings(v, rig);
    const problems = found.problems;
    if (rig.drawing && rig.drawing !== v.print) problems.unshift('the drawing changed since it was rigged');
    const mirrorOf = RIG_FACINGS.find((g) => g !== f && rigView(M, key, g).mirrored && !rigs[key]?.[g] && rigForView(rigs, key, g, { mirrored: true, width: v.art.px.w })?.from === f);
    text(
      head,
      8,
      8,
      `${f}${fromBehind(f) ? ' (from behind)' : ' (from the front)'}${mirrorOf ? `  mirrored as ${mirrorOf}` : ''}   legs ${rig.legs}${rig.cover !== undefined ? `  cover ${rig.cover}` : ''}   ${rig.audited ? `audited ${rig.audited}` : 'NOT AUDITED'}`,
      rig.audited ? GOOD : [255, 200, 90],
      2,
    );
    blocks.push(head);
    if (problems.length) {
      const pb = blank(1400, 14 * problems.length + 4, [24, 20, 30], 255);
      problems.forEach((q, i) => text(pb, 16, 2 + i * 14, q, BAD, 2));
      blocks.push(pb);
    }
    // the seated results: every cushion taken, three looks, at play scale and 4×
    const cells1 = RIG_LOOKS.map((_, k) => seatedSitters(v, rig, RIG_LOOKS, k));
    const moves = motion(v, rig);
    const box = [...cells1, moves].reduce((b, s) => {
      const q = bounds(v, s);
      return { l: Math.min(b.l, q.l), t: Math.min(b.t, q.t), r: Math.max(b.r, q.r), b: Math.max(b.b, q.b) };
    }, bounds(v, []));
    const cells = cells1.map((s) => cellOf(v, rig, s, box, found.flagged));
    const annotated = bigPanel(v, rig, 6, false, found.flagged);
    // the drawing as it is, beside the annotated one (the front layer tinted, the sitters' pixels dotted)
    const bare = bigPanel(v, rig, 6, true);
    const big = blank(annotated.w * 2 + 8, annotated.h, [24, 20, 30], 255);
    paste(big, { w: bare.w, h: bare.h, d: bare.d }, 0, 0);
    paste(big, { w: annotated.w, h: annotated.h, d: annotated.d }, bare.w + 8, 0);
    const cw = cells[0].w;
    const ch = cells[0].h;
    const G = 12;
    const W = big.w + G + 3 * (cw + G) + 3 * (2 * cw + G);
    const H = Math.max(big.h, 2 * ch + 20);
    const row = blank(W, H, [24, 20, 30], 255);
    paste(row, { w: big.w, h: big.h, d: big.d }, 0, 0);
    let x = big.w + G;
    text(row, x, 2, 'PLAY SCALE (2X)', MUTED, 2);
    cells.forEach((c) => {
      paste(row, c, x, 16);
      x += cw + G;
    });
    text(row, x, 2, '4X', MUTED, 2);
    cells.forEach((c) => {
      paste(row, c, x, 16, 2);
      x += 2 * cw + G;
    });
    blocks.push(row);
    // sit down → seated → stand up (cushion 0, look 0), at play scale and at 2× that
    const film = moves.map((s) => cellOf(v, rig, [s, ...seatedSitters(v, rig, RIG_LOOKS, 1).slice(1)], box));
    const strip = blank(Math.max(W, film.length * (2 * cw + 4)), 2 * ch + ch + 26, [24, 20, 30], 255);
    text(strip, 4, 2, 'SIT DOWN > SEATED > STAND UP', MUTED, 2);
    film.forEach((c, i) => paste(strip, c, 4 + i * (cw + 4), 16));
    film.forEach((c, i) => paste(strip, c, 4 + i * (2 * cw + 4), 20 + ch, 2));
    blocks.push(strip);
    perView?.(f, stack(blocks.slice(first)));
  }
  writePng(out, stack(blocks));
}

/* ------------------------------------------------------------------ the check */

function check(rigs: SeatRigs): string[] {
  const out: string[] = [];
  for (const key of Object.keys(rigs)) if (!KEYS.includes(key)) out.push(`${key}: rigged, but no such seat in the catalog`);
  for (const key of KEYS) {
    for (const f of RIG_FACINGS) {
      const v = rigView(M, key, f);
      const r = rigForView(rigs, key, f, { mirrored: v.mirrored, width: v.art.px.w });
      if (!r) {
        out.push(`${key} ${f}: no rig${v.mirrored ? ` (nor for ${f === 'se' ? 'sw' : f === 'sw' ? 'se' : f === 'ne' ? 'nw' : 'ne'}, whose mirror it is)` : ''}`);
        continue;
      }
      const src = r.derived ? `${key} ${r.from}` : `${key} ${f}`;
      if (!r.rig.audited) out.push(`${src}: not audited (read its sheet: npx tsx scripts/seat-rig.ts --sheet ${key})`);
      if (!r.rig.drawing) out.push(`${src}: no drawing fingerprint (--audit stamps it)`);
      else if (r.rig.drawing !== v.print) out.push(`${src}: the drawing changed since it was rigged: redo the rig and audit it again`);
      for (const p of checkRigView(v, r.rig)) out.push(`${key} ${f}${r.derived ? ` (mirrored from ${r.from})` : ''}: ${p}`);
    }
  }
  return [...new Set(out)];
}

/* ------------------------------------------------------------------ commands */

if (process.argv.includes('--init')) {
  const keys = pick(arg('--init'));
  const force = process.argv.includes('--force');
  const made = withRigs((rigs) => {
    const n: string[] = [];
    for (const key of keys)
      for (const f of ownFacings(M, key)) {
        if (rigs[key]?.[f] && !force) continue;
        (rigs[key] ??= {})[f] = seed(key, f);
        n.push(`${key} ${f}`);
      }
    return n;
  });
  console.log(made.length ? `seeded ${made.length} view(s): ${made.join(', ')}` : 'nothing to seed (--force to reseed)');
} else if (process.argv.includes('--sheet')) {
  const keys = pick(arg('--sheet'));
  const rigs = readRigs();
  const dir = 'art/review/rigs';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const key of keys) {
    const out = `${dir}/${key}.png`;
    // --views: each view on its own as well (art/review/rigs/views/<key>.<facing>.png), for close reading
    const views = process.argv.includes('--views') ? `${dir}/views` : null;
    if (views && !existsSync(views)) mkdirSync(views, { recursive: true });
    drawSheet(key, rigs, out, views ? (f, img) => writePng(`${views}/${key}.${f}.png`, img) : undefined);
    console.log(out);
  }
} else if (process.argv.includes('--set')) {
  // --set KEY:FACING '{"hips": …, "front": …, "cover": n | null, "legs": …}': change a view's rig (unaudits it)
  const [key, facing] = (arg('--set') ?? '').split(':') as [string, Facing];
  if (!KEYS.includes(key) || !RIG_FACINGS.includes(facing)) throw new Error('--set KEY:FACING JSON');
  const patch = JSON.parse(process.argv[process.argv.indexOf('--set') + 2]) as Partial<Record<keyof SeatRig, unknown>>;
  withRigs((rigs) => {
    const g: SeatRig = { ...(rigs[key]?.[facing] ?? { hips: [], front: [], legs: fromBehind(facing) ? 'hide' : 'show' }) };
    const next = { ...g, ...patch } as SeatRig & { cover?: number | null };
    if (next.cover === null) delete next.cover;
    delete next.audited;
    next.drawing = rigView(M, key, facing).print;
    (rigs[key] ??= {})[facing] = tidyRig(next as SeatRig);
  });
  console.log(`${key} ${facing}: set`);
} else if (process.argv.includes('--audit')) {
  const [key, facing] = (arg('--audit') ?? '').split(':');
  if (!KEYS.includes(key)) throw new Error(`no seat ${key}`);
  const stamped = withRigs((rigs) => {
    const n: string[] = [];
    for (const f of facing ? [facing as Facing] : RIG_FACINGS) {
      const g = rigs[key]?.[f];
      if (!g) continue;
      g.audited = today();
      g.drawing = rigView(M, key, f).print;
      rigs[key][f] = tidyRig(g);
      n.push(f);
    }
    return n;
  });
  console.log(`${key}: audited ${stamped.join(', ') || 'nothing (no rig)'}`);
} else if (process.argv.includes('--list')) {
  const rigs = readRigs();
  for (const key of KEYS) {
    const views = RIG_FACINGS.map((f) => {
      const v = rigView(M, key, f);
      const r = rigForView(rigs, key, f, { mirrored: v.mirrored, width: v.art.px.w });
      return `${f}:${!r ? '—' : r.derived ? `=${r.from}` : r.rig.audited ? 'ok' : 'draft'}`;
    });
    console.log(key.padEnd(20), views.join('  '));
  }
} else {
  const problems = check(readRigs());
  for (const p of problems) console.log('  !', p);
  console.log(`${KEYS.length} seat kinds × 4 facings: ${problems.length ? `${problems.length} problem(s)` : 'every view rigged, audited and holding'}`);
  process.exit(problems.length ? 1 : 0);
}
