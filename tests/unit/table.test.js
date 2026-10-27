import { describe, expect, it } from 'vitest';
import { answerFor, cellsOf, fleetText, isFleet, promise, Table } from '../../src/net/table.js';
import { sha256 } from '../../src/net/sha256.js';

const ADA = 'ada-player-id-0001';
const GRACE = 'grace-player-id-002';
const ED = 'edsger-player-id-03';

/** Ships in rows 0 to 4, each from column 0, lying east. */
const ROWS = [
  { type: 'carrier', r: 0, c: 0, h: true }, { type: 'battleship', r: 1, c: 0, h: true }, { type: 'cruiser', r: 2, c: 0, h: true },
  { type: 'submarine', r: 3, c: 0, h: true }, { type: 'destroyer', r: 4, c: 0, h: true },
];
/** The same kinds, standing in columns 9 down to 5 from row 0. */
const COLUMNS = [
  { type: 'carrier', r: 0, c: 9, h: false }, { type: 'battleship', r: 0, c: 8, h: false }, { type: 'cruiser', r: 0, c: 7, h: false },
  { type: 'submarine', r: 0, c: 6, h: false }, { type: 'destroyer', r: 0, c: 5, h: false },
];

/** A table with both admirals seated and ready: Ada (seat 0) with ROWS, Grace with COLUMNS. */
function battle() {
  const t = new Table();
  t.apply({ t: 'sit', c: 0, name: 'Ada' }, ADA);
  t.apply({ t: 'sit', c: 1, name: 'Grace' }, GRACE);
  t.apply({ t: 'ready', n: 1, commit: promise(ROWS, 'salt-a') }, ADA);
  t.apply({ t: 'ready', n: 1, commit: promise(COLUMNS, 'salt-g') }, GRACE);
  return t;
}

const fleets = { [ADA]: ROWS, [GRACE]: COLUMNS };
const pidOf = (t, c) => t.seats[c];

/** A shot and the honest answer to it. */
function exchange(t, r, c) {
  const by = t.turn;
  const k = t.shots[by].length;
  expect(t.apply({ t: 'shot', n: t.n, k, r, c }, pidOf(t, by))).not.toBeNull();
  const answer = answerFor(fleets[pidOf(t, by ^ 1)], t.shots[by].slice(0, k), r, c);
  return t.apply({ t: 'answer', n: t.n, k, ...answer }, pidOf(t, by ^ 1));
}

describe('sha256', () => {
  it('is the standard one', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

describe('fleets', () => {
  it('one of each kind, on the board, not on top of each other', () => {
    expect(isFleet(ROWS)).toBe(true);
    expect(isFleet(COLUMNS)).toBe(true);
    expect(isFleet(ROWS.slice(1))).toBe(false);
    expect(isFleet([...ROWS.slice(1), { type: 'carrier', r: 0, c: 6, h: true }])).toBe(false);
    expect(isFleet([{ type: 'carrier', r: 1, c: 0, h: true }, ...ROWS.slice(1)])).toBe(false);
    expect(cellsOf({ type: 'destroyer', r: 9, c: 9, h: false })).toBeNull();
    expect(fleetText(ROWS)).toBe(fleetText([...ROWS].reverse()));
  });
});

describe('the table in a room', () => {
  it('the battle begins when both have promised a fleet', () => {
    const t = new Table();
    t.apply({ t: 'sit', c: 0, name: 'Ada' }, ADA);
    t.apply({ t: 'sit', c: 1, name: 'Grace' }, GRACE);
    expect(t.phase).toBe('placing');
    expect(t.apply({ t: 'ready', n: 1, commit: 'nope' }, ADA)).toBeNull();
    expect(t.apply({ t: 'ready', n: 1, commit: promise(ROWS, 's') }, ED)).toBeNull();
    expect(t.apply({ t: 'ready', n: 1, commit: promise(ROWS, 's') }, ADA)).toEqual({ t: 'ready', c: 0, battle: false });
    expect(t.apply({ t: 'shot', n: 1, k: 0, r: 0, c: 0 }, ADA)).toBeNull();
    expect(t.apply({ t: 'ready', n: 1, commit: promise(COLUMNS, 's') }, GRACE)).toEqual({ t: 'ready', c: 1, battle: true });
    expect(t.phase).toBe('battle');
  });

  it('shots in turn, one at a time, each answered by the other side only', () => {
    const t = battle();
    expect(t.apply({ t: 'shot', n: 1, k: 0, r: 0, c: 0 }, GRACE)).toBeNull();
    expect(t.apply({ t: 'shot', n: 1, k: 0, r: 0, c: 9 }, ADA)).toEqual({ t: 'shot', by: 0, k: 0, r: 0, c: 9 });
    // Not again before the answer, and no answer from the shooter or a watcher.
    expect(t.apply({ t: 'shot', n: 1, k: 1, r: 1, c: 9 }, ADA)).toBeNull();
    expect(t.apply({ t: 'answer', n: 1, k: 0, result: 'hit' }, ADA)).toBeNull();
    expect(t.apply({ t: 'answer', n: 1, k: 0, result: 'hit' }, ED)).toBeNull();
    expect(t.apply({ t: 'answer', n: 1, k: 0, result: 'boom' }, GRACE)).toBeNull();
    expect(t.apply({ t: 'answer', n: 1, k: 0, result: 'hit' }, GRACE)).toMatchObject({ result: 'hit', by: 0 });
    expect(t.turn).toBe(1);
    // A cell once shot at by somebody is not shot at again by them.
    exchange(t, 5, 5);
    expect(t.apply({ t: 'shot', n: 1, k: 1, r: 0, c: 9 }, ADA)).toBeNull();
  });

  it('a "sunk" names a ship that lay under the shot, whose every cell has been hit, and only once', () => {
    const t = battle();
    // Ada shoots the destroyer in column 5 (rows 0 and 1); Grace shoots at nothing.
    exchange(t, 0, 5);
    exchange(t, 9, 9);
    t.apply({ t: 'shot', n: 1, k: 1, r: 1, c: 5 }, ADA);
    const sunk = (ship) => t.apply({ t: 'answer', n: 1, k: 1, result: 'sunk', ship }, GRACE);
    expect(sunk({ type: 'destroyer', r: 2, c: 5, h: false })).toBeNull();
    expect(sunk({ type: 'submarine', r: 0, c: 5, h: false })).toBeNull();
    expect(sunk({ type: 'destroyer', r: 0, c: 5, h: false })).toMatchObject({ result: 'sunk', ship: { type: 'destroyer' } });
    expect(t.sunk(1)).toBe(1);
  });

  it('the last ship sinks and the battle is over; the fleets shown afterwards are checked', () => {
    const t = battle();
    const targets = COLUMNS.flatMap((s) => cellsOf(s)).map((i) => [Math.floor(i / 10), i % 10]);
    const misses = Array.from({ length: 40 }, (_, i) => [9 - Math.floor(i / 10), 9 - (i % 10)]).filter(([r, c]) => r > 4);
    let last;
    for (const [i, [r, c]] of targets.entries()) {
      last = exchange(t, r, c);
      if (t.phase === 'over') break;
      exchange(t, ...misses[i]);
    }
    expect(last).toMatchObject({ result: 'sunk', over: true });
    expect([t.phase, t.winner, t.how]).toEqual(['over', 0, 'sunk']);
    expect(t.apply({ t: 'reveal', n: 1, fleet: COLUMNS, salt: 'salt-g' }, GRACE)).toEqual({ t: 'reveal', c: 1, kept: true });
    expect(t.apply({ t: 'reveal', n: 1, fleet: ROWS, salt: 'salt-a' }, ADA)).toEqual({ t: 'reveal', c: 0, kept: true });
    expect(t.verdicts).toEqual(['kept', 'kept']);
  });

  it('a fleet that was not the promised one, or that the answers lied about, loses', () => {
    // A winner whose fleet is not what was promised.
    const t = battle();
    t.apply({ t: 'resign', n: 1 }, GRACE);
    expect(t.winner).toBe(0);
    expect(t.apply({ t: 'reveal', n: 1, fleet: COLUMNS, salt: 'salt-a' }, ADA)).toEqual({ t: 'reveal', c: 0, kept: false });
    expect([t.winner, t.how]).toEqual([1, 'broken']);

    // A "miss" for a shot that hit.
    const u = battle();
    u.apply({ t: 'shot', n: 1, k: 0, r: 5, c: 5 }, ADA);
    u.apply({ t: 'answer', n: 1, k: 0, result: 'miss' }, GRACE);
    u.apply({ t: 'shot', n: 1, k: 0, r: 0, c: 0 }, GRACE);
    u.apply({ t: 'answer', n: 1, k: 0, result: 'miss' }, ADA);
    u.apply({ t: 'resign', n: 1 }, GRACE);
    expect(u.apply({ t: 'reveal', n: 1, fleet: ROWS, salt: 'salt-a' }, ADA)).toEqual({ t: 'reveal', c: 0, kept: false });
    expect(u.winner).toBe(1);
  });

  it('the next game: after this one, with the other admiral firing first', () => {
    const t = battle();
    expect(t.apply({ t: 'new', n: 1 }, ADA)).toBeNull();
    t.apply({ t: 'resign', n: 1 }, ADA);
    expect(t.apply({ t: 'new', n: 1 }, GRACE)).toEqual({ t: 'new', n: 2, change: null });
    expect(t.seats).toEqual([GRACE, ADA]);
    expect(t.phase).toBe('placing');
    expect(t.history).toHaveLength(1);
  });

  it('getting up: before the battle it frees the seat and the promise; in it, it loses', () => {
    const t = new Table();
    t.apply({ t: 'sit', c: 0, name: 'Ada' }, ADA);
    t.apply({ t: 'ready', n: 1, commit: promise(ROWS, 's') }, ADA);
    expect(t.apply({ t: 'stand' }, ADA)).toEqual({ t: 'stand', c: 0, lost: false, next: null });
    expect(t.commits).toEqual([null, null]);
    const u = battle();
    expect(u.apply({ t: 'stand' }, GRACE)).toEqual({ t: 'stand', c: 1, lost: true, next: null });
    expect(u.winner).toBe(0);
  });

  it('a snapshot, and the ops after it, give the table that the ops alone give', () => {
    const u = new Table();
    const all = [
      [{ t: 'sit', c: 0, name: 'Ada' }, ADA], [{ t: 'sit', c: 1, name: 'Grace' }, GRACE],
      [{ t: 'ready', n: 1, commit: promise(ROWS, 'salt-a') }, ADA], [{ t: 'ready', n: 1, commit: promise(COLUMNS, 'salt-g') }, GRACE],
      [{ t: 'shot', n: 1, k: 0, r: 0, c: 5 }, ADA], [{ t: 'answer', n: 1, k: 0, result: 'hit' }, GRACE],
      [{ t: 'shot', n: 1, k: 0, r: 4, c: 1 }, GRACE], [{ t: 'answer', n: 1, k: 0, result: 'hit' }, ADA],
      [{ t: 'shot', n: 1, k: 1, r: 1, c: 5 }, ADA],
      [{ t: 'answer', n: 1, k: 1, result: 'sunk', ship: { type: 'destroyer', r: 0, c: 5, h: false } }, GRACE],
      [{ t: 'resign', n: 1 }, GRACE], [{ t: 'reveal', n: 1, fleet: ROWS, salt: 'salt-a' }, ADA], [{ t: 'new', n: 1 }, GRACE],
    ];
    for (const [op, pid] of all) u.apply(op, pid);
    for (let cut = 0; cut <= all.length; cut++) {
      const before = new Table();
      for (const [op, pid] of all.slice(0, cut)) before.apply(op, pid);
      const after = new Table(JSON.parse(JSON.stringify(before.save())));
      for (const [op, pid] of all.slice(cut)) after.apply(op, pid);
      expect(after.fingerprint(), `cut at ${cut}`).toBe(u.fingerprint());
    }
    expect(u.n).toBe(2);
    expect(u.history[0]).toMatchObject({ winner: 0, how: 'resign' });
  });
});

describe('watchers take turns', () => {
  const LIN = 'lin-player-id-00004';
  const MAX = 'max-player-id-00005';
  /** A battle with Ed and Lin in line, in that order; Grace resigns, so Ada wins. */
  function decided() {
    const t = battle();
    expect(t.apply({ t: 'line', name: 'Edsger' }, ED)).toEqual({ t: 'line', place: 0 });
    expect(t.apply({ t: 'line', name: 'Lin' }, LIN)).toEqual({ t: 'line', place: 1 });
    t.apply({ t: 'resign', n: 1 }, GRACE);
    return t;
  }

  it('the line: in order of asking, once each, never an admiral; out again by asking, or when gone', () => {
    const t = battle();
    expect(t.apply({ t: 'line', name: 'Ada' }, ADA)).toBeNull();
    t.apply({ t: 'line', name: 'Edsger' }, ED);
    expect(t.apply({ t: 'line', name: 'Edsger' }, ED)).toBeNull();
    t.apply({ t: 'line', name: 'Lin' }, LIN);
    t.apply({ t: 'line', name: 'Max' }, MAX);
    expect(t.line.map((x) => x.name)).toEqual(['Edsger', 'Lin', 'Max']);
    expect(t.placeOf(LIN)).toBe(1);
    expect(t.apply({ t: 'unline' }, LIN)).toEqual({ t: 'unline' });
    expect(t.apply({ t: 'unline' }, LIN)).toBeNull();
    expect(t.apply({ t: 'gone', pid: MAX }, ADA)).toEqual({ t: 'gone' });
    // "gone" is for the line only: never a seat.
    expect(t.apply({ t: 'gone', pid: GRACE }, ED)).toBeNull();
    expect(t.seats).toEqual([ADA, GRACE]);
    expect(t.line.map((x) => x.pid)).toEqual([ED]);
  });

  it('the next battle: the winner stays, the loser\'s seat goes to the first in line, who fires first', () => {
    const t = decided();
    expect(t.apply({ t: 'new', n: 1 }, GRACE)).toEqual({ t: 'new', n: 2, change: { out: 'Grace', in: 'Edsger', left: GRACE, took: ED } });
    expect(t.seats).toEqual([ED, ADA]);
    expect(t.names).toEqual(['Edsger', 'Ada']);
    expect(t.line.map((x) => x.pid)).toEqual([LIN]);
    expect(t.history[0]).toMatchObject({ a: 'Ada', b: 'Grace', winner: 0 });
    // Ada beats Edsger too: Lin is next, against Ada, and fires first.
    t.apply({ t: 'ready', n: 2, commit: promise(ROWS, 'e') }, ED);
    t.apply({ t: 'ready', n: 2, commit: promise(COLUMNS, 'a') }, ADA);
    t.apply({ t: 'resign', n: 2 }, ED);
    t.apply({ t: 'new', n: 2 }, ADA);
    expect(t.seats).toEqual([LIN, ADA]);
    // Lin, in seat 0, loses to Ada: Grace, back in line, takes that seat and fires first.
    t.apply({ t: 'line', name: 'Grace' }, GRACE);
    t.apply({ t: 'ready', n: 3, commit: promise(ROWS, 'l') }, LIN);
    t.apply({ t: 'ready', n: 3, commit: promise(COLUMNS, 'a') }, ADA);
    t.apply({ t: 'resign', n: 3 }, LIN);
    t.apply({ t: 'new', n: 3 }, LIN);
    expect(t.seats).toEqual([GRACE, ADA]);
  });

  it('a broken promise loses, and that admiral gives up the seat', () => {
    const t = battle();
    t.apply({ t: 'line', name: 'Edsger' }, ED);
    t.apply({ t: 'resign', n: 1 }, GRACE);
    t.apply({ t: 'reveal', n: 1, fleet: COLUMNS, salt: 'salt-a' }, ADA);
    expect(t.winner).toBe(1);
    t.apply({ t: 'new', n: 1 }, GRACE);
    expect(t.seats).toEqual([ED, GRACE]);
  });

  it('nobody in line: the two swap, as before', () => {
    const t = battle();
    t.apply({ t: 'resign', n: 1 }, GRACE);
    expect(t.apply({ t: 'new', n: 1 }, ADA)).toMatchObject({ change: null });
    expect(t.seats).toEqual([GRACE, ADA]);
  });

  it('the first in line may start the next battle once this one is over, nobody else in line may', () => {
    const t = battle();
    t.apply({ t: 'line', name: 'Edsger' }, ED);
    t.apply({ t: 'line', name: 'Lin' }, LIN);
    expect(t.apply({ t: 'new', n: 1 }, ED)).toBeNull();
    t.apply({ t: 'resign', n: 1 }, GRACE);
    expect(t.apply({ t: 'new', n: 1 }, LIN)).toBeNull();
    expect(t.apply({ t: 'new', n: 1 }, ED)).toMatchObject({ n: 2 });
    expect(t.seats).toEqual([ED, ADA]);
  });

  it('a seat that is left goes to the first in line at once; the newcomer is not replaced at the next battle', () => {
    const t = decided();
    // The loser gets up after the end: Edsger sits in Grace's seat now, and keeps it.
    expect(t.apply({ t: 'stand' }, GRACE)).toEqual({ t: 'stand', c: 1, lost: false, next: 'Edsger' });
    expect(t.seats).toEqual([ADA, ED]);
    t.apply({ t: 'new', n: 1 }, ADA);
    expect(t.seats).toEqual([ED, ADA]);
    expect(t.line.map((x) => x.pid)).toEqual([LIN]);
    // Getting up in the middle of a battle loses it, and the seat goes to the line as well.
    t.apply({ t: 'ready', n: 2, commit: promise(ROWS, 'e') }, ED);
    t.apply({ t: 'ready', n: 2, commit: promise(COLUMNS, 'a') }, ADA);
    expect(t.apply({ t: 'stand' }, ADA)).toEqual({ t: 'stand', c: 1, lost: true, next: 'Lin' });
    expect([t.winner, t.seats]).toEqual([0, [ED, LIN]]);
    t.apply({ t: 'new', n: 2 }, ED);
    expect(t.seats).toEqual([LIN, ED]);
  });

  it('asking to play with a seat free sits at once; nobody sits past the line', () => {
    const t = new Table();
    t.apply({ t: 'sit', c: 0, name: 'Ada' }, ADA);
    expect(t.apply({ t: 'line', name: 'Grace' }, GRACE)).toEqual({ t: 'sit', c: 1 });
    t.apply({ t: 'line', name: 'Edsger' }, ED);
    t.apply({ t: 'stand' }, GRACE);
    expect(t.seats).toEqual([ADA, ED]);
    t.apply({ t: 'line', name: 'Lin' }, LIN);
    t.seats[1] = null; // as no op can leave it: a free seat while Lin waits
    expect(t.apply({ t: 'sit', c: 1, name: 'Max' }, MAX)).toBeNull();
  });

  it('a snapshot keeps the line, the loser and who fought; an old snapshot has no line', () => {
    const t = decided();
    const u = new Table(JSON.parse(JSON.stringify(t.save())));
    expect(u.fingerprint()).toBe(t.fingerprint());
    t.apply({ t: 'new', n: 1 }, ADA);
    u.apply({ t: 'new', n: 1 }, ADA);
    expect(u.fingerprint()).toBe(t.fingerprint());
    expect(u.seats).toEqual([ED, ADA]);
    const old = battle().save();
    for (const k of ['line', 'loser', 'fought']) delete old[k];
    const o = new Table(old);
    expect([o.line, o.loser, o.fought]).toEqual([[], null, null]);
    o.apply({ t: 'resign', n: 1 }, GRACE);
    o.apply({ t: 'new', n: 1 }, ADA);
    expect(o.seats).toEqual([GRACE, ADA]);
  });
});

describe('fleets kept in the browser', () => {
  /** localStorage's calls, on a Map. */
  const memory = () => {
    const m = new Map();
    return {
      get length() { return m.size; },
      key: (i) => [...m.keys()][i] ?? null,
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      keys: () => [...m.keys()],
    };
  };

  it('keeps each under its promise, only the newest ten, and nobody else\'s keys are touched', async () => {
    const { keepFleet } = await import('../../src/net/play.js');
    const storage = memory();
    storage.setItem('battleship:settings', '{}');
    storage.setItem('battleship:fleet:old-one-without-a-date', '{"fleet":[]}');
    for (let i = 0; i < 12; i++) keepFleet(storage, `c${i}`, ROWS, `salt-${i}`, 1000 + i);
    const fleets = storage.keys().filter((k) => k.startsWith('battleship:fleet:')).sort();
    expect(fleets).toEqual(Array.from({ length: 10 }, (_, i) => `battleship:fleet:c${i + 2}`).sort());
    expect(storage.getItem('battleship:settings')).toBe('{}');
    expect(JSON.parse(storage.getItem('battleship:fleet:c11'))).toEqual({ fleet: ROWS, salt: 'salt-11', at: 1011 });
  });
});
