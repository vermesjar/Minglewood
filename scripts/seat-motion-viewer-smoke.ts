/** Inspect the Studio movement component against original captured films, without publishing a draft. */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { seatMotionFrames } from './lib/seat-motion-viewer';
import { readPng } from './lib/png';

const manifestPath = process.argv[2], output = process.argv[3];
if (!manifestPath || !output) throw Error('Usage: seat-motion-viewer-smoke.ts MANIFEST OUTPUT_FOLDER');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const folder = resolve('art/review'), resultPath = relative(folder, resolve(manifestPath, '..', manifest.result.path));
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await page.addInitScript('window.__name = (value) => value;');
  const errors: string[] = []; page.on('pageerror', e => { errors.push(String(e)); console.error(String(e)); });
  await page.route('**/api/dev/lab/drafts/motion-viewer-fixture/seat-review/motion?*', async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: seatMotionFrames(folder, resultPath, url.searchParams.get('facing')!, Number(url.searchParams.get('look'))) });
  });
  await page.goto('http://localhost:5195/studio.html');
  const componentSource = await (await page.request.get('http://localhost:5195/studio/SeatMotionViewer.tsx')).text();
  const mainSource = await (await page.request.get('http://localhost:5195/studio/main.tsx')).text();
  const reactUrl = componentSource.match(/"([^"]+\/react\.js\?[^\"]+)"/)?.[1];
  const domUrl = mainSource.match(/"([^"]+\/react-dom_client\.js\?[^\"]+)"/)?.[1];
  if (!reactUrl || !domUrl) throw Error('Cannot locate the actual Vite React modules.');
  await page.evaluate(async ({ reactUrl, domUrl }) => {
    const load = (url: string) => import(/* @vite-ignore */ url);
    const React = (await load(reactUrl)).default;
    const { createRoot } = (await load(domUrl)).default;
    const { SeatMotionViewer } = await load('/studio/SeatMotionViewer.tsx');
    document.getElementById('root')!.style.display = 'none';
    const host = document.createElement('main'); host.className = 'lab-card model-panel'; host.style.padding = '24px'; host.style.margin = '24px'; document.body.append(host);
    createRoot(host).render(React.createElement(SeatMotionViewer, { id: 'motion-viewer-fixture' }));
  }, { reactUrl, domUrl });
  const results: object[] = [];
  for (const [face, look] of [['se', 0], ['ne', 3]] as const) {
    await page.getByRole('combobox', { name: /^Direction/ }).selectOption(face);
    await page.getByRole('combobox', { name: /^Outfit/ }).selectOption({ value: String(look) });
    const film = seatMotionFrames(folder, resultPath, face, look);
    await page.waitForFunction(hash => document.querySelector('canvas[data-film-sha256]')?.getAttribute('data-film-sha256') === hash, film.filmSha256).catch(async error => {
      await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
      writeFileSync(resolve(output, 'failure.json'), JSON.stringify({ face, look, expected: film.filmSha256,
        body: await page.locator('body').innerText(), html: await page.locator('body').innerHTML() }));
      throw error;
    });
    const slider = page.getByRole('slider', { name: 'Recorded movement frame' });
    await slider.waitFor();
    for (const index of [0, film.frames.length - 1]) {
      await slider.focus(); await slider.press(index ? 'End' : 'Home');
      const expectedPath = resolve(output, `${face}-${look}-${index}.png`);
      writeFileSync(expectedPath, Buffer.from(film.frames[index].png.split(',')[1], 'base64'));
      const expected = readPng(expectedPath), expectedHash = createHash('sha256').update(expected.d).digest('hex');
      await page.waitForFunction(({ index, hash }) => {
        const c = document.querySelector('canvas[aria-label^="Original recorded seating movement"]') as HTMLCanvasElement;
        if (!c || !c.getAttribute('aria-label')?.includes(`frame ${index + 1},`)) return false;
        return crypto.subtle.digest('SHA-256', c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data).then(b => Array.from(new Uint8Array(b), v => v.toString(16).padStart(2, '0')).join('') === hash);
      }, { index, hash: expectedHash });
      results.push({ face, look, index, rgbaSha256: expectedHash, filmSha256: film.filmSha256 });
    }
  }
  await page.getByRole('combobox', { name: /^Zoom/ }).selectOption('4');
  await page.screenshot({ path: resolve(output, 'studio-motion-viewer.png'), fullPage: true });
  if (errors.length) throw Error(errors.join('\n'));
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ scope: 'Isolated Studio component using hash-checked saved recordings; no publication approval.', results, errors }, null, 2));
  console.log(JSON.stringify({ checkedFrames: results.length, errors }));
} finally { await browser.close(); }
