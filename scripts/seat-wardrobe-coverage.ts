/** Build a numerical prerequisite; never publish or grant visual approval. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deriveWardrobeRequest } from './lib/seat-wardrobe-verification';
import { runWardrobeCoverage, wardrobeReceiptProblems } from './lib/seat-wardrobe-coverage';

const [bundle, contract, output, ...flags] = process.argv.slice(2);
if (!bundle || !contract || !output || flags.some(f => f !== '--request-only')) throw Error('Usage: seat-wardrobe-coverage.ts BUNDLE CONTRACT NEW_OUTPUT [--request-only]');
const request = deriveWardrobeRequest(resolve(bundle), resolve(contract));
mkdirSync(dirname(resolve(output)), { recursive: true });
if (flags.includes('--request-only')) {
  writeFileSync(output, JSON.stringify(request, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ contexts: request.contexts.length, output, visualApproval: false }));
} else {
  const receipt = runWardrobeCoverage(request, { cacheDir: resolve('art/review/wardrobe-context-cache'), onContext: (n, total) => console.error(`Original-body coverage ${n}/${total}`) });
  const problems = wardrobeReceiptProblems(receipt, request);
  writeFileSync(output, JSON.stringify(receipt, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ok: receipt.ok && !problems.length, contexts: receipt.contexts.length, problems, output, visualApproval: false }));
  if (!receipt.ok || problems.length) process.exitCode = 1;
}
