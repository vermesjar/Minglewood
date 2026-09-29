/**
 * Confirmed bugs from playtesting, one spec each. A spec marked `test.fail()` reproduces a bug that's still
 * open: it passes while the bug is there and turns red the moment it's fixed — then delete the marker and it
 * guards the fix. See docs/playtest.md for each bug's diagnosis.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { botState } from './global-setup';
import { test as play, type Obj } from './helpers';

/** PLAYTEST_SHOW_OPEN=1 runs the open bugs as plain tests, to see how each one fails. */
const OPEN = !process.env.PLAYTEST_SHOW_OPEN;

const test = base.extend<object, { botFile: string }>({
  botFile: [async ({}, use, w) => use(botState(w.parallelIndex)), { scope: 'worker' }],
  storageState: async ({ botFile }, use) => use(botFile),
});

const world = (page: Page) =>
  page.evaluate(() => {
    const g = (window as any).__mw;
    const w = g?.world as any;
    return {
      scene: w?.scene?.id ?? null,
      last: w?.last ?? null,
      transition: w?.transition?.phase ?? null,
      me: g?.meId ? w?.actors?.get(g.meId)?.occ : null,
    };
  });

async function framesAdvance(page: Page) {
  const a = (await world(page)).last;
  await page.waitForTimeout(400);
  return (await world(page)).last !== a;
}

/** Into the town, as the app boots. */
async function bootToTown(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__mw?.world?.scene, undefined, {
    timeout: 60_000,
  });
  if ((await world(page)).scene !== 'town') {
    await page.evaluate(() => (window as any).__mw.goTo('town'));
    await page.waitForFunction(() => (window as any).__mw?.world?.scene?.id === 'town', undefined, {
      timeout: 30_000,
    });
  }
}

/**
 * #1 · (fixed) "Stand up" left you sitting in mid-air beside the seat (server stand patch + WorldView.patch).
 * The server sends `{ t: 'updated', patch: { sittingOn: undefined, x, y } }`; JSON drops the `undefined`, so
 * what arrives is `{ x, y }` (the step-off tile). The view and the store merge it and keep `sittingOn`: the
 * figure moves to the floor tile beside the chair still in its sit pose, the chair empties, and the Stand up
 * button stays.
 */
play('#1 Stand up stands you up', async ({ player, page }) => {
  // fixed 2026-09-29 (patches carry cleared fields as null on the wire): this now guards it
  play.setTimeout(240_000);
  const standUp = page.getByRole('button', { name: 'Stand up' });
  for (const room of ['focus', 'cafe', 'hq', 'design']) {
    const scene = await player.roomScene(room);
    const occ = await player.occupants();
    for (const seat of scene.objects.filter(
      (o: Obj) =>
        o.actions?.some((a) => a.kind === 'sit') &&
        (o.w ?? 1) === 1 &&
        (o.d ?? 1) === 1 &&
        !Object.values(occ).some((p) => p.sittingOn === o.id),
    )) {
      const p = await player.objectPoint(seat.id, { x: seat.x, y: seat.y, z: 6 });
      if (!p) continue;
      await player.click(p);
      const sat = await player.until((m) => m.sittingOn === seat.id && !m.moving, 12_000);
      if (!sat.ok || !(await standUp.isVisible())) continue;
      await standUp.click();
      await page.waitForTimeout(1500);
      const after = await player.ev(() => {
        const g = (window as any).__mw;
        const w = g.world as any;
        const a = w.actors.get(g.meId);
        return {
          sittingOn: a.occ.sittingOn ?? null,
          pose: w.pose(a),
          tile: [Math.round(a.x), Math.round(a.y)],
        };
      });
      await player.shot(`regress-stand-up-${room}-${seat.id}`);
      expect.soft(after.sittingOn, 'no longer on the seat').toBeNull();
      expect.soft(after.pose, 'standing, not in a sit pose').not.toMatch(/^sit/);
      expect.soft(await standUp.isVisible(), 'the Stand up button goes away').toBe(false);
      return;
    }
  }
  throw new Error('could not sit on any free single seat');
});

/**
 * #2 · The town can freeze for good on load (engine: WorldView.frame + Effects.drawUnder).
 * A rAF timestamp is the time the frame *started*, so the first one can be earlier than the
 * `performance.now()` WorldView took when it was made. That first step is negative, the effects clock goes
 * below zero, the lake glints index `water[negative % n]` (undefined) and throw — and `frame()` only re-arms
 * requestAnimationFrame after a clean update + draw, so one throw stops the world for good (nobody walks, the
 * iris into a room never finishes, the canvas keeps a half-drawn town). Headless Chromium hits it on almost
 * every boot; here the rAF clock is pinned a few seconds behind so it happens every time.
 */
test('#2 a first frame stamped before the view was made does not stop the world', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => cb(t - 4000));
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
  await bootToTown(page);
  await page.waitForTimeout(1500);
  expect(errors, errors.join('\n')).toEqual([]);
  expect(await framesAdvance(page), 'frames are still being drawn').toBe(true);
});

/** #2 as a player meets it: load into town, walk into a room, and the room actually opens. */
test('#2 entering a room from town finishes (the world keeps rendering)', async ({ page }) => {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => cb(t - 4000));
  });
  await bootToTown(page);
  await page.evaluate(() => (window as any).__mw.goTo('cafe'));
  await page.waitForTimeout(6000);
  const s = await world(page);
  expect(s.scene).toBe('cafe');
  expect(s.transition, 'the iris transition finished').toBeNull();
  expect(await framesAdvance(page), 'frames are still being drawn').toBe(true);
});

/**
 * #4 · Clicking the far cushion of a two-seater seats you on the other one (game.ts onObjectClick, sit).
 * (The server now honours the cushion the client asks for, `at`; the client still asks for the wrong one.)
 * The cushion is picked as the one nearest `world.tileAt(click)`, which projects the click onto the floor —
 * but a cushion is drawn ~10 art px above the floor (and its back higher still), so a click on the cushion
 * lands a tile further back and the nearest spot is the neighbouring cushion. Every couch and bench in the
 * game has one cushion you can only get by clicking low on its front edge.
 */
play('#4 clicking a cushion of a couch or bench seats you on that cushion', async ({ player }) => {
  play.setTimeout(180_000);
  let tried = 0;
  for (const room of ['hq', 'cafe', 'events', 'focus', 'design', 'arcade', 'eng', 'launch']) {
    await player.enter(room);
    const scene = await player.scene();
    const occ = await player.occupants();
    const me = await player.me();
    for (const seat of scene.objects.filter((o: Obj) => o.actions?.some((a) => a.kind === 'sit'))) {
      const spots = await player.seatSpots(seat.id);
      if (spots.length !== 2) continue;
      if (Object.entries(occ).some(([id, o]) => id !== me.id && o.sittingOn === seat.id)) continue;
      // each cushion, clicked on the cushion itself (the pixel of the seat nearest the cushion at sitting height)
      for (const spot of spots) {
        const p = await player.objectPoint(seat.id, { x: spot.x, y: spot.y, z: 10 });
        if (!p) continue;
        await player.reset();
        await player.click(p);
        const r = await player.until((m) => m.sittingOn === seat.id && !m.moving, 15_000);
        await player.shot(`regress-2-${room}-${seat.id}-${spot.index}`);
        expect(r.ok, `seated on ${seat.id}`).toBe(true);
        expect(
          [r.me.server?.x, r.me.server?.y],
          `${room} ${seat.id}: clicked cushion ${spot.index}`,
        ).toEqual([spot.x, spot.y]);
        tried++;
      }
      if (tried >= 2) return;
    }
  }
  expect(tried, 'found a free two-seater to try').toBeGreaterThan(0);
});

/**
 * #3 · Once you've sat on a seat and walked away, clicking that seat again does nothing (game.ts store).
 * Standing up never reaches the client's store: walking off sends `moved`, which only the view handles, and the
 * Stand up patch is `{ sittingOn: undefined }`, which JSON drops on the wire. So the store keeps you (and
 * everyone else who ever sat) on the seat: clicking it takes the "already sitting here" branch and returns,
 * and other people's cushions count as taken after they've left them.
 */
play('#3 walking off a seat and clicking it again sits you back down', async ({ player, page }) => {
  play.setTimeout(240_000);
  const standUp = page.getByRole('button', { name: 'Stand up' });
  for (const room of ['focus', 'cafe', 'hq', 'design']) {
    const scene = await player.roomScene(room);
    const occ = await player.occupants();
    const singles = scene.objects.filter(
      (o: Obj) =>
        o.actions?.some((a) => a.kind === 'sit') &&
        (o.w ?? 1) === 1 &&
        (o.d ?? 1) === 1 &&
        !Object.values(occ).some((p) => p.sittingOn === o.id),
    );
    // (the first sit can already be refused: the store still seats someone who got up from it earlier)
    for (const seat of singles) {
      const click = async () =>
        player.click((await player.objectPoint(seat.id, { x: seat.x, y: seat.y, z: 6 }))!);
      await player.reset();
      await click();
      const first = await player.until((m) => m.sittingOn === seat.id && !m.moving, 12_000);
      if (!first.ok) continue;
      const off = await player.ev(
        ([x, y, room]) => {
          const grid = (window as any).__mw.grid(room);
          for (const [dx, dy] of [
            [3, 0],
            [0, 3],
            [-3, 0],
            [0, -3],
            [2, 2],
            [-2, 2],
          ])
            if (grid.walkable(x + dx, y + dy)) return [x + dx, y + dy];
          return null;
        },
        [seat.x, seat.y, room] as const,
      );
      await page.evaluate((t) => (window as any).__mw.walkTo(t), off);
      await player.until(
        (m) => !m.moving && !m.sittingOn && m.tile[0] === off![0] && m.tile[1] === off![1],
        15_000,
      );
      await page.waitForTimeout(800);
      await player.full(`regress-3-walked-off-${room}`);
      expect
        .soft(await standUp.isVisible(), 'no Stand up button once I have walked off the seat')
        .toBe(false);
      await click();
      const again = await player.until((m) => m.sittingOn === seat.id && !m.moving, 15_000);
      await player.shot(`regress-3-${room}-${seat.id}`);
      expect(again.ok, `${room} ${seat.id}: sat back down after walking off`).toBe(true);
      return;
    }
  }
  throw new Error('could not sit on any free single seat');
});

/**
 * #6 · (fixed) What you carried disappeared when you sat (character renderer: avatarKit drawHeld / the seated frames).
 * Seated facing away (ne/nw) the held coffee, soda, book… is drawn behind the body: 0 px of it show. Seated
 * facing the camera only 8–13 px show (a standing or walking figure shows 31–42 px). So a player sitting
 * down with their coffee can't see they still have it — the "You ☕" tag is the only sign.
 */
play('#6 a coffee in hand still shows when you sit, from every side', async ({ player }) => {
  // fixed 2026-09-29 (seated hold: in front of the chest facing the camera, by the shoulder facing away): guards it
  await player.enter('cafe');
  const root = process.cwd().split(String.fromCharCode(92)).join('/');
  const shown = await player.ev(async (root) => {
    const { avatarSprite } = await import(`/@fs/${root}/src/client/engine/sprites/avatar.ts`);
    const w = (window as any).__mw.world as any;
    const L = w.actors.get((window as any).__mw.meId).occ.avatar;
    const px = (s: any) =>
      s.canvas.getContext('2d').getImageData(0, 0, s.canvas.width, s.canvas.height).data;
    const out: Record<string, number> = {};
    for (const facing of ['se', 'sw', 'ne', 'nw']) {
      const bare = px(avatarSprite({ ...L, held: 'held.none' }, facing, 'sit'));
      const s = avatarSprite({ ...L, held: 'held.coffee' }, facing, 'sit');
      const held = px(s);
      let n = 0;
      for (let i = 0; i < held.length; i += 4)
        if (
          held[i] !== bare[i] ||
          held[i + 1] !== bare[i + 1] ||
          held[i + 2] !== bare[i + 2] ||
          held[i + 3] !== bare[i + 3]
        )
          n++;
      out[facing] = Math.round(n / (s.scale ?? 1) ** 2);
    }
    return out;
  }, root);
  for (const [facing, n] of Object.entries(shown))
    expect.soft(n, `coffee pixels showing, seated facing ${facing}`).toBeGreaterThanOrEqual(12);
});

/**
 * #5 · (fixed) A walk the server refused wasn't undone on your screen (socketServer `move` resync + WorldView.patch).
 * When the server refuses a walk it resyncs you with `{ t: 'updated', patch: { x, y, path: undefined } }`;
 * JSON drops `path: undefined`, and `WorldView.patch` only cancels a walk when the patch carries `path`. So
 * your figure carries on and arrives while the server (and everyone else) still has you where you were: you
 * end up "standing inside" the couch you clicked, or at a machine that never hands you anything (the `sit` /
 * `carry` that follows is refused, silently). Here the refusal is forced: the walk starts 3 tiles from where
 * the server has you.
 */
play('#5 a refused walk puts you back where the server has you', async ({ player, page }) => {
  // fixed 2026-09-29 (the resync's cleared path now arrives as null): this now guards it
  await player.roomScene('cafe');
  const start = await player.me();
  const path = await player.ev(([x0, y0]) => {
    const g = (window as any).__mw;
    const grid = g.grid(g.world.scene.id);
    // a straight run of 3 walkable tiles that starts 3 tiles away from me
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const run = [3, 4, 5].map((k) => [x0 + dx * k, y0 + dy * k]);
      if (run.every(([x, y]) => grid.walkable(x, y))) return run;
    }
    return null;
  }, start.tile);
  expect(path, 'room to walk').not.toBeNull();
  await player.ev(
    (path) =>
      (window as any).__mw.sendOwnPath(
        path,
        Date.now() + ((window as any).__mw.rt?.serverOffset ?? 0),
      ),
    path,
  );
  await page.waitForTimeout(3000);
  const after = await player.me();
  await player.shot('regress-5-refused-walk');
  expect(after.tile, `the server refused the walk and has me at ${start.tile}`).toEqual(start.tile);
});

/**
 * #5 (still open) · Walks that reach the server ~300 ms after they were stamped are refused (OrgHub.move).
 * The server checks where the path says you are *now* — `positionAlong(path, now - startedAt)` — against where
 * it has you, allowing 1.6 tiles; at 4.2 tiles/s that is ~0.38 s of slack for network latency, server load and
 * the client's clock estimate (which ignores latency) together. Measured: stamped 150 ms before the server
 * handles it → accepted; 300, 450, 600 ms → refused. With the resync fixed, a refused walk now snaps you back
 * to where you started ("rubber-banding"); before, it left you walking on your own screen only. Players on a
 * slow connection, or anyone while the server is busy, get walks, sits and orders silently refused.
 */
play(
  '#5 a walk that reaches the server 450 ms after it was stamped is still accepted',
  async ({ player, page }) => {
    await player.roomScene('cafe');
    const start = await player.me();
    const path = await player.ev(([x0, y0]) => {
      const g = (window as any).__mw;
      const grid = g.grid(g.world.scene.id);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]) {
        const run = [0, 1, 2, 3].map((k) => [x0 + dx * k, y0 + dy * k]);
        if (run.slice(1).every(([x, y]) => grid.walkable(x, y))) return run;
      }
      return null;
    }, start.tile);
    expect(path, 'room to walk').not.toBeNull();
    // as if the message took ~225 ms each way (or the server was busy): stamped 450 ms before it's handled
    await player.ev(
      (path) =>
        (window as any).__mw.sendOwnPath(
          path,
          Date.now() + ((window as any).__mw.rt?.serverOffset ?? 0) - 450,
        ),
      path,
    );
    await page.waitForTimeout(2500);
    const after = await player.me();
    await player.shot('regress-5-late-walk');
    expect(after.tile, 'walked to the end of the path (not snapped back)').toEqual(
      path![path!.length - 1],
    );
  },
);

/**
 * #7 · A seat that's also a memory artifact can't be sat on (game.ts onObjectClick).
 * The town's "1,000th Customer Bench" (bench-1000) has both `sit` and `artifact` actions; a click on a seat
 * that's an artifact opens its story card instead of sitting, and the card has no way to sit. So that bench
 * can never be sat on. (Sit on click and show the story alongside, or give the card a Sit button.)
 */
play('#7 the 1,000th Customer Bench can be sat on', async ({ player, page }) => {
  play.setTimeout(180_000);
  await player.enter('town');
  await page.evaluate(() => (window as any).__mw.walkTo([48, 51]));
  await player.still(40_000);
  await player.settle();
  const p = await player.objectPoint('bench-1000', { x: 48, y: 49, z: 10 });
  expect(p, 'the bench is on screen').not.toBeNull();
  await player.click(p!);
  const r = await player.until((m) => m.sittingOn === 'bench-1000' && !m.moving, 15_000);
  await player.shot('regress-7-plaque-bench');
  expect(r.ok, 'sat on the bench').toBe(true);
});
