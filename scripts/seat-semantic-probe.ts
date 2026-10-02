/** Fast source-bound regression prediction before a fresh actual WorldView capture.
 * This never produces publication evidence or modifies independent expectations.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadManifest } from './lib/manifest';
import { modelView, readModels } from './lib/models';
import { reviewedFigureContext } from './lib/seat-review-context';
import { canonical } from './lib/seat-verification';
import { renderAvatarLayers } from '../src/client/engine/sprites/avatarQa';
import { seatLayers, sitterMask } from '../src/client/engine/sprites/seatLayers';
import { FIG, figAx, hipFeet } from '../src/shared/world/seatFigure';
import { THIGH_R } from '../src/shared/world/sitLegs';
import { SIT_POSE_OF } from '../src/shared/world/seats';
import type { Pose } from '../src/client/engine/sprites/avatarFrame';
import type { Sprites } from './lib/seats';
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const root = arg('reviews');
if (!root) throw new Error('Usage: --reviews DIRECTORY [--models FILE] [--keys key,key]');
const models = { ...readModels(), ...(arg('models') ? JSON.parse(readFileSync(arg('models')!, 'utf8')) : {}) };
const manifest = loadManifest().sprites as unknown as Sprites, keys = arg('keys')?.split(','), facings = arg('facings')?.split(',');
const files = (p: string): string[] => statSync(p).isDirectory() ? readdirSync(p).flatMap(f => files(join(p, f))) : p.endsWith('.json') ? [p] : [];
const results: Record<string, { contexts: number; checked: number; uncertain: number; failures: number; samples: unknown[]; stale: string[] }> = {};
for (const file of files(root)) {
  const review = JSON.parse(readFileSync(file, 'utf8')), ctx = review.context;
  if (!ctx?.key || !Array.isArray(review.points) || (keys && !keys.includes(ctx.key)) || (facings && !facings.includes(ctx.facing))) continue;
  const result = results[ctx.key] ??= { contexts: 0, checked: 0, uncertain: 0, failures: 0, samples: [], stale: [] };
  result.contexts++;
  const v = modelView(manifest, ctx.key, ctx.facing, models[ctx.key]), L = seatLayers(v);
  const feet = hipFeet(L.hips[ctx.cushion]!, v.style), legs = L.legs[ctx.cushion]!, pose = SIT_POSE_OF[v.style] as Pose;
  const height = L.sits[ctx.cushion]![2] + THIGH_R, fig = renderAvatarLayers(ctx.look, ctx.facing, pose, legs);
  const original = { feet, legs, height, figure: { w: FIG.w, h: FIG.h, ax: figAx(ctx.facing), ay: FIG.feet,
    rgba: Array.from(fig.px), owner: Array.from(fig.owner) } };
  if (ctx.pose !== pose || ctx.modelSource !== v.model.compiler?.source || canonical(ctx.figureContext) !== canonical(reviewedFigureContext(original))) {
    result.stale.push(file); continue;
  }
  const mask = sitterMask(v, ctx.look, ctx.facing, pose, feet, legs, height);
  for (const p of review.points) {
    if (p.winner === 'uncertain') { result.uncertain++; continue; }
    const x = p.x - feet[0] + figAx(ctx.facing), y = p.y - feet[1] + FIG.feet, i = y * FIG.w + x;
    result.checked++;
    if (!fig.px[i * 4 + 3] || !v.art.px.d[(p.y * v.art.px.w + p.x) * 4 + 3] || (mask[i] ? 'furniture' : 'avatar') !== p.winner) {
      result.failures++;
      if (result.samples.length < 8) result.samples.push({ facing: ctx.facing, cushion: ctx.cushion, x: p.x, y: p.y, expected: p.winner });
    }
  }
}
console.log(JSON.stringify({ scope: 'Renderer prediction only, not game-canvas evidence or approval', results }, null, 2));
process.exitCode = Object.values(results).some(r => r.failures || r.stale.length) ? 1 : 0;
