/** Assemble existing judgments; this never performs or grants a visual review. */
import { sha256 } from './seat-verification';

export function combineLocalSeatReviews(manifestBytes: Buffer, proofs: Array<{ path: string; bytes: Buffer }>) {
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.version !== 1 || !['authored-seat-visual-review', 'seat-motion-visual-review'].includes(manifest.kind) ||
      typeof manifest.scope !== 'string' || !manifest.scope || !Array.isArray(manifest.contexts) || !manifest.contexts.length)
    throw Error('Unsupported or empty visual review manifest.');
  const contexts = new Map<string, any>(manifest.contexts.map((c: any) => [c.id, c]));
  if (contexts.size !== manifest.contexts.length || [...contexts.keys()].some(id => typeof id !== 'string' || !id))
    throw Error('Manifest context identities are invalid or duplicated.');
  if (proofs.length < 2 || new Set(proofs.map(p => p.path)).size !== proofs.length)
    throw Error('At least two distinct existing review files are required.');
  const digest = sha256(manifestBytes), reviewers = new Set<string>();
  const reviews = proofs.map(p => {
    const r = JSON.parse(p.bytes.toString('utf8'));
    if (typeof r.reviewer !== 'string' || !r.reviewer.trim() || reviewers.has(r.reviewer.trim()))
      throw Error('Distinct named reviewers are required.');
    reviewers.add(r.reviewer.trim());
    if (r.version !== 1 || r.manifestSha256 !== digest || r.scope !== manifest.scope)
      throw Error('A review belongs to different evidence or scope.');
    if (!Array.isArray(r.contexts) || r.contexts.length !== contexts.size ||
        new Set(r.contexts.map((c: any) => c.id)).size !== contexts.size)
      throw Error('Review context coverage is incomplete or duplicated.');
    for (const c of r.contexts) {
      const m = contexts.get(c.id);
      if (!m || c.verdict !== 'pass' || typeof c.reason !== 'string' || !c.reason.trim() ||
          !Array.isArray(c.issues) || c.issues.length || !Array.isArray(c.uncertainties) || c.uncertainties.length)
        throw Error(`${c.id}: unresolved or unapproved visual judgment.`);
      const risks = new Set((m.risks ?? []).map((a: any) => a.id));
      if (!Array.isArray(c.risks) || c.risks.length !== risks.size ||
          new Set(c.risks.map((a: any) => a.id)).size !== risks.size ||
          c.risks.some((a: any) => !risks.has(a.id) || a.verdict !== 'acceptable' || typeof a.reason !== 'string' || !a.reason.trim()))
        throw Error(`${c.id}: unresolved or omitted marked risk.`);
    }
    return r;
  });
  return {
    version: 1, scope: manifest.scope, manifestSha256: digest,
    contexts: reviews[0].contexts,
    provenance: { kind: 'independent-agent', reviewer: [...reviewers].join(' and '),
      reviews: proofs.map(p => ({ path: p.path, sha256: sha256(p.bytes) })) },
  };
}
