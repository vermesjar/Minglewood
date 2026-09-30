/**
 * Every seat model, proven in the game: a bot walks up to each seat kind in its lab room (seatlab-<key>: the seat
 * placed in all four facings, src/shared/world/seatLab.ts), sits down with a real click, in each of the three review
 * looks (SEAT_LOOKS), shifts over to the other cushion of a two-seater, and stands up. From the live canvas, per
 * seat and facing, art/review/models-live/<key>-<facing>.png: every look seated at play scale (2×) and at 4×, and the
 * sit-down → seated → stand-up film at play scale. And for the probe (scripts/seat-model.ts --probe: live == sheet),
 * each seated capture as it is on the canvas at play scale, on the seat drawing's own pixel grid:
 * art/review/models-live/raw/<key>-<facing>-L<look>-C<cushion>.png + .json.
 *
 *   PLAYTEST_URL=http://localhost:5190 PLAYTEST_TAG=models-<you> SEAT_MODEL_KEYS=chair.cafe,stool \
 *     npx playwright test seat-models --workers 2
 *
 * SEAT_MODEL_KEYS: the seats (catalog keys), default every seat with a model; SEAT_MODEL_FACINGS: se,sw,ne,nw by default.
 * PLAYTEST_TAG keeps each agent's bots, screenshots and results apart. One test per seat, so workers share them out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test, type Player } from './helpers';
import { SEAT_LOOKS } from '../../src/shared/world/seatModels';
import { normalizeLoadout } from '../../src/shared/avatar';
import { blank, writePng, type Img } from '../../scripts/lib/png';
import { text } from '../../scripts/lib/font';
import { paste, row, stack } from '../../scripts/lib/draw';

const LIVE = 'art/review/models-live';
const RAW = `${LIVE}/raw`;
mkdirSync(RAW, { recursive: true });

const KEYS = (process.env.SEAT_MODEL_KEYS ?? Object.keys(JSON.parse(readFileSync('art/seat-models.json', 'utf8')) as Record<string, unknown>).join(','))
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
const FACINGS = (process.env.SEAT_MODEL_FACINGS ?? 'se,sw,ne,nw').split(',');
const FRONT: Record<string, [number, number]> = { se: [1, 0], sw: [0, 1], ne: [0, -1], nw: [-1, 0] };

test.describe.configure({ mode: 'parallel' });

interface Grab {
  w: number;
  h: number;
  /** RGBA, base64 */
  data: string;
  /** Where the seat drawing's (0, 0) is in the grab, in its px. */
  origin: [number, number];
}

const toImg = (g: Grab): Img => ({ w: g.w, h: g.h, d: new Uint8Array(Buffer.from(g.data, 'base64')) });

/**
 * The live canvas around a seat at a zoom (2: one drawing px per canvas px; 4: two), on the drawing's own pixel grid,
 * with nothing but the world in it: no hover highlight, no name labels, no blink. `region`: drawing px [l, t, r, b]
 * relative to the drawing's (0, 0); by default the seat and whoever is in it.
 */
async function grab(p: Player, seatId: string, zoom: number, region?: [number, number, number, number]): Promise<Grab> {
  return p.ev(
    async ([seatId, zoom, region]) => {
      const g = (window as any).__mw;
      const w = g.world as any;
      const st = w.statics.find((s: any) => s.obj.id === seatId);
      const me = w.actors.get(g.meId);
      w.hover = null;
      w.hoverTile = null;
      const overlays = w.drawActorOverlays;
      w.drawActorOverlays = () => undefined;
      const rm = w.reducedMotion;
      w.reducedMotion = true;
      w.camera.maxZoom = Math.max(w.camera.maxZoom, zoom);
      const sw = st.sprite.canvas.width;
      const sh = st.sprite.canvas.height;
      w.camera.jump(st.dx + sw / 4, st.dy + sh / 4 - 16, zoom);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      const dpr = window.devicePixelRatio || 1;
      const z = w.camera.zoom;
      const s = z * dpr;
      const tx = Math.round(dpr * (w.vw / 2 - w.camera.x * z));
      const ty = Math.round(dpr * (w.vh / 2 - w.camera.y * z));
      const k = s / 2;
      const X0 = Math.round(st.dx * s + tx);
      const Y0 = Math.round(st.dy * s + ty);
      let box = region;
      if (!box) {
        // the seat, and the person in it (their figure is 88 × 112 drawing px, feet at its (45, 104))
        const fx = Math.round(((me.at?.x ?? me.sx) - st.dx) * 2);
        const fy = Math.round(((me.at?.y ?? me.sy) - st.dy) * 2);
        box = [Math.min(0, fx - 44) - 6, Math.min(0, fy - 90) - 6, Math.max(sw, fx + 44) + 6, Math.max(sh, fy + 4) + 6];
      }
      const [l, t, r, b] = box;
      const W = Math.round((r - l) * k);
      const H = Math.round((b - t) * k);
      const img = w.ctx.getImageData(X0 + Math.round(l * k), Y0 + Math.round(t * k), W, H);
      w.drawActorOverlays = overlays;
      w.reducedMotion = rm;
      let bin = '';
      const d = img.data as Uint8ClampedArray;
      for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
      return { w: W, h: H, data: btoa(bin), origin: [Math.round(-l * k), Math.round(-t * k)] as [number, number] };
    },
    [seatId, zoom, region ?? null] as const,
  );
}

/**
 * Put a look on the bot (the wardrobe's own message, a full loadout) and wait for the room to see it. Returns the
 * look as the server kept it (it swaps out anything the bot hasn't unlocked): the probe composes exactly that.
 */
async function wear(p: Player, k: number): Promise<Record<string, unknown>> {
  const look = normalizeLoadout(SEAT_LOOKS[k]) as unknown as Record<string, string>;
  await p.ev((l) => (window as any).__mw.rt?.send({ t: 'avatar', loadout: l }), look);
  await p.page.waitForFunction(
    (l: Record<string, string>) => {
      const g = (window as any).__mw;
      const a = (g.world as any).actors.get(g.meId);
      return !!a && a.occ.avatar?.hairColor === l.hairColor && a.occ.avatar?.topColor === l.topColor && a.occ.avatar?.bottomColor === l.bottomColor;
    },
    look,
    { timeout: 10_000 },
  );
  return p.ev(() => {
    const g = (window as any).__mw;
    return JSON.parse(JSON.stringify((g.world as any).actors.get(g.meId).occ.avatar)) as Record<string, unknown>;
  });
}

/** Film the canvas around a seat at play scale, a frame whenever the person on it moves or changes pose. */
async function startFilm(p: Player, seatId: string) {
  await p.ev((seatId) => {
    const g = (window as any).__mw;
    const w = g.world as any;
    const st = w.statics.find((s: any) => s.obj.id === seatId);
    const film = ((window as any).__modelFilm = { on: true, frames: [] as string[], last: '', overlays: w.drawActorOverlays });
    // no name labels in the film
    w.drawActorOverlays = () => undefined;
    const sw = st.sprite.canvas.width;
    const sh = st.sprite.canvas.height;
    const tick = () => {
      if (!film.on) return;
      const a = w.actors.get(g.meId);
      const sig = a ? `${w.pose(a)}|${a.at?.x}|${a.at?.y}` : '';
      // only while they're on this seat: from the step onto its tile to the step off it
      const on = !!a && (a.onSeat?.id === seatId || a.seat?.objId === seatId);
      if (a && on && sig !== film.last && film.frames.length < 28) {
        w.hover = null;
        film.last = sig;
        const dpr = window.devicePixelRatio || 1;
        const z = w.camera.zoom;
        const s = z * dpr;
        const tx = Math.round(dpr * (w.vw / 2 - w.camera.x * z));
        const ty = Math.round(dpr * (w.vh / 2 - w.camera.y * z));
        const k = s / 2;
        const l = -56;
        const t = -120;
        const c = document.createElement('canvas');
        c.width = Math.round((sw + 112) * k);
        c.height = Math.round((sh + 140) * k);
        c.getContext('2d')!.drawImage(w.canvas, Math.round(st.dx * s + tx + l * k), Math.round(st.dy * s + ty + t * k), c.width, c.height, 0, 0, c.width, c.height);
        film.frames.push(c.toDataURL('image/png'));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, seatId);
}

async function stopFilm(p: Player): Promise<string[]> {
  return p.ev(() => {
    const f = (window as any).__modelFilm;
    if (!f) return [];
    f.on = false;
    ((window as any).__mw.world as any).drawActorOverlays = f.overlays;
    return f.frames as string[];
  });
}

/** A PNG data URL as pixels (decoded in the page, where there's a PNG decoder). */
async function decode(p: Player, url: string): Promise<Img> {
  const g = await p.ev(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let bin = '';
    for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { w: c.width, h: c.height, data: btoa(bin), origin: [0, 0] as [number, number] };
  }, url);
  return toImg(g);
}

function label(s: string, img: Img): Img {
  const out = blank(Math.max(img.w, s.length * 8 + 4), img.h + 16, [24, 20, 30], 255);
  text(out, 2, 2, s, [200, 190, 210], 2);
  paste(out, img, 0, 16);
  return out;
}

async function sitOn(p: Player, seatId: string, spot: { x: number; y: number }) {
  const at = await p.objectPoint(seatId, { x: spot.x, y: spot.y, z: 10 });
  if (!at) throw new Error(`can't click ${seatId}`);
  await p.click(at);
  // the pointer off it, so it isn't drawn hovered
  await p.page.mouse.move(4, 4);
  const ok = await p.until((m) => m.sittingOn === seatId && m.server?.x === spot.x && m.server?.y === spot.y && !m.moving, 15_000);
  if (!ok.ok) throw new Error(`didn't sit on ${seatId} at ${spot.x},${spot.y}`);
  // settled into the seat (the sit-down takes 180 ms), the pointer off it
  await p.page.mouse.move(4, 4);
  await p.page.waitForTimeout(700);
}

for (const KEY of KEYS)
  test(`seat model live: ${KEY}`, async ({ player }) => {
    test.setTimeout(900_000);
    const room = `seatlab-${KEY}`;
    await player.enter(room);
    await player.ev(async () => {
      const m = await import(/* @vite-ignore */ '/engine/weather.ts' as string);
      m.setSkyOverride({ phase: 'day', weather: 'clear', sun: 0, lamp: 0 });
    });
    for (const facing of FACINGS) {
      const seatId = `${room}-${facing}`;
      const plays: Img[] = [];
      const bigs: Img[] = [];
      let film: Img[] = [];
      await player.step(room, `${KEY} ${facing}`, async () => {
        const spots = await player.seatSpots(seatId);
        if (!spots.length) throw new Error(`${seatId}: no cushions`);
        for (let k = 0; k < SEAT_LOOKS.length; k++) {
          await player.reset();
          const worn = await wear(player, k);
          const swapped = Object.entries(normalizeLoadout(SEAT_LOOKS[k])).filter(([f, v]) => worn[f] !== v).map(([f]) => f);
          if (swapped.length) console.log(`[seat-models] look ${k}: the server swapped ${swapped.join(', ')} (not unlocked for this bot); the probe uses the look as worn`);
          // two steps in front of it, so every sit-down walks up the same way
          const [fx, fy] = FRONT[spots[0].facing];
          await player.page.evaluate((t) => (window as any).__mw.walkTo(t), [spots[0].x + 2 * fx, spots[0].y + 2 * fy] as [number, number]);
          await player.still(15_000);
          await player.ev(
            ([id, z]) => {
              const w = (window as any).__mw.world as any;
              const st = w.statics.find((s: any) => s.obj.id === id);
              w.camera.jump(st.dx + st.sprite.canvas.width / 4, st.dy + st.sprite.canvas.height / 4 - 16, z);
            },
            [seatId, 2] as const,
          );
          if (k === 0) await startFilm(player, seatId);
          await sitOn(player, seatId, spots[0]);
          const cushions = k === 0 ? spots : spots.slice(0, 1);
          for (let c = 0; c < cushions.length; c++) {
            if (c > 0) await sitOn(player, seatId, cushions[c]);
            const g2 = await grab(player, seatId, 2);
            const name = `${KEY}-${facing}-L${k}-C${c}`;
            writePng(`${RAW}/${name}.png`, toImg(g2));
            writeFileSync(`${RAW}/${name}.json`, JSON.stringify({ key: KEY, facing, look: k, cushion: c, origin: g2.origin, loadout: worn }));
            plays.push(label(`look ${k}${cushions.length > 1 ? ` cushion ${c}` : ''}`, toImg(g2)));
            bigs.push(toImg(await grab(player, seatId, 4)));
            await player.ev(
              ([id, z]) => {
                const w = (window as any).__mw.world as any;
                const st = w.statics.find((s: any) => s.obj.id === id);
                w.camera.jump(st.dx + st.sprite.canvas.width / 4, st.dy + st.sprite.canvas.height / 4 - 16, z);
              },
              [seatId, 2] as const,
            );
          }
          await player.ev(() => (window as any).__mw.rt?.send({ t: 'stand' }));
          await player.until((m) => !m.sittingOn, 6000);
          await player.page.waitForTimeout(800);
          if (k === 0) film = await Promise.all((await stopFilm(player)).map((u) => decode(player, u)));
        }
      });
      const sheet = stack([
        label(`${KEY} ${facing}: PLAY SCALE (2X), LIVE`, row(plays)),
        label('4X, LIVE', row(bigs)),
        ...(film.length ? [label('SIT DOWN > SEATED > STAND UP (LIVE, PLAY SCALE)', row(film, [24, 20, 30], 4))] : []),
      ]);
      writePng(`${LIVE}/${KEY}-${facing}.png`, sheet);
      console.log(`[seat-models] ${LIVE}/${KEY}-${facing}.png`);
    }
    await player.ev(async () => {
      const m = await import(/* @vite-ignore */ '/engine/weather.ts' as string);
      m.setSkyOverride(null);
    });
    if (!existsSync(`${LIVE}/${KEY}-se.png`)) throw new Error(`no live shots for ${KEY}`);
  });
