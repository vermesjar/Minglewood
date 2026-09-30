/**
 * Seat layers (src/client/engine/sprites/seatLayers.ts): for every seat kind, in all four facings, its drawing at 4×
 * with what goes over its sitters tinted red, each cushion's hip (green), knees (yellow) and feet (cyan) marked — the
 * layers and legs the game draws people with, straight from the seat's model.
 *
 *   node --no-maglev --import tsx scripts/seat-layers.ts [--keys a,b] [--out art/review/seat-layers] [--check]
 *
 * --check (the gate): every seat kind has a model that fits its drawings, a sitting point on each cushion, legs that
 * stay above the floor and hang clear of the seat, and (with a back) something that goes over its sitters from behind.
 *
 * One sheet per seat (art/review/seat-layers/<key>.png) and one of them all (art/review/seat-layers/all.png).
 */
import { mkdirSync } from 'node:fs';
import type { Facing } from '../src/shared/world/scene';
import { cushionTop, localToWorld, modelShapeProblems, projectLocal, type SeatModel } from '../src/shared/world/seatModels';
import { kneeV } from '../src/shared/world/sitLegs';
import { seatLayers } from '../src/client/engine/sprites/seatLayers';
import { silhouetteFit } from '../src/client/engine/sprites/seatModel';
import { loadManifest } from './lib/manifest';
import { modelView, readModels } from './lib/models';
import { seatKeys, type Sprites } from './lib/rigs';
import { blank, writePng, type Img } from './lib/png';
import { plot, rect, row, stack, type RGB } from './lib/draw';
import { text } from './lib/font';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const OUT = arg('out') ?? 'art/review/seat-layers';
const M = loadManifest().sprites as unknown as Sprites;
const models = readModels();
const keys = arg('keys')?.split(',') ?? seatKeys(M);
const FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];
const Z = 4;
mkdirSync(OUT, { recursive: true });

function mark(img: Img, x: number, y: number, c: RGB) {
  rect(img, x * Z - 3, y * Z - 3, 7, 7, [20, 16, 24]);
  rect(img, x * Z - 2, y * Z - 2, 5, 5, c);
}

function view(key: string, model: SeatModel, f: Facing): Img {
  const v = modelView(M, key, f, model);
  const L = seatLayers(v);
  const { px } = v.art;
  const pad = 16;
  const img = blank(px.w * Z, px.h * Z + pad, [46, 40, 54], 255);
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++) {
      const i = y * px.w + x;
      if (!px.d[i * 4 + 3]) continue;
      let c: RGB = [px.d[i * 4], px.d[i * 4 + 1], px.d[i * 4 + 2]];
      if (L.over[i]) c = [Math.round(c[0] * 0.45 + 255 * 0.55), Math.round(c[1] * 0.45 + 40 * 0.55), Math.round(c[2] * 0.45 + 60 * 0.55)];
      rect(img, x * Z, y * Z + pad, Z, Z, c);
    }
  const anchor: [number, number] = [v.art.ax, v.art.ay];
  L.sits.forEach((s, i) => {
    const legs = L.legs[i];
    if (!s || !legs) return;
    const [hx, hy] = L.hips[i]!;
    const kv = kneeV(s, legs);
    const [kx, ky] = projectLocal(anchor, model.size, f, s[0], kv, s[2] + 1.5 + legs.rise);
    const fv = kv - legs.toe;
    const [fx, fy] = projectLocal(anchor, model.size, f, s[0], fv, s[2] + 1.5 + legs.rise - legs.drop);
    for (const [x, y, c] of [
      [hx, hy + pad / Z, [80, 230, 120]],
      [kx, ky + pad / Z, [250, 220, 60]],
      [fx, fy + pad / Z, [70, 220, 250]],
    ] as Array<[number, number, RGB]>)
      mark(img, x, y, c);
    // the floor point under the feet: where a standing person would put them (for the eye)
    const w = localToWorld(model.size, f, s[0], fv);
    void w;
    plot(img, fx * Z, (fy + pad / Z) * Z, [255, 255, 255]);
  });
  text(img, 4, 2, `${f}${v.mirrored ? ' (mirror)' : ''}`, [240, 230, 210], 2);
  return img;
}

/* ------------------------------------------------------------------ the check (the gate) */

/** A model's silhouette must cover each drawing this well (IoU against the drawing with its gaps filled). */
const FIT_MIN = 0.8;

function problemsOf(key: string, model: SeatModel | undefined): string[] {
  const e = M[key];
  if (!model) return [`${key}: no model (node --no-maglev --import tsx scripts/seat-model.ts --fit ${key})`];
  const out: string[] = [];
  const shape = modelShapeProblems(model);
  if (shape.length) return shape.map((p) => `${key}: ${p}`);
  if (model.size[0] !== e.footprint[0] || model.size[1] !== e.footprint[1]) out.push(`${key}: the model is ${model.size.join('×')}, the catalog footprint ${e.footprint.join('×')}`);
  for (const f of FACINGS) {
    const v = modelView(M, key, f, model);
    const fit = silhouetteFit(v);
    if (fit.iou < FIT_MIN) out.push(`${key} ${f}: the model's silhouette misses the drawing (IoU ${fit.iou.toFixed(2)} < ${FIT_MIN}): refit it (seat-model.ts --fit ${key} --force)`);
    const L = seatLayers(v);
    L.sits.forEach((s, i) => {
      if (!s) {
        out.push(`${key} ${f}: cushion ${i} has no sitting point over its tile`);
        return;
      }
      const top = cushionTop(model, s[0], s[1]);
      if (top === null || Math.abs(top - s[2]) > 0.5) out.push(`${key} ${f}: cushion ${i}'s sitting point isn't on the cushion (z ${s[2]}, cushion ${top ?? 'none'})`);
      const legs = L.legs[i]!;
      const kneeZ = s[2] + 1.5 + legs.rise;
      const sole = kneeZ - legs.drop;
      if (sole < -0.01) out.push(`${key} ${f}: cushion ${i}: the feet go through the floor (${sole.toFixed(1)})`);
      // the legs come off the front of the cushion they sit on: the knees clear of the cushion block under them
      const kv = kneeV(s, legs);
      const cushion = model.parts.filter((p) => p.part === 'seat' && s[0] >= p.u[0] && s[0] <= p.u[1] && s[1] >= p.v[0] && s[1] <= p.v[1] && p.z[1] >= s[2] - 0.5);
      const front = Math.min(...cushion.map((p) => p.v[0]));
      if (cushion.length && kv > front - 0.01) out.push(`${key} ${f}: cushion ${i}: the knees are inside the cushion (knees at v ${kv.toFixed(2)}, its front at ${front.toFixed(2)})`);
    });
    // from behind, a seat with a back hides some of its sitters (else its back isn't in the model)
    if ((f === 'ne' || f === 'nw') && model.parts.some((p) => p.part === 'back') && !L.over.some((x) => x)) out.push(`${key} ${f}: from behind, nothing of it goes over its sitters`);
  }
  return out;
}

if (process.argv.includes('--check')) {
  const all = keys.flatMap((k) => problemsOf(k, models[k]));
  for (const p of all) console.log(`  ! ${p}`);
  console.log(`${keys.length} seat kind(s) × 4 facings: ${all.length} problem(s)`);
  process.exit(all.length ? 1 : 0);
}

const sheets: Img[] = [];
for (const key of keys) {
  const model = models[key];
  if (!model) {
    console.log(`${key}: no model`);
    continue;
  }
  const views = FACINGS.map((f) => view(key, model, f));
  const title = blank(400, 22, [24, 20, 30], 255);
  text(title, 4, 4, key, [255, 220, 150], 2);
  const sheet = stack([title, row(views)]);
  writePng(`${OUT}/${key}.png`, sheet);
  sheets.push(sheet);
  console.log(`${OUT}/${key}.png`);
}
if (sheets.length > 1) writePng(`${OUT}/all.png`, stack(sheets));
