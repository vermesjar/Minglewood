/** Authored curves need independent whole-image quality approval in addition to exact numerical evidence. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonical, sha256 } from './seat-verification';
import { visualRisks } from './seat-visual-risks';
import { readPng } from './png';
import { reviewedFigureContext } from './seat-review-context';
export const SEAT_VISUAL_SCOPE = 'Every direction, cushion and review outfit: original beauty, body silhouette, support contact, comfortable seat depth and backrest/cushion proportions, body scale, arm/back ordering and pixel topology. Settled views only; no motion approval.';
export function verifySeatVisualImages(m:any,bundle:any,folder:string,bundleFolder:string) {
  const jsonProof=(p:any)=>{const b=readFileSync(resolve(bundleFolder,p.path));if(sha256(b)!==p.sha256)throw Error('Numerical source evidence changed.');return JSON.parse(b.toString('utf8'));};
  const records=bundle.captures.flatMap(jsonProof),expectations=bundle.expectations.map(jsonProof);
  const png=(p:any)=>{const file=resolve(folder,p.path);if(sha256(readFileSync(file))!==p.sha256)throw Error('Visual image bytes changed.');return readPng(file);};
  if(!Array.isArray(m.sourceInputs)||!m.sourceInputs.length)throw Error('Original anatomy input bindings are missing.');
  const anatomy=m.sourceInputs.flatMap((p:any)=>{const b=readFileSync(resolve(folder,p.path));if(sha256(b)!==p.sha256)throw Error('Original anatomy changed.');return JSON.parse(b.toString('utf8')).contexts??[];});
  for(const c of m.contexts) {
    const matches=records.filter((r:any)=>`${r.facing}-L${r.reviewLook}-C${r.cushion}`===c.id);
    if(matches.length!==1)throw Error(`${c.id}: visual context does not identify one exact capture.`);
    const r=matches[0],es=expectations.filter((e:any)=>e.context?.key===m.key&&e.context.facing===r.facing&&e.context.cushion===r.cushion&&canonical(e.context.look)===canonical(r.look)&&canonical(e.context.figureContext)===canonical(reviewedFigureContext(r)));
    if(es.length!==1||canonical(c.sourceContext)!==canonical(es[0].context))throw Error(`${c.id}: visual source/anatomy context differs from numerical evidence.`);
    const art=r.art,f=r.figure,ox=Math.floor(r.feet[0]+.5)-f.ax,oy=Math.floor(r.feet[1]+.5)-f.ay;
    const left=Math.min(0,ox)-3,top=Math.min(0,oy)-3,right=Math.max(art.w,ox+f.w)+3,bottom=Math.max(art.h,oy+f.h)+3,w=right-left,h=bottom-top;
    const source=new Uint8Array(w*h*4);for(let i=0;i<source.length;i+=4)source.set([233,231,237,255],i);
    const paint=(dest:Uint8Array,rgba:number[],x:number,y:number,blend:boolean)=>{const j=(y*w+x)*4,a=rgba[3]/255;if(!a)return;for(let k=0;k<3;k++)dest[j+k]=blend?Math.round(rgba[k]*a+dest[j+k]*(1-a)):rgba[k];dest[j+3]=blend?255:rgba[3];};
    for(let y=0;y<art.h;y++)for(let x=0;x<art.w;x++)paint(source,art.rgba.slice((y*art.w+x)*4,(y*art.w+x)*4+4),x-left,y-top,true);
    const unmasked=Uint8Array.from(source),independent=Uint8Array.from(source),labels=new Map<string,string>(es[0].points.map((p:any)=>[`${p.x},${p.y}`,p.winner]));
    for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++) {const rgba=f.rgba.slice((y*f.w+x)*4,(y*f.w+x)*4+4),X=x+ox,Y=y+oy;paint(unmasked,rgba,X-left,Y-top,true);if(labels.get(`${X},${Y}`)!=='furniture')paint(independent,rgba,X-left,Y-top,false);}
    const originals=new Set<string>(),visible=new Set<string>();
    for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++)if(f.rgba[(y*f.w+x)*4+3]){const p=`${x+ox},${y+oy}`;originals.add(p);if(labels.get(p)!=='furniture')visible.add(p);}
    const originalAnatomy=anatomy.filter((a:any)=>canonical(a.context)===canonical(es[0].context));
    if(originalAnatomy.length!==1)throw Error(`${c.id}: exact original anatomy is missing or duplicate.`);
    const requiredRisks=visualRisks(originals,visible,originalAnatomy[0].anatomy?.hipContact);
    if(canonical(requiredRisks)!==canonical(c.risks.map((r:any)=>({id:r.id,kind:r.kind,pixels:r.pixels}))))throw Error(`${c.id}: required topology/contact risks were omitted or altered.`);
    for(const risk of requiredRisks){
      if(!risk.pixels.length)continue;
      const supplied=c.risks.find((r:any)=>r.id===risk.id);if(!supplied.crop)throw Error(`${c.id}: marked risk crop is missing.`);
      const xs=risk.pixels.map((p:number[])=>p[0]),ys=risk.pixels.map((p:number[])=>p[1]);
      const l=Math.max(0,Math.min(...xs)-left-5),t=Math.max(0,Math.min(...ys)-top-5),rr=Math.min(w,Math.max(...xs)-left+6),bb=Math.min(h,Math.max(...ys)-top+6),crop=png(supplied.crop);
      if(crop.w!==(rr-l)*12||crop.h!==(bb-t)*12)throw Error(`${c.id}: risk crop bounds differ.`);
      const marked=new Set(risk.pixels.map((p:number[])=>`${p[0]-left-l},${p[1]-top-t}`));
      for(let y=0;y<crop.h;y++)for(let x=0;x<crop.w;x++){const sx=Math.floor(x/12),sy=Math.floor(y/12),red=marked.has(`${sx},${sy}`)&&(x%12===0||x%12===11||y%12===0||y%12===11);for(let ch=0;ch<4;ch++){const expected=red?[255,56,56,255][ch]:independent[((sy+t)*w+sx+l)*4+ch];if(crop.d[(y*crop.w+x)*4+ch]!==expected)throw Error(`${c.id}: marked risk crop pixels differ from independent composition.`);}}
    }
    const image=png(c.independentComposite);
    if(image.w!==w||image.h!==h||image.d.some((v,i)=>v!==independent[i]))throw Error(`${c.id}: visual composite was not derived from bound original pixels and independent expectations.`);
    const sheet=png(c.sheet);
    if(sheet.w!==w*9||sheet.h!==h*4+36)throw Error(`${c.id}: visual reference sheet dimensions differ.`);
    for(const [column,pixels] of [source,unmasked,independent].entries())for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let ch=0;ch<3;ch++) {
      const expected=pixels[(y*w+x)*4+ch];
      if(sheet.d[((y+20)*sheet.w+column*w*3+x)*4+ch]!==expected)throw Error(`${c.id}: native source/body/composite sheet pixels are stale.`);
      for(let sy=0;sy<3;sy++)for(let sx=0;sx<3;sx++)if(sheet.d[((30+h+y*3+sy)*sheet.w+column*w*3+x*3+sx)*4+ch]!==expected)throw Error(`${c.id}: enlarged source/body/composite sheet pixels are stale.`);
    }
    const frame=records.find((q:any)=>q.facing===r.facing&&q.reviewLook===r.reviewLook&&q.finalCanvas)?.finalCanvas,actual=png(c.actualCanvas);
    if(!frame||actual.w!==frame.rect.width||actual.h!==frame.rect.height||actual.d.some((v,i)=>v!==frame.actual[i]))throw Error(`${c.id}: actual canvas image differs from the bound captured frame.`);
  }
}
export function verifySeatVisual(bundlePath: string, contractPath: string, folder = resolve(dirname(bundlePath), 'visual-review')): string[] {
  try {
    const manifestPath=resolve(folder,'manifest.json'),decisionPath=resolve(folder,'decision.json');
    const manifestBytes=readFileSync(manifestPath),m=JSON.parse(manifestBytes.toString('utf8')),d=JSON.parse(readFileSync(decisionPath,'utf8'));
    const checked=(p:any,base=folder)=>{const bytes=readFileSync(resolve(base,p.path));if(sha256(bytes)!==p.sha256)throw Error(`Visual evidence changed: ${p.path}`);return JSON.parse(bytes.toString('utf8'));};
    if(m.version!==1||d.version!==1||m.kind!=='authored-seat-visual-review'||d.manifestSha256!==sha256(manifestBytes)||m.scope!==SEAT_VISUAL_SCOPE||d.scope!==SEAT_VISUAL_SCOPE)throw Error('Visual review scope or manifest binding is stale.');
    if(m.bundle.sha256!==sha256(readFileSync(bundlePath))||m.contract.sha256!==sha256(readFileSync(contractPath)))throw Error('Visual review belongs to different numerical evidence.');
    const contract=JSON.parse(readFileSync(contractPath,'utf8'));
    if(m.mechanicsDigest!==contract.mechanicsDigest||canonical(m.surfaceDigests)!==canonical(contract.surfaceDigests)||m.key!==contract.key)throw Error('Visual review model binding is stale.');
    if(!Array.isArray(m.bindings)||!m.bindings.length)throw Error('Visual source/body/image bindings are missing.');
    for(const p of m.bindings)if(sha256(readFileSync(resolve(folder,p.path)))!==p.sha256)throw Error(`Visual evidence changed: ${p.path}`);
    const required=new Set<string>();for(const f of ['se','sw','ne','nw'])for(let l=0;l<4;l++)for(let c=0;c<contract.sits.length;c++)required.add(`${f}-L${l}-C${c}`);
    const exact=(ids:string[])=>ids.length===required.size&&new Set(ids).size===ids.length&&ids.every(id=>required.has(id));
    if(!exact(m.contexts.map((c:any)=>c.id))||!exact(d.contexts.map((c:any)=>c.id)))throw Error('Visual review context coverage is incomplete.');
    const bundle=JSON.parse(readFileSync(bundlePath,'utf8'));
    if(canonical(m.rendererSources)!==canonical(bundle.rendererSources))throw Error('Visual renderer binding differs from the captured renderer.');
    verifySeatVisualImages(m,bundle,folder,dirname(bundlePath));
    if(!d.provenance?.reviewer)throw Error('Independent visual reviewer identity is missing.');
    const localContexts:any[][]=[];
    if(d.provenance.kind==='independent-vision') {
      const request=checked(d.provenance.request),response=checked(d.provenance.response);
      const identity=sha256(manifestBytes),content=request.input?.[0]?.content??[];
      if(request.metadata?.seat_visual_manifest!==identity||response.metadata?.seat_visual_manifest!==identity||!content[0]?.text?.includes(identity)||!content[0]?.text?.includes(SEAT_VISUAL_SCOPE))throw Error('Visual provider request/response is not bound to this manifest and scope.');
      const descriptions=content.slice(1).filter((c:any)=>c.type==='input_text').map((c:any)=>JSON.parse(c.text));
      if(canonical(descriptions)!==canonical(m.contexts.map((c:any)=>Object.fromEntries(['id','facing','look','cushion','risks'].map(k=>[k,c[k]])))))throw Error('Visual provider context descriptions differ from exact evidence.');
      const expectedImages=m.contexts.flatMap((c:any)=>[c.sheet,c.actualCanvas,...c.risks.filter((r:any)=>r.crop).map((r:any)=>r.crop)]).map((p:any)=>{const bytes=readFileSync(resolve(folder,p.path));if(sha256(bytes)!==p.sha256)throw Error('Visual request image changed.');return 'data:image/png;base64,'+bytes.toString('base64');});
      if(canonical(content.filter((c:any)=>c.type==='input_image').map((c:any)=>c.image_url))!==canonical(expectedImages))throw Error('Visual provider request images differ from bound evidence.');
      if(response.status!=='completed')throw Error('Visual provider response is incomplete.');
      const raw=JSON.parse(response.output.flatMap((o:any)=>o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join(''));
      if(canonical(raw.contexts)!==canonical(d.contexts))throw Error('Visual decision differs from the independent provider response.');
    } else if(['independent-human','independent-agent'].includes(d.provenance.kind)) {
      if(!Array.isArray(d.provenance.reviews)||d.provenance.reviews.length<2)throw Error('Two independent local visual reviews are required.');
      const reviewers=new Set<string>();
      for(const p of d.provenance.reviews) {const r=checked(p);if(!r.reviewer||reviewers.has(r.reviewer)||r.manifestSha256!==sha256(manifestBytes)||r.scope!==SEAT_VISUAL_SCOPE||!Array.isArray(r.contexts)||!exact(r.contexts.map((c:any)=>c.id)))throw Error('Local visual review identity, binding or approved contexts differ.');reviewers.add(r.reviewer);localContexts.push(r.contexts);}
    } else throw Error('Unknown independent visual review provenance.');
    const problems:string[]=[];
    for(const contexts of [d.contexts,...localContexts])for(const c of m.contexts) {
      const v=contexts.find((v:any)=>v.id===c.id),risks=new Set(c.risks.map((r:any)=>r.id));
      if(v.verdict!=='pass'||!v.reason||!Array.isArray(v.issues)||!Array.isArray(v.uncertainties)||v.issues.length||v.uncertainties.length)problems.push(`${c.id}: visual quality remains unapproved.`);
      if(!Array.isArray(v.risks)||v.risks.length!==risks.size||new Set(v.risks.map((a:any)=>a.id)).size!==risks.size||v.risks.some((a:any)=>!risks.has(a.id)||a.verdict!=='acceptable'||!a.reason))problems.push(`${c.id}: unresolved topology or contact risk.`);
    }
    return problems;
  } catch(error) {return [error instanceof Error?error.message:String(error)];}
}
