/**
 * The Design Lab's seat-parts flow, end to end, in headless Chromium against the running dev server (npm run dev):
 * a from-catalog copy of a seat → Propose (AI) → fix one region → the live previews → a "looks right" tick per facing.
 * Screenshots: art/review/parts-lab-*.png. Costs one proposal per drawn view (a cent or so).
 *
 *   npx tsx scripts/parts-lab-shots.ts [--key couch.purple] [--draft ID] [--fix FACING:x,y[:clicks|:part]] [--base URL] [--no-propose] [--resume] [--checks]
 */
import { chromium, type Page } from '@playwright/test';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const BASE = arg('--base', 'http://localhost:5173');
const KEY = arg('--key', 'couch.purple');
const OUT = 'art/review';

async function api<T>(path: string, method = 'GET'): Promise<T> {
  const res = await fetch(`${BASE}/api/dev/lab${path}`, { method, headers: method === 'GET' ? {} : { 'x-lab': '1', 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function shot(page: Page, name: string, what = '.parts-panel') {
  const el = page.locator(what).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await el.screenshot({ path: `${OUT}/parts-lab-${name}.png` });
  console.log(`${OUT}/parts-lab-${name}.png`);
}

const status = (page: Page) => page.locator('.parts-panel .card-head .chip').getAttribute('data-status');

async function main() {
  const id = process.argv.includes('--draft') ? arg('--draft', '') : (await api<{ id: string }>(`/from-catalog/${encodeURIComponent(KEY)}`, 'POST')).id;
  console.log(`draft ${id}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1800, height: 1300 } });
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${BASE}/studio.html#/draft/${id}/furniture`);
  // the Lab's header stays put while the page scrolls: out of the way of the element shots
  await page.addStyleTag({ content: '.lab-head { position: static !important; }' });
  await page.locator('.parts-panel').waitFor();
  await page.locator('.parts-panel canvas.parts-canvas').waitFor();
  await page.waitForTimeout(800);
  console.log('status', await status(page));
  // --resume: a draft already proposed (its first shots taken): on to the fix; --checks: only the Checks card
  const resume = process.argv.includes('--resume');
  if (process.argv.includes('--checks')) {
    await page.waitForTimeout(6000);
    await shot(page, '7-checks', 'aside.side .lab-card');
    await browser.close();
    return;
  }
  if (!resume) await shot(page, '1-open');

  // 1. Propose (AI): the cost first, then the proposal
  if (!resume && !process.argv.includes('--no-propose')) {
    await page.locator('.parts-panel .rig-actions button.primary').click();
    await page.locator('.modal').waitFor();
    await shot(page, '2-cost', '.modal');
    await page.locator('.modal button.primary').click();
    await page.waitForFunction(() => !document.querySelector('.parts-panel .rig-actions .spinner'), undefined, { timeout: 300_000 });
    await page.waitForTimeout(1500);
    console.log('status after proposal', await status(page));
  }
  // 2. Fix one region (--fix FACING:x,y[:clicks | :part], drawing px): hover it (the readout names its region and part),
  // then click it to cycle its part, or pick a part in the palette and shift-click; the rig recompiles, the previews follow
  const fix = arg('--fix', '');
  if (fix) {
    const [facing, xy, how = '1'] = fix.split(':');
    const [x, y] = xy.split(',').map(Number);
    await page.locator('.parts-panel .parts-bar .seg').first().locator('button', { hasText: facing }).click();
    await page.waitForTimeout(500);
    const canvas = page.locator('.parts-panel canvas.parts-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const z = Number(await canvas.getAttribute('data-zoom'));
    const scale = await canvas.evaluate((c: HTMLCanvasElement) => c.clientWidth / c.width);
    const at = { x: (x + 0.5) * z * scale, y: (y + 0.5) * z * scale };
    await canvas.hover({ position: at });
    await page.waitForTimeout(300);
    const readout = () => page.locator('.parts-panel .parts-edit > p.small.muted').first().textContent();
    console.log('before:', await readout(), '·', await status(page));
    await shot(page, '3-proposed', '.parts-panel');
    if (/^\d+$/.test(how))
      for (let k = 0; k < Number(how); k++) {
        await canvas.click({ position: at });
        await page.waitForTimeout(700);
      }
    else {
      await page.locator('.part-swatch', { hasText: how }).click();
      await canvas.click({ position: at, modifiers: ['Shift'] });
    }
    await canvas.hover({ position: at });
    await page.waitForTimeout(1200);
    console.log('after:', await readout(), '·', await status(page));
    await shot(page, '4-fixed', '.parts-panel .parts-edit');
    // what the rules now put in front of a sitter in this view
    await page.locator('.parts-panel .parts-bar button', { hasText: 'In front' }).click();
    await page.waitForTimeout(400);
    await shot(page, '4b-in-front', '.parts-panel .parts-edit');
    await page.locator('.parts-panel .parts-bar button', { hasText: 'Parts' }).click();
  } else await shot(page, '3-proposed', '.parts-panel .parts-edit');

  // 3. The previews: every facing, three looks, play scale and 4×, with its checks
  await shot(page, '5-previews', '.parts-panel .rig-facings');

  // 4. Tick "looks right" on every facing that holds
  const ticks = page.locator('.parts-panel .rig-facing input[type=checkbox]');
  for (let i = 0; i < (await ticks.count()); i++) {
    const t = ticks.nth(i);
    if ((await t.isEnabled()) && !(await t.isChecked())) {
      await t.check();
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(1200);
  console.log('status after ticks', await status(page));
  await shot(page, '6-ticked', '.parts-panel');
  await shot(page, '7-checks', 'aside.side .lab-card');
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
