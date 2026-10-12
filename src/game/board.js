import { BOARD_SIZE, CELLS } from '../config.js';

export const SHOT_NONE = 0;
export const SHOT_MISS = 1;
export const SHOT_HIT = 2;

export const idx = (r, c) => r * BOARD_SIZE + c;
export const rowOf = (i) => Math.floor(i / BOARD_SIZE);
export const colOf = (i) => i % BOARD_SIZE;
export const inBounds = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;

/** Cell indices covered by a ship, or null if it would leave the board. */
export function shipCells(length, r, c, horizontal) {
  const cells = [];
  for (let k = 0; k < length; k++) {
    const rr = horizontal ? r : r + k;
    const cc = horizontal ? c + k : c;
    if (!inBounds(rr, cc)) return null;
    cells.push(idx(rr, cc));
  }
  return cells;
}

/**
 * One player's grid: ship placement and the shots received. Ships may touch but not overlap.
 */
export class Board {
  constructor() {
    /** @type {{type:string,name:string,length:number,r:number,c:number,horizontal:boolean,cells:number[],hits:number,sunk:boolean,index:number}[]} */
    this.ships = [];
    this.grid = new Int8Array(CELLS).fill(-1); // ship index per cell
    this.shots = new Uint8Array(CELLS); // SHOT_*
  }

  canPlace(length, r, c, horizontal, ignoreIndex = -1) {
    const cells = shipCells(length, r, c, horizontal);
    if (!cells) return false;
    return cells.every((i) => this.grid[i] === -1 || this.grid[i] === ignoreIndex);
  }

  addShip(def, r, c, horizontal) {
    if (!this.canPlace(def.length, r, c, horizontal)) throw new Error(`Cannot place ${def.type}`);
    const ship = { ...def, r, c, horizontal, cells: shipCells(def.length, r, c, horizontal), hits: 0, sunk: false,
      index: this.ships.length };
    for (const i of ship.cells) this.grid[i] = ship.index;
    this.ships.push(ship);
    return ship;
  }

  /** Move/rotate during placement. Returns false (and changes nothing) if the target is invalid. */
  moveShip(index, r, c, horizontal) {
    const ship = this.ships[index];
    if (!this.canPlace(ship.length, r, c, horizontal, index)) return false;
    for (const i of ship.cells) this.grid[i] = -1;
    Object.assign(ship, { r, c, horizontal, cells: shipCells(ship.length, r, c, horizontal) });
    for (const i of ship.cells) this.grid[i] = index;
    return true;
  }

  clear() {
    this.ships = [];
    this.grid.fill(-1);
    this.shots.fill(SHOT_NONE);
  }

  isShot(r, c) {
    return this.shots[idx(r, c)] !== SHOT_NONE;
  }

  /** @returns {{result:'miss'|'hit'|'sunk', type?:string, ship?:object}} */
  receiveShot(r, c) {
    if (!inBounds(r, c)) throw new Error('Shot out of bounds');
    const i = idx(r, c);
    if (this.shots[i] !== SHOT_NONE) throw new Error('Cell already shot');
    const si = this.grid[i];
    if (si === -1) {
      this.shots[i] = SHOT_MISS;
      return { result: 'miss' };
    }
    this.shots[i] = SHOT_HIT;
    const ship = this.ships[si];
    ship.hits++;
    if (ship.hits === ship.length) {
      ship.sunk = true;
      return { result: 'sunk', type: ship.type, ship };
    }
    return { result: 'hit', ship };
  }

  allSunk() {
    return this.ships.length > 0 && this.ships.every((s) => s.sunk);
  }

  shipsLeft() {
    return this.ships.filter((s) => !s.sunk).length;
  }

  cellsLeft() {
    return this.ships.reduce((n, s) => n + s.length - s.hits, 0);
  }
}
