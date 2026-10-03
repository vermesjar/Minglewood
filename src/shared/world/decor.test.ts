import { describe, expect, it } from 'vitest';
import { getScene } from './index';
import { DECOR_CATALOG, decorObject, decorObjects, placementProblem, type Decoration } from './decor';
import { livedScene } from './lived';

describe('team decoration placement', () => {
  const cafe = getScene('cafe')!;

  it('allows an open floor tile', () => {
    expect(placementProblem(cafe, 6, 6)).toBeNull();
  });

  it("offers the Design Lab's coffee machine lamp and places it like any floor piece", () => {
    const item = DECOR_CATALOG.find((i) => i.id === 'coffee-machine-lamp')!;
    expect(item).toMatchObject({ sprite: 'coffee-machine-lamp', anySide: true });
    expect(placementProblem(cafe, 2, 6)).toBeNull();
    const obj = decorObject({ id: 'd1', roomId: 'cafe', itemId: 'coffee-machine-lamp', x: 2, y: 6, facing: 'sw', placedBy: 'm1', placedAt: '2026-10-03T00:00:00Z' });
    expect(obj).toMatchObject({ sprite: 'coffee-machine-lamp', x: 2, y: 6, facing: 'sw' });
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
    // Surround the chair at (5,4) (facing the table at 4,4) on its open sides one by one; the last blocking piece
    // must be refused.
    const decos: Decoration[] = [];
    let refused = false;
    for (const [x, y] of [[6, 4], [5, 3], [5, 5], [6, 3], [6, 5]] as Array<[number, number]>) {
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
