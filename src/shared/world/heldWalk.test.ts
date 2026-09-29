import { describe, expect, it } from 'vitest';
import { heldDelta, planHeldWalk, stepFrom } from './heldWalk';
import { positionAlong, WALK_SPEED, type Tile } from './pathfinding';

/** Open 10×10 floor with optional blocked tiles. */
const floor = (blocked: Tile[] = []) => ({
  walkable: (x: number, y: number) => x >= 0 && y >= 0 && x < 10 && y < 10 && !blocked.some((b) => b[0] === x && b[1] === y),
});
const msFor = (tiles: number) => (tiles / WALK_SPEED) * 1000;

describe('held-key walking', () => {
  it('maps one key to a straight screen direction and two keys to a screen diagonal', () => {
    expect(heldDelta(['up'])).toEqual([-1, -1]);
    expect(heldDelta(['right'])).toEqual([1, -1]);
    expect(heldDelta(['up', 'right'])).toEqual([0, -1]);
    expect(heldDelta(['down', 'left'])).toEqual([0, 1]);
    expect(heldDelta(['up', 'down'])).toBeNull();
  });

  it('slides along a wall instead of stopping when a diagonal is blocked', () => {
    expect(stepFrom(floor([[4, 4]]), [5, 5], [-1, -1])).toEqual([4, 5]);
    expect(stepFrom(floor([[4, 4]]), [5, 5], [-1, -1], [0, -1])).toEqual([5, 4]);
    expect(stepFrom(floor([[4, 4], [4, 5], [5, 4]]), [5, 5], [-1, -1])).toBeNull();
  });

  it('starts walking immediately from a standstill', () => {
    expect(planHeldWalk(null, [5, 5], 1000, [1, 0], floor())).toEqual({ path: [[5, 5], [6, 5]], startedAt: 1000 });
  });

  it('queues the next tile before the current one ends, without moving the walker', () => {
    const cur = { path: [[5, 5], [6, 5]] as Tile[], startedAt: 0 };
    expect(planHeldWalk(cur, [5, 5], msFor(0.2), [1, 0], floor())).toBeNull();
    const now = msFor(0.7);
    const next = planHeldWalk(cur, [6, 5], now, [1, 0], floor())!;
    expect(next.path).toEqual([[5, 5], [6, 5], [7, 5]]);
    expect(positionAlong(next.path, now - next.startedAt).x).toBeCloseTo(positionAlong(cur.path, now).x, 6);
  });

  it('drops the unstarted tail and rebases the start when the walker is further along', () => {
    const cur = { path: [[5, 5], [6, 5], [7, 5], [8, 5]] as Tile[], startedAt: 0 };
    const now = msFor(1.5);
    const stop = planHeldWalk(cur, [7, 5], now, null, floor())!;
    expect(stop.path).toEqual([[6, 5], [7, 5]]);
    expect(stop.startedAt).toBeCloseTo(msFor(1), 6);
    expect(positionAlong(stop.path, now - stop.startedAt).x).toBeCloseTo(6.5, 6);
  });

  it('turns straight around mid-tile', () => {
    const cur = { path: [[5, 5], [6, 5]] as Tile[], startedAt: 0 };
    const now = msFor(0.4);
    const back = planHeldWalk(cur, [5, 5], now, [-1, 0], floor())!;
    expect(back.path).toEqual([[6, 5], [5, 5]]);
    expect(positionAlong(back.path, now - back.startedAt).x).toBeCloseTo(5.4, 6);
  });
});
