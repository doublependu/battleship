import { describe, expect, it } from 'vitest';
import { CELLS, FLEET, TOTAL_SHIP_CELLS } from '../../src/config.js';
import { createAI, createBot } from '../../src/game/ai/index.js';
import { Board, SHOT_NONE, idx, shipCells } from '../../src/game/board.js';
import { layoutReadability, placeDiscreetFleet, placeRandomFleet } from '../../src/game/fleet.js';
import { Game, PHASE } from '../../src/game/game.js';
import { createRng } from '../../src/game/rng.js';

const [carrier, battleship, , , destroyer] = FLEET;

describe('placement', () => {
  it('rejects out-of-bounds placements', () => {
    const b = new Board();
    expect(b.canPlace(5, 0, 6, true)).toBe(false);
    expect(b.canPlace(5, 6, 0, false)).toBe(false);
    expect(b.canPlace(5, 0, 5, true)).toBe(true);
    expect(shipCells(2, 9, 9, true)).toBeNull();
  });

  it('rejects overlap but allows touching', () => {
    const b = new Board();
    b.addShip(carrier, 0, 0, true);
    expect(b.canPlace(4, 0, 4, false)).toBe(false); // overlaps A5
    expect(b.canPlace(4, 1, 0, true)).toBe(true); // touches the carrier from below
    expect(b.canPlace(2, 0, 5, true)).toBe(true); // touches its bow end-on
  });

  it('moves and rotates ships, ignoring their own cells', () => {
    const b = new Board();
    b.addShip(battleship, 2, 2, true);
    expect(b.moveShip(0, 2, 3, true)).toBe(true);
    expect(b.moveShip(0, 2, 3, false)).toBe(true);
    expect(b.ships[0].cells).toEqual([idx(2, 3), idx(3, 3), idx(4, 3), idx(5, 3)]);
    expect(b.grid.filter((v) => v === 0)).toHaveLength(4);
  });

  it('random fleets are always legal (10k seeds)', () => {
    for (let seed = 0; seed < 10000; seed++) {
      const b = placeRandomFleet(new Board(), createRng(seed));
      expect(b.ships).toHaveLength(FLEET.length);
      expect(b.grid.filter((v) => v !== -1)).toHaveLength(TOTAL_SHIP_CELLS);
    }
  });

  it('discreet fleets are legal and less readable on average', () => {
    let rnd = 0;
    let disc = 0;
    for (let seed = 0; seed < 300; seed++) {
      rnd += layoutReadability(placeRandomFleet(new Board(), createRng(seed)));
      const d = placeDiscreetFleet(new Board(), createRng(seed + 99999));
      expect(d.grid.filter((v) => v !== -1)).toHaveLength(TOTAL_SHIP_CELLS);
      disc += layoutReadability(d);
    }
    expect(disc).toBeLessThan(rnd);
  });
});

describe('shots', () => {
  it('reports miss, hit, sunk with type, and win', () => {
    const b = new Board();
    b.addShip(destroyer, 0, 0, true);
    expect(b.receiveShot(5, 5)).toEqual({ result: 'miss' });
    expect(b.receiveShot(0, 0).result).toBe('hit');
    const sunk = b.receiveShot(0, 1);
    expect(sunk.result).toBe('sunk');
    expect(sunk.type).toBe('destroyer');
    expect(b.allSunk()).toBe(true);
  });

  it('never accepts a duplicate shot', () => {
    const b = new Board();
    b.addShip(destroyer, 0, 0, true);
    b.receiveShot(3, 3);
    expect(() => b.receiveShot(3, 3)).toThrow();
  });
});

describe('AI', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    it(`${difficulty}: never repeats a cell, never leaves the board, always finishes`, () => {
      for (let seed = 0; seed < 40; seed++) {
        const rng = createRng(seed);
        const target = placeRandomFleet(new Board(), rng);
        const ai = createAI(difficulty, rng.fork());
        const seen = new Set();
        let shots = 0;
        while (!target.allSunk()) {
          const i = ai.nextShot();
          expect(Number.isInteger(i)).toBe(true);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(CELLS);
          expect(seen.has(i)).toBe(false);
          seen.add(i);
          const res = target.receiveShot(Math.floor(i / 10), i % 10);
          ai.observe(i, res.result, res.type);
          shots++;
          expect(shots).toBeLessThanOrEqual(CELLS);
        }
      }
    });
  }

  it('only receives result objects, never the opponent board', () => {
    const g = new Game(7);
    g.newGame('hard');
    g.startBattle();
    const observed = [];
    const orig = g.ai.observe.bind(g.ai);
    g.ai.observe = (...args) => {
      observed.push(args);
      for (const a of args) expect(a).not.toBeInstanceOf(Board);
      return orig(...args);
    };
    for (const k of Object.keys(g.ai)) expect(g.ai[k]).not.toBeInstanceOf(Board);
    g.playerFire(0, 0);
    g.aiFire();
    expect(observed).toHaveLength(1);
    expect(observed[0]).toHaveLength(3);
  });

  it('bots exist for the balance sim', () => {
    for (const k of ['random', 'novice', 'human-proxy', 'expert']) expect(createBot(k, createRng(1)).nextShot()).toBeTypeOf('number');
  });
});

describe('game flow', () => {
  it('runs placement -> battle -> over with alternating turns', () => {
    const g = new Game(42);
    const phases = [];
    g.on('phase', (p) => phases.push(p));
    g.newGame('normal');
    expect(g.phase).toBe(PHASE.PLACEMENT);
    expect(g.playerFire(0, 0)).toBeNull(); // not in battle yet
    g.startBattle();
    expect(g.aiFire()).toBeNull(); // player's turn first
    const bot = createBot('human-proxy', createRng(3));
    while (g.phase === PHASE.BATTLE) {
      const i = bot.nextShot();
      const shot = g.playerFire(Math.floor(i / 10), i % 10);
      expect(shot).not.toBeNull();
      bot.observe(i, shot.result, shot.type);
      expect(g.playerFire(0, 0)).toBeNull(); // can't fire twice in a row
      if (g.phase === PHASE.BATTLE) expect(g.aiFire()).not.toBeNull();
    }
    expect(g.phase).toBe(PHASE.OVER);
    expect(['player', 'ai']).toContain(g.winner);
    const loser = g.winner === 'player' ? g.player : g.enemy;
    const winnerBoard = g.winner === 'player' ? g.enemy : g.player;
    expect(winnerBoard.allSunk()).toBe(true);
    expect(loser.allSunk()).toBe(false);
    const s = g.stats;
    const hitsOnEnemy = [...g.enemy.shots].filter((v) => v === 2).length;
    expect(s.player.hits).toBe(hitsOnEnemy);
    expect(s.player.shots).toBe([...g.enemy.shots].filter((v) => v !== SHOT_NONE).length);
    expect(phases).toEqual([PHASE.PLACEMENT, PHASE.BATTLE, PHASE.OVER]);
  });

  it('is reproducible with the same seed', () => {
    const run = (seed) => {
      const g = new Game(seed);
      g.newGame('hard');
      g.startBattle();
      g.playerFire(4, 4);
      return [g.enemy.ships.map((s) => s.cells.join()).join('|'), g.aiFire().name];
    };
    expect(run(123)).toEqual(run(123));
    expect(run(123)).not.toEqual(run(124));
  });
});
