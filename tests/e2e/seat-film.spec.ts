/**
 * Every kind of seat in the game, filmed the way a player sees it: in each room, one of each seat kind (sprite,
 * colour and facing) — walk up and sit, shift over to the other cushion of a two-seater, stand up and step
 * off — captured from the game's own canvas at play scale, every frame of the sit-down and stand-up and a
 * frame every quarter second between. One contact sheet per room: art/review/seats-<room>.png (a row per seat
 * kind, left to right in time). For looking at, frame by frame, the way Carter would: hovering, sinking,
 * popping, odd depth, clipping.
 *
 *   npx playwright test seat-film                    every room and the town
 *   SEAT_FILM_ROOMS=cafe,hq npx playwright test seat-film
 */
import { test, type Obj, type Player, type Spot } from './helpers';

const ROOMS = (process.env.SEAT_FILM_ROOMS ?? 'cafe,hq,eng,launch,events,focus,arcade,design,town').split(',');
test.describe.configure({ mode: 'parallel' });

/** Start capturing frames around a seat from the canvas; `label` names what's happening. */
async function startFilm(p: Player, seatId: string, row: number) {
  await p.ev(
    ([id, row]) => {
      const g = (window as any).__mw;
      const w = g.world as any;
      const film = ((window as any).__film ??= { rows: [] as Array<{ label: string; frames: HTMLCanvasElement[] }> });
      const o = w.scene.objects.find((x: any) => x.id === id);
      const cw = 150;
      const ch = 170;
      const rec = { on: true, last: 0, label: 'walk', frames: [] as HTMLCanvasElement[] };
      film.rows[row] = { label: `${o.sprite}${o.variant ? '.' + o.variant : ''} ${o.facing ?? ''} (${id})`, frames: rec.frames };
      film.rec = rec;
      const tick = () => {
        if (!rec.on) return;
        const now = performance.now();
        const a = w.actors.get(g.meId);
        // (only once they're near it: a long walk across the room isn't the film)
        const near = a && Math.hypot(a.x - (o.x + ((o.w ?? 1) - 1) / 2), a.y - (o.y + ((o.d ?? 1) - 1) / 2)) <= 2.6;
        if (a && near && rec.frames.length < 48) {
          const k = w.seatK(a);
          const pose = w.pose(a);
          const moving = (k > 0 && k < 1) || !!a.stepOff || !!a.glide || pose === 'crouch';
          if (now - rec.last >= (moving ? 45 : 250)) {
            rec.last = now;
            const cx = (o.x + (o.w ?? 1) / 2 - (o.y + (o.d ?? 1) / 2)) * 16;
            const cy = (o.x + (o.w ?? 1) / 2 + o.y + (o.d ?? 1) / 2) * 8 - 26;
            const [sx, sy] = w.camera.toScreen(cx, cy, w.vw, w.vh);
            const dpr = window.devicePixelRatio || 1;
            const c = document.createElement('canvas');
            c.width = cw;
            c.height = ch;
            const x = c.getContext('2d')!;
            x.drawImage(w.canvas, (sx - cw / 2) * dpr, (sy - ch / 2) * dpr, cw * dpr, ch * dpr, 0, 0, cw, ch);
            x.fillStyle = 'rgba(0,0,0,0.55)';
            x.fillRect(0, ch - 13, cw, 13);
            x.fillStyle = '#fff';
            x.font = '10px system-ui';
            x.fillText(`${rec.label} ${pose}`, 3, ch - 3);
            rec.frames.push(c);
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [seatId, row] as const,
  );
}
const label = (p: Player, l: string) => p.page.evaluate((l) => (window as any).__film?.rec && ((window as any).__film.rec.label = l), l).catch(() => undefined);
const stopFilm = (p: Player) => p.page.evaluate(() => (window as any).__film?.rec && ((window as any).__film.rec.on = false)).catch(() => undefined);

/** Lay the rows out as one sheet and save it (the dev snapshot endpoint). */
async function saveSheet(p: Player, name: string) {
  return p.page.evaluate(async (name) => {
    const film = (window as any).__film as { rows: Array<{ label: string; frames: HTMLCanvasElement[] } | undefined> };
    const rows = film.rows.filter((r): r is { label: string; frames: HTMLCanvasElement[] } => !!r && r.frames.length > 0);
    const cw = 150;
    const ch = 170;
    const cols = Math.max(1, ...rows.map((r) => r.frames.length));
    const sheet = document.createElement('canvas');
    sheet.width = 180 + cols * cw;
    sheet.height = Math.max(1, rows.length) * ch;
    const x = sheet.getContext('2d')!;
    x.fillStyle = '#1b1623';
    x.fillRect(0, 0, sheet.width, sheet.height);
    rows.forEach((r, i) => {
      x.fillStyle = '#f6ead6';
      x.font = '12px system-ui';
      r.label.split(' ').forEach((part, k) => x.fillText(part, 6, i * ch + 20 + k * 15));
      r.frames.forEach((f, j) => x.drawImage(f, 180 + j * cw, i * ch));
    });
    const blob = await new Promise<Blob>((res) => sheet.toBlob((b) => res(b!), 'image/png'));
    const r = await fetch(`/api/dev/snapshot?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
    return (await r.json()) as { path: string };
  }, name);
}

for (const ROOM of ROOMS)
  test(`film every seat kind: ${ROOM}`, async ({ player }) => {
    test.setTimeout(900_000);
    const scene = await player.roomScene(ROOM);
    const me = await player.me();
    const occ = await player.occupants();
    const seats = scene.objects.filter((o: Obj) => o.actions?.some((a) => a.kind === 'sit'));
    // one of each kind: sprite, colour, facing — a free one, that can be clicked
    const kinds = new Map<string, Obj>();
    for (const s of seats) {
      const key = `${s.sprite}.${s.variant ?? ''}|${s.facing ?? ''}`;
      if (kinds.has(key)) continue;
      if (Object.entries(occ).some(([id, o]) => id !== me.id && o.sittingOn === s.id)) continue;
      const spots = await player.seatSpots(s.id);
      if (!spots.length || !(await player.objectPoint(s.id, { x: spots[0].x, y: spots[0].y, z: 10 }))) continue;
      kinds.set(key, s);
    }
    let row = 0;
    for (const seat of kinds.values()) {
      const r = row++;
      // (a hot reload drops the bot in town mid-film: the step is done again)
      await player.step(ROOM, `filming ${seat.id}`, async () => {
        await player.reset();
        if (ROOM === 'town') await player.settle();
        const spots: Spot[] = await player.seatSpots(seat.id);
        if (!spots.length) return;
        // start two steps in front of it, so each film walks up the same way
        const [fx, fy] = ({ se: [1, 0], sw: [0, 1], ne: [0, -1], nw: [-1, 0] } as Record<string, [number, number]>)[spots[0].facing] ?? [0, 1];
        for (const k of [2, 3]) {
          const t: [number, number] = [spots[0].x + fx * k, spots[0].y + fy * k];
          if (await player.walkable(t[0], t[1])) {
            await player.page.evaluate((tt) => (window as any).__mw.walkTo(tt), t);
            await player.still(15_000);
            break;
          }
        }
        await startFilm(player, seat.id, r);
        const at0 = await player.objectPoint(seat.id, { x: spots[0].x, y: spots[0].y, z: 10 });
        if (!at0) return;
        await label(player, 'sit');
        await player.click(at0);
        await player.until((m) => m.sittingOn === seat.id && !m.moving, 12_000);
        await player.page.waitForTimeout(700);
        if (spots.length > 1) {
          const at1 = await player.objectPoint(seat.id, { x: spots[1].x, y: spots[1].y, z: 10 });
          if (at1) {
            await label(player, 'shift');
            await player.click(at1);
            await player.until((m) => m.sittingOn === seat.id && m.server?.x === spots[1].x && m.server?.y === spots[1].y && !m.moving, 8000);
            await player.page.waitForTimeout(700);
          }
        }
        await label(player, 'stand');
        await player.page.evaluate(() => (window as any).__mw.rt?.send({ t: 'stand' }));
        await player.until((m) => !m.sittingOn, 5000);
        await player.page.waitForTimeout(900);
        await stopFilm(player);
      });
    }
    const r = await saveSheet(player, `seats-${ROOM}`);
    console.log(`[seat-film] ${ROOM}: ${kinds.size} seat kinds → ${r.path}`);
  });
