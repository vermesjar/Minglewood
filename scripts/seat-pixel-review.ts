/** Build a portable, source-pixel inspector from real in-game evidence. Never auto-approves captures. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { blank, writePng } from './lib/png';
import { paste, row, scaled } from './lib/draw';
const dir = process.argv[2] ?? 'art/review/playtest/pixel-review/pixels';
const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('expected'));
const template = readFileSync('scripts/seat-pixel-review.html', 'utf8');
let index=0;
const pages:Array<{file:string;count:number;html:string}>=[];
// Keep one asset in memory at a time. Full-catalog final-canvas evidence is
// hundreds of MB; a single giant HTML file is not a usable review process.
for(const file of files) {
const records=JSON.parse(readFileSync(`${dir}/${file}`,'utf8'));
if(!Array.isArray(records)||!records.length)continue;
for (const r of records) {
  const pad=48, f=r.figure, w=r.art.w+pad*2,h=r.art.h+pad*2;
  const source=blank(w,h,[35,31,40],255), composed=blank(w,h,[35,31,40],255), owners=blank(w,h,[35,31,40],255);
  paste(source,{w:r.art.w,h:r.art.h,d:new Uint8Array(r.art.rgba)},pad,pad);
  paste(composed,source,0,0);
  paste(composed,{w:f.w,h:f.h,d:new Uint8Array(f.actual)},pad+Math.round(r.feet[0])-f.ax,pad+Math.round(r.feet[1])-f.ay);
  const colors:Record<string,number[]>={seat:[220,65,225],back:[240,140,55],arm:[65,225,120],base:[60,160,240],leg:[110,110,240],wrap:[190,130,240]};
  for(let y=0;y<r.art.h;y++)for(let x=0;x<r.art.w;x++){const i=y*r.art.w+x,k=r.depth.part[i];if(k>=0&&r.art.rgba[i*4+3])owners.d.set([...(colors[r.model.parts[k].part]??[255,255,255]),255],((y+pad)*w+x+pad)*4);}
  writePng(`${dir}/case-${index}.png`,row([scaled(source,3),scaled(composed,3),scaled(owners,3)]));
  if(r.finalCanvas) {
    const c=r.finalCanvas;
    const actual={w:c.rect.width,h:c.rect.height,d:new Uint8Array(c.actual)};
    const expected={w:c.rect.width,h:c.rect.height,d:new Uint8Array(c.expected)};
    writePng(`${dir}/canvas-${index}.png`,row([actual,expected]));
  }
  index++;
}
const html=`review-${file.slice(0,-5)}.html`;
writeFileSync(`${dir}/${html}`, template.replace('/*CAPTURES*/[]', JSON.stringify(records).replace(/</g, '\\u003c')));
pages.push({file,count:records.length,html});
}
if(!index)throw new Error('No game captures; run the seat-pixels Playwright test first.');
writeFileSync(`${dir}/index.html`, `<!doctype html><meta charset="utf-8"><title>Seat pixel review</title><style>body{background:#19171e;color:#eee;font:16px system-ui;margin:40px}a{color:#8bd6c4}li{margin:14px}</style><h1>Seat pixel review</h1><p>${index} captured sitters. Captures are not approval; each page exposes source pixels, overlap ownership and final-canvas verification.</p><ul>${pages.map(p=>`<li><a href="${encodeURI(p.html)}">${p.file.replace(/[<>&]/g,'')} (${p.count} cases)</a></li>`).join('')}</ul>`);
console.log(`${index} captured sitters in ${pages.length} review pages; visual approval pending. ${dir}/index.html`);
