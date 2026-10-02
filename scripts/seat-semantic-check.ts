/** Independently reviewed source-pixel expectations, including explicit unresolved coordinates. */
import { readFileSync, readdirSync } from 'node:fs';
import { reviewedFigureContext } from './lib/seat-review-context';
const [directory, reviewFile]=process.argv.slice(2);
if (!directory||!reviewFile) throw new Error('Usage: seat-semantic-check.ts CAPTURE_DIRECTORY INDEPENDENT_REVIEW.json');
const review=JSON.parse(readFileSync(reviewFile,'utf8'));
if (!review.context || !Array.isArray(review.points)) throw new Error('Review needs source context and a complete overlap point list');
const captures=readdirSync(directory).filter(f=>f.endsWith('.json')&&!f.startsWith('expected'))
  .flatMap(f=>{const r=JSON.parse(readFileSync(`${directory}/${f}`,'utf8'));return Array.isArray(r)?r:[];});
const ctx=review.context;
const r=captures.find(r=>`${r.object.sprite}${r.object.variant?'.'+r.object.variant:''}`===ctx.key&&
  r.facing===ctx.facing&&r.cushion===ctx.cushion&&r.pose===ctx.pose&&JSON.stringify(r.look)===JSON.stringify(ctx.look));
if (!r) throw new Error('Exact reviewed seat/facing/cushion/pose/outfit context is missing');
if(r.model.compiler?.source!==ctx.modelSource) throw new Error('Artwork/declaration/compiler fingerprint changed; independent review required');
if (!ctx.figureContext) throw new Error('Legacy partial review lacks immutable figure/placement context; it cannot grant full approval. Re-inspect the original reviewed capture.');
if (JSON.stringify(ctx.figureContext)!==JSON.stringify(reviewedFigureContext(r)))
  throw new Error('Reviewed feet/legs/height or original avatar pixels/ownership changed; independent review required.');
let checked=0,uncertain=0;
const failures:Array<{x:number;y:number;reason:string}>=[];
const reviewed=new Set<string>();
for (const point of review.points) {
  const key=`${point.x},${point.y}`;
  if (reviewed.has(key)) throw new Error(`Duplicate reviewed coordinate ${key}`);
  reviewed.add(key);
  if (point.winner==='uncertain') {uncertain++;continue;}
  if (point.winner!=='avatar'&&point.winner!=='furniture') throw new Error(`Invalid winner ${point.winner}`);
  checked++;
  const x=point.x-Math.round(r.feet[0])+r.figure.ax,y=point.y-Math.round(r.feet[1])+r.figure.ay,i=y*r.figure.w+x;
  const overlap=x>=0&&y>=0&&x<r.figure.w&&y<r.figure.h&&r.figure.rgba[i*4+3]&&r.art.rgba[(point.y*r.art.w+point.x)*4+3];
  if(!overlap) failures.push({x:point.x,y:point.y,reason:'Reviewed overlap no longer exists; context requires new review'});
  else if((r.figure.actual[i*4+3]?'avatar':'furniture')!==point.winner) failures.push({x:point.x,y:point.y,reason:`Expected ${point.winner}`});
}
let missing=0;
for(let y=0;y<r.art.h;y++)for(let x=0;x<r.art.w;x++){
  const fx=x-Math.round(r.feet[0])+r.figure.ax,fy=y-Math.round(r.feet[1])+r.figure.ay;
  if(fx>=0&&fy>=0&&fx<r.figure.w&&fy<r.figure.h&&r.figure.rgba[(fy*r.figure.w+fx)*4+3]&&r.art.rgba[(y*r.art.w+x)*4+3]&&!reviewed.has(`${x},${y}`))missing++;
}
const state=failures.length?'FAILED':uncertain||missing?'INCOMPLETE':'REVIEWED_OVERLAP_PASS';
console.log(JSON.stringify({state,checked,uncertain,missing,failures,scope:'Only the exact recorded seat, facing, cushion, pose and outfit.'},null,2));
process.exitCode=failures.length?1:uncertain||missing?2:0;
