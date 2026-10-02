import { describe, expect, it } from 'vitest';
import { currentStep, positionAlong, reroute, WALK_SPEED, type Tile } from './pathfinding';

const msFor = (tiles: number) => (tiles / WALK_SPEED) * 1000;
/** A straight route from `from` to `goal` on an open floor (same row), as findPath would give it. */
const straight = (goal: Tile) => (from: Tile): Tile[] => {
  const out: Tile[] = [];
  const d = Math.sign(goal[0] - from[0]);
  for (let x = from[0]; x !== goal[0]; x += d) out.push([x, from[1]]);
  out.push(goal);
  return out;
};

describe('rerouting a walker mid-stride', () => {
  const cur = { path: [[5, 5], [6, 5], [7, 5], [8, 5]] as Tile[], startedAt: 0 };

  it('finds the step in progress and when the walker was at its start', () => {
    expect(currentStep(cur, msFor(0.3))).toEqual({ from: [5, 5], to: [6, 5], index: 0, startedAt: 0 });
    const s = currentStep(cur, msFor(1.4))!;
    expect(s.from).toEqual([6, 5]);
    expect(s.to).toEqual([7, 5]);
    expect(s.index).toBe(1);
    expect(s.startedAt).toBeCloseTo(msFor(1), 6);
    expect(currentStep(cur, msFor(3))).toBeNull();
    expect(currentStep(cur, msFor(9))).toBeNull();
  });

  it('starts from the tile when standing still', () => {
    expect(reroute(null, [5, 5], 1000, straight([7, 5]))).toEqual({ path: [[5, 5], [6, 5], [7, 5]], startedAt: 1000, same: false });
  });

  it('finishes the step in progress, so the walker does not jump, then continues the new way', () => {
    // 1.4 tiles along, heading for [8,5]; a click behind, on [4,5]
    const now = msFor(1.4);
    const r = reroute(cur, [6, 5], now, straight([4, 5]))!;
    expect(r.path).toEqual([[6, 5], [7, 5], [6, 5], [5, 5], [4, 5]]);
    expect(r.same).toBe(false);
    const before = positionAlong(cur.path, now);
    const after = positionAlong(r.path, now - r.startedAt);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // and the rebased start is never before the walk's own start (the server refuses that as skipping ahead)
    expect(r.startedAt).toBeGreaterThanOrEqual(cur.startedAt);
  });

  it('recognises the destination it is already walking to, however often it is clicked', () => {
    for (const t of [0.1, 0.9, 1.5, 2.2]) {
      const r = reroute(cur, [5, 5], msFor(t), straight([8, 5]))!;
      expect(r.same).toBe(true);
      expect(positionAlong(r.path, msFor(t) - r.startedAt).x).toBeCloseTo(positionAlong(cur.path, msFor(t)).x, 6);
    }
    // a different destination is new
    expect(reroute(cur, [5, 5], msFor(0.5), straight([9, 5]))!.same).toBe(false);
  });

  it('is just the step in progress when the click is on the tile ahead', () => {
    const r = reroute(cur, [5, 5], msFor(0.5), straight([6, 5]))!;
    expect(r.path).toEqual([[5, 5], [6, 5]]);
    expect(r.same).toBe(false);
  });

  it('reports no way when the route cannot be found', () => {
    expect(reroute(cur, [5, 5], msFor(0.5), () => null)).toBeNull();
    expect(reroute(null, [5, 5], 0, () => null)).toBeNull();
  });
});
