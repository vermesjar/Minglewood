import { describe, expect, it } from 'vitest';
import { compileFront, compileRig, isCompiled, PART, partsFromLabels, partsFromString, partsToString, regions, transferParts, armSides, type PartImg } from './seatParts';

/** A drawing of solid bands, each its own colour, split by a dark outline column: [x0, x1, rgb] per band. */
function bands(w: number, h: number, spans: Array<[number, number, [number, number, number]]>): PartImg {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (const [x0, x1, c] of spans)
      for (let x = x0; x < x1; x++) d.set([...c, 255], (y * w + x) * 4);
  return { w, h, d };
}

describe('seat parts', () => {
  const img = bands(30, 20, [
    [0, 9, [200, 60, 60]],
    [9, 10, [5, 5, 5]],
    [10, 19, [60, 60, 200]],
    [19, 20, [5, 5, 5]],
    [20, 30, [60, 200, 60]],
  ]);

  it('splits a drawing into its colour regions, the outline joining a neighbour, numbered in reading order', () => {
    const lab = regions(img);
    expect(Math.max(...lab)).toBe(3);
    expect(lab[0]).toBe(1);
    expect(lab[15]).toBe(2);
    expect(lab[25]).toBe(3);
    expect(lab.every((l) => l > 0)).toBe(true);
  });

  it('turns labels into a part map (unlisted regions are other) and round-trips it as text', () => {
    const lab = regions(img);
    const parts = partsFromLabels(lab, img.w, { back: [1], seat: [2] });
    expect(parts[0]).toBe(PART.back);
    expect(parts[15]).toBe(PART.seat);
    expect(parts[25]).toBe(PART.other);
    expect(partsFromString(partsToString(parts), parts.length)).toEqual(parts);
    expect(partsFromString('9*3', 3)).toBeNull();
    // paint: a polygon sets a part over whatever region is under it
    const painted = partsFromLabels(lab, img.w, { back: [1], paint: [{ part: 'leg', poly: [[0, 10], [9, 10], [9, 20], [0, 20]] }] });
    expect(painted[15 * img.w + 3]).toBe(PART.leg);
    expect(painted[3]).toBe(PART.back);
  });

  it('compiles by the rules: from behind the back and the seat below the hips; from the front only the near arm', () => {
    const w = 30;
    const h = 20;
    const parts = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) parts[y * w + x] = x < 10 ? PART.back : x < 20 ? PART.seat : PART.arm;
    const hips: Array<[number, number]> = [[15, 10]];
    const behind = compileFront('ne', w, h, parts, hips);
    expect(behind[5 * w + 2]).toBe(1); // the back, always
    expect(behind[5 * w + 15]).toBe(0); // the seat above the hips
    expect(behind[15 * w + 15]).toBe(1); // …and below them
    // the arm lies right of the sitter: in ne (near: down-right) it's the near arm, in front below its top two rows
    expect(armSides('ne', w, h, parts, hips)[10 * w + 25]).toBe(1);
    expect(behind[0 * w + 25]).toBe(0);
    expect(behind[10 * w + 25]).toBe(1);
    const front = compileFront('se', w, h, parts, hips);
    // in se (near: down-left) the right arm is the far one: nothing is in front
    expect(front.some((v) => v === 1)).toBe(false);
    const rig = compileRig({ hips, front: [], legs: 'show' }, 'ne', w, h, parts).rig;
    expect(rig.legs).toBe('hide');
    expect(isCompiled(rig, 'ne', w, h, parts)).toBe(true);
    // a backless seat shows its sitters' legs from behind
    const backless = parts.map((p) => (p === PART.back ? PART.seat : p));
    expect(compileRig({ hips, front: [], legs: 'show' }, 'ne', w, h, backless).rig.legs).toBe('show');
  });

  it('copies a part map to a variant drawn in the same shape', () => {
    const lab = regions(img);
    const parts = partsFromLabels(lab, img.w, { back: [1], seat: [2], arm: [3] });
    const variant = bands(30, 20, [
      [0, 9, [120, 40, 160]],
      [9, 10, [5, 5, 5]],
      [10, 19, [40, 160, 120]],
      [19, 20, [5, 5, 5]],
      [20, 30, [160, 120, 40]],
    ]);
    expect(transferParts(parts, img, variant)).toEqual(parts);
  });
});
