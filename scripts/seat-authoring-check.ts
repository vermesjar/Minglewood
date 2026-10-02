/** Exercise type presets through the actual new-draft form; no generation or publication. */
import { chromium } from '@playwright/test';
const root = process.env.PLAYTEST_URL ?? 'http://localhost:5196';
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  for (const kind of ['beanbag', 'floor-cushion', 'couch']) {
    await page.goto(`${root}/studio.html`);
    const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'New furniture', exact: true }) });
    await form.getByLabel('Seating type').selectOption(kind);
    await form.getByPlaceholder('Name: a few words (Oak park bench)').fill(`Audit ${kind}`);
    if (kind === 'couch') await form.getByRole('button', { name: '4×1', exact: true }).click();
    const created = page.waitForResponse(r => r.url().endsWith('/api/dev/lab/drafts') && r.request().method() === 'POST');
    await form.getByRole('button', { name: 'Start the draft' }).click();
    const draft = await (await created).json();
    try {
      const f = draft.furniture;
      const expectedSeat = kind === 'beanbag' ? 6 : kind === 'floor-cushion' ? 3 : 10;
      if (f.seatKind !== kind || f.seat !== expectedSeat || f.footprint[1] !== 1 || f.footprint[0] !== (kind === 'couch' ? 4 : 1)) throw new Error(JSON.stringify(f));
      console.log(`${kind}: type, pose defaults and cushion count saved correctly`);
    } finally {
      await page.request.delete(`${root}/api/dev/lab/drafts/${draft.id}`, { headers: { 'x-lab': '1' } });
    }
  }
} finally {
  await browser.close();
}
