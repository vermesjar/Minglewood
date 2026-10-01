/** Derive coverage requirements from authenticated evidence, never receipt-declared contexts. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonical, sha256, verifySeatBundle, type FileProof } from './seat-verification';
import { verifySeatMotionVisual } from './seat-motion-visual-verification';
import { bodyContextsFromValidatedFilms, naturalBodyContexts, normalizedBodyContexts, wardrobeReceiptProblems, type BodyContext, type WardrobeRequest } from './seat-wardrobe-coverage';

export function deriveWardrobeRequest(bundlePath: string, contractPath: string): WardrobeRequest {
  const bundleCheck = verifySeatBundle(bundlePath, contractPath);
  if (!bundleCheck.ok) throw Error('Wardrobe inputs require verified settled evidence: ' + bundleCheck.problems.slice(0, 4).join('; '));
  const motionProblems = verifySeatMotionVisual(bundlePath, contractPath);
  if (motionProblems.length) throw Error('Wardrobe inputs require verified original movement: ' + motionProblems.slice(0, 4).join('; '));
  return wardrobeRequestFromVerifiedEvidence(bundlePath, contractPath);
}

/** Only the common gate calls this after its existing settled/movement validation. */
export function wardrobeRequestFromVerifiedEvidence(bundlePath: string, contractPath: string): WardrobeRequest {
  const bindings: Record<string, string> = {};
  const read = (name: string, path: string, expected?: string) => {
    const bytes = readFileSync(path), digest = sha256(bytes);
    if (expected !== undefined && digest !== expected) throw Error('Wardrobe source artifact changed: ' + name);
    bindings[name] = digest;
    return JSON.parse(bytes.toString());
  };
  const proof = (name: string, base: string, p: FileProof) => read(name, resolve(base, p.path), p.sha256);
  const bundle = read('settled-bundle', bundlePath);
  read('settled-contract', contractPath);
  const folder = resolve(dirname(bundlePath), 'motion-visual-review');
  const manifest = read('motion-manifest', resolve(folder, 'manifest.json'));
  const records = bundle.captures.flatMap((p: FileProof, index: number) => proof('settled-capture-' + index, dirname(bundlePath), p));
  const films = manifest.contexts.map((c: { id: string; film: FileProof }) => proof('film-' + c.id, folder, c.film));
  if (!records.length || films.length !== 16) throw Error('Incomplete source contexts for wardrobe sampling.');
  const models = new Set<string>([...records, ...films].map(r => canonical(r.model)));
  // Descriptive fields can differ between settled and motion recordings. Each
  // full model is bound, while the existing validators enforce mechanics/maps.
  [...models].sort().forEach((model, i) => { bindings['recorded-model-' + i] = sha256(model); });
  const settled: BodyContext[] = records.map((r: BodyContext) => {
    if (!r.pose?.startsWith('sit') || !r.legs) throw Error('Settled context omitted original pose/legs.');
    return { pose: r.pose, facing: r.facing, legs: r.legs };
  });
  bindings['requirement-derivation'] = sha256(readFileSync(resolve('scripts/lib/seat-wardrobe-verification.ts')));
  return { bindings, contexts: normalizedBodyContexts([...naturalBodyContexts(), ...settled, ...bodyContextsFromValidatedFilms(films)]) };
}

export function verifySeatWardrobe(bundlePath: string, contractPath: string): string[] {
  try {
    const required = wardrobeRequestFromVerifiedEvidence(bundlePath, contractPath);
    const receipt = JSON.parse(readFileSync(resolve(dirname(bundlePath), 'wardrobe-coverage.json'), 'utf8'));
    return wardrobeReceiptProblems(receipt, required);
  } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}
