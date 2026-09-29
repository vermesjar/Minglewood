/**
 * Someone else's walk that reaches you late (their slow connection, a busy server) plays from where it began and
 * catches up briskly — it never jumps them ahead. One player sends a walk stamped 800 ms before it's sent; a
 * second player in the room records where the figure is drawn every frame.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { request } from '@playwright/test';
import { AUTH_DIR, TAG } from './global-setup';
import { expect, Player, test } from './helpers';

/** A sign-in for the watcher, made once and reused (demo sign-ups persist and are rate limited). */
async function watcherState(baseURL: string, file: string) {
  if (existsSync(file)) {
    const ctx = await request.newContext({ baseURL, storageState: file });
    const ok = (await ctx.get('/api/bootstrap')).ok();
    await ctx.dispose();
    if (ok) return file;
  }
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/auth/demo', { data: { name: 'Walk Watcher', teamId: 'team-aurora', interests: ['coffee'] } });
  const { memberId } = (await res.json()) as { memberId: string };
  const state = await ctx.storageState();
  state.origins = [{ origin: baseURL, localStorage: [{ name: `mw.welcomed.${memberId}`, value: '1' }] }];
  writeFileSync(file, JSON.stringify(state, null, 2));
  await ctx.dispose();
  return file;
}

test('a walk that reaches the room late plays out smoothly for everyone watching', async ({ player, browser, baseURL }, info) => {
  test.setTimeout(180_000);
  const file = `${AUTH_DIR}/walk-watcher${TAG}-${info.parallelIndex}.json`;
  const page2 = await (await browser.newContext({ storageState: await watcherState(baseURL!, file), viewport: { width: 1600, height: 1000 } })).newPage();
  const watcher = new Player(page2);
  await watcher.boot(file, 'Walk Watcher');
  await player.roomScene('cafe');
  await watcher.enter('cafe');
  await player.settle();
  await watcher.settle();
  const me = await player.me();
  const path = await player.ev(([x0, y0]) => {
    const g = (window as any).__mw;
    const grid = g.grid(g.world.scene.id);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const run = [0, 1, 2, 3, 4].map((k) => [x0 + dx * k, y0 + dy * k]);
      if (run.slice(1).every(([x, y]) => grid.walkable(x, y))) return run;
    }
    return null;
  }, me.tile);
  expect(path, 'room to walk').not.toBeNull();
  // the watcher records where my figure is drawn, every frame
  await page2.evaluate((id) => {
    const w = (window as any).__mw.world;
    const rec: Array<[number, number, number]> = [];
    (window as any).__walkRec = rec;
    const tick = (t: number) => {
      const a = w.actors.get(id);
      if (a) rec.push([t, a.x, a.y]);
      if (rec.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, me.id);
  // my walk, stamped 800 ms before it goes out
  await player.ev((path) => {
    const g = (window as any).__mw;
    g.sendOwnPath(path, Date.now() + (g.rt?.serverOffset ?? 0) - 800);
  }, path);
  await page2.waitForTimeout(3000);
  const rec = (await page2.evaluate(() => (window as any).__walkRec)) as Array<[number, number, number]>;
  expect(rec.length, 'frames recorded').toBeGreaterThan(30);
  let worst = 0;
  for (let i = 1; i < rec.length; i++) worst = Math.max(worst, Math.hypot(rec[i][1] - rec[i - 1][1], rec[i][2] - rec[i - 1][2]));
  expect(worst, 'the biggest step between two frames (tiles): a jump ahead would be ~3').toBeLessThan(1.2);
  const [, ex, ey] = rec[rec.length - 1];
  expect([Math.round(ex), Math.round(ey)], 'arrived at the end of the walk').toEqual(path![path!.length - 1]);
  await page2.context().close();
});
