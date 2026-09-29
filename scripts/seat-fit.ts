/**
 * The seat standard, measured: every seat kind in the art catalogue, in all four facings, with sitters on
 * every cushion, composed exactly as the game draws them and checked against the drawing
 * (src/client/engine/sprites/seatCheck.ts has the checks and the calibration maths).
 *
 *   npx tsx scripts/seat-fit.ts            check (exit 1 on any failure), write art/review/seatfit-*.png
 *   npx tsx scripts/seat-fit.ts --fit      derive each seat's profile from its calibration and print it
 *   npx tsx scripts/seat-fit.ts --write    …and write the profiles into the manifest (under the lock)
 *   npx tsx scripts/seat-fit.ts --grid KEY [H]   the front drawing, ×8, with the cushion centre line marked at
 *                                          heights around H: where it lies on the cushion, read the point
 *
 * A seat's calibration is read off its drawing, never guessed: the centre of its cushion's top face (a pixel in
 * the front drawing as the game resolves it facing se) and how it's sat in; the back views' hip depth is then
 * fitted to the back drawings. Re-measure whenever the art is redrawn; the check fails when the manifest's
 * profile no longer follows from the drawings (re-anchored or redrawn art).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { centredAnchor } from '../src/client/engine/sprites/footing';
import { mirrorLine, type SeatArt } from '../src/client/engine/sprites/seatFit';
import { checkSeatView, fitBackDepth, profileFromPoint, seatPlacement, type SeatView } from '../src/client/engine/sprites/seatCheck';
import { seatProfile, type SeatProfile } from '@shared/world/seats';
import { allScenes } from '@shared/world';
import { isSeat } from '@shared/world/scene';
import { blank, mirrorImg, readPng, writePng, type Img } from './lib/png';

type Facing = 'se' | 'sw' | 'ne' | 'nw';
const FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];
const MIRROR: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };
const MANIFEST = 'public/art/manifest.json';
const OUT = 'art/review';

interface Entry extends Partial<SeatProfile> {
  file?: string;
  anchor?: [number, number];
  facings?: Partial<Record<Facing, { file: string; anchor: [number, number] }>>;
  footprint: [number, number];
}
const manifest = (): { sprites: Record<string, Entry> } => JSON.parse(readFileSync(MANIFEST, 'utf8'));
const M = manifest().sprites;

/** Every seat kind: anything sat on in any scene (the town's benches included), plus any art with a seat height. */
function seatKeys(): string[] {
  const keys = new Set<string>();
  for (const s of allScenes().values()) for (const o of s.objects) if (isSeat(o)) keys.add(o.variant && M[`${o.sprite}.${o.variant}`] ? `${o.sprite}.${o.variant}` : o.sprite);
  for (const [k, e] of Object.entries(M)) if (e.seat !== undefined) keys.add(k);
  return [...keys].filter((k) => M[k]).sort();
}
const spriteOf = (key: string) => key.split('.')[0];

/** The drawing the game uses for a seat in a facing (art.ts: per-facing art, mirrored partners, centring). */
function seatArt(key: string, f: Facing): { art: SeatArt; mirrored: boolean; drawn: Facing } {
  const e = M[key];
  const { w, d } = seatPlacement(e.footprint, f);
  let rec = e.file ? { file: e.file, anchor: e.anchor! } : undefined;
  let mirror = !!e.file && e.footprint[0] !== e.footprint[1] && w === e.footprint[1] && d === e.footprint[0];
  let drawn = f;
  if (e.facings) {
    rec = e.facings[f];
    if (!rec && e.facings[MIRROR[f]]) {
      rec = e.facings[MIRROR[f]];
      mirror = true;
      drawn = MIRROR[f];
    }
    rec ??= Object.values(e.facings)[0]!;
  }
  let img = readPng(`public/art/sprites/${rec!.file}`);
  if (mirror) img = mirrorImg(img);
  const c = centredAnchor(img, w, d, 2);
  let [ax, ay] = c ?? rec!.anchor;
  if (!c && mirror) ax = img.w - ax;
  return { art: { px: img, ax, ay }, mirrored: mirror, drawn };
}

const profileOf = (key: string): SeatProfile => seatProfile(spriteOf(key), M[key]);

/* ------------------------------------------------------------------ calibration */

interface Calibration {
  /** The centre of the (first) cushion's top face, on its centre line. Beanbags: the hollow you sink into. */
  cushion: [number, number];
  sitStyle: SeatProfile['sitStyle'];
  backrest: boolean;
  /** Where colour can't tell backrest from cushion: its top edge in the drawn back view (that drawing's px). */
  backLine?: SeatProfile['backLine'];
}
/** A backrest line across the top of a drawn back view: seen from behind, all of the seat covers its sitter. */
const ALL = (f: 'ne' | 'nw'): SeatProfile['backLine'] => ({ [f]: [[0, 0], [999, 0]] });
/** Pixels in each seat's front drawing as the game resolves it facing se (a sw drawing mirrored). */
const CALIBRATION: Record<string, Calibration> = {
  'chair.cafe': { cushion: [26.8, 38.6], sitStyle: 'chair', backrest: true },
  'chair-bistro.sage': { cushion: [25.0, 34.5], sitStyle: 'chair', backrest: true },
  'chair.office': { cushion: [25.8, 34.9], sitStyle: 'chair', backrest: true },
  'chair.red': { cushion: [22.6, 27.7], sitStyle: 'chair', backrest: true },
  'chair.wood': { cushion: [22.1, 29.6], sitStyle: 'chair', backrest: true },
  'heirloom-throne': { cushion: [35.8, 61.8], sitStyle: 'chair', backrest: true },
  'armchair.green': { cushion: [38.4, 45.9], sitStyle: 'chair', backrest: true },
  'armchair.mustard': { cushion: [39.1, 33.5], sitStyle: 'chair', backrest: true },
  'armchair.rust': { cushion: [40.0, 46.5], sitStyle: 'chair', backrest: true },
  'couch.green': { cushion: [74.4, 37.9], sitStyle: 'lounge', backrest: true },
  'couch.blue': { cushion: [68.2, 31.7], sitStyle: 'lounge', backrest: true },
  // its upholstery is one colour all over and its back hides the cushions: all of it covers
  'couch.purple': { cushion: [72.0, 34.6], sitStyle: 'lounge', backrest: true, backLine: ALL('ne') },
  'bench.navy': { cushion: [64.0, 15.8], sitStyle: 'chair', backrest: false },
  bench: { cushion: [69.6, 44.8], sitStyle: 'chair', backrest: true },
  stool: { cushion: [18.0, 6.2], sitStyle: 'stool', backrest: false },
  'stool.drafting': { cushion: [14.0, 5.6], sitStyle: 'stool', backrest: false },
  'stool.neon': { cushion: [15.0, 6.6], sitStyle: 'stool', backrest: false },
  'ottoman.green': { cushion: [18.0, 10.0], sitStyle: 'chair', backrest: false },
  // you sink into a beanbag: seen from behind, all of it — rolled back and sides — is around you
  'beanbag.orange': { cushion: [26.0, 16.7], sitStyle: 'floor', backrest: true, backLine: ALL('nw') },
  'beanbag.cyan': { cushion: [26.0, 17.0], sitStyle: 'floor', backrest: true, backLine: ALL('nw') },
  'beanbag.pink': { cushion: [26.0, 17.0], sitStyle: 'floor', backrest: true, backLine: ALL('nw') },
  'beanbag.purple': { cushion: [26.0, 17.0], sitStyle: 'floor', backrest: true, backLine: ALL('nw') },
};

/**
 * Seats calibrated in the Design Lab: art/seat-calibration.json ({key: Calibration}), written when the lab
 * publishes a seat (it clicks the same cushion centre, and fits it with the same seatCheck maths).
 */
const LAB_CALIBRATION = 'art/seat-calibration.json';
if (existsSync(LAB_CALIBRATION)) Object.assign(CALIBRATION, JSON.parse(readFileSync(LAB_CALIBRATION, 'utf8')) as Record<string, Calibration>);

/** The drawing the game uses for a seat in a facing, as the check takes it (its backrest line mirrored with it). */
function viewOf(key: string, f: Facing, profile: SeatProfile): SeatView {
  const { art, mirrored, drawn } = seatArt(key, f);
  const drawnLine = profile.backLine?.[drawn as 'ne' | 'nw'];
  return { art, facing: f, footprint: M[key].footprint, line: drawnLine && mirrored ? mirrorLine(drawnLine, art.px.w) : drawnLine };
}

function calibrated(key: string): SeatProfile | null {
  const c = CALIBRATION[key];
  if (!c) return null;
  const { art } = seatArt(key, 'se');
  const { seat, seatDepth } = profileFromPoint(art, 'se', c.cushion);
  const p: SeatProfile = { seat, seatDepth, backDepth: seatDepth, sitStyle: c.sitStyle, backrest: c.backrest, ...(c.backLine ? { backLine: c.backLine } : {}) };
  p.backDepth = fitBackDepth([viewOf(key, 'ne', p), viewOf(key, 'nw', p)], p);
  return p;
}

const same = (a: SeatProfile, b: SeatProfile) =>
  a.seat === b.seat &&
  a.seatDepth === b.seatDepth &&
  a.backDepth === b.backDepth &&
  a.sitStyle === b.sitStyle &&
  a.backrest === b.backrest &&
  JSON.stringify(a.backLine ?? null) === JSON.stringify(b.backLine ?? null);

/**
 * A calibration aid: the seat's front drawing (as resolved facing se) ×8 with its first cushion's centre line
 * dotted at several heights (every 2 world px around H; the larger dots every 0.1 tile, green at the tile
 * centre). The cushion's centre is where a line lies along the top of the cushion, halfway front to back.
 */
if (process.argv.includes('--grid')) {
  const key = process.argv[process.argv.indexOf('--grid') + 1];
  const around = Number(process.argv[process.argv.indexOf('--grid') + 2] ?? M[key]?.seat ?? 12) || 12;
  const { art } = seatArt(key, 'se');
  const Z = 8;
  const out = blank(art.px.w * Z, art.px.h * Z, [40, 36, 48], 255);
  for (let y = 0; y < art.px.h; y++)
    for (let x = 0; x < art.px.w; x++) {
      const i = (y * art.px.w + x) * 4;
      const col = art.px.d[i + 3] ? [art.px.d[i], art.px.d[i + 1], art.px.d[i + 2]] : (x + y) % 2 ? [70, 64, 80] : [62, 56, 72];
      for (let yy = 0; yy < Z; yy++) for (let xx = 0; xx < Z; xx++) out.d.set([col[0], col[1], col[2], 255], ((y * Z + yy) * out.w + x * Z + xx) * 4);
    }
  const dot = (X: number, Y: number, c: number[], r: number) => {
    for (let yy = -r; yy <= r; yy++)
      for (let xx = -r; xx <= r; xx++) {
        const px = Math.round(X * Z) + xx;
        const py = Math.round(Y * Z) + yy;
        if (px >= 0 && py >= 0 && px < out.w && py < out.h) out.d.set([...c, 255], (py * out.w + px) * 4);
      }
  };
  const hues = [[255, 90, 90], [255, 200, 60], [90, 230, 90], [90, 180, 255], [230, 110, 255]];
  [-4, -2, 0, 2, 4].forEach((dh, hi) => {
    const h = around + dh;
    for (let k = -10; k <= 10; k++) {
      const t = k / 20;
      dot(art.ax + 32 * t, art.ay + 16 + 16 * t - 2 * h, k === 0 ? [255, 255, 255] : hues[hi], k % 2 === 0 ? 2 : 1);
    }
  });
  // across the seat (a couch's length) at its height and hip depth: where each cushion's centre lies along it
  // (ticks every 0.1 tile, white at the tile centres)
  const { d: len } = seatPlacement(M[key].footprint, 'se');
  const t0 = M[key].seatDepth ?? 0;
  const h0 = M[key].seat ?? around;
  if (len > 1)
    for (let k = 0; k <= len * 20; k++) {
      const sy = k / 20;
      const X = art.ax + 32 * (0.5 + t0 - sy);
      const Y = art.ay + 16 * (0.5 + t0 + sy) - 2 * h0;
      dot(X, Y, k % 20 === 10 ? [255, 255, 255] : [40, 255, 255], k % 2 === 0 ? 2 : 1);
    }
  const file = `${OUT}/seatgrid-${key}.png`;
  writePng(file, out);
  console.log(`${file}: heights ${around - 4}…${around + 4} (red, orange, green, blue, violet), anchor ${art.ax},${art.ay}`);
  console.log('a pixel (x, y) on a line of height h at t tiles forward: x = ax + 32 t, y = ay + 16 + 16 t − 2 h');
  process.exit(0);
}

if (process.argv.includes('--fit') || process.argv.includes('--write')) {
  const fitted: Record<string, SeatProfile> = {};
  for (const key of seatKeys()) {
    const p = calibrated(key);
    if (p) fitted[key] = p;
    console.log(key.padEnd(20), p ? JSON.stringify(p) : 'NOT CALIBRATED');
  }
  if (process.argv.includes('--write')) {
    // the manifest is shared with the art pipeline: write under its lock, re-reading inside it
    const lock = 'public/art/.manifest.lock';
    for (let i = 0; ; i++) {
      try {
        closeSync(openSync(lock, 'wx'));
        break;
      } catch {
        if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 60000) unlinkSync(lock);
        if (i > 600) throw new Error('manifest lock timed out');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    try {
      const m = manifest();
      for (const [k, p] of Object.entries(fitted)) {
        const e = m.sprites[k];
        delete e.backLine;
        Object.assign(e, p);
      }
      writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
    } finally {
      unlinkSync(lock);
    }
    console.log(`wrote ${Object.keys(fitted).length} seat profiles`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ check */

const failures: string[] = [];
const cells: Array<{ key: string; f: Facing; img: Img; ok: boolean }> = [];
const CW = 150;
for (const key of seatKeys()) {
  const profile = profileOf(key);
  const want = calibrated(key);
  if (!want) failures.push(`${key}: not calibrated (add its cushion point to CALIBRATION)`);
  else if (M[key].seat === undefined || M[key].seatDepth === undefined || !M[key].sitStyle) failures.push(`${key}: profile not in the manifest (run --write)`);
  else if (!same(profile, want)) failures.push(`${key}: the manifest's profile no longer follows from the drawing (re-anchored or redrawn? re-measure, run --write)`);
  for (const f of FACINGS) {
    const r = checkSeatView(viewOf(key, f, profile), profile, { size: CW });
    for (const p of r.problems) failures.push(`${key} ${f}: ${p}`);
    const img = blank(CW, CW, [214, 196, 170], 255);
    for (let i = 0; i < CW * CW; i++) if (r.cell.d[i * 4 + 3]) img.d.set(r.cell.d.subarray(i * 4, i * 4 + 4), i * 4);
    cells.push({ key, f, img, ok: !r.problems.length });
  }
}

// the sheet: one row per seat kind, four facings, failures framed red
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const keys = [...new Set(cells.map((c) => c.key))];
const Z = Number(process.argv.find((a) => a.startsWith('--zoom='))?.slice(7) ?? 2);
const sheet = blank(CW * 4 * Z, CW * keys.length * Z, [30, 26, 36], 255);
cells.forEach((c) => {
  const row = keys.indexOf(c.key);
  const col = FACINGS.indexOf(c.f);
  for (let y = 0; y < CW; y++)
    for (let x = 0; x < CW; x++) {
      const edge = !c.ok && (x < 2 || y < 2 || x >= CW - 2 || y >= CW - 2);
      const s = (y * CW + x) * 4;
      const px = edge ? [220, 50, 50, 255] : [c.img.d[s], c.img.d[s + 1], c.img.d[s + 2], 255];
      for (let yy = 0; yy < Z; yy++) for (let xx = 0; xx < Z; xx++) sheet.d.set(px, (((row * CW + y) * Z + yy) * sheet.w + (col * CW + x) * Z + xx) * 4);
    }
});
const name = process.argv.find((a) => a.startsWith('--name='))?.slice(7) ?? 'seatfit-sheet';
writePng(`${OUT}/${name}-${Z}x.png`, sheet);
writeFileSync(`${OUT}/seatfit-report.md`, ['# Seat fit', '', `${keys.length} seat kinds × 4 facings`, '', ...(failures.length ? failures.map((f) => `- ${f}`) : ['all seats fit'])].join('\n') + '\n');
for (const f of failures) console.log('  !', f);
console.log(`${keys.length} seat kinds × 4 facings, ${failures.length} problem(s) → ${OUT}/${name}-${Z}x.png`);
process.exit(failures.length ? 1 : 0);
