/**
 * The seat bugs from the pt5 sweep (docs/playtest.md #11, #12, #13, #15), each reproduced the way a player
 * meets it:
 *
 *   #11 on a couch you just shifted along, clicking your own seat (on and around your figure) never moves
 *       you, however soon after the shift; on a stool it never stands you up
 *   #12 the far cushion of the café's green couch (faces ne) and the Design Lab sofa (faces se) seats you on
 *       that cushion, from standing and from the other cushion
 *   #13 another player watching a shift along a lounge couch sees a slide, never a jump
 *   #15 left on a seat's tile unseated (a sit the server never made), you're walked off it
 *
 * Seats a simulated coworker is sitting on are left out (and said so).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { request } from '@playwright/test';
import { AUTH_DIR, TAG } from './global-setup';
import { expect, Player, test, type Spot } from './helpers';

test.describe.configure({ mode: 'parallel' });

/** Whether someone else is on the seat — waiting up to 90 s for a simulated coworker to get up first. */
const taken = async (p: Player, seatId: string) => {
  for (let i = 0; i < 60; i++) {
    const me = await p.me();
    if (!Object.entries(await p.occupants()).some(([id, o]) => id !== me.id && o.sittingOn === seatId)) return false;
    await p.page.waitForTimeout(1500);
  }
  return true;
};

/** Points on and around my figure (canvas page px): where a player "clicks their own seat". */
async function aroundMe(p: Player): Promise<Array<{ x: number; y: number }>> {
  return p.ev(() => {
    const g = (window as any).__mw;
    const w = g.world as any;
    const a = w.actors.get(g.meId);
    const r = w.canvas.getBoundingClientRect();
    const out: Array<{ x: number; y: number }> = [];
    for (const dx of [-10, -6, 6, 10])
      for (const dy of [-2, 4]) {
        const [sx, sy] = w.camera.toScreen(a.sx + dx, a.sy + dy, w.vw, w.vh);
        const [ax, ay] = w.camera.toWorld(sx, sy, w.vw, w.vh);
        const hit = w.hitTest(sx, sy, ax, ay);
        // only clicks that land on the seat itself (on the figure, you'd open your own card)
        if (hit?.kind === 'object' && hit.obj.id === a.occ.sittingOn) out.push({ x: r.left + sx, y: r.top + sy });
      }
    return out;
  });
}

async function sitAt(p: Player, seatId: string, spot: Spot) {
  const at = await p.objectPoint(seatId, { x: spot.x, y: spot.y, z: 10 });
  expect(at, `a clickable pixel of ${seatId} cushion ${spot.index}`).toBeTruthy();
  await p.click(at!);
  return p.until((m) => m.sittingOn === seatId && m.server?.x === spot.x && m.server?.y === spot.y && !m.moving, 15_000);
}

/** Every two-seater (the simulated coworkers like couches: a test takes whichever are free). */
const COUCHES = [
  ['cafe', 'cafe-30'],
  ['design', 'design-sofa'],
  ['hq', 'hq-13'],
  ['hq', 'hq-11'],
  ['eng', 'eng-meet-sofa'],
  ['eng', 'eng-lounge-sofa'],
  ['launch', 'launch-couch'],
  ['arcade', 'arcade-7'],
] as const;

/** The first free couch from `from` on (entering its room), or null. */
async function freeCouch(p: Player, from: number): Promise<{ room: string; seatId: string } | null> {
  for (let k = 0; k < COUCHES.length; k++) {
    const [room, seatId] = COUCHES[(from + k) % COUCHES.length];
    await p.enter(room);
    const me = await p.me();
    if (!Object.entries(await p.occupants()).some(([id, o]) => id !== me.id && o.sittingOn === seatId)) return { room, seatId };
  }
  return null;
}

for (const n of [0, 2, 4])
  test(`#11 re-clicking your own seat right after a shift never moves you (couch ${n})`, async ({ player }) => {
    test.setTimeout(300_000);
    const c = await freeCouch(player, n);
    test.skip(!c, 'every couch is taken');
    const seatId = c!.seatId;
    const [c0, c1] = await player.seatSpots(seatId);
    await player.reset();
    expect((await sitAt(player, seatId, c0)).ok, 'sat on cushion 0').toBe(true);
    await player.page.waitForTimeout(600);
    // shift over, and click your own seat around you straight away, then again once it's settled
    const at1 = await player.objectPoint(seatId, { x: c1.x, y: c1.y, z: 10 });
    await player.click(at1!);
    for (const wait of [150, 250, 400, 1200]) {
      await player.page.waitForTimeout(wait);
      for (const pt of (await aroundMe(player)).slice(0, 3)) await player.click(pt);
    }
    await player.page.waitForTimeout(1500);
    const m = await player.me();
    await player.shot(`queue-11-${seatId}`);
    console.log(`[queue] #11 on ${seatId}`);
    expect(m.sittingOn, 'still on the couch').toBe(seatId);
    expect([m.server?.x, m.server?.y], 'still on the cushion I shifted to').toEqual([c1.x, c1.y]);
  });

test('#11 re-clicking a stool you sit on never stands you up (design-12)', async ({ player }) => {
  test.setTimeout(180_000);
  await player.enter('design');
  test.skip(await taken(player, 'design-12'), 'design-12 is taken');
  const [s] = await player.seatSpots('design-12');
  await player.reset();
  expect((await sitAt(player, 'design-12', s)).ok, 'sat on the stool').toBe(true);
  for (let i = 0; i < 3; i++) {
    await player.page.waitForTimeout(200);
    for (const pt of await aroundMe(player)) await player.click(pt);
  }
  await player.page.waitForTimeout(1500);
  const m = await player.me();
  expect(m.sittingOn, 'still on the stool').toBe('design-12');
});

for (const [room, seatId] of [
  ['cafe', 'cafe-30'],
  ['design', 'design-sofa'],
] as const)
  test(`#12 each cushion of ${seatId} seats you on that cushion`, async ({ player }) => {
    test.setTimeout(240_000);
    await player.enter(room);
    test.skip(await taken(player, seatId), `${seatId} is taken by someone`);
    const spots = await player.seatSpots(seatId);
    for (const [first, then] of [
      [spots[1], spots[0]],
      [spots[0], spots[1]],
    ]) {
      await player.reset();
      const r1 = await sitAt(player, seatId, first);
      expect([r1.me.server?.x, r1.me.server?.y], `from standing, cushion ${first.index}`).toEqual([first.x, first.y]);
      const r2 = await sitAt(player, seatId, then);
      await player.shot(`queue-12-${seatId}-${then.index}`);
      expect([r2.me.server?.x, r2.me.server?.y], `from cushion ${first.index}, cushion ${then.index}`).toEqual([then.x, then.y]);
    }
  });

/** A second player, signed in once and reused. */
async function watcherPage(browser: import('@playwright/test').Browser, baseURL: string) {
  const file = `${AUTH_DIR}/queue-watcher${TAG}.json`;
  let ok = false;
  if (existsSync(file)) {
    const ctx = await request.newContext({ baseURL, storageState: file });
    ok = (await ctx.get('/api/bootstrap')).ok();
    await ctx.dispose();
  }
  if (!ok) {
    const ctx = await request.newContext({ baseURL });
    const res = await ctx.post('/api/auth/demo', { data: { name: 'Queue Watcher', teamId: 'team-aurora', interests: ['coffee'] } });
    const { memberId } = (await res.json()) as { memberId: string };
    const state = await ctx.storageState();
    state.origins = [{ origin: baseURL, localStorage: [{ name: `mw.welcomed.${memberId}`, value: '1' }] }];
    writeFileSync(file, JSON.stringify(state, null, 2));
    await ctx.dispose();
  }
  const page = await (await browser.newContext({ storageState: file, viewport: { width: 1920, height: 1080 } })).newPage();
  const w = new Player(page);
  await w.boot(file, 'Queue Watcher');
  return w;
}

for (const n of [1, 5])
  test(`#13 a watcher sees a shift along a couch as a slide (couch ${n})`, async ({ player, browser, baseURL }) => {
    test.setTimeout(300_000);
    const c = await freeCouch(player, n);
    test.skip(!c, 'every couch is taken');
    const { room, seatId } = c!;
    const watcher = await watcherPage(browser, baseURL!);
    await watcher.enter(room);
    const me = await player.me();
    const [c0, c1] = await player.seatSpots(seatId);
    await player.reset();
    expect((await sitAt(player, seatId, c0)).ok).toBe(true);
    await player.page.waitForTimeout(800);
    await watcher.page.evaluate((id) => {
      const w = (window as any).__mw.world;
      const frames: Array<{ t: number; x: number; y: number }> = [];
      (window as any).__watch = frames;
      const tick = () => {
        const a = w.actors.get(id);
        if (a) frames.push({ t: performance.now(), x: a.sx, y: a.sy + (a.lift ?? 0) });
        if (frames.length < 2000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, me.id);
    expect((await sitAt(player, seatId, c1)).ok).toBe(true);
    await player.page.waitForTimeout(800);
    const frames = (await watcher.page.evaluate(() => (window as any).__watch)) as Array<{ t: number; x: number; y: number }>;
    await watcher.page.context().close();
    let worst = 0;
    for (let i = 1; i < frames.length; i++) {
      const d = Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y);
      worst = Math.max(worst, d / (4 + 0.15 * (frames[i].t - frames[i - 1].t)));
    }
    expect(worst, 'the most the figure moved in one frame, against a slide at twice walking pace').toBeLessThanOrEqual(1);
  });

test('#15 left standing on a stool the server never sat you on, you are walked off it', async ({ player }) => {
  test.setTimeout(180_000);
  await player.enter('launch');
  test.skip(await taken(player, 'launch-stool-2'), 'launch-stool-2 is taken');
  const [s] = await player.seatSpots('launch-stool-2');
  await player.reset();
  // walk onto the stool's tile without asking to sit (what a refused or lost sit leaves behind)
  const ok = await player.page.evaluate((t) => (window as any).__mw.walkTo(t), [s.x, s.y] as [number, number]);
  expect(ok, 'walked onto the stool').toBe(true);
  await player.until((m) => !m.moving && m.tile[0] === s.x && m.tile[1] === s.y, 15_000);
  await player.page.waitForTimeout(4000);
  const m = await player.me();
  await player.shot('queue-15-stool');
  const onSeat = m.tile[0] === s.x && m.tile[1] === s.y;
  expect(onSeat && !m.sittingOn, `left standing inside the stool at ${m.tile}`).toBe(false);
});
