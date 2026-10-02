import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clientMsgSchema } from '@shared/protocol';
import { MicActivity } from './micActivity';

const STEP = MicActivity.SAMPLE_MS;

/** Feed a level for a while (sampled like the real loop) and return the transitions. */
function feed(m: MicActivity, level: number, ms: number, from: number, jitter = 0) {
  let t = from;
  for (; t < from + ms; t += STEP) m.tick(level + (jitter ? (Math.sin(t) * jitter) : 0), t);
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
    t = feed(m, 0.2, STEP * 2, t); // a couple of loud samples (a click), not a run of voice
    feed(m, 0.004, 1000, t);
    expect(changes).toEqual([]);
  });

  it('is quick: lit within ~75 ms of voice, off within ~300 ms of quiet', () => {
    const changes: Array<[boolean, number]> = [];
    const m = new MicActivity((on) => changes.push([on, at]));
    let at = 0;
    let t = 0;
    for (; t < 1500; t += STEP) m.tick(0.004, (at = t));
    const spoke = t;
    for (; t < spoke + 600; t += STEP) m.tick(0.08, (at = t));
    const quiet = t;
    for (; t < quiet + 1000; t += STEP) m.tick(0.004, (at = t));
    expect(changes).toHaveLength(2);
    expect(changes[0][1] - spoke).toBeLessThanOrEqual(STEP * 3);
    expect(changes[1][1] - quiet).toBeLessThanOrEqual(325);
  });

  it('never sends audio: no recorder, no peer connection, no upload in the detector; the wire carries one boolean', () => {
    // the code, not its comments (which may well name the things it doesn't do)
    const src = readFileSync(new URL('./micActivity.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['MediaRecorder', 'RTCPeerConnection', 'WebSocket', 'fetch(', 'XMLHttpRequest', 'sendBeacon', '.destination', 'createMediaStreamDestination', 'ScriptProcessor', 'AudioWorklet'])
      expect(src.includes(banned), `micActivity.ts must not use ${banned}`).toBe(false);
    // the only message the talk light produces, and the server keeps nothing but the boolean
    const parsed = clientMsgSchema.safeParse({ t: 'speaking', on: true, audio: 'AAAA', samples: [0.1, 0.2] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ t: 'speaking', on: true });
  });

  it('adapts to a steady hum instead of treating it as talking', () => {
    const changes: boolean[] = [];
    const m = new MicActivity((on) => changes.push(on));
    feed(m, 0.02, 6000, 0, 0.002); // a fan or an AC
    expect(changes.at(-1) ?? false).toBe(false);
  });
});
