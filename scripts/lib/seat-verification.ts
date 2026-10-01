/** Complete independent overlap evidence. Never derives expected winners from the renderer mask. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { MODEL_FACINGS, SEAT_LOOKS } from '../../src/shared/world/seatModels';
import { drawingPrint } from '../../src/shared/world/seatFigure';
import { reviewedFigureContext } from './seat-review-context';
import { rendererSources } from './seat-source-receipt';

export const canonical = (value: any): string => JSON.stringify(sort(value));
function sort(value: any): any {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
/** All mechanics, including future fields, except separately bound surfaces and descriptive metadata. */
export const seatMechanicsDigest = (model: unknown): string => {
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new Error('Malformed seating model mechanics.');
  const descriptive = new Set(['fitted', 'reviewed', 'note', 'surfaces']);
  return sha256(canonical(Object.fromEntries(Object.entries(model).filter(([key]) => !descriptive.has(key)))));
};
export interface FileProof { path: string; sha256: string }
export interface VerificationBundle {
  version: 1;
  contract: FileProof;
  rendererSources: Record<string, string>;
  captures: Array<FileProof & { receipt: FileProof }>;
  expectations: FileProof[];
}
const same = (a: any, b: any) => canonical(a) === canonical(b);

/** Recompose from original pixels and independent winners, never recorded mask/owner/expected. */
function canvasProblems(group: any[], masks: Map<any, Uint8Array>): string[] {
  const first = group[0], c = group.find(r => r.finalCanvas)?.finalCanvas;
  if (!c || !c.rect || !Number.isInteger(c.rect.width) || !Number.isInteger(c.rect.height) || c.rect.width <= 0 || c.rect.height <= 0)
    return ['missing final-canvas pixel evidence'];
  const size = first.canvasSize, p = first.canvasPlacement;
  if (!size || !p || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0)
    return ['missing final-canvas device placement'];
  const layers = [{ ...p.art, width: first.art.w, height: first.art.h, rgba: first.art.rgba, mask: undefined as Uint8Array | undefined }];
  for (const r of [...group].sort((a, b) => a.canvasPlacement?.order - b.canvasPlacement?.order)) {
    const placed = r.canvasPlacement, f = r.figure;
    if (!placed || !same(r.canvasSize, size) || !same(placed.art, p.art) || !Number.isFinite(placed.order) || !masks.has(r))
      return ['missing independent frame placement or expectations'];
    if (Math.abs(placed.figure.pixelScale - placed.art.pixelScale) > 1e-8 ||
        Math.abs(placed.figure.x - (placed.art.x + (r.feet[0] - f.ax) * placed.art.pixelScale)) > 1e-7 ||
        Math.abs(placed.figure.y - (placed.art.y + (r.feet[1] - f.ay) * placed.art.pixelScale)) > 1e-7)
      return ['figure device placement does not match its reviewed anchor'];
    layers.push({ ...placed.figure, width: f.w, height: f.h, rgba: f.rgba, mask: masks.get(r) });
  }
  if (layers.some(l => ![l.x, l.y, l.pixelScale].every(Number.isFinite) || l.pixelScale <= 0 || l.x < 0 || l.y < 0 ||
      l.x + l.width * l.pixelScale > size.width || l.y + l.height * l.pixelScale > size.height)) return ['required source pixels are clipped outside the final canvas'];
  const left = Math.floor(Math.min(...layers.map(l => l.x))), top = Math.floor(Math.min(...layers.map(l => l.y)));
  const right = Math.ceil(Math.max(...layers.map(l => l.x + l.width * l.pixelScale))), bottom = Math.ceil(Math.max(...layers.map(l => l.y + l.height * l.pixelScale)));
  if (!same(c.rect, { x: left, y: top, width: right - left, height: bottom - top })) return ['final-canvas crop omits required source coverage'];
  const n = c.rect.width * c.rect.height;
  if (!Array.isArray(c.owner) || c.owner.length !== n || !Array.isArray(c.actual) || !Array.isArray(c.expected) || c.actual.length !== n * 4 || c.expected.length !== n * 4)
    return ['malformed final-canvas pixel evidence'];
  const expected = new Uint8Array(n * 4), owner = new Int16Array(n).fill(-1);
  let translucent = false;
  layers.forEach((layer, index) => {
    for (let y = 0; y < c.rect.height; y++) for (let x = 0; x < c.rect.width; x++) {
      const sx = Math.floor((left + x + .5 - layer.x) / layer.pixelScale), sy = Math.floor((top + y + .5 - layer.y) / layer.pixelScale);
      if (sx < 0 || sy < 0 || sx >= layer.width || sy >= layer.height) continue;
      const source = sy * layer.width + sx, i = y * c.rect.width + x, alpha = layer.rgba[source * 4 + 3];
      if (!alpha || layer.mask?.[source]) continue;
      if (alpha !== 255) { translucent = true; continue; }
      owner[i] = index;
      for (let ch = 0; ch < 4; ch++) expected[i * 4 + ch] = layer.rgba[source * 4 + ch];
    }
  });
  if (translucent) return ['translucent source pixels require explicit background compositing evidence'];
  let covered = 0;
  for (let i = 0; i < n; i++) {
    if (c.owner[i] !== owner[i]) return ['final-canvas owner coverage differs from independent recomposition'];
    for (let ch = 0; ch < 4; ch++) if (c.expected[i * 4 + ch] !== expected[i * 4 + ch]) return ['recorded expected canvas differs from independent recomposition'];
    if (owner[i] < 0) continue;
    covered++;
    for (let ch = 0; ch < 4; ch++) if (c.actual[i * 4 + ch] !== expected[i * 4 + ch]) return ['final-canvas RGBA mismatch'];
  }
  if (!covered || c.passed !== true) return ['final-canvas check did not pass'];
  return [];
}

/** Pure evidence validation; caller authenticates capture/expectation file digests and renderer revision. */
export function verifySeatEvidence(contract: any, records: any[], expectations: any[], looks: any[]): string[] {
  const errors: string[] = [];
  if (!contract || contract.version !== 1 || !Array.isArray(contract.sits) || !contract.sits.length || looks.length !== 4 ||
      typeof contract.mechanicsDigest !== 'string' || !/^[a-f0-9]{64}$/.test(contract.mechanicsDigest) ||
      !contract.resolvedViews || !contract.surfaceDigests || !Object.keys(contract.surfaceDigests).length)
    return ['Incomplete verification contract.'];
  const cases = new Map<string, any>();
  const independentMasks = new Map<any, Uint8Array>();
  const keyFor = (r: any) => `${r.facing}/${r.reviewLook}/${r.cushion}`;
  for (const r of records) {
    const key = keyFor(r), art = r.art, f = r.figure, view = contract.resolvedViews[r.facing];
    if (!MODEL_FACINGS.includes(r.facing) || !Number.isInteger(r.reviewLook) || r.reviewLook < 0 || r.reviewLook >= 4 ||
        !Number.isInteger(r.cushion) || r.cushion < 0 || r.cushion >= contract.sits.length) { errors.push(`${key}: unexpected capture context`); continue; }
    if (cases.has(key)) { errors.push(`${key}: duplicate capture context`); continue; }
    cases.set(key, r);
    if (!same(r.look, looks[r.reviewLook])) errors.push(`${key}: review outfit differs`);
    const objectKey = r.object?.variant ? `${r.object.sprite}.${r.object.variant}` : r.object?.sprite;
    if (objectKey !== contract.key) errors.push(`${key}: wrong furniture identity`);
    if (!r.model || JSON.stringify(r.model.parts) !== contract.modelParts || !same(r.model.sits, contract.sits) || !same(r.model.compiler, contract.compiler))
      errors.push(`${key}: stale geometry or declaration`);
    if (r.model && seatMechanicsDigest(r.model) !== contract.mechanicsDigest) errors.push(`${key}: stale or changed complete model mechanics`);
    const maps = r.model?.surfaces ?? {};
    const digests = Object.fromEntries(Object.entries(maps).map(([face, map]) => [face, sha256(canonical(map))]));
    if (!same(digests, contract.surfaceDigests)) errors.push(`${key}: stale or changed surface labels`);
    if (!art || !view || art.w !== view.width || art.h !== view.height || !same([art.ax, art.ay], view.anchor) || art.rgba?.length !== art.w * art.h * 4 ||
        drawingPrint(art.w, art.h, art.rgba) !== view.drawing) errors.push(`${key}: stale source drawing`);
    if (!f || f.rgba?.length !== f.w * f.h * 4 || f.actual?.length !== f.rgba.length || f.owner?.length !== f.w * f.h || !Array.isArray(r.feet)) {
      errors.push(`${key}: malformed figure evidence`); continue;
    }
    const matching = expectations.filter(e => e.context?.key === contract.key && e.context.facing === r.facing && e.context.cushion === r.cushion &&
      same(e.context.look, r.look) && e.context.pose === r.pose && same(e.context.figureContext, reviewedFigureContext(r)));
    if (matching.length !== 1) { errors.push(`${key}: missing or ambiguous independent expectation context`); continue; }
    const expected = matching[0];
    if (expected.context.modelSource !== r.model?.compiler?.source) errors.push(`${key}: stale expectation model source`);
    if (expected.uncertainties?.length || (expected.coverage?.uncertain ?? 0) !== 0) errors.push(`${key}: unresolved independent expectations`);
    const points = new Map<string, any>();
    for (const p of expected.points ?? []) {
      const loc = `${p.x},${p.y}`;
      if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !['avatar', 'furniture'].includes(p.winner) || points.has(loc))
        errors.push(`${key}: invalid, uncertain or duplicate expectation at ${loc}`);
      if (p.source !== r.model?.compiler?.source) errors.push(`${key}: expectation source mismatch at ${loc}`);
      points.set(loc, p);
    }
    const overlaps = new Set<string>();
    const independentMask = new Uint8Array(f.w * f.h);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      if (!f.rgba[i * 4 + 3]) {
        if (f.actual[i * 4 + 3]) errors.push(`${key}: injected avatar pixel at ${x},${y}`);
        continue;
      }
      const X = Math.round(r.feet[0]) - f.ax + x, Y = Math.round(r.feet[1]) - f.ay + y;
      if (!art || X < 0 || Y < 0 || X >= art.w || Y >= art.h || !art.rgba[(Y * art.w + X) * 4 + 3]) {
        if ([0, 1, 2, 3].some(ch => f.actual[i * 4 + ch] !== f.rgba[i * 4 + ch])) errors.push(`${key}: altered avatar outside furniture at ${x},${y}`);
        continue;
      }
      const loc = `${X},${Y}`, point = points.get(loc);
      overlaps.add(loc);
      if (!point) { errors.push(`${key}: unlabeled overlap at ${loc}`); continue; }
      independentMask[i] = point.winner === 'furniture' ? 1 : 0;
      const winner = f.actual[i * 4 + 3] ? 'avatar' : 'furniture';
      if (winner !== point.winner) errors.push(`${key}: wrong winner at ${loc}`);
      if (point.winner === 'avatar' && [0, 1, 2, 3].some(ch => f.actual[i * 4 + ch] !== f.rgba[i * 4 + ch]))
        errors.push(`${key}: altered avatar RGBA at ${loc}`);
    }
    if (!overlaps.size) errors.push(`${key}: no captured furniture/avatar overlap`);
    for (const loc of points.keys()) if (!overlaps.has(loc)) errors.push(`${key}: expectation no longer overlaps at ${loc}`);
    independentMasks.set(r, independentMask);
  }
  for (const facing of MODEL_FACINGS) for (let look = 0; look < 4; look++) {
    const group = records.filter(r => r.facing === facing && r.reviewLook === look);
    if (group.length) errors.push(...canvasProblems(group, independentMasks).map(p => `${facing}/${look}: ${p}`));
  }
  for (const facing of MODEL_FACINGS) for (let look = 0; look < 4; look++) for (let cushion = 0; cushion < contract.sits.length; cushion++)
    if (!cases.has(`${facing}/${look}/${cushion}`)) errors.push(`${facing}/${look}/${cushion}: missing required capture`);
  return errors;
}

export function verifySeatBundle(bundlePath: string, expectedContractPath: string, repoRoot = process.cwd()): { ok: boolean; problems: string[] } {
  try {
    const folder = dirname(resolve(bundlePath)), bundle: VerificationBundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
    const problems: string[] = [];
    if (bundle.version !== 1) throw new Error('Unsupported evidence bundle version.');
    const load = (file: FileProof) => {
      const bytes = readFileSync(resolve(folder, file.path));
      if (sha256(bytes) !== file.sha256) throw new Error(`Evidence file changed: ${file.path}`);
      return JSON.parse(bytes.toString('utf8'));
    };
    if (bundle.contract.sha256 !== sha256(readFileSync(expectedContractPath))) throw new Error('Verification contract changed.');
    const contract = load(bundle.contract), currentSources = rendererSources(repoRoot);
    if (!same(bundle.rendererSources, currentSources)) throw new Error('Renderer sources changed; fresh captures are required.');
    const records: any[] = [];
    for (const file of bundle.captures) {
      const capture = load(file), receipt = load(file.receipt);
      if (receipt.unchanged !== true || !same(receipt.rendererSources, currentSources) || receipt.captures?.[basename(file.path)] !== file.sha256)
        throw new Error(`Capture-time source receipt does not match: ${file.path}`);
      if (!Array.isArray(capture)) throw new Error(`Malformed capture: ${file.path}`);
      records.push(...capture);
    }
    const expectations = bundle.expectations.map(load);
    const cardigan = JSON.parse(readFileSync(resolve(repoRoot, 'tests/fixtures/seating-cardigan.json'), 'utf8'));
    const looks = [...SEAT_LOOKS, cardigan].map(look => ({ ...look, pet: 'pet.none' }));
    problems.push(...verifySeatEvidence(contract, records, expectations, looks));
    return { ok: !problems.length, problems };
  } catch (error) { return { ok: false, problems: [error instanceof Error ? error.message : String(error)] }; }
}
