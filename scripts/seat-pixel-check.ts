/** Independent pixel expectations; no screenshot-update or automatic approval mode. */
import { readFileSync, readdirSync } from 'node:fs';
const [directory, expectedFile] = process.argv.slice(2);
if (!directory || !expectedFile) throw new Error('Usage: seat-pixel-check.ts CAPTURE_DIRECTORY EXPECTED_PIXELS.json');
const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
if (!expected.points?.length) throw new Error('No independently reviewed pixel expectations. Visual verification is incomplete.');
const captures = readdirSync(directory).filter(f => f.endsWith('.json') && !f.startsWith('expected'))
  .flatMap(f => { const value=JSON.parse(readFileSync(`${directory}/${f}`, 'utf8')); return Array.isArray(value)?value:[]; });
const context=(r:any)=>JSON.stringify([r.look,r.pose,r.legs,r.feet,r.height]);
const failures: string[] = [];
for (const point of expected.points) {
  const matches = captures.filter(r => `${r.id}/${r.facing}/${r.cushion}` === point.case && (!point.context || context(r)===point.context));
  if(matches.length>1) { failures.push(`${point.case}: ambiguous capture; expectation must identify outfit, pose and placement`); continue; }
  const r = matches[0];
  if (!r) { failures.push(`${point.case}: missing capture`); continue; }
  if (r.model.compiler?.source !== point.source) { failures.push(`${point.case}: changed source needs review`); continue; }
  const f=r.figure,x=point.x-Math.round(r.feet[0])+f.ax,y=point.y-Math.round(r.feet[1])+f.ay;
  const i=y*f.w+x,j=point.y*r.art.w+point.x;
  if(x<0||y<0||x>=f.w||y>=f.h||!f.rgba[i*4+3]||!r.art.rgba[j*4+3]) {
    failures.push(`${point.case} ${point.x},${point.y}: expected overlap missing`);continue;
  }
  const actual=f.actual[i*4+3]?'avatar':'furniture';
  if(actual!==point.winner) failures.push(`${point.case} ${point.x},${point.y}: expected ${point.winner}, actual ${actual}`);
}
console.log(JSON.stringify({checked:expected.points.length,failures,scope:'Only annotated pixels; not whole-seat approval.'},null,2));
process.exitCode=failures.length?1:0;
