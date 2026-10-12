// Game/FX events -> sound: buffer variants with random detune/gain, stereo panning, a voice limit with
// stealing, live shell whistles, burning crackle loops and music ducking.

export class Sfx {
  constructor(engine) {
    this.e = engine;
    this.voices = [];
    this.crackle = null;
    this.lastTick = -Infinity;
  }

  get ctx() {
    return this.e.ctx;
  }

  #pan(x) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-0.85, Math.min(0.85, this.e.panFor(x ?? 0)));
    return p;
  }

  /** Play a rendered cue. Returns the source or null if not ready / over the voice limit. */
  play(name, { x = 0, gain = 1, delay = 0, rate = 1, reverb = 0.25, bus = this.e.sfxBus } = {}) {
    const variants = this.e.buffers.get(name);
    if (!variants?.length || !this.ctx) return null;
    this.#reap();
    if (this.voices.length >= this.e.voiceLimit) {
      const victim = this.voices.shift();
      try {
        victim.src.stop();
      } catch {
        /* already stopped */
      }
    }
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = variants[Math.floor(Math.random() * variants.length)];
    src.playbackRate.value = rate;
    src.detune.value = (Math.random() * 2 - 1) * 80;
    const g = ctx.createGain();
    g.gain.value = gain * 10 ** (((Math.random() * 2 - 1) * 2) / 20);
    src.connect(g);
    g.connect(this.#pan(x)).connect(bus);
    if (reverb > 0 && this.e.reverbSend) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s).connect(this.e.reverbSend);
    }
    const at = ctx.currentTime + delay;
    src.start(at);
    const end = at + src.buffer.duration / rate;
    this.voices.push({ src, end });
    src.onended = () => g.disconnect();
    return src;
  }

  #reap() {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
  }

  /** Live shell whistle: descending tone + band-passed noise, length = flight time. */
  whistle(duration, { x = 0, incoming = false } = {}) {
    const ctx = this.ctx;
    const noise = this.e.buffers.get('wind')?.[0];
    if (!ctx) return;
    const t = ctx.currentTime;
    const f0 = incoming ? 1500 : 1700;
    const f1 = incoming ? 520 : 900;
    const peak = incoming ? 0.16 : 0.07;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(peak, t + duration * (incoming ? 0.85 : 0.3));
    out.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.04);
    out.connect(this.#pan(x)).connect(this.e.sfxBus);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + duration);
    const og = ctx.createGain();
    og.gain.value = 0.6;
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + duration + 0.1);
    if (noise) {
      const n = ctx.createBufferSource();
      n.buffer = noise;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 6;
      bp.frequency.setValueAtTime(f0, t);
      bp.frequency.exponentialRampToValueAtTime(f1, t + duration);
      const ng = ctx.createGain();
      ng.gain.value = 1.4;
      n.connect(bp).connect(ng).connect(out);
      n.start(t, Math.random() * 4);
      n.stop(t + duration + 0.1);
    }
  }

  /** Two crackle loops (left = your fleet, right = enemy waters); gain follows the number of fires. */
  setFires(player, enemy) {
    const ctx = this.ctx;
    const buf = this.e.buffers.get('crackle')?.[0];
    if (!ctx || !buf) return;
    if (!this.crackle) {
      this.crackle = [-0.55, 0.55].map((pan, i) => {
        const src = ctx.createBufferSource();
        src.buffer = this.e.buffers.get('crackle')[i % this.e.buffers.get('crackle').length];
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0;
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        src.connect(g).connect(p).connect(this.e.sfxBus);
        src.start(ctx.currentTime, Math.random() * 2);
        return g;
      });
    }
    const level = (n) => (n > 0 ? Math.min(0.5, 0.16 * Math.sqrt(n)) : 0);
    this.crackle[0].gain.setTargetAtTime(level(player), ctx.currentTime, 0.3);
    this.crackle[1].gain.setTargetAtTime(level(enemy), ctx.currentTime, 0.3);
  }

  /** Map of game cue names to sounds. */
  cue(name, o = {}) {
    const now = this.ctx.currentTime;
    switch (name) {
      case 'fire':
        return this.play('boom', { x: o.x, gain: 0.8 });
      case 'distantFire':
        return this.play('distantBoom', { x: o.x, gain: 0.55, reverb: 0.4 });
      case 'whistle':
        return this.whistle(o.duration ?? 0.7, { x: o.x });
      case 'incoming':
        return this.whistle(o.duration ?? 0.8, { x: o.x, incoming: true });
      case 'splash':
        return this.play('splash', { x: o.x, gain: 0.75 });
      case 'explosion':
        this.e.duck(0.55, 0.7);
        return this.play('explosion', { x: o.x, gain: o.near ? 1 : 0.8, reverb: 0.35 });
      case 'sunk':
        this.e.duck(0.4, 2.2);
        this.play('groan', { x: o.x, gain: 0.7, delay: 0.25, reverb: 0.4 });
        if (o.breaks) this.play('crack', { x: o.x, gain: 0.8, delay: 0.85 });
        this.play('bubbles', { x: o.x, gain: 0.6, delay: 1.1 });
        this.play('bigSplash', { x: o.x, gain: 0.7, delay: 2.2 });
        this.e.music?.stinger(o.mine ? 'stinger' : 'stinger');
        return null;
      case 'victory':
      case 'defeat':
        this.e.music?.stinger(name);
        return null;
      case 'tick':
        if (now - this.lastTick < 0.05) return null;
        this.lastTick = now;
        return this.play('tick', { gain: 0.35, reverb: 0 });
      case 'ui':
        return this.play('click', { gain: 0.6, reverb: 0 });
      case 'snap':
        return this.play('snap', { gain: 0.7, reverb: 0 });
      case 'rotate':
        return this.play('swish', { gain: 0.7, reverb: 0 });
      case 'invalid':
        return this.play('invalid', { gain: 0.6, reverb: 0 });
      case 'shuffle':
        for (let i = 0; i < 4; i++) this.play('swish', { gain: 0.5, delay: i * 0.07, rate: 1 + i * 0.08, reverb: 0 });
        return null;
      default:
        return null;
    }
  }
}
