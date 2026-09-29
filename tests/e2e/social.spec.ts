/**
 * The social surface: clicking people opens their card (docked bottom-right, Habbo style); finding someone
 * from search opens their card without moving you; the wardrobe changes how you look; carrying a coffee is
 * visible.
 */
import { expect, SHOTS, test } from './helpers';

test('clicking a person opens their card, docked bottom-right', async ({ player, page }) => {
  await player.enter('cafe');
  const occ = await player.occupants();
  const me = await player.me();
  const someone = Object.keys(occ).find((id) => id !== me.id && !id.startsWith('npc:'));
  test.skip(!someone, 'nobody else in the café right now');
  const p = await player.actorPoint(someone!);
  expect(p, 'a person on screen to click').not.toBeNull();
  await player.click(p!);
  const card = page.locator('aside.infostand[aria-label$=" profile"]');
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  const vp = page.viewportSize()!;
  await player.full('card-person');
  // docked bottom-right of the play area (the room panel may sit to its right)
  if (box.x + box.width < vp.width * 0.75 || box.y + box.height < vp.height - 150)
    player.note({
      area: 'HUD (main session)',
      what: `the profile card isn't docked bottom-right (it's at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)})`,
      shot: `${SHOTS}/card-person.png`,
    });
  expect.soft(player.findings).toEqual([]);
});

test('search: picking a person opens their card and does not move you', async ({
  player,
  page,
}) => {
  await player.enter('cafe');
  const before = await player.me();
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder(/Find Maya/);
  await expect(input).toBeVisible();
  await input.fill('Grace');
  await page
    .getByRole('option', { name: /Grace Whitfield/ })
    .first()
    .click();
  const card = page.locator('[role=dialog][aria-label="Grace Whitfield profile"]');
  await expect(card).toBeVisible();
  await page.waitForTimeout(1500);
  const after = await player.me();
  await player.full('search-card');
  expect(after.sceneId, 'still in the same room').toBe(before.sceneId);
  expect(after.tile, 'not moved').toEqual(before.tile);
  await expect(card.getByRole('button', { name: /go to|join/i })).toBeVisible();
});

test('wardrobe: soft body, surprise me, wear it', async ({ player, page }) => {
  const look0 = await player.ev(() => {
    const g = (window as any).__mw;
    return JSON.stringify((g.world as any).actors.get(g.meId).occ.avatar);
  });
  await page.getByRole('button', { name: 'Your menu' }).click();
  await page.getByRole('menuitem', { name: /Wardrobe/ }).click();
  await page;
  await page
    .getByRole('tab', { name: /Body/ })
    .click({ timeout: 5000 })
    .catch(() => undefined);
  await page
    .getByRole('radiogroup', { name: 'Body type' })
    .getByRole('radio', { name: /Soft/ })
    .click();
  await player.full('wardrobe-soft');
  await page.getByRole('button', { name: /Surprise me/ }).click();
  await player.full('wardrobe-surprise');
  await page.getByRole('button', { name: /Wear it/ }).click();
  await page.waitForTimeout(2000);
  const look1 = await player.ev(() => {
    const g = (window as any).__mw;
    return JSON.stringify((g.world as any).actors.get(g.meId).occ.avatar);
  });
  await player.shot('wardrobe-worn');
  expect(look1).not.toBe(look0);
});

test('a coffee from Juno is visible in your hand from every side', async ({ player, page }) => {
  await player.enter('cafe');
  const scene = await player.scene();
  const machine = scene.objects.find((o) => o.sprite === 'espresso')!;
  const p = await player.objectPoint(machine.id);
  expect(p).not.toBeNull();
  await player.click(p!);
  const r = await player.until((m) => m.carrying === 'coffee', 30_000);
  expect(r.ok, 'handed a coffee').toBe(true);
  await player.shot('coffee-at-counter', undefined, 240);
  // walk to a few open tiles so we see ourselves from different sides
  for (const [x, y] of [
    [4, 7],
    [9, 6],
    [2, 5],
  ] as const) {
    if (!(await player.walkable(x, y))) continue;
    const t = await player.floorPoint(x + 0.5, y + 0.5);
    await page.mouse.click(t.x, t.y);
    const m = await player.still();
    await player.shot(`coffee-walk-${x}-${y}-${m.facing}`, undefined, 240);
  }
  await expect(page.getByRole('button', { name: /put (it )?down/i }).first()).toBeVisible();
});
