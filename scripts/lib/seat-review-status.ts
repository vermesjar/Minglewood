/** Read-only Studio evidence summary. Only the common verifier can grant acceptance. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { canonical, seatMechanicsDigest, sha256, verifySeatBundle } from './seat-verification';
import { verifySeatMotionVisual } from './seat-motion-visual-verification';
import { verifySeatVisual } from './seat-visual-verification';
import { verifySeatWardrobe } from './seat-wardrobe-verification';
import { seatPlacementProblems } from '../../src/shared/world/seatModels';

/** Recorded final screen pixels, including failed captures; never an approval signal. */
export function seatReviewFrame(folder: string, facing: string, look: number) {
  if (!['se', 'sw', 'ne', 'nw'].includes(facing) || !Number.isInteger(look) || look < 0 || look > 3) throw new Error('Unknown review direction or outfit.');
  const bundle = JSON.parse(readFileSync(resolve(folder, 'seat-verification.bundle.json'), 'utf8'));
  for (const p of bundle.captures) {
    const file = resolve(folder, p.path), rel = relative(folder, file);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Evidence path is outside this draft.');
    const bytes = readFileSync(file);
    if (sha256(bytes) !== p.sha256) throw new Error('Recorded capture bytes have changed.');
    const record = JSON.parse(bytes.toString('utf8')).find((r: any) => r.facing === facing && r.reviewLook === look && r.finalCanvas);
    if (record) {
      const c = record.finalCanvas;
      if (!Number.isInteger(c.rect?.width) || !Number.isInteger(c.rect?.height) || c.rect.width <= 0 || c.rect.height <= 0 || c.rect.width * c.rect.height > 4_000_000 || c.actual?.length !== c.rect.width * c.rect.height * 4) throw new Error('Malformed captured screen pixels.');
      return { facing, look, rect: c.rect, rgba: c.actual, capture: p.path };
    }
  }
  throw new Error('This direction and outfit have not been captured yet.');
}

export function seatReviewStatus(folder: string, draft: any) {
  const result = {
    checkedAt: new Date().toISOString(), draftSignature: JSON.stringify([draft.furniture, draft.views]),
    accepted: false, problems: [] as string[], failures: 0, unresolved: 0, reviewedPixels: 0,
    contexts: [] as Array<{ facing: string; cushion: number; look: number; captured: boolean; reviewed: boolean; unresolved: number }>,
    evidence: [] as Array<{ label: string; path: string }>, rendererReceipt: 'Missing',
    motion: { state: 'not-recorded', invariantsPassed: false, visualApproved: false, films: 0, problems: [] as string[] },
    wardrobe: { accepted: false, looks: 0, contexts: 0, problems: [] as string[] },
  };
  const safe = (file: string) => {
    const absolute = resolve(folder, file), rel = relative(folder, absolute);
    if (!rel || isAbsolute(rel) || rel.startsWith('..' + sep) || rel === '..' || resolve(folder, rel) !== absolute) throw new Error('Evidence path is outside this draft.');
    return absolute;
  };
  const link = (label: string, file: string) => {
    const path = relative(folder, safe(file)).split(sep).join('/');
    if (existsSync(safe(path))) result.evidence.push({ label, path });
  };
  const read = (file: string) => JSON.parse(readFileSync(safe(file), 'utf8'));
  const proof = (p: { path: string; sha256: string }) => {
    const bytes = readFileSync(safe(p.path));
    if (sha256(bytes) !== p.sha256) throw new Error(`Evidence file changed: ${p.path}`);
    return JSON.parse(bytes.toString('utf8'));
  };
  const model = draft.furniture?.seatModel?.model;
  for (const facing of ['se', 'sw', 'ne', 'nw']) for (let cushion = 0; cushion < (model?.sits?.length ?? 0); cushion++) for (let look = 0; look < 4; look++)
    result.contexts.push({ facing, cushion, look, captured: false, reviewed: false, unresolved: 0 });
  try {
    link('Verification contract', 'surface-review-contract.json');
    if (!existsSync(safe('seat-verification.bundle.json'))) throw new Error('Full seating evidence has not been assembled yet.');
    link('Complete evidence bundle', 'seat-verification.bundle.json');
    const bundle = read('seat-verification.bundle.json'), contract = read('surface-review-contract.json');
    if (bundle.version !== 1 || !Array.isArray(bundle.captures) || !Array.isArray(bundle.expectations)) throw new Error('This saved review uses an unsupported evidence format. A fresh in-game review is required.');
    const views = Object.fromEntries(Object.entries(draft.views ?? {}).map(([f, v]: [string, any]) => [f, Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'accepted'))]));
    const files = Object.fromEntries(Object.values(views).filter((v: any) => v.file).map((v: any) => [v.file, sha256(readFileSync(safe(v.file)))]));
    const source = { key: draft.key, furniture: Object.fromEntries(Object.entries(draft.furniture ?? {}).filter(([k]) => k !== 'seatModel')), views, files };
    if (!contract.draftSource || canonical(contract.draftSource) !== canonical(source)) result.problems.push('The drawings or furniture details have changed since this review, or the original drawing binding is missing.');
    const verdict = verifySeatBundle(safe('seat-verification.bundle.json'), safe('surface-review-contract.json'));
    result.problems.push(...verdict.problems);
    if (model?.parts && model?.sits) result.problems.push(...seatPlacementProblems(model));
    result.problems.push(...verifySeatVisual(safe('seat-verification.bundle.json'), safe('surface-review-contract.json')).map(p => `Visual quality review: ${p}`));
    link('Visual quality scope and marked regions', 'visual-review/manifest.json');
    link('Independent visual quality decisions', 'visual-review/decision.json');
    if (!model || seatMechanicsDigest(model) !== contract.mechanicsDigest || canonical(Object.fromEntries(Object.entries(model.surfaces ?? {}).map(([f, m]) => [f, sha256(canonical(m))]))) !== canonical(contract.surfaceDigests))
      result.problems.push('The current draft model differs from the reviewed model.');
    const expectations = bundle.expectations.map((p: any, i: number) => { link(`Independent pixel expectations ${i + 1}`, p.path); return proof(p); });
    for (const p of bundle.captures) {
      const records = proof(p); proof(p.receipt);
      link('Actual renderer capture', p.path); link('Capture-time renderer receipt', p.receipt.path);
      for (const r of records) {
        const context = result.contexts.find(c => c.facing === r.facing && c.cushion === r.cushion && c.look === r.reviewLook);
        if (!context) continue;
        context.captured = true;
        const expected = expectations.filter((e: any) => e.context?.facing === r.facing && e.context?.cushion === r.cushion && canonical(e.context?.look) === canonical(r.look));
        if (expected.length !== 1) continue;
        const e = expected[0], uncertain = (e.points ?? []).filter((p: any) => p.winner === 'uncertain').length;
        context.unresolved = Math.max(uncertain, e.coverage?.uncertain ?? 0, e.uncertainties?.length ?? 0);
        context.reviewed = true;
        result.reviewedPixels += (e.points ?? []).filter((p: any) => ['avatar', 'furniture'].includes(p.winner)).length;
      }
    }
    result.unresolved = result.contexts.reduce((n, c) => n + c.unresolved, 0);
    result.failures = result.problems.filter(p => /wrong winner|altered avatar|injected avatar|RGBA mismatch/.test(p)).length;
    result.rendererReceipt = verdict.ok ? 'Current capture receipts checked' : 'Full validation blocked; see capture receipt';
    if (draft.seatMotionReview?.result) {
      try {
        const motion = read(draft.seatMotionReview.result);
        link('Real entry, cushion-change and exit review', draft.seatMotionReview.result);
        result.motion.state = motion.state;
        const motionFolder = resolve(folder, draft.seatMotionReview.result, '..');
        for (const [path, hash] of Object.entries(motion.bindings ?? {})) if (sha256(readFileSync(path)) !== hash) throw new Error('Motion inputs changed since recording.');
        if (!motion.bindings || !Object.keys(motion.bindings).length) throw new Error('Motion source bindings are missing.');
        for (const p of motion.artifacts ?? []) {
          const file = resolve(motionFolder, p.path);
          if (sha256(readFileSync(file)) !== p.sha256) throw new Error('Recorded motion evidence changed.');
          if (p.path.endsWith('-film.json')) result.motion.films++;
        }
        result.motion.invariantsPassed = motion.state === 'INVARIANTS_PASSED_VISUAL_PENDING' && result.motion.films === 16;
        if (motion.error) result.motion.problems.push(motion.error);
        const motionProblems=verifySeatMotionVisual(safe('seat-verification.bundle.json'),safe('surface-review-contract.json'));
        result.motion.visualApproved=result.motion.invariantsPassed&&!motionProblems.length;
        if(result.motion.visualApproved) result.motion.state='ACCEPTED';
        else result.motion.problems.push(...motionProblems.map(p=>'Movement appearance review: '+p));
        link('Every recorded movement frame and review pages','motion-visual-review/manifest.json');
        link('Independent movement appearance decisions','motion-visual-review/decision.json');
      } catch (error) { result.motion.state = 'stale-or-invalid'; result.motion.problems.push(error instanceof Error ? error.message : String(error)); }
    } else result.motion.problems.push('Entry, cushion changes and exit have not yet completed their recorded review.');
    result.problems.push(...result.motion.problems);
    if (verdict.ok && result.motion.visualApproved) {
      result.wardrobe.problems = verifySeatWardrobe(safe('seat-verification.bundle.json'), safe('surface-review-contract.json'));
      result.wardrobe.accepted = !result.wardrobe.problems.length;
      if (result.wardrobe.accepted) {
        const receipt = read('wardrobe-coverage.json');
        result.wardrobe.looks = receipt.looks;
        result.wardrobe.contexts = receipt.contexts.length;
      }
    } else result.wardrobe.problems.push('Current settled and movement evidence is required before wardrobe coverage can be accepted.');
    link('Original-body clothing coverage', 'wardrobe-coverage.json');
    result.problems.push(...result.wardrobe.problems.map(p => 'Clothing coverage: ' + p));
    result.accepted = verdict.ok && !result.problems.length && result.motion.visualApproved && result.wardrobe.accepted;
  } catch (error) { result.problems.push(error instanceof Error ? error.message : String(error)); }
  return result;
}
