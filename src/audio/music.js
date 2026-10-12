// Generative naval score in D minor. A lookahead sequencer schedules ~120 ms ahead on the audio clock;
// intensity follows the game state and changes on bar boundaries. Seeded, so ?seed= reproduces the score.
import { createRng } from '../game/rng.js';

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);
// chord roots (MIDI) + quality
const CHORDS = {
  Dm: [50, 53, 57], Bb: [46, 50, 53], F: [53, 57, 60], C: [48, 52, 55], Gm: [55, 58, 62], A: [45, 49, 52],
};
const PROGRESSIONS = {
  calm: ['Dm', 'Bb', 'F', 'C'],
  battle: ['Dm', 'C', 'Bb', 'A'],
  tension: ['Dm', 'Bb', 'Gm', 'A'],
};
const TEMPO = { calm: 70, battle: 86, tension: 104 };

export class Music {
  constructor(engine, seed = 1) {
    this.e = engine;
    this.rng = createRng(seed);
    this.state = 'calm';
    this.pending = 'calm';
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.pattern = [0, 2, 1, 2, 0, 2, 1, 2];
  }

  get ctx() {
    return this.e.ctx;
  }

  start() {
    if (this.timer || !this.ctx) return;
    this.nextTime = this.ctx.currentTime + 0.15;
    this.timer = setInterval(() => this.#schedule(), 25);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  setState(state) {
    if (state === 'victory' || state === 'defeat') {
      this.pending = 'calm';
      return;
    }
    if (PROGRESSIONS[state]) this.pending = state;
  }

  stinger(name) {
    this.e.sfx?.play(name, { gain: name === 'stinger' ? 0.5 : 0.75, bus: this.e.musicBus, reverb: 0.5 });
  }

  #schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05; // resumed after a long gap
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.#playStep(this.step, this.nextTime);
      this.nextTime += 60 / TEMPO[this.state] / 4;
      this.step++;
    }
  }

  #playStep(step, t) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    if (s16 === 0) {
      if (this.pending !== this.state && bar % 2 === 0) this.state = this.pending;
      if (bar % 4 === 0) this.pattern = this.rng.shuffle([0, 1, 2, 2, 1, 0, 2, 1]);
    }
    const prog = PROGRESSIONS[this.state];
    const chord = CHORDS[prog[Math.floor(bar / 2) % prog.length]];
    const barLen = (60 / TEMPO[this.state]) * 4;
    if (s16 === 0 && bar % 2 === 0) this.#pad(chord, t, barLen * 2);
    const st = this.state;
    if (st === 'calm') {
      if ((s16 === 0 && this.rng.chance(0.55)) || (s16 === 10 && this.rng.chance(0.3))) {
        this.#pluck(NOTE(chord[this.rng.int(3)] + 24), t, 0.06, 0.9);
      }
      return;
    }
    // battle / tension: timpani, ostinato, (tension) snare + bass pulse
    if (s16 === 0 || s16 === 8 || (st === 'tension' && (s16 === 4 || s16 === 12))) this.#drum('drum', t, s16 === 0 ? 0.55 : 0.38);
    if (st === 'tension' && (s16 === 4 || s16 === 12)) this.#drum('snare', t, 0.22);
    const every = st === 'tension' ? 1 : 2;
    if (s16 % every === 0) {
      const idx = this.pattern[(s16 / every) % this.pattern.length];
      this.#pluck(NOTE(chord[idx] + (st === 'tension' ? 24 : 12)), t, st === 'tension' ? 0.045 : 0.05, 0.28);
    }
    if (st === 'tension' && s16 % 2 === 0) this.#bass(NOTE(chord[0] - 12), t, 0.2);
  }

  #pad(chord, t, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.state === 'calm' ? 700 : 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + Math.min(1.2, dur * 0.3));
    g.gain.setValueAtTime(0.05, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    lp.connect(g).connect(this.e.musicBus);
    if (this.e.reverbSend) g.connect(this.e.reverbSend);
    for (const n of chord) {
      for (const d of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n);
        o.detune.value = d;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.5);
      }
    }
    const sub = ctx.createOscillator();
    sub.frequency.value = NOTE(chord[0] - 12);
    const sg = ctx.createGain();
    sg.gain.value = 0.6;
    sub.connect(sg).connect(lp);
    sub.start(t);
    sub.stop(t + dur + 0.5);
  }

  #pluck(f, t, peak, decay) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.e.musicBus);
    if (this.e.reverbSend) g.connect(this.e.reverbSend);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  #bass(f, t, decay) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.e.musicBus);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  #drum(name, t, gain) {
    const buf = this.e.buffers.get(name)?.[0];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.e.musicBus);
    if (this.e.reverbSend) g.connect(this.e.reverbSend);
    src.start(t);
  }
}
