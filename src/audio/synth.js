// Procedural sound recipes, rendered once into AudioBuffers with OfflineAudioContext (off the main thread,
// no user gesture needed). No audio files are downloaded.
import { createRng } from '../game/rng.js';

export const SAMPLE_RATE = 32000;

function noiseBuffer(ctx, seconds, rng, color = 'white') {
  const n = Math.ceil(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b = 0;
  let p0 = 0;
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    if (color === 'brown') {
      b = (b + 0.02 * w) / 1.02;
      d[i] = b * 3.5;
    } else if (color === 'pink') {
      p0 = 0.99765 * p0 + w * 0.099046;
      p1 = 0.963 * p1 + w * 0.2965164;
      p2 = 0.57 * p2 + w * 1.0526913;
      d[i] = (p0 + p1 + p2 + w * 0.1848) * 0.18;
    } else d[i] = w;
  }
  return buf;
}

function noise(ctx, rng, seconds, color) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds, rng, color);
  return src;
}

function filter(ctx, type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Gain with an attack/exponential-decay envelope. */
function env(ctx, t0, peak, attack, decay, hold = 0) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  if (hold) g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay);
  return g;
}

function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

function tone(ctx, type, f0, f1, t0, dur, peak, out, attack = 0.002) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  chain(o, env(ctx, t0, peak, attack, dur), out);
  o.start(t0);
  o.stop(t0 + attack + dur + 0.05);
  return o;
}

function metal(ctx, t0, peak, decay, out, rng, partials = [233, 587, 941, 1563, 2210]) {
  for (const p of partials) tone(ctx, 'sine', p * (0.97 + rng.next() * 0.06), p, t0, decay * (0.6 + rng.next() * 0.6), peak / partials.length * 2, out);
}

function burst(ctx, rng, out, { t0 = 0, len = 1, type = 'lowpass', f0 = 3000, f1 = 300, q = 0.7, peak = 0.8, attack = 0.003, decay = 0.8, color }) {
  const src = noise(ctx, rng, len + 0.1, color);
  const f = filter(ctx, type, f0, q);
  f.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + len);
  chain(src, f, env(ctx, t0, peak, attack, decay), out);
  src.start(t0);
}

function chirps(ctx, rng, out, count, t0, spread, lo = 350, hi = 1300, peak = 0.05) {
  for (let i = 0; i < count; i++) {
    const t = t0 + rng.next() * spread;
    const f = lo + rng.next() * (hi - lo);
    tone(ctx, 'sine', f, f * (1.25 + rng.next() * 0.4), t, 0.03 + rng.next() * 0.06, peak * (0.4 + rng.next()), out);
  }
}

/** name -> { duration, loop?, build(ctx, rng) } */
export const RECIPES = {
  boom: {
    duration: 1.4,
    build(ctx, rng, out) {
      burst(ctx, rng, out, { len: 0.5, f0: 6500, f1: 280, peak: 0.95, decay: 0.95 });
      tone(ctx, 'sine', 64, 34, 0, 0.55, 0.9, out);
      metal(ctx, 0.005, 0.07, 0.3, out, rng, [420, 1130, 1720]);
    },
  },
  distantBoom: {
    duration: 1.8,
    build(ctx, rng, out) {
      const lp = chain(filter(ctx, 'lowpass', 700), out);
      burst(ctx, rng, lp, { len: 0.8, f0: 1400, f1: 200, peak: 0.6, attack: 0.02, decay: 1.3 });
      tone(ctx, 'sine', 50, 32, 0.01, 0.9, 0.5, out, 0.02);
    },
  },
  splash: {
    duration: 1.3,
    build(ctx, rng, out) {
      burst(ctx, rng, out, { type: 'bandpass', len: 0.6, f0: 1500, f1: 700, q: 0.8, peak: 0.85, decay: 0.55 });
      burst(ctx, rng, out, { type: 'highpass', len: 0.2, f0: 3500, f1: 3500, peak: 0.35, decay: 0.18 });
      burst(ctx, rng, out, { type: 'lowpass', len: 0.4, f0: 500, f1: 150, peak: 0.5, decay: 0.35 });
      chirps(ctx, rng, out, 12, 0.15, 0.8);
    },
  },
  explosion: {
    duration: 2.6,
    build(ctx, rng, out) {
      burst(ctx, rng, out, { type: 'highpass', len: 0.05, f0: 2200, f1: 2200, peak: 0.9, attack: 0.001, decay: 0.06 });
      burst(ctx, rng, out, { len: 1.3, f0: 2600, f1: 160, peak: 0.95, attack: 0.004, decay: 1.6 });
      burst(ctx, rng, out, { len: 2.2, f0: 160, f1: 70, peak: 0.7, attack: 0.03, decay: 2.1, color: 'brown' });
      tone(ctx, 'sine', 52, 28, 0, 0.9, 0.95, out);
      metal(ctx, 0.01, 0.12, 0.7, out, rng);
    },
  },
  groan: {
    duration: 3.2,
    build(ctx, rng, out) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(58, 0);
      o.frequency.linearRampToValueAtTime(44, 3);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 2.6 + rng.next();
      const lg = ctx.createGain();
      lg.gain.value = 4;
      chain(lfo, lg, o.frequency);
      const bp = filter(ctx, 'bandpass', 200, 7);
      bp.frequency.setValueAtTime(220, 0);
      bp.frequency.exponentialRampToValueAtTime(90, 3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(0.55, 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, 3.1);
      chain(o, bp, g, out);
      o.start(0);
      lfo.start(0);
      o.stop(3.2);
      lfo.stop(3.2);
      metal(ctx, 0.4, 0.05, 1.8, out, rng, [97, 151, 263]);
    },
  },
  crack: {
    duration: 1,
    build(ctx, rng, out) {
      burst(ctx, rng, out, { type: 'bandpass', len: 0.3, f0: 2600, f1: 900, q: 1.2, peak: 0.9, attack: 0.001, decay: 0.3 });
      tone(ctx, 'sine', 80, 40, 0, 0.5, 0.7, out);
      metal(ctx, 0.0, 0.1, 0.5, out, rng, [311, 733, 1290]);
    },
  },
  bubbles: {
    duration: 2.4,
    build(ctx, rng, out) {
      chirps(ctx, rng, out, 46, 0, 2.1, 250, 1100, 0.09);
      burst(ctx, rng, out, { type: 'lowpass', len: 2, f0: 400, f1: 200, peak: 0.25, attack: 0.3, decay: 1.6, color: 'brown' });
    },
  },
  bigSplash: {
    duration: 2.2,
    build(ctx, rng, out) {
      burst(ctx, rng, out, { type: 'bandpass', len: 1.2, f0: 1100, f1: 400, q: 0.6, peak: 0.8, attack: 0.02, decay: 1.2 });
      burst(ctx, rng, out, { type: 'lowpass', len: 1.6, f0: 300, f1: 90, peak: 0.6, attack: 0.03, decay: 1.6, color: 'brown' });
      chirps(ctx, rng, out, 20, 0.3, 1.5);
    },
  },
  crackle: {
    duration: 3,
    loop: true,
    build(ctx, rng, out) {
      burst(ctx, rng, out, { type: 'lowpass', len: 3, f0: 220, f1: 220, peak: 0.35, attack: 0.05, decay: 0.1, color: 'brown' });
      const hp = chain(filter(ctx, 'highpass', 1400), out);
      for (let i = 0; i < 75; i++) {
        const t = rng.next() * 2.9;
        burst(ctx, rng, hp, { type: 'bandpass', t0: t, len: 0.01, f0: 1500 + rng.next() * 3000, f1: 1500, q: 2, peak: 0.2 + rng.next() * 0.5,
          attack: 0.0005, decay: 0.006 + rng.next() * 0.02 });
      }
    },
  },
  sea: {
    duration: 8,
    loop: true,
    build(ctx, rng, out) {
      const src = noise(ctx, rng, 8.2, 'pink');
      chain(src, filter(ctx, 'lowpass', 900), out);
      src.start(0);
      const low = noise(ctx, rng, 8.2, 'brown');
      const g = ctx.createGain();
      g.gain.value = 0.9;
      chain(low, filter(ctx, 'lowpass', 280), g, out);
      low.start(0);
    },
  },
  wind: {
    duration: 8,
    loop: true,
    build(ctx, rng, out) {
      const src = noise(ctx, rng, 8.2, 'pink');
      chain(src, filter(ctx, 'bandpass', 520, 1.4), out);
      src.start(0);
    },
  },
  drum: {
    duration: 1.4,
    build(ctx, rng, out) {
      tone(ctx, 'sine', 104, 92, 0, 1.2, 0.85, out, 0.003);
      tone(ctx, 'sine', 156, 140, 0, 0.6, 0.25, out, 0.003);
      burst(ctx, rng, out, { type: 'lowpass', len: 0.2, f0: 700, f1: 200, peak: 0.6, attack: 0.001, decay: 0.18 });
    },
  },
  snare: {
    duration: 0.4,
    build(ctx, rng, out) {
      burst(ctx, rng, out, { type: 'bandpass', len: 0.2, f0: 1800, f1: 1200, q: 0.9, peak: 0.5, attack: 0.001, decay: 0.16 });
      tone(ctx, 'triangle', 190, 160, 0, 0.1, 0.25, out);
    },
  },
  tick: { duration: 0.06, build: (ctx, rng, out) => tone(ctx, 'sine', 1900, 1700, 0, 0.03, 0.18, out) },
  click: {
    duration: 0.1,
    build(ctx, rng, out) {
      tone(ctx, 'sine', 900, 700, 0, 0.05, 0.3, out);
      burst(ctx, rng, out, { type: 'highpass', len: 0.01, f0: 3000, f1: 3000, peak: 0.25, attack: 0.0005, decay: 0.01 });
    },
  },
  snap: {
    duration: 0.15,
    build(ctx, rng, out) {
      tone(ctx, 'triangle', 520, 380, 0, 0.07, 0.4, out);
      burst(ctx, rng, out, { type: 'bandpass', len: 0.02, f0: 2000, f1: 2000, q: 1, peak: 0.3, attack: 0.0005, decay: 0.02 });
    },
  },
  swish: {
    duration: 0.3,
    build(ctx, rng, out) {
      burst(ctx, rng, out, { type: 'bandpass', len: 0.22, f0: 700, f1: 2600, q: 1.5, peak: 0.45, attack: 0.06, decay: 0.16 });
    },
  },
  invalid: {
    duration: 0.25,
    build(ctx, rng, out) {
      const lp = chain(filter(ctx, 'lowpass', 900), out);
      tone(ctx, 'square', 140, 138, 0, 0.18, 0.18, lp, 0.005);
      tone(ctx, 'square', 147, 145, 0, 0.18, 0.18, lp, 0.005);
    },
  },
  victory: {
    duration: 3.2,
    build(ctx, rng, out) {
      const lp = chain(filter(ctx, 'lowpass', 2400), out);
      const notes = [[293.66, 0], [369.99, 0.16], [440, 0.32], [587.33, 0.5]];
      for (const [f, t] of notes) brass(ctx, f, t, 0.35, 0.22, lp);
      for (const f of [293.66, 369.99, 440, 587.33]) brass(ctx, f, 0.85, 2.1, 0.16, lp);
      tone(ctx, 'sine', 73.4, 73.4, 0.85, 2.2, 0.35, out, 0.02);
    },
  },
  defeat: {
    duration: 3.6,
    build(ctx, rng, out) {
      const lp = chain(filter(ctx, 'lowpass', 1300), out);
      const notes = [[293.66, 0], [261.63, 0.45], [220, 0.9]];
      for (const [f, t] of notes) brass(ctx, f, t, 0.6, 0.2, lp);
      for (const f of [146.83, 174.61, 220]) brass(ctx, f, 1.5, 2, 0.13, lp);
      tone(ctx, 'sine', 55, 52, 1.5, 2, 0.4, out, 0.05);
    },
  },
  stinger: {
    duration: 2,
    build(ctx, rng, out) {
      const lp = chain(filter(ctx, 'lowpass', 1100), out);
      for (const f of [73.42, 110, 146.83, 174.61]) brass(ctx, f, 0, 1.6, 0.16, lp);
    },
  },
};

/** Brass-like note: detuned saws with a filter-ish swell. */
function brass(ctx, f, t0, dur, peak, out) {
  for (const d of [-6, 5]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = d;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.05);
    g.gain.setValueAtTime(peak * 0.8, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    chain(o, g, out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

/** Crossfade the tail into the head so a buffer loops without a click. */
function makeLoop(buffer, fadeSeconds) {
  const d = buffer.getChannelData(0);
  const n = Math.floor(fadeSeconds * buffer.sampleRate);
  const len = d.length - n;
  for (let i = 0; i < n; i++) {
    const a = i / n;
    d[i] = d[i] * a + d[len + i] * (1 - a);
  }
  const out = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: buffer.sampleRate });
  out.copyToChannel(d.subarray(0, len), 0);
  return out;
}

function normalise(buffer, target = 0.9) {
  const d = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > target) for (let i = 0; i < d.length; i++) d[i] *= target / peak;
  return buffer;
}

/** Render one recipe variant. */
export async function renderCue(name, variant = 0) {
  const recipe = RECIPES[name];
  const loopPad = recipe.loop ? 0.25 : 0;
  const ctx = new OfflineAudioContext(1, Math.ceil((recipe.duration + loopPad) * SAMPLE_RATE), SAMPLE_RATE);
  const rng = createRng(1000 + variant * 7919 + name.length * 131);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  recipe.build(ctx, rng, out);
  const buffer = normalise(await ctx.startRendering());
  return recipe.loop ? makeLoop(buffer, loopPad) : buffer;
}
