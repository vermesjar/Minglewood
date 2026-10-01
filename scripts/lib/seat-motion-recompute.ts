/** Recompute movement invariants from immutable bytes, never a supplied pass report. */
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {canonical,sha256} from './seat-verification';

const cache=new Map<string,any>();
const checker='scripts/seat-motion-postcheck.py';
const geometry=['src/shared/world/seatFigure.ts','src/shared/world/seats.ts','src/client/engine/WorldView.ts'];
export function recomputeMotionInvariants(films:Buffer[],expectations:Buffer[],bundleBytes:Buffer){
  if(!films.length||!expectations.length)throw Error('Immutable films and settled expectations are required for motion recomputation.');
  const dependencies=Object.fromEntries([checker,...geometry].map(p=>[p,sha256(readFileSync(resolve(p)))]));
  const identity=sha256(canonical({films:films.map(sha256),expectations:expectations.map(sha256),bundle:sha256(bundleBytes),dependencies}));
  if(cache.has(identity))return cache.get(identity);
  const temp=mkdtempSync(join(tmpdir(),'minglewood-motion-recheck-'));
  try{
    const filmDir=join(temp,'films'),labels=join(temp,'expectations'),report=join(temp,'report.json');mkdirSync(filmDir);mkdirSync(labels);
    films.forEach((bytes,i)=>writeFileSync(join(filmDir,`context-${i}-film.json`),bytes));
    expectations.forEach((bytes,i)=>writeFileSync(join(labels,`context-${i}.json`),bytes));
    const windows=resolve('art/.venv/Scripts/python.exe'),python=existsSync(windows)?windows:resolve('art/.venv/bin/python');
    const result=spawnSync(python,[resolve(checker),filmDir,labels,'--require-complete','--report',report],{cwd:resolve('.'),encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
    if(result.error||!existsSync(report))throw Error(`Motion invariant recomputation failed: ${result.error?.message??result.stderr?.slice(-1800)??'missing report'}`);
    for(const [path,hash]of Object.entries(dependencies))if(sha256(readFileSync(resolve(path)))!==hash)throw Error('Motion checker/geometry changed during independent recomputation.');
    const checked=JSON.parse(readFileSync(report,'utf8'));
    if(result.status!==0&&checked.invariantsPassed)throw Error('Motion checker failed despite claiming successful invariants.');
    if(cache.size>=8)cache.delete(cache.keys().next().value!);
    cache.set(identity,checked);return checked;
  }finally{rmSync(temp,{recursive:true,force:true});}
}
