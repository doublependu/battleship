import { AIBase, UNKNOWN } from './common.js';

/**
 * Admiral: probability density over all legal placements of the remaining ships.
 * Hunt mode samples among high-density cells with softmax temperature τ (0 = always the best cell).
 * Target mode always takes the best cell, so it finishes ships cleanly.
 */
export class HardAI extends AIBase {
  nextShot() {
    const score = this.density();
    const tau = this.params.temperature ?? 0;
    if (this.unresolvedHits().length || tau <= 0) return this.argmaxRandomTie(score);

    let max = 0;
    for (let i = 0; i < score.length; i++) if (this.state[i] === UNKNOWN && score[i] > max) max = score[i];
    if (max <= 0) return this.randomUnknown();
    const weights = [];
    let total = 0;
    for (let i = 0; i < score.length; i++) {
      if (this.state[i] !== UNKNOWN) continue;
      const w = Math.exp((score[i] / max - 1) / tau);
      weights.push([i, w]);
      total += w;
    }
    let x = this.rng.next() * total;
    for (const [i, w] of weights) {
      x -= w;
      if (x <= 0) return i;
    }
    return weights[weights.length - 1][0];
  }
}
