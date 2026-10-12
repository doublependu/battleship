// Game clock: stops while paused, scaled by the e2e speed factor. All shader time uniforms, effects and
// director waits use it, so pausing freezes everything consistently.

export class GameClock {
  constructor() {
    this.time = 0;
    this.dt = 0;
    this.paused = false;
    this.speed = 1;
    this.waits = [];
  }

  /** Advance by real seconds; returns the game-time delta. */
  tick(realDt) {
    this.dt = this.paused ? 0 : Math.min(realDt, 0.1) * this.speed;
    this.time += this.dt;
    if (this.waits.length) {
      const due = this.waits.filter((w) => w.at <= this.time);
      if (due.length) {
        this.waits = this.waits.filter((w) => w.at > this.time);
        for (const w of due) w.resolve();
      }
    }
    return this.dt;
  }

  /** Resolves after `seconds` of game time (pause-aware). */
  wait(seconds) {
    return new Promise((resolve) => this.waits.push({ at: this.time + Math.max(0, seconds), resolve }));
  }

  /** Drop pending waits (on restart). They never resolve. */
  cancelWaits() {
    this.waits = [];
  }
}
