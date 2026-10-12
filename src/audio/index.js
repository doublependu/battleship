// Tiny audio facade in the main chunk. The AudioContext is created synchronously inside the first user
// gesture (iOS requires that); the engine (deferred chunk) attaches to it whenever it has loaded.
// Everything is a silent no-op until then, and if Web Audio is missing the game simply runs silently.
export class AudioFacade {
  constructor() {
    this.engine = null;
    this.ctx = null;
    this.loading = null;
    this.settings = null;
    this.tier = null;
    this.musicState = 'calm';
    this.swell = null;
    this.panner = null;
    this.log = [];
    this.logEnabled = false;
  }

  /** Load the engine chunk (idle prefetch) and start rendering cue buffers. No AudioContext yet. */
  load() {
    this.loading ??= import('./engine.js')
      .then((m) => {
        const e = new m.AudioEngine();
        if (this.tier) e.setTier(this.tier);
        if (this.settings) e.setSettings(this.settings);
        if (this.swell) e.setSwell(this.swell);
        if (this.panner) e.setPanner(this.panner);
        e.setMusicState(this.musicState);
        e.prerender();
        if (this.ctx) e.attach(this.ctx);
        this.engine = e;
        return e;
      })
      .catch(() => null);
    return this.loading;
  }

  /** Call from a user gesture handler (click/tap/key). Safe to call often. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        // Older iOS needs a sound started inside the gesture to fully unlock.
        const b = this.ctx.createBuffer(1, 1, 22050);
        const s = this.ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.ctx.destination);
        s.start(0);
        this.engine?.attach(this.ctx);
        if (!this.loading) this.load();
      }
      if (this.ctx.state !== 'running' && !this.suspended) this.ctx.resume().catch(() => {});
    } catch {
      /* no Web Audio: silent */
    }
  }

  get state() {
    return this.ctx ? this.ctx.state : 'waiting';
  }

  setSettings(s) {
    this.settings = s;
    this.engine?.setSettings(s);
  }

  setTier(tier) {
    this.tier = tier;
    this.engine?.setTier(tier);
  }

  setMusicState(state) {
    this.musicState = state;
    this.engine?.setMusicState(state);
  }

  setSwell(fn) {
    this.swell = fn;
    this.engine?.setSwell(fn);
  }

  /** world x -> stereo pan (-1..1), e.g. from the projected screen position. */
  setPanner(fn) {
    this.panner = fn;
    this.engine?.setPanner(fn);
  }

  cue(name, opts = {}) {
    if (this.logEnabled) this.log.push({ name, t: performance.now() });
    this.engine?.cue(name, opts);
  }

  tick(fires) {
    this.engine?.tick(fires);
  }

  /** Pause / hidden tab: freeze all sound with the game clock. */
  suspend() {
    this.suspended = true;
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    this.suspended = false;
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  stats() {
    return this.engine?.stats() ?? { state: this.state, voices: 0 };
  }
}
