import { readdirSync } from 'node:fs';
import { readPng, writePng, blank } from './lib/png';
const [dir, out, colsArg] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const imgs = files.map((f) => readPng(`${dir}/${f}`));
const cols = Number(colsArg ?? 8);
const w = imgs[0].w, h = imgs[0].h;
const rows = Math.ceil(imgs.length / cols);
const o = blank(cols * w, rows * h, [27, 22, 35], 255);
imgs.forEach((im, i) => {
  const ox = (i % cols) * w, oy = Math.floor(i / cols) * h;
  for (let y = 0; y < Math.min(h, im.h); y++) for (let x = 0; x < Math.min(w, im.w); x++) o.d.set(im.d.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 4), ((oy + y) * o.w + ox + x) * 4);
});
writePng(out, o);
console.log(out, files.length, 'frames');
