/**
 * Room maps for layout work: every interior as an ASCII floor plan (what stands on each tile), the wall items
 * along both walls, and what's wrong with the layout:
 *   - overlaps: two standing things on one tile, or wall items sharing a stretch of wall;
 *   - occlusion: a tall floor piece (or an NPC at a work spot) standing in front of wall signage or art from
 *     the camera's view — its silhouette rises above the wall piece's bottom edge. Sprites are resolved the
 *     way the client resolves them (art.ts: facings, mirroring, small pieces centred on their footprint) and
 *     read per pixel column, so a thin lamp pole beside a frame doesn't count, but its shade in front does.
 *     The memory-wall slots (where future artifacts will hang) are checked too.
 *   - crowding: an occupied seat whose sitter would cover the face and body of someone sitting just behind
 *     them in the same screen column (see crowdedSeats).
 *
 *   npx tsx scripts/room-map.ts [roomId ...] [--quiet]     (exits 1 if anything is wrong)
 */
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { buildInteriors } from '../src/shared/world/interiors';
import { MEMORY_SLOTS } from '../src/shared/world/memory';
import { footprint, isSeat, type Facing, type SceneDef, type SceneObject } from '../src/shared/world/scene';
import { seatSpots } from '../src/shared/world/seats';
import { WalkGrid } from '../src/shared/world/walkGrid';
import { centredAnchor } from '../src/client/engine/sprites/footing';

/* ------------------------------------------------------------------ art, resolved like art.ts */
interface Img {
  w: number;
  h: number;
  d: Uint8Array;
}
function readPng(path: string): Img {
  const b = readFileSync(path);
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[y * (stride + 1) + 1 + x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const pp = a + up - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - up);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ct === 6) d.set(px.subarray(i * 4, i * 4 + 4), i * 4);
    else if (ct === 2) d.set([px[i * 3], px[i * 3 + 1], px[i * 3 + 2], 255], i * 4);
    else if (ct === 4) d.set([px[i * 2], px[i * 2], px[i * 2], px[i * 2 + 1]], i * 4);
    else if (ct === 3 && palette) {
      const k = px[i];
      d.set([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255], i * 4);
    } else d.set([px[i], px[i], px[i], 255], i * 4);
  }
  return { w, h, d };
}

interface ArtFile {
  file: string;
  anchor?: [number, number];
}
interface Entry {
  file?: string;
  anchor?: [number, number];
  facings?: Partial<Record<Facing, ArtFile>>;
  footprint: [number, number];
  fit?: string;
  pad?: number;
  wall?: { v: [number, number]; margin?: number };
}
const MANIFEST = JSON.parse(readFileSync('public/art/manifest.json', 'utf8')) as { scale: number; sprites: Record<string, Entry> };
const S = MANIFEST.scale;
const MIRROR: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };
const entryFor = (o: SceneObject) => (o.variant ? MANIFEST.sprites[`${o.sprite}.${o.variant}`] : undefined) ?? MANIFEST.sprites[o.sprite] ?? null;
const imgCache = new Map<string, Img>();
const image = (file: string) => {
  let i = imgCache.get(file);
  if (!i) {
    i = readPng(`public/art/sprites/${file}`);
    imgCache.set(file, i);
  }
  return i;
};

/** A floor piece as the camera sees it: for each screen column (world px), the highest point it reaches. */
type Silhouette = Map<number, number>;

function artSilhouette(o: SceneObject): Silhouette | null {
  const e = entryFor(o);
  if (!e || e.wall) return null;
  const facing = o.facing ?? 'se';
  let rec: ArtFile | undefined = e.file ? { file: e.file, anchor: e.anchor } : undefined;
  let mirror = !!e.file && e.footprint[0] !== e.footprint[1] && (o.w ?? 1) === e.footprint[1] && (o.d ?? 1) === e.footprint[0];
  if (e.facings) {
    rec = e.facings[facing];
    if (!rec && e.facings[MIRROR[facing]]) {
      rec = e.facings[MIRROR[facing]];
      mirror = true;
    }
    rec ??= Object.values(e.facings)[0];
  }
  if (!rec || !existsSync(`public/art/sprites/${rec.file}`)) return null;
  const src = image(rec.file);
  const img: Img = mirror ? { w: src.w, h: src.h, d: new Uint8Array(src.d.length) } : src;
  if (mirror)
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) img.d.set(src.d.subarray((y * src.w + x) * 4, (y * src.w + x) * 4 + 4), (y * src.w + (src.w - 1 - x)) * 4);
  let ax: number;
  let ay: number;
  const centred = centredAnchor(img, o.w ?? 1, o.d ?? 1, S);
  if (centred) [ax, ay] = centred;
  else if (rec.anchor) {
    [ax, ay] = rec.anchor;
    if (mirror) ax = img.w - ax;
  } else {
    const w = o.w ?? 1;
    const d = o.d ?? 1;
    const bottom = img.h - (e.pad ?? 0);
    ax = e.fit === 'stand' ? img.w / 2 - (w - d) * 8 * S : d * 16 * S;
    ay = e.fit === 'stand' ? bottom - (w + d) * 4 * S : bottom - (w + d) * 8 * S;
  }
  // the footprint's back vertex at floor level, on screen (world px)
  const bx = (o.x - o.y) * 16;
  const by = (o.x + o.y) * 8 - (o.z ?? 0);
  const out: Silhouette = new Map();
  for (let x = 0; x < img.w; x++)
    for (let y = 0; y < img.h; y++)
      if (img.d[(y * img.w + x) * 4 + 3] > 0) {
        const sx = Math.floor(bx + (x - ax) / S);
        const sy = by + (y - ay) / S;
        out.set(sx, Math.min(out.get(sx) ?? Infinity, sy));
        break;
      }
  return out;
}

/** Procedural pieces (no art yet): the footprint's diamond raised to a typical height. */
const PROC_HEIGHT: Record<string, number> = { counter: 21, stage: 0, rug: 0, chair: 30, desk: 30, bookshelf: 52 };
function boxSilhouette(o: SceneObject, height: number): Silhouette {
  const f = footprint(o);
  const out: Silhouette = new Map();
  const l = (f.x0 - f.y1) * 16;
  const r = (f.x1 - f.y0) * 16;
  const top = (f.x0 + f.y0) * 8 - (o.z ?? 0) - height;
  for (let sx = Math.ceil(l) + 2; sx < r - 2; sx++) out.set(sx, top);
  return out;
}

/** A person on a tile (feet at the tile centre): about 42 world px tall standing, 36 seated; 22 wide. */
function personSilhouette(x: number, y: number, seated = false): Silhouette {
  const cx = (x - y) * 16;
  const top = (x + y + 1) * 8 - (seated ? 36 : 42);
  const out: Silhouette = new Map();
  for (let sx = cx - 10; sx <= cx + 10; sx++) out.set(sx, top);
  return out;
}

/* ------------------------------------------------------------------ wall pieces */
/** Height bands (world px above the floor) of wall pieces drawn in code (ground.ts drawWallItem / interior.ts). */
const PROC_BAND: Record<string, [number, number]> = {
  window: [13, 50],
  door: [0, 46],
  plaque: [24, 40],
  frame: [24, 41],
  'menu-board': [22, 44],
  'logo-wall': [20, 46],
  elevator: [0, 46],
  bulletin: [20, 44],
  whiteboard: [16, 46],
  kanban: [16, 46],
  screen: [20, 42],
  pennant: [30, 46],
  banner: [36, 52],
  neon: [26, 44],
  moodboard: [18, 46],
  swatches: [20, 44],
  'sign-quiet': [28, 38],
};
interface WallPiece {
  name: string;
  face: 'left' | 'right';
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}
function wallPiece(o: SceneObject): WallPiece | null {
  const face = o.wall!;
  const u0 = face === 'right' ? o.x : o.y;
  const span = face === 'right' ? (o.w ?? 1) : (o.d ?? o.w ?? 1);
  const e = entryFor(o);
  let band: [number, number];
  let m = 0.1;
  if (o.sprite === 'window') {
    band = PROC_BAND.window;
    m = 0.16;
  } else if (o.sprite === 'door') band = PROC_BAND.door;
  else if (e?.wall && e.file) {
    band = e.wall.v;
    m = e.wall.margin ?? 0.08;
  } else band = PROC_BAND[o.sprite] ?? [20, 44];
  if (band[1] <= band[0]) return null;
  return { name: `${o.sprite}${o.variant ? '.' + o.variant : ''}`, face, u0: u0 + m, u1: u0 + span - m, v0: band[0], v1: band[1] };
}

/** How much a silhouette hides a wall piece: the covered width (world px) and the highest rise over its edge. */
function occlusion(sil: Silhouette, w: WallPiece): { width: number; rise: number } {
  const [lo, hi] = w.face === 'right' ? [w.u0 * 16, w.u1 * 16] : [-w.u1 * 16, -w.u0 * 16];
  let width = 0;
  let rise = 0;
  for (const [sx, top] of sil) {
    if (sx < lo || sx >= hi) continue;
    const bottom = (w.face === 'right' ? sx / 2 : -sx / 2) - w.v0; // the wall piece's lower edge on screen
    const r = bottom - top;
    if (r > 2) {
      width++;
      rise = Math.max(rise, r);
    }
  }
  return { width, rise };
}

/** Wall furniture that is meant to stand behind someone working (the shelving behind a bar), not signage. */
const BEHIND_STAFF = new Set(['backbar']);

function occlusions(s: SceneDef): string[] {
  const walls: WallPiece[] = s.objects
    .filter((o) => o.wall && !BEHIND_STAFF.has(o.sprite))
    .map(wallPiece)
    .filter((w): w is WallPiece => !!w);
  for (const slot of MEMORY_SLOTS[s.id] ?? [])
    walls.push({ name: `memory slot ${slot.wall}:${slot.at}`, face: slot.wall, u0: slot.at + 0.14, u1: slot.at + 0.86, v0: PROC_BAND.frame[0], v1: PROC_BAND.frame[1] });
  const tall: Array<{ what: string; sil: Silhouette }> = [];
  for (const o of s.objects) {
    if (o.wall || o.flat) continue;
    const sil = artSilhouette(o) ?? boxSilhouette(o, PROC_HEIGHT[o.sprite] ?? 30);
    tall.push({ what: `${o.id} (${o.sprite}${o.variant ? '.' + o.variant : ''} at ${o.x},${o.y})`, sil });
  }
  for (const n of s.npcs ?? []) for (const sp of n.spots) tall.push({ what: `NPC ${n.name} at ${sp.x},${sp.y}`, sil: personSilhouette(sp.x, sp.y, !!sp.sit) });
  const out: string[] = [];
  for (const w of walls)
    for (const t of tall) {
      const { width, rise } = occlusion(t.sil, w);
      // a sliver at the edge of a frame is fine; a real chunk of it hidden is not
      if (width >= Math.min(6, (w.u1 - w.u0) * 16 * 0.25) && rise > 3)
        out.push(`${s.id}: ${t.what} hides ${w.name} on the ${w.face} wall (${width}px wide, rises ${Math.round(rise)}px over its bottom edge)`);
    }
  return out;
}

/* ------------------------------------------------------------------ sitters crowding each other */
/**
 * Two occupied seats whose sitters land in the same screen column, the nearer one close enough in depth that
 * its figure covers the farther sitter's face and body (an armchair tucked behind a sofa cushion). Only a
 * sitter who faces the camera (se / sw) can be crowded this way: rows of backs (an audience, the near side of
 * a desk pod) overlap naturally. Figures are the kit's seated silhouette in world px from the sitter's anchor:
 * about 22 px wide, 34 px tall, lifted by the seat's height.
 */
function crowdedSeats(s: SceneDef): string[] {
  const manifest = existsSync('public/art/manifest.json') ? JSON.parse(readFileSync('public/art/manifest.json', 'utf8')).sprites : {};
  const seatH = (o: SceneObject): number => {
    const e = (o.variant && manifest[`${o.sprite}.${o.variant}`]) || manifest[o.sprite];
    return typeof e?.seat === 'number' ? e.seat - 6.5 : 4;
  };
  const spots = s.objects.filter(isSeat).flatMap((o) => seatSpots(o, s).map((sp) => ({ o, sp, lift: seatH(o) })));
  const out: string[] = [];
  for (const a of spots)
    for (const b of spots) {
      if (a === b || a.o === b.o) continue;
      if (a.sp.facing !== 'se' && a.sp.facing !== 'sw') continue;
      // b in front of a (greater depth)
      const da = a.sp.x + a.sp.y;
      const db = b.sp.x + b.sp.y;
      if (db <= da || db - da > 3) continue;
      const ax = (a.sp.x - a.sp.y) * 16;
      const bx = (b.sp.x - b.sp.y) * 16;
      if (Math.abs(ax - bx) >= 12) continue;
      const ay = (da + 1) * 8 - a.lift;
      const by = (db + 1) * 8 - b.lift;
      // b's figure top (by - 34) above a's seat line (ay) by more than a few px: it covers a's torso and face
      const cover = ay - (by - 34);
      if (cover > 6) out.push(`${s.id}: sitter on ${b.o.id} (${b.sp.x},${b.sp.y}) covers the sitter facing out on ${a.o.id} (${a.sp.x},${a.sp.y}) by ${Math.round(cover)}px`);
    }
  return out;
}

/* ------------------------------------------------------------------ report */
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const only = args.filter((a) => !a.startsWith('--'));
let problems = 0;
const say = (line: string) => {
  if (!quiet) console.log(line);
};
for (const s of buildInteriors()) {
  if (only.length && !only.includes(s.id)) continue;
  const cell: string[][] = Array.from({ length: s.height }, () => Array.from({ length: s.width }, () => ''));
  const key = new Map<string, string>();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@$%&*+=?';
  const grid = new WalkGrid(s);
  const walls: Record<'left' | 'right', Array<[number, number, string]>> = { left: [], right: [] };
  for (const o of s.objects) {
    if (o.wall) {
      const at = o.wall === 'right' ? o.x : o.y;
      const len = o.wall === 'right' ? (o.w ?? 1) : (o.d ?? o.w ?? 1);
      walls[o.wall].push([at, at + len, `${o.sprite}${o.variant ? '.' + o.variant : ''}`]);
      continue;
    }
    if (o.flat) continue;
    const name = `${o.sprite}${o.variant ? '.' + o.variant : ''}`;
    if (!key.has(name)) key.set(name, letters[key.size % letters.length]);
    const f = footprint(o);
    for (let y = f.y0; y < f.y1; y++)
      for (let x = f.x0; x < f.x1; x++) {
        if (y < 0 || x < 0 || y >= s.height || x >= s.width) {
          console.log(`  ! ${s.id}: ${o.id} off the floor at ${x},${y}`);
          problems++;
          continue;
        }
        cell[y][x] += (o.z ? '^' : '') + key.get(name)!;
      }
  }
  say(`\n== ${s.id} (${s.width}×${s.height}, door y=${s.interior?.doorY})`);
  say('    ' + [...Array(s.width).keys()].map((x) => String(x % 10)).join(' '));
  for (let y = 0; y < s.height; y++) {
    const row = cell[y].map((c, x) => {
      const standing = c.replace(/\^./g, '');
      if (standing.length > 1) {
        console.log(`  ! ${s.id}: overlap at ${x},${y}: ${c}`);
        problems++;
      }
      return standing[0] ?? (grid.walkable(x, y) ? '.' : '#');
    });
    say(String(y).padStart(3) + ' ' + row.join(' '));
  }
  for (const side of ['left', 'right'] as const) {
    const w = walls[side].sort((a, b) => a[0] - b[0]);
    say(`  ${side} wall: ` + w.map(([a, b, n]) => `${n}[${a}-${b - 1}]`).join('  '));
    for (let i = 1; i < w.length; i++)
      if (w[i][0] < w[i - 1][1]) {
        console.log(`  ! ${s.id}: ${side} wall overlap ${w[i - 1][2]} / ${w[i][2]}`);
        problems++;
      }
  }
  say('  ' + [...key].map(([n, l]) => `${l}=${n}`).join(' '));
  for (const line of occlusions(s)) {
    console.log(`  ! ${line}`);
    problems++;
  }
  for (const line of crowdedSeats(s)) {
    console.log(`  ! ${line}`);
    problems++;
  }
}
console.log(problems ? `\n${problems} problem(s)` : '\nno overlaps, nothing hides the walls');
process.exit(problems ? 1 : 0);
