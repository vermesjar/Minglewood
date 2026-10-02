/** Usage: FOLDER REVIEW_A.json REVIEW_B.json [additional reviews]. Refuses overwrites. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { combineLocalSeatReviews } from './lib/seat-local-review-decision';

const [folderArg, ...reviewPaths] = process.argv.slice(2);
if (!folderArg || reviewPaths.length < 2) throw Error('Usage: seat-combine-local-reviews.ts FOLDER REVIEW_A.json REVIEW_B.json');
const folder = resolve(folderArg);
const proofs = reviewPaths.map(path => {
  const full = resolve(folder, path), rel = relative(folder, full);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw Error('Review must be inside its evidence folder.');
  return { path: rel.split(sep).join('/'), bytes: readFileSync(full) };
});
const decision = combineLocalSeatReviews(readFileSync(resolve(folder, 'manifest.json')), proofs);
writeFileSync(resolve(folder, 'decision.json'), JSON.stringify(decision, null, 2) + '\n', { flag: 'wx' });
console.log('Combined existing reviews. Publication still requires the full common evidence gate.');
