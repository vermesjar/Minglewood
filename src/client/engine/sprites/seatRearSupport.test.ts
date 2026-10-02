import { describe, expect, it } from 'vitest';
import { loadManifest } from '../../../../scripts/lib/manifest';
import { modelView, readModels } from '../../../../scripts/lib/models';
import type { Sprites } from '../../../../scripts/lib/seats';
import { FIG, figAx, hipFeet } from '@shared/world/seatFigure';
import { SEAT_LOOKS } from '@shared/world/seatModels';
import { THIGH_R } from '@shared/world/sitLegs';
import { seatLayers, sitterMask } from './seatLayers';

describe('independently reviewed rear cushion contact', () => {
  it('preserves rounded upper shins without promoting descending shins into the pelvis', () => {
    const catalog = loadManifest().sprites as unknown as Sprites;
    const model = structuredClone(readModels()['chair.red']);
    // Frozen candidate pose reviewed against original source art and anatomy.
    // No renderer mask was used to assign these six expected source pixels.
    model.sits[0][1] = .57;
    model.compiler!.version = 4;
    const points = [[32, 17, 0], [33, 17, 0], [31, 19, 1],
      [30, 20, 1], [28, 21, 1], [29, 21, 1]] as const;
    for (const facing of ['ne', 'nw'] as const) for (const look of SEAT_LOOKS) {
      const view = modelView(catalog, 'chair.red', facing, model), layers = seatLayers(view);
      const feet = hipFeet(layers.hips[0]!, view.style), legs = layers.legs[0]!;
      const mask = sitterMask(view, look, facing, 'sit', feet, legs, layers.sits[0]![2] + THIGH_R);
      for (const [sx, sy, hidden] of points) {
        const sourceX = facing === 'nw' ? view.art.px.w - 1 - sx : sx;
        const x = sourceX - feet[0] + figAx(facing), y = sy - feet[1] + FIG.feet;
        expect(mask[y * FIG.w + x], `${facing} source ${sourceX},${sy}`).toBe(hidden);
      }
    }
  });
});
