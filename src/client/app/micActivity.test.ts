import { describe, expect, it } from 'vitest';
import { MicActivity } from './micActivity';

/** Feed a level for a while (50 ms samples, like the real loop) and return the transitions. */
function feed(m: MicActivity, level: number, ms: number, from: number, jitter = 0) {
  let t = from;
  for (; t < from + ms; t += 50) m.tick(level + (jitter ? (Math.sin(t) * jitter) : 0), t);
  return t;
}

describe('talk detection from the mic level', () => {
  it('lights up for talking and goes quiet shortly after', () => {
    const changes: boolean[] = [];
    const m = new MicActivity((on) => changes.push(on));
    let t = feed(m, 0.004, 2000, 0, 0.001); // a quiet room
    expect(changes).toEqual([]);
    t = feed(m, 0.08, 800, t); // talking
    expect(changes).toEqual([true]);
    feed(m, 0.004, 1000, t); // stopped
    expect(changes).toEqual([true, false]);
  });

  it('ignores a single click or keypress', () => {
    const changes: boolean[] = [];
    const m = new MicActivity((on) => changes.push(on));
    let t = feed(m, 0.004, 1500, 0);
    t = feed(m, 0.2, 50, t); // one loud sample
    feed(m, 0.004, 1000, t);
    expect(changes).toEqual([]);
  });

  it('adapts to a steady hum instead of treating it as talking', () => {
    const changes: boolean[] = [];
    const m = new MicActivity((on) => changes.push(on));
    feed(m, 0.02, 6000, 0, 0.002); // a fan or an AC
    expect(changes.at(-1) ?? false).toBe(false);
  });
});
