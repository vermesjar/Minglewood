/**
 * SEAT PARTS: the one thing a seat's drawing needs authored — which of its pixels are the BACK, the SEAT, an ARM or a
 * LEG — and fixed rules that turn that into the seat's layers (the rig the game draws: what's in front of a sitter).
 * The logic (regions, labels, paint, transfer, the rules, near/far per arm) lives in
 * src/client/engine/sprites/seatParts.ts, shared with the Design Lab's Parts panel: change the rules THERE. This is
 * its command line over the catalog.
 *
 *   npx tsx scripts/seat-parts.ts --regions KEY[:FACING]     split each own drawing into its natural colour regions,
 *                                                            numbered: art/review/parts/KEY.FACING.regions.png
 *   npx tsx scripts/seat-parts.ts --label KEY:FACING '{"back":[1,4],"seat":[2],"arm":[3,5],"leg":[6]}'
 *                                                            regions → the part map art/seat-parts/KEY.FACING.png
 *                                                            (unlisted regions: "other", never in front); "paint":
 *                                                            [{"part", "poly": [[x, y], …], "like"?: [r, g, b], "tol"?}]
 *                                                            sets a part in a polygon (only pixels like a colour)
 *   npx tsx scripts/seat-parts.ts --transfer FROM TO         a variant in the same shape takes FROM's part maps
 *   npx tsx scripts/seat-parts.ts --compile KEY[:FACING]     part maps → the rig's front layer (hips kept)
 *   npx tsx scripts/seat-parts.ts --show KEY:FACING          the part map and the compiled front layer, 8x
 *   npx tsx scripts/seat-parts.ts --propose KEY[:FACING] [--model M] [--effort E] [--max-usd X] [--write [--force]] [--json]
 *                                                            a vision model labels the regions (art/studio.py
 *                                                            vision-parts: the key stays in Python) → the proposal in
 *                                                            art/review/parts/KEY.FACING.proposed.png, with its
 *                                                            per-pixel agreement with the part map if there is one;
 *                                                            --write saves it as the part map (never over one
 *                                                            without --force)
 *   --rigs FILE                                              another rigs file than art/seat-rigs.json
 *
 * THE RULES (the same for every seat), relative to each sitter's pelvis (the rig hip):
 *   An arm counts only below its own top edge (a forearm rests ON it), and only the arm on the camera's side of the
 *   sitter (down-left along the seat's width in se/nw drawings, down-right in sw/ne); the far arm is beyond them.
 *   Seen from behind: the back → in front, always; the near arm → in front; seat and legs → in front below the hips.
 *   Seen from the front: only the near arm is in front. The seat is under you, your legs hang over its front edge,
 *   the back and the far arm are behind you.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { loadManifest } from './lib/manifest';
import { readPng, writePng, blank, type Img } from './lib/png';
import { rigView, seatKeys, withRigs, readRigs, ownFacings, profileOf, RIGS_FILE, type Sprites } from './lib/rigs';
import { rigCushions } from '../src/client/engine/sprites/seatRig';
import {
  compileFront,
  compileRig,
  decodeParts,
  encodeParts,
  partAgreement,
  partsFromLabels,
  PART_NAMES,
  PART_RGB,
  plainSheet,
  proposalMeta,
  regions as partRegions,
  regionSheet,
  transferParts,
  type PartLabels,
} from '../src/client/engine/sprites/seatParts';
import type { Facing } from '../src/shared/world/scene';

const M = loadManifest().sprites as unknown as Sprites;
const KEYS = seatKeys(M);
const PARTS_DIR = 'art/seat-parts';
const REVIEW = 'art/review/parts';
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const RIGS = arg('--rigs') ?? RIGS_FILE;

function views(spec: string): Array<[string, Facing]> {
  const [key, f] = spec.split(':') as [string, Facing | undefined];
  if (!KEYS.includes(key)) throw new Error(`no seat ${key}`);
  return (f ? [f] : ownFacings(M, key)).map((x) => [key, x]);
}

function art(key: string, f: Facing): Img {
  return readPng(`public/art/sprites/${rigView(M, key, f).file}`);
}

/** The drawing's regions, split as the env asks (OUTLINE: the outline's luma, CLOSE: how near a fill's colours are). */
const regions = (img: Img) => partRegions(img, { outline: +(process.env.OUTLINE ?? 22), close: +(process.env.CLOSE ?? 30) });

/* ------------------------------------------------------------------ part maps */

function partMapFile(key: string, f: Facing) {
  return `${PARTS_DIR}/${key}.${f}.png`;
}

function readParts(key: string, f: Facing): Uint8Array | null {
  const file = partMapFile(key, f);
  return existsSync(file) ? decodeParts(readPng(file)) : null;
}

function writeParts(w: number, h: number, parts: Uint8Array, file: string) {
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  writePng(file, encodeParts(w, h, parts) as Img);
}

/* ------------------------------------------------------------------ the proposal (a vision model, in Python) */

/**
 * Ask art/studio.py vision-parts for a view's labels: the numbered regions and the plain drawing at 8–10×, which way it
 * is seen, and where each region is. Returns the labels, the cost and the model.
 */
function propose(key: string, f: Facing, img: Img, lab: Int32Array, model?: string): { labels: PartLabels; usd: number; model: string; notes: string } {
  const dir = `${REVIEW}/propose`;
  mkdirSync(dir, { recursive: true });
  const base = `${process.cwd().replace(/\\/g, '/')}/${dir}/${key}.${f}`;
  const p = profileOf(M, key);
  const meta = proposalMeta(img, lab, {
    facing: f,
    name: (M[key] as { name?: string }).name ?? key,
    cushions: rigCushions(M[key].footprint, f).length,
    sitStyle: p.sitStyle,
    backrest: p.backrest,
    arms: !!p.arms,
  });
  writePng(`${base}.regions.png`, regionSheet(img, lab, meta.zoom) as Img);
  writePng(`${base}.plain.png`, plainSheet(img, meta.zoom) as Img);
  writeFileSync(`${base}.json`, JSON.stringify(meta, null, 2));
  const args = ['run', 'studio.py', 'vision-parts', '--image', `${base}.regions.png`, '--plain', `${base}.plain.png`, '--meta', `${base}.json`];
  if (model) args.push('--model', model);
  for (const o of ['--effort', '--max-usd']) if (arg(o)) args.push(o, arg(o)!);
  const r = spawnSync('uv', args, { cwd: 'art', encoding: 'utf8', windowsHide: true, env: process.env });
  const line = (r.stdout ?? '').split('\n').reverse().find((l) => l.startsWith('{'));
  const res = (line ? JSON.parse(line) : { ok: false, error: (r.stderr || 'no answer').trim().slice(-400) }) as { ok?: boolean; error?: string; labels?: PartLabels; usd?: number; model?: string; notes?: string };
  if (!res.ok || !res.labels) throw new Error(`${key} ${f}: ${res.error ?? 'the model gave no answer'}`);
  return { labels: res.labels, usd: res.usd ?? 0, model: res.model ?? '?', notes: res.notes ?? '' };
}

/* ------------------------------------------------------------------ commands */

if (process.argv.includes('--regions')) {
  mkdirSync(REVIEW, { recursive: true });
  for (const [key, f] of views(arg('--regions')!)) {
    const img = art(key, f);
    const lab = regions(img);
    const file = `${REVIEW}/${key}.${f}.regions.png`;
    writePng(file, regionSheet(img, lab, 10) as Img);
    console.log(`${key} ${f}: ${Math.max(...lab)} regions → ${file}`);
  }
} else if (process.argv.includes('--label')) {
  const [key, f] = arg('--label')!.split(':') as [string, Facing];
  // regions by number, then "paint": polygons (drawing px) that set a part over whatever region is under them —
  // the brush, for a region that runs across two parts
  const spec = JSON.parse(process.argv[process.argv.indexOf('--label') + 2]) as PartLabels;
  const img = art(key, f);
  writeParts(img.w, img.h, partsFromLabels(regions(img), img.w, spec, img), partMapFile(key, f));
  console.log(`${key} ${f}: part map → ${partMapFile(key, f)}`);
} else if (process.argv.includes('--transfer')) {
  // --transfer FROM TO: a variant drawn in the same shape (a beanbag in another colour) takes FROM's part map, each of
  // its pixels the part of the nearest labelled pixel of FROM's drawing in the same facing
  const i = process.argv.indexOf('--transfer');
  const [from, to] = [process.argv[i + 1], process.argv[i + 2]];
  for (const [, f] of views(to)) {
    const src = readParts(from, f);
    if (!src) {
      console.log(`${from} ${f}: no part map`);
      continue;
    }
    const b = art(to, f);
    writeParts(b.w, b.h, transferParts(src, art(from, f), b), partMapFile(to, f));
    console.log(`${to} ${f}: part map from ${from}`);
  }
} else if (process.argv.includes('--compile')) {
  for (const [key, f] of views(arg('--compile')!)) {
    const img = art(key, f);
    const parts = readParts(key, f);
    if (!parts) {
      console.log(`${key} ${f}: no part map`);
      continue;
    }
    const rig = readRigs(RIGS)[key]?.[f];
    if (!rig?.hips?.length) {
      console.log(`${key} ${f}: no hips in its rig yet`);
      continue;
    }
    const front = compileFront(f, img.w, img.h, parts, rig.hips);
    // a look that compiles to what was approved keeps its approval; any change needs looking at again
    const same = withRigs((rigs) => {
      const c = compileRig(rigs[key]![f]!, f, img.w, img.h, parts);
      rigs[key]![f] = c.rig;
      return c.unchanged;
    }, RIGS);
    console.log(`${key} ${f}: compiled (${front.reduce((a, b) => a + b, 0)} px in front)${same ? ', unchanged' : ''}`);
  }
} else if (process.argv.includes('--show')) {
  const [key, f] = arg('--show')!.split(':') as [string, Facing];
  const img = art(key, f);
  const parts = readParts(key, f);
  const rig = readRigs(RIGS)[key]?.[f];
  if (!parts || !rig) throw new Error('no part map or rig');
  const front = compileFront(f, img.w, img.h, parts, rig.hips);
  const Z = 8;
  const out = blank(img.w * Z * 2 + 20, img.h * Z, [40, 40, 50], 255);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const p = y * img.w + x;
      if (!parts[p]) continue;
      const a = PART_RGB[parts[p]];
      const i = p * 4;
      const b = front[p] ? [255, 150, 40] : [img.d[i] * 0.55, img.d[i + 1] * 0.55, img.d[i + 2] * 0.55];
      for (let dy = 0; dy < Z; dy++)
        for (let dx = 0; dx < Z; dx++) {
          out.d.set([a[0], a[1], a[2], 255], ((y * Z + dy) * out.w + x * Z + dx) * 4);
          out.d.set([b[0], b[1], b[2], 255], ((y * Z + dy) * out.w + img.w * Z + 20 + x * Z + dx) * 4);
        }
    }
  for (const [hx, hy] of rig.hips)
    for (const off of [0, img.w * Z + 20])
      for (let k = -6; k <= 6; k++) {
        const X = Math.round(hx * Z) + off;
        const Y = Math.round(hy * Z);
        for (const [px, py] of [
          [X + k, Y],
          [X, Y + k],
        ])
          if (px >= 0 && py >= 0 && px < out.w && py < out.h) out.d.set([255, 255, 255, 255], (py * out.w + px) * 4);
      }
  mkdirSync(REVIEW, { recursive: true });
  const file = `${REVIEW}/${key}.${f}.parts.png`;
  writePng(file, out);
  console.log(file);
} else if (process.argv.includes('--propose')) {
  const json = process.argv.includes('--json');
  const results: Array<Record<string, unknown>> = [];
  for (const [key, f] of views(arg('--propose')!)) {
    const img = art(key, f);
    const lab = regions(img);
    const got = propose(key, f, img, lab, arg('--model'));
    const parts = partsFromLabels(lab, img.w, got.labels);
    const file = `${REVIEW}/${key}.${f}.proposed.png`;
    writeParts(img.w, img.h, parts, file);
    const res: Record<string, unknown> = { key, facing: f, model: got.model, usd: got.usd, labels: got.labels, notes: got.notes, file };
    // measured against the hand-made part map: pixel by pixel, and by what each compiles to (with the rig's hips)
    const have = readParts(key, f);
    if (have) {
      const a = partAgreement(have, parts);
      const hips = readRigs(RIGS)[key]?.[f]?.hips ?? [];
      let frontShare: number | null = null;
      if (hips.length) {
        const fa = compileFront(f, img.w, img.h, have, hips);
        const fb = compileFront(f, img.w, img.h, parts, hips);
        let drawn = 0;
        let same = 0;
        for (let p = 0; p < fa.length; p++)
          if (have[p] || parts[p]) {
            drawn++;
            if (fa[p] === fb[p]) same++;
          }
        frontShare = drawn ? same / drawn : 1;
      }
      Object.assign(res, { agreement: a.share, frontAgreement: frontShare, perPart: a.perPart });
    }
    if (process.argv.includes('--write')) {
      if (have && !process.argv.includes('--force')) res.written = `not written: ${partMapFile(key, f)} exists (--force replaces it)`;
      else {
        writeParts(img.w, img.h, parts, partMapFile(key, f));
        res.written = partMapFile(key, f);
      }
    }
    results.push(res);
    if (!json) {
      const pct = (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—');
      console.log(`${key} ${f}: ${got.model} $${got.usd.toFixed(4)} → ${file}${have ? ` · parts agree ${pct(res.agreement)} · front layer agrees ${pct(res.frontAgreement)}` : ''}${res.written ? ` · ${String(res.written)}` : ''}`);
      console.log(`  ${PART_NAMES.map((n) => `${n} [${(got.labels[n] ?? []).join(', ')}]`).join('  ')}${got.notes ? `  “${got.notes}”` : ''}`);
    }
  }
  if (json) console.log(JSON.stringify(results));
} else {
  console.log('usage: see the header');
}
