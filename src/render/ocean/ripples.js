// CPU model of the GPU sim's ripples, so ships rock when a visible ring passes under them, with no GPU
// readback. Each drop becomes a travelling ring packet at the sim's wave speed and damping.
import { RIPPLE_DAMPING, RIPPLE_SPEED } from '../../config.js';

const MAX_DROPS = 16;
const LIFETIME = 5;

export class Ripples {
  constructor() {
    this.drops = [];
  }

  add(x, z, radius, strength, time) {
    this.drops.push({ x, z, radius, strength, t0: time });
    if (this.drops.length > MAX_DROPS) this.drops.shift();
  }

  clear() {
    this.drops.length = 0;
  }

  prune(time) {
    if (this.drops.length && time - this.drops[0].t0 > LIFETIME) this.drops = this.drops.filter((d) => time - d.t0 <= LIFETIME);
  }

  /** Ripple height at world (x, z). */
  height(x, z, time) {
    let h = 0;
    for (const d of this.drops) {
      const age = time - d.t0;
      if (age < 0 || age > LIFETIME) continue;
      const r = Math.hypot(x - d.x, z - d.z);
      const behind = RIPPLE_SPEED * age - r; // > 0 once the front has passed
      const width = d.radius * 2.2;
      if (behind < -width) continue; // not arrived yet
      const k = Math.PI / (d.radius * 1.6);
      const envelope = Math.exp(-((behind / (width * 1.5)) ** 2));
      h += d.strength * 0.5 * Math.exp(-RIPPLE_DAMPING * age) * Math.cos(k * behind) * envelope / Math.sqrt(1 + r * 0.8);
    }
    return h;
  }
}
