// AI interface: nextShot() -> cell index; observe(index, result, sunkType).
// An AI only ever sees what a human opponent would hear. It never receives the opponent's Board.
import { BOARD_SIZE, CELLS, FLEET, SHIP_BY_TYPE } from '../../config.js';
import { colOf, idx, inBounds, rowOf } from '../board.js';

export const UNKNOWN = 0;
export const MISS = 1;
export const HIT = 2; // hit, not yet attributed to a sunk ship
export const SUNK = 3;

const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export class AIBase {
  constructor(rng, params = {}) {
    this.rng = rng;
    this.params = params;
    this.state = new Uint8Array(CELLS);
    /** Lengths of ships not yet sunk (a multiset: two ships of length 3). */
    this.remaining = FLEET.map((s) => s.length);
  }

  /** @returns {number} cell index */
  nextShot() {
    throw new Error('not implemented');
  }

  observe(i, result, sunkType) {
    if (this.state[i] !== UNKNOWN) throw new Error('AI observed a cell twice');
    if (result === 'miss') {
      this.state[i] = MISS;
      return;
    }
    this.state[i] = HIT;
    if (result === 'sunk') this.#resolveSunk(i, SHIP_BY_TYPE[sunkType].length);
  }

  /** Attribute a sunk ship of `length` to a line of unresolved hits through cell i. */
  #resolveSunk(i, length) {
    const r = rowOf(i);
    const c = colOf(i);
    const candidates = [];
    for (const horizontal of [true, false]) {
      for (let off = 0; off < length; off++) {
        const r0 = horizontal ? r : r - off;
        const c0 = horizontal ? c - off : c;
        const cells = [];
        for (let k = 0; k < length; k++) {
          const rr = horizontal ? r0 : r0 + k;
          const cc = horizontal ? c0 + k : c0;
          if (!inBounds(rr, cc) || this.state[idx(rr, cc)] !== HIT) break;
          cells.push(idx(rr, cc));
        }
        if (cells.length !== length) continue;
        // Prefer segments bounded by non-hits: then the line of hits is exactly this ship.
        const before = horizontal ? [r0, c0 - 1] : [r0 - 1, c0];
        const after = horizontal ? [r0, c0 + length] : [r0 + length, c0];
        const bounded = [before, after].every(([rr, cc]) => !inBounds(rr, cc) || this.state[idx(rr, cc)] !== HIT);
        candidates.push({ cells, bounded });
      }
    }
    const pool = candidates.some((x) => x.bounded) ? candidates.filter((x) => x.bounded) : candidates;
    const chosen = pool.length ? this.rng.pick(pool).cells : [i];
    for (const cell of chosen) this.state[cell] = SUNK;
    const k = this.remaining.indexOf(length);
    if (k >= 0) this.remaining.splice(k, 1);
  }

  unknownCells() {
    const out = [];
    for (let i = 0; i < CELLS; i++) if (this.state[i] === UNKNOWN) out.push(i);
    return out;
  }

  unresolvedHits() {
    const out = [];
    for (let i = 0; i < CELLS; i++) if (this.state[i] === HIT) out.push(i);
    return out;
  }

  unknownNeighbours(i) {
    const r = rowOf(i);
    const c = colOf(i);
    const out = [];
    for (const [dr, dc] of DIRS) {
      const rr = r + dr;
      const cc = c + dc;
      if (inBounds(rr, cc) && this.state[idx(rr, cc)] === UNKNOWN) out.push(idx(rr, cc));
    }
    return out;
  }

  randomUnknown() {
    return this.rng.pick(this.unknownCells());
  }

  /**
   * Target mode used by Normal: extend lines of 2+ collinear hits first, otherwise try around single hits.
   * Returns -1 if there are no unresolved hits with open neighbours.
   */
  lineTarget() {
    const hits = this.unresolvedHits();
    if (!hits.length) return -1;
    const ends = [];
    for (const h of hits) {
      const r = rowOf(h);
      const c = colOf(h);
      for (const [dr, dc] of DIRS) {
        // h is the end of a line if the cell behind it is a hit; then extend forward past the run.
        const br = r - dr;
        const bc = c - dc;
        if (!inBounds(br, bc) || this.state[idx(br, bc)] !== HIT) continue;
        let rr = r + dr;
        let cc = c + dc;
        while (inBounds(rr, cc) && this.state[idx(rr, cc)] === HIT) {
          rr += dr;
          cc += dc;
        }
        if (inBounds(rr, cc) && this.state[idx(rr, cc)] === UNKNOWN) ends.push(idx(rr, cc));
      }
    }
    if (ends.length) return this.rng.pick(ends);
    const around = [];
    for (const h of hits) around.push(...this.unknownNeighbours(h));
    return around.length ? this.rng.pick(around) : -1;
  }

  /**
   * Placement-count density over all legal placements of the remaining ships. Placements covering
   * unresolved hits get a large weight so target mode focuses on them.
   */
  density() {
    const score = new Float64Array(CELLS);
    const hitWeight = 40;
    for (const length of this.remaining) {
      for (const horizontal of [true, false]) {
        const maxR = horizontal ? BOARD_SIZE : BOARD_SIZE - length + 1;
        const maxC = horizontal ? BOARD_SIZE - length + 1 : BOARD_SIZE;
        for (let r = 0; r < maxR; r++) {
          for (let c = 0; c < maxC; c++) {
            let ok = true;
            let hitsCovered = 0;
            for (let k = 0; k < length; k++) {
              const s = this.state[horizontal ? r * BOARD_SIZE + c + k : (r + k) * BOARD_SIZE + c];
              if (s === MISS || s === SUNK) {
                ok = false;
                break;
              }
              if (s === HIT) hitsCovered++;
            }
            if (!ok) continue;
            const w = hitsCovered ? hitWeight ** hitsCovered : 1;
            for (let k = 0; k < length; k++) {
              const i = horizontal ? r * BOARD_SIZE + c + k : (r + k) * BOARD_SIZE + c;
              if (this.state[i] === UNKNOWN) score[i] += w;
            }
          }
        }
      }
    }
    return score;
  }

  argmaxRandomTie(score) {
    let best = -1;
    let ties = [];
    for (let i = 0; i < CELLS; i++) {
      if (this.state[i] !== UNKNOWN) continue;
      if (score[i] > best) {
        best = score[i];
        ties = [i];
      } else if (score[i] === best) ties.push(i);
    }
    return ties.length ? this.rng.pick(ties) : this.randomUnknown();
  }
}
