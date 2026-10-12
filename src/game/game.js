// Game rules + state machine. Pure and synchronous: every shot resolves immediately.
// The director (src/director.js) turns this into pacing and animation.
import { DEFAULT_DIFFICULTY, cellName } from '../config.js';
import { createAI } from './ai/index.js';
import { Board, colOf, idx, rowOf } from './board.js';
import { Emitter } from './emitter.js';
import { placeDiscreetFleet, placeRandomFleet } from './fleet.js';
import { createRng } from './rng.js';

export const PHASE = { TITLE: 'title', PLACEMENT: 'placement', BATTLE: 'battle', OVER: 'over' };

export class Game extends Emitter {
  constructor(seed) {
    super();
    this.rng = createRng(seed);
    this.phase = PHASE.TITLE;
    this.turn = 'player';
    this.difficulty = DEFAULT_DIFFICULTY;
    this.player = new Board();
    this.enemy = new Board();
    this.ai = null;
    this.winner = null;
    this.stats = null;
    placeRandomFleet(this.player, this.rng);
  }

  /** Start placement for a new game. The player's fleet starts randomly placed. */
  newGame(difficulty = this.difficulty) {
    this.difficulty = difficulty;
    const aiRng = this.rng.fork();
    placeRandomFleet(this.player, this.rng);
    if (difficulty === 'hard') placeDiscreetFleet(this.enemy, aiRng);
    else placeRandomFleet(this.enemy, aiRng);
    this.ai = createAI(difficulty, aiRng);
    this.winner = null;
    this.turn = 'player';
    this.stats = {
      player: { shots: 0, hits: 0 },
      ai: { shots: 0, hits: 0 },
      turns: 0,
      startedAt: 0,
      endedAt: 0,
    };
    this.phase = PHASE.PLACEMENT;
    this.emit('phase', this.phase);
  }

  randomizePlayerFleet() {
    if (this.phase !== PHASE.PLACEMENT) return;
    placeRandomFleet(this.player, this.rng);
    this.emit('fleet', this.player);
  }

  startBattle(now = 0) {
    if (this.phase !== PHASE.PLACEMENT) return;
    this.phase = PHASE.BATTLE;
    this.turn = 'player';
    this.stats.startedAt = now;
    this.emit('phase', this.phase);
  }

  canPlayerFire(r, c) {
    return this.phase === PHASE.BATTLE && this.turn === 'player' && !this.enemy.isShot(r, c);
  }

  /** @returns {null | {r:number,c:number,name:string,result:'miss'|'hit'|'sunk',type?:string,ship?:object,over:boolean}} */
  playerFire(r, c, now = 0) {
    if (!this.canPlayerFire(r, c)) return null;
    const res = this.enemy.receiveShot(r, c);
    this.stats.player.shots++;
    if (res.result !== 'miss') this.stats.player.hits++;
    const shot = { by: 'player', r, c, name: cellName(r, c), ...res, over: false };
    if (this.enemy.allSunk()) this.#finish('player', now, shot);
    else this.turn = 'ai';
    this.emit('shot', shot);
    return shot;
  }

  /** The AI picks and fires one shot. */
  aiFire(now = 0) {
    if (this.phase !== PHASE.BATTLE || this.turn !== 'ai') return null;
    const i = this.ai.nextShot();
    const r = rowOf(i);
    const c = colOf(i);
    const res = this.player.receiveShot(r, c);
    // The AI hears exactly what a human opponent would: hit / miss / sunk + ship type.
    this.ai.observe(idx(r, c), res.result, res.type);
    this.stats.ai.shots++;
    if (res.result !== 'miss') this.stats.ai.hits++;
    this.stats.turns++;
    const shot = { by: 'ai', r, c, name: cellName(r, c), ...res, over: false };
    if (this.player.allSunk()) this.#finish('ai', now, shot);
    else this.turn = 'player';
    this.emit('shot', shot);
    return shot;
  }

  #finish(winner, now, shot) {
    this.winner = winner;
    this.phase = PHASE.OVER;
    this.stats.endedAt = now;
    if (winner === 'player') this.stats.turns++;
    shot.over = true;
    this.emit('phase', this.phase);
  }
}
