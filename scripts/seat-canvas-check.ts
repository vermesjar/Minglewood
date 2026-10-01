/** Verify final-canvas evidence without granting semantic surface approval. */
import { readFileSync, readdirSync } from 'node:fs';
const directory=process.argv[2];
if (!directory) throw new Error('Usage: seat-canvas-check.ts CAPTURE_DIRECTORY');
const files=readdirSync(directory).filter(f=>f.endsWith('.json')&&!f.startsWith('expected'));
let frames=0,pixels=0;
const captureModes:Record<string,number>={};
const failures:string[]=[];
for (const file of files) {
  const records=JSON.parse(readFileSync(`${directory}/${file}`,'utf8'));
  if (!Array.isArray(records)) continue;
  for (const r of records) {
    if (!r.finalCanvas) {
      if (!r.finalCanvasReference) failures.push(`${file}: ${r.id}/${r.facing}/${r.cushion} missing final-canvas evidence`);
      else if (!records.some(p=>p.id===r.finalCanvasReference&&p.reviewLook===r.reviewLook&&p.finalCanvas))
        failures.push(`${file}: dangling final-canvas reference ${r.finalCanvasReference}`);
      continue;
    }
    frames++;
    const mode=`${r.lighting??'unspecified lighting'}; reducedMotion=${r.reducedMotion??'unspecified'}`;
    captureModes[mode]=(captureModes[mode]??0)+1;
    pixels+=r.finalCanvas.checked;
    if (!r.finalCanvas.passed || !r.finalCanvas.checked || r.finalCanvas.differences.length)
      failures.push(`${file}: ${r.id}, look ${r.reviewLook}, ${r.finalCanvas.differences.length} final RGBA differences`);
  }
}
if (!frames) failures.push('No final-canvas frames captured');
console.log(JSON.stringify({frames,pixels,captureModes,failures,scope:'Opaque furniture/avatar final compositing in the recorded capture modes only; semantic pixel review and excluded effects still require separate verification.'},null,2));
process.exitCode=failures.length?1:0;
