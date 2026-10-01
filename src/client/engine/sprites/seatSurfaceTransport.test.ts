import { describe, expect, it } from 'vitest';
import { MODEL_FACINGS, type SeatSurfaceMap } from '@shared/world/seatModels';
import { drawingPrint } from '@shared/world/seatFigure';
import { formatModels, modelView, readModels } from '../../../../scripts/lib/models';
import { loadManifest } from '../../../../scripts/lib/manifest';
import { profileOf, type Sprites } from '../../../../scripts/lib/seats';
import { cleanSeatModel } from '../../../server/routes/devLab';
import { seatDepth, surfacePartsSignature } from './seatModel';
import { compileSeat, type SeatCompileInput } from './seatCompiler';

const catalog = loadManifest().sprites as unknown as Sprites;
const key = 'armchair.mustard', model = readModels()[key], profile = profileOf(catalog, key);
const views = MODEL_FACINGS.map(facing => modelView(catalog, key, facing, model));
// Proxy-derived labels are only transport fixtures. These tests do not approve their semantics.
const maps = Object.fromEntries(views.map(v => {
  const d = seatDepth(v), px = v.art.px;
  const map: SeatSurfaceMap = { version: 1, width: px.w, height: px.h, drawing: drawingPrint(px.w, px.h, px.d), modelParts: surfacePartsSignature(model),
    labels: [...d.part].map((part, i) => part < 0 ? 0 : 1 + part * 3 + d.face[i]) };
  return [v.facing, map];
}));
const input: SeatCompileInput = { key, family: profile.seatKind, size: model.size, seat: profile.seat, style: profile.sitStyle,
  backrest: profile.backrest, arms: !!profile.arms, views, surfaces: maps };

describe('generated seating surface transport', () => {
  it('survives worker structured cloning and deterministic recompilation without rebinding labels', () => {
    const transported = structuredClone(input);
    const result = compileSeat(transported);
    expect(result.model.surfaces).toEqual(maps);
    expect(result.model.surfaces).not.toBe(transported.surfaces);
    expect(result.problems).toEqual([]);
  }, 30000);

  it('fails recompilation with changed source art instead of dropping or refreshing old maps', () => {
    const transported = structuredClone(input);
    transported.views[0].art.px.d[0] ^= 1;
    expect(() => compileSeat(transported)).toThrow(/fingerprint is stale/);
    expect(transported.surfaces).toEqual(maps);
  }, 30000);

  it('preserves exact map metadata and labels through the server cleaner and model-file serialization', () => {
    const draft = { model: { ...model, surfaces: maps }, for: 'source' };
    const cleaned = cleanSeatModel(structuredClone(draft))!;
    expect(cleaned.model.surfaces).toEqual(maps);
    const saved = JSON.parse(formatModels({ [key]: cleaned.model }));
    expect(saved[key].surfaces).toEqual(maps);
    for (const v of views) expect(seatDepth({ ...v, model: saved[key] }).source).toBe('semantic');
  });

  it('rejects malformed surfaces and geometry rounding that would invalidate their part binding', () => {
    const draft = { model: { ...model, surfaces: structuredClone(maps) }, for: 'source' };
    draft.model.surfaces.nw.labels[0] = -1;
    expect(() => cleanSeatModel(draft)).toThrow(/surface map/);
    const rounded = structuredClone({ model: { ...model, surfaces: maps }, for: 'source' });
    rounded.model.parts[0].u[0] += 0.001;
    for (const map of Object.values(rounded.model.surfaces)) map.modelParts = surfacePartsSignature(rounded.model);
    expect(() => cleanSeatModel(rounded)).toThrow(/stale seating surface map/);
  });
});
