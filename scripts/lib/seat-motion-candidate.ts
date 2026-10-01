/** Browser-local staged furniture transport for real-click motion review. No catalog writes. */
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function motionCandidate(directory=process.env.SEAT_CANDIDATE_DIR,modelFile=process.env.SEAT_CANDIDATE_MODELS) {
  if(!directory&&!modelFile)return null;
  const modelsPath=resolve(modelFile??resolve(directory!,'compiled/models.json'));
  const modelBytes=readFileSync(modelsPath),models=JSON.parse(modelBytes.toString('utf8'));
  const entriesPath=directory?resolve(directory,'entries.json'):undefined,entryBytes=entriesPath?readFileSync(entriesPath):undefined;
  const entries=entryBytes?JSON.parse(entryBytes.toString('utf8')):{};
  const files:Record<string,{path:string;sha256:string}>={};
  for(const [key,entry] of Object.entries(entries) as Array<[string,any]>) {
    if(!/^[a-z][\w-]*(\.[\w-]+)?$/.test(key))throw Error('Draft seat key cannot be represented by a review room.');
    const model=models[key];if(!model)throw Error(`Staged seat ${key} lacks a compiled model.`);
    const size=model.size;if(!Array.isArray(size)||size.length!==2||size.some((n:any)=>!Number.isInteger(n)||n<1||n>4))throw Error('Motion review currently supports footprints from 1×1 to 4×4; larger review-room spacing is required.');
    if(JSON.stringify(size)!==JSON.stringify(entry.footprint))throw Error('Staged seat footprint differs from its model.');
    for(const view of Object.values(entry.facings) as any[]) {
      const base=resolve(directory!,'sprites'),path=resolve(base,view.file),rel=relative(base,path);
      if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('Staged sprite path leaves its candidate directory.');
      files[view.file]={path,sha256:digest(readFileSync(path))};
    }
  }
  const receipt={models:{path:modelsPath,sha256:digest(modelBytes)},entries:entriesPath&&entryBytes?{path:entriesPath,sha256:digest(entryBytes)}:null,sprites:files};
  return {models,entries,receipt};
}
export function motionRoom(key:string,candidate:ReturnType<typeof motionCandidate>,run?:string) {
  const size=candidate?.models[key]?.size;
  if(run&&!/^[a-zA-Z0-9_-]+$/.test(run))throw Error('Motion room run must be a simple label.');
  // seatLabScene reads key/size from the first two fields; the final field
  // isolates server occupancy for simultaneous draft reviews of the same key.
  return `seatlab-${key}${size?`~${size[0]}x${size[1]}${run?`~${run}`:''}`:''}`;
}
export async function routeMotionCandidate(page:Page,candidate:NonNullable<ReturnType<typeof motionCandidate>>) {
  await page.route('**/art/manifest.json',async route=>{
    const response=await route.fetch(),manifest=await response.json();
    for(const [key,model] of Object.entries(candidate.models)) {
      const entry=candidate.entries[key]??manifest.sprites[key];
      if(!entry)throw Error(`Candidate seat ${key} needs a staged entry and artwork.`);
      manifest.sprites[key]={...entry,seatModel:model};
    }
    await route.fulfill({response,json:manifest});
  });
  if(Object.keys(candidate.receipt.sprites).length)await page.route('**/art/sprites/**',async route=>{
    const pathname=decodeURIComponent(new URL(route.request().url()).pathname),file=pathname.slice(pathname.indexOf('/art/sprites/')+'/art/sprites/'.length),source=candidate.receipt.sprites[file];
    if(!source){await route.fallback();return;}
    const bytes=readFileSync(source.path);if(digest(bytes)!==source.sha256)throw Error('Staged sprite changed during motion review.');
    await route.fulfill({body:bytes,contentType:'image/png'});
  });
}
