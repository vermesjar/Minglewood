/**
 * Tiny synthesized sound kit (WebAudio, no files). Off by default — a work tool should never
 * surprise anyone with noise — and always quiet. Toggle in the action bar or settings.
 */
export type Sfx =
  | 'coin'
  | 'pop'
  | 'clap'
  | 'whoosh'
  | 'notes'
  | 'bell'
  | 'blip'
  | 'crackle'
  | 'splash'
  | 'purr'
  | 'chirp'
  | 'door'
  | 'sparkle'
  | 'launch';

let ctx: AudioContext | null = null;
let enabled = false;
const lastAt = new Map<Sfx, number>();

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on && !ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
  }
  if (on) void ctx?.resume();
}

export function soundEnabled() {
  return enabled;
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; at?: number; slide?: number } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + (opts.at ?? 0);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * opts.slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.06, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, opts: { vol?: number; at?: number; freq?: number; q?: number; sweep?: number } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + (opts.at ?? 0);
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(opts.freq ?? 1800, t);
  if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
  f.Q.value = opts.q ?? 1;
  const g = ctx.createGain();
  g.gain.value = opts.vol ?? 0.08;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t);
}

export function play(s: Sfx) {
  if (!enabled || !ctx) return;
  const now = performance.now();
  if (now - (lastAt.get(s) ?? 0) < 60) return;
  lastAt.set(s, now);
  switch (s) {
    case 'coin':
      tone(1320, 0.12, { type: 'square', vol: 0.03 });
      tone(1760, 0.3, { type: 'square', vol: 0.03, at: 0.08 });
      break;
    case 'pop':
      tone(520, 0.08, { vol: 0.07, slide: 1.8 });
      break;
    case 'clap':
      noise(0.09, { vol: 0.16, freq: 1600, q: 0.8 });
      noise(0.07, { vol: 0.1, freq: 2400, q: 0.8, at: 0.03 });
      tone(880, 0.2, { vol: 0.03, at: 0.02 });
      tone(1320, 0.25, { vol: 0.025, at: 0.06 });
      break;
    case 'whoosh':
      noise(0.45, { vol: 0.06, freq: 500, sweep: 2600, q: 1.2 });
      break;
    case 'notes':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.04, at: i * 0.09 }));
      break;
    case 'bell':
      tone(1568, 0.5, { type: 'triangle', vol: 0.04 });
      tone(1568, 0.5, { type: 'triangle', vol: 0.03, at: 0.18 });
      break;
    case 'blip':
      [440, 660, 880, 1320].forEach((f, i) => tone(f, 0.07, { type: 'square', vol: 0.025, at: i * 0.06 }));
      break;
    case 'crackle':
      for (let i = 0; i < 6; i++) noise(0.04, { vol: 0.07, freq: 3000 + Math.random() * 2000, q: 2, at: i * 0.05 + Math.random() * 0.03 });
      break;
    case 'splash':
      noise(0.25, { vol: 0.05, freq: 900, sweep: 300, q: 0.7 });
      break;
    case 'purr':
      for (let i = 0; i < 5; i++) tone(55, 0.12, { type: 'sawtooth', vol: 0.02, at: i * 0.14 });
      break;
    case 'chirp':
      tone(2600, 0.06, { vol: 0.025, slide: 1.4 });
      tone(3000, 0.06, { vol: 0.02, slide: 1.3, at: 0.09 });
      break;
    case 'door':
      noise(0.12, { vol: 0.05, freq: 400, q: 0.8 });
      tone(180, 0.12, { vol: 0.03, at: 0.05 });
      break;
    case 'sparkle':
      [1760, 2217, 2637].forEach((f, i) => tone(f, 0.18, { vol: 0.02, at: i * 0.05 }));
      break;
    case 'launch':
      noise(1.2, { vol: 0.08, freq: 300, sweep: 3000, q: 0.6 });
      break;
  }
}
