import { describe, expect, it } from 'vitest';
import { combineLocalSeatReviews } from '../../../scripts/lib/seat-local-review-decision';
import { sha256 } from '../../../scripts/lib/seat-verification';

const bytes = (v: unknown) => Buffer.from(JSON.stringify(v));
const manifest = bytes({ version: 1, kind: 'authored-seat-visual-review', scope: 'fixture scope',
  contexts: [{ id: 'se-L0-C0', risks: [{ id: 'contact' }] }] });
const review = (reviewer: string) => ({ version: 1, reviewer, manifestSha256: sha256(manifest), scope: 'fixture scope',
  contexts: [{ id: 'se-L0-C0', verdict: 'pass', reason: 'Personal inspection recorded.', issues: [], uncertainties: [],
    risks: [{ id: 'contact', verdict: 'acceptable', reason: 'Continuous support at the marked edge.' }] }] });
const combine = (a: any, b: any) => combineLocalSeatReviews(manifest, [{ path: 'a.json', bytes: bytes(a) }, { path: 'b.json', bytes: bytes(b) }]);

describe('combining existing local seat judgments', () => {
  it('retains original judgments, exact hashes and both real identities', () => {
    const a = review('root'), b = review('adversarial'), result = combine(a, b);
    expect(result.contexts).toEqual(a.contexts);
    expect(result.provenance.reviewer).toBe('root and adversarial');
    expect(result.provenance.reviews[1].sha256).toBe(sha256(bytes(b)));
  });
  it('cannot launder an independent rejection or uncertainty into a pass', () => {
    const a = review('root'), b = review('adversarial');
    b.contexts[0].verdict = 'fail'; expect(() => combine(a, b)).toThrow('unapproved');
    b.contexts[0].verdict = 'pass'; (b.contexts[0].uncertainties as string[]).push('Hidden hip');
    expect(() => combine(a, b)).toThrow('unapproved');
  });
  it('rejects copied identity, stale evidence and duplicate contexts', () => {
    expect(() => combine(review('root'), review(' root '))).toThrow('Distinct');
    const b = review('adversarial'); b.manifestSha256 = 'old';
    expect(() => combine(review('root'), b)).toThrow('different evidence');
    b.manifestSha256 = sha256(manifest); b.contexts.push(b.contexts[0]);
    expect(() => combine(review('root'), b)).toThrow('coverage');
  });
  it('requires the marked contact risk from each reviewer', () => {
    const b = review('adversarial'); b.contexts[0].risks = [];
    expect(() => combine(review('root'), b)).toThrow('omitted marked risk');
  });
});
