/**
 * Furniture review, out of the game: every piece of finished art in all four rotations, resolved exactly as
 * the client resolves it (art.ts: per-facing drawings, mirrored partners, swapped footprints), checked
 * against the furniture standard and drawn with its footprint.
 *
 *   npx tsx scripts/furniture-review.ts [key ...]
 *
 * The standard:
 *   - a piece's base sits centred on its footprint: the centre of its base contact (the bottom rows of the
 *     drawing) lands on the footprint's centre, within 3 sprite px (1.5 world px)
 *   - no stray pixels: nothing detached from the piece smaller than 6 px
 *   - nothing sliced by its frame: the top rows narrow to a cap instead of running flat across (a crown of leaves
 *     cut straight by the slicer)
 *   - every rotation exists: a front and a back drawing (the other two are mirrors), unless it's round
 *   - seats say how high their seat is (manifest `seat`)
 *   - THE FILL RULE (footing.ts fillProblems), in every facing, mirrors included: a large piece whose `base` is
 *     'filled' fills its footprint diamond (or is inset evenly) and ends on its front corner; a 'centred' one
 *     stands its narrow base on the footprint's centre
 *
 * Output (art/review/furniture/): <key>.png (se, sw, ne, nw at 3× with the footprint in cyan, its centre as a
 * cyan dot and the base centre as a red dot), index.png (everything, se), report.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { baseCentre as footingCentre, fillProblems, isSmall, silhouette } from '../src/client/engine/sprites/footing';
import { allScenes } from '@shared/world';

type Facing = 'se' | 'sw' | 'ne' | 'nw';
const FACINGS: Facing[] = ['se', 'sw', 'ne', 'nw'];
const MIRROR: Record<Facing, Facing> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' };
const OUT = 'art/review/furniture';
/** Things drawn once for every rotation because they look the same from all sides. */
const ROUND = /^(plant|lamp|stool|ottoman|jar|grinder|cake-stand|cups|beanbag|table-round|table-low|heirloom-globe|heirloom-bell|heirloom-trophy|time-capsule|heirloom-gold)/;
const SEATS = /^(chair|armchair|couch|stool|beanbag|bench|heirloom-throne)/;
/**
 * Keys placed inside rooms (and so in the rearrangeable furniture catalogue): these need every rotation.
 * Town pieces (buildings, trees, the lighthouse) stand as authored.
 */
const ROOM_KEYS = new Set<string>();
for (const scene of allScenes().values())
  if (scene.kind === 'interior') for (const o of scene.objects) ROOM_KEYS.add(o.variant ? `${o.sprite}.${o.variant}` : o.sprite).add(o.sprite);

/* ------------------------------------------------------------------ PNG in / out */
interface Img {
  w: number;
  h: number;
  d: Uint8Array; // RGBA
}
function readPng(path: string): Img {
  const b = readFileSync(path);
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  let depth = 0;
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
      depth = data[8];
      ct = data[9];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`${path}: bit depth ${depth}`);
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
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
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(t: string, data: Buffer) {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(t), data]);
  let c = 0xffffffff;
  for (const x of td) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  const cb = Buffer.alloc(4);
  cb.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([l, td, cb]);
}
function writePng(path: string, img: Img) {
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(img.w, 0);
  ih.writeUInt32BE(img.h, 4);
  ih[8] = 8;
  ih[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) Buffer.from(img.d.buffer, img.d.byteOffset + y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const mirrorImg = (m: Img): Img => {
  const d = new Uint8Array(m.d.length);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) d.set(m.d.subarray((y * m.w + x) * 4, (y * m.w + x) * 4 + 4), (y * m.w + (m.w - 1 - x)) * 4);
  return { w: m.w, h: m.h, d };
};

/* ------------------------------------------------------------------ the standard */
interface Entry {
  file?: string;
  anchor?: [number, number];
  facings?: Partial<Record<Facing, { file: string; anchor?: [number, number] }>>;
  footprint: [number, number];
  wall?: unknown;
  seat?: number;
  pad?: number;
  /** The model spec's base contact (src/shared/models.ts). */
  base?: 'filled' | 'centred';
}
export interface Placed {
  img: Img;
  ax: number;
  ay: number;
  w: number;
  d: number;
  mirrored: boolean;
  file: string;
}

/** The drawing, anchor and footprint the client uses for an entry in a facing (mirrors art.ts). */
export function resolve(e: Entry, facing: Facing, sprites: string): Placed | null {
  let rec = e.file ? { file: e.file, anchor: e.anchor } : undefined;
  let [w, d] = e.footprint;
  let mirror = false;
  if (e.facings) {
    // a drawing per facing is for the footprint as placed in that facing (models.ts footprintFacing): a long piece
    // facing se or nw is turned
    if (facing === 'se' || facing === 'nw') [w, d] = [d, w];
    rec = e.facings[facing];
    if (!rec && e.facings[MIRROR[facing]]) {
      rec = e.facings[MIRROR[facing]];
      mirror = true;
    }
    rec ??= Object.values(e.facings)[0];
  } else if (w !== d && (facing === 'sw' || facing === 'nw')) {
    // a single drawing of a long piece: as authored (se, ne), or turned 90° — its mirror with the footprint
    // swapped (sw, nw), exactly as art.ts does for an object placed with w and d swapped
    mirror = true;
    [w, d] = [d, w];
  }
  if (!rec?.anchor) return null;
  let img = readPng(`${sprites}/${rec.file}`);
  let [ax, ay] = rec.anchor;
  if (mirror) {
    img = mirrorImg(img);
    ax = img.w - ax;
  }
  return { img, ax, ay, w, d, mirrored: mirror, file: rec.file };
}

/** Where the footprint's centre is in the drawing (sprite px, 64 px per tile). */
export const footCentre = (p: Placed): [number, number] => [p.ax + 16 * (p.w - p.d), p.ay + 8 * (p.w + p.d)];

/**
 * How a piece sits on its footprint. A SMALL piece (its base much narrower than the footprint: things on a
 * counter, lamps, ornaments) must have its base centred on the footprint. A LARGE piece fills its footprint:
 * it must not spill past the footprint's left, right or front vertex.
 */
export function placement(
  p: Placed,
  town = false,
  key = '',
  base?: 'filled' | 'centred',
): { kind: 'small'; dx: number; dy: number } | { kind: 'large'; spill: string[] } {
  const fc = footCentre(p);
  const bc = footingCentre(p.img);
  if (bc && isSmall(p.img, p.w, p.d)) return { kind: 'small', dx: bc[0] - fc[0], dy: bc[1] - fc[1] };
  // the fill rule, for a piece whose model spec says how it meets the floor
  if (base && !key.startsWith('building.')) return { kind: 'large', spill: fillProblems(p.img, p.ax, p.ay, p.w, p.d, base) };
  // A large piece stands on its footprint: its BASE (the lower part of the drawing, where it meets the
  // ground) must not spill past the footprint's corners. Canopies, eaves and roofs above may overhang.
  const e = silhouette(p.img)!;
  const baseTop = Math.max(e.t, p.ay + 16 * Math.min(p.w, p.d)); // below the footprint's side corners
  let l = p.img.w;
  let r = -1;
  for (let y = baseTop; y <= e.b; y++)
    for (let x = 0; x < p.img.w; x++)
      if (p.img.d[(y * p.img.w + x) * 4 + 3] > 0) {
        l = Math.min(l, x);
        r = Math.max(r, x);
      }
  const left = p.ax - 32 * p.d;
  const right = p.ax + 32 * p.w;
  const front = p.ay + 16 * (p.w + p.d);
  const spill: string[] = [];
  // a building's stoop (steps, planters, a parked bike) may stand on the kept-clear apron in front of it
  const slack = key.startsWith('building.') ? 24 : 4;
  if (r >= 0 && l < left - slack) spill.push(`base left by ${left - l}px`);
  if (r >= 0 && r > right + slack) spill.push(`base right by ${r - right}px`);
  if (e.b > front + slack) spill.push(`front by ${e.b - front}px`);
  // …and a town piece standing on a narrow base (a trunk, a post) stands on the footprint's centre. (Room
  // furniture on legs reads as narrow at its very bottom, so this only applies outdoors.)
  if (town && bc && r >= 0 && p.w * p.d <= 4) {
    let bl = p.img.w;
    let br = -1;
    for (let y = Math.max(0, e.b - 5); y <= e.b; y++)
      for (let x = 0; x < p.img.w; x++)
        if (p.img.d[(y * p.img.w + x) * 4 + 3] > 0) {
          bl = Math.min(bl, x);
          br = Math.max(br, x);
        }
    // pieces that fill their diamond (a flowerbed) end in its front vertex: narrow at the very bottom by
    // construction, so only a base that is narrow over its lower 30 % counts
    const wide = r - l >= (p.w + p.d) * 32 * 0.7;
    const narrow = !wide && br - bl < (p.w + p.d) * 32 * 0.5;
    // where the trunk or post meets the ground: the middle of its very bottom rows
    const dx = (bl + br) / 2 - fc[0];
    const dy = e.b - (br - bl) / 4 - fc[1];
    // organic pieces (roots, grass tufts) get a little more slack than furniture
    if (narrow && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) spill.push(`narrow base off the footprint centre by (${dx.toFixed(1)}, ${dy.toFixed(1)}) sprite px`);
  }
  return { kind: 'large', spill };
}

/** Pieces of the drawing not connected to the main body, smaller than `min` px. */
export function specks(img: Img, min = 6): number[] {
  const seen = new Int32Array(img.w * img.h).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < img.w * img.h; s++) {
    if (img.d[s * 4 + 3] === 0 || seen[s] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const q = [s];
    seen[s] = id;
    while (q.length) {
      const i = q.pop()!;
      n++;
      const x = i % img.w;
      const y = (i / img.w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx;
          const Y = y + dy;
          if (X < 0 || Y < 0 || X >= img.w || Y >= img.h) continue;
          const j = Y * img.w + X;
          if (img.d[j * 4 + 3] > 0 && seen[j] < 0) {
            seen[j] = id;
            q.push(j);
          }
        }
    }
    sizes.push(n);
  }
  const big = Math.max(...sizes);
  return sizes.filter((n) => n < min && n < big);
}

/* ------------------------------------------------------------------ drawing */
function canvas(w: number, h: number, bg: [number, number, number]): Img {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([...bg, 255], i * 4);
  return { w, h, d };
}
function put(c: Img, x: number, y: number, rgb: number[]) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  c.d.set([rgb[0], rgb[1], rgb[2], 255], (y * c.w + x) * 4);
}
function paste(c: Img, img: Img, ox: number, oy: number, z: number) {
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      const a = img.d[i + 3] / 255;
      if (!a) continue;
      for (let yy = 0; yy < z; yy++)
        for (let xx = 0; xx < z; xx++) {
          const X = ox + x * z + xx;
          const Y = oy + y * z + yy;
          if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) continue;
          const j = (Y * c.w + X) * 4;
          for (let k = 0; k < 3; k++) c.d[j + k] = c.d[j + k] * (1 - a) + img.d[i + k] * a;
        }
    }
}
function line(c: Img, x0: number, y0: number, x1: number, y1: number, rgb: number[]) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) put(c, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), rgb);
}
function dot(c: Img, x: number, y: number, rgb: number[]) {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) put(c, Math.round(x) + dx, Math.round(y) + dy, rgb);
}

/**
 * A drawing sliced by its own frame: the top rows are opaque across the same span, row after row, instead of
 * narrowing to a cap (a leafy crown or a lamp shade cut flat by the slicer). Round tops and diamond corners
 * narrow toward the edge, so they pass. Returns the flat run's width, or 0.
 */
function slicedTop(img: Img): number {
  const span = (y: number) => {
    let l = -1;
    let r = -1;
    for (let x = 0; x < img.w; x++)
      if (img.d[(y * img.w + x) * 4 + 3]) {
        if (l < 0) l = x;
        r = x;
      }
    return l < 0 ? 0 : r - l + 1;
  };
  if (img.h < 4) return 0;
  const [a, b, c] = [span(0), span(1), span(2)];
  return a > 6 && b - a < 2 && c - b < 2 ? a : 0;
}

/* ------------------------------------------------------------------ main */
/** A manifest key as a single file name (keys like `tree/birch.a` contain slashes). */
const fileSafe = (key: string) => key.replace(/[\/:*?"<>|]+/g, '__');

export function reviewEntry(key: string, e: Entry, sprites: string) {
  const issues: string[] = [];
  const cells: Array<{ facing: Facing; p: Placed | null }> = FACINGS.map((f) => ({ facing: f, p: resolve(e, f, sprites) }));
  if (!e.facings && !ROUND.test(key) && ROOM_KEYS.has(key)) issues.push('one drawing for all rotations (needs a front and a back unless it is round)');
  if (e.facings && !(e.facings.se || e.facings.sw)) issues.push('no front drawing (se/sw)');
  if (e.facings && !(e.facings.ne || e.facings.nw)) issues.push('no back drawing (ne/nw)');
  if (SEATS.test(key) && e.seat === undefined) issues.push('seat without seat height');
  const offsets: Array<{ facing: Facing; dx: number; dy: number }> = [];
  for (const { facing, p } of cells) {
    if (!p) continue;
    // every piece turns four ways (docs/furniture.md), town pieces too: each facing answers for itself
    const fit = placement(p, !ROOM_KEYS.has(key), key, e.base);
    if (fit.kind === 'small') {
      // small pieces are centred on their footprint at runtime (art.ts + footing.ts); record how far off the
      // drawing's own anchor was
      offsets.push({ facing, dx: fit.dx, dy: fit.dy });
    } else if (fit.spill.length) issues.push(`${facing}: ${fit.spill.join('; ')}`);
    const cut = slicedTop(p.img);
    if (cut && (facing === 'se' || facing === 'ne' || !p.mirrored)) issues.push(`${facing}: top sliced flat (${cut} px) in ${p.file}`);
    const sp = specks(p.img);
    if (sp.length && (facing === 'se' || facing === 'ne' || !p.mirrored)) issues.push(`${facing}: ${sp.length} stray bit(s) (${sp.join(', ')} px) in ${p.file}`);
  }
  const worst = offsets.reduce((m, o) => Math.max(m, Math.abs(o.dx), Math.abs(o.dy)), 0);
  const notes = worst > 3 ? [`centred at runtime (its drawing's anchor was up to ${worst.toFixed(1)} sprite px off)`] : [];
  return { issues: [...new Set(issues)], notes, cells, offsets };
}

function main() {
  const manifest = JSON.parse(readFileSync('public/art/manifest.json', 'utf8')) as { sprites: Record<string, Entry> };
  const only = process.argv.slice(2);
  mkdirSync(OUT, { recursive: true });
  const report: string[] = ['# Furniture review', ''];
  let bad = 0;
  const Z = 3;
  for (const [key, e] of Object.entries(manifest.sprites)) {
    if (e.wall) continue;
    if (only.length && !only.some((o) => key.startsWith(o))) continue;
    const { issues, notes, cells } = reviewEntry(key, e, 'public/art/sprites');
    // each cell fits the drawing and its footprint diamond, whatever their size
    const ext = cells.map(({ p }) => (p ? { l: Math.min(0, p.ax - 32 * p.d), r: Math.max(p.img.w, p.ax + 32 * p.w), b: Math.max(p.img.h, p.ay + 16 * (p.w + p.d)) } : { l: 0, r: 110, b: 110 }));
    const spanW = Math.max(...ext.map((e) => e.r - e.l));
    const spanH = Math.max(...ext.map((e) => e.b));
    const Zk = Math.max(spanW, spanH) > 200 ? 1 : Z;
    const cw = Math.round((spanW + 30) * Zk);
    const ch = Math.round((spanH + 30) * Zk);
    const sheet = canvas(cw * 4, ch, [58, 48, 70]);
    cells.forEach(({ p }, i) => {
      if (!p) return;
      const ox = i * cw + Math.round((15 - ext[i].l) * Zk);
      const oy = Math.round(15 * Zk);
      // footprint diamond
      const V = (x: number, y: number): [number, number] => [ox + (p.ax + (x - y) * 32) * Zk, oy + (p.ay + (x + y) * 16) * Zk];
      const quad = [V(0, 0), V(p.w, 0), V(p.w, p.d), V(0, p.d)];
      for (let k = 0; k < 4; k++) line(sheet, ...quad[k], ...quad[(k + 1) % 4], [80, 240, 255]);
      paste(sheet, p.img, ox, oy, Zk);
      for (let k = 0; k < 4; k++) line(sheet, ...quad[k], ...quad[(k + 1) % 4], [80, 240, 255]);
      const fc = footCentre(p);
      dot(sheet, ox + fc[0] * Zk, oy + fc[1] * Zk, [80, 240, 255]);
      const bc = footingCentre(p.img);
      if (bc) dot(sheet, ox + bc[0] * Zk, oy + bc[1] * Zk, [240, 60, 60]);
    });
    writePng(`${OUT}/${fileSafe(key)}.png`, sheet);
    if (issues.length) bad++;
    report.push(`## ${key} — ${issues.length ? issues.length + ' issue(s)' : 'ok'}`, ...issues.map((i) => `- ${i}`), ...notes.map((n) => `- note: ${n}`), '');
  }
  report.splice(1, 0, `${bad} piece(s) with issues. Sheets: se, sw, ne, nw — cyan: footprint and its centre, red: base centre.`, '');
  writeFileSync(`${OUT}/report.md`, report.join('\n'));
  console.log(`${bad} piece(s) with issues → ${OUT}/report.md`);
}

if (process.argv[1]?.includes('furniture-review')) main();
