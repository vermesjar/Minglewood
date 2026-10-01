import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {sha256,seatMechanicsDigest,canonical} from '../../../../scripts/lib/seat-verification';
import {FIG,poseDrop} from '../../../shared/world/seatFigure';
import {blank,writePng} from '../../../../scripts/lib/png';
import {SEAT_MOTION_VISUAL_SCOPE as scope,verifySeatMotionVisual} from '../../../../scripts/lib/seat-motion-visual-verification';
function fixture(run:(x:any)=>void){const root=mkdtempSync(join(tmpdir(),'motion-visual-'));try{
const folder=join(root,'motion-visual-review');mkdirSync(folder);const save=(name:string,v:any)=>{const path=join(folder,name);writeFileSync(path,JSON.stringify(v));return {path:name,sha256:sha256(readFileSync(path))};};
const rendererSources=Object.fromEntries(['scripts/lib/seat-motion-candidate.ts','src/shared/world/seatFigure.ts','src/shared/world/seats.ts','src/client/engine/WorldView.ts'].map(p=>[p,sha256(readFileSync(p))]));
const model={compiler:{source:JSON.stringify([0,['se','sw','ne','nw'].map(f=>[f,0,0,'art'])])},size:[1,1],parts:[],sits:[[.5,.5,10]],surfaces:{se:{labels:[1]}}},digest=seatMechanicsDigest(model),contract=save('../contract.json',{key:'test',sits:model.sits,mechanicsDigest:digest,surfaceDigests:{se:sha256(canonical(model.surfaces.se))}}),capture=save('capture.json',['se','sw','ne','nw'].flatMap(facing=>[0,1,2,3].map(reviewLook=>({facing,reviewLook,look:{shirt:reviewLook},art:{w:1,h:1,rgba:[20,30,40,255]}})))),bundle=save('../bundle.json',{captures:[{...capture,path:'motion-visual-review/'+capture.path}],rendererSources}),generator=save('generator.json',{version:1});
const png=blank(1,1,[20,30,40],255);writePng(join(folder,'frame.png'),png);const frame={path:'frame.png',sha256:sha256(readFileSync(join(folder,'frame.png')))},url='data:image/png;base64,'+readFileSync(join(folder,'frame.png')).toString('base64');
const page=blank(8,66,[233,231,237],255);for(let j=0;j<4;j++)for(const scale of [1,2])for(let y=0;y<scale;y++)for(let x=0;x<scale;x++)page.d.set([20,30,40,255],((20+(scale===2?1:0)+y)*8+j*2+x)*4);writePng(join(folder,'page.png'),page);const pageProof={path:'page.png',sha256:sha256(readFileSync(join(folder,'page.png')))};
const contexts:any[]=[],results:any[]=[],expectations:any[]=[];
for(const facing of ['se','sw','ne','nw'])for(let look=0;look<4;look++){
const id=`${facing}-L${look}`,states=[{phase:'entry',onSeat:false},{phase:'entry',onSeat:true},{phase:'seated-0',onSeat:true},{phase:'exit',onSeat:false}].map(s=>({...s,serverSeat:'seat',pose:'sit',facing,legs:{},lift:0,poseRace:false,world:[0,0],at:{x:0,y:0},camera:{x:0,y:0}}));
const expectation=save(id+'-expectation.json',{context:{key:'test',facing,cushion:0,look:{shirt:look},pose:'sit',modelSource:model.compiler.source,figureContext:{feet:[0,0],legs:{},height:(FIG.feet-FIG.hip-poseDrop('sit'))/2,figure:{rgbaSha256:sha256(new Uint8Array([20,30,40,255])),ownerSha256:sha256(new Uint8Array([20]))}}},points:[{x:0,y:0,winner:'avatar'}]});expectations.push({...expectation,path:'motion-visual-review/'+expectation.path});
const film=save(id+'-film.json',{key:'test',facing,reviewLook:look,wornLook:{shirt:look},model,rendererSources,unchanged:true,swappedFields:[],object:{id:'seat',x:0,y:0,z:0},art:{png:url},renderedFrames:4,candidateFile:null,coverage:{entryOutside:true,entryOnSeat:true,exited:true,settledCushions:[true]},frames:states.map(state=>({state,png:url,figure:{width:1,height:1,ax:0,ay:0,rgba:[20,30,40,255],actual:[20,30,40,255],owner:[20]},canvasSize:{width:2,height:2},crop:{x:1,y:1,width:1,height:1},placement:{art:{x:1,y:1,pixelScale:1},figure:{x:1,y:1,pixelScale:1}}}))});
contexts.push({id,film,art:frame,frames:[frame,frame,frame,frame],pages:[{start:0,count:4,image:pageProof}]});results.push({sha256:film.sha256,failures:[],counts:{},settledIndependentExpectations:{wrongWinnerPixels:0,exactReviewedCushions:[0]}});
}
Object.assign(bundle,save('../bundle.json',{captures:[{...capture,path:'motion-visual-review/'+capture.path}],rendererSources,expectations}));
const checker=save('checker.json',{requiredComplete:true,invariantsPassed:true,problems:[],results});
const result=save('result.json',{state:'INVARIANTS_PASSED_VISUAL_PENDING',bindings:{...Object.fromEntries(Object.entries(rendererSources).map(([p,h])=>[resolve(p),h])),[join(folder,'generator.json')]:generator.sha256,[join(root,'bundle.json')]:bundle.sha256,[join(root,'contract.json')]:contract.sha256,...Object.fromEntries(['scripts/seat-motion-check.py','tests/e2e/seat-models.spec.ts','tests/e2e/helpers.ts','scripts/lib/seat-motion-candidate.ts'].map(p=>[resolve(p),sha256(readFileSync(p))]))},artifacts:contexts.map(c=>c.film)});
const m={version:1,kind:'seat-motion-visual-review',scope,key:'test',mechanicsDigest:digest,bundle,contract,result,checker,generator,contexts},manifest=save('manifest.json',m),approvals=contexts.map(c=>({id:c.id,verdict:'pass',reason:'Reviewed every native/enlarged transition state',issues:[],uncertainties:[],risks:[]}));
const reviews=['first','second'].map(reviewer=>save(reviewer+'.json',{reviewer,manifestSha256:manifest.sha256,scope,contexts:approvals}));
const d={version:1,scope,manifestSha256:manifest.sha256,contexts:approvals,provenance:{kind:'independent-agent',reviews}};save('decision.json',d);
run({folder,save,m,d,load:(p:any)=>JSON.parse(readFileSync(join(folder,p.path),'utf8')),check:()=>verifySeatMotionVisual(join(root,'bundle.json'),join(root,'contract.json'))});
}finally{rmSync(root,{recursive:true,force:true});}}
function addReplay(f:any){
 mkdirSync(join(f.folder,'original'));
 const result=f.load(f.m.result),artifacts=f.m.contexts.map((c:any)=>{
   const p={path:c.film.path,sha256:c.film.sha256};
   writeFileSync(join(f.folder,'original',p.path),readFileSync(join(f.folder,p.path)));return p;
 });
 const original=f.save('original/result.json',{bindings:result.bindings,artifacts});
 result.postprocessing={recordingResult:original,recordingBindings:result.bindings,originalFilms:artifacts.map((p:any)=>({...p,path:'original/'+p.path}))};
 f.m.result=f.save(f.m.result.path,result);return result;
}
function rebind(f:any,result:any){
 f.m.result=f.save(f.m.result.path,result);f.d.manifestSha256=f.save('manifest.json',f.m).sha256;
 f.d.provenance.reviews=f.d.provenance.reviews.map((p:any)=>{const r=f.load(p);r.manifestSha256=f.d.manifestSha256;return f.save(p.path,r);});f.save('decision.json',f.d);
}
describe('whole-motion visual publication evidence',()=>{
it('accepts exact16 films, every frame, native/enlarged pages and two independent reviews',()=>fixture(f=>expect(f.check()).toEqual([])));
it('accepts unchanged replay films bound to their original recording receipt',()=>fixture(f=>{rebind(f,addReplay(f));expect(f.check()).toEqual([]);}));
it('rejects refreshed replay receipts that replace an originally recorded film',()=>fixture(f=>{
 const result=addReplay(f),c=f.m.contexts[0],old=c.film.sha256,film=f.load(c.film);
 film.renderedFrames+=1;c.film=f.save(c.film.path,film);
 result.artifacts=result.artifacts.map((p:any)=>p.sha256===old?c.film:p);
 const checker=f.load(f.m.checker);checker.results.find((r:any)=>r.sha256===old).sha256=c.film.sha256;f.m.checker=f.save(f.m.checker.path,checker);
 rebind(f,result);expect(f.check().join()).toContain('Rechecked motion films differ from original recording');
}));
it('rejects original-film proofs that do not match the preserved recording receipt',()=>fixture(f=>{
 const result=addReplay(f);result.postprocessing.originalFilms.pop();rebind(f,result);
 expect(f.check().join()).toContain('Original motion film proofs differ from recording receipt');
}));
it('rejects omitted changed state despite exact film proofs',()=>fixture(f=>{f.m.contexts[0].frames.pop();f.d.manifestSha256=f.save('manifest.json',f.m).sha256;f.save('decision.json',f.d);expect(f.check().join()).toContain('frames omitted');}));
it('rejects omitted native/enlarged review page',()=>fixture(f=>{f.m.contexts[0].pages=[];f.d.manifestSha256=f.save('manifest.json',f.m).sha256;f.save('decision.json',f.d);expect(f.check().join()).toContain('pages omit');}));
it('never treats numeric pass as visual approval',()=>fixture(f=>{f.d.provenance.reviews.pop();f.save('decision.json',f.d);expect(f.check().join()).toContain('Two independent');}));
it('rejects forged zero counts when the raw settled frame hides an expected visible pixel',()=>fixture(f=>{
 const c=f.m.contexts[0],old=c.film.sha256,film=f.load(c.film);film.frames[2].figure.actual[3]=0;c.film=f.save(c.film.path,film);
 const checker=f.load(f.m.checker);checker.results.find((r:any)=>r.sha256===old).sha256=c.film.sha256;f.m.checker=f.save(f.m.checker.path,checker);
 const result=f.load(f.m.result);result.artifacts=result.artifacts.map((p:any)=>p.sha256===old?c.film:p);f.m.result=f.save(f.m.result.path,result);f.d.manifestSha256=f.save('manifest.json',f.m).sha256;f.save('decision.json',f.d);
 f.d.provenance.reviews=f.d.provenance.reviews.map((p:any)=>{const r=f.load(p);r.manifestSha256=f.d.manifestSha256;return f.save(p.path,r);});f.save('decision.json',f.d);
 expect(f.check().join()).toContain('Independent motion recomputation rejected raw evidence');
}));
it('rejects changed surface ownership even when mechanics and refreshed film receipts agree',()=>fixture(f=>{
  const c=f.m.contexts[0],old=c.film.sha256,film=f.load(c.film);
  film.model.surfaces.se.labels[0]=2;
  c.film=f.save(c.film.path,film);
  const checker=f.load(f.m.checker);checker.results.find((r:any)=>r.sha256===old).sha256=c.film.sha256;
  f.m.checker=f.save(f.m.checker.path,checker);
  const result=f.load(f.m.result);result.artifacts=result.artifacts.map((p:any)=>p.sha256===old?c.film:p);
  f.m.result=f.save(f.m.result.path,result);
  f.d.manifestSha256=f.save('manifest.json',f.m).sha256;f.save('decision.json',f.d);
  expect(f.check().join()).toContain('motion surface labels differ');
}));
});
