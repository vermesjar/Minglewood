/**
 * Tiny synthesized sound kit (WebAudio, no files). Off by default — a work tool should never
 * surprise anyone with noise.
 *
 * Designed to be easy on the ears:
 * - soft voices only (sine/marimba/bell tones, low-passed noise) — no square or saw waves;
 * - every sound is musical and in one key (C major pentatonic), so overlapping sounds harmonize;
 * - variation on every play (pitch, pattern, timing, level) so repeats never feel identical;
 * - a gentle bus: low-pass (no harsh highs), a little room reverb, a limiter, and a low master level;
 * - other people's actions play quieter than your own, and overlapping voices are capped.
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
let bus: GainNode | null = null;
let reverbSend: GainNode | null = null;
let enabled = false;
let volume = 0.5;
const lastAt = new Map<Sfx, number>();
const lastNote = new Map<string, number>();
let voices = 0;

/** Perceived loudness curve: the slider is linear to the ear, not to the amplitude. */
const masterLevel = () => 0.14 * volume * volume;

function ensureGraph() {
  if (ctx) return;
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
    return;
  }
  const c = ctx;
  bus = c.createGain();
  bus.gain.value = masterLevel();
  // Take the edge off: nothing above ~5 kHz, and never let a pile-up clip.
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 5200;
  tone.Q.value = 0.5;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -18;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  bus.connect(tone).connect(limiter).connect(c.destination);
  // A small, soft room so sounds sit in a space instead of poking out of the speakers.
  const verb = c.createConvolver();
  verb.buffer = roomImpulse(c, 1.4);
  reverbSend = c.createGain();
  reverbSend.gain.value = 0.28;
  const verbTone = c.createBiquadFilter();
  verbTone.type = 'lowpass';
  verbTone.frequency.value = 3200;
  reverbSend.connect(verb).connect(verbTone).connect(tone);
}

function roomImpulse(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on) {
    ensureGraph();
    void ctx?.resume();
  }
}

export function soundEnabled() {
  return enabled;
}

/** 0–1. */
export function setSoundVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (bus && ctx) bus.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.05);
}

/* ------------------------------------------------------------------ musical helpers */

// C major pentatonic, so everything that overlaps sounds like it belongs together.
const PENTA = [0, 2, 4, 7, 9];
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** A pentatonic note in [lo, hi] (MIDI), avoiding the one this sound used last time. */
function note(key: string, lo: number, hi: number): number {
  const options: number[] = [];
  for (let m = lo; m <= hi; m++) if (PENTA.includes(((m % 12) + 12) % 12)) options.push(m);
  const prev = lastNote.get(key);
  const pool = options.length > 1 ? options.filter((m) => m !== prev) : options;
  const m = pool[Math.floor(Math.random() * pool.length)];
  lastNote.set(key, m);
  return m;
}

/** Step `n` pentatonic degrees from a MIDI note. */
function step(m: number, n: number): number {
  let out = m;
  const dir = Math.sign(n);
  for (let i = 0; i < Math.abs(n); i++) {
    do out += dir;
    while (!PENTA.includes(((out % 12) + 12) % 12));
  }
  return out;
}

/* ------------------------------------------------------------------ voices */

interface VoiceOpts {
  at?: number;
  gain?: number;
  wet?: number;
}

function out(g: GainNode, wet: number) {
  g.connect(bus!);
  if (wet > 0 && reverbSend) {
    const s = ctx!.createGain();
    s.gain.value = wet;
    g.connect(s).connect(reverbSend);
  }
}

function track(stopAt: number) {
  voices++;
  setTimeout(() => (voices = Math.max(0, voices - 1)), (stopAt - ctx!.currentTime) * 1000 + 50);
}

/** Wooden mallet: a sine with a quick, soft overtone. Warm and short. */
function marimba(hz: number, o: VoiceOpts & { decay?: number } = {}) {
  const c = ctx!;
  const t = c.currentTime + (o.at ?? 0) + rand(0, 0.008);
  const decay = o.decay ?? rand(0.35, 0.55);
  const peak = (o.gain ?? 1) * rand(0.8, 1);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  const f = c.createOscillator();
  f.type = 'sine';
  f.frequency.value = hz * rand(0.997, 1.003);
  f.connect(g);
  const og = c.createGain();
  og.gain.setValueAtTime(peak * 0.18, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  const ov = c.createOscillator();
  ov.type = 'sine';
  ov.frequency.value = hz * 4;
  ov.connect(og);
  og.connect(g);
  out(g, o.wet ?? 0.6);
  f.start(t);
  ov.start(t);
  f.stop(t + decay + 0.05);
  ov.stop(t + 0.1);
  track(t + decay);
}

/** Soft bell: gentle FM with an inharmonic ratio, long airy tail. */
function bell(hz: number, o: VoiceOpts & { decay?: number } = {}) {
  const c = ctx!;
  const t = c.currentTime + (o.at ?? 0);
  const decay = o.decay ?? rand(0.9, 1.3);
  const peak = (o.gain ?? 1) * rand(0.75, 0.95);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  const car = c.createOscillator();
  car.frequency.value = hz;
  const mod = c.createOscillator();
  mod.frequency.value = hz * 3.5;
  const idx = c.createGain();
  idx.gain.setValueAtTime(hz * 0.9, t);
  idx.gain.exponentialRampToValueAtTime(hz * 0.05, t + decay * 0.6);
  mod.connect(idx).connect(car.frequency);
  car.connect(g);
  out(g, o.wet ?? 0.8);
  car.start(t);
  mod.start(t);
  car.stop(t + decay + 0.05);
  mod.stop(t + decay + 0.05);
  track(t + decay);
}

/** A pure sine with a pitch glide: bubbles, chirps, blips. */
function glide(from: number, to: number, dur: number, o: VoiceOpts = {}) {
  const c = ctx!;
  const t = c.currentTime + (o.at ?? 0);
  const g = c.createGain();
  const peak = (o.gain ?? 1) * rand(0.8, 1);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.min(0.012, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur * 0.8);
  osc.connect(g);
  out(g, o.wet ?? 0.4);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  track(t + dur);
}

let noiseBuf: AudioBuffer | null = null;
/** Pink-ish noise (softer than white), shared buffer. */
function pinkNoise(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
  }
  noiseBuf = buf;
  return buf;
}

/** Filtered noise with a soft envelope: breaths, whooshes, splashes, taps. */
function breath(dur: number, o: VoiceOpts & { freq: number; to?: number; q?: number; type?: BiquadFilterType; attack?: number }) {
  const c = ctx!;
  const t = c.currentTime + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = pinkNoise(c);
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 0.8;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const g = c.createGain();
  const peak = (o.gain ?? 1) * rand(0.8, 1);
  const attack = o.attack ?? Math.min(0.02, dur / 3);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g);
  out(g, o.wet ?? 0.5);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
  track(t + dur);
}

/* ------------------------------------------------------------------ the kit */

const MIN_GAP: Partial<Record<Sfx, number>> = { chirp: 900, splash: 400, door: 350, crackle: 600, purr: 1500 };

/**
 * Play a sound. `gain` scales it (use < 1 for other people's actions and far-away things).
 */
export function play(s: Sfx, gain = 1) {
  if (!enabled || !ctx || !bus || gain <= 0.01) return;
  const now = performance.now();
  if (now - (lastAt.get(s) ?? 0) < (MIN_GAP[s] ?? 90)) return;
  if (voices > 14) return;
  lastAt.set(s, now);
  const G = gain;
  switch (s) {
    case 'coin': {
      // Two bright mallet notes, rising a step or two — a tiny "ting-ting".
      const a = note('coin', 84, 91);
      marimba(midiHz(a), { gain: 0.38 * G });
      marimba(midiHz(step(a, Math.random() < 0.5 ? 1 : 2)), { gain: 0.32 * G, at: rand(0.07, 0.1) });
      break;
    }
    case 'sparkle': {
      // A little descending twinkle, different every time.
      let m = note('sparkle', 86, 96);
      const n = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        marimba(midiHz(m), { gain: (0.28 - i * 0.04) * G, at: i * rand(0.05, 0.075), decay: 0.4, wet: 0.9 });
        m = step(m, -(1 + Math.floor(Math.random() * 2)));
      }
      break;
    }
    case 'pop': {
      // Soft bubble: a short sine that dips in pitch.
      const f = midiHz(note('pop', 67, 79));
      glide(f * 1.5, f, rand(0.09, 0.13), { gain: 0.4 * G, wet: 0.25 });
      break;
    }
    case 'clap': {
      // High five: a warm, round "pat" and a happy two-note chime on top.
      breath(0.09, { freq: 1100, q: 0.9, gain: 0.55 * G, attack: 0.003, wet: 0.35 });
      breath(0.07, { freq: 1600, q: 1.2, gain: 0.3 * G, attack: 0.003, at: 0.018, wet: 0.35 });
      const root = note('clap', 72, 79);
      marimba(midiHz(root), { gain: 0.35 * G, at: 0.04 });
      marimba(midiHz(step(root, 2)), { gain: 0.3 * G, at: 0.1 });
      break;
    }
    case 'whoosh':
      // Paper plane: an airy sweep, no hiss.
      breath(rand(0.4, 0.55), { freq: 380, to: rand(1400, 1900), q: 1.4, gain: 0.8 * G, attack: 0.12, wet: 0.3 });
      break;
    case 'notes': {
      // A short, random pentatonic phrase — dance, jukebox.
      let m = note('notes', 67, 79);
      const n = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        marimba(midiHz(m), { gain: 0.35 * G, at: i * rand(0.11, 0.14) });
        m = step(m, [1, 1, 2, -1][Math.floor(Math.random() * 4)]);
      }
      break;
    }
    case 'bell': {
      const m = note('bell', 81, 88);
      bell(midiHz(m), { gain: 0.3 * G });
      if (Math.random() < 0.6) bell(midiHz(m), { gain: 0.2 * G, at: rand(0.16, 0.22) });
      break;
    }
    case 'blip': {
      // Arcade: a playful arpeggio, but round and low-passed — no buzzy square waves.
      let m = note('blip', 72, 84);
      const up = Math.random() < 0.7;
      for (let i = 0; i < 4; i++) {
        glide(midiHz(m), midiHz(m) * 1.01, 0.08, { gain: 0.26 * G, at: i * 0.065, wet: 0.3 });
        m = step(m, up ? 1 : -1);
      }
      break;
    }
    case 'crackle':
      // Fire: a handful of soft, low ticks.
      for (let i = 0; i < 5; i++) breath(0.03, { freq: rand(700, 1600), q: 2, gain: rand(0.8, 1.4) * G, at: rand(0, 0.35), attack: 0.002, wet: 0.2 });
      break;
    case 'splash':
      breath(rand(0.3, 0.45), { freq: 800, to: 260, q: 0.6, type: 'lowpass', gain: 0.6 * G, attack: 0.01, wet: 0.5 });
      break;
    case 'purr': {
      // A low, trembling hum.
      const c = ctx;
      const t = c.currentTime;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35 * G, t + 0.15);
      g.gain.linearRampToValueAtTime(0.0001, t + 1.1);
      const trem = c.createGain();
      trem.gain.value = 0.5;
      const lfo = c.createOscillator();
      lfo.frequency.value = rand(20, 26);
      const depth = c.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(trem.gain);
      const osc = c.createOscillator();
      osc.frequency.value = rand(85, 100);
      osc.connect(trem).connect(g);
      out(g, 0.1);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 1.2);
      lfo.stop(t + 1.2);
      track(t + 1.2);
      break;
    }
    case 'chirp': {
      // Birds taking off: two tiny, quiet whistles.
      const f = rand(2300, 3000);
      glide(f, f * rand(1.15, 1.3), 0.07, { gain: 0.14 * G, wet: 0.5 });
      glide(f * 1.1, f * rand(1.2, 1.4), 0.06, { gain: 0.11 * G, at: rand(0.08, 0.12), wet: 0.5 });
      break;
    }
    case 'door':
      // A soft wooden bump.
      glide(rand(150, 180), 90, 0.12, { gain: 0.35 * G, wet: 0.3 });
      breath(0.05, { freq: 500, q: 1, type: 'lowpass', gain: 0.2 * G, attack: 0.002, wet: 0.2 });
      break;
    case 'launch':
      // A rising rumble that fades as it climbs, then a quiet sparkle.
      breath(1.3, { freq: 160, to: 1200, q: 0.7, type: 'lowpass', gain: 0.35 * G, attack: 0.25, wet: 0.5 });
      setTimeout(() => play('sparkle', 0.7 * G), 1300);
      break;
  }
}
