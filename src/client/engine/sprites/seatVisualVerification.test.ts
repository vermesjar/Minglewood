import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../../../../scripts/lib/seat-verification';
import { SEAT_VISUAL_SCOPE, verifySeatVisual } from '../../../../scripts/lib/seat-visual-verification';
import { reviewedFigureContext } from '../../../../scripts/lib/seat-review-context';
import { blank, writePng } from '../../../../scripts/lib/png';

function fixture(run: (f: any) => void) {
  const root=mkdtempSync(join(tmpdir(),'seat-visual-gate-')),folder=join(root,'visual-review');mkdirSync(folder);
  const save=(name:string,value:unknown)=>{const text=JSON.stringify(value);writeFileSync(join(folder,name),text);return {path:name,sha256:sha256(text)};};
  try {
    const contract=save('../contract.json',{key:'seat',sits:[[.5,.5,10]],mechanicsDigest:'a'.repeat(64),surfaceDigests:{se:'b'}});
    const body=save('body.json',{reference:'original body geometry'});
    const records:any[]=[],expectations:any[]=[],images:any[]=[],contexts:any[]=[],anatomy:any[]=[];
    const image=(name:string,img:any)=>{writePng(join(folder,name),img);const p={path:name,sha256:sha256(readFileSync(join(folder,name)))};images.push(p);return p;};
    const source=blank(7,7,[233,231,237],255);source.d.set([30,40,50,255],(3*7+3)*4);
    const independent={...source,d:Uint8Array.from(source.d)};independent.d.set([200,100,50,255],(3*7+3)*4);
    const sheet=blank(63,64,[233,231,237],255);
    for(const [column,img] of [source,independent,independent].entries())for(let y=0;y<7;y++)for(let x=0;x<7;x++)for(let ch=0;ch<4;ch++) {
      const v=img.d[(y*7+x)*4+ch];sheet.d[((y+20)*63+column*21+x)*4+ch]=v;
      for(let sy=0;sy<3;sy++)for(let sx=0;sx<3;sx++)sheet.d[((37+y*3+sy)*63+column*21+x*3+sx)*4+ch]=v;
    }
    const composite=image('independent.png',independent),sheetProof=image('sheet.png',sheet),actual=image('actual.png',{w:1,h:1,d:new Uint8Array([200,100,50,255])});
    const crop=blank(84,84,[233,231,237],255);for(let y=0;y<84;y++)for(let x=0;x<84;x++){const sx=Math.floor(x/12),sy=Math.floor(y/12),red=sx===3&&sy===3&&(x%12===0||x%12===11||y%12===0||y%12===11);crop.d.set(red?[255,56,56,255]:independent.d.slice((sy*7+sx)*4,(sy*7+sx)*4+4),(y*84+x)*4);}const cropProof=image('risk.png',crop);
    for(const facing of ['se','sw','ne','nw'])for(const look of [0,1,2,3]) {
      const r={facing,reviewLook:look,cushion:0,look:{look},feet:[0,0] as [number,number],height:10,legs:{},art:{w:1,h:1,rgba:[30,40,50,255]},figure:{w:1,h:1,ax:0,ay:0,rgba:[200,100,50,255],owner:[20]},finalCanvas:{rect:{width:1,height:1},actual:[200,100,50,255]}};
      const ctx={key:'seat',facing,cushion:0,look:r.look,figureContext:reviewedFigureContext(r)};
      anatomy.push({context:ctx,anatomy:{hipContact:[0,0]}});
      const e=save(`${facing}-${look}.json`,{context:ctx,points:[{x:0,y:0,winner:'avatar'}]});expectations.push({...e,path:`visual-review/${e.path}`});
      contexts.push({id:`${facing}-L${look}-C0`,facing,look,cushion:0,sourceContext:ctx,independentComposite:composite,sheet:sheetProof,actualCanvas:actual,risks:[{id:'risk-0',kind:'support-contact-transition-unconfirmed',pixels:[[0,0]],crop:cropProof}]});records.push(r);
    }
    const capture=save('capture.json',records),bundle=save('../bundle.json',{version:1,rendererSources:{body:'hash'},captures:[{...capture,path:'visual-review/capture.json'}],expectations});
    const anatomyProof=save('anatomy.json',{contexts:anatomy});
    const m={sourceInputs:[anatomyProof],version:1,kind:'authored-seat-visual-review',scope:SEAT_VISUAL_SCOPE,key:'seat',mechanicsDigest:'a'.repeat(64),surfaceDigests:{se:'b'},bundle,contract,bindings:[contract,bundle,body,...images],rendererSources:{body:'hash'},contexts};
    const manifest=save('manifest.json',m);
    const approvals=contexts.map(c=>({id:c.id,verdict:'pass',reason:'Independent full composite inspected',issues:[],uncertainties:[],risks:[{id:'risk-0',verdict:'acceptable',reason:'Independently identified open space, not body clipping'}]}));
    const request=save('request.json',{metadata:{seat_visual_manifest:manifest.sha256},input:[{role:'user',content:[{type:'input_text',text:manifest.sha256+' '+SEAT_VISUAL_SCOPE},...contexts.flatMap(c=>[{type:'input_text',text:JSON.stringify(Object.fromEntries(['id','facing','look','cushion','risks'].map(k=>[k,c[k]])))},...[c.sheet,c.actualCanvas,...c.risks.map((r:any)=>r.crop)].map(p=>({type:'input_image',image_url:'data:image/png;base64,'+readFileSync(join(folder,p.path)).toString('base64')}))])]}]});
    const response=save('response.json',{status:'completed',metadata:{seat_visual_manifest:manifest.sha256},output:[{content:[{type:'output_text',text:JSON.stringify({contexts:approvals})}]}]});
    const d={version:1,scope:SEAT_VISUAL_SCOPE,manifestSha256:manifest.sha256,contexts:approvals,provenance:{kind:'independent-vision',reviewer:'mock-reviewer',request,response}};
    save('decision.json',d);
    run({root,folder,save,m,d,approvals,check:()=>verifySeatVisual(join(root,'bundle.json'),join(root,'contract.json'))});
  } finally {rmSync(root,{recursive:true,force:true});}
}

describe('separate authored-seat visual gate',()=>{
  it('accepts complete independently bound visual judgment',()=>fixture(f=>expect(f.check()).toEqual([])));
  it('cannot substitute numerical parity, edit the provider decision, or omit a context',()=>fixture(f=>{
    f.d.contexts.pop();f.save('decision.json',f.d);expect(f.check().join()).toContain('coverage');
  }));
  it('rejects unresolved topology even when an independent provider completed',()=>fixture(f=>{
    f.d.contexts[0].risks[0].verdict='unresolved';
    f.d.provenance.response=f.save('response.json',{status:'completed',metadata:{seat_visual_manifest:f.d.manifestSha256},output:[{content:[{type:'output_text',text:JSON.stringify({contexts:f.d.contexts})}]}]});
    f.save('decision.json',f.d);expect(f.check().join()).toContain('unresolved');
  }));
  it('rejects a rehashed old provider response and substituted request images',()=>fixture(f=>{
    const r=JSON.parse(readFileSync(join(f.folder,'response.json'),'utf8'));r.metadata.seat_visual_manifest='0'.repeat(64);
    f.d.provenance.response=f.save('response.json',r);f.save('decision.json',f.d);expect(f.check().join()).toContain('not bound');
    r.metadata.seat_visual_manifest=f.d.manifestSha256;f.d.provenance.response=f.save('response.json',r);
    const q=JSON.parse(readFileSync(join(f.folder,'request.json'),'utf8'));q.input[0].content[2].image_url='data:image/png;base64,old';
    f.d.provenance.request=f.save('request.json',q);f.save('decision.json',f.d);expect(f.check().join()).toContain('images differ');
  }));
  it('rejects omitted risks despite consistently rewritten review artifacts',()=>fixture(f=>{for(const c of f.m.contexts)c.risks=[];f.d.manifestSha256=f.save('manifest.json',f.m).sha256;f.save('decision.json',f.d);expect(f.check().join()).toContain('risks were omitted');}));
  it('rejects changed body, image or numerical bundle bytes',()=>fixture(f=>{
    f.save('body.json',{reference:'new body'});expect(f.check().join()).toContain('evidence changed');
  }));
  it('rejects a self-consistently hashed but wrong independent image',()=>fixture(f=>{
    const wrong=blank(7,7,[233,231,237],255);writePng(join(f.folder,'independent.png'),wrong);
    const hash=sha256(readFileSync(join(f.folder,'independent.png')));
    for(const p of f.m.bindings)if(p.path==='independent.png')p.sha256=hash;
    for(const c of f.m.contexts)c.independentComposite.sha256=hash;
    f.d.manifestSha256=f.save('manifest.json',f.m).sha256;f.save('decision.json',f.d);
    expect(f.check().join()).toContain('not derived');
  }));
  it('requires two distinct local agent reviews and accepts different independent reasons',()=>fixture(f=>{
    const local=(reviewer:string,reason:string)=>({reviewer,scope:SEAT_VISUAL_SCOPE,manifestSha256:f.d.manifestSha256,contexts:f.approvals.map((c:any)=>({...c,reason}))});
    const one=f.save('review-a.json',local('agent-a','Personally checked all contexts'));
    f.d.provenance={kind:'independent-agent',reviewer:'coordinator',reviews:[one]};f.save('decision.json',f.d);expect(f.check().join()).toContain('Two independent');
    const two=f.save('review-b.json',local('agent-b','Independent adversarial visual inspection'));
    f.d.provenance.reviews.push(two);f.save('decision.json',f.d);expect(f.check()).toEqual([]);
    const changed=JSON.parse(readFileSync(join(f.folder,'review-b.json'),'utf8'));changed.contexts[0].verdict='unresolved';f.d.provenance.reviews[1]=f.save('review-b.json',changed);f.save('decision.json',f.d);expect(f.check().join()).toContain('unapproved');
  }));
});
