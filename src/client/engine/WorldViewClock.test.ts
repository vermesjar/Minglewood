import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldView } from './WorldView';

interface ClockHarness {
  frame(t: number): void; draw(): void; drawFrame(): void; update(dt?: number): void;
  animationNow(): number; frameAnimationTime: number | undefined;
  pose(a: unknown): string; legsOf(a: unknown): unknown; footPoint(a: unknown): unknown; seatK(a: unknown): number;
  objById(): unknown; modelOf(): unknown; modelSit(): unknown; seated(a: unknown): {pose: string};
}

// Drive the real frame/draw/pose/leg entrypoints with a clock that crosses a
// transition between calls. Only canvas painting and model lookup are replaced.
function fixture() {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  const canvas = { getContext: () => ({}), getBoundingClientRect: () => ({ width: 800, height: 600 }), addEventListener() {} };
  // Private methods are deliberately reached to exercise the live renderer's
  // clock boundary without constructing a second implementation of its clock.
  const world = new WorldView(canvas as unknown as HTMLCanvasElement, {} as never) as unknown as ClockHarness;
  const actor = { x: 1, y: 0, occ: { avatar: {}, sittingOn: null }, moving: false,
    seat: { objId: 'seat', spot: { x: 0, y: 0, facing: 'nw' }, from: 0, to: 1, start: 0 },
    glide: { x: 0, y: 0, start: 0, ms: 1000 } };
  world.objById = () => ({ id: 'seat' });
  world.modelOf = () => ({ model: { parts: [] }, style: 'lounge' });
  world.modelSit = () => ({ sit: [.5, .5, 11] });
  // Boundary at the sampled k: same decision actual seatPose/legsOf consume.
  world.seated = (a: unknown) => ({ pose: world.seatK(a) > .5 ? 'sit-lounge' : 'crouch' });
  return { world, actor };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('WorldView frame clock consistency', () => {
  it('keeps pose, legs and foot placement at one instant while the monotonic clock advances', () => {
    const { world, actor } = fixture();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 50));
    const observed: unknown[] = [];
    const sample = () => observed.push([world.pose(actor), world.legsOf(actor), world.footPoint(actor), world.seatK(actor)]);
    world.update = () => { sample(); performance.now(); };
    world.drawFrame = () => { sample(); performance.now(); sample(); };
    world.frame(1000);
    expect(observed).toHaveLength(3);
    expect(observed[1]).toEqual(observed[0]);
    expect(observed[2]).toEqual(observed[0]);
    expect(time).toBeGreaterThan(100);
    expect((observed[0] as unknown[])[0]).toBe('crouch');
    expect((observed[0] as unknown[])[1]).toBeUndefined();
    expect(world.frameAnimationTime).toBeUndefined();
    expect(world.pose(actor)).toBe('sit-lounge');
  });

  it('restores outer draw time after nested draws and clears it after a throw', () => {
    const { world } = fixture();
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => ++time);
    const instants: number[] = [];
    let nested = false;
    world.drawFrame = () => {
      instants.push(world.animationNow());
      performance.now();
      if (!nested) { nested = true; world.draw(); instants.push(world.animationNow()); }
    };
    world.draw();
    expect(new Set(instants).size).toBe(1);
    expect(world.frameAnimationTime).toBeUndefined();
    world.drawFrame = () => { throw new Error('paint failed'); };
    expect(() => world.draw()).toThrow('paint failed');
    expect(world.frameAnimationTime).toBeUndefined();
    const after = world.animationNow();
    expect(after).toBeGreaterThan(instants[0]);
    world.update = () => { throw new Error('update failed'); };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    world.frame(1000);
    expect(world.frameAnimationTime).toBeUndefined();
    expect(world.animationNow()).toBeGreaterThan(after);
  });
});
