import { BOARD_SIZE, FLEET } from '../config.js';
import { Board, colOf, rowOf } from './board.js';

/** Place the whole fleet at random legal positions (ships may touch). */
export function placeRandomFleet(board, rng) {
  board.clear();
  for (const def of FLEET) {
    for (let attempt = 0; ; attempt++) {
      const horizontal = rng.chance(0.5);
      const r = rng.int(horizontal ? BOARD_SIZE : BOARD_SIZE - def.length + 1);
      const c = rng.int(horizontal ? BOARD_SIZE - def.length + 1 : BOARD_SIZE);
      if (board.canPlace(def.length, r, c, horizontal)) {
        board.addShip(def, r, c, horizontal);
        break;
      }
      if (attempt > 500) return placeRandomFleet(board, rng); // practically unreachable; restart
    }
  }
  return board;
}

/** How "readable" a layout is: edge-hugging cells and ships touching each other. Lower is harder to find. */
export function layoutReadability(board) {
  let score = 0;
  for (const ship of board.ships) {
    for (const i of ship.cells) {
      const r = rowOf(i);
      const c = colOf(i);
      if (r === 0 || c === 0 || r === BOARD_SIZE - 1 || c === BOARD_SIZE - 1) score += 1;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= BOARD_SIZE || cc >= BOARD_SIZE) continue;
        const other = board.grid[rr * BOARD_SIZE + cc];
        if (other !== -1 && other !== ship.index) score += 1;
      }
    }
  }
  return score;
}

/**
 * Hard AI placement: random, but with fewer edge-hugging and clustered layouts so the fleet is not easy to
 * read. Picks randomly among the less readable third of a batch of random layouts.
 */
export function placeDiscreetFleet(board, rng, candidates = 12) {
  const layouts = [];
  for (let k = 0; k < candidates; k++) {
    const b = placeRandomFleet(new Board(), rng);
    layouts.push({ b, score: layoutReadability(b) });
  }
  layouts.sort((x, y) => x.score - y.score);
  const chosen = layouts[rng.int(Math.max(1, Math.floor(candidates / 3)))].b;
  board.clear();
  for (const s of chosen.ships) board.addShip(FLEET.find((d) => d.type === s.type), s.r, s.c, s.horizontal);
  return board;
}
