import { describe, expect, it } from 'vitest';
import { drawingPrint } from '@shared/world/seatFigure';
import type { SeatModel, SeatSurfaceMap } from '@shared/world/seatModels';
import { resolveSeatSurfaceMap, seatDepth, seatSurfaceMapProblems, surfacePartsSignature, type ModelView } from './seatModel';

function fixture(): { view: ModelView; map: SeatSurfaceMap } {
  const model: SeatModel = { size: [1, 1], sits: [[0.5, 0.5, 10]], parts: [
    { part: 'seat', u: [0.4, 0.6], v: [0.4, 0.6], z: [8, 10] },
    { part: 'back', u: [0, 1], v: [0.7, 0.9], z: [8, 20] },
    { part: 'arm', u: [0, 0.2], v: [0, 1], z: [4, 15] },
    { part: 'arm', u: [0.8, 1], v: [0, 1], z: [4, 15] },
  ] };
  const px = { w: 3, h: 1, d: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128, 0, 0, 0, 0]) };
  const map: SeatSurfaceMap = { version: 1, width: px.w, height: px.h, drawing: drawingPrint(px.w, px.h, px.d), modelParts: surfacePartsSignature(model), labels: [1, 7, 0] };
  return { view: { model, style: 'chair', facing: 'nw', art: { px, ax: 1, ay: 20 } }, map };
}

describe('source-pixel seating surfaces', () => {
  it('uses explicit support and arm identity even outside their undersized proxy boxes', () => {
    const { view, map } = fixture();
    view.model.surfaces = { nw: map };
    const d = seatDepth(view);
    expect(d.source).toBe('semantic');
    expect([...d.part]).toEqual([0, 2, -1]);
    expect([...d.how]).toEqual([3, 3, 0]);
    expect(d.z[0]).toBe(10);
    expect(d.z[1]).toBe(15);
    expect(Number.isNaN(d.z[2])).toBe(true);
  });

  it('requires every nonzero-alpha pixel, including antialiased edges, exactly once', () => {
    const { view, map } = fixture();
    expect(seatSurfaceMapProblems(map, view.art.px, view.model)).toEqual([]);
    expect(seatSurfaceMapProblems({ ...map, labels: [1, 0, 1] }, view.art.px, view.model)).toEqual([
      'Surface map leaves 1 opaque pixels unlabeled.', 'Surface map labels 1 transparent pixels.',
    ]);
    for (const labels of [[1], [1, -1, 0], [1, 13, 0], [1, 1.5, 0]])
      expect(seatSurfaceMapProblems({ ...map, labels }, view.art.px, view.model).length).toBeGreaterThan(0);
  });

  it('rejects changed drawings and reordered/refitted geometry instead of silently guessing', () => {
    const { view, map } = fixture();
    view.model.surfaces = { nw: map };
    seatDepth(view); // Warm cache must not bypass fingerprint validation.
    view.art.px.d[0]++;
    expect(() => seatDepth(view)).toThrow('drawing fingerprint is stale');
    view.art.px.d[0]--;
    view.model.parts[0].z[1]++;
    expect(() => seatDepth(view)).toThrow('stale seating surface map');
  });

  it('mirrors raster labels and swaps the physical left/right arms only for matching mirrored art', () => {
    const { view, map } = fixture();
    view.model.surfaces = { nw: map };
    const d = view.art.px.d;
    view.art.px = { ...view.art.px, d: new Uint8Array([...d.subarray(8, 12), ...d.subarray(4, 8), ...d.subarray(0, 4)]) };
    view.facing = 'ne';
    expect(resolveSeatSurfaceMap(view)!.labels).toEqual([0, 10, 1]);
    expect([...seatDepth(view).part]).toEqual([-1, 3, 0]);
    view.art.px.d[8]++;
    expect(() => seatDepth(view)).toThrow('drawing fingerprint is stale');
  });

  it('requires explicit maps for asymmetric mirrored parts and missing front/rear views', () => {
    const { view, map } = fixture();
    view.model.parts[3].u[0] = 0.7;
    map.modelParts = surfacePartsSignature(view.model);
    view.model.surfaces = { nw: map };
    const d = view.art.px.d;
    view.art.px = { ...view.art.px, d: new Uint8Array([...d.subarray(8, 12), ...d.subarray(4, 8), ...d.subarray(0, 4)]) };
    view.facing = 'ne';
    expect(() => seatDepth(view)).toThrow('asymmetric model part');
    view.facing = 'se';
    expect(() => seatDepth(view)).toThrow('Missing seating surface map');
  });

  it('identifies legacy inference explicitly and does not mistake an empty map set for legacy', () => {
    const { view } = fixture();
    expect(seatDepth(view).source).toBe('proxy');
    view.model.surfaces = {};
    expect(() => seatDepth(view)).toThrow('surface maps are empty');
  });
});
