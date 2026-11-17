// Motor de audio 100% procedural (Web Audio). Sin archivos: todo se sintetiza en vivo.
// La idea central: el paisaje sonoro "se cura" junto con el río.
//   - Río sucio: zumbido industrial, música en menor, apagada y espaciada.
//   - Río limpio: pájaros, ranas, música en mayor, más brillante y con campanas.

type Material = 'metal' | 'plastico' | 'vidrio' | 'goma' | 'pesado';

const A_MINOR_PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81]; // MIDI
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

// Progresiones: sucia (menor) y limpia (mayor). Comparten notas (relativas).
const DIRTY_PROG = [
  [45, 57, 60, 64], // Am
  [41, 57, 60, 65], // F
  [43, 55, 59, 62], // G
  [40, 55, 59, 64], // Em
];
const CLEAN_PROG = [
  [48, 60, 64, 67, 71], // Cmaj7
  [43, 59, 62, 67, 69], // G6
  [45, 60, 64, 69, 71], // Am(add9)
  [41, 60, 65, 69, 72], // Fmaj7
];

export class AudioEngine {
  ctx!: AudioContext;
  private offline = false;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private delay!: DelayNode;
  private delaySend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private brownBuf!: AudioBuffer;
  private started = false;

  private cleanliness = 0;
  private humGain!: GainNode;
  private waterLow!: GainNode;
  private waterHi!: GainNode;
  private waterHiFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private bubbleGain!: GainNode;

  private nextBeat = 0;
  private beat = 0;
  private bpm = 72;
  private nextBird = 0;
  private nextFrog = 0;
  private nextLap = 0;
  private lastComboAt = 0;
  private combo = 0;

  musicVolume = 0.55;
  sfxVolume = 0.9;
  muted = false;

  get isStarted() {
    return this.started;
  }

  /** Debe llamarse dentro de un gesto del usuario (tap/click). */
  start(offlineCtx?: OfflineAudioContext) {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    if (offlineCtx) {
      // render offline (para generar demos de audio)
      this.ctx = offlineCtx as unknown as AudioContext;
      this.offline = true;
    } else {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    const ctx = this.ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    // limitador final: evita saturación digital aunque se apilen muchos sonidos
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    const trim = ctx.createGain();
    trim.gain.value = 0.85;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(limiter).connect(trim).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.amb = ctx.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.amb.connect(this.master);
    this.applyVolumes();

    // Reverb con respuesta al impulso generada
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.9;
    this.reverbSend.connect(this.reverb).connect(this.master);

    // Delay estéreo-ish para melodías
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = (60 / this.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.33;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.35;
    this.delaySend.connect(this.delay);
    dlp.connect(this.music);
    dlp.connect(this.reverbSend);

    this.noiseBuf = this.makeNoise(2, 'white');
    this.brownBuf = this.makeNoise(4, 'brown');

    this.buildAmbience();
    this.buildEngine();
    this.nextBeat = ctx.currentTime + 0.3;
    this.started = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const m = this.muted ? 0 : 1;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.sfxVolume * m, t, 0.05);
    this.amb.gain.setTargetAtTime(this.sfxVolume * 0.85 * m, t, 0.05);
    this.music.gain.setTargetAtTime(this.musicVolume * 0.8 * m, t, 0.05);
  }

  suspend() {
    if (this.started && !this.offline) this.ctx.suspend();
  }
  resume() {
    if (this.started && !this.offline) this.ctx.resume();
  }

  // ---------------------------------------------------------------- buffers
  private makeNoise(seconds: number, kind: 'white' | 'brown'): AudioBuffer {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w;
        else {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // reflexiones tempranas + cola difusa
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 400 ? 0.3 : 1);
      }
    }
    return buf;
  }

  private noiseSource(buf = this.noiseBuf, loop = false): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    if (!loop) s.loopStart = 0;
    return s;
  }

  private panner(p: number): StereoPannerNode | GainNode {
    if (this.ctx.createStereoPanner) {
      const sp = this.ctx.createStereoPanner();
      sp.pan.value = Math.max(-1, Math.min(1, p));
      return sp;
    }
    return this.ctx.createGain();
  }

  // ---------------------------------------------------------------- ambiente
  private buildAmbience() {
    const ctx = this.ctx;
    // Agua grave continua
    const low = this.noiseSource(this.brownBuf, true);
    const lowF = ctx.createBiquadFilter();
    lowF.type = 'lowpass';
    lowF.frequency.value = 420;
    this.waterLow = ctx.createGain();
    this.waterLow.gain.value = 0.32;
    low.connect(lowF).connect(this.waterLow).connect(this.amb);
    low.start();

    // Chapoteo / oleaje suave (se modula en update)
    const hi = this.noiseSource(this.noiseBuf, true);
    this.waterHiFilter = ctx.createBiquadFilter();
    this.waterHiFilter.type = 'bandpass';
    this.waterHiFilter.frequency.value = 900;
    this.waterHiFilter.Q.value = 0.8;
    this.waterHi = ctx.createGain();
    this.waterHi.gain.value = 0.0;
    hi.connect(this.waterHiFilter).connect(this.waterHi);
    this.waterHi.connect(this.amb);
    this.waterHi.connect(this.reverbSend);
    hi.start();

    // Zumbido industrial del río contaminado
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 50;
    const hum2 = ctx.createOscillator();
    hum2.type = 'sine';
    hum2.frequency.value = 100.6;
    const humF = ctx.createBiquadFilter();
    humF.type = 'lowpass';
    humF.frequency.value = 160;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.05;
    hum.connect(humF);
    hum2.connect(humF);
    humF.connect(this.humGain).connect(this.amb);
    hum.start();
    hum2.start();
  }

  private buildEngine() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 46;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 92.5;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 260;
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    // trémolo leve para que suene a motor fuera de borda
    const trem = ctx.createOscillator();
    trem.frequency.value = 11;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.25;
    const tremBase = ctx.createGain();
    tremBase.gain.value = 1;
    trem.connect(tremG).connect(tremBase.gain);
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(tremBase).connect(this.engineGain).connect(this.sfx);
    this.engineOsc.start();
    this.engineOsc2.start();
    trem.start();

    // burbujeo del agua contra el casco
    const b = this.noiseSource(this.noiseBuf, true);
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 520;
    bf.Q.value = 3;
    this.bubbleGain = ctx.createGain();
    this.bubbleGain.gain.value = 0;
    b.connect(bf).connect(this.bubbleGain).connect(this.sfx);
    b.start();
  }

  /** throttle 0..1 */
  setEngine(throttle: number, speedNorm: number) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const th = Math.max(0, Math.min(1, throttle));
    this.engineGain.gain.setTargetAtTime(0.012 + th * 0.06, t, 0.12);
    this.engineOsc.frequency.setTargetAtTime(42 + th * 34 + speedNorm * 10, t, 0.15);
    this.engineOsc2.frequency.setTargetAtTime(85 + th * 70 + speedNorm * 20, t, 0.15);
    this.engineFilter.frequency.setTargetAtTime(220 + th * 650, t, 0.15);
    this.bubbleGain.gain.setTargetAtTime(th * 0.11, t, 0.2);
  }

  setCleanliness(c: number) {
    this.cleanliness = Math.max(0, Math.min(1, c));
  }

  // ---------------------------------------------------------------- loop
  update() {
    if (!this.started || (!this.offline && this.ctx.state !== 'running')) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const c = this.cleanliness;

    this.humGain.gain.setTargetAtTime(0.045 * Math.pow(1 - c, 1.5), t, 0.5);
    this.waterLow.gain.setTargetAtTime(0.26 + 0.08 * c, t, 0.5);

    // olas: pequeñas ráfagas aleatorias
    if (t > this.nextLap) {
      const dur = rand(1.2, 3);
      this.waterHi.gain.cancelScheduledValues(t);
      this.waterHi.gain.setTargetAtTime(rand(0.03, 0.075), t, dur * 0.3);
      this.waterHi.gain.setTargetAtTime(0.008, t + dur * 0.5, dur * 0.3);
      this.waterHiFilter.frequency.setTargetAtTime(rand(600, 1400), t, 0.5);
      this.nextLap = t + dur + rand(0.2, 1.5);
    }

    // pájaros (más cuanto más limpio)
    if (c > 0.08 && t > this.nextBird) {
      this.bird();
      const rate = 0.15 + 2.2 * Math.pow(c, 1.3);
      this.nextBird = t + rand(0.5, 2.5) / rate;
    }
    // ranas a partir del 30%
    if (c > 0.3 && t > this.nextFrog) {
      this.frog();
      this.nextFrog = t + rand(2.5, 8) / (c * 1.5);
    }

    // música con lookahead
    while (this.nextBeat < t + 0.25) {
      this.scheduleBeat(this.nextBeat, this.beat);
      this.nextBeat += 60 / this.bpm / 2; // corcheas
      this.beat++;
    }
  }

  // ---------------------------------------------------------------- música
  private scheduleBeat(time: number, eighth: number) {
    const c = this.cleanliness;
    const barLen = 8; // corcheas por compás
    const chordIdx = Math.floor(eighth / (barLen * 2)) % 4;
    const useClean = c > 0.5;
    const blend = Math.max(0, Math.min(1, (c - 0.35) / 0.3)); // 0..1 alrededor del 50%
    const chord = (useClean ? CLEAN_PROG : DIRTY_PROG)[chordIdx];
    const posInChord = eighth % (barLen * 2);

    // Pad + bajo al empezar cada acorde
    if (posInChord === 0) {
      const dur = (60 / this.bpm) * 8;
      this.pad(chord.slice(1), time, dur, 500 + 2200 * c, 0.05 + 0.02 * c);
      this.bass(chord[0], time, dur * 0.9, 0.11);
    }
    if (posInChord === 8 && c > 0.2) this.bass(chord[0] + 12, time, (60 / this.bpm) * 3, 0.05);

    // Melodía pentatónica, más densa con el río limpio
    const density = 0.12 + 0.45 * c;
    const strong = eighth % 2 === 0;
    if (Math.random() < density * (strong ? 1 : 0.5)) {
      const pool = A_MINOR_PENTA.filter((n) => n >= 64 - Math.round(4 * blend));
      let n = pick(pool);
      if (Math.random() < 0.45) n = chord[1 + Math.floor(Math.random() * (chord.length - 1))] + 12;
      this.pluck(n, time, 0.07 + 0.03 * c, 0.6 + c);
    }
    // campanitas cuando el río está muy limpio
    if (c > 0.5 && eighth % 4 === 2 && Math.random() < (c - 0.5) * 0.9) {
      this.bell(pick(chord.slice(1)) + 24, time, 0.035);
    }
    // percusión suave (shaker) desde el 25%
    if (c > 0.25 && !strong && Math.random() < 0.6) this.shaker(time, 0.015 + 0.02 * c);
  }

  private pad(notes: number[], time: number, dur: number, cutoff: number, vol: number) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 1.6);
    g.gain.setValueAtTime(vol, time + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, time + dur + 2);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.reverbSend);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det + rand(-2, 2);
        const og = ctx.createGain();
        og.gain.value = 0.22;
        o.connect(og).connect(f);
        o.start(time);
        o.stop(time + dur + 2.2);
      }
    }
  }

  private bass(n: number, time: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(n - 12 >= 28 ? n - 12 : n);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = mtof(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.08);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, time + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.music);
    o.start(time);
    o2.start(time);
    o.stop(time + dur + 0.05);
    o2.stop(time + dur + 0.05);
  }

  private pluck(n: number, time: number, vol: number, bright: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(n);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = mtof(n) * 2;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1200 + 2500 * bright, time);
    f.frequency.exponentialRampToValueAtTime(500, time + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 1.1);
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g);
    const p = this.panner(rand(-0.5, 0.5));
    g.connect(p);
    p.connect(this.music);
    p.connect(this.delaySend);
    p.connect(this.reverbSend);
    o.start(time);
    o2.start(time);
    o.stop(time + 1.2);
    o2.stop(time + 1.2);
  }

  private bell(n: number, time: number, vol: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 2.5);
    const p = this.panner(rand(-0.7, 0.7));
    g.connect(p);
    p.connect(this.music);
    p.connect(this.reverbSend);
    for (const [ratio, amp] of [
      [1, 1],
      [2.76, 0.4],
      [5.4, 0.2],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(n) * ratio;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(time);
      o.stop(time + 2.6);
    }
  }

  private shaker(time: number, vol: number) {
    const ctx = this.ctx;
    const s = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    s.connect(f).connect(g).connect(this.music);
    s.start(time, rand(0, 1.5));
    s.stop(time + 0.1);
  }

  // ---------------------------------------------------------------- fauna
  private bird() {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const p = this.panner(rand(-0.9, 0.9));
    const g = ctx.createGain();
    g.gain.value = rand(0.012, 0.03);
    g.connect(p);
    p.connect(this.amb);
    p.connect(this.reverbSend);
    const kind = Math.floor(Math.random() * 3);
    const notes = kind === 0 ? 2 + Math.floor(Math.random() * 3) : kind === 1 ? 1 : 4 + Math.floor(Math.random() * 4);
    const base = rand(2200, 4200);
    let tt = t;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const ng = ctx.createGain();
      const d = kind === 2 ? 0.05 : rand(0.08, 0.18);
      const f0 = base * rand(0.9, 1.1);
      o.frequency.setValueAtTime(f0, tt);
      if (kind === 1) {
        o.frequency.exponentialRampToValueAtTime(f0 * 1.6, tt + d * 0.5);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.8, tt + d);
      } else {
        o.frequency.exponentialRampToValueAtTime(f0 * rand(0.7, 1.4), tt + d);
      }
      ng.gain.setValueAtTime(0, tt);
      ng.gain.linearRampToValueAtTime(1, tt + 0.01);
      ng.gain.exponentialRampToValueAtTime(0.001, tt + d);
      o.connect(ng).connect(g);
      o.start(tt);
      o.stop(tt + d + 0.02);
      tt += d + (kind === 2 ? 0.02 : rand(0.04, 0.12));
    }
  }

  private frog() {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const p = this.panner(rand(-1, 1));
    p.connect(this.amb);
    const reps = 1 + Math.floor(Math.random() * 3);
    for (let r = 0; r < reps; r++) {
      const tt = t + r * 0.32;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(rand(140, 190), tt);
      o.frequency.exponentialRampToValueAtTime(rand(100, 130), tt + 0.18);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 600;
      f.Q.value = 4;
      const am = ctx.createOscillator();
      am.frequency.value = 38;
      const amG = ctx.createGain();
      amG.gain.value = 0.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.05, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.22);
      am.connect(amG).connect(g.gain);
      o.connect(f).connect(g).connect(p);
      o.start(tt);
      am.start(tt);
      o.stop(tt + 0.25);
      am.stop(tt + 0.25);
    }
  }

  // ---------------------------------------------------------------- SFX
  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  splash(size = 1, pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2200 / Math.sqrt(size), t);
    f.frequency.exponentialRampToValueAtTime(400 / Math.sqrt(size), t + 0.25 * size);
    f.Q.value = 0.9;
    const g = ctx.createGain();
    this.env(g, t, 0.18 * Math.min(1.6, Math.sqrt(size)), 0.008, 0.25 + 0.2 * size);
    const p = this.panner(pan);
    s.connect(f).connect(g).connect(p);
    p.connect(this.sfx);
    p.connect(this.reverbSend);
    s.start(t, rand(0, 1.5));
    s.stop(t + 0.8 + size * 0.3);
    // "plop" de burbuja
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rand(380, 520) / Math.sqrt(size), t);
    o.frequency.exponentialRampToValueAtTime(rand(900, 1300) / Math.sqrt(size), t + 0.07);
    const og = ctx.createGain();
    this.env(og, t, 0.1, 0.004, 0.09);
    o.connect(og).connect(p);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** Recolección: el tono sube con combos rápidos (escala pentatónica). */
  pickup(material: Material, pan = 0) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (t - this.lastComboAt < 0.9) this.combo = Math.min(this.combo + 1, 14);
    else this.combo = 0;
    this.lastComboAt = t;
    const scale = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96, 98, 100, 103, 105];
    const n = scale[this.combo];
    const p = this.panner(pan);
    p.connect(this.sfx);
    p.connect(this.reverbSend);

    if (material === 'pesado' || material === 'goma') {
      this.splash(material === 'pesado' ? 1.8 : 1.2, pan);
      // golpe metálico / sordo
      const o = ctx.createOscillator();
      o.type = material === 'pesado' ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(material === 'pesado' ? 110 : 160, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.3);
      const g = ctx.createGain();
      this.env(g, t, 0.2, 0.008, 0.45);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + 0.5);
      if (material === 'pesado') {
        for (const r of [2.3, 3.9, 5.1]) {
          const m = ctx.createOscillator();
          m.frequency.value = 180 * r;
          const mg = ctx.createGain();
          this.env(mg, t + 0.02, 0.04, 0.002, 0.7);
          m.connect(mg).connect(p);
          m.start(t);
          m.stop(t + 0.8);
        }
      }
      this.chime(n, t + 0.05, 0.08, p);
      return;
    }

    this.splash(0.5, pan);
    if (material === 'vidrio') {
      this.chime(n, t, 0.11, p);
      this.chime(n + 12, t + 0.01, 0.03, p);
    } else if (material === 'metal') {
      // "tink" de lata: parciales inarmónicos
      for (const [r, a] of [
        [1, 0.08],
        [2.41, 0.05],
        [3.76, 0.03],
      ]) {
        const o = ctx.createOscillator();
        o.frequency.value = mtof(n - 12) * r;
        const g = ctx.createGain();
        this.env(g, t, a, 0.002, 0.25);
        o.connect(g).connect(p);
        o.start(t);
        o.stop(t + 0.3);
      }
      this.chime(n, t + 0.01, 0.06, p);
    } else {
      // plástico: "fsst" + nota suave
      const s = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 2500;
      const g = ctx.createGain();
      this.env(g, t, 0.06, 0.02, 0.12);
      s.connect(f).connect(g).connect(p);
      s.start(t, rand(0, 1.5));
      s.stop(t + 0.2);
      this.chime(n, t + 0.02, 0.08, p);
    }
  }

  private chime(n: number, t: number, vol: number, dest: AudioNode) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(n);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = mtof(n) * 3.01;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.004, 0.55);
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(dest);
    o.start(t);
    o2.start(t);
    o.stop(t + 0.65);
    o2.stop(t + 0.65);
  }

  /** Depósito en la planta: cascada de monedas proporcional a lo cobrado + acorde. */
  deposit(amountNorm: number) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const coins = Math.round(6 + 22 * Math.min(1, amountNorm));
    for (let i = 0; i < coins; i++) {
      const tt = t + i * rand(0.025, 0.05) + Math.pow(i / coins, 1.5) * 0.4;
      const p = this.panner(rand(-0.6, 0.6));
      p.connect(this.sfx);
      p.connect(this.reverbSend);
      const f0 = rand(2600, 4200);
      for (const [r, a] of [
        [1, 0.035],
        [1.47, 0.02],
        [2.13, 0.012],
      ]) {
        const o = ctx.createOscillator();
        o.frequency.value = f0 * r;
        const g = ctx.createGain();
        this.env(g, tt, a, 0.001, rand(0.12, 0.3));
        o.connect(g).connect(p);
        o.start(tt);
        o.stop(tt + 0.35);
      }
    }
    // "cha-ching": arpegio mayor ascendente
    const arp = [72, 76, 79, 84, 88];
    arp.forEach((n, i) => {
      const p = this.panner(-0.3 + i * 0.15);
      p.connect(this.sfx);
      p.connect(this.reverbSend);
      p.connect(this.delaySend);
      this.chime(n, t + 0.05 + i * 0.065, 0.09, p);
    });
    // cinta transportadora / descarga
    const s = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = ctx.createGain();
    this.env(g, t, 0.12, 0.05, 0.5);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, rand(0, 1));
    s.stop(t + 0.7);
  }

  buy() {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = ctx.createGain();
    this.env(g, t, 0.1, 0.01, 0.25);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.3);
    [79, 84, 88, 91].forEach((n, i) => {
      const p = this.panner(0);
      p.connect(this.sfx);
      p.connect(this.reverbSend);
      this.chime(n, t + 0.08 + i * 0.045, 0.07, p);
    });
  }

  denied() {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [i, n] of [
      [0, 52],
      [1, 49],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(n);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const g = ctx.createGain();
      this.env(g, t + i * 0.09, 0.05, 0.005, 0.12);
      o.connect(f).connect(g).connect(this.sfx);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.2);
    }
  }

  full() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const p = this.panner(0);
    p.connect(this.sfx);
    p.connect(this.reverbSend);
    this.chime(84, t, 0.09, p);
    this.chime(79, t + 0.14, 0.09, p);
    this.chime(84, t + 0.28, 0.07, p);
  }

  click() {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.04);
    const g = ctx.createGain();
    this.env(g, t, 0.05, 0.002, 0.05);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.08);
  }

  milestone() {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.pad([60, 64, 67, 71, 74], t, 3, 3000, 0.07);
    [60, 67, 72, 76, 79, 84].forEach((n, i) => {
      const p = this.panner(-0.5 + i * 0.2);
      p.connect(this.sfx);
      p.connect(this.reverbSend);
      p.connect(this.delaySend);
      this.chime(n, t + i * 0.09, 0.09, p);
    });
    this.bell(96, t + 0.6, 0.06);
    for (let i = 0; i < 4; i++) setTimeout(() => this.bird(), 300 + i * 250);
  }

  victory() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.pad([48, 55, 60, 64, 67, 71], t, 7, 4000, 0.09);
    const mel = [72, 76, 79, 84, 83, 79, 81, 84, 88];
    mel.forEach((n, i) => this.bell(n, t + 0.4 + i * 0.32, 0.06));
    for (let i = 0; i < 10; i++) setTimeout(() => this.bird(), 400 + i * 300);
  }

  fishJump(pan = 0) {
    if (!this.started) return;
    this.splash(0.7, pan);
  }
}

export const audio = new AudioEngine();
