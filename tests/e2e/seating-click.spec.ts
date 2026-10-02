import { test, expect } from './helpers';

test('a seat beside a desk stays clickable and its body cannot idle-turn', async ({ player }) => {
  test.setTimeout(120_000);
  await player.enter('eng');
  await player.reset();
  await player.ev(() => (window as any).__mw.walkTo([2, 6]));
  await player.still(15_000);
  const at = await player.objectPoint('eng-meet-chair', { x: 2, y: 8, z: 10 });
  expect(at).toBeTruthy();
  await player.click(at!);
  const sat = await player.until(m => m.sittingOn === 'eng-meet-chair', 15_000);
  expect(sat.ok, JSON.stringify({ at, sat })).toBe(true);
  // Exercise the gap between local arrival and server confirmation deliberately.
  const facings = await player.ev(() => {
    const g = (window as any).__mw, w = g.world, a = w.actors.get(g.meId);
    const sittingOn = a.occ.sittingOn, idle = a.idle, facing = a.facing;
    const expected = a.seat.spot.facing;
    a.occ.sittingOn = undefined;
    a.facing = expected === 'ne' ? 'sw' : 'ne';
    a.idle = { kind: 'glance', facing: a.facing, until: performance.now() + 2000 };
    const actual = w.viewFacing(a);
    w.tickLife(a, performance.now());
    const cancelled = !a.idle;
    a.occ.sittingOn = sittingOn; a.idle = idle; a.facing = facing;
    return { expected, actual, cancelled };
  });
  expect(facings.actual).toBe(facings.expected);
  expect(facings.cancelled).toBe(true);
});
