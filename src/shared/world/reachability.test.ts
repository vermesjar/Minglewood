import { describe, expect, it } from 'vitest';
import { allScenes, TOWN_ID } from './index';
import { isSeat } from './scene';
import { WalkGrid } from './walkGrid';
import { findPath } from './pathfinding';
import { distanceToObject, interactionFor } from './interactions';

/** Every place to sit and every thing to play with must be reachable from where people arrive. */
describe('the world is usable', () => {
  for (const scene of allScenes().values()) {
    it(`${scene.id}: every seat and prop can be reached`, () => {
      const grid = new WalkGrid(scene, new Set(['balloons']));
      const start: [number, number] = [scene.spawn.x, scene.spawn.y];
      const unreachable: string[] = [];
      for (const o of scene.objects) {
        if (o.eventDecor && o.eventDecor !== 'balloons') continue;
        if (isSeat(o)) {
          if (!findPath(grid, start, [o.x, o.y], { allowGoal: true })) unreachable.push(`seat ${o.sprite}@${o.x},${o.y}`);
          continue;
        }
        const it = interactionFor(o);
        if (!it) continue;
        let ok = false;
        const r = Math.ceil(it.reach);
        for (let y = o.y - r; y < o.y + (o.d ?? 1) + r && !ok; y++) {
          for (let x = o.x - r; x < o.x + (o.w ?? 1) + r && !ok; x++) {
            if (grid.walkable(x, y) && distanceToObject(o, x, y) <= it.reach && findPath(grid, start, [x, y])) ok = true;
          }
        }
        if (!ok) unreachable.push(`${o.sprite}@${o.x},${o.y}`);
      }
      expect(unreachable).toEqual([]);
    });
  }

  it('the town has plenty of places to sit and play', () => {
    const town = allScenes().get(TOWN_ID)!;
    expect(town.objects.filter(isSeat).length).toBeGreaterThanOrEqual(50);
    expect(town.objects.filter((o) => interactionFor(o)).length).toBeGreaterThanOrEqual(20);
  });
});
