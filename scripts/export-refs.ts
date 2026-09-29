/**
 * Export the template figures the part generator (art/charkit.py) draws on: 8× and 1× PNGs of the bare
 * standard figure, straight from the kit.
 *
 *   npx tsx scripts/export-refs.ts
 *
 * art/review/ref-face-<view>.png   bald, faceless head (face art is drawn on it)
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { AvatarLoadout } from '@shared/domain/types';
import { drawAvatarV2 } from '../src/client/engine/sprites/avatarKit';

const W = 88;
const H = 112;
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
function png(w: number, h: number, rgba: Uint8ClampedArray) {
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function scaled(d: Uint8ClampedArray, z: number) {
  const out = new Uint8ClampedArray(W * z * H * z * 4);
  for (let y = 0; y < H * z; y++)
    for (let x = 0; x < W * z; x++) {
      const s = (((y / z) | 0) * W + ((x / z) | 0)) * 4;
      out.set(d.subarray(s, s + 4), (y * W * z + x) * 4);
    }
  return out;
}
const blank: AvatarLoadout = {
  skin: '#d99e74',
  hair: 'hair.none',
  eyes: 'eyes.blank',
  brows: 'brows.none',
  top: 'top.tank',
  topColor: '#f4efe6',
  bottom: 'bottom.shorts',
  bottomColor: '#8a8f99',
  shoes: 'shoes.sneakers',
  shoesColor: '#3a3a46',
};
for (const view of ['front', 'back'] as const) {
  const P = drawAvatarV2(blank, view, 'stand');
  writeFileSync(`art/review/ref-face-${view}.png`, png(W * 8, H * 8, scaled(P.d, 8)));
  writeFileSync(`art/review/ref-face-${view}-1x.png`, png(W, H, P.d));
}
console.log('refs → art/review/ref-face-*.png');
