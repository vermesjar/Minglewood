/**
 * "Am I talking?" from the microphone's loudness, on this device only.
 *
 * Discord doesn't tell apps who is speaking (that needs a partner-only scope), so members can opt in to
 * letting their own browser watch their mic level while they're in voice. Only a yes/no ("talking now")
 * ever leaves the page — no audio is recorded, stored or sent. Works best with headphones: with speakers,
 * other people's voices coming out of them can be heard by the mic.
 */
export class MicActivity {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private timer: number | null = null;
  private talking = false;
  /** Running estimate of the room's background level. */
  private floor = 0.008;
  private loudFrames = 0;
  private lastLoud = 0;

  constructor(private readonly onChange: (talking: boolean) => void) {}

  get active() {
    return !!this.stream;
  }

  /** Ask for the mic and start listening. Resolves false if the person (or the browser) says no. */
  async start(): Promise<boolean> {
    if (this.stream) return true;
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
    } catch {
      return false;
    }
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser); // never connected to the speakers
    const buf = new Float32Array(analyser.fftSize);
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      this.tick(Math.sqrt(sum / buf.length), performance.now());
    }, 50);
    return true;
  }

  /** One level sample (RMS, 0–1). Exposed for tests. */
  tick(rms: number, now: number) {
    // The floor follows quiet stretches quickly and loud ones very slowly, so talking doesn't raise it.
    if (rms < this.floor * 1.6) this.floor = this.floor * 0.95 + rms * 0.05;
    else this.floor *= 1.0015;
    this.floor = Math.min(Math.max(this.floor, 0.002), 0.05);
    const loud = rms > Math.max(0.012, this.floor * 3.2);
    if (loud) {
      this.loudFrames++;
      this.lastLoud = now;
    } else this.loudFrames = 0; // starting needs an unbroken run of voice
    // Start after ~150 ms of unbroken voice (a click or a keypress isn't talking); stop ~450 ms after it goes quiet.
    const next = this.talking ? now - this.lastLoud < 450 : this.loudFrames >= 3;
    if (next !== this.talking) {
      this.talking = next;
      this.onChange(next);
    }
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    if (this.talking) {
      this.talking = false;
      this.onChange(false);
    }
  }
}
