/**
 * Character review, out of the game: renders every character in all four facings and five poses with the
 * game's own avatar code, lints each frame, and writes review sheets.
 *
 *   npx tsx scripts/avatar-review.ts [--only name,name] [--looks file.json]
 *
 * Output (art/review/characters/):
 *   <name>.png   rows = stand, walk1, walk2, sit, wave; columns = se, sw, ne, nw; each cell at 4×, with the
 *                true 1:1 sprites along the top
 *   index-front.png / index-back.png   every character standing, at 3×
 *   report.md    every lint issue, by character
 *
 * Characters: the seeded roster plus members saved in .data/minglewood.json (real people and bots).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildSeed } from '@shared/seed/northstar';
import type { AvatarLoadout } from '@shared/domain/types';
import { ITEM_BY_ID, normalizeLoadout, randomLoadout } from '@shared/avatar';
import { FACINGS, POSES, lintAvatar, renderAvatarLayers } from '../src/client/engine/sprites/avatarQa';

const W = 88;
const H = 112;
const OUT = 'art/review/characters';

/* ------------------------------------------------------------------ tiny PNG writer */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer) {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w: number, h: number, rgba: Uint8ClampedArray | Uint8Array) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ a canvas of pixels */
class Sheet {
  d: Uint8ClampedArray;
  constructor(
    public w: number,
    public h: number,
    bg: [number, number, number],
  ) {
    this.d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      this.d[i * 4] = bg[0];
      this.d[i * 4 + 1] = bg[1];
      this.d[i * 4 + 2] = bg[2];
      this.d[i * 4 + 3] = 255;
    }
  }
  /** Paste an 88×112 sprite (cropped to [cx, cy, cw, ch]) at (ox, oy), magnified z×. */
  paste(px: Uint8ClampedArray, ox: number, oy: number, z: number, crop = [0, 0, W, H]) {
    const [cx, cy, cw, ch] = crop;
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const s = ((cy + y) * W + cx + x) * 4;
        const a = px[s + 3] / 255;
        if (!a) continue;
        for (let yy = 0; yy < z; yy++)
          for (let xx = 0; xx < z; xx++) {
            const X = ox + x * z + xx;
            const Y = oy + y * z + yy;
            if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) continue;
            const d = (Y * this.w + X) * 4;
            for (let k = 0; k < 3; k++) this.d[d + k] = this.d[d + k] * (1 - a) + px[s + k] * a;
          }
      }
  }
  rect(x0: number, y0: number, w: number, h: number, c: [number, number, number]) {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const d = (y * this.w + x) * 4;
        this.d[d] = c[0];
        this.d[d + 1] = c[1];
        this.d[d + 2] = c[2];
      }
  }
  save(path: string) {
    writeFileSync(path, png(this.w, this.h, this.d));
  }
}

/* ------------------------------------------------------------------ characters */
interface Who {
  id: string;
  name: string;
  look: AvatarLoadout;
}
function roster(): Who[] {
  const out: Who[] = buildSeed().members.map((m) => ({ id: m.id, name: m.displayName, look: m.avatar }));
  if (existsSync('.data/minglewood.json')) {
    const walk = (o: unknown) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      const r = o as Record<string, unknown>;
      if (typeof r.displayName === 'string' && r.avatar && typeof r.id === 'string' && !out.some((w) => w.id === r.id))
        out.push({ id: r.id, name: r.displayName, look: r.avatar as AvatarLoadout });
      Object.values(r).forEach(walk);
    };
    walk(JSON.parse(readFileSync('.data/minglewood.json', 'utf8')));
  }
  const ri = process.argv.indexOf('--random');
  const nr = ri > 0 ? Number(process.argv[ri + 1]) : 40;
  for (let k = 0; k < nr; k++) out.push({ id: `random-${k}`, name: `Random ${String(k).padStart(2, '0')}`, look: randomLoadout(`qa-${k}`) });
  const i = process.argv.indexOf('--looks');
  if (i > 0) for (const [id, look] of Object.entries(JSON.parse(readFileSync(process.argv[i + 1], 'utf8')))) out.push({ id, name: id, look: look as AvatarLoadout });
  return out;
}
const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'x';

/* ------------------------------------------------------------------ main */
mkdirSync(OUT, { recursive: true });
let people = roster();
const oi = process.argv.indexOf('--only');
if (oi > 0) {
  const want = process.argv[oi + 1].toLowerCase().split(',');
  people = people.filter((p) => want.some((w) => p.name.toLowerCase().startsWith(w) || p.id === w));
}
const BG: [number, number, number] = [232, 220, 198];
const CROP = [14, 8, 60, 102]; // the figure plus room for hair, hats and a balloon
const Z = 4;
const report: string[] = ['# Character review', ''];
let total = 0;
/** Failures attributed to the asset that owns the zone (hair or hat), per view: which assets break the standard. */
const byAsset = new Map<string, { n: number; who: Set<string>; kinds: Set<string> }>();
const blame = (look: AvatarLoadout, view: string, kind: string, who: string) => {
  const L = normalizeLoadout(look);
  const hat = ITEM_BY_ID.get(L.headwear);
  const asset = kind === 'speck' ? 'unattributed' : hat && hat.id !== 'hat.none' && (hat.coversHair || kind !== 'bald') ? `${L.headwear} (${view})` : `${L.hair} (${view})`;
  const e = byAsset.get(asset) ?? { n: 0, who: new Set(), kinds: new Set() };
  e.n++;
  e.who.add(who);
  e.kinds.add(kind);
  byAsset.set(asset, e);
};
for (const p of people) {
  const cw = CROP[2] * Z + 8;
  const ch = CROP[3] * Z + 8;
  const top = H + 16;
  const sheet = new Sheet(cw * FACINGS.length, top + ch * POSES.length, BG);
  const lines: string[] = [];
  FACINGS.forEach((f, fi) => {
    POSES.forEach((pose, pi) => {
      const r = renderAvatarLayers(p.look, f, pose);
      const px = r.px;
      if (pi === 0) sheet.paste(px, fi * cw + 4, 4, 1);
      if (pi === 0) sheet.paste(px, fi * cw + W + 12, 4, 1, [0, 0, W, H]);
      sheet.paste(px, fi * cw + 4, top + pi * ch + 4, Z, CROP);
      const issues = lintAvatar(p.look, f, pose, r);
      if (issues.length) {
        sheet.rect(fi * cw, top + pi * ch, cw, 3, [220, 60, 60]);
        for (const is of issues) {
          lines.push(`- ${f} ${pose}: **${is.kind}** — ${is.detail}`);
          blame(p.look, f === 'se' || f === 'sw' ? 'front' : 'back', is.kind, p.name);
        }
      }
    });
  });
  sheet.save(`${OUT}/${slug(p.name)}.png`);
  total += lines.length;
  report.push(`## ${p.name} (${p.id}) — ${lines.length ? `${lines.length} issue(s)` : 'clean'}`, ...lines, '');
}
// index sheets: everyone standing, front (se) and back (ne)
for (const [facing, file] of [
  ['se', 'index-front'],
  ['ne', 'index-back'],
] as const) {
  const cols = 10;
  const z = 3;
  const cw = CROP[2] * z + 6;
  const ch = CROP[3] * z + 6;
  const sheet = new Sheet(cw * cols, ch * Math.ceil(people.length / cols), BG);
  people.forEach((p, i) => sheet.paste(renderAvatarLayers(p.look, facing, 'stand').px, (i % cols) * cw + 3, Math.floor(i / cols) * ch + 3, z, CROP));
  sheet.save(`${OUT}/${file}.png`);
}
const assets = [...byAsset.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `- **${k}** — ${v.n} frame(s), ${[...v.kinds].join('/')}: ${[...v.who].slice(0, 6).join(', ')}`);
report.splice(1, 0, `${people.length} characters × ${FACINGS.length} facings × ${POSES.length} poses — ${total} issue(s).`, '', '## By asset', ...assets, '', 'Index order: ' + people.map((p) => p.name).join(', '), '');
writeFileSync(`${OUT}/report.md`, report.join('\n'));
console.log(`${people.length} characters, ${total} issue(s) → ${OUT}/`);

/* ------------------------------------------------------------------ asset galleries */
// One row per item, on a neutral base: se, sw, ne, nw standing, then se walk / se sit / ne sit.
// Every catalogue item is checked on its own, so a bad asset can't hide behind a good outfit.
{
  const GAL = 'art/review/assets';
  mkdirSync(GAL, { recursive: true });
  const base: AvatarLoadout = {
    skin: '#e8b48c',
    hair: 'hair.short',
    hairColor: '#5a3825',
    top: 'top.tee',
    topColor: '#3f8fd8',
    bottom: 'bottom.jeans',
    bottomColor: '#1f2a44',
    shoes: 'shoes.sneakers',
    shoesColor: '#f4efe6',
  };
  const slots: Array<[string, (id: string) => Partial<AvatarLoadout>]> = [
    ['hair', (id) => ({ hair: id })],
    ['headwear', (id) => ({ headwear: id, headwearColor: '#e0503f' })],
    ['top', (id) => ({ top: id, topColor: '#2bb3a3' })],
    ['bottom', (id) => ({ bottom: id, bottomColor: '#3a3a46' })],
    ['shoes', (id) => ({ shoes: id, shoesColor: '#ff8a3d' })],
    ['eyewear', (id) => ({ eyewear: id })],
    ['neck', (id) => ({ neck: id, neckColor: '#e0503f' })],
    ['accessory', (id) => ({ accessory: id })],
    ['held', (id) => ({ held: id, heldColor: '#9b6bd6' })],
    ['pet', (id) => ({ pet: id })],
    ['facialHair', (id) => ({ facialHair: id })],
  ];
  const frames: Array<[import('@shared/world/scene').Facing, import('../src/client/engine/sprites/avatarFrame').Pose]> = [
    ['se', 'stand'],
    ['sw', 'stand'],
    ['ne', 'stand'],
    ['nw', 'stand'],
    ['se', 'walk1'],
    ['se', 'sit'],
    ['ne', 'sit'],
  ];
  const z = 3;
  const cw = CROP[2] * z + 6;
  const ch = CROP[3] * z + 6;
  const lines: string[] = ['# Asset QA', ''];
  for (const [slot, put] of slots) {
    const items = [...ITEM_BY_ID.values()].filter((i) => i.slot === slot && !i.id.endsWith('.none'));
    const sheet = new Sheet(cw * frames.length, ch * items.length, BG);
    items.forEach((it, row) => {
      const look = { ...base, ...put(it.id) };
      frames.forEach(([f, pose], col) => {
        const r = renderAvatarLayers(look, f, pose);
        sheet.paste(r.px, col * cw + 3, row * ch + 3, z, CROP);
        const issues = lintAvatar(look, f, pose, r);
        if (issues.length) {
          sheet.rect(col * cw, row * ch, cw, 3, [220, 60, 60]);
          lines.push(`- ${it.id} ${f} ${pose}: ${issues.map((i) => `${i.kind} (${i.detail})`).join('; ')}`);
        }
      });
    });
    sheet.save(`${GAL}/${slot}.png`);
    lines.push(`## ${slot}: ${items.map((i) => i.id).join(', ')}`, '');
  }
  writeFileSync(`${GAL}/report.md`, lines.join('\n'));
  console.log(`asset galleries → ${GAL}/`);
}

/* ------------------------------------------------------------------ faces × hair */
// Every eye style against the hairstyles that crowd a face (fringes, side hair, volume), head crops at 5×.
{
  const eyes = [...ITEM_BY_ID.values()].filter((i) => i.slot === 'eyes').map((i) => i.id);
  const hairs = ['hair.short', 'hair.bangs', 'hair.bob', 'hair.messy', 'hair.pixie', 'hair.curly', 'hair.long', 'hair.afro', 'hair.swoop', 'hair.sidepart', 'hair.mullet', 'hair.none'];
  const skins = ['#ffe6d0', '#d99e74', '#9a5f3a', '#4e2a18'];
  const eyeCols = ['#3f7fbf', '#5a3825', '#3f9a6b', '#2a1f2d'];
  const HC = [22, 22, 46, 44]; // head crop (x, y, w, h)
  const z = 5;
  const cw = HC[2] * z + 4;
  const ch = HC[3] * z + 4;
  const sheet = new Sheet(cw * hairs.length, ch * eyes.length, BG);
  eyes.forEach((e, row) =>
    hairs.forEach((h, col) => {
      const look: AvatarLoadout = {
        skin: skins[(row + col) % skins.length],
        eyeColor: eyeCols[col % eyeCols.length],
        eyes: e,
        hair: h,
        hairColor: ['#3b2518', '#d9a35b', '#1f1612', '#b8432e'][col % 4],
        mouth: ['mouth.smile', 'mouth.grin', 'mouth.neutral', 'mouth.smirk', 'mouth.o', 'mouth.tongue'][(row + col) % 6],
        top: 'top.tee',
        topColor: '#3f8fd8',
      };
      sheet.paste(renderAvatarLayers(look, 'se', 'stand').px, col * cw + 2, row * ch + 2, z, HC);
    }),
  );
  sheet.save('art/review/assets/faces.png');
  console.log('faces → art/review/assets/faces.png');
}
