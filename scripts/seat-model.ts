/**
 * Seat models (src/shared/world/seatModels.ts, art/seat-models.json): every seat's 3D proxy, fitted to its drawings,
 * shown and checked. People are drawn into seats in layers worked out from it (src/client/engine/sprites/seatLayers.ts).
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
 *        the seat check (sprites/seatLayers.ts seatProblems, the gate's: scripts/seat-layers.ts --check): the model's
 *        silhouette fits every drawing (IoU ≥ 0.8), every cushion has a sitting point, on its cushion seen from the
 *        front, the legs stay above the floor and come off the cushion's front, and from behind a seat with a back hides
 *        something of its sitters.
 *   --review KEY          the lead reviewer passes a model (stamps the day and its drawings' fingerprints)
 *   --list                every seat kind and its model's state
 *
 * All writes go through art/seat-models.json's lock, one key at a time (scripts/lib/models.ts withModels): agents
 * working on different seats never clobber each other.
 */
import { existsSync, mkdirSync } from 'node:fs';
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
import { filledSilhouette, proxySilhouette, seatDepth, silhouetteFit } from '../src/client/engine/sprites/seatModel';
import { composeSeat, seatLayers, seatProblems } from '../src/client/engine/sprites/seatLayers';
import { familyOf, fitModel, placeSits } from '../src/client/engine/sprites/seatModelFit';
import { loadManifest } from './lib/manifest';
import { blank, writePng, type Img } from './lib/png';
import { text } from './lib/font';
import { line, paste, plot, rect, row, stack, type RGB } from './lib/draw';
import { modelView, readModels, withModels } from './lib/models';
import { profileOf, seatKeys, viewArt, type Sprites } from './lib/seats';

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
  const views = MODEL_FACINGS.map((f) => ({ facing: f, art: viewArt(M, key, f).art }));
  // the model's own sitting points, as hints for where along a long seat each cushion is
  const hintU = (readModels()[key]?.sits ?? []).map((s) => s[0]);
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

/** A view with look k, k + 1, … on its cushions, composed as the game draws it (seatLayers.ts composeSeat), on the floor. */
function cellOf(v: View, k: number): Img {
  const cushions = seatLayers(v).sits.length;
  const c = composeSeat(
    v,
    Array.from({ length: cushions }, (_, i) => ({ look: SEAT_LOOKS[(k + i) % SEAT_LOOKS.length], cushion: i })),
    40,
  );
  const img = blank(c.px.w, c.px.h, FLOOR, 255);
  paste(img, { w: c.px.w, h: c.px.h, d: c.px.d }, 0, 0);
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
    const fit = silhouetteFit(v);
    const problems = seatProblems(v);
    const head = blank(1600, 30, BG, 255);
    const tops = fit.tops.map((t) => `${t.kind}${t.part} ${Math.round(t.within * 100)}%`).join(' ') || '-';
    text(head, 8, 8, `${f}${f === 'ne' || f === 'nw' ? ' (from behind)' : ' (from the front)'}${v.mirrored ? '  (drawing mirrored)' : ''}   IoU ${fit.iou.toFixed(3)}   tops ${tops}   ${problems.length ? `${problems.length} problem(s)` : 'holds'}`, problems.length ? [255, 200, 90] : GOOD, 2);
    blocks.push(head);
    if (problems.length) {
      const pb = blank(1600, 14 * problems.length + 4, BG, 255);
      problems.forEach((q, i) => text(pb, 16, 2 + i * 14, q, BAD, 2));
      blocks.push(pb);
    }
    const cells = SEAT_LOOKS.map((_, k) => cellOf(v, k));
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
    for (const f of MODEL_FACINGS) for (const p of seatProblems(modelView(M, key, f, m))) out.push(`${key} ${f}: ${p}`);
  }
  return [...new Set(out)];
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
    const v = modelView(M, key, f, m);
    const fit = silhouetteFit(v);
    const tops = fit.tops.map((t) => `${t.kind}${t.part} ${Math.round(t.within * 100)}% (worst ${t.worst})`).join(', ') || '-';
    console.log(`  ${f}  IoU ${fit.iou.toFixed(3)}  tops ${tops}${m.views?.[f] ? `  own sitting points ${JSON.stringify(m.views[f])}` : ''}${m.over?.[f] ? '  traced over layer' : ''}`);
    for (const q of seatProblems(v)) console.log(`      ! ${q}`);
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
    if (patch.views !== undefined) m.views = patch.views ?? undefined;
    if (patch.over !== undefined) m.over = patch.over ?? undefined;
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
} else {
  const i = process.argv.indexOf('--check');
  const only = (i >= 0 ? process.argv.slice(i + 1) : []).filter((a) => !a.startsWith('--')).flatMap((a) => a.split(','));
  const keys = only.length ? only.filter((k) => KEYS.includes(k) || (console.error(`no seat ${k}`), false)) : KEYS;
  const problems = check(readModels(), keys);
  for (const p of problems) console.log('  !', p);
  console.log(`${keys.length} seat kind(s) × 4 facings: ${problems.length ? `${problems.length} problem(s)` : 'every seat modelled and holding'}`);
  process.exit(problems.length ? 1 : 0);
}
