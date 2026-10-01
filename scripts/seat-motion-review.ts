/** Compact the existing live-test film strips, retaining every captured frame. */
import { existsSync, mkdirSync } from 'node:fs';
import { MODEL_FACINGS } from '../src/shared/world/seatModels';
import { loadManifest } from './lib/manifest';
import { viewArt, seatKeys, type Sprites } from './lib/seats';
import { readPng, writePng, blank } from './lib/png';
import { row, stack } from './lib/draw';
import { text } from './lib/font';

const M = loadManifest().sprites as unknown as Sprites;
const out = 'art/review/seating-motion';
mkdirSync(out, {recursive:true});
for (const key of seatKeys(M)) {
  const blocks = [];
  for (const facing of MODEL_FACINGS) {
    const path = `art/review/models-live/${key}-${facing}.png`;
    if (!existsSync(path)) continue;
    const src = readPng(path);
    const {px} = viewArt(M, key, facing).art;
    const fw = px.w + 112, fh = px.h + 140;
    const count = src.w / (fw + 4);
    if (!Number.isInteger(count)) { console.log(`skip unexpected film layout ${key}/${facing}: ${src.w}, frame ${fw}`); continue; }
    const frames = [];
    for(let i=0;i<count;i++) {
      const img = blank(fw-56, fh-60, [24,20,30],255);
      for(let y=0;y<img.h;y++) for(let x=0;x<img.w;x++) {
        const from = ((src.h - 6 - fh + 60 + y)*src.w+i*(fw+4)+28+x)*4;
        img.d.set(src.d.subarray(from,from+4),(y*img.w+x)*4);
      }
      frames.push(img);
    }
    const title = blank(800,18,[24,20,30],255);
    text(title,3,3,`${key} ${facing}: ${count} frames`,[240,220,180],2);
    blocks.push(title);
    for(let i=0;i<frames.length;i+=6) blocks.push(row(frames.slice(i,i+6),[24,20,30],4));
  }
  if(blocks.length) writePng(`${out}/${key}.png`,stack(blocks,[24,20,30],4));
}
