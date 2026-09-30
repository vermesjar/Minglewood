/**
 * Wall furniture, played: a real decorate session in Lantern Hall. Open the palette, pick the Wall category, point
 * at each back wall (the ghost says whether it fits), hang a poster on each wall and a window, try a spot that's
 * taken, move a piece along the wall, reload, and check it all came back where it was, drawn at the wall art
 * standard, the window with its view and its sun. A big window goes up in the lobby (its one free stretch). Every
 * piece is taken down again at the end, so the world is as it was.
 *
 * Screenshots (play scale = camera zoom 2, and 4x) land in art/review/wallfurn-*.png.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

type Face = 'left' | 'right';
const SHOT = (name: string) => `art/review/wallfurn-${name}.png`;

/** A point on a back wall (u tiles along it, v wall units up it), on the page. */
const wallPoint = (page: Page, face: Face, u: number, v: number) =>
  page.evaluate(
    ([face, u, v]) => {
      const w = (window as any).__mw.world;
      const [sx, sy] = w.camera.toScreen(face === 'right' ? u * 16 : -u * 16, u * 8 - v, w.vw, w.vh);
      const r = w.canvas.getBoundingClientRect();
      return { x: r.left + sx, y: r.top + sy };
    },
    [face, u, v] as const,
  );

/** The team pieces in a room, as the scene has them. */
const teamPieces = (page: Page, room: string) =>
  page.evaluate(
    (room) =>
      (window as any).__mw
        .scene(room)
        .objects.filter((o: any) => o.id.startsWith('decor-'))
        .map((o: any) => ({ id: o.id.slice(6), sprite: o.sprite, variant: o.variant, wall: o.wall, x: o.x, y: o.y, w: o.w, d: o.d })),
    room,
  ) as Promise<Array<{ id: string; sprite: string; variant?: string; wall?: Face; x: number; y: number; w?: number; d?: number }>>;

const ghost = (page: Page) => page.evaluate(() => (window as any).__mw.world.ghost && { valid: (window as any).__mw.world.ghost.valid, ...(({ wall, x, y }: any) => ({ wall, x, y }))((window as any).__mw.world.ghost.obj) });

/** The room's windows (the live view is painted through each) and how much sun its floor catches. */
const light = (page: Page) =>
  page.evaluate(() => {
    const g = (window as any).__mw.world.ground;
    const sun = g.sun as HTMLCanvasElement;
    const d = sun.getContext('2d')!.getImageData(0, 0, sun.width, sun.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
    return { windows: g.windows.map((w: any) => ({ face: w.face, u0: +w.u0.toFixed(2), u1: +w.u1.toFixed(2) })) as Array<{ face: Face; u0: number; u1: number }>, lit };
  });

/** Frame the room's back walls at a zoom (2 = play scale), the camera held still. */
async function frame(page: Page, zoom: number, at?: { face: Face; u: number }) {
  await page.evaluate(
    ([zoom, at]) => {
      const w = (window as any).__mw.world;
      const s = w.scene;
      const [x, y] = at ? [(at.face === 'right' ? 16 : -16) * at.u, at.u * 8 - 34] : [((s.width - s.height) * 16) / 2, ((s.width + s.height) * 8) / 2 - 90];
      w.camera.jump(x, y, zoom);
    },
    [zoom, at ?? null] as const,
  );
  await page.waitForTimeout(350);
}

/** A 4x crop of one stretch of wall. */
async function wallShot(page: Page, name: string, face: Face, u0: number, span: number) {
  await frame(page, 4, { face, u: u0 + span / 2 });
  const vp = page.viewportSize()!;
  const w = (span * 16 + 40) * 4;
  const h = (70 + span * 8) * 4;
  await page.screenshot({ path: SHOT(name), clip: { x: Math.round(vp.width / 2 - w / 2), y: Math.round(vp.height / 2 - h / 2), width: w, height: h } });
}

async function openPalette(page: Page) {
  const btn = page.getByRole('button', { name: /Decorate our space/ });
  if (await btn.isVisible().catch(() => false)) await btn.click();
  else await page.evaluate(() => (window as any).__mw.setDecorate({ itemId: null }));
  await expect(page.getByRole('toolbar', { name: 'Decorate this room' })).toBeVisible();
}

async function pick(page: Page, itemId: string) {
  await page.getByRole('tab', { name: /Wall/ }).click();
  await page.locator(`[data-item="${itemId}"]`).click();
}

/** Point at a wall and click it: the piece hangs with its span centred on the pointer. */
async function hang(page: Page, room: string, face: Face, u: number, v = 30) {
  const before = (await teamPieces(page, room)).length;
  const p = await wallPoint(page, face, u, v);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(250);
  const g = await ghost(page);
  await page.mouse.click(p.x, p.y);
  if (g?.valid) await expect.poll(async () => (await teamPieces(page, room)).length, { timeout: 8000 }).toBe(before + 1);
  return g;
}

test('wall furniture: hang, move, reload, and it stays', async ({ player, page }) => {
  test.setTimeout(240_000);
  const room = 'events';
  await player.enter(room);
  await player.settle(1500);
  // start clean: nothing of ours on these walls from an earlier run
  const clear = async (r: string) => {
    for (const d of await teamPieces(page, r)) if (d.wall) await page.evaluate(([r, id]) => fetch(`/api/rooms/${r}/decor/${id}`, { method: 'DELETE', credentials: 'same-origin' }), [r, d.id] as const);
  };
  await clear(room);
  await expect.poll(async () => (await teamPieces(page, room)).filter((d) => d.wall).length).toBe(0);
  const before = await light(page);

  await openPalette(page);
  await page.getByRole('tab', { name: /Wall/ }).click();
  await page.waitForTimeout(300);
  await page.locator('.decorate').screenshot({ path: SHOT('palette') });
  await frame(page, 2);

  // a poster on the right wall: the ghost is green where it fits…
  await pick(page, 'wall:poster.ship');
  let p = await wallPoint(page, 'right', 0.5, 30);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(300);
  expect(await ghost(page)).toMatchObject({ valid: true, wall: 'right', x: 0 });
  await page.screenshot({ path: SHOT('ghost-fits-z2') });
  // …and red over the banner (taken), and clicking there hangs nothing
  p = await wallPoint(page, 'right', 7.5, 40);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(300);
  expect(await ghost(page)).toMatchObject({ valid: false, wall: 'right' });
  await page.screenshot({ path: SHOT('ghost-taken-z2') });
  const n0 = (await teamPieces(page, room)).length;
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(1200);
  expect((await teamPieces(page, room)).length).toBe(n0);

  // hang it on the right wall, then another on the left wall, then a window
  expect(await hang(page, room, 'right', 0.5)).toMatchObject({ valid: true });
  expect(await hang(page, room, 'left', 8.5)).toMatchObject({ valid: true });
  await pick(page, 'wall:window-small');
  expect(await hang(page, room, 'left', 2.5)).toMatchObject({ valid: true });
  let mine = await teamPieces(page, room);
  expect(mine.filter((d) => d.wall)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sprite: 'poster', variant: 'ship', wall: 'right', x: 0, y: 0 }),
      expect.objectContaining({ sprite: 'poster', variant: 'ship', wall: 'left', x: 0, y: 8 }),
      expect.objectContaining({ sprite: 'window', wall: 'left', x: 0, y: 2 }),
    ]),
  );

  // move the right-wall poster along to the free stretch at 4
  await page.locator('[data-tool="move"]').click();
  await page.waitForTimeout(200);
  p = await wallPoint(page, 'right', 0.5, 33);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => (window as any).__mw && JSON.stringify((window as any).__mw.world.decorMode))).toBe('"wall"');
  const moved = mine.find((d) => d.wall === 'right')!;
  p = await wallPoint(page, 'right', 4.5, 30);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(250);
  expect(await ghost(page)).toMatchObject({ valid: true, wall: 'right', x: 4 });
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await teamPieces(page, room)).find((d) => d.id === moved.id)?.x, { timeout: 8000 }).toBe(4);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.mouse.move(5, 5);

  // reload: everything comes back where it was, and the window has its view and its sun
  await player.boot();
  await player.enter(room);
  await player.settle(1500);
  mine = (await teamPieces(page, room)).filter((d) => d.wall);
  expect(mine).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sprite: 'poster', wall: 'right', x: 4 }),
      expect.objectContaining({ sprite: 'poster', wall: 'left', y: 8 }),
      expect.objectContaining({ sprite: 'window', wall: 'left', y: 2 }),
    ]),
  );
  // the new window's glass is cut for the live view outside, and its sun falls on the floor like the others'
  const after = await light(page);
  expect(after.windows.length).toBe(before.windows.length + 1);
  expect(after.windows).toEqual(expect.arrayContaining([{ face: 'left', u0: 2.16, u1: 2.84 }]));
  expect(after.lit).toBeGreaterThan(before.lit);
  await frame(page, 2);
  await page.screenshot({ path: SHOT('events-z2') });
  await wallShot(page, 'events-right-poster-z4', 'right', 4, 1);
  await wallShot(page, 'events-left-poster-z4', 'left', 8, 1);
  await wallShot(page, 'events-left-window-z4', 'left', 2, 1);

  // a full-size window in the lobby, on its one free stretch of wall
  await player.enter('hq');
  await player.settle(1500);
  await clear('hq');
  await openPalette(page);
  await frame(page, 2);
  await pick(page, 'wall:window');
  expect(await hang(page, 'hq', 'right', 11)).toMatchObject({ valid: true, x: 10 });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  await frame(page, 2);
  await page.screenshot({ path: SHOT('hq-z2') });
  await wallShot(page, 'hq-window-z4', 'right', 10, 2);

  // take it all down again (the remove tool for one, the rest directly)
  await openPalette(page);
  await page.locator('[data-tool="remove"]').click();
  await frame(page, 2);
  p = await wallPoint(page, 'right', 11, 30);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await teamPieces(page, 'hq')).filter((d) => d.wall).length, { timeout: 8000 }).toBe(0);
  await page.getByRole('button', { name: 'Done' }).click();
  await clear(room);
});
