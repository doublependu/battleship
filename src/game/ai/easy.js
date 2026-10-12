import { AIBase } from './common.js';

/** Recruit: random hunting; tries around hits but often drifts back to random shots. */
export class EasyAI extends AIBase {
  nextShot() {
    const hits = this.unresolvedHits();
    if (hits.length && !this.rng.chance(this.params.pDrift ?? 0.45)) {
      const around = [];
      for (const h of hits) around.push(...this.unknownNeighbours(h));
      if (around.length) return this.rng.pick(around);
    }
    return this.randomUnknown();
  }
}
