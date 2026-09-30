/**
 * Proof that the game draws a seat rig exactly as its sheet shows it: each seat, in every facing, rendered by the
 * real renderer (WorldView, through the furniture lab's flab.rigProbe on the no-HMR review server) and diffed
 * pixel for pixel against the rig compositor (src/client/engine/sprites/seatRig.ts) over every sitter pixel and
 * every front-layer pixel.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/seat-rig-probe.ts [KEY,KEY…|all]     (LAB_URL, default :5190)
 *
 * Writes art/review/rigs/probe/<key>.<facing>.png (the render | the compositor | the differences in red) for
 * any view that differs; exit 1 if any does.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Facing } from '../src/shared/world/scene';
import { rigForView, RIG_FACINGS } from '../src/shared/world/seatRigs';
import { composeRig, RIG_LOOKS, seatedSitters } from '../src/client/engine/sprites/seatRig';
import { loadManifest } from './lib/manifest';
import { readRigs, rigView, seatKeys, type Sprites } from './lib/rigs';
import { blank, readPng, writePng } from './lib/png';

const M = loadManifest().sprites as unknown as Sprites;
const rigs = readRigs();
const arg = process.argv[2];
const keys = !arg || arg === 'all' ? seatKeys(M) : arg.split(',');
const url = process.env.LAB_URL ?? 'http://localhost:5190/furniture.html';
const OUT = 'art/review/rigs/probe';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
await page.goto(url);
await page.waitForFunction(() => (window as unknown as { flab?: unknown }).flab, null, { timeout: 60_000 });
let bad = 0;
for (const key of keys) {
  const [sprite, ...rest] = key.split('.');
  const variant = rest.length ? rest.join('.') : undefined;
  const long = Math.max(...M[key].footprint) > 1;
  for (const f of RIG_FACINGS as Facing[]) {
    const v = rigView(M, key, f);
    const r = rigForView(rigs, key, f, { mirrored: v.mirrored, width: v.art.px.w });
    if (!r) continue;
    const res = (await page.evaluate(
      ([s, va, fa, lo, name]) =>
        (window as unknown as { flab: { rigProbe: (...a: unknown[]) => Promise<{ path: string; origin: [number, number]; scale: number }> } }).flab.rigProbe(s, va, fa, { long: lo, name }),
      [sprite, variant, f, long, `rigprobe-tmp`] as const,
    )) as { path: string; origin: [number, number]; scale: number };
    const shot = readPng(res.path);
    const [ox, oy] = res.origin;
    const c = composeRig(v.art, r.rig, seatedSitters(v, r.rig, RIG_LOOKS, 0), { size: [shot.w, shot.h], origin: [ox, oy] });
    let diff = 0;
    let n = 0;
    const out = blank(shot.w * 3, shot.h, [0, 0, 0], 255);
    for (let y = 0; y < shot.h; y++)
      for (let x = 0; x < shot.w; x++) {
        const i = y * shot.w + x;
        const a = [shot.d[i * 4], shot.d[i * 4 + 1], shot.d[i * 4 + 2]];
        const b = [c.cell.d[i * 4], c.cell.d[i * 4 + 1], c.cell.d[i * 4 + 2]];
        out.d.set([...a, 255], (y * out.w + x) * 4);
        if (c.who[i] >= 2) {
          n++;
          out.d.set([...b, 255], (y * out.w + shot.w + x) * 4);
          const same = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 6;
          if (!same) diff++;
          out.d.set(same ? [a[0] >> 2, a[1] >> 2, a[2] >> 2, 255] : [255, 40, 40, 255], (y * out.w + 2 * shot.w + x) * 4);
        }
      }
    const ok = n > 0 && diff <= Math.max(2, n * 0.002);
    if (!ok) {
      bad++;
      writePng(`${OUT}/${key}.${f}.png`, out);
    }
    console.log(`${ok ? ' ok' : ' !!'} ${key.padEnd(20)} ${f}: ${diff} of ${n} sitter/front px differ${ok ? '' : ` → ${OUT}/${key}.${f}.png`}`);
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
