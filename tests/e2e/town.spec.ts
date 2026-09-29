/**
 * The town, on foot: walk to every building's door and go in by double-clicking it; try to stand inside
 * building fronts and in the lake — you never should.
 */
import { expect, SHOTS, test, type Obj } from './helpers';

test.describe.configure({ mode: 'parallel' });

test('walk to every building and go in', async ({ player, page }) => {
  test.setTimeout(900_000);
  await player.enter('town');
  const scene = await player.scene();
  const buildings = scene.objects.filter((o: Obj) => o.building && o.roomId && o.door);
  expect(buildings.length).toBeGreaterThan(5);
  for (const b of buildings)
    await player.step('town', `going into ${b.roomId}`, async () => {
      const door = b.door!;
      // walk up the street to a few tiles in front of the door (the way a player clicks along the path)…
      const near = await player.ev(
        ([x, y]) => {
          const grid = (window as any).__mw.grid('town');
          for (const [dx, dy] of [
            [0, 3],
            [3, 0],
            [2, 2],
            [0, 2],
            [2, 0],
            [0, 4],
            [4, 0],
            [-2, 2],
            [2, -2],
          ])
            if (grid.walkable(x + dx, y + dy)) return [x + dx, y + dy];
          return null;
        },
        [door.x, door.y] as const,
      );
      if (!near) {
        player.note({
          area: 'town (TOWN agent)',
          what: `${b.roomId}: no open ground in front of its door at ${door.x},${door.y}`,
          shot: await player.full(`door-blocked-${b.roomId}`),
        });
        return;
      }
      await player.page.evaluate((t) => (window as any).__mw.walkTo(t), near);
      const walked = await player.until(
        (m) => !m.moving && m.tile[0] === near[0] && m.tile[1] === near[1],
        30_000,
      );
      await player.settle();
      const doorShot = await player.shot(`door-${b.roomId}`, undefined, 360);
      if (!walked.ok)
        player.note({
          area: 'town (TOWN agent)',
          what: `couldn't walk up to ${b.roomId}'s door (heading for ${near}, stopped at ${walked.me.tile})`,
          shot: doorShot,
        });
      // …then double-click the building, near its door
      const p = await player.objectPoint(b.id, { x: door.x, y: door.y - 1, z: 30 });
      if (!p) {
        player.note({
          area: 'town (TOWN agent)',
          what: `${b.roomId}: the building isn't clickable from in front of its door`,
          shot: await player.full(`building-hidden-${b.roomId}`),
        });
        return;
      }
      await page.mouse.dblclick(p.x, p.y);
      const inside = await page
        .waitForFunction(
          (id) =>
            ((window as any).__mw?.world as any)?.scene?.id === id &&
            !((window as any).__mw.world as any).transition,
          b.roomId,
          { timeout: 20_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!inside)
        player.note({
          area: 'town (TOWN agent)',
          what: `double-clicking ${b.roomId} from in front of its door didn't take me in`,
          shot: await player.full(`noenter-${b.roomId}`),
        });
      else {
        await player.settle();
        await player.shot(`inside-door-${b.roomId}`, undefined, 360);
        await player.enter('town');
      }
    });
  console.log(
    `[town] buildings: ${buildings.length} · ${player.findings.length} finding(s) · redone ${player.redone}`,
  );
  expect.soft(player.findings, player.findings.map((f) => f.what).join('\n')).toEqual([]);
});

test("can't stand inside building fronts or in the lake", async ({ player, page }) => {
  test.setTimeout(900_000);
  await player.enter('town');
  const scene = await player.scene();
  const probes: Array<{ what: string; x: number; y: number }> = [];
  for (const b of scene.objects.filter((o: Obj) => o.building)) {
    const w = b.w ?? 1;
    const d = b.d ?? 1;
    // the front row of the footprint and the row in front of it (stoops, plinths, planters)
    for (let x = b.x; x < b.x + w; x++)
      probes.push(
        { what: `${b.roomId ?? b.id} front`, x, y: b.y + d - 1 },
        { what: `${b.roomId ?? b.id} stoop`, x, y: b.y + d },
      );
    for (let y = b.y; y < b.y + d; y++)
      probes.push(
        { what: `${b.roomId ?? b.id} side`, x: b.x + w - 1, y },
        { what: `${b.roomId ?? b.id} side stoop`, x: b.x + w, y },
      );
  }
  const water: Array<[number, number]> = [];
  scene.tiles.forEach((row, y) =>
    [...row].forEach((c, x) => c === 'w' && (x + y) % 23 === 0 && water.push([x, y])),
  );
  for (const [x, y] of water.slice(0, 12)) probes.push({ what: 'lake', x, y });
  let n = 0;
  let tried = 0;
  for (const pr of probes) {
    if (n++ % 4 && pr.what !== 'lake') continue; // a sample of each building's edges
    tried++;
    await player.step('town', `standing at ${pr.what}`, async () => {
      const t = await player.floorPoint(pr.x + 0.5, pr.y + 0.5);
      await page.mouse.move(t.x, t.y);
      await page.keyboard.press('Escape');
      // walk there by clicking the ground (what's under the pointer may be a building: then it's a double-click away)
      await page.evaluate(([x, y]) => (window as any).__mw.walkTo([x, y]), [pr.x, pr.y] as const);
      const m = await player.still(20_000);
      const onWater =
        scene.tiles[m.tile[1]]?.[m.tile[0]] === 'w' || scene.tiles[m.tile[1]]?.[m.tile[0]] === 'W';
      if (!(await player.walkable(m.tile[0], m.tile[1])) || onWater)
        player.note({
          area: 'town (TOWN agent)',
          what: `heading for ${pr.what} (${pr.x},${pr.y}) left me standing on an unwalkable tile ${m.tile}${onWater ? ' (water)' : ''}`,
          shot: await player.shot(`stand-${pr.what.replace(/\W+/g, '-')}-${pr.x}-${pr.y}`),
        });
    });
  }
  console.log(
    `[town] blocking probes: ${tried} of ${probes.length} · ${player.findings.length} finding(s)`,
  );
  expect.soft(player.findings, player.findings.map((f) => f.what).join('\n')).toEqual([]);
});
