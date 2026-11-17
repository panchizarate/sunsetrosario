// Audio 100% procedural: lluvia, truenos, ordenar, casino, suspenso y música synthwave generativa.

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const PROG = [[45, 57, 60, 64, 67], [41, 57, 60, 65, 69], [48, 55, 60, 64, 67], [43, 55, 59, 62, 67]]; // Am7 Fmaj7 C G
const DARK = [[45, 57, 60, 63], [44, 56, 59, 63], [41, 56, 60, 63], [40, 55, 59, 62]];
const PENTA = [69, 72, 74, 76, 79, 81, 84];
export type Mat = 'papel' | 'tela' | 'ceramica' | 'vidrio' | 'cuero' | 'plastico';

export class AudioEngine {
  ctx!: AudioContext;
  private offline = false;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private rev!: GainNode;
  private dly!: GainNode;
  private noiseBuf!: AudioBuffer;
  private brownBuf!: AudioBuffer;
  private started = false;
  private rainGain!: GainNode;
  private rainLP!: BiquadFilterNode;
  private nextBeat = 0;
  private beat = 0;
  private bpm = 92;
  private combo = 0;
  private lastPlace = 0;
  private ringing = false;
  private ringT = 0;
  musicVolume = 0.5;
  sfxVolume = 0.9;
  /** 0..1: cuánto creció la música (zonas completas). */
  intensity = 0;
  /** suspenso: la música se oscurece */
  suspense = 0;
  /** volumen de lluvia según estés adentro o en la terraza */
  outside = 0;
  djMode = 0;

  get isStarted() { return this.started; }

  start(offlineCtx?: OfflineAudioContext) {
    if (this.started) { if (!this.offline && this.ctx.state === 'suspended') this.ctx.resume(); return; }
    if (offlineCtx) { this.ctx = offlineCtx as unknown as AudioContext; this.offline = true; }
    else { const AC = window.AudioContext || (window as any).webkitAudioContext; this.ctx = new AC({ latencyHint: 'interactive' }); }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    const trim = ctx.createGain(); trim.gain.value = 0.85;
    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    this.master.connect(comp).connect(lim).connect(trim).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.music = ctx.createGain(); this.amb = ctx.createGain();
    for (const g of [this.sfx, this.music, this.amb]) g.connect(this.master);
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(3.4, 2.2);
    this.rev = ctx.createGain(); this.rev.gain.value = 0.8;
    this.rev.connect(conv).connect(this.master);
    const delay = ctx.createDelay(2); delay.delayTime.value = (60 / this.bpm) * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    delay.connect(lp).connect(fb).connect(delay); lp.connect(this.music); lp.connect(this.rev);
    this.dly = ctx.createGain(); this.dly.gain.value = 0.3; this.dly.connect(delay);
    this.noiseBuf = this.noise(2, false);
    this.brownBuf = this.noise(4, true);
    this.buildRain();
    this.applyVolumes();
    this.nextBeat = ctx.currentTime + 0.3;
    this.started = true;
  }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.sfxVolume, t, 0.05);
    this.amb.gain.setTargetAtTime(this.sfxVolume * 0.8, t, 0.05);
    this.music.gain.setTargetAtTime(this.musicVolume * 0.7, t, 0.05);
  }
  suspend() { if (this.started && !this.offline) this.ctx.suspend(); }
  resume() { if (this.started && !this.offline) this.ctx.resume(); }

  private noise(sec: number, brown: boolean) {
    const b = this.ctx.createBuffer(2, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let l = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; } }
    return b;
  }
  private impulse(sec: number, decay: number) {
    const len = this.ctx.sampleRate * sec, b = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  private src(buf = this.noiseBuf, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }
  private pan(p: number): AudioNode { if (this.ctx.createStereoPanner) { const n = this.ctx.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); return n; } return this.ctx.createGain(); }
  private env(g: GainNode, t: number, peak: number, a: number, d: number) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  private out(p = 0, rev = 0.4, bus: AudioNode = this.sfx) { const n = this.pan(p); n.connect(bus); if (rev > 0) { const g = this.ctx.createGain(); g.gain.value = rev; n.connect(g).connect(this.rev); } return n; }
  private burst(t: number, dest: AudioNode, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, a: number, d: number, buf = this.noiseBuf) {
    const s = this.src(buf); const f = this.ctx.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d); f.Q.value = q;
    const g = this.ctx.createGain(); this.env(g, t, peak, a, d); s.connect(f).connect(g).connect(dest); s.start(t, rand(0, 1.5)); s.stop(t + a + d + 0.05);
  }
  private tone(t: number, dest: AudioNode, type: OscillatorType, f0: number, f1: number, peak: number, a: number, d: number, det = 0) {
    const o = this.ctx.createOscillator(); o.type = type; o.detune.value = det; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + a + d);
    const g = this.ctx.createGain(); this.env(g, t, peak, a, d); o.connect(g).connect(dest); o.start(t); o.stop(t + a + d + 0.05);
  }
  private chime(n: number, t: number, vol: number, dest: AudioNode) {
    this.tone(t, dest, 'sine', mtof(n), mtof(n), vol, 0.004, 0.6);
    this.tone(t, dest, 'sine', mtof(n) * 3.01, mtof(n) * 3.01, vol * 0.15, 0.004, 0.45);
  }

  // ------------------------------------------------------------------ lluvia y ambiente
  private buildRain() {
    const s = this.src(this.noiseBuf, true);
    this.rainLP = this.ctx.createBiquadFilter(); this.rainLP.type = 'lowpass'; this.rainLP.frequency.value = 900;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 200;
    this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0.08;
    s.connect(hp).connect(this.rainLP).connect(this.rainGain).connect(this.amb); s.start();
    const b = this.src(this.brownBuf, true); const g = this.ctx.createGain(); g.gain.value = 0.1;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    b.connect(lp).connect(g).connect(this.amb); b.start();
  }

  update() {
    if (!this.started || (!this.offline && this.ctx.state !== 'running')) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(0.06 + this.outside * 0.18, t, 0.4);
    this.rainLP.frequency.setTargetAtTime(700 + this.outside * 3500, t, 0.4);
    if (this.ringing && t > this.ringT) { this.ringOnce(); this.ringT = t + 3; }
    while (this.nextBeat < t + 0.25) { this.scheduleBeat(this.nextBeat, this.beat); this.nextBeat += 60 / this.bpm / 2; this.beat++; }
  }

  // ------------------------------------------------------------------ música synthwave / lo-fi
  private scheduleBeat(time: number, e: number) {
    const I = this.intensity, S = this.suspense;
    const prog = S > 0.5 ? DARK : PROG;
    const chord = prog[Math.floor(e / 16) % 4];
    const pos = e % 16;
    const mbus = this.music;
    if (pos === 0) this.pad(chord.slice(1), time, (60 / this.bpm) * 8, 700 + 1600 * I * (1 - S * 0.6), 0.035 + 0.01 * I);
    if (S < 0.5) {
      if (pos % 2 === 0) this.tone(time, mbus, 'sawtooth', mtof(chord[0] - 12), mtof(chord[0] - 12), 0.05 + 0.03 * I, 0.005, 0.16); // bajo arpegiado
      if (I > 0.05 || this.djMode > 0) {
        if (pos % 4 === 0) this.tone(time, mbus, 'sine', 115, 40, 0.3, 0.004, 0.22);
        if (pos % 8 === 4) this.burst(time, mbus, 'bandpass', 1900, 900, 0.8, 0.1, 0.003, 0.15);
        if (pos % 2 === 1) this.burst(time, mbus, 'highpass', 8500, 7500, 0.7, 0.02 + 0.02 * I, 0.002, 0.04);
      }
      if (Math.random() < 0.12 + 0.3 * I && pos % 2 === 0) {
        const n = Math.random() < 0.5 ? pick(PENTA) : pick(chord.slice(1)) + 12;
        const o = this.out(rand(-0.4, 0.4), 0.5, mbus);
        this.tone(time, o, 'triangle', mtof(n), mtof(n), 0.05, 0.005, 0.7);
        this.tone(time, this.dly, 'triangle', mtof(n), mtof(n), 0.03, 0.005, 0.5);
      }
    } else {
      // suspenso: latido grave y notas disonantes
      if (pos === 0 || pos === 3) this.tone(time, mbus, 'sine', 55, 40, 0.25 * S, 0.01, 0.35);
      if (Math.random() < 0.08) this.tone(time, this.out(rand(-0.8, 0.8), 0.9, mbus), 'sine', mtof(pick([82, 83, 86])), mtof(pick([81, 84])), 0.025, 0.4, 2);
    }
  }
  private pad(notes: number[], t: number, dur: number, cutoff: number, vol: number) {
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 1.2); g.gain.setValueAtTime(vol, t + dur - 0.3); g.gain.linearRampToValueAtTime(0, t + dur + 1.4);
    f.connect(g); g.connect(this.music); g.connect(this.rev);
    for (const n of notes) for (const d of [-9, 9]) { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = d; const og = this.ctx.createGain(); og.gain.value = 0.2; o.connect(og).connect(f); o.start(t); o.stop(t + dur + 1.6); }
  }

  // ------------------------------------------------------------------ ordenar
  pickup(m: Mat) {
    if (!this.started) return;
    const t = this.ctx.currentTime, o = this.out(0.2, 0.15);
    if (m === 'vidrio') { this.tone(t, o, 'sine', 2600, 2400, 0.04, 0.002, 0.25); this.tone(t, o, 'sine', 3900, 3700, 0.02, 0.002, 0.2); }
    else if (m === 'ceramica') this.tone(t, o, 'triangle', 900, 700, 0.06, 0.002, 0.12);
    else if (m === 'tela' || m === 'papel') this.burst(t, o, 'bandpass', 3000, 1500, 1, 0.08, 0.01, 0.12);
    else this.burst(t, o, 'bandpass', 1600, 800, 1.5, 0.08, 0.004, 0.08);
  }
  /** Colocar bien: golpe del material + nota que sube con la racha. */
  place(m: Mat, pan = 0) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.combo = t - this.lastPlace < 4 ? Math.min(this.combo + 1, 12) : 0;
    this.lastPlace = t;
    const o = this.out(pan, 0.35);
    if (m === 'vidrio') { this.tone(t, o, 'sine', 1800, 1750, 0.05, 0.002, 0.5); this.burst(t, o, 'highpass', 6000, 5000, 1, 0.02, 0.001, 0.04); }
    else if (m === 'tela') this.burst(t, o, 'lowpass', 800, 300, 0.7, 0.12, 0.01, 0.15);
    else if (m === 'papel') { this.burst(t, o, 'bandpass', 900, 500, 1.2, 0.12, 0.003, 0.08); }
    else this.tone(t, o, 'sine', 240, 140, 0.12, 0.003, 0.1);
    const scale = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96, 98, 100];
    this.chime(scale[this.combo], t + 0.02, 0.07, this.out(pan, 0.5));
  }
  wrong() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.combo = 0;
    this.tone(t, this.sfx, 'square', mtof(50), mtof(48), 0.04, 0.005, 0.14);
    this.tone(t + 0.1, this.sfx, 'square', mtof(46), mtof(45), 0.04, 0.005, 0.16);
  }
  shelfDone() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    [72, 76, 79, 84, 88].forEach((n, i) => this.chime(n, t + i * 0.06, 0.08, this.out(-0.4 + i * 0.2, 0.6)));
    this.burst(t, this.out(0, 0.4), 'bandpass', 400, 4000, 1.5, 0.05, 0.3, 0.3);
  }
  zoneDone() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.pad([60, 64, 67, 71, 74], t, 4, 4000, 0.09);
    [60, 67, 72, 76, 79, 84, 88, 91].forEach((n, i) => this.chime(n, t + i * 0.08, 0.1, this.out(-0.6 + i * 0.17, 0.9)));
    this.tone(t, this.sfx, 'sine', 80, 40, 0.4, 0.01, 1.2);
  }
  click() { if (this.started) this.tone(this.ctx.currentTime, this.sfx, 'sine', 1500, 800, 0.04, 0.002, 0.05); }
  buy() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.tone(t, this.out(0, 0.3), 'triangle', 300, 900, 0.08, 0.01, 0.22);
    [79, 84, 88].forEach((n, i) => this.chime(n, t + 0.08 + i * 0.05, 0.06, this.out(0, 0.5)));
  }
  coins(n = 6) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < n; i++) { const tt = t + i * rand(0.03, 0.06); const f = rand(2600, 4000); this.tone(tt, this.out(rand(-0.5, 0.5), 0.4), 'sine', f, f, 0.03, 0.001, rand(0.1, 0.25)); }
  }
  footstep(stone: boolean) {
    if (!this.started) return;
    const t = this.ctx.currentTime, o = this.out(rand(-0.1, 0.1), 0.1);
    if (stone) { this.burst(t, o, 'bandpass', 2400, 1800, 2, 0.035, 0.002, 0.05); this.tone(t, o, 'sine', 140, 90, 0.04, 0.002, 0.06); }
    else this.tone(t, o, 'triangle', 120, 70, 0.07, 0.003, 0.09);
  }

  // ------------------------------------------------------------------ misterio
  thunder(s: number) {
    if (!this.started) return;
    const t = this.ctx.currentTime, o = this.out(rand(-0.6, 0.6), 1);
    this.burst(t, o, 'lowpass', 900, 60, 0.6, 0.6 * s, 0.05, 3.5, this.brownBuf);
    this.burst(t + 0.1, o, 'lowpass', 300, 40, 0.5, 0.5 * s, 0.4, 3, this.brownBuf);
  }
  private ringOnce() {
    const t = this.ctx.currentTime;
    for (let k = 0; k < 2; k++) for (let i = 0; i < 18; i++) {
      const tt = t + k * 0.45 + i * 0.022;
      this.tone(tt, this.out(-0.5, 0.5), 'square', i % 2 ? 1300 : 1600, i % 2 ? 1300 : 1600, 0.025, 0.002, 0.018);
    }
  }
  setRinging(on: boolean) { this.ringing = on; if (on && this.ctx) this.ringT = this.ctx.currentTime; }
  powerDown() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.tone(t, this.sfx, 'sawtooth', 220, 30, 0.12, 0.01, 1.2);
    this.burst(t, this.sfx, 'lowpass', 2000, 100, 1, 0.1, 0.005, 0.4);
  }
  powerUp() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.tone(t, this.sfx, 'sawtooth', 40, 180, 0.06, 0.6, 0.3);
    for (let i = 0; i < 5; i++) this.burst(t + i * 0.08 + Math.random() * 0.05, this.sfx, 'highpass', 4000, 3000, 1, 0.04, 0.001, 0.03);
  }
  heartbeat() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.tone(t, this.sfx, 'sine', 60, 40, 0.35, 0.01, 0.15);
    this.tone(t + 0.22, this.sfx, 'sine', 55, 38, 0.25, 0.01, 0.15);
  }
  glitch() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 8; i++) this.tone(t + i * 0.03, this.sfx, 'square', rand(200, 2000), rand(100, 3000), 0.03, 0.001, 0.025);
  }
  bob(lines = 3) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < lines; i++) this.tone(t + i * 0.09, this.out(0.3, 0.2), 'sine', rand(600, 1100), rand(500, 1300), 0.03, 0.005, 0.07);
  }
  voice() {
    // voz distorsionada (sin palabras): formantes graves con ruido
    if (!this.started) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 10; i++) {
      const tt = t + i * rand(0.12, 0.2);
      const o = this.out(0, 0.6);
      this.tone(tt, o, 'sawtooth', rand(90, 130), rand(80, 120), 0.04, 0.02, 0.12);
      this.burst(tt, o, 'bandpass', rand(500, 1200), rand(400, 900), 4, 0.03, 0.01, 0.1);
    }
  }

  // ------------------------------------------------------------------ casino / juegos
  chip() { if (this.started) { const t = this.ctx.currentTime; this.tone(t, this.sfx, 'sine', 3200, 2800, 0.04, 0.001, 0.06); this.tone(t + 0.03, this.sfx, 'sine', 3600, 3000, 0.03, 0.001, 0.05); } }
  card() { if (this.started) this.burst(this.ctx.currentTime, this.sfx, 'highpass', 3000, 1500, 0.8, 0.07, 0.004, 0.07); }
  tick() { if (this.started) this.tone(this.ctx.currentTime, this.sfx, 'square', 2200, 2200, 0.025, 0.001, 0.015); }
  win(big = false) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    [72, 76, 79, 84, 88, 91].slice(0, big ? 6 : 4).forEach((n, i) => this.chime(n, t + i * 0.07, 0.09, this.out(0, 0.6)));
    this.coins(big ? 18 : 8);
  }
  lose() { if (this.started) { const t = this.ctx.currentTime; this.tone(t, this.sfx, 'triangle', 300, 150, 0.06, 0.01, 0.4); } }
  bounce(v: number) { if (this.started) this.tone(this.ctx.currentTime, this.out(0.2, 0.3), 'sine', 160, 90, Math.min(0.25, v * 0.03), 0.002, 0.12); }
  swish() { if (this.started) { const t = this.ctx.currentTime; this.burst(t, this.out(0, 0.3), 'bandpass', 2000, 800, 1, 0.1, 0.02, 0.25); this.win(false); } }
}

export const audio = new AudioEngine();
