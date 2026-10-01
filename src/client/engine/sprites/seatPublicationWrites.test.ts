import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireDiagnosticModelPath, withModels } from '../../../../scripts/lib/models';
import type { SeatModel } from '@shared/world/seatModels';

const model=():SeatModel=>({size:[1,1],parts:[{part:'seat',u:[0,1],v:[0,1],z:[0,10]}],sits:[[.5,.5,10]],drawings:{se:'12345678'}});
function fixture(run:(path:string)=>void){const dir=mkdtempSync(join(tmpdir(),'seat-write-gate-')),path=join(dir,'models.json');
 try{writeFileSync(path,JSON.stringify({seat:model()}));run(path);}finally{rmSync(dir,{recursive:true,force:true});}}

describe('all model writes share the publication gate',()=>{
 it('prevents diagnostic outputs from replacing catalog or public files through case or traversal',()=>{
   for(const path of ['ART/SEAT-MODELS.JSON','art/review/../seat-models.json','PUBLIC/art/manifest.json','public'])
     expect(()=>requireDiagnosticModelPath(path)).toThrow(/Diagnostic output/);
   expect(()=>requireDiagnosticModelPath('art/review/models.json')).not.toThrow();
 });
 it('rejects a changed legacy model atomically even for a direct helper caller',()=>fixture(path=>{
   const before=readFileSync(path,'utf8');
   expect(()=>withModels(ms=>{ms.seat.sits[0][1]=.3;},path)).toThrow(/independent evidence/);
   expect(readFileSync(path,'utf8')).toBe(before);
 }));
 it('rejects per-view sit and traced occlusion changes instead of calling them metadata',()=>fixture(path=>{
   expect(()=>withModels(ms=>{ms.seat.views={ne:[[.1,.1]]};},path)).toThrow(/independent evidence/);
   expect(()=>withModels(ms=>{ms.seat.over={ne:[[[0,0],[1,0],[1,1]]]};},path)).toThrow(/independent evidence/);
 }));
 it('rejects unknown geometry before lossy serialization can conceal a legacy change',()=>fixture(path=>{
   const before=readFileSync(path,'utf8');
   for(const field of ['authoredGeometry','futurePhysicalExtension']) {
     expect(()=>withModels(ms=>{(ms.seat as unknown as Record<string,unknown>)[field]={depth:[1.25]};},path)).toThrow(/serialization would discard/);
     expect(readFileSync(path,'utf8')).toBe(before);
   }
   expect(()=>withModels(ms=>{(ms.seat.parts[0] as unknown as Record<string,unknown>).depthProfile={depth:[1.25]};},path)).toThrow(/serialization would discard/);
   expect(readFileSync(path,'utf8')).toBe(before);
 }));
 it('keeps an unchanged legacy identity while updating a descriptive note',()=>fixture(path=>{
   withModels(ms=>{ms.seat.note='Documented existing geometry';},path);
   expect(JSON.parse(readFileSync(path,'utf8')).seat.note).toBe('Documented existing geometry');
 }));
 it('does not allow deleting a model or adding an unverified generated seat',()=>fixture(path=>{
   expect(()=>withModels(ms=>{delete ms.seat;},path)).toThrow(/removal/);
   expect(()=>withModels(ms=>{ms.newseat=model();},path)).toThrow(/independent evidence/);
 }));
});
