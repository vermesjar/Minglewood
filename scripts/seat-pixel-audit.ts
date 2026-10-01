/** All source pixels from actual WorldView snapshots. Capturing is never visual approval.
 * --candidate DIR swaps staged entries/art only inside this browser; live artwork is untouched.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { SEAT_LOOKS } from '../src/shared/world/seatModels';
import { loadManifest } from './lib/manifest';
import { rendererSources } from './lib/seat-source-receipt';
const arg = (n: string) => { const i=process.argv.indexOf(`--${n}`); return i<0 ? undefined : process.argv[i+1]; };
const out=arg('out') ?? 'art/review/pixel-catalog';
const manifest=loadManifest(), candidate=arg('candidate');
const entries=candidate ? JSON.parse(readFileSync(`${candidate}/entries.json`,'utf8')) : {};
const modelFile=arg('models')??(candidate?`${candidate}/compiled/models.json`:undefined);
const models=modelFile ? JSON.parse(readFileSync(modelFile,'utf8')) : {};
const keys=arg('keys')?.split(',') ?? (candidate ? Object.keys(entries) : Object.keys(manifest.sprites).filter(k=>manifest.sprites[k].walk==='seat').sort());
mkdirSync(out,{recursive:true});
const sourceReceipt=rendererSources(),started=new Date().toISOString(),captureFiles:Record<string,string>={};
const browser=await chromium.launch(), page=await browser.newPage({viewport:{width:1200,height:900}});
const errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
if(candidate||modelFile) {
  for(const key of keys) manifest.sprites[key]={...(candidate?entries[key]:manifest.sprites[key]),seatModel:models[key]};
  await page.route('**/art/manifest.json',r=>r.fulfill({json:manifest}));
}
if(candidate) {
  for(const entry of Object.values(entries) as Array<{facings:Record<string,{file:string}>}>)
    for(const view of Object.values(entry.facings)) await page.route(`**/art/sprites/${view.file}?*`,r=>r.fulfill({path:resolve(candidate,'sprites',view.file),contentType:'image/png'}));
}
try {
  await page.goto(`${arg('url')??'http://localhost:5195'}/lab.html`);
  await page.waitForFunction(()=>document.title.includes('ready'));
  // Await the art promise once; rendering the entire catalog before every
  // outfit is unrelated work and made full per-pixel capture unnecessarily slow.
  await page.evaluate(async()=>{await (window as any).lab.reloadArt();});
  const looks=[...SEAT_LOOKS,JSON.parse(readFileSync('tests/fixtures/seating-cardigan.json','utf8'))];
  for(const key of keys) {
    const records:unknown[]=[];
    const size=manifest.sprites[key].footprint;
    for(let l=0;l<looks.length;l++) {
      const captured=await page.evaluate(async ({key,look,size,root,facings})=>{
        const {seatEvidence}=await import(`/@fs/${root}/src/client/lab/seatEvidence.ts`);
        // Include the complete original figure canvases, not just their opaque silhouette. The old
        // thumbnail viewport clipped rear-view sprite padding and could not prove complete coverage.
        const span=size[0]+size[1];
        return seatEvidence({key:`${key}~${size[0]}x${size[1]}`,looks:[look],ids:Array.from({length:40},(_,i)=>`pixel-${i}`),
          zoom:4,size:[Math.max(512,256+64*span),Math.max(512,384+32*span)],facings});
      },{key,look:looks[l],size,root:process.cwd().replace(/\\/g,'/'),facings:arg('facings')?.split(',') as any});
      records.push(...captured.map((r:any)=>({...r,reviewLook:l})));
    }
    const serialized=JSON.stringify(records);
    writeFileSync(`${out}/${key}.json`,serialized);
    captureFiles[`${key}.json`]=createHash('sha256').update(serialized).digest('hex');
    console.log(`${key}: ${records.length} actual sitters, all UNREVIEWED`);
  }
  if(errors.length) throw new Error(errors.join('\n'));
  const unchanged=JSON.stringify(sourceReceipt)===JSON.stringify(rendererSources());
  writeFileSync(`${out}/capture-receipt.json`,JSON.stringify({version:1,started,finished:new Date().toISOString(),
    rendererSources:sourceReceipt,captures:captureFiles,keys,unchanged},null,2));
  if(!unchanged)throw new Error('Renderer source changed during capture. Evidence is research-only; recapture before verification.');
} finally { await browser.close(); }
