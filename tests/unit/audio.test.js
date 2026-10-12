import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sfx } from '../../src/audio/sfx.js';
import { loadSettings, saveSettings } from '../../src/ui/settings.js';

// Minimal Web Audio stub (Node has no Web Audio).
function param(v = 0) {
  return { value: v, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {},
    cancelScheduledValues() {} };
}
function node(extra = {}) {
  return { connect: (n) => n, disconnect() {}, ...extra };
}
function stubCtx() {
  const ctx = {
    currentTime: 0,
    started: [],
    createBufferSource: () => {
      const n = node({ buffer: null, loop: false, playbackRate: param(1), detune: param(0), onended: null,
        start: () => ctx.started.push(n), stop() {} });
      return n;
    },
    createGain: () => node({ gain: param(1) }),
    createStereoPanner: () => node({ pan: param(0) }),
    createOscillator: () => node({ type: 'sine', frequency: param(440), start() {}, stop() {} }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(350), Q: param(1) }),
  };
  return ctx;
}
function stubEngine(voiceLimit = 3) {
  const ctx = stubCtx();
  const buffers = new Map();
  for (const n of ['boom', 'splash', 'explosion', 'groan', 'crack', 'bubbles', 'bigSplash', 'tick', 'click', 'wind', 'crackle']) {
    buffers.set(n, [{ duration: 1, name: n }]);
  }
  const e = { ctx, buffers, voiceLimit, sfxBus: node(), musicBus: node(), reverbSend: node(), panFor: (x) => x / 10,
    ducks: 0, duck() {
      e.ducks++;
    }, music: { stinger() {} } };
  e.sfx = new Sfx(e);
  return e;
}

describe('sound cue mapping', () => {
  it('maps game events to cues and ducks the music under explosions', () => {
    const e = stubEngine(24);
    e.sfx.cue('fire', { x: -6 });
    e.sfx.cue('splash', { x: 6 });
    e.sfx.cue('explosion', { x: 6 });
    expect(e.ctx.started.map((s) => s.buffer.name)).toEqual(['boom', 'splash', 'explosion']);
    expect(e.ducks).toBe(1);
  });
  it('a sinking plays groan, crack (if it breaks), bubbles and a big splash', () => {
    const e = stubEngine(24);
    e.sfx.cue('sunk', { x: 0, breaks: true });
    expect(e.ctx.started.map((s) => s.buffer.name)).toEqual(['groan', 'crack', 'bubbles', 'bigSplash']);
  });
  it('steals the oldest voice when over the limit', () => {
    const e = stubEngine(3);
    for (let i = 0; i < 5; i++) e.sfx.cue('splash', { x: 0 });
    expect(e.sfx.voices.length).toBe(3);
  });
  it('rate-limits aim ticks', () => {
    const e = stubEngine(24);
    e.sfx.cue('tick');
    e.sfx.cue('tick');
    e.ctx.currentTime = 0.2;
    e.sfx.cue('tick');
    expect(e.ctx.started.length).toBe(2);
  });
});

describe('settings persistence', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  });
  afterEach(() => {
    delete globalThis.localStorage;
  });
  it('round-trips and repairs invalid values', () => {
    const s = loadSettings();
    expect(s).toMatchObject({ difficulty: 'normal', graphics: 'auto', muted: false });
    s.graphics = 'ultra';
    s.volumes.music = 0.2;
    saveSettings(s);
    expect(loadSettings()).toMatchObject({ graphics: 'ultra', volumes: { music: 0.2, effects: 1 } });
    store.set('bs.settings.v1', JSON.stringify({ graphics: 'potato', difficulty: 'godlike' }));
    expect(loadSettings()).toMatchObject({ graphics: 'auto', difficulty: 'normal' });
  });
});
