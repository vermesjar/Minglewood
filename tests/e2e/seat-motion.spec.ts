/**
 * The seat standard in motion, the way a player does it and the way the room sees it: walk to a couch and sit
 * down, click your own cushion again (nothing happens), click the other cushion (you shift over), click a
 * chair across the room (you get up, walk there and sit), stand up (you step off onto the floor); then walk
 * up to that chair from in front, from behind and from the side and sit each time. A second player in the
 * room watches. Both views are sampled every frame:
 *
 *   - no teleporting: the figure's floor point never jumps (walking pace, the sit-down's small slide into
 *     the seat, the step off — nothing faster)
 *   - into a seat through a crouch (the pose between standing and sitting)
 *   - never standing inside furniture
 *   - never vanishing behind the seat you're walking up to (the seat drawn over you before you sit)
 *   - the watcher sees the same sittings, on the same cushions
 *
 * A run the dev server restarts under (someone editing the app) doesn't count and runs again.
 * Seat bugs go to the seat standard (src/shared/world/seats.ts, WorldView's seated parts).
 */
import { existsSync } from 'node:fs';
import { request } from '@playwright/test';
import { AUTH_DIR, TAG } from './global-setup';
import { expect, Player, SHOTS, test, type Finding, type Obj, type Spot } from './helpers';

/** Every room with seats, and the town's benches (SEAT_MOTION_ROOMS=cafe,hq narrows it). */
const ROOMS = (
  process.env.SEAT_MOTION_ROOMS ?? 'cafe,hq,eng,launch,events,focus,arcade,design,town'
).split(',');
/** One watcher per worker (a member can only be in one room at a time). */
const watcherFile = (worker: number) => `${AUTH_DIR}/seat-watcher${TAG}-${worker}.json`;

test.describe.configure({ mode: 'parallel' });

interface Frame {
  t: number;
  /** The figure's floor point (drawn anchor with the seat lift taken off), world px. */
  x: number;
  y: number;
  pose: string;
  tile: [number, number];
  sittingOn: string | null;
  moving: boolean;
  /** How far into a seat (0 standing … 1 seated). */
  k: number;
  /** Walking up to a seat: opaque pixels of that seat drawn over the walker's body. */
  covered: number;
  /** Raw state, for when a run needs explaining (SEAT_MOTION_DUMP=1 writes the frames out). */
  raw?: unknown;
}

/** A sign-in for the watcher, made once and reused (demo sign-ups persist and are rate limited). */
async function watcherState(baseURL: string, WATCHER: string) {
  if (existsSync(WATCHER)) {
    const ctx = await request.newContext({ baseURL, storageState: WATCHER });
    const ok = (await ctx.get('/api/bootstrap')).ok();
    await ctx.dispose();
    if (ok) return WATCHER;
  }
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/auth/demo', {
    data: {
      name: `Seat Watcher ${WATCHER.match(/(\d+)\.json$/)?.[1] ?? ''}`.trim(),
      teamId: 'team-aurora',
      interests: ['coffee'],
    },
  });
  const { memberId } = (await res.json()) as { memberId: string };
  const state = await ctx.storageState({ path: WATCHER });
  state.origins = [
    { origin: baseURL, localStorage: [{ name: `mw.welcomed.${memberId}`, value: '1' }] },
  ];
  const { writeFileSync } = await import('node:fs');
  writeFileSync(WATCHER, JSON.stringify(state, null, 2));
  await ctx.dispose();
  return WATCHER;
}

/**
 * Start sampling someone's figure every frame on a page, and what the page says and hears about seats.
 * `__seatRec.target` (a seat id) makes it also measure how much of that seat is drawn over the walker.
 */
async function record(p: Player, memberId: string) {
  await p.ev((id) => {
    const g = (window as any).__mw;
    const w = g.world as any;
    const rec = {
      id,
      on: true,
      target: null as string | null,
      frames: [] as Frame[],
      wire: [] as Array<{ at: number; dir: string; msg: string }>,
    };
    (window as any).__seatRec = rec;
    const seatMsg = (m: unknown) => {
      const s = JSON.stringify(m);
      if (/^\{"t":"(scene|error)"/.test(s)) return s.slice(0, 120);
      return s.includes(id) || /"t":"(sit|stand|move)"/.test(s) ? s.slice(0, 300) : null;
    };
    const send = g.rt.send.bind(g.rt);
    g.rt.send = (m: unknown) => {
      const s = seatMsg(m);
      if (rec.on && s) rec.wire.push({ at: Date.now(), dir: 'out', msg: s });
      return send(m);
    };
    const onMessage = g.onMessage.bind(g);
    g.onMessage = (m: unknown) => {
      const s = seatMsg(m);
      if (rec.on && s) rec.wire.push({ at: Date.now(), dir: 'in', msg: s });
      return onMessage(m);
    };
    /** Opaque pixels of the target seat drawn over the walker's body (their rect, less the head's margin). */
    const covered = (a: any) => {
      if (!rec.target) return 0;
      const order = w.buildDrawOrder();
      const ia = order.indexOf(a);
      const is = order.findIndex((d: any) => d.obj && d.obj.id === rec.target);
      if (is < 0 || ia < 0 || is < ia) return 0;
      const d = order[is];
      // (behind it, it may cover you: only in front of it, or on it, is being covered vanishing)
      if (Math.round(a.x) + Math.round(a.y) < d.box.x0 + d.box.y0) return 0;
      const k = d.sprite.scale ?? 1;
      const cw = d.sprite.canvas.width;
      const r = a.rect;
      let n = 0;
      for (let y = Math.ceil(r.t + 10); y < r.b; y++)
        for (let x = Math.ceil(r.l + 6); x < r.r - 6; x++) {
          const px = Math.floor((x - d.dx) * k);
          const py = Math.floor((y - d.dy) * k);
          if (px >= 0 && py >= 0 && px < cw && py < d.sprite.canvas.height && d.sprite.mask[py * cw + px]) n++;
        }
      return n;
    };
    const tick = () => {
      if (!rec.on) return;
      const a = w.actors.get(rec.id);
      if (a) {
        // (the lift it was drawn with, not one worked out a moment later: that could be mid-crouch)
        const lift = a.lift ?? w.actorLift(a);
        const k = w.seatK(a);
        rec.frames.push({
          t: performance.now(),
          x: a.sx,
          y: a.sy + lift,
          pose: w.pose(a),
          tile: [Math.round(a.x), Math.round(a.y)],
          sittingOn: a.occ.sittingOn ?? null,
          moving: !!a.moving,
          k,
          covered: k > 0 || !a.moving ? 0 : covered(a),
          raw: {
            wall: Date.now(),
            ax: a.x,
            ay: a.y,
            ox: a.occ.x,
            oy: a.occ.y,
            seat: a.seat ? { ...a.seat } : null,
            step: a.stepOff ?? null,
            path: a.occ.path ?? null,
            target: rec.target,
          },
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, memberId);
}

async function stopRecording(p: Player): Promise<{ frames: Frame[]; wire: Array<{ at: number; dir: string; msg: string }> } | null> {
  return p.page
    .evaluate(() => {
      const rec = (window as any).__seatRec;
      if (!rec) return null;
      rec.on = false;
      return { frames: rec.frames as Frame[], wire: rec.wire };
    })
    .catch(() => null);
}

const SIT_POSES = new Set(['sit', 'sit-stool', 'sit-lounge', 'sit-floor']);

/** What went wrong in a run of frames, as a viewer saw it. */
function judge(frames: Frame[], seatTiles: Set<string>, who: string): string[] {
  const out: string[] = [];
  // no teleporting in and out of seats: faster than twice walking pace (plus a few px of slack) between two
  // frames is a jump (walking about is the network's business: a watcher's clock can start a walk late)
  const seatish = (f: Frame) => f.k > 0 || !!f.sittingOn || f.pose === 'crouch' || !!(f.raw as { step?: unknown } | undefined)?.step;
  let worst = { ratio: 0, i: 0, d: 0 };
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (!seatish(a) && !seatish(b)) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const allowed = 4 + 0.15 * (b.t - a.t);
    if (d / allowed > worst.ratio) worst = { ratio: d / allowed, i, d };
  }
  if (worst.ratio > 1) {
    const b = frames[worst.i];
    out.push(`${who}: the figure jumped ${worst.d.toFixed(1)} px in one frame (${frames[worst.i - 1].pose} → ${b.pose} at tile ${b.tile})`);
  }
  // into every seat through a crouch (at a frame rate that could show it: it lasts about 70 ms)
  for (let i = 1; i < frames.length; i++)
    if (frames[i].t - frames[i - 1].t < 40 && SIT_POSES.has(frames[i].pose) && !SIT_POSES.has(frames[i - 1].pose) && frames[i - 1].pose !== 'crouch') {
      const back = frames.slice(Math.max(0, i - 12), i);
      if (!back.some((f) => f.pose === 'crouch')) out.push(`${who}: sat down at tile ${frames[i].tile} without the crouch (${frames[i - 1].pose} → ${frames[i].pose})`);
    }
  // never standing inside furniture (more than a couple of frames)
  let run = 0;
  for (const f of frames) {
    const inSeat = seatTiles.has(`${f.tile[0]},${f.tile[1]}`);
    run = inSeat && (f.pose === 'stand' || f.pose.startsWith('walk') || f.pose.startsWith('pass')) && !f.moving ? run + 1 : 0;
    if (run === 4) out.push(`${who}: stood inside a seat at tile ${f.tile} (${f.pose})`);
  }
  // never vanishing behind the seat on the way up to it (a sliver of a leg behind a chair leg is fine)
  const hidden = frames.filter((f) => f.covered > 40);
  if (hidden.length) {
    const f = hidden.reduce((p, q) => (q.covered > p.covered ? q : p));
    out.push(`${who}: walking up to a seat, it was drawn over me (${f.covered} px of my body, at tile ${f.tile}, ${hidden.length} frame(s))`);
  }
  return out;
}

type Info = { annotations: Array<{ type: string; description?: string }> };

/**
 * One walk-through in a room. Returns false when the run was disturbed (a page reloaded, or the dev server
 * restarted and sent the room afresh) — what it saw doesn't count, and it runs again.
 */
async function walkThrough(player: Player, watcher: Player, ROOM: string, info: Info): Promise<boolean> {
  // (a hot reload from someone editing the app drops you back in town: go back in)
  let scene = await player.roomScene(ROOM);
  for (let i = 0; i < 3 && scene.id !== ROOM; i++) scene = await player.roomScene(ROOM);
  await watcher.enter(ROOM);
  const me = await player.me();
  const seats = scene.objects.filter((o: Obj) => o.actions?.some((a) => a.kind === 'sit'));
  const spotsOf = new Map<string, Spot[]>();
  for (const s of seats) spotsOf.set(s.id, await player.seatSpots(s.id));
  const seatTiles = new Set([...spotsOf.values()].flat().map((s) => `${s.x},${s.y}`));
  const occ = await player.occupants();
  const free = (s: Obj) =>
    spotsOf.get(s.id)!.every((sp) => !Object.entries(occ).some(([id, o]) => id !== me.id && o.sittingOn === s.id && o.x === sp.x && o.y === sp.y));
  // seats a player can click (one tucked behind a table or a counter is a finding for seats.spec)
  const clickable = async (s: Obj) => {
    for (const sp of spotsOf.get(s.id)!) if (!(await player.objectPoint(s.id, { x: sp.x, y: sp.y, z: 10 }))) return false;
    return true;
  };
  let couch: Obj | undefined;
  for (const s of seats) if (!couch && spotsOf.get(s.id)!.length > 1 && free(s) && (await clickable(s))) couch = s;
  let chair: Obj | undefined;
  for (const s of seats) if (!chair && spotsOf.get(s.id)!.length === 1 && free(s) && (await clickable(s))) chair = s;
  // (a room without a free chair right now has nothing for this walk-through; without a free two-seater, the
  // couch part is left out)
  if (!chair) {
    test.skip(true, `${ROOM}: no free chair right now`);
    return true;
  }
  if (!couch) info.annotations.push({ type: 'skipped', description: `${ROOM}: no free two-seater right now (shift-over not tried)` });
  const [ch] = spotsOf.get(chair.id)!;
  const seen: Finding[] = [];
  const note = (what: string, detail?: unknown) => seen.push({ area: 'seats (SEAT agent)', what, detail });
  const target = async (id: string | null) => {
    for (const p of [player, watcher]) await p.page.evaluate((t) => ((window as any).__seatRec.target = t), id).catch(() => undefined);
  };

  const sitOnSpot = async (seat: Obj, spot: Spot, what: string) => {
    const at = await player.objectPoint(seat.id, { x: spot.x, y: spot.y, z: 10 });
    if (!at) {
      note(`${what}: no clickable pixel of ${seat.id} cushion ${spot.index}`);
      return null;
    }
    await target(seat.id);
    await player.click(at);
    const r = await player.until((m) => m.sittingOn === seat.id && m.server?.x === spot.x && m.server?.y === spot.y && !m.moving, 15_000);
    await target(null);
    await player.page.waitForTimeout(500);
    await player.shot(`seat-motion-${ROOM}-${what}`);
    if (!r.ok) note(`${what}: clicking ${seat.id} cushion ${spot.index} didn't seat me there`, r.me);
    return at;
  };
  const standUp = async (what: string) => {
    await player.page.evaluate(() => (window as any).__mw.rt?.send({ t: 'stand' }));
    const up = await player.until((m) => !m.sittingOn, 5000);
    await player.page.waitForTimeout(800);
    await player.shot(`seat-motion-${ROOM}-${what}`);
    const after = await player.me();
    if (!up.ok) note(`${what}: standing up didn’t`, up.me);
    else if (seatTiles.has(`${after.tile[0]},${after.tile[1]}`) || !(await player.walkable(after.tile[0], after.tile[1]))) note(`${what}: stood up into furniture at ${after.tile}`);
  };
  /** Walk to a floor tile two steps off the chair (in front, behind, beside), then click it and sit. */
  const approach = async (dx: number, dy: number, what: string) => {
    for (const k of [2, 3]) {
      const t: [number, number] = [ch.x + dx * k, ch.y + dy * k];
      if (!(await player.walkable(t[0], t[1]))) continue;
      await player.page.evaluate((tt) => (window as any).__mw.walkTo(tt), t);
      await player.still(15_000);
      await sitOnSpot(chair, ch, what);
      await standUp(`${what}-up`);
      return;
    }
  };

  await player.reset();
  const loads = [player.loads, watcher.loads];
  await record(player, me.id);
  await record(watcher, me.id);

  if (couch) {
    const [c0, c1] = spotsOf.get(couch.id)!;
    // walk over and sit on the couch's first cushion
    const at0 = await sitOnSpot(couch, c0, 'sit-down');
    // click it again: nothing happens
    if (at0) await player.click(at0);
    await player.page.waitForTimeout(1200);
    const still = await player.me();
    if (still.sittingOn !== couch.id || still.server?.x !== c0.x || still.server?.y !== c0.y || still.moving) note('re-clicking my own cushion moved me', still);
    // the other cushion: shift over
    await sitOnSpot(couch, c1, 'shift-over');
  }
  // a chair across the room: up, over, and down
  await sitOnSpot(chair, ch, 'other-seat');
  // stand up: off onto the floor
  await standUp('stand-up');
  // up to the chair from in front, from behind and from the side
  const V: Record<string, [number, number]> = { se: [1, 0], sw: [0, 1], ne: [0, -1], nw: [-1, 0] };
  const [fx, fy] = V[ch.facing] ?? [0, 1];
  await approach(fx, fy, 'from-front');
  await approach(-fx, -fy, 'from-behind');
  await approach(fy, fx, 'from-side');

  const mine = await stopRecording(player);
  const theirs = await stopRecording(watcher);
  if (process.env.SEAT_MOTION_DUMP) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${SHOTS}/seat-motion-frames-${ROOM}.json`, JSON.stringify({ mine, theirs }, null, 1));
  }
  // disturbed: a page reloaded, or the server restarted (the room sent afresh)
  const restarted = !!mine?.wire.some((w) => w.dir === 'in' && w.msg.startsWith('{"t":"scene"'));
  if (!mine || !theirs || mine.frames.length < 30 || theirs.frames.length < 30 || player.loads !== loads[0] || watcher.loads !== loads[1] || restarted) {
    console.log(`[seat-motion] ${ROOM}: the run was disturbed (${restarted ? 'the server restarted' : 'a page reloaded'}); again`);
    return false;
  }
  info.annotations.push({ type: 'frames', description: JSON.stringify({ mine: mine.frames.length, theirs: theirs.frames.length }) });
  for (const what of judge(mine.frames, seatTiles, 'my view')) note(what);
  for (const what of judge(theirs.frames, seatTiles, 'the watcher’s view')) note(what);
  // the watcher saw the same sittings, on the same cushions
  const sittings = (fs: Frame[]) => {
    const out: string[] = [];
    for (const f of fs) {
      const s = f.sittingOn && !f.moving ? `${f.sittingOn}@${f.tile}` : null;
      if (s && out[out.length - 1] !== s) out.push(s);
    }
    return out;
  };
  const a = sittings(mine.frames);
  const b = sittings(theirs.frames);
  if (JSON.stringify(a) !== JSON.stringify(b)) note(`the watcher saw different sittings: mine ${a.join(' → ')}, theirs ${b.join(' → ')}`);
  for (const f of seen) player.note(f);
  console.log(`[seat-motion] ${ROOM}: ${mine.frames.length} / ${theirs.frames.length} frames · ${seen.length} finding(s)`);
  return true;
}

for (const ROOM of ROOMS)
  test(`sit, shift over, move seats and stand up: smooth, and the same for everyone (${ROOM})`, async ({ player, browser, baseURL }, info) => {
    test.setTimeout(900_000);
    const page2 = await (
      await browser.newContext({ storageState: await watcherState(baseURL!, watcherFile(info.parallelIndex)), viewport: { width: 1920, height: 1080 } })
    ).newPage();
    const watcher = new Player(page2);
    await watcher.boot(watcherFile(info.parallelIndex), `Seat Watcher ${info.parallelIndex}`);
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) done = await walkThrough(player, watcher, ROOM, info);
    await page2.context().close();
    if (!done) player.gaveUp.push(`${ROOM}: seat walk-through (disturbed every try)`);
    expect.soft(player.findings, player.findings.map((f) => f.what).join('\n')).toEqual([]);
  });
