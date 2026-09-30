import { describe, expect, it } from 'vitest';
import RIGS from '../../../../art/seat-rigs.json';
import { rigShapeProblems, type SeatRig, type SeatRigs } from '@shared/world/seatRigs';
import { composeRig, RIG_LOOKS, seatedSitters, type RigView } from './seatRig';

/** A plain seat: a 60 × 60 block of one colour, its anchor at the top middle. */
function block(): RigView {
  const w = 60;
  const h = 60;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([90, 60, 30, 255], i * 4);
  return { art: { px: { w, h, d }, ax: 30, ay: 0 }, facing: 'ne', footprint: [1, 1], style: 'chair', seat: 12, backrest: true, arms: false };
}

describe('the seat rig compositor', () => {
  it('draws the seat over its sitter only inside the front polygons, and never makes a hole in them', () => {
    const v = block();
    const rig: SeatRig = { hips: [[30, 40]], front: [[[0, 30], [60, 30], [60, 60], [0, 60]]], legs: 'hide' };
    const c = composeRig(v.art, rig, seatedSitters(v, rig, RIG_LOOKS), { size: [120, 160], origin: [30, 80] });
    expect(c.stray).toBe(0);
    expect(c.sitters[0].holes).toBe(0);
    // below the polygon's top edge the seat covers the sitter; above it the sitter shows
    let over = 0;
    let shows = 0;
    for (let y = 0; y < 160; y++)
      for (let x = 0; x < 120; x++) {
        const w = c.who[y * 120 + x];
        if (w === 2 && y - 80 < 30) over++;
        if (w === 3 && y - 80 >= 30) shows++;
      }
    expect(over).toBe(0);
    expect(shows).toBe(0);
  });

  it('keeps a capped cover off every pixel of a sitter above it', () => {
    const v = block();
    // the whole seat is "in front", but the cover is capped 10 px above the hips
    const rig: SeatRig = { hips: [[30, 50]], front: [[[0, 0], [60, 0], [60, 60], [0, 60]]], cover: 10, legs: 'hide' };
    const sitters = seatedSitters(v, rig, RIG_LOOKS);
    const c = composeRig(v.art, rig, sitters, { size: [120, 160], origin: [30, 80] });
    // the sitter's own pixels: the same composition with nothing drawn over them
    const bare = composeRig(v.art, { ...rig, front: [] }, sitters, { size: [120, 160], origin: [30, 80] });
    const capRow = 50 - 10; // drawing rows above this are the sitter's
    let coveredAbove = 0;
    let coveredBelow = 0;
    for (let y = 0; y < 160; y++)
      for (let x = 0; x < 120; x++) {
        if (bare.who[y * 120 + x] !== 3) continue;
        if (c.who[y * 120 + x] === 2) {
          if (y - 80 < capRow) coveredAbove++;
          else coveredBelow++;
        }
      }
    expect(coveredAbove).toBe(0);
    expect(coveredBelow).toBeGreaterThan(100);
    expect(c.sitters[0].upperShown / c.sitters[0].upper).toBeGreaterThan(0.95);
  });
});

describe('art/seat-rigs.json', () => {
  it('is well formed: every view a rig of the standard, audited on a day', () => {
    const rigs = RIGS as unknown as SeatRigs;
    expect(Object.keys(rigs).length).toBeGreaterThan(20);
    for (const [key, views] of Object.entries(rigs))
      for (const [f, rig] of Object.entries(views)) {
        expect(rigShapeProblems(rig), `${key} ${f}`).toEqual([]);
        expect(rig!.drawing, `${key} ${f}`).toMatch(/^[0-9a-f]{8}$/);
      }
  });
});
