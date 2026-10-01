/** Source-body coverage audit, independent of furniture masks or expected winners.
 * node --no-maglev --import tsx scripts/avatar-seat-coverage.ts OUTPUT.json [--full] [--captures FILE.json ...]
 * Default: every catalog item alone plus all garment/bottom/shoe/body combinations.
 * Full: every top/bottom/shoe/body combination. Neither mode claims artistic approval.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { AVATAR_ITEMS, DEFAULT_LOADOUT } from '../src/shared/avatar';
import { NATURAL_LEGS } from '../src/shared/world/sitLegs';
import { SIT_POSE_OF } from '../src/shared/world/seats';
import { FIG } from '../src/shared/world/seatFigure';
import { renderAvatarLayers } from '../src/client/engine/sprites/avatarQa';
import { avatarSurfaceDepth } from '../src/client/engine/sprites/avatarSurfaceDepth';
import { usesWheelchair } from '../src/client/engine/sprites/avatar';
import { rendererSources } from './lib/seat-source-receipt';
import type { Pose } from '../src/client/engine/sprites/avatarFrame';
import type { AvatarLoadout } from '../src/shared/domain/types';

const output = process.argv[2];
if (!output) throw Error('Provide a new output JSON path.');
const full = process.argv.includes('--full');
const capturePaths: string[] = [];
for (let i = 3; i < process.argv.length; i++) if (process.argv[i] === '--captures') {
  const path = process.argv[++i]; if (!path || path.startsWith('--')) throw Error('--captures requires a capture JSON path.');
  capturePaths.push(path);
}
const files = ['scripts/avatar-seat-coverage.ts', ...capturePaths];
// Use the common recursive renderer inventory so new geometry modules cannot
// escape the binding merely because this audit once listed fewer dependencies.
const digest = () => ({ ...rendererSources(), ...Object.fromEntries(files.map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])) });
const before = digest(), started = new Date().toISOString();
const items = (slot: string) => AVATAR_ITEMS.filter(i => i.slot === slot).map(i => i.id);
const tops = full ? items('top') : ['top.tee', 'top.northstar-hoodie', ...AVATAR_ITEMS.filter(i => i.slot === 'top' && i.fullLength).map(i => i.id)];
const looks = new Map<string, AvatarLoadout>();
const add = (patch: Partial<AvatarLoadout>) => {
  const look = { ...DEFAULT_LOADOUT, pet: 'pet.none', ...patch };
  looks.set(JSON.stringify(look), look);
};
// Single-item coverage catches unrelated silhouettes, not only the reported skirt.
for (const item of AVATAR_ITEMS) if (item.slot !== 'pet') add({ [item.slot]: item.id });
for (const body of items('body')) for (const top of tops) for (const bottom of items('bottom')) for (const shoes of items('shoes'))
  add({ body, top, bottom, shoes });
const poses = [
  ...(['chair', 'lounge', 'floor', 'stool'] as const).map(style => ({ pose: SIT_POSE_OF[style] as Pose, legs: NATURAL_LEGS[style] })),
  { pose: 'stand' as Pose, legs: undefined }, { pose: 'crouch' as Pose, legs: undefined },
];
for (const path of capturePaths) {
  const records = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(records)) throw Error('Capture must contain the original record array.');
  for (const record of records) {
    if (!['sit', 'sit-lounge', 'sit-stool', 'sit-floor', 'crouch', 'stand'].includes(record.pose)) continue;
    const context = { pose: record.pose as Pose, legs: record.legs };
    if (!poses.some(p => JSON.stringify(p) === JSON.stringify(context))) poses.push(context);
  }
}
const failures: any[] = [], byOwner: Record<string, number> = {};
const excludedLooks: Array<{ look: AvatarLoadout; reason: string }> = [];
let contexts = 0, opacity = 0, unresolved = 0, index = 0;
for (const look of looks.values()) {
  // WorldView.seatedFigure returns the original sprite for wheelchair users:
  // their wheelchair remains their own seat, and this depth map is never used.
  if (usesWheelchair(look)) {
    excludedLooks.push({ look, reason: 'Existing WorldView seating composition bypass: wheelchair is its own seat.' });
    index++; continue;
  }
  for (const { pose, legs } of poses) for (const facing of ['se', 'sw', 'ne', 'nw'] as const) {
    const figure = renderAvatarLayers(look, facing, pose, legs), depth = avatarSurfaceDepth(look, facing, pose, legs);
    let missing = 0; const samples: any[] = [];
    for (let i = 0; i < figure.owner.length; i++) if (figure.px[i * 4 + 3]) {
      opacity++;
      if (!Number.isFinite(depth.z[i])) {
        missing++; byOwner[figure.owner[i]] = (byOwner[figure.owner[i]] ?? 0) + 1;
        if (samples.length < 12) samples.push({ x: i % FIG.w, y: Math.floor(i / FIG.w), owner: figure.owner[i] });
      }
    }
    contexts++; unresolved += missing;
    if (missing) failures.push({ look, pose, legs, facing, missing, samples });
  }
  if (++index % 100 === 0) console.log(JSON.stringify({ looks: index, totalLooks: looks.size, contexts, failingContexts: failures.length, unresolved }));
}
const after = digest(), stableSources = JSON.stringify(before) === JSON.stringify(after);
const result = { scope: 'Original opaque avatar depth coverage only. No furniture or winner comparisons; no visual or motion approval.',
  matrix: full ? 'Every catalog top/bottom/shoe/body combination plus each other catalog item alone' : 'All long garments plus tee/hoodie crossed with every bottom/shoe/body; each other catalog item alone',
  poseContexts: poses, captureInputs: capturePaths,
  limitation: 'Natural legs plus explicitly supplied captured legs and stand/crouch; palette combinations, all accessory interactions, arbitrary generated clothes and continuous motion legs are not exhaustive.',
  started, finished: new Date().toISOString(), before, after, stableSources, looks: looks.size, excludedLooks, contexts,
  opaquePixels: opacity, unresolvedPixels: unresolved, failingContexts: failures.length, byOwner, failures };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output, stableSources, looks: looks.size, contexts, unresolvedPixels: unresolved, failingContexts: failures.length }));
if (unresolved || !stableSources) process.exitCode = 1;
