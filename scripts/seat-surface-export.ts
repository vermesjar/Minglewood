/** Export an immutable source-image/part contract for automated surface annotation. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {loadManifest} from './lib/manifest';
import {viewArt,type Sprites} from './lib/seats';
import {seatMechanicsDigest} from './lib/seat-verification';
import {drawingPrint} from '../src/shared/world/seatFigure';
import {projectLocal,towardCamera} from '../src/shared/world/seatModels';
const arg=(n:string)=>{const i=process.argv.indexOf(`--${n}`);return i<0?undefined:process.argv[i+1];};
const key=arg('key')!,facing=(arg('facing')??'nw') as 'se'|'sw'|'ne'|'nw';
if(!key)throw new Error('--key required');
const entries=arg('entries')?JSON.parse(readFileSync(arg('entries')!,'utf8')):loadManifest().sprites;
const models=JSON.parse(readFileSync(arg('models')??'art/seat-models.json','utf8'));
const {art}=viewArt(entries as Sprites,key,facing,arg('sprites')??'public/art/sprites');
const model=models[key];if(!model)throw new Error(`No model ${key}`);
const projectedParts=model.parts.map((p:any,index:number)=>({index,kind:p.part,
  center:projectLocal([art.ax,art.ay],model.size,facing,(p.u[0]+p.u[1])/2,(p.v[0]+p.v[1])/2,(p.z[0]+p.z[1])/2),
  role:p.part==='arm'||p.part==='wrap'&&(p.u[1]<=model.size[0]/2||p.u[0]>=model.size[0]/2)
    ? (p.part==='wrap'
      ? (((p.u[0]+p.u[1])/2-model.size[0]/2)*towardCamera(facing).u>0?'near physical side wrap':'far physical side wrap')
      : (((p.u[0]+p.u[1])/2-model.size[0]/2)*towardCamera(facing).u>0?'near arm (foreground)':'far arm (behind sitter)'))
    :p.part==='wrap'?'central back wrap (behind in front views, foreground in rear views)':p.part}));
const out=arg('out')??`art/review/surfaces/${key}-${facing}`;mkdirSync(out,{recursive:true});
writeFileSync(`${out}/input.json`,JSON.stringify({key,facing,width:art.px.w,height:art.px.h,
  drawing:drawingPrint(art.px.w,art.px.h,art.px.d),mechanicsDigest:seatMechanicsDigest(model),modelParts:JSON.stringify(model.parts),
  anchor:[art.ax,art.ay],parts:model.parts,projectedParts,rgba:Array.from(art.px.d),model}));
console.log(`${out}/input.json`);
