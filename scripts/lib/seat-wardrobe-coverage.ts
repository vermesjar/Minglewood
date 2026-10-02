/** Sample original avatar geometry independently of furniture masks.
 * This is a finite-depth prerequisite, never visual or overlap approval.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVATAR_ITEMS, DEFAULT_LOADOUT } from '../../src/shared/avatar';
import type { AvatarLoadout } from '../../src/shared/domain/types';
import type { Facing } from '../../src/shared/world/scene';
import { NATURAL_LEGS, type SitLegs } from '../../src/shared/world/sitLegs';
import { SIT_POSE_OF } from '../../src/shared/world/seats';
import { renderAvatarLayers, POSES } from '../../src/client/engine/sprites/avatarQa';
import { avatarSurfaceDepth } from '../../src/client/engine/sprites/avatarSurfaceDepth';
import { usesWheelchair } from '../../src/client/engine/sprites/avatar';
import type { Pose } from '../../src/client/engine/sprites/avatarFrame';
import { rendererSources } from './seat-source-receipt';
import { attestWardrobe, requireWardrobeAttestation, writeWardrobeCache } from './seat-wardrobe-attestation';

export const WARDROBE_POLICY = 'catalog-body-top-bottom-shoes-and-single-items-v1';
export interface BodyContext { pose: Pose; facing: Facing; legs?: SitLegs }
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => JSON.stringify(k) + ':' + canonical(x)).join(',') + '}';
  return JSON.stringify(v);
};
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const bytesHash = (v: ArrayBufferView) => createHash('sha256').update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).digest('hex');
const facings: Facing[] = ['se', 'sw', 'ne', 'nw'];

export function wardrobeMatrix(): AvatarLoadout[] {
  const items = (slot: string) => AVATAR_ITEMS.filter(i => i.slot === slot).map(i => i.id);
  const looks = new Map<string, AvatarLoadout>();
  const add = (patch: Partial<AvatarLoadout>) => {
    const look = { ...DEFAULT_LOADOUT, pet: 'pet.none', ...patch };
    looks.set(canonical(look), look);
  };
  for (const item of AVATAR_ITEMS) if (item.slot !== 'pet') add({ [item.slot]: item.id });
  for (const body of items('body')) for (const top of items('top')) for (const bottom of items('bottom')) for (const shoes of items('shoes')) add({ body, top, bottom, shoes });
  return [...looks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, look]) => look);
}

export function normalizedBodyContexts(input: BodyContext[]): BodyContext[] {
  const contexts = new Map<string, BodyContext>();
  for (const raw of input) {
    if (!raw || !facings.includes(raw.facing) || !POSES.includes(raw.pose)) throw Error('Unknown original-body context.');
    if (raw.legs) {
      const fields = Object.keys(raw.legs);
      if (fields.some(k => !['reach', 'rise', 'drop', 'toe', 'hang', 'hidden'].includes(k)) ||
          !['reach', 'rise', 'drop', 'toe', 'hang'].every(k => Number.isFinite(raw.legs![k as keyof SitLegs])) ||
          (raw.legs.hidden !== undefined && typeof raw.legs.hidden !== 'boolean')) throw Error('Malformed exact leg context.');
    }
    const context = JSON.parse(canonical(raw)) as BodyContext;
    contexts.set(canonical(context), context);
  }
  return [...contexts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, context]) => context);
}

export function naturalBodyContexts(): BodyContext[] {
  return normalizedBodyContexts(facings.flatMap(facing => [
    ...(['chair', 'lounge', 'floor', 'stool'] as const).map(style => ({ facing, pose: SIT_POSE_OF[style] as Pose, legs: NATURAL_LEGS[style] })),
    { facing, pose: 'stand' as Pose }, { facing, pose: 'crouch' as Pose },
  ]));
}

/** Caller must first validate the raw recording's hashes and pose observations. */
export function bodyContextsFromValidatedFilms(films: Array<{ frames: Array<{ state: { pose: Pose; facing: Facing; legs?: SitLegs; poseRace?: boolean } }> }>): BodyContext[] {
  const contexts: BodyContext[] = [];
  for (const film of films) {
    if (!Array.isArray(film.frames) || !film.frames.length) throw Error('Missing movement frames.');
    for (const { state } of film.frames) {
      if (!state || state.poseRace !== false) throw Error('Unverified observed body pose.');
      if (state.pose.startsWith('sit') && !state.legs) throw Error('Seated film omitted exact leg geometry.');
      contexts.push({ pose: state.pose, facing: state.facing, ...(state.legs ? { legs: state.legs } : {}) });
    }
  }
  return normalizedBodyContexts(contexts);
}

export function wardrobeSources(root = process.cwd()): Record<string, string> {
  const files = ['scripts/lib/seat-wardrobe-coverage.ts', 'scripts/lib/seat-wardrobe-attestation.ts'];
  return { ...rendererSources(root), ...Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')])) };
}
// Imports are evaluated once. A long-lived process must not sign new disk
// identities while still executing an older loaded body renderer.
const loadedSources = wardrobeSources();

interface ContextResult {
  context: BodyContext; contextDigest: string; lookCount: number; testedLooks: number; excludedLooks: number;
  opaquePixels: number; unresolvedPixels: number; failingLooks: number; originalBodyDigest: string;
}
export interface WardrobeReceipt {
  attestation?: string;
  version: 1; policy: typeof WARDROBE_POLICY; requestDigest: string; matrixDigest: string;
  bindings: Record<string, string>; sources: Record<string, string>; sourcesAfter: Record<string, string>;
  stableSources: boolean; looks: number; contexts: ContextResult[]; ok: boolean;
  visualApproval: false; wardrobeOverlapApproval: false; scope: string;
}
export interface WardrobeRequest {
  /** Exact model, settled contract/capture and raw-film byte hashes, derived by the publication verifier. */
  bindings: Record<string, string>; contexts: BodyContext[];
}
const requestIdentity = (request: WardrobeRequest, sources: Record<string, string>, matrixDigest: string) =>
  hash({ version: 1, policy: WARDROBE_POLICY, bindings: request.bindings, contexts: normalizedBodyContexts(request.contexts), sources, matrixDigest });

function evaluateContext(context: BodyContext, looks: AvatarLoadout[]): ContextResult {
  const digest = createHash('sha256');
  let testedLooks = 0, excludedLooks = 0, opaquePixels = 0, unresolvedPixels = 0, failingLooks = 0;
  for (const look of looks) {
    if (usesWheelchair(look)) { excludedLooks++; digest.update(canonical({ look, exclusion: 'Existing wheelchair-own-seat WorldView routing' })); continue; }
    const figure = renderAvatarLayers(look, context.facing, context.pose, context.legs);
    const depth = avatarSurfaceDepth(look, context.facing, context.pose, context.legs);
    if (depth.z.length !== figure.owner.length || figure.px.length !== figure.owner.length * 4) throw Error('Malformed original body arrays.');
    let missing = 0;
    for (let i = 0; i < figure.owner.length; i++) if (figure.px[i * 4 + 3]) { opaquePixels++; if (!Number.isFinite(depth.z[i])) missing++; }
    testedLooks++; unresolvedPixels += missing; if (missing) failingLooks++;
    digest.update(canonical({ look, rgba: bytesHash(figure.px), owner: bytesHash(figure.owner), depth: bytesHash(depth.z), missing }));
  }
  return { context, contextDigest: hash(context), lookCount: looks.length, testedLooks, excludedLooks, opaquePixels, unresolvedPixels, failingLooks, originalBodyDigest: digest.digest('hex') };
}

/** Immutable per-context caches reuse computation, never a prior candidate's aggregate approval. */
export function runWardrobeCoverage(request: WardrobeRequest, options: { root?: string; cacheDir?: string; onContext?: (completed: number, total: number) => void } = {}): WardrobeReceipt {
  const root = options.root ?? process.cwd(), sources = wardrobeSources(root), looks = wardrobeMatrix(), matrixDigest = hash(looks);
  if (canonical(sources) !== canonical(loadedSources)) throw Error('Body sources changed after the sampler loaded; restart the coverage worker.');
  if (!Object.keys(request.bindings).length || Object.values(request.bindings).some(v => !/^[a-f0-9]{64}$/.test(v))) throw Error('Missing exact candidate input hashes.');
  const contexts = normalizedBodyContexts(request.contexts); if (!contexts.length) throw Error('Missing body contexts.');
  if (options.cacheDir) mkdirSync(options.cacheDir, { recursive: true });
  const results = contexts.map((context, index) => {
    const key = hash({ policy: WARDROBE_POLICY, sources, matrixDigest, context });
    const path = options.cacheDir ? resolve(options.cacheDir, key + '.json') : undefined;
    let result: ContextResult;
    if (path && existsSync(path)) {
      const cached = JSON.parse(readFileSync(path, 'utf8'));
      if (cached.key !== key || cached.digest !== hash(cached.result) || canonical(cached.result.context) !== canonical(context) || cached.result.lookCount !== looks.length) throw Error('Corrupt wardrobe context cache.');
      requireWardrobeAttestation('context-v1', { key: cached.key, digest: cached.digest, result: cached.result }, cached.attestation);
      result = cached.result;
    } else {
      result = evaluateContext(context, looks);
      if (path) {
        const payload = { key, digest: hash(result), result };
        writeWardrobeCache(path, { ...payload, attestation: attestWardrobe('context-v1', payload) });
      }
    }
    options.onContext?.(index + 1, contexts.length); return result;
  });
  const sourcesAfter = wardrobeSources(root), stableSources = canonical(sources) === canonical(sourcesAfter);
  if (!stableSources || canonical(sourcesAfter) !== canonical(loadedSources)) throw Error('Body sources changed during sampling; restart the coverage worker.');
  const receipt: WardrobeReceipt = { version: 1, policy: WARDROBE_POLICY, requestDigest: requestIdentity(request, sources, matrixDigest), matrixDigest,
    bindings: request.bindings, sources, sourcesAfter, stableSources, looks: looks.length, contexts: results,
    ok: stableSources && results.every(r => r.unresolvedPixels === 0 && r.failingLooks === 0), visualApproval: false, wardrobeOverlapApproval: false,
    scope: 'Finite original-body depth for the bound catalog matrix and exact sampled contexts only. Does not approve source geometry, furniture overlap, appearance, unsampled accessories/palettes or future clothes.' };
  receipt.attestation = attestWardrobe('aggregate-v1', receipt);
  return receipt;
}

/** Derive required request independently from verified publication inputs, not this receipt. */
export function wardrobeReceiptProblems(receipt: WardrobeReceipt, required: WardrobeRequest, root = process.cwd()): string[] {
  const problems: string[] = [], sources = wardrobeSources(root), looks = wardrobeMatrix(), contexts = normalizedBodyContexts(required.contexts);
  try { const { attestation, ...payload } = receipt; requireWardrobeAttestation('aggregate-v1', payload, attestation); }
  catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  if (receipt.version !== 1 || receipt.policy !== WARDROBE_POLICY) problems.push('Unsupported wardrobe coverage policy.');
  if (receipt.requestDigest !== requestIdentity(required, sources, hash(looks)) || canonical(receipt.bindings) !== canonical(required.bindings)) problems.push('Wardrobe candidate, catalog, source or sampled context identity changed.');
  if (!receipt.stableSources || canonical(receipt.sources) !== canonical(sources) || canonical(receipt.sourcesAfter) !== canonical(sources)) problems.push('Wardrobe source inventory is stale or changed during sampling.');
  if (receipt.matrixDigest !== hash(looks) || receipt.looks !== looks.length) problems.push('Wardrobe matrix mismatch.');
  if (!Array.isArray(receipt.contexts) || receipt.contexts.length !== contexts.length || canonical(receipt.contexts.map(r => r.context)) !== canonical(contexts)) problems.push('Missing, duplicated or changed sampled contexts.');
  const excluded = looks.filter(usesWheelchair).length;
  for (const row of receipt.contexts ?? []) if (row.contextDigest !== hash(row.context) || row.lookCount !== looks.length || row.excludedLooks !== excluded || row.testedLooks !== looks.length - excluded || !Number.isInteger(row.opaquePixels) || row.opaquePixels <= 0 || row.unresolvedPixels !== 0 || row.failingLooks !== 0 || !/^[a-f0-9]{64}$/.test(row.originalBodyDigest)) problems.push('Incomplete or failing original-body coverage.');
  if (receipt.ok !== true || receipt.visualApproval !== false || receipt.wardrobeOverlapApproval !== false) problems.push('Coverage failed or overclaims visual approval.');
  return [...new Set(problems)];
}
