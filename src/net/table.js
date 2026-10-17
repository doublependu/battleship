// The table in a room: two admirals, their promises about their fleets, and the shots and answers between them.
//
// Built from the room's log alone, op by op, so that every page that reads the same log has the same table. No
// fleet is ever in it until the game is over: each page keeps its own (see `play.js`) and answers the shots at
// it. What the table holds is public: a promise about each fleet (a hash of the fleet and a random salt, made when
// its admiral is ready), the shots, the answers, and, at the end, the fleets themselves, which every page checks
// against the promises and against every answer that was given. A fleet that does not match loses.
import { BOARD_SIZE, FLEET, SHIP_BY_TYPE } from '../config.js';
import { sha256 } from './sha256.js';

// The format of the ops and the snapshot is `TABLE_VERSION` in `company.js`: a change here that an older page would
// read differently changes that too.

const HISTORY = 50;
const RESULTS = new Set(['miss', 'hit', 'sunk']);
const isSeat = (c) => c === 0 || c === 1;
const isCell = (v) => Number.isInteger(v) && v >= 0 && v < BOARD_SIZE;
const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) : '') || 'Admiral';

/** The cells of a ship, as row * 10 + column, or null if it leaves the board. */
export function cellsOf({ type, r, c, h }) {
  const def = SHIP_BY_TYPE[type];
  if (!def || !isCell(r) || !isCell(c) || typeof h !== 'boolean') return null;
  const out = [];
  for (let k = 0; k < def.length; k++) {
    const rr = h ? r : r + k;
    const cc = h ? c + k : c;
    if (!isCell(rr) || !isCell(cc)) return null;
    out.push(rr * BOARD_SIZE + cc);
  }
  return out;
}

/** A whole fleet, as `[{ type, r, c, h }]`: one of each kind of ship, on the board, none on top of another. */
export function isFleet(fleet) {
  if (!Array.isArray(fleet) || fleet.length !== FLEET.length) return false;
  const types = new Set(fleet.map((s) => s?.type));
  if (types.size !== FLEET.length || !FLEET.every((d) => types.has(d.type))) return false;
  const taken = new Set();
  for (const s of fleet) {
    const cells = cellsOf(s);
    if (!cells) return false;
    for (const i of cells) {
      if (taken.has(i)) return false;
      taken.add(i);
    }
  }
  return true;
}

/** The same fleet always as the same text, so that its hash is a promise about it. */
export function fleetText(fleet) {
  return fleet
    .map((s) => `${s.type}:${s.r},${s.c},${s.h ? 'h' : 'v'}`)
    .sort()
    .join(';');
}

/** The promise about a fleet. */
export function promise(fleet, salt) {
  return sha256(`${fleetText(fleet)}|${salt}`);
}

/** What a fleet says about a shot at a cell: the result, and the ship it sank. Shots so far count for "sunk". */
export function answerFor(fleet, earlier, r, c) {
  const i = r * BOARD_SIZE + c;
  const ship = fleet.find((s) => cellsOf(s).includes(i));
  if (!ship) return { result: 'miss' };
  const hit = new Set(earlier.map((x) => x.r * BOARD_SIZE + x.c));
  hit.add(i);
  return cellsOf(ship).every((j) => hit.has(j)) ? { result: 'sunk', ship: { type: ship.type, r: ship.r, c: ship.c, h: ship.h } } : { result: 'hit' };
}

export class Table {
  constructor(state) {
    this.load(state);
  }

  load(state) {
    this.n = 1;
    this.seats = [null, null];
    this.names = ['', ''];
    this.fresh();
    this.history = [];
    const s = state && typeof state === 'object' ? state : null;
    if (!s || !Number.isInteger(s.n) || s.n < 1 || !Array.isArray(s.seats) || !Array.isArray(s.shots)) return;
    this.n = s.n;
    this.seats = [0, 1].map((c) => (typeof s.seats[c] === 'string' ? s.seats[c] : null));
    this.names = [0, 1].map((c) => (this.seats[c] ? cleanName(s.names?.[c]) : ''));
    this.commits = [0, 1].map((c) => (typeof s.commits?.[c] === 'string' ? s.commits[c] : null));
    this.shots = [0, 1].map((c) => (Array.isArray(s.shots[c]) ? s.shots[c].filter((x) => x && isCell(x.r) && isCell(x.c)) : []));
    this.turn = isSeat(s.turn) ? s.turn : 0;
    this.pending = s.pending && isSeat(s.pending.by) ? { ...s.pending } : null;
    this.winner = isSeat(s.winner) ? s.winner : null;
    this.how = typeof s.how === 'string' ? s.how : null;
    this.reveals = [0, 1].map((c) => (s.reveals?.[c] && isFleet(s.reveals[c].fleet) ? s.reveals[c] : null));
    this.verdicts = [0, 1].map((c) => (s.verdicts?.[c] === 'kept' || s.verdicts?.[c] === 'broken' ? s.verdicts[c] : null));
    this.history = Array.isArray(s.history) ? s.history.slice(-HISTORY) : [];
  }

  /** A new game on the same table: no promises, no shots. */
  fresh() {
    this.commits = [null, null];
    this.shots = [[], []];
    this.turn = 0;
    this.pending = null;
    this.winner = null;
    this.how = null;
    this.reveals = [null, null];
    this.verdicts = [null, null];
  }

  save() {
    return {
      n: this.n, seats: this.seats.slice(), names: this.names.slice(), commits: this.commits.slice(),
      shots: this.shots.map((list) => list.map((x) => ({ ...x }))), turn: this.turn, pending: this.pending,
      winner: this.winner, how: this.how, reveals: this.reveals.slice(), verdicts: this.verdicts.slice(), history: this.history.slice(),
    };
  }

  seatOf(pid) {
    return pid ? this.seats.indexOf(pid) : -1;
  }

  /** placing: one or both admirals are still placing ships; battle; over. */
  get phase() {
    if (this.winner !== null) return 'over';
    return this.commits[0] && this.commits[1] ? 'battle' : 'placing';
  }

  /** How many of a seat's ships the other has sunk. */
  sunk(c) {
    return this.shots[c ^ 1].filter((x) => x.result === 'sunk').length;
  }

  apply(op, pid) {
    if (!op || typeof op !== 'object' || typeof pid !== 'string' || !pid) return null;
    const mine = this.seatOf(pid);
    const now = op.n === this.n;
    switch (op.t) {
      case 'sit': {
        if (!isSeat(op.c) || this.seats[op.c] || mine !== -1) return null;
        this.seats[op.c] = pid;
        this.names[op.c] = cleanName(op.name);
        return { t: 'sit', c: op.c };
      }
      case 'stand': {
        if (mine === -1) return null;
        // Leaving a battle gives it up; leaving before it frees the seat, promise and all.
        const lost = this.phase === 'battle';
        if (lost) this.end(mine ^ 1, 'resign');
        else if (this.phase === 'placing') this.commits[mine] = null;
        this.seats[mine] = null;
        this.names[mine] = '';
        return { t: 'stand', c: mine, lost };
      }
      case 'ready': {
        if (!now || mine === -1 || this.phase !== 'placing' || this.commits[mine]) return null;
        if (typeof op.commit !== 'string' || !/^[0-9a-f]{64}$/.test(op.commit)) return null;
        this.commits[mine] = op.commit;
        return { t: 'ready', c: mine, battle: this.phase === 'battle' };
      }
      case 'shot': {
        if (!now || this.phase !== 'battle' || mine !== this.turn || this.pending) return null;
        if (!isCell(op.r) || !isCell(op.c) || op.k !== this.shots[mine].length) return null;
        if (this.shots[mine].some((x) => x.r === op.r && x.c === op.c)) return null;
        this.shots[mine].push({ r: op.r, c: op.c });
        this.pending = { by: mine, k: op.k };
        return { t: 'shot', by: mine, k: op.k, r: op.r, c: op.c };
      }
      case 'answer': {
        if (!now || this.phase !== 'battle' || !this.pending || mine !== (this.pending.by ^ 1) || op.k !== this.pending.k) return null;
        if (!RESULTS.has(op.result)) return null;
        const by = this.pending.by;
        const shot = this.shots[by][op.k];
        const done = { r: shot.r, c: shot.c, result: op.result };
        if (op.result === 'sunk') {
          // The ship that sank: where it lay, and every one of its cells hit by now. Each kind sinks once.
          const ship = op.ship && { type: op.ship.type, r: op.ship.r, c: op.ship.c, h: op.ship.h };
          const cells = ship && cellsOf(ship);
          if (!cells || !cells.includes(shot.r * BOARD_SIZE + shot.c)) return null;
          if (this.shots[by].some((x) => x.ship?.type === ship.type)) return null;
          const hit = new Set(this.shots[by].filter((x) => x.result === 'hit').map((x) => x.r * BOARD_SIZE + x.c));
          hit.add(shot.r * BOARD_SIZE + shot.c);
          if (!cells.every((i) => hit.has(i))) return null;
          done.ship = ship;
        }
        this.shots[by][op.k] = done;
        this.pending = null;
        if (this.sunk(by ^ 1) === FLEET.length) this.end(by, 'sunk');
        else this.turn = by ^ 1;
        return { t: 'answer', by, k: op.k, ...done, over: this.winner !== null };
      }
      case 'resign': {
        if (!now || mine === -1 || this.phase === 'over') return null;
        this.end(mine ^ 1, 'resign');
        return { t: 'resign', c: mine };
      }
      case 'reveal': {
        if (!now || mine === -1 || this.phase !== 'over' || this.reveals[mine] || !this.commits[mine]) return null;
        if (!isFleet(op.fleet) || typeof op.salt !== 'string') return null;
        const fleet = op.fleet.map((s) => ({ type: s.type, r: s.r, c: s.c, h: s.h }));
        this.reveals[mine] = { fleet, salt: op.salt };
        const kept = promise(fleet, op.salt) === this.commits[mine] && this.answersMatch(mine, fleet);
        this.verdicts[mine] = kept ? 'kept' : 'broken';
        // A fleet that does not match its promise, or the answers given for it, loses: unless the other broke theirs too.
        if (!kept && this.winner === mine && this.verdicts[mine ^ 1] !== 'broken') {
          this.winner = mine ^ 1;
          this.how = 'broken';
        }
        return { t: 'reveal', c: mine, kept };
      }
      case 'new': {
        if (!now || mine === -1 || !(this.phase === 'over' || (!this.commits[0] && !this.commits[1]))) return null;
        if (this.phase === 'over') {
          this.history.push({ a: this.names[0], b: this.names[1], winner: this.winner, how: this.how, shots: this.shots[0].length + this.shots[1].length });
          if (this.history.length > HISTORY) this.history.shift();
        }
        // The admirals change places, so that the other fires first.
        this.seats.reverse();
        this.names.reverse();
        this.n += 1;
        this.fresh();
        return { t: 'new', n: this.n };
      }
      default:
        return null;
    }
  }

  end(winner, how) {
    this.winner = winner;
    this.how = how;
    this.pending = null;
  }

  /** Whether every answer given for seat `c`'s fleet is what that fleet says. */
  answersMatch(c, fleet) {
    const shots = this.shots[c ^ 1];
    for (let k = 0; k < shots.length; k++) {
      const x = shots[k];
      if (!x.result) continue;
      const truth = answerFor(fleet, shots.slice(0, k), x.r, x.c);
      if (truth.result !== x.result) return false;
      if (x.result === 'sunk' && fleetText([truth.ship]) !== fleetText([x.ship])) return false;
    }
    return true;
  }

  /** What every page should agree on, for the tests. */
  fingerprint() {
    const shots = this.shots.map((list) => list.map((x) => `${x.r}${x.c}${x.result?.[0] ?? '?'}`).join('')).join('/');
    return `${this.n}|${this.seats.join(',')}|${this.commits.map((x) => x?.slice(0, 8) ?? '-').join(',')}|${shots}|${this.winner ?? '-'}|${this.verdicts.join(',')}`;
  }
}
