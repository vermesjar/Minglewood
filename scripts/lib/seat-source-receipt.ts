/** Pin the renderer actually used by an audit, including body art and source inventory. */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
export function rendererSources(root=process.cwd()):Record<string,string> {
  const paths:string[]=[];
  const walk=(dir:string)=>{
    for(const entry of readdirSync(resolve(root,dir),{withFileTypes:true})){
      const path=`${dir}/${entry.name}`;
      if(entry.isDirectory())walk(path);
      else if(!entry.name.includes('.test.')&&/\.(ts|json)$/.test(entry.name))paths.push(path);
    }
  };
  walk('src/client/engine');walk('src/shared');
  for(const path of ['src/client/lab/seatEvidence.ts','src/client/lab/seatShots.ts','src/client/lab/seatCanvasCheck.ts',
    'scripts/lib/seat-review-context.ts','scripts/lib/seat-source-receipt.ts','scripts/lib/seat-verification.ts',
    'scripts/seat-verify-bundle.ts','tests/fixtures/seating-cardigan.json'])
    if(existsSync(resolve(root,path)))paths.push(path);
  return Object.fromEntries(paths.sort().map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')]));
}
