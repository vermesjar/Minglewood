import {readFileSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {canonical,sha256,seatMechanicsDigest} from './seat-verification';
import {readPng} from './png';
import {recomputeMotionInvariants} from './seat-motion-recompute';
export const SEAT_MOTION_VISUAL_SCOPE='Every recorded changed state in all four facings and four outfits: approach, contact, every cushion change and exit; body continuity, believable movement, comfortable seat depth, support contact and arm/back ordering. Numerical exterior and settled checks do not approve transition appearance.';
export function verifySeatMotionVisual(bundlePath:string,contractPath:string,folder=resolve(dirname(bundlePath),'motion-visual-review')):string[]{
  try{
    const bytes=readFileSync(resolve(folder,'manifest.json')),m=JSON.parse(bytes.toString()),identity=sha256(bytes),d=JSON.parse(readFileSync(resolve(folder,'decision.json'),'utf8'));
    const file=(p:any)=>{const path=resolve(folder,p.path),bytes=readFileSync(path);if(sha256(bytes)!==p.sha256)throw Error(`Motion evidence changed: ${p.path}`);return {path,bytes};};
    const json=(p:any)=>JSON.parse(file(p).bytes.toString());
    if(m.version!==1||m.kind!=='seat-motion-visual-review'||m.scope!==SEAT_MOTION_VISUAL_SCOPE||d.version!==1||d.scope!==m.scope||d.manifestSha256!==identity)throw Error('Motion visual scope or manifest binding is stale.');
    if(m.bundle.sha256!==sha256(readFileSync(bundlePath))||m.contract.sha256!==sha256(readFileSync(contractPath)))throw Error('Motion review belongs to different settled evidence.');
    const bundle=json(m.bundle),contract=json(m.contract),result=json(m.result),checker=json(m.checker);file(m.generator);
    if(m.key!==contract.key||m.mechanicsDigest!==contract.mechanicsDigest)throw Error('Motion model binding differs.');
    if(result.state!=='INVARIANTS_PASSED_VISUAL_PENDING'||!Object.keys(result.bindings??{}).length)throw Error('Motion invariants have not completed.');
    const boundHashes=new Set(Object.values(result.bindings));
    if(!boundHashes.has(m.bundle.sha256)||!boundHashes.has(m.contract.sha256))throw Error('Motion recording did not bind this exact settled bundle and contract.');
    for(const name of ['scripts/seat-motion-check.py','tests/e2e/seat-models.spec.ts','tests/e2e/helpers.ts','scripts/lib/seat-motion-candidate.ts'])if(!boundHashes.has(sha256(readFileSync(resolve(name)))))throw Error(`Motion recorder/checker source binding missing: ${name}`);
    if(!Object.keys(bundle.rendererSources??{}).length)throw Error('Motion renderer inventory missing.');
    for(const [name,hash]of Object.entries(bundle.rendererSources)){if(sha256(readFileSync(resolve(name)))!==hash||!boundHashes.has(hash))throw Error('Motion renderer inventory is stale or unbound.');}
    for(const [path,hash]of Object.entries(result.bindings))if(sha256(readFileSync(path))!==hash)throw Error('Motion input bytes changed.');
    for(const p of result.artifacts??[])if(sha256(readFileSync(resolve(dirname(file(m.result).path),p.path)))!==p.sha256)throw Error('Recorded motion artifact changed.');
    if(result.postprocessing){
      const post=result.postprocessing,resultDir=dirname(file(m.result).path);
      const recordedPath=resolve(resultDir,post.recordingResult.path),recordedBytes=readFileSync(recordedPath);
      if(sha256(recordedBytes)!==post.recordingResult.sha256)throw Error('Original motion recording receipt changed.');
      const recorded=JSON.parse(recordedBytes.toString());
      if(canonical(recorded.bindings)!==canonical(post.recordingBindings))throw Error('Original motion recording bindings differ.');
      const isFilm=(p:any)=>/-film\.(json|png)$/.test(p.path);
      const proofs=(rows:any[],base:string)=>{
        const entries=rows.map(p=>[resolve(base,p.path),p.sha256]);
        if(!entries.length||new Set(entries.map(p=>p[0])).size!==entries.length)throw Error('Original motion film coverage is missing or duplicated.');
        for(const [path,hash]of entries)if(sha256(readFileSync(path))!==hash)throw Error('Original motion film bytes changed.');
        return Object.fromEntries(entries);
      };
      const original=proofs((recorded.artifacts??[]).filter(isFilm),dirname(recordedPath));
      if(canonical(original)!==canonical(proofs(post.originalFilms??[],resultDir)))throw Error('Original motion film proofs differ from recording receipt.');
      const names=(rows:Record<string,string>)=>{
        const entries=Object.entries(rows).map(([path,hash])=>[basename(path),hash]);
        if(new Set(entries.map(p=>p[0])).size!==entries.length)throw Error('Motion replay film names are duplicated.');
        return Object.fromEntries(entries);
      };
      const replay=proofs((result.artifacts??[]).filter(isFilm),resultDir);
      if(canonical(names(original))!==canonical(names(replay)))throw Error('Rechecked motion films differ from original recording.');
      const reviewed=Object.fromEntries(m.contexts.map((c:any)=>[file(c.film).path,c.film.sha256]));
      if(canonical(reviewed)!==canonical(Object.fromEntries(Object.entries(replay).filter(([path])=>path.endsWith('-film.json')))))throw Error('Reviewed motion films differ from rechecked recording.');
    }
    if(!checker.requiredComplete||!checker.invariantsPassed||checker.problems?.length)throw Error('Complete motion invariant checker did not pass.');
    const required=new Set(['se','sw','ne','nw'].flatMap(f=>[0,1,2,3].map(l=>`${f}-L${l}`))),exact=(rows:any[])=>rows.length===16&&new Set(rows.map(c=>c.id)).size===16&&rows.every(c=>required.has(c.id));
    if(!exact(m.contexts)||!exact(d.contexts))throw Error('Motion visual coverage must include all16 exact films.');
    const settledRecords=bundle.captures.flatMap((p:any)=>{const bytes=readFileSync(resolve(dirname(bundlePath),p.path));if(sha256(bytes)!==p.sha256)throw Error('Settled capture changed.');return JSON.parse(bytes.toString());});
    for(const c of m.contexts){
      const film=json(c.film),row=checker.results.find((r:any)=>r.sha256===c.film.sha256);
      if(!row||film.key!==m.key||`${film.facing}-L${film.reviewLook}`!==c.id||seatMechanicsDigest(film.model)!==m.mechanicsDigest||canonical(film.rendererSources)!==canonical(bundle.rendererSources)||!film.unchanged||film.swappedFields?.length)throw Error(`${c.id}: motion film source/model/appearance binding differs.`);
      const surfaceDigests=Object.fromEntries(Object.entries(film.model.surfaces??{}).map(([f,map])=>[f,sha256(canonical(map))]));
      if(!Object.keys(contract.surfaceDigests??{}).length||canonical(surfaceDigests)!==canonical(contract.surfaceDigests))throw Error(`${c.id}: motion surface labels differ from independently reviewed settled surfaces.`);
      const settledLook=settledRecords.find((r:any)=>r.facing===film.facing&&r.reviewLook===film.reviewLook)?.look;
      if(!settledLook||!film.wornLook||Object.entries(settledLook).some(([key,value])=>canonical(film.wornLook[key])!==canonical(value)))throw Error(`${c.id}: motion outfit differs from the exact settled outfit.`);
      const artFile=file(c.art);if(!artFile.bytes.equals(Buffer.from(film.art.png.split(',')[1],'base64')))throw Error('Motion art extraction differs.');
      const art=readPng(artFile.path),settledArt=settledRecords.find((r:any)=>r.facing===film.facing)?.art;
      if(!settledArt||art.w!==settledArt.w||art.h!==settledArt.h||art.d.some((v,i)=>v!==settledArt.rgba[i]))throw Error(`${c.id}: motion artwork differs from independently reviewed settled artwork.`);
      if(row.failures?.length||row.settledIndependentExpectations.wrongWinnerPixels||['exteriorChanged','injectedAlpha','canvasDifferences','canvasClipped','poseRaces'].some(k=>row.counts[k]))throw Error(`${c.id}: motion invariants failed.`);
      const states=film.frames.map((f:any)=>f.state),worlds=new Set(states.filter((s:any)=>s.onSeat&&s.serverSeat===film.object.id&&s.pose.startsWith('sit')&&(s.phase.startsWith('seated-')||s.phase.startsWith('cushion-shift-'))).map((s:any)=>canonical(s.world)));
      if(!states.some((s:any)=>s.phase==='entry'&&!s.onSeat)||!states.some((s:any)=>s.phase==='entry'&&s.onSeat)||!states.some((s:any)=>s.phase==='exit'&&!s.onSeat)||worlds.size!==contract.sits.length||canonical(row.settledIndependentExpectations.exactReviewedCushions)!==canonical(contract.sits.map((_:any,i:number)=>i)))throw Error(`${c.id}: actual phases/cushions are incomplete.`);
      if(c.frames.length!==film.frames.length)throw Error(`${c.id}: changed-state frames omitted.`);
      const images=c.frames.map((p:any,i:number)=>{const f=file(p);if(!f.bytes.equals(Buffer.from(film.frames[i].png.split(',')[1],'base64')))throw Error(`${c.id}: frame image differs from actual captured canvas.`);return readPng(f.path);});
      const covered:number[]=[];
      for(const page of c.pages){const img=readPng(file(page.image).path),frames=images.slice(page.start,page.start+page.count),w=Math.max(...frames.map((f:any)=>f.w)),h=Math.max(...frames.map((f:any)=>f.h));if(page.count<1||page.count>8||img.w!==w*8||img.h!==h*6+60)throw Error('Motion page dimensions differ.');
        for(const [j,f]of frames.entries()){covered.push(page.start+j);const row=Math.floor(j/4),col=j%4;for(const scale of [1,2])for(let y=0;y<f.h*scale;y++)for(let x=0;x<f.w*scale;x++)for(let ch=0;ch<3;ch++){const expected=f.d[(Math.floor(y/scale)*f.w+Math.floor(x/scale))*4+ch],at=((row*(h*3+30)+20+(scale===2?h:0)+y)*img.w+col*w*2+x)*4+ch;if(img.d[at]!==expected)throw Error(`${c.id}: native/enlarged motion page differs from captured frame.`);}}
      }
      if(canonical(covered)!==canonical(images.map((_:any,i:number)=>i)))throw Error(`${c.id}: visual pages omit or duplicate changed states.`);
    }
    const expectationBytes=bundle.expectations.map((p:any)=>{const bytes=readFileSync(resolve(dirname(bundlePath),p.path));if(sha256(bytes)!==p.sha256)throw Error('Immutable settled expectations changed.');return bytes;});
    const fresh=recomputeMotionInvariants(m.contexts.map((c:any)=>file(c.film).bytes),expectationBytes,readFileSync(bundlePath));
    if(!fresh.requiredComplete||!fresh.invariantsPassed||fresh.problems?.length)throw Error('Independent motion recomputation rejected raw evidence: '+(fresh.problems??[]).slice(0,4).join('; '));
    const judgments=[d.contexts];
    if(d.provenance?.kind==='independent-vision'){
      const request=json(d.provenance.request),response=json(d.provenance.response),content=request.input?.[0]?.content??[];
      if(response.status!=='completed'||request.metadata?.seat_motion_manifest!==identity||response.metadata?.seat_motion_manifest!==identity||!content[0]?.text?.includes(identity)||!content[0]?.text?.includes(m.scope))throw Error('Motion provider request/response binding differs.');
      if(canonical(content.slice(1).filter((c:any)=>c.type==='input_text').map((c:any)=>JSON.parse(c.text)))!==canonical(m.contexts.map((c:any)=>({id:c.id,frames:c.frames.length}))))throw Error('Motion provider context descriptions differ.');
      const urls=m.contexts.flatMap((c:any)=>c.pages.map((p:any)=>'data:image/png;base64,'+file(p.image).bytes.toString('base64')));
      if(canonical(urls)!==canonical(content.filter((c:any)=>c.type==='input_image').map((c:any)=>c.image_url)))throw Error('Motion provider did not receive every exact review page.');
      const raw=JSON.parse(response.output.flatMap((o:any)=>o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join(''));if(canonical(raw.contexts)!==canonical(d.contexts))throw Error('Motion decision differs from provider response.');
    }else if(['independent-agent','independent-human'].includes(d.provenance?.kind)){
      const reviewers=new Set<string>();if(d.provenance.reviews?.length<2)throw Error('Two independent whole-motion reviews required.');
      for(const p of d.provenance.reviews??[]){const r=json(p);if(!r.reviewer||reviewers.has(r.reviewer)||r.manifestSha256!==identity||r.scope!==m.scope||!exact(r.contexts))throw Error('Independent motion reviewer/context binding differs.');reviewers.add(r.reviewer);judgments.push(r.contexts);}
      if(reviewers.size<2)throw Error('Two independent whole-motion reviews required.');
    }else throw Error('Independent transition appearance review is missing.');
    for(const rows of judgments)for(const c of rows)if(c.verdict!=='pass'||!c.reason||!Array.isArray(c.issues)||!Array.isArray(c.uncertainties)||!Array.isArray(c.risks)||c.issues.length||c.uncertainties.length||c.risks.length)throw Error(`${c.id}: transition appearance remains rejected or unresolved.`);
    return [];
  }catch(error){return [error instanceof Error?error.message:String(error)];}
}
