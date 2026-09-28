import { describe, expect, it } from 'vitest';
import { getScene } from './index';
import { placementProblem, decorObjects, type Decoration } from './decor';
import { livedScene } from './lived';

describe('team decoration placement', () => {
  const cafe = getScene('cafe')!;

  it('allows an open floor tile', () => {
    expect(placementProblem(cafe, 6, 6)).toBeNull();
  });

  it('keeps the doorway clear', () => {
    expect(placementProblem(cafe, 0, cafe.interior!.doorY)).toMatch(/doorway/);
    expect(placementProblem(cafe, 1, cafe.interior!.doorY + 1)).toMatch(/doorway/);
  });

  it('rejects occupied tiles and furniture', () => {
    expect(placementProblem(cafe, 4, 4)).toMatch(/already there/); // table
    expect(placementProblem(cafe, 3, 4)).toMatch(/already there/); // chair (seat)
    expect(placementProblem(cafe, 6, 6, new Set(['6,6']))).toMatch(/standing/);
  });

  it('never lets decorations cut anyone off from a seat', () => {
    // Surround the chair at (4,5) on its open sides one by one; the last blocking piece must be refused.
    const decos: Decoration[] = [];
    let refused = false;
    for (const [x, y] of [[3, 5], [5, 5], [4, 6], [3, 6], [5, 6]] as Array<[number, number]>) {
      const scene = livedScene(cafe, [], decos);
      const p = placementProblem(scene, x, y);
      if (p) {
        refused = true;
        break;
      }
      decos.push({ id: `${x}${y}`, roomId: 'cafe', itemId: 'plant-small', x, y, placedBy: 'm', placedAt: '' });
    }
    expect(refused).toBe(true);
  });

  it('turns placements into scene objects, sit-able where it makes sense', () => {
    const objs = decorObjects('cafe', [
      { id: 'a', roomId: 'cafe', itemId: 'beanbag-orange', x: 6, y: 6, placedBy: 'm', placedAt: '' },
      { id: 'b', roomId: 'eng', itemId: 'lamp', x: 1, y: 1, placedBy: 'm', placedAt: '' },
    ]);
    expect(objs).toHaveLength(1);
    expect(objs[0].actions?.[0].kind).toBe('sit');
  });
});
