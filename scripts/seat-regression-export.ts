/** Compact independently approved expectations into repeatable renderer regressions.
 * Never derives a golden winner from the actual renderer mask.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonical, sha256, verifySeatBundle, type VerificationBundle } from './lib/seat-verification';
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const contractFile = arg('contract'), bundleFile = arg('bundle'), out = arg('out');
if (!contractFile || !bundleFile || !out) throw new Error('Usage: --contract FILE --bundle FILE --out FIXTURE.json');
const checked = verifySeatBundle(bundleFile, contractFile);
if (!checked.ok) throw new Error(checked.problems.join('\n'));
const bundle: VerificationBundle = JSON.parse(readFileSync(bundleFile, 'utf8'));
const contract = JSON.parse(readFileSync(contractFile, 'utf8'));
const load = (p: { path: string; sha256: string }) => {
  const bytes = readFileSync(resolve(dirname(bundleFile), p.path));
  if (sha256(bytes) !== p.sha256) throw new Error(`Evidence changed during export: ${p.path}`);
  return JSON.parse(bytes.toString('utf8'));
};
const reviews = bundle.expectations.map(p => ({ review: load(p), sha256: p.sha256 }));
const cases = bundle.captures.flatMap(load).map(r => {
  const matches = reviews.filter(e => e.review.context.facing === r.facing && e.review.context.cushion === r.cushion &&
    canonical(e.review.context.look) === canonical(r.look));
  if (matches.length !== 1) throw new Error('Ambiguous independent regression context');
  const { review, sha256: expectationSha256 } = matches[0];
  const domain = Buffer.alloc(r.art.w * r.art.h);
  for (const p of review.points) domain[p.y * r.art.w + p.x] = p.winner === 'avatar' ? 1 : 2;
  return { context: review.context, drawing: contract.resolvedViews[r.facing], expectationSha256,
    width: r.art.w, height: r.art.h, overlapCount: review.points.length, winnersBase64: domain.toString('base64') };
});
writeFileSync(out, JSON.stringify({ version: 1, key: contract.key, provenance: 'Independent expectations from verified actual WorldView evidence',
  bundleSha256: sha256(readFileSync(bundleFile)), cases }, null, 2) + '\n');
console.log(`${contract.key}: ${cases.length} independent contexts exported to ${out}`);
