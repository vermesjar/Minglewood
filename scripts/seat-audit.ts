/** Real WorldView captures: every seat, facing, cushion, review look, and both play scales. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { MODEL_FACINGS, SEAT_LOOKS } from '../src/shared/world/seatModels';
import { loadManifest } from './lib/manifest';
import { blank, readPng, writePng } from './lib/png';
import { paste, row, stack } from './lib/draw';
import { text } from './lib/font';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const out = arg('out') ?? 'art/review/seating-audit';
const M = loadManifest().sprites;
const keys = arg('keys')?.split(',') ?? Object.keys(M).filter((k) => M[k].walk === 'seat').sort();
mkdirSync(`${out}/raw`, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${arg('url') ?? 'http://localhost:5195'}/lab.html`);
await page.waitForFunction(() => document.title.includes('ready'));
const records: Array<{ key: string; occupied: string; sheet: string; shots: string[] }> = [];
for (const key of keys) {
  const n = M[key].footprint[0];
  const cases = n === 1 ? [{ label: 'all', cushions: [0] }] : [
    ...Array.from({ length: n }, (_, i) => ({ label: `cushion-${i + 1}`, cushions: [i] })),
    { label: 'all', cushions: Array.from({ length: n }, (_, i) => i) },
  ];
  for (const occupied of cases) {
    const rows = [];
    const title = blank(976, 23, [29,23,36], 255);
    text(title, 5, 6, `${key} / ${occupied.label} / SE SW NE NW`, [246,222,177], 2);
    rows.push(title);
    const shots: string[] = [];
    for (let lookIndex = 0; lookIndex < SEAT_LOOKS.length; lookIndex++) {
      for (const zoom of [4, 2]) {
        const images: Record<string, string> = await page.evaluate(async ({ key, look, cushions, zoom }) => {
          const lab = (window as any).lab;
          return lab.seatShots({ key, zoom, size: [120 * zoom / 2, 152 * zoom / 2], cushions,
            looks: [look], ids: Array.from({ length: 32 }, (_, i) => `audit-${i}`) });
        }, { key, look: SEAT_LOOKS[lookIndex], cushions: occupied.cushions, zoom });
        const cells = MODEL_FACINGS.map((facing) => {
          const file = `raw/${key}.${occupied.label}.L${lookIndex}.${facing}.z${zoom}.png`;
          writeFileSync(`${out}/${file}`, Buffer.from(images[facing].split(',')[1], 'base64'));
          shots.push(file);
          return readPng(`${out}/${file}`);
        });
        const strip = row(cells, [29,23,36], zoom === 4 ? 4 : 124);
        rows.push(strip);
      }
    }
    const sheet = `${key}.${occupied.label}.png`;
    writePng(`${out}/${sheet}`, stack(rows, [29,23,36], 4));
    records.push({ key, occupied: occupied.label, sheet, shots });
  }
  console.log(`captured ${key}`);
}
await browser.close();
writeFileSync(`${out}/coverage.json`, JSON.stringify({ facings: MODEL_FACINGS, looks: SEAT_LOOKS, zooms: [2,4], errors, records }, null, 2));
writeFileSync(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><title>Seating audit</title><style>body{background:#1d1724;color:#f6deb1;font:16px system-ui;max-width:1100px;margin:40px auto}img{max-width:100%;image-rendering:pixelated}section{margin:60px 0}a{color:#b6d7c1}</style><h1>Seating audit</h1><p>${keys.length} seats · four facings · three looks · each cushion and full occupancy · play and enlarged scales.</p>${records.map((r) => `<section id="${r.key}-${r.occupied}"><h2>${r.key} / ${r.occupied}</h2><img src="${r.sheet}"></section>`).join('')}`);
console.log(`${records.length} sheets; ${records.reduce((n,r) => n + r.shots.length, 0)} captures; ${errors.length} browser errors`);
if (errors.length) process.exitCode = 1;
