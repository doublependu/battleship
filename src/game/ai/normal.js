import { BOARD_SIZE } from '../../config.js';
import { AIBase, UNKNOWN } from './common.js';

/** Captain: checkerboard parity hunting on the smallest remaining ship, line-following target mode. */
export class NormalAI extends AIBase {
  constructor(rng, params) {
    super(rng, params);
    this.parityOffset = rng.int(5);
  }

  nextShot() {
    const target = this.lineTarget();
    if (target >= 0) return target;
    if (this.rng.chance(this.params.mistakeRate ?? 0.3)) return this.randomUnknown();
    const step = Math.min(...this.remaining);
    const offset = this.parityOffset % step;
    const cells = [];
    for (let i = 0; i < this.state.length; i++) {
      const r = Math.floor(i / BOARD_SIZE);
      const c = i % BOARD_SIZE;
      if (this.state[i] === UNKNOWN && (r + c) % step === offset) cells.push(i);
    }
    return cells.length ? this.rng.pick(cells) : this.randomUnknown();
  }
}
