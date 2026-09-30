/**
 * Every room with someone on every cushion, drawn by the real WorldView (src/client/lab/seatShots.ts roomShot) at
 * play scale, plus a crop round each seat: art/review/room-seats/<room>.png and <room>/<seat>.png. The way to see
 * seating the way it's played, room by room, after any change to the seat framework.
 *
 *   node --no-maglev --import tsx scripts/room-seats.ts [--url http://localhost:5190] [--rooms cafe,hq] [--zoom 2] [--out DIR]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const URL = arg('url') ?? 'http://localhost:5190';
const OUT = arg('out') ?? 'art/review/room-seats';
const zoom = Number(arg('zoom') ?? 2);
const rooms = (arg('rooms') ?? 'cafe,hq,eng,launch,events,focus,arcade,design,town').split(',');

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`${URL}/lab.html`);
await page.waitForFunction(() => document.title.includes('ready'), undefined, { timeout: 60_000 });
for (const room of rooms) {
  const res = await page.evaluate(
    async ({ room, zoom }) => {
      const lab = (window as unknown as { lab: any }).lab;
      await lab.ready;
      const members = lab.seed.members;
      const pick = members.slice(0, 24);
      return lab.roomShot({ sceneId: room, looks: pick.map((m: any) => m.avatar), ids: pick.map((m: any) => m.id), zoom, size: [1600, 1100], crops: [220, 200] }) as { images: Record<string, string> };
    },
    { room, zoom },
  );
  mkdirSync(`${OUT}/${room}`, { recursive: true });
  let n = 0;
  for (const [name, url] of Object.entries(res.images)) {
    const buf = Buffer.from(url.split(',')[1], 'base64');
    if (name === 'room') writeFileSync(`${OUT}/${room}.png`, buf);
    else {
      writeFileSync(`${OUT}/${room}/${name}.png`, buf);
      n++;
    }
  }
  console.log(`${room}: ${n} seat crops`);
}
await browser.close();
