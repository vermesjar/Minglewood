/**
 * Seat shots: every seat kind in all four facings with someone on every cushion, drawn by the real WorldView in a
 * headless browser (src/client/lab/seatShots.ts), saved as art/review/seat-shots/<key>.<facing>.z<zoom>.png plus one
 * contact sheet per zoom (art/review/seat-shots/sheet.z<zoom>.png, each shot magnified to 2× so pixels read).
 *
 *   node --no-maglev --import tsx scripts/seat-shots.ts [--url http://localhost:5195] [--zoom 2,4] [--keys a,b]
 *        [--looks 0,3,5] [--empty] [--out DIR]
 *
 * Needs a vite server for the working tree (vite.seatwork.config.ts on 5195, or the review server on 5190).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { loadManifest } from './lib/manifest';
import { readPng, writePng, type Img as Png } from './lib/png';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const URL = arg('url') ?? 'http://localhost:5195';
const zooms = (arg('zoom') ?? '2,4').split(',').map(Number);
const OUT = arg('out') ?? 'art/review/seat-shots';
const empty = process.argv.includes('--empty');
const manifest = loadManifest();
const allSeats = Object.entries(manifest.sprites)
  .filter(([, e]) => (e as { walk?: string }).walk === 'seat')
  .map(([k]) => k)
  .sort();
const keys = arg('keys')?.split(',') ?? allSeats;
const lookIdx = (arg('looks') ?? '0,3,5,8,11,14,17,20').split(',').map(Number);
const FACINGS = ['se', 'sw', 'ne', 'nw'] as const;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`${URL}/lab.html`);
await page.waitForFunction(() => document.title.includes('ready'), undefined, { timeout: 60_000 });

type Shots = Partial<Record<(typeof FACINGS)[number], string>>;
const results = new Map<string, Map<number, Record<string, Png>>>();
for (const key of keys) {
  const byZoom = new Map<number, Record<string, Png>>();
  for (const zoom of zooms) {
    const shots: Shots = await page.evaluate(
      async ({ key, zoom, lookIdx, empty }) => {
        const lab = (window as unknown as { lab: any }).lab;
        await lab.ready;
        const members = lab.seed.members;
        const pick = lookIdx.map((i: number) => members[i % members.length]);
        return lab.seatShots({ key, zoom, looks: pick.map((m: any) => m.avatar), ids: pick.map((m: any) => m.id), empty });
      },
      { key, zoom, lookIdx, empty },
    );
    const pngs: Record<string, Png> = {};
    for (const f of FACINGS) {
      const url = shots[f];
      if (!url) continue;
      const buf = Buffer.from(url.split(',')[1], 'base64');
      const file = `${OUT}/${key}.${f}.z${zoom}.png`;
      writeFileSync(file, buf);
      pngs[f] = readPng(file);
    }
    byZoom.set(zoom, pngs);
  }
  results.set(key, byZoom);
  console.log('shot', key);
}
await browser.close();

// contact sheets: a row per seat kind, the four facings side by side, magnified so one drawing px reads
for (const zoom of zooms) {
  const mag = zoom >= 4 ? 1 : 2;
  const cells = [...results.entries()].map(([key, z]) => ({ key, pngs: z.get(zoom)! }));
  const cw = Math.max(...cells.flatMap((c) => Object.values(c.pngs).map((p) => p.w))) * mag;
  const chh = Math.max(...cells.flatMap((c) => Object.values(c.pngs).map((p) => p.h))) * mag;
  const W = cw * 4 + 5 * 4;
  const H = cells.length * (chh + 4) + 4;
  const sheet: Png = { w: W, h: H, d: new Uint8Array(W * H * 4) };
  for (let i = 0; i < W * H; i++) sheet.d.set([40, 34, 48, 255], i * 4);
  cells.forEach((c, r) =>
    FACINGS.forEach((f, col) => {
      const p = c.pngs[f];
      if (!p) return;
      const ox = 4 + col * (cw + 4);
      const oy = 4 + r * (chh + 4);
      for (let y = 0; y < p.h * mag; y++)
        for (let x = 0; x < p.w * mag; x++) {
          const si = (Math.floor(y / mag) * p.w + Math.floor(x / mag)) * 4;
          const di = ((oy + y) * W + ox + x) * 4;
          sheet.d.set(p.d.subarray(si, si + 4), di);
        }
    }),
  );
  writePng(`${OUT}/sheet.z${zoom}.png`, sheet);
  console.log(`${OUT}/sheet.z${zoom}.png`, W, H, cells.map((c) => c.key).join(' '));
}
