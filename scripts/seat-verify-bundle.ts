/** Bind already independently authored expectations to captures, then verify complete context/pixel coverage. */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { rendererSources } from './lib/seat-source-receipt';
import { sha256, verifySeatBundle, seatMechanicsDigest, type FileProof, type VerificationBundle } from './lib/seat-verification';
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const contract = arg('contract'), bundleFile = arg('bundle');
if (!contract || !bundleFile) throw new Error('Usage: --contract FILE --bundle FILE [--create --captures FILE,... --expectations DIRECTORY,...]');
if (process.argv.includes('--create')) {
  const folder = dirname(resolve(bundleFile));
  const proof = (file: string): FileProof => ({ path: relative(folder, resolve(file)).replace(/\\/g, '/'), sha256: sha256(readFileSync(file)) });
  const files = (path: string): string[] => statSync(path).isDirectory() ? readdirSync(path).flatMap(name => files(resolve(path, name))) : [path];
  const expectationFiles = (arg('expectations') ?? '').split(',').filter(Boolean).flatMap(files).filter(file => file.endsWith('.json') &&
    Array.isArray(JSON.parse(readFileSync(file, 'utf8')).points));
  const bundle: VerificationBundle = { version: 1, contract: proof(contract), rendererSources: rendererSources(),
    captures: (arg('captures') ?? '').split(',').filter(Boolean).map(file => ({ ...proof(file), receipt: proof(resolve(dirname(file), 'capture-receipt.json')) })),
    expectations: expectationFiles.map(proof) };
  writeFileSync(bundleFile, JSON.stringify(bundle, null, 2));
}
const result = verifySeatBundle(bundleFile, contract);
// Design Lab supplies its current staged model as well as historical captures.
const modelFile = arg('model');
if (modelFile) {
  const staged = JSON.parse(readFileSync(modelFile, 'utf8'));
  const current = staged.model ?? staged;
  const binding = JSON.parse(readFileSync(contract, 'utf8'));
  if (binding.mechanicsDigest !== seatMechanicsDigest(current)) {
    result.ok = false;
    result.problems.push('Current staged model mechanics do not match the independently verified contract.');
  }
}
console.log(JSON.stringify({ ...result, scope: 'All opaque overlap pixels in four facings, four review outfits and every cushion, with exact source/context and final-canvas evidence.' }, null, 2));
process.exitCode = result.ok ? 0 : 1;
