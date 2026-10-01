import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_FACINGS, SEAT_LOOKS } from '@shared/world/seatModels';
import { drawingPrint } from '@shared/world/seatFigure';
import { canonical, sha256, verifySeatBundle, verifySeatEvidence, seatMechanicsDigest } from '../../../../scripts/lib/seat-verification';
import { reviewedFigureContext } from '../../../../scripts/lib/seat-review-context';
import { rendererSources } from '../../../../scripts/lib/seat-source-receipt';
import { requireSeatPublicationEvidence } from '../../../../scripts/lib/seat-publication';
import { seatReviewStatus, seatReviewFrame } from '../../../../scripts/lib/seat-review-status';

function fixture() {
  const looks = [...SEAT_LOOKS, JSON.parse(readFileSync('tests/fixtures/seating-cardigan.json', 'utf8'))].map(look => ({ ...look, pet: 'pet.none' }));
  const parts = [{ part: 'seat', u: [0, 1], v: [0, 1], z: [0, 10] }], art = { w: 1, h: 1, ax: 0, ay: 0, rgba: [30, 40, 50, 255] };
  const modelParts = JSON.stringify(parts), drawing = drawingPrint(1, 1, art.rgba);
  const map = { version: 1, width: 1, height: 1, drawing, modelParts, labels: [1] };
  const surfaces = Object.fromEntries(MODEL_FACINGS.map(f => [f, map]));
  const model = { size: [1, 1], parts, sits: [[.5, .5, 10]], compiler: { version: 2, source: 'source' }, surfaces };
  const contract = { version: 1, key: 'testseat', mechanicsDigest: seatMechanicsDigest(model), modelParts, compiler: model.compiler, sits: model.sits,
    resolvedViews: Object.fromEntries(MODEL_FACINGS.map(f => [f, { width: 1, height: 1, anchor: [0, 0], drawing }])),
    surfaceDigests: Object.fromEntries(MODEL_FACINGS.map(f => [f, sha256(canonical(map))])) };
  const records = MODEL_FACINGS.flatMap(facing => looks.map((look, reviewLook) => ({
    id: `test-${facing}`, object: { sprite: 'testseat' }, facing, reviewLook, cushion: 0, pose: 'sit', look,
    feet: [0, 0] as [number, number], legs: {}, height: 10, art, model,
    figure: { w: 1, h: 1, ax: 0, ay: 0, rgba: [200, 100, 50, 255], actual: [200, 100, 50, 255], owner: [20] },
    canvasPlacement: { art: { x: 0, y: 0, pixelScale: 1 }, figure: { x: 0, y: 0, pixelScale: 1 }, order: 0 }, canvasSize: { width: 1, height: 1 },
    finalCanvas: { rect: { x: 0, y: 0, width: 1, height: 1 }, owner: [1], actual: [200, 100, 50, 255], expected: [200, 100, 50, 255], passed: true },
  })));
  const expectations = records.map(r => ({ context: { key: 'testseat', facing: r.facing, cushion: 0, pose: r.pose,
    look: r.look, modelSource: 'source', figureContext: reviewedFigureContext(r) },
    points: [{ x: 0, y: 0, winner: 'avatar', source: 'source' }], coverage: { uncertain: 0 } }));
  return JSON.parse(JSON.stringify({ contract, records, expectations, looks }));
}

describe('complete independent seating verification', () => {
  it('Studio reports complete numerical evidence but blocks rigid seats without visual review and changed models despite accepted flags', () => {
    const root = mkdtempSync(join(tmpdir(), 'seat-studio-status-'));
    try {
      const f = fixture(), sources = rendererSources();
      const save = (name: string, value: unknown) => { const bytes = JSON.stringify(value); writeFileSync(join(root, name), bytes); return { path: name, sha256: sha256(bytes) }; };
      writeFileSync(join(root, 'source.png'), 'original drawing bytes');
      f.contract.draftSource = { key: 'testseat', furniture: {}, views: { se: { file: 'source.png' } }, files: { 'source.png': sha256('original drawing bytes') } };
      const contract = save('surface-review-contract.json', f.contract), capture = save('capture.json', f.records);
      const receipt = save('receipt.json', { unchanged: true, rendererSources: sources, captures: { 'capture.json': capture.sha256 } });
      const expectations = f.expectations.map((e: unknown, i: number) => save(`expected-${i}.json`, e));
      save('seat-verification.bundle.json', { version: 1, contract, rendererSources: sources, captures: [{ ...capture, receipt }], expectations });
      const draft = { key: 'testseat', furniture: { seatModel: { model: f.records[0].model } }, views: { se: { file: 'source.png' } }, independentSeatReview: { state: 'EVIDENCE_ACCEPTED' } };
      const status = seatReviewStatus(root, draft);
      expect(status.accepted).toBe(false);
      expect(status.problems.join()).toContain('Visual quality review:');
      expect(status.rendererReceipt).toBe('Current capture receipts checked');
      expect(status.contexts).toHaveLength(16);
      expect(status.contexts.every(c => c.captured && c.reviewed && !c.unresolved)).toBe(true);
      expect(status.reviewedPixels).toBe(16);
      expect(status.evidence.some(e => e.path === 'receipt.json')).toBe(true);
      expect(seatReviewFrame(root, 'ne', 3).rgba).toEqual([200, 100, 50, 255]);
      expect(() => seatReviewFrame(root, 'ne', 7)).toThrow('Unknown review');
      const artChanged = { ...draft, views: { se: { nudge: [1, 0] } } };
      expect(seatReviewStatus(root, artChanged).problems.join()).toContain('drawings or furniture details have changed');
      writeFileSync(join(root, 'source.png'), 'changed drawing bytes');
      expect(seatReviewStatus(root, draft).problems.join()).toContain('drawings or furniture details have changed');
      writeFileSync(join(root, 'source.png'), 'original drawing bytes');
      draft.furniture.seatModel.model.size[0] = 2;
      const stale = seatReviewStatus(root, draft);
      expect(stale.accepted).toBe(false);
      expect(stale.problems.join()).toContain('current draft model differs');
      save('expected-0.json', {});
      expect(seatReviewStatus(root, draft).accepted).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('Studio never grants a status-only approval without evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'seat-studio-missing-'));
    try {
      const status = seatReviewStatus(root, { furniture: { seatModel: { model: fixture().records[0].model } }, independentSeatReview: { state: 'EVIDENCE_ACCEPTED' } });
      expect(status.accepted).toBe(false);
      expect(status.contexts.every(c => !c.captured && !c.reviewed)).toBe(true);
      expect(status.problems.join()).toContain('not been assembled');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('accepts all sixteen exact contexts with complete independent overlap and final-canvas pixels', () => {
    const f = fixture();
    expect(verifySeatEvidence(f.contract, f.records, f.expectations, f.looks)).toEqual([]);
  });
  it.each([
    ['missing mechanics binding', (f: ReturnType<typeof fixture>) => { delete f.contract.mechanicsDigest; }, 'Incomplete verification contract'],
    ['changed footprint', (f: ReturnType<typeof fixture>) => { f.records[0].model.size[0] = 2; }, 'complete model mechanics'],
    ['changed per-view placement', (f: ReturnType<typeof fixture>) => { f.records[0].model.views = { ne: [[.1, .2]] }; }, 'complete model mechanics'],
    ['changed traced occlusion', (f: ReturnType<typeof fixture>) => { f.records[0].model.over = { ne: [[[0, 0], [1, 0], [1, 1]]] }; }, 'complete model mechanics'],
    ['changed drawing bindings', (f: ReturnType<typeof fixture>) => { f.records[0].model.drawings = { ne: '87654321' }; }, 'complete model mechanics'],
    ['new authored geometry', (f: ReturnType<typeof fixture>) => { f.records[0].model.authoredGeometry = { depth: [1.25] }; }, 'complete model mechanics'],
    ['unknown future physical field', (f: ReturnType<typeof fixture>) => { f.records[0].model.futurePhysicalExtension = { value: 1 }; }, 'complete model mechanics'],
    ['missing case', (f: ReturnType<typeof fixture>) => f.records.pop(), 'missing required capture'],
    ['uncertain winner', (f: ReturnType<typeof fixture>) => { f.expectations[0].points[0].winner = 'uncertain'; }, 'uncertain'],
    ['unlabeled overlap despite claimed count', (f: ReturnType<typeof fixture>) => { f.expectations[0].points = []; f.expectations[0].coverage.labeled = 100; }, 'unlabeled overlap'],
    ['wrong actual winner', (f: ReturnType<typeof fixture>) => { f.records[0].figure.actual[3] = 0; }, 'wrong winner'],
    ['changed source art', (f: ReturnType<typeof fixture>) => { f.records[0].art.rgba[0]++; }, 'stale source drawing'],
    ['changed surface label', (f: ReturnType<typeof fixture>) => { f.records[0].model.surfaces.se.labels[0] = 2; }, 'changed surface labels'],
    ['lying canvas passed flag', (f: ReturnType<typeof fixture>) => { f.records[0].finalCanvas.actual[0]++; }, 'final-canvas RGBA mismatch'],
    ['canvas failure', (f: ReturnType<typeof fixture>) => { f.records[0].finalCanvas.passed = false; }, 'did not pass'],
    ['erased owner coverage', (f: ReturnType<typeof fixture>) => { f.records[0].finalCanvas.owner[0] = -1; }, 'owner coverage'],
    ['expected copied from bad actual', (f: ReturnType<typeof fixture>) => { f.records[0].finalCanvas.actual[0]++; f.records[0].finalCanvas.expected[0]++; }, 'independent recomposition'],
    ['clipped source', (f: ReturnType<typeof fixture>) => { f.records[0].canvasSize.width = 0; }, 'device placement'],
    ['changed placement', (f: ReturnType<typeof fixture>) => { f.records[0].feet[0]++; }, 'expectation context'],
  ])('rejects %s', (_label, mutate, message) => {
    const f = fixture(); mutate(f);
    expect(verifySeatEvidence(f.contract, f.records, f.expectations, f.looks).some(p => p.includes(message))).toBe(true);
  });

  it('rejects hidden body pixels outside furniture and injected pixels without needing independent overlap labels', () => {
    for (const injected of [false, true]) {
      const f = fixture(), r = f.records[0];
      r.figure.w = 2;
      r.figure.rgba.push(...(injected ? [0, 0, 0, 0] : [200, 100, 50, 255]));
      r.figure.actual.push(...(injected ? [200, 100, 50, 255] : [0, 0, 0, 0]));
      r.figure.owner.push(20);
      f.expectations[0].context.figureContext = reviewedFigureContext(r);
      expect(verifySeatEvidence(f.contract, f.records, f.expectations, f.looks).some(p => p.includes(injected ? 'injected avatar pixel' : 'outside furniture'))).toBe(true);
    }
  });

  it('pins evidence bytes, capture-time receipt and current renderer source inventory', () => {
    const root = mkdtempSync(join(tmpdir(), 'seat-verification-'));
    try {
      const f = fixture(), sources = rendererSources();
      const save = (name: string, value: unknown) => { const bytes = JSON.stringify(value); writeFileSync(join(root, name), bytes); return { path: name, sha256: sha256(bytes) }; };
      const contract = save('contract.json', f.contract), capture = save('capture.json', f.records);
      const receipt = save('capture-receipt.json', { unchanged: true, rendererSources: sources, captures: { 'capture.json': capture.sha256 } });
      const expectations = f.expectations.map((e: unknown, i: number) => save(`expected-${i}.json`, e));
      const bundle = { version: 1, contract, rendererSources: sources, captures: [{ ...capture, receipt }], expectations };
      save('bundle.json', bundle);
      expect(verifySeatBundle(join(root, 'bundle.json'), join(root, 'contract.json')).ok).toBe(true);
      const proof = { bundle: join(root, 'bundle.json'), contract: join(root, 'contract.json') };
      expect(() => requireSeatPublicationEvidence('testseat', f.records[0].model, undefined, proof)).toThrow('independent visual quality review required');
      const relabeled = structuredClone(f.records[0].model);
      relabeled.surfaces.se.labels[0] = 2;
      expect(() => requireSeatPublicationEvidence('testseat', relabeled, undefined, proof)).toThrow('does not match');
      for (const mutation of [
        { size: [2, 1] }, { views: { ne: [[.1, .2]] } }, { over: { ne: [[[0, 0], [1, 0], [1, 1]]] } },
        { drawings: { ne: '87654321' } }, { authoredGeometry: { depth: [1.25] } }, { futurePhysicalExtension: { value: 1 } },
      ]) expect(() => requireSeatPublicationEvidence('testseat', { ...f.records[0].model, ...mutation }, undefined, proof)).toThrow('does not match');
      expect(() => requireSeatPublicationEvidence('testseat', { ...f.records[0].model, note: 'description only' }, undefined, proof)).toThrow('independent visual quality review required');
      expect(() => requireSeatPublicationEvidence('testseat', f.records[0].model)).toThrow('verification bundle');
      bundle.rendererSources = {};
      save('bundle.json', bundle);
      expect(verifySeatBundle(join(root, 'bundle.json'), join(root, 'contract.json')).problems.join()).toContain('Renderer sources changed');
      bundle.rendererSources = sources;
      save('bundle.json', bundle);
      writeFileSync(join(root, 'expected-0.json'), '{}');
      expect(verifySeatBundle(join(root, 'bundle.json'), join(root, 'contract.json')).problems.join()).toContain('Evidence file changed');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('common publication gate permits unchanged legacy rebuilds but no unverified new or changed seating', () => {
    const f = fixture(), legacy = structuredClone(f.records[0].model);
    delete legacy.surfaces;
    expect(() => requireSeatPublicationEvidence('testseat', legacy, structuredClone(legacy))).not.toThrow();
    expect(() => requireSeatPublicationEvidence('newseat', legacy)).toThrow('new or changed seating');
    const changed = structuredClone(legacy);
    changed.parts[0].z[1]++;
    expect(() => requireSeatPublicationEvidence('testseat', changed, legacy)).toThrow('new or changed seating');
    const curved = { ...legacy, authoredGeometry: { profile: 'future' } };
    expect(() => requireSeatPublicationEvidence('testseat', curved, legacy)).toThrow('new or changed seating');
    expect(() => requireSeatPublicationEvidence('testseat', curved, structuredClone(curved))).toThrow('new or changed seating');
  });
});
