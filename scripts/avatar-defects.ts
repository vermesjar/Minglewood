/**
 * Defect close-ups: renders chosen frames at 8× with the checker's findings marked (holes magenta), so a
 * failure can be seen, not just counted.
 *
 *   npx tsx scripts/avatar-defects.ts "<name>:<facing>:<pose>" ...
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildSeed } from '@shared/seed/northstar';
import { randomLoadout } from '@shared/avatar';
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import type { Pose } from '../src/client/engine/sprites/avatarFrame';
import { renderAvatarLayers } from '../src/client/engine/sprites/avatarQa';

const W = 88;
const H = 112;
const Z = 8;
const crcT = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (t: string, d: Buffer) => {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
};
function png(w: number, h: number, rgba: Uint8Array) {
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const looks = new Map<string, AvatarLoadout>();
for (const m of buildSeed().members) looks.set(m.displayName.split(' ')[0].toLowerCase(), m.avatar);
if (existsSync('.data/minglewood.json')) {
  const d = JSON.parse(readFileSync('.data/minglewood.json', 'utf8'));
  for (const org of Object.values(d) as Array<{ members?: Array<{ displayName: string; avatar: AvatarLoadout }> }>)
    for (const m of org?.members ?? []) looks.set(m.displayName.toLowerCase(), m.avatar);
}
for (let k = 0; k < 200; k++) looks.set(`random${String(k).padStart(2, "0")}`, randomLoadout(`qa-${k}`));

const specs = process.argv.slice(2);
const cells = specs.map((s) => {
  const [name, facing, pose] = s.split(':');
  const look = looks.get(name.toLowerCase());
  if (!look) throw new Error(`no look ${name}`);
  return renderAvatarLayers(look, facing as Facing, pose as Pose);
});
const cw = 60 * Z;
const ch = 70 * Z;
const out = new Uint8Array(cw * cells.length * ch * 4);
const OW = cw * cells.length;
for (let i = 0; i < out.length; i += 4) out.set([232, 220, 198, 255], i);
cells.forEach((r, n) => {
  // enclosed see-through pixels
  const solid = (i: number) => r.px[i * 4 + 3] > 0;
  const outside = new Uint8Array(W * H);
  const st: number[] = [];
  for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) {
    const i = st.pop()!;
    if (outside[i] || solid(i)) continue;
    outside[i] = 1;
    const x = i % W;
    if (x > 0) st.push(i - 1);
    if (x < W - 1) st.push(i + 1);
    if (i >= W) st.push(i - W);
    if (i < W * (H - 1)) st.push(i + W);
  }
  for (let y = 0; y < 70; y++)
    for (let x = 0; x < 60; x++) {
      const sx = x + 14;
      const sy = y + 14;
      const i = sy * W + sx;
      let c: number[] | null = null;
      if (solid(i)) c = [r.px[i * 4], r.px[i * 4 + 1], r.px[i * 4 + 2]];
      else if (!outside[i]) c = [255, 0, 220];
      if (!c) continue;
      for (let yy = 0; yy < Z; yy++)
        for (let xx = 0; xx < Z; xx++) {
          const d = ((y * Z + yy) * OW + n * cw + x * Z + xx) * 4;
          out[d] = c[0];
          out[d + 1] = c[1];
          out[d + 2] = c[2];
        }
    }
});
writeFileSync('art/review/defects.png', png(OW, ch, out));
console.log('art/review/defects.png');
