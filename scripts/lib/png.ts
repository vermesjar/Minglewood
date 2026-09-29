/** Minimal PNG in/out for the review scripts (8-bit RGBA / RGB / grey / palette in, RGBA out). */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

export interface Img {
  w: number;
  h: number;
  /** RGBA */
  d: Uint8Array;
}

export function readPng(path: string): Img {
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

export function writePng(path: string, img: Img) {
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(img.w, 0);
  ih.writeUInt32BE(img.h, 4);
  ih[8] = 8;
  ih[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) Buffer.from(img.d.buffer, img.d.byteOffset + y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

export function mirrorImg(m: Img): Img {
  const d = new Uint8Array(m.d.length);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) d.set(m.d.subarray((y * m.w + x) * 4, (y * m.w + x) * 4 + 4), (y * m.w + (m.w - 1 - x)) * 4);
  return { w: m.w, h: m.h, d };
}

export function blank(w: number, h: number, rgb: [number, number, number] = [0, 0, 0], a = 0): Img {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([rgb[0], rgb[1], rgb[2], a], i * 4);
  return { w, h, d };
}
