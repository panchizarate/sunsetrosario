// Motor de audio 100% procedural (Web Audio): ambiente, golpes, derrumbes, explosiones y música generativa.

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

// progresión con onda "lo-fi de obra": Am9 - Fmaj7 - Cmaj7 - G6
const PROG = [
  [45, 60, 64, 67, 71],
  [41, 57, 60, 64, 69],
  [48, 55, 64, 67, 71],
  [43, 59, 62, 64, 67],
];
const PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79];

export class AudioEngine {
  ctx!: AudioContext;
  private offline = false;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private reverbSend!: GainNode;
  private delaySend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private brownBuf!: AudioBuffer;
  private started = false;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private jackGain!: GainNode;
  private jackOn = false;
  private nextBeat = 0;
  private beat = 0;
  private bpm = 84;
  private nextGust = 0;
  private nextBird = 0;
  private lastClack = 0;
  private lastHit = 0;
  intensity = 0; // 0..1 avance de la demolición (la música suma capas)
  musicVolume = 0.5;
  sfxVolume = 0.9;

  get isStarted() {
    return this.started;
  }

  start(offlineCtx?: OfflineAudioContext) {
    if (this.started) {
      if (!this.offline && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    if (offlineCtx) {
      this.ctx = offlineCtx as unknown as AudioContext;
      this.offline = true;
    } else {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3.5;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    const trim = ctx.createGain();
    trim.gain.value = 0.85;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp).connect(limiter).connect(trim).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.amb = ctx.createGain();
    for (const g of [this.sfx, this.music, this.amb]) g.connect(this.master);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(2.8, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.8;
    this.reverbSend.connect(reverb).connect(this.master);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = (60 / this.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2400;
    delay.connect(dlp).connect(fb).connect(delay);
    dlp.connect(this.music);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.3;
    this.delaySend.connect(delay);

    this.noiseBuf = this.makeNoise(2, false);
    this.brownBuf = this.makeNoise(4, true);
    this.buildAmbience();
    this.buildJack();
    this.applyVolumes();
    this.nextBeat = ctx.currentTime + 0.3;
    this.started = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.sfxVolume, t, 0.05);
    this.amb.gain.setTargetAtTime(this.sfxVolume * 0.8, t, 0.05);
    this.music.gain.setTargetAtTime(this.musicVolume * 0.75, t, 0.05);
  }
  suspend() { if (this.started && !this.offline) this.ctx.suspend(); }
  resume() { if (this.started && !this.offline) this.ctx.resume(); }

  private makeNoise(sec: number, brown: boolean) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
    }
    return b;
  }
  private makeImpulse(sec: number, decay: number) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  private noise(buf = this.noiseBuf, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    return s;
  }
  private pan(p: number): AudioNode {
    if (this.ctx.createStereoPanner) {
      const sp = this.ctx.createStereoPanner();
      sp.pan.value = Math.max(-1, Math.min(1, p));
      return sp;
    }
    return this.ctx.createGain();
  }
  private env(g: GainNode, t: number, peak: number, a: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private out(p: number, rev = 0.5) {
    const n = this.pan(p);
    n.connect(this.sfx);
    if (rev > 0) {
      const g = this.ctx.createGain();
      g.gain.value = rev;
      n.connect(g).connect(this.reverbSend);
    }
    return n;
  }
  /** Ráfaga de ruido filtrado (base de golpes, crujidos, cascotes). */
  private burst(t: number, dest: AudioNode, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, a: number, d: number, buf = this.noiseBuf) {
    const s = this.noise(buf);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, peak, a, d);
    s.connect(f).connect(g).connect(dest);
    s.start(t, rand(0, 1.5));
    s.stop(t + a + d + 0.05);
  }
  private tone(t: number, dest: AudioNode, type: OscillatorType, f0: number, f1: number, peak: number, a: number, d: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + a + d);
    const g = this.ctx.createGain();
    this.env(g, t, peak, a, d);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }

  // ------------------------------------------------------------------ ambiente
  private buildAmbience() {
    const ctx = this.ctx;
    const w = this.noise(this.brownBuf, true);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.12;
    w.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    w.start();
    // ciudad lejana: zumbido grave muy suave
    const city = this.noise(this.brownBuf, true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const cg = ctx.createGain();
    cg.gain.value = 0.12;
    city.connect(lp).connect(cg).connect(this.amb);
    city.start(0, 1.3);
  }

  private buildJack() {
    // martillo neumático: pulsos de ruido a ~24 Hz + motor
    const ctx = this.ctx;
    const src = this.noise(this.noiseBuf, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 0.8;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 24;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.5;
    const dc = ctx.createConstantSource ? ctx.createConstantSource() : null;
    lfo.connect(lfoG).connect(am.gain);
    if (dc) { dc.offset.value = 0.5; dc.connect(am.gain); dc.start(); }
    const motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.value = 72;
    const mlp = ctx.createBiquadFilter();
    mlp.type = 'lowpass';
    mlp.frequency.value = 420;
    const mg = ctx.createGain();
    mg.gain.value = 0.3;
    motor.connect(mlp).connect(mg).connect(am);
    this.jackGain = ctx.createGain();
    this.jackGain.gain.value = 0;
    src.connect(bp).connect(am).connect(this.jackGain);
    const o = this.out(0, 0.3);
    this.jackGain.connect(o);
    src.start();
    lfo.start();
    motor.start();
  }

  setJack(on: boolean) {
    if (!this.started || on === this.jackOn) return;
    this.jackOn = on;
    this.jackGain.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, on ? 0.02 : 0.06);
  }

  update() {
    if (!this.started || (!this.offline && this.ctx.state !== 'running')) return;
    const t = this.ctx.currentTime;
    if (t > this.nextGust) {
      const d = rand(2, 6);
      this.windGain.gain.setTargetAtTime(rand(0.06, 0.18), t, d * 0.4);
      this.windFilter.frequency.setTargetAtTime(rand(300, 900), t, d * 0.4);
      this.nextGust = t + d;
    }
    if (t > this.nextBird) {
      this.bird();
      this.nextBird = t + rand(4, 14);
    }
    while (this.nextBeat < t + 0.25) {
      this.scheduleBeat(this.nextBeat, this.beat);
      this.nextBeat += 60 / this.bpm / 2;
      this.beat++;
    }
  }

  private bird() {
    const t = this.ctx.currentTime + 0.02;
    const o = this.out(rand(-0.9, 0.9), 0.6);
    const g = this.ctx.createGain();
    g.gain.value = 0.35;
    g.connect(o);
    let tt = t;
    const base = rand(2600, 4200);
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      this.tone(tt, g, 'sine', base * rand(0.9, 1.1), base * rand(0.7, 1.4), 0.04, 0.01, rand(0.07, 0.15));
      tt += rand(0.12, 0.22);
    }
  }

  // ------------------------------------------------------------------ música
  private scheduleBeat(time: number, e: number) {
    const I = this.intensity;
    const chord = PROG[Math.floor(e / 16) % 4];
    const pos = e % 16;
    if (pos === 0) {
      this.pad(chord.slice(1), time, (60 / this.bpm) * 8, 900 + 1400 * I, 0.04);
      this.bass(chord[0], time, (60 / this.bpm) * 1.6, 0.12);
    }
    if (pos === 6 || pos === 10) this.bass(chord[0] + (pos === 10 ? 7 : 0), time, (60 / this.bpm) * 0.8, 0.08);
    // batería suave: bombo + redoblante con escobilla + hi-hat
    if (I > 0.02 || e > 32) {
      if (pos % 8 === 0 || pos === 11) this.kick(time, 0.32);
      if (pos % 8 === 4) this.snare(time, 0.12);
      if (pos % 2 === 1) this.hat(time, 0.025 + 0.02 * I);
    }
    if (Math.random() < 0.18 + 0.3 * I && pos % 2 === 0) {
      let n = pick(PENTA);
      if (Math.random() < 0.4) n = pick(chord.slice(1)) + 12;
      this.keys(n, time, 0.06);
    }
  }
  private pad(notes: number[], t: number, dur: number, cutoff: number, vol: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 1.2);
    g.gain.setValueAtTime(vol, t + dur - 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur + 1.5);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.reverbSend);
    for (const n of notes)
      for (const det of [-8, 8]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        const og = this.ctx.createGain();
        og.gain.value = 0.2;
        o.connect(og).connect(f);
        o.start(t);
        o.stop(t + dur + 1.7);
      }
  }
  private bass(n: number, t: number, dur: number, vol: number) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(n - 12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  private kick(t: number, vol: number) { this.tone(t, this.music, 'sine', 120, 42, vol, 0.004, 0.22); }
  private snare(t: number, vol: number) { this.burst(t, this.music, 'bandpass', 1800, 900, 0.7, vol, 0.004, 0.16); }
  private hat(t: number, vol: number) { this.burst(t, this.music, 'highpass', 8000, 7000, 0.7, vol, 0.002, 0.04); }
  private keys(n: number, t: number, vol: number) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(n);
    const o2 = this.ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = mtof(n) * 2.01;
    const g = this.ctx.createGain();
    this.env(g, t, vol, 0.005, 0.9);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.music);
    g.connect(this.delaySend);
    g.connect(this.reverbSend);
    o.start(t);
    o2.start(t);
    o.stop(t + 1);
    o2.stop(t + 1);
  }
  private chime(n: number, t: number, vol: number, dest: AudioNode) {
    this.tone(t, dest, 'sine', mtof(n), mtof(n), vol, 0.004, 0.5);
    this.tone(t, dest, 'sine', mtof(n) * 3.01, mtof(n) * 3.01, vol * 0.15, 0.004, 0.4);
  }

  // ------------------------------------------------------------------ SFX de demolición
  /** Golpe contra ladrillo: crujido + golpe seco + cascotes. strength 0..1 */
  hit(strength = 0.5, pan = 0) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    if (t - this.lastHit < 0.03) return;
    this.lastHit = t;
    const o = this.out(pan, 0.35);
    this.burst(t, o, 'bandpass', rand(2600, 3800), 1200, 1.2, 0.35 * (0.5 + strength), 0.002, 0.05);
    this.tone(t, o, 'sine', 160 - strength * 60, 60, 0.45 * (0.4 + strength), 0.003, 0.12 + strength * 0.15);
    this.burst(t + 0.02, o, 'lowpass', 900, 300, 0.7, 0.15 * strength, 0.01, 0.2 + strength * 0.3);
    for (let i = 0; i < 2 + strength * 4; i++) this.clackAt(t + 0.05 + Math.random() * 0.25, pan, 0.06);
  }

  private clackAt(t: number, pan: number, vol: number) {
    const o = this.out(pan, 0.2);
    this.burst(t, o, 'bandpass', rand(1800, 3600), rand(900, 1600), 3, vol, 0.001, 0.035);
  }

  /** Ladrillo/cascote que pega contra el piso. */
  clack(speed: number, dist: number, pan: number) {
    if (!this.started || dist > 40) return;
    const t = this.ctx.currentTime;
    if (t - this.lastClack < 0.02) return;
    this.lastClack = t;
    const v = Math.min(0.16, speed * 0.015) / (1 + dist * 0.12);
    this.clackAt(t, pan, v);
    if (speed > 6) this.tone(t, this.out(pan, 0.2), 'sine', 140, 60, v * 1.5, 0.002, 0.08);
  }

  /** Derrumbe: retumbe largo + lluvia de cascotes. size 0..1 */
  collapse(size: number, dist: number, pan: number) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const att = 1 / (1 + dist * 0.03);
    const o = this.out(pan, 0.9);
    const dur = 1.5 + size * 3;
    this.burst(t, o, 'lowpass', 400, 60, 0.7, 0.7 * att * (0.5 + size), 0.08, dur, this.brownBuf);
    this.tone(t, o, 'sine', 70, 28, 0.5 * att * (0.4 + size), 0.05, dur * 0.8);
    this.burst(t + 0.1, o, 'bandpass', 1200, 500, 0.6, 0.25 * att, 0.1, dur * 0.7);
    const clacks = Math.round(10 + size * 40);
    for (let i = 0; i < clacks; i++) this.clackAt(t + 0.2 + Math.pow(Math.random(), 0.7) * dur, pan + rand(-0.4, 0.4), 0.07 * att);
  }

  /** Explosión: estampido, cola grave, crepitar. */
  explosion(size: number, dist: number, pan: number) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const att = 1 / (1 + dist * 0.02);
    const o = this.out(pan, 1);
    this.burst(t, o, 'lowpass', 6000, 200, 0.5, 0.9 * att, 0.002, 0.5 + size * 0.5);
    this.tone(t, o, 'sine', 90, 24, 0.9 * att, 0.004, 1.2 + size);
    this.burst(t + 0.05, o, 'lowpass', 300, 40, 0.5, 0.6 * att, 0.05, 2 + size * 2, this.brownBuf);
    for (let i = 0; i < 25; i++) this.clackAt(t + 0.3 + Math.random() * 2, pan + rand(-0.5, 0.5), 0.05 * att);
  }

  ballWhoosh() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.burst(t, this.out(0, 0.4), 'bandpass', 300, 1400, 2, 0.2, 0.5, 0.25);
  }

  chargePlaced() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.2, 0.2);
    this.tone(t, o, 'square', 1800, 1800, 0.04, 0.002, 0.06);
    this.tone(t + 0.1, o, 'square', 2400, 2400, 0.04, 0.002, 0.06);
    this.burst(t, o, 'bandpass', 1200, 800, 2, 0.1, 0.002, 0.05);
  }

  beep() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.tone(t, this.out(0, 0.1), 'square', 1500, 1500, 0.035, 0.002, 0.07);
  }

  footstep(run: boolean) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.out(rand(-0.15, 0.15), 0.05);
    this.burst(t, o, 'bandpass', rand(900, 1500), rand(500, 700), 1.4, run ? 0.07 : 0.05, 0.004, 0.09);
    this.burst(t + 0.01, o, 'highpass', 3500, 3000, 0.7, 0.02, 0.002, 0.05);
  }

  pickup(count: number) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.out(0, 0.15);
    this.clackAt(t, 0, 0.05);
    this.tone(t, o, 'sine', 600 + Math.min(count, 50) * 8, 900, 0.03, 0.003, 0.08);
  }

  deposit(amountNorm: number) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.3, 0.6);
    // ladrillos cayendo en el volquete metálico
    this.burst(t, o, 'lowpass', 1500, 200, 0.6, 0.4, 0.02, 0.9, this.brownBuf);
    this.tone(t, o, 'triangle', 180, 120, 0.15, 0.005, 0.6);
    for (let i = 0; i < 8 + amountNorm * 20; i++) this.clackAt(t + Math.random() * 0.8, rand(-0.3, 0.6), 0.07);
    // monedas
    [72, 76, 79, 84].forEach((n, i) => this.chime(n, t + 0.25 + i * 0.07, 0.08, this.out(-0.2 + i * 0.15, 0.6)));
  }

  buy() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.tone(t, this.out(0, 0.3), 'triangle', 300, 900, 0.1, 0.01, 0.25);
    [79, 84, 88, 91].forEach((n, i) => this.chime(n, t + 0.08 + i * 0.045, 0.07, this.out(0, 0.5)));
  }
  denied() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.tone(t, this.sfx, 'square', mtof(52), mtof(52), 0.04, 0.005, 0.12);
    this.tone(t + 0.09, this.sfx, 'square', mtof(49), mtof(49), 0.04, 0.005, 0.12);
  }
  full() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    [84, 79, 84].forEach((n, i) => this.chime(n, t + i * 0.14, 0.08, this.out(0, 0.4)));
  }
  click() {
    if (!this.started) return;
    this.tone(this.ctx.currentTime, this.sfx, 'sine', 1400, 700, 0.05, 0.002, 0.05);
  }
  unlock() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.pad([60, 64, 67, 72, 76], t, 3, 3500, 0.07);
    [67, 72, 76, 79, 84, 88].forEach((n, i) => this.chime(n, t + i * 0.07, 0.1, this.out(-0.5 + i * 0.2, 0.8)));
    this.burst(t, this.out(0, 0.5), 'bandpass', 300, 5000, 2, 0.08, 0.3, 0.4);
  }
  victory() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.pad([48, 55, 60, 64, 67, 71], t, 6, 4000, 0.09);
    [72, 76, 79, 84, 83, 79, 81, 84, 88].forEach((n, i) => this.chime(n, t + 0.4 + i * 0.3, 0.08, this.out(0, 0.9)));
  }
}

export const audio = new AudioEngine();
