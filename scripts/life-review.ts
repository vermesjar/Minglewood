/**
 * Film strips of character life, out of the game: every animation (walk cycle, emote gestures, dance, idle
 * moments) frame by frame at zoom 3, front (se) and back (ne), on a few contrasting looks.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/life-review.ts
 *
 * Output: art/review/life-<animation>.png and art/review/life-all.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { AvatarLoadout } from '@shared/domain/types';
import type { Facing } from '@shared/world/scene';
import type { Pose } from '../src/client/engine/sprites/avatarFrame';
import { renderAvatarLayers } from '../src/client/engine/sprites/avatarQa';

const W = 88;
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

const ANIMS: Record<string, Pose[]> = {
  walk: ['walk1', 'pass1', 'walk2', 'pass2'],
  clap: ['clap1', 'clap2', 'clap1', 'clap2'],
  cheer: ['cheer1', 'cheer2'],
  thumbs: ['thumbs'],
  laugh: ['laugh1', 'laugh2'],
  heart: ['heart'],
  idea: ['idea'],
  dance: ['dance1', 'dance2', 'dance3', 'dance4'],
  idle: ['stand', 'shift', 'phone'],
};
const LOOKS: AvatarLoadout[] = [
  { hair: 'hair.bob', hairColor: '#3b2518', skin: '#eab58d', top: 'top.hoodie', topColor: '#e0703a', bottom: 'bottom.jeans', bottomColor: '#3b5b8a' },
  { hair: 'hair.afro', hairColor: '#1f1612', skin: '#643721', top: 'top.shirt', topColor: '#f4efe6', bottom: 'bottom.chinos', bottomColor: '#3a3a46', body: 'body.b' },
  { hair: 'hair.long', hairColor: '#d9a35b', skin: '#ffdcbf', top: 'top.dress', topColor: '#9b6bd6', headwear: 'hat.beanie', headwearColor: '#2bb3a3' },
] as AvatarLoadout[];
const FACES: Facing[] = ['se', 'ne'];
const Z = 3;
const CROP = [10, 8, 70, 100];
const cw = CROP[2] * Z + 6;
const ch = CROP[3] * Z + 6;
const BG = [232, 220, 198];

function sheet(poses: Pose[]) {
  const cols = poses.length * FACES.length;
  const OW = cw * cols;
  const OH = ch * LOOKS.length;
  const out = new Uint8Array(OW * OH * 4);
  for (let i = 0; i < out.length; i += 4) out.set([BG[0], BG[1], BG[2], 255], i);
  LOOKS.forEach((look, row) =>
    FACES.forEach((f, fi) =>
      poses.forEach((p, pi) => {
        const col = fi * poses.length + pi;
        const px = renderAvatarLayers(look, f, p).px;
        for (let y = 0; y < CROP[3]; y++)
          for (let x = 0; x < CROP[2]; x++) {
            const s = ((CROP[1] + y) * W + CROP[0] + x) * 4;
            if (!px[s + 3]) continue;
            for (let yy = 0; yy < Z; yy++)
              for (let xx = 0; xx < Z; xx++) out.set([px[s], px[s + 1], px[s + 2], 255], ((row * ch + 3 + y * Z + yy) * OW + col * cw + 3 + x * Z + xx) * 4);
          }
        // a thin divider between the front and back strips
        if (fi === 1 && pi === 0) for (let y = row * ch; y < (row + 1) * ch; y++) out.set([120, 100, 90, 255], (y * OW + col * cw) * 4);
      }),
    ),
  );
  return { w: OW, h: OH, d: out };
}

mkdirSync('art/review', { recursive: true });
for (const [name, poses] of Object.entries(ANIMS)) {
  const s = sheet(poses);
  writeFileSync(`art/review/life-${name}.png`, png(s.w, s.h, s.d));
}
console.log(`life strips → art/review/life-{${Object.keys(ANIMS).join(',')}}.png`);
