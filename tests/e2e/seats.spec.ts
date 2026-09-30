/**
 * Sitting, the way a player does it: in every room (and town), click every seat — each cushion of a couch or
 * bench — on the cushion you mean, and check you sit exactly there, facing the right way; then click the
 * seat you're on again (it must not move you). Each cushion is sat on twice: once walking over from the last
 * seat, once coming at it from behind or the side (the approach has to find its way round to the front).
 * Every sitting is photographed at 1:1 play zoom.
 */
import { expect, test, type Obj, type Player, type Spot } from './helpers';

test.describe.configure({ mode: 'parallel' });

const SCENES = [
  'cafe',
  'hq',
  'eng',
  'launch',
  'events',
  'focus',
  'arcade',
  'design',
  'town',
] as const;
const VEC: Record<string, [number, number]> = { se: [1, 0], sw: [0, 1], ne: [0, -1], nw: [-1, 0] };
const name = (o: Obj) =>
  `${o.id} (${o.sprite}${o.variant ? '.' + o.variant : ''}, ${o.w ?? 1}×${o.d ?? 1})`;

/** A floor tile behind the seat (or beside it), to come at it from the wrong side. */
async function behind(player: Player, seat: Obj, spot: Spot): Promise<[number, number] | null> {
  const [fx, fy] = VEC[spot.facing] ?? [0, 1];
  const w = seat.w ?? 1;
  const d = seat.d ?? 1;
  const tries: Array<[number, number]> = [];
  for (const k of [2, 3, 1]) tries.push([spot.x - fx * k, spot.y - fy * k]);
  // beside: off either end of the seat (its length runs across the way it faces)
  if (fy) tries.push([seat.x - 1, spot.y], [seat.x + w, spot.y]);
  else tries.push([spot.x, seat.y - 1], [spot.x, seat.y + d]);
  for (const [x, y] of tries) if (await player.walkable(x, y)) return [x, y];
  return null;
}

async function sitOn(
  player: Player,
  sceneId: string,
  seat: Obj,
  spot: Spot,
  tag: string,
  how: string,
) {
  const occ = await player.occupants();
  const me = await player.me();
  if (
    Object.entries(occ).some(
      ([id, o]) => id !== me.id && o.sittingOn === seat.id && o.x === spot.x && o.y === spot.y,
    )
  )
    return 'skipped';
  if (sceneId === 'town') await player.settle();
  let target = await player.objectPoint(seat.id, { x: spot.x, y: spot.y, z: 10 });
  if (!target && sceneId === 'town') {
    // off screen (the town camera follows you): walk towards it first, the way a player would
    const near = await player.ev(
      ([x, y]) => {
        const g = (window as any).__mw;
        const grid = g.grid('town');
        for (let r = 3; r <= 6; r++)
          for (const [dx, dy] of [
            [r, 0],
            [0, r],
            [-r, 0],
            [0, -r],
            [r, r],
            [-r, r],
            [r, -r],
            [-r, -r],
          ])
            if (grid.walkable(x + dx, y + dy)) return [x + dx, y + dy];
        return null;
      },
      [spot.x, spot.y] as const,
    );
    if (near) {
      await player.page.evaluate((t) => (window as any).__mw.walkTo(t), near);
      await player.still(25_000);
      await player.settle();
      target = await player.objectPoint(seat.id, { x: spot.x, y: spot.y, z: 10 });
    }
  }
  if (!target) {
    player.note({
      area: 'seats (SEAT agent)',
      what: `${name(seat)} cushion ${spot.index}: no clickable pixel on screen (hidden behind something?)`,
      shot: await player.full(`unclickable-${tag}`),
    });
    target = await player.floorPoint(spot.x + 0.5, spot.y + 0.5);
  }
  await player.click(target);
  const r = await player.until((m) => m.sittingOn === seat.id && !m.moving, 15_000);
  await player.page.waitForTimeout(300);
  const shot = await player.shot(`seat-${tag}`);
  if (!r.ok) {
    const where = await player.me();
    const inside = !(await player.walkable(where.tile[0], where.tile[1]));
    player.note({
      area: 'seats (SEAT agent)',
      what: `clicking ${name(seat)} cushion ${spot.index} ${how} didn't seat me${where.sittingOn ? ` (sat on ${where.sittingOn} instead)` : ''}${inside && !where.sittingOn ? ' — and I was left standing inside furniture' : ''}`,
      shot,
      detail: { spot, me: where },
    });
    return 'failed';
  }
  const m = r.me;
  if (m.server?.x !== spot.x || m.server?.y !== spot.y)
    player.note({
      area: 'seats (SEAT agent)',
      what: `${name(seat)}: clicked cushion ${spot.index} (${spot.x},${spot.y}) ${how} but was seated at (${m.server?.x},${m.server?.y})`,
      shot,
      detail: { spot, me: m },
    });
  if (m.facing !== spot.facing)
    player.note({
      area: 'seats (SEAT agent)',
      what: `${name(seat)} cushion ${spot.index}: seated facing ${m.facing}, the seat faces ${spot.facing}`,
      shot,
    });
  // clicking the seat you're on again must not move you: beside you, where you're drawn (a sitter sits where the
  // seat's drawing puts them in that facing, not always over the middle of their tile, and from behind their legs
  // cover the cushion; a fresh point: in town the camera has followed you)
  await player.settle();
  const drawn = await player.ev((id) => {
    const g = (window as any).__mw;
    const w = g.world as any;
    const a = w.actors.get(g.meId);
    const o = w.buildDrawOrder().find((e: any) => e.obj?.id === id)?.obj;
    const hip = o && a?.seat ? w.hipOf(o, a.seat.spot) : null;
    return hip ? { x: hip.x - 0.5, y: hip.y - 0.5, z: 10 } : null;
  }, seat.id);
  await player.click(
    (await player.objectPoint(seat.id, drawn ?? { x: spot.x, y: spot.y, z: 10 })) ?? target,
  );
  await player.page.waitForTimeout(1500);
  const again = await player.me();
  if (
    again.sittingOn !== seat.id ||
    again.server?.x !== m.server?.x ||
    again.server?.y !== m.server?.y
  )
    player.note({
      area: 'seats (SEAT agent)',
      what: `re-clicking ${name(seat)} while sitting on it moved me (now ${again.sittingOn ?? 'standing'} at ${again.tile})`,
      shot: await player.shot(`reclick-${tag}`),
      detail: { before: m, after: again },
    });
  return 'sat';
}

async function sitEverywhere(player: Player, sceneId: string, part?: [number, number]) {
  const scene = await player.roomScene(sceneId);
  await player.full(`room-${sceneId}`);
  expect(scene.id).toBe(sceneId);
  const seats = scene.objects
    .filter((o: Obj) => o.actions?.some((a) => a.kind === 'sit'))
    .filter((_, i, all) => !part || Math.floor((i * part[1]) / all.length) === part[0]);
  const stats = { seats: seats.length, spots: 0, sat: 0, failed: 0, skipped: 0, fromBehind: 0 };
  const spotsOf = new Map<string, Spot[]>();
  for (const seat of seats) {
    const spots = await player.seatSpots(seat.id);
    spotsOf.set(seat.id, spots);
    stats.spots += spots.length;
    if (!spots.length)
      player.note({
        area: 'seats (SEAT agent)',
        what: `${name(seat)} has a sit action but no seat spots`,
      });
  }
  // Pass 1: walk over from wherever the last seat was and sit on each cushion in turn (the second cushion of
  // a couch is a shift over from the first).
  for (const seat of seats)
    for (const spot of spotsOf.get(seat.id)!) {
      // (counted once the step is done: a step redone after a reload counts once)
      let r = '';
      const done = await player.step(
        sceneId,
        `sitting on ${seat.id} cushion ${spot.index}`,
        async () => {
          r = await sitOn(
            player,
            sceneId,
            seat,
            spot,
            `${sceneId}-${seat.id}-${spot.index}`,
            'walking over',
          );
        },
      );
      if (done) stats[r === 'sat' ? 'sat' : r === 'failed' ? 'failed' : 'skipped']++;
    }
  // Pass 2: stand up, go round behind (or beside) each seat and sit from there. A separate pass, so the seat
  // you last sat on is always a different one (sitting straight back down on the seat you just left is its
  // own bug, #3 in docs/playtest.md, and would hide everything this pass looks for).
  for (const seat of seats)
    for (const spot of spotsOf.get(seat.id)!) {
      let r = '';
      const done = await player.step(
        sceneId,
        `sitting on ${seat.id} cushion ${spot.index} from behind`,
        async () => {
          await player.reset();
          const from = await behind(player, seat, spot);
          if (!from) return;
          await player.page.evaluate((t) => (window as any).__mw.walkTo(t), from);
          await player.still(15_000);
          r = await sitOn(
            player,
            sceneId,
            seat,
            spot,
            `${sceneId}-${seat.id}-${spot.index}-behind`,
            `from behind/beside (${from})`,
          );
        },
      );
      if (done && r && r !== 'skipped') stats.fromBehind++;
      if (done && r === 'failed') stats.failed++;
    }
  await player.reset();
  return stats;
}

/** The town's seats are far apart (long walks): split into parts that each fit a test's time. */
const TOWN_PARTS = 4;
const RUNS: Array<{ sceneId: string; part?: [number, number] }> = SCENES.flatMap(
  (sceneId): Array<{ sceneId: string; part?: [number, number] }> =>
    sceneId === 'town'
      ? Array.from({ length: TOWN_PARTS }, (_, k) => ({
          sceneId,
          part: [k, TOWN_PARTS] as [number, number],
        }))
      : [{ sceneId }],
);

for (const { sceneId, part } of RUNS) {
  const title = part ? `${sceneId} (part ${part[0] + 1} of ${part[1]})` : sceneId;
  test(`sit on every seat: ${title}`, async ({ player }, info) => {
    test.setTimeout(1_200_000);
    const stats = await sitEverywhere(player, sceneId, part);
    info.annotations.push({ type: 'coverage', description: JSON.stringify(stats) });
    console.log(
      `[seats] ${title}: ${JSON.stringify(stats)} · ${player.findings.length} finding(s) · redone ${player.redone}`,
    );
    expect
      .soft(player.findings, player.findings.map((f) => f.what).join(String.fromCharCode(10)))
      .toEqual([]);
  });
}
