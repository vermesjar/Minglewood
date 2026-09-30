/**
 * Run one sprite-lab call in a headless browser and save the PNG data URL it returns.
 *
 *   node --no-maglev --import tsx scripts/lab-call.ts OUT.png "lab.figureSheet({ looks: lab.seed.members.slice(0, 3).map((m) => m.avatar), poses: ['sit'] })"
 *
 * The expression sees `lab` (src/client/lab/lab.ts) and may be async. Needs a vite server for the working tree
 * (--url, default http://localhost:5195: vite.seatwork.config.ts).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const urlAt = args.indexOf('--url');
const URL = urlAt < 0 ? 'http://localhost:5195' : args.splice(urlAt, 2)[1];
const [out, expr] = args;
if (!out || !expr) throw new Error('usage: lab-call.ts OUT.png "<expression>"');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.goto(`${URL}/lab.html`);
await page.waitForFunction(() => document.title.includes('ready'), undefined, { timeout: 60_000 });
const url: unknown = await page.evaluate(async (src) => {
  const lab = (window as unknown as { lab: { ready: Promise<unknown> } }).lab;
  await lab.ready;
  return await new Function('lab', `return (async () => (${src}))()`)(lab);
}, expr);
await browser.close();
if (typeof url === 'string' && url.startsWith('data:')) {
  writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(out);
} else if (url && typeof url === 'object' && 'images' in url) {
  // several pictures: OUT is a directory, one PNG per name
  mkdirSync(out, { recursive: true });
  for (const [name, data] of Object.entries((url as { images: Record<string, string> }).images)) writeFileSync(`${out}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  console.log(out, Object.keys((url as { images: object }).images).length);
} else console.log(JSON.stringify(url, null, 1));
