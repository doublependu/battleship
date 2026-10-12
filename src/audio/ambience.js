// Sea ambience: a looped noise wash whose gain and cutoff follow the same swell as the visuals, plus a faint
// wind layer with slow random modulation.

export class Ambience {
  constructor(engine) {
    this.e = engine;
    this.started = false;
    this.next = 0;
  }

  start() {
    const ctx = this.e.ctx;
    const sea = this.e.buffers.get('sea')?.[0];
    const wind = this.e.buffers.get('wind')?.[0];
    if (!ctx || !sea || !wind || this.started) return;
    this.started = true;
    const s = ctx.createBufferSource();
    s.buffer = sea;
    s.loop = true;
    this.cut = ctx.createBiquadFilter();
    this.cut.type = 'lowpass';
    this.cut.frequency.value = 700;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    s.connect(this.cut).connect(this.gain).connect(this.e.ambBus);
    s.start();
    const w = ctx.createBufferSource();
    w.buffer = wind;
    w.loop = true;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.025;
    const p = ctx.createStereoPanner();
    p.pan.value = 0.3;
    w.connect(this.windGain).connect(p).connect(this.e.ambBus);
    w.start(ctx.currentTime, 3.1);
    this.gain.gain.setTargetAtTime(0.15, ctx.currentTime, 1.5);
  }

  /** Called ~10 times per second with the swell height near the boards. */
  update(swell) {
    if (!this.started) return;
    const t = this.e.ctx.currentTime;
    const h = Math.max(-1, Math.min(1, swell / 0.1));
    // A quiet bed (about -30 LUFS) so explosions and splashes keep their punch.
    this.gain.gain.setTargetAtTime(0.11 + 0.08 * (h * 0.5 + 0.5), t, 0.35);
    this.cut.frequency.setTargetAtTime(480 + 520 * (h * 0.5 + 0.5), t, 0.35);
    if (t > this.next) {
      this.next = t + 2 + Math.random() * 3;
      this.windGain.gain.setTargetAtTime(0.015 + Math.random() * 0.03, t, 1.5);
    }
  }
}
