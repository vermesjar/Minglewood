/**
 * THE SEAT GRADE, LIVE: the game's own frame against the framework's composition. A bot walks up to each catalog seat
 * in its lab room (seatlab-<key>: the seat placed in all four facings, src/shared/world/seatLab.ts), sits down with a
 * real click in each review look (SEAT_LOOKS), on every cushion, and the canvas round the seat is read back on the
 * drawing's own pixel grid at every zoom the game uses (1 … 5 CSS px per art px; 2 is play scale). At the crisp zooms
 * (2 and 4: one and two canvas px per drawing px) every pixel of the seat and the sitter must be exactly what
 * src/shared/art/seatCompose.ts composes for that look on that cushion; at the half steps (1, 3, 5) the canvas samples
 * the drawing unevenly, so each drawing px is read where the browser lands it and 98% must match. Then the bot stands
 * up, and the frames of the sit-down and stand-up are kept for review.
 *
 *   PLAYTEST_URL=http://localhost:5190 PLAYTEST_TAG=grade SEAT_GRADE_KEYS=chair.cafe,stool npx playwright test seat-grade --workers 2
 *
 * SEAT_GRADE_KEYS: the seats (catalog keys), default every catalog seat; SEAT_GRADE_ZOOMS: 1,2,3,4,5 by default.
 * Sheets: art/review/seat-grade-live/<key>-<facing>.png (every look and zoom, live, with the expected composition
 * beside any that differ); the report art/review/seat-grade-live/report.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test, type Player } from './helpers';
import { SEAT_LOOKS, sitsByCushion } from '../../src/shared/world/seatModels';
import { SIT_POSE_OF } from '../../src/shared/world/seats';
import { legsFor } from '../../src/shared/world/sitLegs';
import { normalizeLoadout } from '../../src/shared/avatar';
import { SEAT_SPECS, seatArtOf, seatBuildOf } from '../../src/shared/art/seatCatalog';
import { composeSeat } from '../../src/shared/art/seatCompose';
import type { Pose } from '../../src/client/engine/sprites/avatarFrame';
import type { SitLegs } from '../../src/shared/world/sitLegs';
import type { Figure } from '../../src/shared/art/seatCompose';
import type { AvatarLoadout } from '../../src/shared/domain/types';
import { blank, writePng, type Img } from '../../scripts/lib/png';
import { text } from '../../scripts/lib/font';
import { paste, row, scaled, stack } from '../../scripts/lib/draw';

const OUT = 'art/review/seat-grade-live';
const ROOT = process.cwd().replace(/\\/g, '/');
mkdirSync(OUT, { recursive: true });

const KEYS = (process.env.SEAT_GRADE_KEYS ?? SEAT_SPECS.map((s) => s.key).join(','))
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
const ZOOMS = (process.env.SEAT_GRADE_ZOOMS ?? '1,2,3,4,5').split(',').map(Number);
const FACINGS = ['se', 'sw', 'ne', 'nw'] as const;
const FRONT: Record<string, [number, number]> = { se: [1, 0], sw: [0, 1], ne: [0, -1], nw: [-1, 0] };
/** The composition's clear margin round the drawing (drawing px). */
const PAD = 64;

test.describe.configure({ mode: 'parallel' });

interface Grab {
  w: number;
  h: number;
  data: string;
  origin: [number, number];
}
const toImg = (g: Grab): Img => ({ w: g.w, h: g.h, d: new Uint8Array(Buffer.from(g.data, 'base64')) });

/**
 * The live canvas round a seat at a zoom, on the drawing's own pixel grid (k canvas px per drawing px, k = zoom / 2),
 * covering the drawing and PAD px round it, with nothing but the world in it: no hover, no labels, no blink.
 */
async function grab(p: Player, seatId: string, zoom: number): Promise<Grab> {
  return p.ev(
    async ([seatId, zoom, pad]) => {
      const g = (window as any).__mw;
      const w = g.world as any;
      const st = w.statics.find((s: any) => s.obj.id === seatId);
      w.hover = null;
      w.hoverTile = null;
      // nothing transient in the frame: no destination marker, no selection, no sparkle (an heirloom's) still falling
      w.dest = null;
      w.selectedActor = null;
      if (w.effects && Array.isArray(w.effects.particles)) w.effects.particles = [];
      const overlays = w.drawActorOverlays;
      w.drawActorOverlays = () => undefined;
      const rm = w.reducedMotion;
      w.reducedMotion = true;
      w.camera.maxZoom = Math.max(w.camera.maxZoom, zoom);
      w.camera.minZoom = Math.min(w.camera.minZoom, zoom);
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
      const l = -pad;
      const t = -pad;
      const W = Math.round((sw + 2 * pad) * k);
      const H = Math.round((sh + 2 * pad) * k);
      const img = w.ctx.getImageData(X0 + Math.round(l * k), Y0 + Math.round(t * k), W, H);
      w.drawActorOverlays = overlays;
      w.reducedMotion = rm;
      let bin = '';
      const d = img.data as Uint8ClampedArray;
      for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
      return { w: W, h: H, data: btoa(bin), origin: [Math.round(-l * k), Math.round(-t * k)] as [number, number] };
    },
    [seatId, zoom, PAD] as const,
  );
}

/** Put a look on the bot and wait for the room to see it; returns the look as the server kept it. */
async function wear(p: Player, k: number): Promise<AvatarLoadout> {
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
    return JSON.parse(JSON.stringify((g.world as any).actors.get(g.meId).occ.avatar)) as AvatarLoadout;
  });
}

/** A look drawn by the kit in the page (the same code the game blits), with its layer map. */
async function figureOf(p: Player, look: AvatarLoadout, facing: string, pose: Pose, legs: SitLegs | null): Promise<Figure> {
  const r = await p.ev(
    async ([root, look, facing, pose, legs]) => {
      const qa = await import(`/@fs/${root}/src/client/engine/sprites/avatarQa.ts`);
      const R = qa.renderAvatarLayers(look, facing, pose, legs ?? undefined);
      const b64 = (d: Uint8Array | Uint8ClampedArray) => {
        let bin = '';
        for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
        return btoa(bin);
      };
      return { px: b64(R.px), owner: b64(R.owner) };
    },
    [ROOT, look, facing, pose, legs] as const,
  );
  return { px: new Uint8ClampedArray(Buffer.from(r.px, 'base64')), owner: new Uint8Array(Buffer.from(r.owner, 'base64')) };
}

async function sitOn(p: Player, seatId: string, spot: { x: number; y: number }) {
  const at = await p.objectPoint(seatId, { x: spot.x, y: spot.y, z: 10 });
  if (!at) throw new Error(`can't click ${seatId}`);
  await p.click(at);
  await p.page.mouse.move(4, 4);
  const ok = await p.until((m) => m.sittingOn === seatId && m.server?.x === spot.x && m.server?.y === spot.y && !m.moving, 15_000);
  if (!ok.ok) throw new Error(`didn't sit on ${seatId} at ${spot.x},${spot.y}`);
  await p.page.mouse.move(4, 4);
  // settled: the sit-down (and the settle at its end) is over before anything is read back
  await p.page.waitForFunction(
    () => {
      const g = (window as any).__mw;
      const a = (g.world as any).actors.get(g.meId);
      return !!a?.seat && a.seat.to === 1 && performance.now() - a.seat.start > 1500 && !a.glide;
    },
    undefined,
    { timeout: 10_000 },
  );
  await p.page.waitForTimeout(300);
}

/** Film the canvas round a seat at play scale: a frame whenever the person on it moves or changes pose. */
async function startFilm(p: Player, seatId: string) {
  await p.ev((seatId) => {
    const g = (window as any).__mw;
    const w = g.world as any;
    const st = w.statics.find((s: any) => s.obj.id === seatId);
    const film = ((window as any).__gradeFilm = { on: true, frames: [] as string[], last: '', overlays: w.drawActorOverlays });
    w.drawActorOverlays = () => undefined;
    const sw = st.sprite.canvas.width;
    const sh = st.sprite.canvas.height;
    const tick = () => {
      if (!film.on) return;
      const a = w.actors.get(g.meId);
      const sig = a ? `${w.pose(a)}|${a.at?.x}|${a.at?.y}` : '';
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
        const c = document.createElement('canvas');
        c.width = Math.round((sw + 112) * k);
        c.height = Math.round((sh + 140) * k);
        c.getContext('2d')!.drawImage(w.canvas, Math.round(st.dx * s + tx - 56 * k), Math.round(st.dy * s + ty - 120 * k), c.width, c.height, 0, 0, c.width, c.height);
        film.frames.push(c.toDataURL('image/png'));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, seatId);
}

async function stopFilm(p: Player): Promise<string[]> {
  return p.ev(() => {
    const f = (window as any).__gradeFilm;
    if (!f) return [];
    f.on = false;
    ((window as any).__mw.world as any).drawActorOverlays = f.overlays;
    return f.frames as string[];
  });
}

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

function label(s: string, img: Img, colour: [number, number, number] = [200, 190, 210]): Img {
  const out = blank(Math.max(img.w, s.length * 8 + 4), img.h + 16, [24, 20, 30], 255);
  text(out, 2, 2, s, colour, 2);
  paste(out, img, 0, 16);
  return out;
}

/**
 * The live grab against the composition: every composed pixel (seat or sitter) read from the canvas where the zoom
 * lands it. Returns how many differ, how many were compared, and the mismatch marked on the composition.
 */
function compare(live: Grab, comp: { px: { w: number; h: number; d: Uint8ClampedArray }; origin: [number, number] }, zoom: number): { bad: number; total: number; diff: Img } {
  const k = zoom / 2;
  const crisp = Number.isInteger(k);
  const L = toImg(live);
  const diff: Img = { w: comp.px.w, h: comp.px.h, d: new Uint8Array(comp.px.d.buffer.slice(0)) };
  let bad = 0;
  let total = 0;
  const same = (sx: number, sy: number, i: number) => {
    if (sx < 0 || sy < 0 || sx >= L.w || sy >= L.h) return false;
    const j = (sy * L.w + sx) * 4;
    return L.d[j] === comp.px.d[i] && L.d[j + 1] === comp.px.d[i + 1] && L.d[j + 2] === comp.px.d[i + 2];
  };
  if (k < 1) {
    // zoomed out: a canvas px covers several drawing px and shows one of them; it must be one of the composed ones
    const n = Math.round(1 / k);
    for (let cy = 0; cy * n < comp.px.h; cy++)
      for (let cx = 0; cx * n < comp.px.w; cx++) {
        const srcs: number[] = [];
        let clear = false;
        // (the block, and a drawing px round it: the sprite and the figure land on the canvas grid with their own phase;
        // a block with a clear px in it may show the floor, which the composition can't know)
        for (let yy = -1; yy <= n; yy++)
          for (let xx = -1; xx <= n; xx++) {
            const x = cx * n + xx;
            const y = cy * n + yy;
            if (x < 0 || y < 0 || x >= comp.px.w || y >= comp.px.h) continue;
            if (comp.px.d[(y * comp.px.w + x) * 4 + 3]) srcs.push((y * comp.px.w + x) * 4);
            else if (xx >= 0 && yy >= 0 && xx < n && yy < n) clear = true;
          }
        if (!srcs.length || clear) continue;
        total++;
        const sx = live.origin[0] + Math.round((cx * n - comp.origin[0]) * k);
        const sy = live.origin[1] + Math.round((cy * n - comp.origin[1]) * k);
        if (srcs.some((i) => same(sx, sy, i))) continue;
        bad++;
        if (bad <= 6 && process.env.SEAT_GRADE_DEBUG) {
          const j = (sy * L.w + sx) * 4;
          console.log(`[debug] canvas (${sx},${sy}) = ${L.d[j]},${L.d[j + 1]},${L.d[j + 2]} block ${cx},${cy} sources: ${[...new Set(srcs.map((i) => `${comp.px.d[i]},${comp.px.d[i + 1]},${comp.px.d[i + 2]}`))].join(' ')}`);
        }
        for (const i of srcs) {
          diff.d[i] = 255;
          diff.d[i + 1] = 40;
          diff.d[i + 2] = 200;
        }
      }
    return { bad, total, diff };
  }
  for (let y = 0; y < comp.px.h; y++)
    for (let x = 0; x < comp.px.w; x++) {
      const i = (y * comp.px.w + x) * 4;
      if (!comp.px.d[i + 3]) continue;
      total++;
      // the composition's (0,0) is PAD px before the drawing's; the grab's origin is where the drawing's (0,0) landed
      const dx = x - comp.origin[0];
      const dy = y - comp.origin[1];
      let ok: boolean;
      if (crisp) {
        // every canvas px this drawing px covers
        ok = true;
        for (let yy = 0; yy < k && ok; yy++) for (let xx = 0; xx < k && ok; xx++) ok = same(live.origin[0] + dx * k + xx, live.origin[1] + dy * k + yy, i);
      } else {
        // a half step: the browser lands this drawing px on one or two canvas px each way; any of them may carry it
        ok = false;
        const x0 = Math.floor(dx * k);
        const x1 = Math.max(x0, Math.ceil((dx + 1) * k) - 1);
        const y0 = Math.floor(dy * k);
        const y1 = Math.max(y0, Math.ceil((dy + 1) * k) - 1);
        for (let yy = y0; yy <= y1 && !ok; yy++) for (let xx = x0; xx <= x1 && !ok; xx++) ok = same(live.origin[0] + xx, live.origin[1] + yy, i);
      }
      if (!ok) {
        bad++;
        diff.d[i] = 255;
        diff.d[i + 1] = 40;
        diff.d[i + 2] = 200;
      }
    }
  return { bad, total, diff };
}

interface Result {
  key: string;
  facing: string;
  look: number;
  cushion: number;
  zoom: number;
  bad: number;
  total: number;
  ok: boolean;
}
const results: Result[] = [];

for (const KEY of KEYS)
  test(`seat grade live: ${KEY}`, async ({ player }) => {
    test.setTimeout(1_200_000);
    const b = seatBuildOf(KEY);
    if (!b) throw new Error(`${KEY} isn't a catalog seat`);
    const room = `seatlab-${KEY}`;
    await player.enter(room);
    await player.ev(async () => {
      const m = await import(/* @vite-ignore */ '/engine/weather.ts' as string);
      m.setSkyOverride({ phase: 'day', weather: 'clear', sun: 0, lamp: 0 });
    });
    const failures: string[] = [];
    for (const facing of FACINGS) {
      const seatId = `${room}-${facing}`;
      const art = seatArtOf(KEY, facing)!;
      const sits = sitsByCushion(b.model, facing);
      const legs = sits.map((s) => (s ? legsFor(b.model, s, b.style) : null));
      const pose = SIT_POSE_OF[b.style] as Pose;
      const cells: Img[] = [];
      let film: Img[] = [];
      await player.step(room, `${KEY} ${facing}`, async () => {
        const spots = await player.seatSpots(seatId);
        if (!spots.length) throw new Error(`${seatId}: no cushions`);
        for (let k = 0; k < SEAT_LOOKS.length; k++) {
          await player.reset();
          const worn = await wear(player, k);
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
          for (let c = 0; c < spots.length; c++) {
            if (c > 0) await sitOn(player, seatId, spots[c]);
            const cushion = spots[c].index;
            const fig = await figureOf(player, worn, facing, pose, legs[cushion]);
            const comp = composeSeat(art, b.model, b.style, sits, legs, [{ cushion, fig }], PAD);
            const zooms = k === 0 ? ZOOMS : ZOOMS.filter((z) => z === 2 || z === 4);
            for (const zoom of zooms) {
              const g = await grab(player, seatId, zoom);
              const { bad, total, diff } = compare(g, comp, zoom);
              const crisp = zoom === 2 || zoom === 4;
              const ok = crisp ? bad === 0 : bad <= total * 0.005;
              results.push({ key: KEY, facing, look: k, cushion, zoom, bad, total, ok });
              if (!ok) failures.push(`${facing} look ${k} cushion ${cushion} zoom ${zoom}: ${bad} of ${total} px differ from the composition`);
              const live = toImg(g);
              const shown = zoom >= 2 ? live : scaled(live, 2);
              cells.push(label(`L${k} c${cushion} z${zoom} ${ok ? 'ok' : `BAD ${bad}`}`, shown, ok ? undefined : [255, 110, 110]));
              if (!ok) cells.push(label('expected (diff in pink)', scaled(diff, Math.max(1, Math.round(zoom / 2)))));
            }
          }
          await player.ev(() => (window as any).__mw.rt?.send({ t: 'stand' }));
          await player.until((m) => !m.sittingOn, 6000);
          await player.page.waitForTimeout(800);
          if (k === 0) film = await Promise.all((await stopFilm(player)).map((u) => decode(player, u)));
        }
      });
      const sheet = stack([label(`${KEY} ${facing}: LIVE, EVERY LOOK AND ZOOM`, row(cells)), ...(film.length ? [label('SIT DOWN > SEATED > STAND UP (LIVE, PLAY SCALE)', row(film, [24, 20, 30], 4))] : [])]);
      writePng(`${OUT}/${KEY}-${facing}.png`, sheet);
    }
    await player.ev(async () => {
      const m = await import(/* @vite-ignore */ '/engine/weather.ts' as string);
      m.setSkyOverride(null);
    });
    const file = `${OUT}/report.json`;
    const prior: Result[] = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Result[]) : [];
    writeFileSync(file, JSON.stringify([...prior.filter((r) => r.key !== KEY), ...results.filter((r) => r.key === KEY)], null, 1));
    if (failures.length) throw new Error(`${KEY}: the game's frame differs from the composition:\n  ${failures.join('\n  ')}`);
  });
