import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, sha256 } from '../../../scripts/lib/seat-verification';
import { requireWardrobeAttestation } from '../../../scripts/lib/seat-wardrobe-attestation';
import { bodyContextsFromValidatedFilms, normalizedBodyContexts, runWardrobeCoverage, wardrobeMatrix, wardrobeReceiptProblems, type WardrobeRequest } from '../../../scripts/lib/seat-wardrobe-coverage';

const cacheDir = mkdtempSync(join(tmpdir(), 'minglewood-wardrobe-test-'));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));
const required: WardrobeRequest = { bindings: { model: 'a'.repeat(64), film: 'b'.repeat(64) }, contexts: [{ pose: 'stand', facing: 'se' }] };

describe('original-body wardrobe coverage prerequisite', () => {
  it('evaluates actual catalog pixels, reuses identical context computation, and rejects stale or incomplete evidence', () => {
    const receipt = runWardrobeCoverage(required, { cacheDir });
    expect(receipt.ok).toBe(true);
    expect(receipt.looks).toBe(wardrobeMatrix().length);
    expect(receipt.contexts[0].opaquePixels).toBeGreaterThan(100_000);
    expect(receipt.visualApproval).toBe(false);
    expect(receipt.wardrobeOverlapApproval).toBe(false);
    expect(wardrobeReceiptProblems(receipt, required)).toEqual([]);
    const forged = structuredClone(receipt);
    forged.contexts[0].opaquePixels = 1;
    forged.contexts[0].originalBodyDigest = '0'.repeat(64);
    expect(wardrobeReceiptProblems(forged, required).join(' ')).toMatch(/attestation/);
    const next = { ...required, bindings: { ...required.bindings, film: 'c'.repeat(64) } };
    const reused = runWardrobeCoverage(next, { cacheDir });
    expect(reused.contexts).toEqual(receipt.contexts);
    expect(reused.requestDigest).not.toBe(receipt.requestDigest);
    expect(readdirSync(cacheDir)).toHaveLength(1);
    expect(wardrobeReceiptProblems(receipt, next)).not.toEqual([]);
    for (const mutation of [
      (r: typeof receipt) => { r.sources['src/shared/avatar.ts'] = '0'.repeat(64); },
      (r: typeof receipt) => { r.contexts = []; },
      (r: typeof receipt) => { r.contexts.push(r.contexts[0]); },
      (r: typeof receipt) => { r.contexts[0].unresolvedPixels = 1; },
      (r: typeof receipt) => { r.contexts[0].excludedLooks++; },
      (r: typeof receipt) => { r.matrixDigest = '0'.repeat(64); },
      (r: typeof receipt) => { r.stableSources = false; },
    ]) {
      const changed = structuredClone(receipt); mutation(changed);
      expect(wardrobeReceiptProblems(changed, required)).not.toEqual([]);
    }
    const path = join(cacheDir, readdirSync(cacheDir)[0]), entry = JSON.parse(readFileSync(path, 'utf8'));
    entry.result.opaquePixels++; writeFileSync(path, JSON.stringify(entry));
    expect(() => runWardrobeCoverage(required, { cacheDir })).toThrow('Corrupt');
    // Rehashing a forged cache cannot launder it through the trusted runner.
    entry.digest = sha256(canonical(entry.result)); writeFileSync(path, JSON.stringify(entry));
    expect(() => runWardrobeCoverage(required, { cacheDir })).toThrow(/attestation/);
    const { attestation, ...payload } = receipt;
    expect(() => requireWardrobeAttestation('context-v1', payload, attestation)).toThrow(/attestation/);
    expect(() => requireWardrobeAttestation('aggregate-v1', payload, undefined)).toThrow(/Unauthenticated/);
  }, 120_000);

  it('extracts exact recorded legs, rejects missing observations, and never rounds distinct geometry', () => {
    const legs = { reach: .36, rise: 0, drop: 11, toe: .03, hang: .5 };
    const state = { pose: 'sit' as const, facing: 'ne' as const, legs, poseRace: false };
    const contexts = bodyContextsFromValidatedFilms([{ frames: [{ state }, { state: { ...state, legs: { ...legs, hang: .500001 } } }] }]);
    expect(contexts).toHaveLength(2);
    expect(normalizedBodyContexts([...contexts, contexts[0]])).toHaveLength(2);
    expect(() => bodyContextsFromValidatedFilms([{ frames: [{ state: { ...state, legs: undefined } }] }])).toThrow('omitted');
    expect(() => bodyContextsFromValidatedFilms([{ frames: [{ state: { ...state, poseRace: true } }] }])).toThrow('Unverified');
    expect(() => normalizedBodyContexts([{ ...state, legs: { ...legs, drop: NaN } }])).toThrow('Malformed');
  });
});
