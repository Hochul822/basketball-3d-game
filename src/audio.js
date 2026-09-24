// Procedural Web Audio sound effects + a lo-fi street beat. No assets needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.nextBeat = 0;
    this.step = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.28;
    this.music.connect(this.master);
    // noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    src.connect(bp);
    bp.connect(this.crowdGain);
    this.crowdGain.connect(this.sfx);
    src.start();
    this.nextBeat = this.ctx.currentTime + 0.1;
  }

  get t() { return this.ctx.currentTime; }

  env(g, t, a, peak, dcy) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  osc(type, freq, dur, vol, { to, delay = 0, dest } = {}) {
    if (!this.ctx) return;
    const t = this.t + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.env(g, t, 0.005, vol, dur);
    o.connect(g);
    g.connect(dest || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseHit(dur, vol, { type = 'lowpass', freq = 1000, q = 1, delay = 0, to, dest } = {}) {
    if (!this.ctx) return;
    const t = this.t + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfx);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  bounce(v = 1) {
    this.osc('sine', 150, 0.12, 0.5 * v, { to: 70 });
    this.noiseHit(0.05, 0.25 * v, { freq: 700 });
  }
  squeak() { this.osc('sine', 2200 + Math.random() * 900, 0.08, 0.05, { to: 2900 }); }
  swish() { this.noiseHit(0.35, 0.35, { type: 'bandpass', freq: 3000, q: 0.8, to: 900 }); }
  rim(v = 1) {
    this.osc('triangle', 520, 0.35, 0.2 * v);
    this.osc('square', 1310, 0.15, 0.05 * v);
    this.noiseHit(0.08, 0.2 * v, { type: 'highpass', freq: 2500 });
  }
  board() { this.noiseHit(0.14, 0.35, { freq: 500 }); this.osc('sine', 110, 0.15, 0.25); }
  pass() { this.noiseHit(0.1, 0.12, { type: 'bandpass', freq: 1500, to: 600 }); }
  catch_() { this.noiseHit(0.05, 0.3, { freq: 900 }); }
  whoosh(v = 1) { this.noiseHit(0.3, 0.3 * v, { type: 'bandpass', freq: 400, q: 1.2, to: 2400 }); }
  steal() { this.noiseHit(0.06, 0.3, { freq: 1500 }); this.osc('square', 880, 0.08, 0.06, { to: 1500 }); }
  block() { this.osc('sine', 90, 0.3, 0.6, { to: 40 }); this.noiseHit(0.18, 0.5, { freq: 1200 }); }
  dunk(power = 1) {
    this.osc('sine', 80, 0.5, 0.8 * power, { to: 35 });
    this.noiseHit(0.3, 0.6 * power, { freq: 1800, to: 300 });
    this.rim(1.2);
    this.cheer(0.9 + power * 0.3);
  }
  boom() {
    this.osc('sine', 60, 1.2, 1.0, { to: 25 });
    this.osc('sawtooth', 110, 0.6, 0.15, { to: 40 });
    this.noiseHit(1.0, 0.8, { freq: 2500, to: 80 });
  }
  charge() {
    this.osc('sawtooth', 110, 0.8, 0.12, { to: 880 });
    this.osc('square', 220, 0.8, 0.05, { to: 1760 });
    this.noiseHit(0.8, 0.2, { type: 'bandpass', freq: 300, to: 4000, q: 2 });
  }
  zap() {
    for (let i = 0; i < 4; i++) this.noiseHit(0.05, 0.25, { type: 'highpass', freq: 3000, delay: i * 0.05 });
  }
  sparkle() {
    [1318, 1568, 2093, 2637].forEach((f, i) => this.osc('sine', f, 0.3, 0.08, { delay: i * 0.06 }));
  }
  whistle() { this.osc('sine', 2600, 0.35, 0.18, { to: 2500 }); this.osc('sine', 2650, 0.35, 0.12); }
  buzzer() { this.osc('sawtooth', 180, 0.9, 0.18); this.osc('square', 182, 0.9, 0.1); }
  ui() { this.osc('sine', 880, 0.08, 0.08, { to: 1320 }); }
  cheer(amount = 1) {
    if (!this.ctx) return;
    const g = this.crowdGain.gain;
    const t = this.t;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.35 * amount, t + 0.15);
    g.linearRampToValueAtTime(0.05, t + 2.2 * amount);
    g.linearRampToValueAtTime(0.02, t + 4);
  }

  // ---- lo-fi boom-bap loop ----
  updateMusic() {
    if (!this.ctx || !this.musicOn) return;
    const spb = 60 / 92 / 4; // 16th notes at 92bpm
    while (this.nextBeat < this.t + 0.2) {
      const s = this.step % 32;
      const t0 = this.nextBeat - this.t;
      const kick = [0, 7, 10, 16, 23, 26].includes(s);
      const snare = s % 8 === 4;
      if (kick) this.osc('sine', 120, 0.28, 0.9, { to: 42, delay: t0, dest: this.music });
      if (snare) { this.noiseHit(0.18, 0.5, { type: 'bandpass', freq: 1800, q: 0.7, delay: t0, dest: this.music }); this.osc('triangle', 190, 0.1, 0.25, { delay: t0, dest: this.music }); }
      if (s % 2 === 0) this.noiseHit(0.03, s % 4 === 2 ? 0.18 : 0.1, { type: 'highpass', freq: 7000, delay: t0 + (s % 4 === 2 ? 0.02 : 0), dest: this.music });
      const bass = { 0: 55, 7: 55, 10: 65.4, 16: 49, 23: 49, 26: 58.3 };
      if (bass[s]) this.osc('triangle', bass[s], 0.35, 0.45, { delay: t0, dest: this.music });
      if (s % 8 === 0) {
        const chords = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 311.1]];
        const ch = chords[Math.floor(this.step / 32) % 4];
        if (s === 0 || s === 16) ch.forEach((f) => this.osc('sine', f * 2, 0.9, 0.035, { delay: t0, dest: this.music }));
      }
      this.nextBeat += spb;
      this.step++;
    }
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.music) this.music.gain.value = this.musicOn ? 0.28 : 0;
    return this.musicOn;
  }
}
