// Audio engine (deferred chunk): buses, limiter, reverb, unlock/suspend/resume, cue rendering.
// Graph: sfx/fires -> sfx bus; sea + wind -> ambience bus; music -> music bus (ducked);
// all -> master gain -> limiter -> destination. Reverb send -> shared convolver (Medium and above).
import { TIERS } from '../config.js';
import { Ambience } from './ambience.js';
import { Music } from './music.js';
import { RECIPES, renderCue } from './synth.js';
import { Sfx } from './sfx.js';

// Render order: what's needed first comes first.
const PRERENDER = ['click', 'tick', 'snap', 'swish', 'invalid', 'sea', 'wind', 'boom', 'splash', 'explosion', 'distantBoom',
  'drum', 'crackle', 'groan', 'bubbles', 'bigSplash', 'crack', 'snare', 'stinger', 'victory', 'defeat'];
const SINGLE = new Set(['sea', 'wind', 'drum', 'snare', 'victory', 'defeat', 'stinger', 'tick', 'click']);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.tier = TIERS.high;
    this.settings = { muted: false, volumes: { effects: 1, ambience: 0.7, music: 0.5 } };
    this.voiceLimit = 24;
    this.panFor = (x) => x / 14;
    this.swell = () => 0;
    this.lastAmbience = 0;
    this.sfx = null;
    this.music = null;
    this.ambience = null;
    this.rendering = null;
  }

  get state() {
    if (!this.ctx) return 'waiting';
    return this.ctx.state;
  }

  /** Render cue buffers at idle. Offline rendering needs no user gesture and runs off the main thread. */
  prerender() {
    this.rendering ??= (async () => {
      const variants = this.tier.audioVariants ?? 3;
      for (const name of PRERENDER) {
        if (!RECIPES[name]) continue;
        const n = SINGLE.has(name) ? 1 : RECIPES[name].loop ? 2 : variants;
        const list = [];
        for (let v = 0; v < n; v++) {
          try {
            list.push(await renderCue(name, v));
          } catch {
            /* OfflineAudioContext unavailable: stay silent */
          }
          this.buffers.set(name, list);
        }
        if (name === 'wind') this.ambience?.start();
        await new Promise((r) => setTimeout(r, 0));
      }
      this.ambience?.start();
    })();
    return this.rendering;
  }

  /** Attach to a context the facade created inside a user gesture. */
  attach(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(ctx.destination);
    this.master = master;
    this.limiter = limiter;
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.ducker = ctx.createGain();
    this.sfxBus.connect(master);
    this.ambBus.connect(master);
    this.musicBus.connect(this.ducker).connect(master);
    this.#setupReverb();
    this.sfx = new Sfx(this);
    this.music = new Music(this, 7);
    this.ambience = new Ambience(this);
    this.music.setState(this.musicState ?? 'calm');
    this.music.start();
    if (this.buffers.has('wind')) this.ambience.start();
    this.#applySettings(true);
    if (typeof window !== 'undefined' && new URLSearchParams(location.search).has('recaudio')) this.#startRecording();
  }

  #setupReverb() {
    const ctx = this.ctx;
    if (this.reverbSend) return;
    if (!this.tier.reverb) {
      this.reverbSend = null;
      return;
    }
    // Generated ~1.1 s impulse response: decaying stereo noise.
    const len = Math.floor(ctx.sampleRate * 1.1);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const ret = ctx.createGain();
    ret.gain.value = 0.35;
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(conv).connect(ret).connect(this.master);
  }

  unlock() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setTier(tier) {
    this.tier = tier;
    this.voiceLimit = tier.voices ?? 24;
  }

  setSettings(s) {
    this.settings = s;
    this.#applySettings(false);
  }

  #applySettings(immediate) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (param, v) => (immediate ? param.setValueAtTime(v, t) : param.setTargetAtTime(v, t, 0.05));
    const s = this.settings;
    set(this.master.gain, s.muted ? 0 : 1);
    set(this.sfxBus.gain, s.volumes.effects);
    set(this.ambBus.gain, s.volumes.ambience);
    set(this.musicBus.gain, s.volumes.music * 0.8);
  }

  setMusicState(state) {
    this.musicState = state;
    this.music?.setState(state);
  }

  setSwell(fn) {
    this.swell = fn;
  }

  setPanner(fn) {
    this.panFor = fn;
  }

  /** Lower the music briefly so big hits cut through. */
  duck(level, seconds) {
    if (!this.ctx) return;
    const g = this.ducker.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(level, t, 0.02);
    g.setTargetAtTime(1, t + seconds, 0.35);
  }

  cue(name, opts) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.sfx.cue(name, opts);
  }

  /** ~10 Hz: ambience follows the swell; crackle follows the fires. */
  tick(fires) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - this.lastAmbience < 0.1) return;
    this.lastAmbience = now;
    this.ambience?.update(this.swell(0, -2));
    if (fires) this.sfx.setFires(fires.player, fires.enemy);
  }

  suspend() {
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  stats() {
    return { state: this.state, voices: this.sfx ? this.sfx.voices.length : 0, buffers: this.buffers.size };
  }

  /** e2e only: the whole mix as a stereo MediaStream (the limiter's output), for recordings. */
  tap() {
    if (!this.ctx || !this.limiter) return null;
    if (!this.tapped) {
      const dest = this.ctx.createMediaStreamDestination();
      this.limiter.connect(dest);
      this.tapped = dest.stream;
    }
    return this.tapped;
  }

  /** e2e only (?recaudio): tap the limiter output into a MediaRecorder so recordings can carry sound. */
  #startRecording() {
    try {
      const rec = new MediaRecorder(this.tap(), { mimeType: 'audio/webm;codecs=opus' });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start(1000);
      const startedAt = performance.now();
      window.__bsAudioRecording = {
        startedAt,
        stop: () => new Promise((resolve) => {
          rec.onstop = async () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let s = '';
            for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            resolve(btoa(s));
          };
          rec.stop();
        }),
      };
    } catch {
      /* MediaRecorder unavailable */
    }
  }
}
