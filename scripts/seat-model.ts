/**
 * Seat models (src/shared/world/seatModels.ts, art/seat-models.json): every seat's 3D proxy, fitted to its drawings,
 * shown and checked. People are drawn into seats by z-buffer against it (src/client/engine/sprites/seatModel.ts).
 * How to fit one: docs/furniture.md, "Seat models: how to fit one". Every KEY argument takes a comma list.
 *
 *   --fit KEY|all [--refine] [--force]
 *        seed a proxy from the drawings: the family's boxes fitted to every facing's silhouette, the cushion at the
 *        seat profile's height. A fit is never reviewed (it clears `reviewed`). --refine fits the model already there
 *        further (keeping its sitting points); --force refits from scratch.
 *   --show KEY            the model, and per facing its IoU, top edges and problems (the quick loop, no pictures)
 *   --set KEY '{json}'    replace fields of a model: size, parts, sits, note (clears `reviewed`)
 *   --part KEY:I '{json}' change part I (its part, u, v or z); KEY:+ adds a part; null for the JSON deletes part I
 *   --sit KEY:I '[u, v, z]'   move cushion I's sitting point; --sit KEY auto sits every one by the standard (back
 *                         against the backrest, the middle of a backless seat)
 *   --sheet KEY|all [--views]
 *        art/review/models/<key>.png (and with --views, art/review/models/views/<key>.<facing>.png), per facing: the
 *        drawing at 6× with the proxy's boxes (colour by part, hidden edges dashed) and the sitting points; the
 *        silhouette fit; the depth map as a heatmap; the result at play scale (2×) and 4× for three looks, every
 *        cushion taken; and sit-down → seated → stand-up
 *   --check [KEY]
 *        the gate (exit 1 on any problem): (a) the proxy's silhouette matches each drawing (IoU ≥ 0.85; the tops of
 *        backs and arms within 2 px); (b) sitting points on the cushion top, the pelvis 0–0.12 tile in front of the back's front face
 *        (centred ±0.1 on a backless seat);
 *        (c) no seat pixel drawn over a person where it's behind them (z-buffer self-check); (d) forearms resting on an
 *        armrest show; (e) from behind, head and shoulders show over a back lower than the shoulders; (f) no
 *        see-through pixels in a seated person; (g) every seat kind used anywhere has a model, reviewed on the
 *        drawings it has now; (h) no part but the cushion under a sitter stands inside their body (torso to the
 *        shoulders, thighs to the knees). Plus, from the front: head and shoulders show, legs come off the seat.
 *   --probe [KEY]
 *        live == sheet: every capture the in-game spec took (tests/e2e/seat-models.spec.ts →
 *        art/review/models-live/raw/*.png + .json) against the same seat, look and cushion composed here
 *   --review KEY          the lead reviewer passes a model (stamps the day and its drawings' fingerprints)
 *   --list                every seat kind and its model's state
 *
 * All writes go through art/seat-models.json's lock, one key at a time (scripts/lib/models.ts withModels): agents
 * working on different seats never clobber each other.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import type { AvatarLoadout } from '../src/shared/domain/types';
import type { Facing } from '../src/shared/world/scene';
import {
  boxEdges,
  drawingAt,
  MODEL_FACINGS,
  modelShapeProblems,
  nearness,
  PART_KINDS,
  placedSize,
  projectLocal,
  SEAT_LOOKS,
  sitsByCushion,
  tidyModel,
  type ModelPart,
  type PartKind,
  type SeatModel,
  type SeatModels,
  type SitPoint,
} from '../src/shared/world/seatModels';
import { FIG, figAx, rigForView } from '../src/shared/world/seatRigs';
import { composeModel, filledSilhouette, modelFindings, modelSitFrames, modelSitters, proxySilhouette, seatDepth, type ModelSitter } from '../src/client/engine/sprites/seatModel';
import { familyOf, fitModel, placeSits } from '../src/client/engine/sprites/seatModelFit';
import { loadManifest } from './lib/manifest';
import { blank, readPng, writePng, type Img } from './lib/png';
import { text } from './lib/font';
import { line, paste, plot, rect, row, stack, type RGB } from './lib/draw';
import { modelView, readModels, withModels } from './lib/models';
import { profileOf, readRigs, rigView, seatKeys, type Sprites } from './lib/rigs';

const M = loadManifest().sprites as unknown as Sprites;
const KEYS = seatKeys(M);
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const pick = (v: string | undefined) =>
  !v || v === 'all' || v.startsWith('--')
    ? KEYS
    : v
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k && (KEYS.includes(k) || (console.error(`no seat ${k}`), false)));
const today = () => new Date().toISOString().slice(0, 10);

const INK: RGB = [246, 234, 214];
const MUTED: RGB = [150, 140, 160];
const BAD: RGB = [240, 90, 80];
const GOOD: RGB = [120, 220, 140];
const FLOOR: RGB = [201, 164, 126];
const BG: RGB = [24, 20, 30];
const PART_COLOUR: Record<PartKind, RGB> = {
  seat: [90, 235, 120],
  back: [255, 80, 220],
  arm: [255, 170, 40],
  leg: [90, 210, 255],
  base: [120, 130, 255],
  wrap: [200, 120, 255],
  other: [255, 240, 90],
};

/* ------------------------------------------------------------------ fitting */

function fitInput(key: string) {
  const e = M[key];
  const p = profileOf(M, key);
  const views = MODEL_FACINGS.map((f) => ({ facing: f, art: rigView(M, key, f).art }));
  // the old rigs' hips (seen from behind, facing ne: u = x), as hints for where along a long seat each cushion is
  // (their depth is what was wrong, and a one-cushion seat's is its middle)
  const hintU: number[] = [];
  const v = rigView(M, key, 'ne');
  const r = rigForView(readRigs(), key, 'ne', { mirrored: v.mirrored, width: v.art.px.w })?.rig;
  if (r) for (const [hx, hy] of r.hips) hintU.push(drawingAt([v.art.ax, v.art.ay], hx, hy, p.seat).x);
  return {
    key,
    size: [e.footprint[0], e.footprint[1]] as [number, number],
    seat: p.seat,
    style: p.sitStyle,
    backrest: p.backrest,
    arms: !!p.arms,
    views,
    hintU: hintU.length > 1 && hintU.length === Math.round(e.footprint[0]) ? hintU.sort((a, b) => a - b) : undefined,
  };
}

/* ------------------------------------------------------------------ the sheet */

type View = ReturnType<typeof modelView>;

/** The bounds (drawing px) of a view with everyone seated. */
function bounds(v: View, sitters: ModelSitter[]) {
  let l = 0;
  let t = 0;
  let r = v.art.px.w;
  let b = v.art.px.h;
  for (const s of sitters) {
    const x0 = s.feet[0] - figAx(s.facing);
    l = Math.min(l, x0 + 16);
    r = Math.max(r, x0 + FIG.w - 16);
    t = Math.min(t, s.feet[1] - FIG.feet + 22);
    b = Math.max(b, s.feet[1] - FIG.feet + FIG.h - 4);
  }
  return { l: l - 4, t: t - 4, r: r + 4, b: b + 4 };
}

function cellOf(v: View, sitters: ModelSitter[], box: ReturnType<typeof bounds>, flag = false): Img {
  const W = box.r - box.l;
  const H = box.b - box.t;
  const c = composeModel(v, sitters, { size: [W, H], origin: [-box.l, -box.t] });
  const img = blank(W, H, FLOOR, 255);
  paste(img, c.cell, 0, 0);
  if (flag) for (const [x, y] of c.flagged) plot(img, x, y, [255, 30, 30], 0.85);
  return img;
}

/** The 6× panel: the drawing on a checker, the proxy's box edges by part, the sitting points. */
function proxyPanel(v: View, Z = 6): Img {
  const { px } = v.art;
  const PAD = 26;
  const img = blank(px.w * Z + 2 * PAD, px.h * Z + 2 * PAD, [34, 30, 42], 255);
  const X = (x: number) => PAD + x * Z;
  const Y = (y: number) => PAD + y * Z;
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) {
      const i = (y * px.w + x) * 4;
      const chk: RGB = (x + y) % 2 ? [62, 56, 72] : [54, 48, 64];
      const c: RGB = px.d[i + 3] ? [px.d[i], px.d[i + 1], px.d[i + 2]] : chk;
      rect(img, X(x), Y(y), Z, Z, c);
    }
  for (let x = 0; x <= px.w; x += 10) text(img, X(x) - 4, 4, String(x), INK, 2);
  for (let y = 0; y <= px.h; y += 10) text(img, 2, Y(y) - 4, String(y).padStart(3, ' '), INK, 2);
  // the footprint on the floor
  const { w, d } = placedSize(v.model.size, v.facing);
  const P = (x: number, y: number) => [v.art.ax + 32 * (x - y), v.art.ay + 16 * (x + y)];
  const q = [P(0, 0), P(w, 0), P(w, d), P(0, d)];
  q.forEach((a, i) => line(img, X(a[0]), Y(a[1]), X(q[(i + 1) % 4][0]), Y(q[(i + 1) % 4][1]), [240, 240, 255], 1, 4));
  // the boxes: hidden edges dashed, the rest solid; each numbered at its top
  v.model.parts.forEach((p, k) => {
    const col = PART_COLOUR[p.part];
    for (const e of boxEdges([v.art.ax, v.art.ay], v.model.size, v.facing, p)) line(img, X(e.a[0]), Y(e.a[1]), X(e.b[0]), Y(e.b[1]), col, e.hidden ? 1 : 2, e.hidden ? 5 : 0);
    const [lx, ly] = projectLocal([v.art.ax, v.art.ay], v.model.size, v.facing, (p.u[0] + p.u[1]) / 2, (p.v[0] + p.v[1]) / 2, p.z[1]);
    text(img, X(lx) - 4, Y(ly) - 6, String(k), col, 2);
  });
  // the sitting points, and their foot on the floor
  sitsByCushion(v.model, v.facing).forEach((s, i) => {
    if (!s) return;
    const [hx, hy] = projectLocal([v.art.ax, v.art.ay], v.model.size, v.facing, s[0], s[1], s[2]);
    const [fx, fy] = projectLocal([v.art.ax, v.art.ay], v.model.size, v.facing, s[0], s[1], 0);
    line(img, X(fx), Y(fy), X(hx), Y(hy), [255, 230, 40], 1, 3);
    line(img, X(hx) - 12, Y(hy), X(hx) + 12, Y(hy), [255, 230, 40], 3);
    line(img, X(hx), Y(hy) - 12, X(hx), Y(hy) + 12, [255, 230, 40], 3);
    text(img, X(hx) + 6, Y(hy) + 6, `S${i}`, [255, 230, 40], 2);
  });
  // a legend
  let lx = PAD;
  for (const k of [...new Set(v.model.parts.map((p) => p.part))]) {
    rect(img, lx, img.h - 18, 10, 10, PART_COLOUR[k]);
    lx = text(img, lx + 14, img.h - 18, k, INK, 2) + 10;
  }
  return img;
}

/** The silhouette fit at 3×: both (grey), the drawing only (red), the proxy only (blue). */
function fitPanel(v: View, Z = 3): Img {
  const { px } = v.art;
  const S = filledSilhouette(px);
  const P = proxySilhouette(v).mask;
  const img = blank(px.w * Z, px.h * Z, [34, 30, 42], 255);
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) {
      const i = y * px.w + x;
      const c: RGB | null = S[i] && P[i] ? [120, 116, 130] : S[i] ? [235, 70, 60] : P[i] ? [70, 120, 245] : null;
      if (c) rect(img, x * Z, y * Z, Z, Z, c);
    }
  return img;
}

/** The depth map at 3×: nearness to the camera (blue far … red near); outside every box, hatched. */
function depthPanel(v: View, Z = 3): Img {
  const { px, ax, ay } = v.art;
  const D = seatDepth(v);
  const img = blank(px.w * Z, px.h * Z, [34, 30, 42], 255);
  const N = new Float32Array(px.w * px.h).fill(NaN);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) {
      const i = y * px.w + x;
      if (Number.isNaN(D.z[i])) continue;
      const w = drawingAt([ax, ay], x + 0.5, y + 0.5, D.z[i]);
      const n = nearness(w.x, w.y, D.z[i]);
      N[i] = n;
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    }
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) {
      const i = y * px.w + x;
      if (Number.isNaN(N[i])) continue;
      rect(img, x * Z, y * Z, Z, Z, heat(hi > lo ? (N[i] - lo) / (hi - lo) : 0.5));
      if (D.how[i] === 2) for (let k = 0; k < Z; k++) plot(img, x * Z + k, y * Z + k, [20, 20, 20], 0.6);
    }
  return img;
}

function heat(t: number): RGB {
  const stops: RGB[] = [
    [40, 60, 200],
    [60, 190, 230],
    [120, 230, 120],
    [250, 220, 60],
    [240, 70, 50],
  ];
  const s = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(s));
  const k = s - i;
  return [0, 1, 2].map((c) => Math.round(stops[i][c] * (1 - k) + stops[i + 1][c] * k)) as RGB;
}

function labelled(label: string, img: Img): Img {
  const out = blank(Math.max(img.w, label.length * 8 + 4), img.h + 16, BG, 255);
  text(out, 0, 2, label, MUTED, 2);
  paste(out, img, 0, 16);
  return out;
}

function sheetFor(key: string, models: SeatModels, perView?: (f: Facing, img: Img) => void): Img {
  const m = models[key];
  const blocks: Img[] = [];
  const header = blank(1600, 44, BG, 255);
  const p = profileOf(M, key);
  const state = !m ? 'NO MODEL' : m.reviewed ? `reviewed ${m.reviewed}` : 'NOT REVIEWED';
  text(header, 8, 6, `${key}   ${familyOf(key)}  ${p.sitStyle}  size ${m?.size.join('x') ?? '?'}   ${state}`, m?.reviewed ? GOOD : [255, 200, 90], 3);
  if (m) text(header, 8, 30, `sits ${m.sits.map((s) => `[${s.join(', ')}]`).join(' ')}${m.note ? `   ${m.note}` : ''}`, MUTED, 2);
  blocks.push(header);
  if (!m) return stack(blocks);
  for (const f of MODEL_FACINGS) {
    const v = modelView(M, key, f, m);
    const first = blocks.length;
    const found = modelFindings(v, SEAT_LOOKS);
    const head = blank(1600, 30, BG, 255);
    const tops = found.fit.tops.map((t) => `${t.kind}${t.part} ${Math.round(t.within * 100)}%`).join(' ') || '-';
    text(head, 8, 8, `${f}${f === 'ne' || f === 'nw' ? ' (from behind)' : ' (from the front)'}${v.mirrored ? '  (drawing mirrored)' : ''}   IoU ${found.fit.iou.toFixed(3)}   tops ${tops}   ${found.problems.length ? `${found.problems.length} problem(s)` : 'holds'}`, found.problems.length ? [255, 200, 90] : GOOD, 2);
    blocks.push(head);
    if (found.problems.length) {
      const pb = blank(1600, 14 * found.problems.length + 4, BG, 255);
      found.problems.forEach((q, i) => text(pb, 16, 2 + i * 14, q, BAD, 2));
      blocks.push(pb);
    }
    const cells1 = SEAT_LOOKS.map((_, k) => modelSitters(v, SEAT_LOOKS, k));
    const moves = modelSitFrames(v, SEAT_LOOKS[0]);
    const box = [...cells1, moves].reduce(
      (b, s) => {
        const q = bounds(v, s);
        return { l: Math.min(b.l, q.l), t: Math.min(b.t, q.t), r: Math.max(b.r, q.r), b: Math.max(b.b, q.b) };
      },
      bounds(v, []),
    );
    const cells = cells1.map((s) => cellOf(v, s, box, true));
    const side = stack([labelled('SILHOUETTE: both / drawing only (red) / proxy only (blue)', fitPanel(v)), labelled('DEPTH: far (blue) to near (red); hatched = outside the boxes', depthPanel(v))], BG, 8);
    const results = blank(cells.reduce((s, c) => s + c.w * 2 + 12, 0) + 12, cells[0].h * 3 + 44, BG, 255);
    text(results, 0, 2, 'PLAY SCALE (2X)', MUTED, 2);
    let x = 0;
    for (const c of cells) {
      paste(results, c, x, 16);
      x += c.w + 12;
    }
    text(results, 0, cells[0].h + 22, '4X', MUTED, 2);
    x = 0;
    for (const c of cells) {
      paste(results, c, x, cells[0].h + 36, 2);
      x += 2 * c.w + 12;
    }
    blocks.push(row([proxyPanel(v), side, results]));
    const others = modelSitters(v, SEAT_LOOKS, 1).slice(1);
    const film = moves.map((s) => cellOf(v, [s, ...others], box));
    const cw = film[0]?.w ?? 1;
    const ch = film[0]?.h ?? 1;
    const strip = blank(Math.max(1600, film.length * (2 * cw + 4)), 3 * ch + 26, BG, 255);
    text(strip, 4, 2, 'SIT DOWN > SEATED > STAND UP', MUTED, 2);
    film.forEach((c, i) => paste(strip, c, 4 + i * (cw + 4), 16));
    film.forEach((c, i) => paste(strip, c, 4 + i * (2 * cw + 4), 20 + ch, 2));
    blocks.push(strip);
    perView?.(f, stack(blocks.slice(first)));
  }
  return stack(blocks);
}

/* ------------------------------------------------------------------ the check */

/** Every seat kind anything seats people on (the scenes' and the catalog's), in all four facings. */
function check(models: SeatModels, keys = KEYS): string[] {
  const out: string[] = [];
  if (keys === KEYS) for (const key of Object.keys(models)) if (!KEYS.includes(key)) out.push(`${key}: a model, but no such seat in the catalog`);
  for (const key of keys) {
    const m = models[key];
    const e = M[key];
    const cushions = Math.round(e.footprint[0] * e.footprint[1]);
    if (!m) {
      out.push(`${key}: (g) no model (npx tsx scripts/seat-model.ts --fit ${key})`);
      continue;
    }
    const shape = modelShapeProblems(m, cushions);
    if (shape.length) {
      for (const s of shape) out.push(`${key}: ${s}`);
      continue;
    }
    if (m.size[0] !== e.footprint[0] || m.size[1] !== e.footprint[1]) out.push(`${key}: the model is ${m.size.join('×')}, the catalog's footprint ${e.footprint.join('×')}`);
    if (!m.reviewed) out.push(`${key}: (g) not reviewed (read art/review/models/${key}.png and art/review/models-live/${key}-*.png)`);
    for (const f of MODEL_FACINGS) {
      const v = modelView(M, key, f, m);
      if (m.reviewed && m.drawings?.[f] !== v.print) out.push(`${key} ${f}: (g) the drawing changed since the model was reviewed`);
      for (const p of modelFindings(v, SEAT_LOOKS).problems) out.push(`${key} ${f}: ${p}`);
    }
  }
  return [...new Set(out)];
}

/* ------------------------------------------------------------------ the live probe */

/**
 * Every capture the in-game spec took, against the same composition here. A capture is the live canvas at play
 * scale around a seat, on the seat drawing's own pixel grid: raw/<key>-<facing>-L<look>-C<cushion>.png and .json
 * { key, facing, look, cushion, origin: [x, y] (the drawing's (0, 0) in the capture) }. The room's light is read off
 * the seat's own pixels (a gain per channel, from pixels only the seat covers), then every pixel the composition
 * has — the seat's, the person's, the seat's drawn over them — is compared: within 6 of 255 per channel is the same.
 */
function probe(keys: string[]): { lines: string[]; bad: number; seen: number } {
  const dir = 'art/review/models-live/raw';
  const lines: string[] = [];
  let bad = 0;
  let seen = 0;
  if (!existsSync(dir)) return { lines: [`no captures in ${dir}: run the in-game spec first (tests/e2e/seat-models.spec.ts)`], bad: 1, seen };
  const models = readModels();
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const meta = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')) as { key: string; facing: Facing; look: number; cushion: number; origin: [number, number]; loadout?: AvatarLoadout };
    if (!keys.includes(meta.key)) continue;
    seen++;
    const live = readPng(`${dir}/${name.replace(/\.json$/, '.png')}`);
    const m = models[meta.key];
    if (!m) {
      lines.push(`${name}: no model for ${meta.key}`);
      bad++;
      continue;
    }
    const v = modelView(M, meta.key, meta.facing, m);
    const s = modelSitters(v, SEAT_LOOKS, 0)[meta.cushion];
    if (!s) continue;
    // the look as the bot wore it (the server swaps out what a bot hasn't unlocked)
    const c = composeModel(v, [{ ...s, look: meta.loadout ?? SEAT_LOOKS[meta.look] }], { size: [live.w, live.h], origin: meta.origin });
    // the room's light: the median ratio live / drawn over the seat's own pixels, per channel
    const ratios: number[][] = [[], [], []];
    for (let i = 0; i < live.w * live.h; i++) if (c.who[i] === 1) for (let k = 0; k < 3; k++) if (c.cell.d[i * 4 + k] > 24) ratios[k].push(live.d[i * 4 + k] / c.cell.d[i * 4 + k]);
    const lit = ratios.map((r) => (r.length ? r.sort((a, b) => a - b)[r.length >> 1] : 1));
    let n = 0;
    let diff = 0;
    let person = 0;
    let personDiff = 0;
    const mask = blank(live.w, live.h, [0, 0, 0], 255);
    for (let i = 0; i < live.w * live.h; i++) {
      if (!c.who[i]) continue;
      n++;
      let e = 0;
      for (let k = 0; k < 3; k++) e = Math.max(e, Math.abs(live.d[i * 4 + k] - Math.min(255, Math.round(c.cell.d[i * 4 + k] * lit[k]))));
      const off = e > 6;
      if (off) diff++;
      if (c.who[i] >= 2) {
        person++;
        if (off) personDiff++;
      }
      mask.d.set(off ? [255, 40, 40, 255] : [c.cell.d[i * 4] >> 1, c.cell.d[i * 4 + 1] >> 1, c.cell.d[i * 4 + 2] >> 1, 255], i * 4);
    }
    const ok = n > 0 && personDiff <= Math.max(2, person * 0.005) && diff / n <= 0.01;
    if (!ok) bad++;
    writePng(`${dir}/${name.replace(/\.json$/, '.diff.png')}`, mask);
    lines.push(`${ok ? 'same   ' : 'DIFFERS'}  ${name.replace(/\.json$/, '')}: ${personDiff}/${person} px of the person (and the seat over them) differ, ${diff}/${n} in all  (light ${lit.map((q) => q.toFixed(2)).join(' ')})`);
  }
  return { lines, bad, seen };
}

/* ------------------------------------------------------------------ editing (one key at a time, under the lock) */

/** Change one seat's model under the lock; a changed model is no longer reviewed. */
function edit(key: string, fn: (m: SeatModel) => void) {
  if (!KEYS.includes(key)) throw new Error(`no seat ${key}`);
  withModels((ms) => {
    const m = ms[key];
    if (!m) throw new Error(`${key}: no model yet (--fit ${key})`);
    fn(m);
    delete m.reviewed;
    delete m.drawings;
    const e = M[key];
    const problems = modelShapeProblems(m, Math.round(e.footprint[0] * e.footprint[1]));
    if (problems.length) throw new Error(`${key}: ${problems.join('; ')}`);
    ms[key] = tidyModel(m);
  });
}

/** One seat's state in text: its parts, sitting points, and per facing its fit and problems. */
function show(key: string) {
  const m = readModels()[key];
  if (!m) {
    console.log(`${key}: no model`);
    return;
  }
  console.log(`${key}  size ${m.size.join('x')}  ${m.reviewed ? `reviewed ${m.reviewed}` : 'not reviewed'}${m.note ? `  "${m.note}"` : ''}`);
  m.parts.forEach((p, i) => console.log(`  ${String(i).padStart(2)} ${p.part.padEnd(5)} u [${p.u.join(', ')}]  v [${p.v.join(', ')}]  z [${p.z.join(', ')}]`));
  m.sits.forEach((s, i) => console.log(`  sit ${i}: [${s.join(', ')}]`));
  for (const f of MODEL_FACINGS) {
    const found = modelFindings(modelView(M, key, f, m), SEAT_LOOKS);
    const tops = found.fit.tops.map((t) => `${t.kind}${t.part} ${Math.round(t.within * 100)}% (worst ${t.worst})`).join(', ') || '-';
    console.log(`  ${f}  IoU ${found.fit.iou.toFixed(3)}  tops ${tops}`);
    for (const q of found.problems) console.log(`      ! ${q}`);
  }
}

/** The JSON argument after a command. */
function jsonAfter(name: string): unknown {
  const t = process.argv[process.argv.indexOf(name) + 2];
  if (t === undefined) throw new Error(`${name}: the JSON argument is missing`);
  return JSON.parse(t) as unknown;
}

/* ------------------------------------------------------------------ commands */

const cmd = (name: string) => process.argv.includes(name);

if (cmd('--fit')) {
  const refine = cmd('--refine');
  const force = cmd('--force');
  for (const key of pick(arg('--fit'))) {
    const had = readModels()[key];
    if (had && !refine && !force) {
      console.log(`${key}: has a model (--refine to fit it further, --force to refit from scratch)`);
      continue;
    }
    const t0 = Date.now();
    const r = fitModel(fitInput(key), refine && had ? had.parts : undefined);
    const model: SeatModel = { ...r.model, sits: refine && had ? had.sits : r.model.sits, fitted: today(), ...(had?.note ? { note: had.note } : {}) };
    withModels((ms) => {
      ms[key] = tidyModel(model);
    });
    console.log(`${key}: fitted in ${((Date.now() - t0) / 1000).toFixed(1)}s  IoU ${MODEL_FACINGS.map((f) => `${f} ${r.ious[f]?.toFixed(3)}`).join('  ')}`);
  }
} else if (cmd('--show')) {
  for (const key of pick(arg('--show'))) show(key);
} else if (cmd('--set')) {
  const key = arg('--set') ?? '';
  const patch = jsonAfter('--set') as Partial<SeatModel>;
  edit(key, (m) => {
    if (patch.size) m.size = patch.size;
    if (patch.parts) m.parts = patch.parts;
    if (patch.sits) m.sits = patch.sits;
    if (patch.note !== undefined) m.note = patch.note || undefined;
  });
  show(key);
} else if (cmd('--part')) {
  const [key, which] = (arg('--part') ?? '').split(':');
  const patch = jsonAfter('--part') as Partial<ModelPart> | null;
  edit(key, (m) => {
    if (which === '+') {
      if (!patch || !PART_KINDS.includes(patch.part as PartKind) || !patch.u || !patch.v || !patch.z) throw new Error('a new part needs part, u, v and z');
      m.parts.push(patch as ModelPart);
      return;
    }
    const i = Number(which);
    if (!Number.isInteger(i) || !m.parts[i]) throw new Error(`${key}: no part ${which}`);
    if (patch === null) m.parts.splice(i, 1);
    else m.parts[i] = { ...m.parts[i], ...patch };
  });
  show(key);
} else if (cmd('--sit')) {
  const [key, which] = (arg('--sit') ?? '').split(':');
  if (which === undefined && process.argv[process.argv.indexOf('--sit') + 2] === 'auto') {
    edit(key, (m) => {
      m.sits = placeSits(m.parts, m.size, m.sits.length > 1 ? m.sits.map((s) => s[0]) : undefined);
    });
  } else {
    const s = jsonAfter('--sit') as SitPoint;
    edit(key, (m) => {
      const i = Number(which);
      if (!Number.isInteger(i) || i < 0 || i > m.sits.length) throw new Error(`${key}: no cushion ${which}`);
      m.sits[i] = s;
    });
  }
  show(key);
} else if (cmd('--sheet')) {
  const models = readModels();
  const dir = 'art/review/models';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const views = cmd('--views') ? `${dir}/views` : null;
  if (views && !existsSync(views)) mkdirSync(views, { recursive: true });
  for (const key of pick(arg('--sheet'))) {
    writePng(`${dir}/${key}.png`, sheetFor(key, models, views ? (f, im) => writePng(`${views}/${key}.${f}.png`, im) : undefined));
    console.log(`${dir}/${key}.png`);
  }
} else if (cmd('--review')) {
  const key = arg('--review') ?? '';
  if (!KEYS.includes(key)) throw new Error(`no seat ${key}`);
  withModels((ms) => {
    const m = ms[key];
    if (!m) throw new Error(`${key}: no model`);
    m.reviewed = today();
    m.drawings = Object.fromEntries(MODEL_FACINGS.map((f) => [f, modelView(M, key, f, m).print]));
  });
  console.log(`${key}: reviewed ${today()}`);
} else if (cmd('--list')) {
  const models = readModels();
  for (const key of KEYS) {
    const m = models[key];
    const probs = m ? check(models, [key]).filter((p) => !p.includes('(g) not reviewed')) : [];
    console.log(key.padEnd(20), !m ? 'no model' : `${m.reviewed ? `reviewed ${m.reviewed}` : 'not reviewed'}  ${probs.length ? `${probs.length} problem(s)` : 'holds'}`);
  }
} else if (cmd('--probe')) {
  const { lines, bad, seen } = probe(pick(arg('--probe')));
  for (const l of lines) console.log(l);
  console.log(!seen ? 'no captures for these seats' : bad ? `${bad} capture(s) differ from their sheet` : `every live capture (${seen}) matches its sheet`);
  process.exit(bad || !seen ? 1 : 0);
} else {
  const i = process.argv.indexOf('--check');
  const only = (i >= 0 ? process.argv.slice(i + 1) : []).filter((a) => !a.startsWith('--')).flatMap((a) => a.split(','));
  const keys = only.length ? only.filter((k) => KEYS.includes(k) || (console.error(`no seat ${k}`), false)) : KEYS;
  const problems = check(readModels(), keys);
  for (const p of problems) console.log('  !', p);
  console.log(`${keys.length} seat kind(s) × 4 facings: ${problems.length ? `${problems.length} problem(s)` : 'every seat modelled, reviewed and holding'}`);
  process.exit(problems.length ? 1 : 0);
}
