import { describe, expect, it } from 'vitest';
import { compileSeat, publishedSeatSourceStatus, seatCompileSignature, SEAT_COMPILER_VERSION } from './seatCompiler';
import { fitModel } from './seatModelFit';
import { seatProblems } from './seatLayers';
import { MODEL_FACINGS, backFace, SIT_GAP, seatPlacementProblems } from '@shared/world/seatModels';
import { readModels, modelView } from '../../../../scripts/lib/models';
import { loadManifest } from '../../../../scripts/lib/manifest';
import { profileOf, viewArt, type Sprites } from '../../../../scripts/lib/seats';

const catalog = loadManifest().sprites as unknown as Sprites;
const models = readModels();
const inputFor = (key: string) => {
  const p = profileOf(catalog, key);
  return { key, family: p.seatKind, size: catalog[key].footprint, seat: p.seat, style: p.sitStyle,
    backrest: p.backrest, arms: !!p.arms,
    views: MODEL_FACINGS.map(facing => ({ facing, art: viewArt(catalog, key, facing).art })) };
};

describe('automatic seating contract', () => {
  it('rejects a resting pelvis that intersects a raised neighbouring cushion', () => {
    const model = structuredClone(models['chair.red']);
    delete model.surfaces;
    const [u, v, z] = model.sits[0];
    model.parts.push({ part: 'seat', u: [u + 0.2, u + 0.5], v: [v - 0.05, v + 0.05], z: [z + 1, z + 8] });
    expect(seatProblems(modelView(catalog, 'chair.red', 'se', model)))
      .toContain(`cushion 0: a raised neighbouring cushion intersects the pelvis (support ${z + 8}, sitting height ${z})`);
  });
  it('invalidates v2 drafts while explicitly recognizing unchanged published v2 source', () => {
    const input = inputFor('chair.red');
    const model = structuredClone(models['chair.red']);
    const oldSource = JSON.parse(seatCompileSignature(input));
    oldSource[0] = 2;
    model.compiler = { version: 2, source: JSON.stringify(oldSource) };
    const before = JSON.stringify(model);
    expect(SEAT_COMPILER_VERSION).toBe(4);
    expect(model.compiler.source).not.toBe(seatCompileSignature(input));
    expect(publishedSeatSourceStatus(model, input)).toBe('legacy-v2');
    expect(JSON.stringify(model)).toBe(before);
    expect(publishedSeatSourceStatus(model, { ...input, seat: input.seat + 1 })).toBe('stale');
    oldSource[0] = 3;
    model.compiler = { version: 3, source: JSON.stringify(oldSource) };
    expect(publishedSeatSourceStatus(model, input)).toBe('legacy-v3');
    model.compiler = { version: SEAT_COMPILER_VERSION, source: seatCompileSignature(input) };
    expect(publishedSeatSourceStatus(model, input)).toBe('current');
    model.compiler.version = SEAT_COMPILER_VERSION + 1;
    expect(publishedSeatSourceStatus(model, input)).toBe('stale');
  });
  it('includes actual arm geometry for the armed outdoor benches', () => {
    for (const key of ['bench', 'bench-garden.teal']) {
      expect(inputFor(key).arms, key).toBe(true);
      expect(models[key].parts.filter(p => p.part === 'arm').length, key).toBe(2);
    }
    expect(inputFor('bench.navy').arms).toBe(false);
    expect(models['bench.navy'].parts.filter(p => p.part === 'arm')).toHaveLength(0);
  });
  it('every catalog cushion has clearance and usable legs in every direction', () => {
    const problems = Object.entries(models).flatMap(([key, model]) => MODEL_FACINGS.flatMap(facing =>
      seatProblems(modelView(catalog, key, facing, model)).map(p => `${key}/${facing}: ${p}`)));
    expect(problems).toEqual([]);
  });

  it('compiles renamed furniture identically without a saved rig or view offsets', () => {
    const input = inputFor('armchair.green');
    const original = compileSeat(input);
    const renamed = compileSeat({ ...input, key: 'my-beautiful-custom-seat' });
    expect(original.problems).toEqual([]);
    const [u, v, z] = original.model.sits[0];
    // The silhouette alone used to push this cushion front beyond the
    // avatar's reach, leaving .085 tile of empty space behind its pelvis.
    expect(Math.abs(backFace(original.model, u, z)! - v - SIT_GAP)).toBeLessThanOrEqual(1 / 32);
    expect(seatPlacementProblems(original.model)).toEqual([]);
    expect(renamed.model).toEqual(original.model);
    expect(renamed.model.views).toBeUndefined();
    expect(renamed.model.over).toBeUndefined();
  }, 90_000);

  it('keeps automatically inferred lounge geometry physically supported too', () => {
    const input = inputFor('armchair.green');
    const result = compileSeat({ ...input, family: undefined, key: 'generated-lounge-seat' });
    expect(result.problems).toEqual([]);
    expect(seatPlacementProblems(result.model)).toEqual([]);
  }, 90_000);

  it('rejects an incomplete view set and unsupported multi-row seating', () => {
    const input = inputFor('couch.green');
    expect(() => compileSeat({ ...input, views: input.views.slice(0, 2) })).toThrow('all four');
    expect(() => compileSeat({ ...input, size: [2, 2] })).toThrow('one row');
    expect(seatCompileSignature({ ...input, seat: input.seat + 1 })).not.toBe(seatCompileSignature(input));
  });

  it('keeps an arched back above its body instead of inventing an obstacle on the cushion', () => {
    const result = compileSeat({ ...inputFor('chair.red'), key: 'user-generated-arched-chair' });
    expect(result.problems).toEqual([]);
    const backs = result.model.parts.filter(p => p.part === 'back').sort((a, b) => a.z[0] - b.z[0]);
    expect(backs).toHaveLength(2);
    expect(backs[1].v).toEqual(backs[0].v);
    expect(backs[1].z[0]).toBe(backs[0].z[1]);
    expect(backs[1].u[0]).toBeGreaterThanOrEqual(backs[0].u[0]);
    // The source chair has one continuous back plane. Its decorative arch
    // must not push the sitter toward a second, nonexistent forward backrest.
    expect(result.model.sits[0][1]).toBeGreaterThan(0.4);
    const refined = fitModel(inputFor('chair.red'), result.model.parts, { shakes: 2 });
    const after = refined.model.parts.filter(p => p.part === 'back').sort((a, b) => a.z[0] - b.z[0]);
    expect(after[1].v).toEqual(after[0].v);
    expect(after[1].z[0]).toBe(after[0].z[1]);
    expect(after[1].u[0]).toBeGreaterThanOrEqual(after[0].u[0]);
  }, 90_000);

  it('rejects a frame that fits the outline by growing through the sitter', () => {
    const model = structuredClone(models['armchair.green']);
    const frame = model.parts.find(p => p.part === 'base')!;
    frame.z[1] = model.sits[0][2] + 8;
    const problems = seatProblems(modelView(catalog, 'armchair.green', 'se', model));
    expect(problems.some(p => p.includes('base/torso'))).toBe(true);
  });
});
