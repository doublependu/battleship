import { DIFFICULTIES } from '../../config.js';
import { AIBase } from './common.js';
import { EasyAI } from './easy.js';
import { HardAI } from './hard.js';
import { NormalAI } from './normal.js';

export function createAI(difficulty, rng, overrides = {}) {
  const params = { ...DIFFICULTIES[difficulty], ...overrides };
  if (difficulty === 'easy') return new EasyAI(rng, params);
  if (difficulty === 'hard') return new HardAI(rng, params);
  return new NormalAI(rng, params);
}

/** Pure random shooter, used as a baseline bot in the balance sim. */
export class RandomBot extends AIBase {
  nextShot() {
    return this.randomUnknown();
  }
}

/**
 * Bots that stand in for human players in the balance sim and the Playwright player.
 * human-proxy ≈ an attentive human: parity hunting + line targeting + a little noise.
 */
export function createBot(kind, rng) {
  switch (kind) {
    case 'random':
      return new RandomBot(rng);
    case 'novice':
      return new EasyAI(rng, { pDrift: 0.15 });
    case 'expert':
      return new HardAI(rng, { temperature: 0 });
    case 'human-proxy':
    default:
      return new NormalAI(rng, { mistakeRate: 0.12 });
  }
}
