/**
 * Spamming clicks never makes a figure glitch. Walking: every click used to restart the walk from the tile's
 * centre (a visible judder); now the step in progress finishes and the new way continues from its end. Doors:
 * clicking one over and over used to send an 'enter' per click; now one trip, one 'enter'.
 */
import { expect, Player, test } from './helpers';

/** Where my figure is drawn, every frame, for a while. */
async function record(player: Player, frames: number) {
  const me = await player.me();
  await player.ev(
    ([id, n]) => {
      const w = (window as any).__mw.world;
      const rec: Array<[number, number, number]> = [];
      (window as any).__spamRec = rec;
      const tick = (t: number) => {
        const a = w.actors.get(id);
        if (a) rec.push([t, a.x, a.y]);
        if (rec.length < n) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [me.id, frames] as const,
  );
}
const recorded = (player: Player) => player.ev(() => (window as any).__spamRec as Array<[number, number, number]>);

/** The biggest move between two consecutive frames, in tiles (a snap to a tile centre mid-step is ≥ 0.3). */
function worstStep(rec: Array<[number, number, number]>) {
  let worst = 0;
  for (let i = 1; i < rec.length; i++) {
    const dt = Math.max(1, rec[i][0] - rec[i - 1][0]);
    const d = Math.hypot(rec[i][1] - rec[i - 1][1], rec[i][2] - rec[i - 1][2]);
    // allow for a long frame (the walk moves 4.2 tiles/s): judge the jump beyond what that time accounts for
    worst = Math.max(worst, d - (4.2 * dt) / 1000);
  }
  return worst;
}

test('spamming clicks while walking never snaps the figure', async ({ player }) => {
  test.setTimeout(120_000);
  await player.roomScene('cafe');
  await player.settle();
  const me = await player.me();
  // two walkable targets a few tiles apart, to click between as fast as a hand can
  const targets = await player.ev(([x0, y0]) => {
    const g = (window as any).__mw;
    const grid = g.grid(g.world.scene.id);
    const out: Array<[number, number]> = [];
    // plain floor, away from the exit wall (x = 0) and the back walls, with clear floor around it
    const clear = (x: number, y: number) => x >= 3 && y >= 3 && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => grid.walkable(x + a, y + b));
    const far = (x: number, y: number) => Math.hypot(x - x0, y - y0) >= 3 && out.every((t) => Math.hypot(x - t[0], y - t[1]) >= 4);
    const scene = g.scene(g.world.scene.id);
    for (let y = 2; y < scene.height - 1 && out.length < 2; y++)
      for (let x = 2; x < scene.width - 1 && out.length < 2; x++) if (clear(x, y) && far(x, y)) out.push([x, y]);
    return out;
  }, me.tile);
  expect(targets.length, 'room to walk in').toBe(2);
  const points = [await player.floorPoint(targets[0][0], targets[0][1]), await player.floorPoint(targets[1][0], targets[1][1])];
  await record(player, 420);
  // 24 clicks in ~1.5 s, alternating targets: each one re-routes mid-step
  for (let i = 0; i < 24; i++) {
    await player.page.mouse.click(points[i % 2].x, points[i % 2].y);
    await player.page.waitForTimeout(60);
  }
  await player.page.waitForTimeout(4000);
  const rec = await recorded(player);
  expect(rec.length, 'frames recorded').toBeGreaterThan(60);
  expect(worstStep(rec), 'the biggest jump between two frames beyond walking speed (tiles)').toBeLessThan(0.25);
  // and we end up at the last target, standing still
  const last = targets[23 % 2];
  await player.settle(6000);
  const after = await player.me();
  expect(after.sceneId, 'still in the café').toBe('cafe');
  expect(Math.hypot(after.tile[0] - last[0], after.tile[1] - last[1]), 'arrived at the last click (tiles off)').toBeLessThanOrEqual(1);
});

test('spamming a door sends one trip, not one per click', async ({ player }) => {
  test.setTimeout(120_000);
  await player.roomScene('cafe');
  await player.settle();
  // what a click on the exit door does, twelve times in a second
  const trips = async (call: string, to: string) => {
    await player.ev(() => {
      (window as any).__sceneLog = [] as string[];
      (window as any).__enters = [] as string[];
      const g = (window as any).__mw;
      if (!g.rt.__wrapped) {
        const orig = g.rt.send.bind(g.rt);
        g.rt.send = (m: any) => {
          if (m.t === 'enter') (window as any).__enters.push(`${m.sceneId}@${Date.now() % 100000}`);
          return orig(m);
        };
        g.rt.__wrapped = true;
      }
      // one watcher at a time (an earlier trip's watcher would log this arrival too)
      const gen = ((window as any).__sceneGen = ((window as any).__sceneGen ?? 0) + 1);
      let last = g.world?.scene?.id;
      const tick = () => {
        if ((window as any).__sceneGen !== gen) return;
        const cur = g.world?.scene?.id;
        if (cur && cur !== last) {
          last = cur;
          (window as any).__sceneLog.push(cur);
        }
        if ((window as any).__sceneLog.length < 10) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    for (let i = 0; i < 12; i++) {
      await player.ev((c) => void (window as any).__mw[c](...(c === 'enterRoom' ? ['cafe'] : [])), call);
      await player.page.waitForTimeout(80);
    }
    const arrived = await player.until((m) => m.sceneId === to, 25_000);
    expect(arrived.ok, `the door took us to ${to}`).toBe(true);
    await player.page.waitForTimeout(4000);
    const enters = await player.ev(() => (window as any).__enters as string[]);
    expect(enters, `one 'enter' sent to the server (sent ${JSON.stringify(enters)})`).toHaveLength(1);
    return player.ev(() => (window as any).__sceneLog as string[]);
  };
  expect(await trips('exitToTown', 'town'), 'one arrival in town, no re-entries').toEqual(['town']);
  await player.settle();
  const back = await trips('enterRoom', 'cafe');
  expect(back, `one arrival in the café, no re-entries (saw ${JSON.stringify(back)})`).toEqual(['cafe']);
  expect(await player.alive('after door spam')).toBe(true);
});
