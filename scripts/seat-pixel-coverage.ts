/** Fail-closed coverage audit: an image or a handful of assertions cannot approve a whole seat. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const [directory,expectedFile]=process.argv.slice(2);
if(!directory||!expectedFile) throw new Error('Usage: seat-pixel-coverage.ts CAPTURES EXPECTATIONS.json');
const expected=JSON.parse(readFileSync(expectedFile,'utf8'));
const captures=readdirSync(directory).filter(f=>f.endsWith('.json')&&!f.startsWith('expected'))
  .flatMap(f=>{const value=JSON.parse(readFileSync(`${directory}/${f}`,'utf8'));return Array.isArray(value)?value:[];});
if(!captures.length) throw new Error('No captures');
const records=captures.map(r=>{
  const id=`${r.id}/${r.facing}/${r.cushion}`, context=JSON.stringify([r.look,r.pose,r.legs,r.feet,r.height]);
  const points=expected.points.filter((p:any)=>p.case===id&&p.context===context&&p.source===r.model.compiler?.source);
  const labels=new Map(points.map((p:any)=>[`${p.x},${p.y}`,p]));
  let overlaps=0,labelled=0,disagreements=0,conflicts=0;
  for(const p of points) if(points.some((q:any)=>q.x===p.x&&q.y===p.y&&q.winner!==p.winner)) conflicts++;
  const f=r.figure,ox=Math.round(r.feet[0])-f.ax,oy=Math.round(r.feet[1])-f.ay;
  for(let y=0;y<r.art.h;y++)for(let x=0;x<r.art.w;x++){
    const fx=x-ox,fy=y-oy,i=fy*f.w+fx;
    if(fx<0||fy<0||fx>=f.w||fy>=f.h||!f.rgba[i*4+3]||!r.art.rgba[(y*r.art.w+x)*4+3])continue;
    overlaps++;
    const p:any=labels.get(`${x},${y}`);
    if(!p)continue;
    labelled++;
    if(p.winner!==(f.actual[i*4+3]?'avatar':'furniture'))disagreements++;
  }
  return {id,context,source:r.model.compiler?.source,overlaps,labelled,unlabelled:overlaps-labelled,disagreements,conflicts,
    status:conflicts||disagreements?'FAIL':'UNAPPROVED',
    note:labelled===overlaps?'Overlap labels complete; final canvas and silhouette review still required.':'Independent overlap labels incomplete.'};
});
const report={scope:'Every captured overlap pixel; does not imply coverage of missing catalog cases or transitions.',
  cases:records.length,overlaps:records.reduce((n,r)=>n+r.overlaps,0),labelled:records.reduce((n,r)=>n+r.labelled,0),records};
writeFileSync(`${directory}/coverage-report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({cases:report.cases,overlaps:report.overlaps,labelled:report.labelled,unapproved:records.length}));
process.exitCode=records.some(r=>r.unlabelled||r.disagreements||r.conflicts)?1:0;
