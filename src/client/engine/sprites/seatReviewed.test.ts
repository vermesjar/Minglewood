import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../../../../scripts/lib/manifest';
import { modelView, readModels } from '../../../../scripts/lib/models';
import { reviewedFigureContext } from '../../../../scripts/lib/seat-review-context';
import { drawingPrint, FIG, figAx, hipFeet } from '@shared/world/seatFigure';
import { THIGH_R } from '@shared/world/sitLegs';
import { SIT_POSE_OF } from '@shared/world/seats';
import { renderAvatarLayers } from './avatarQa';
import { seatLayers, sitterMask } from './seatLayers';
import type { Sprites } from '../../../../scripts/lib/seats';
import type { Pose } from './avatarFrame';

const manifest = loadManifest().sprites as unknown as Sprites, models = readModels();
const files = readdirSync('tests/fixtures').filter(f => f.startsWith('seating-reviewed-') && f.endsWith('.json'));
describe('complete independently reviewed seat regressions', () => {
  it('retains at least one full approved seat instead of silently skipping coverage', () => expect(files.length).toBeGreaterThan(0));
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(`tests/fixtures/${file}`, 'utf8'));
    it(`${fixture.key}: every approved overlap retains its independent winner`, () => {
      expect(fixture.cases.length).toBe(16 * models[fixture.key].sits.length);
      let checked = 0;
      for (const c of fixture.cases) {
        const ctx = c.context, v = modelView(manifest, fixture.key, ctx.facing, models[fixture.key]);
        const L = seatLayers(v), feet = hipFeet(L.hips[ctx.cushion]!, v.style), legs = L.legs[ctx.cushion]!;
        const pose = SIT_POSE_OF[v.style] as Pose, height = L.sits[ctx.cushion]![2] + THIGH_R;
        const fig = renderAvatarLayers(ctx.look, ctx.facing, pose, legs);
        expect(v.model.compiler?.source).toBe(ctx.modelSource);
        expect({ drawing: drawingPrint(v.art.px.w, v.art.px.h, v.art.px.d), width: v.art.px.w, height: v.art.px.h,
          anchor: [v.art.ax, v.art.ay] }).toEqual(c.drawing);
        expect(reviewedFigureContext({ feet, legs, height, figure: { w: FIG.w, h: FIG.h,
          ax: figAx(ctx.facing), ay: FIG.feet, rgba: Array.from(fig.px), owner: Array.from(fig.owner) } })).toEqual(ctx.figureContext);
        const mask = sitterMask(v, ctx.look, ctx.facing, pose, feet, legs, height), winners = Buffer.from(c.winnersBase64, 'base64');
        expect(winners.length).toBe(v.art.px.w * v.art.px.h);
        const failures: string[] = [];
        let overlaps = 0;
        for (let i = 0; i < fig.owner.length; i++) {
          if (!fig.px[i * 4 + 3]) continue;
          const x = feet[0] - figAx(ctx.facing) + i % FIG.w, y = feet[1] - FIG.feet + Math.floor(i / FIG.w);
          if (x < 0 || y < 0 || x >= c.width || y >= c.height || !v.art.px.d[(y * c.width + x) * 4 + 3]) {
            if (mask[i]) failures.push(`${x},${y}: hidden outside furniture`);
            continue;
          }
          overlaps++;
          if (winners[y * c.width + x] !== (mask[i] ? 2 : 1)) failures.push(`${x},${y}: wrong or unreviewed winner`);
        }
        expect(overlaps).toBe(c.overlapCount);
        expect(failures, `${ctx.facing}/${ctx.cushion}/${JSON.stringify(ctx.look)}`).toEqual([]);
        checked += overlaps;
      }
      expect(checked).toBeGreaterThan(1000);
    });
  }
});
