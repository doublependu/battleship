// A battle with a friend: what this page shows and does while the table in the room (`table.js`) runs the game.
//
// Everything that happens is an op in the room's log, and is shown when it comes back: a shot flies when its op
// arrives, and lands when the answer does. This page's own fleet never leaves it until the game is over. It is kept
// in the browser under the promise made about it (`battleship:fleet:<promise>`) until it is shown at the end, and the
// page answers every shot at it by itself, whether or not anybody is at the keyboard, as soon as it sees the shot.
import * as THREE from 'three';
import { BOARD_CENTER_X, FLEET, SHIP_BY_TYPE, TIMING, cellName } from '../config.js';
import { Board, SHOT_HIT, SHOT_MISS, idx } from '../game/board.js';
import { placeRandomFleet } from '../game/fleet.js';
import { PHASE } from '../game/game.js';
import { createRng } from '../game/rng.js';
import { cellCenter } from '../render/board/boardView.js';
import { swellHeight } from '../render/ocean/swell.js';
import { answerFor, cellsOf, isFleet, promise } from './table.js';

const PREFIX = 'battleship:fleet:';
const KEY = (commit) => `${PREFIX}${commit}`;
/** Fleets kept for battles that never ended. Each is removed once shown at the end of its battle. */
const KEEP = 10;

/** A board's ships as the table writes them. */
export const toFleet = (board) => board.ships.map((s) => ({ type: s.type, r: s.r, c: s.c, h: s.horizontal }));

/** A fleet as a board, its ships in the standard order. */
function toBoard(fleet) {
  const b = new Board();
  for (const def of FLEET) {
    const s = fleet.find((x) => x.type === def.type);
    b.addShip(def, s.r, s.c, s.h);
  }
  return b;
}

/** A board with one of each ship somewhere: where the other side's are, as far as this page knows, until they sink. */
function unknownFleet() {
  return placeRandomFleet(new Board(), createRng(7));
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function loadFleet(commit) {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY(commit)) || 'null');
    return kept && isFleet(kept.fleet) && typeof kept.salt === 'string' && promise(kept.fleet, kept.salt) === commit ? kept : null;
  } catch {
    return null;
  }
}

/** Keeps a fleet under its promise, and only the newest few of those. */
export function keepFleet(storage, commit, fleet, salt, now = Date.now()) {
  storage.setItem(KEY(commit), JSON.stringify({ fleet, salt, at: now }));
  const kept = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    let at = 0;
    try {
      at = Number(JSON.parse(storage.getItem(key))?.at) || 0;
    } catch {
      /* not ours to read: oldest */
    }
    kept.push({ key, at });
  }
  kept.sort((a, b) => b.at - a.at);
  for (const { key } of kept.slice(KEEP)) storage.removeItem(key);
}

function forgetFleet(commit) {
  try {
    localStorage.removeItem(KEY(commit));
  } catch {
    /* nothing kept, then */
  }
}

export class RoomPlay {
  /**
   * @param ctx main.js's parts: game, board, fleet, hud, overlays, r, clock, ripples, S, fx(), audio, setView(side),
   *   layout(), director, toTitle()
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.room = null;
    this.gen = 0;
    this.queue = Promise.resolve();
    /** Shots this page answered, by game and number, so that each is answered once. */
    this.answered = new Set();
    /** The shot this page sent and has not seen come back: { n, k }. */
    this.sent = null;
    /** Whether an animation is running, so that nobody fires in the middle of one. */
    this.showing = false;
    this.mine = null;
  }

  get table() { return this.room?.table ?? null; }
  get seat() { return this.room ? this.table.seatOf(this.room.me) : -1; }

  /** Where a seat's fleet is on this screen: a player's own is on the left; a watcher has seat 0 there. */
  sideOf(c) {
    const s = this.seat;
    return s === -1 ? (c === 0 ? 'player' : 'enemy') : c === s ? 'player' : 'enemy';
  }

  name(c) { return this.table.names[c] || (c === 0 ? 'First admiral' : 'Second admiral'); }

  enter(room) {
    this.room = room;
    this.ctx.S.room = this;
    return this.rebuild();
  }

  leave() {
    this.room = null;
    this.gen++;
    this.ctx.S.room = null;
    this.ctx.hud.setNames('You', 'Enemy');
    this.ctx.hud.setTabLabels();
    this.ctx.hud.setReadyLabel(null);
    this.ctx.board.setTitles();
    this.ctx.overlays.setRoom(null);
    this.ctx.toTitle();
  }

  /** The whole picture from the table at once, with no animation: on coming in, on a new game, when seats change. */
  async rebuild() {
    const gen = ++this.gen;
    const { ctx } = this;
    const { game, board, fleet, hud, S } = ctx;
    await ctx.loadFx();
    if (gen !== this.gen || !this.room) return;
    ctx.director.reset();
    this.queue = Promise.resolve();
    this.showing = false;
    this.sent = null;
    const t = this.table;
    const seat = this.seat;
    this.n = t.n;
    this.builtSeat = seat;
    ctx.overlays.showTitle(false);
    ctx.overlays.showGameOver(null);
    ctx.ripples.clear();
    board.reset();
    board.setVisible(true);

    // This page's own fleet: the promised one, kept in this browser (or, once shown at the end, in the table); or one
    // to place; or, watching, none.
    this.mine = seat !== -1 && t.commits[seat] ? loadFleet(t.commits[seat]) ?? t.reveals[seat] : null;
    if (seat !== -1 && t.reveals[seat]) forgetFleet(t.commits[seat]);
    if (seat === -1) game.player = unknownFleet();
    else if (this.mine) game.player = toBoard(this.mine.fleet);
    else if (!t.commits[seat]) game.player = placeRandomFleet(new Board(), createRng());
    else game.player = unknownFleet();
    game.enemy = unknownFleet();
    // A watcher sees no ships but sunk ones' marks; the other side's ships appear as they sink.
    fleet.setFleet('player', seat === -1 || (t.commits[seat] && !this.mine) ? new Board() : game.player);
    fleet.setFleet('enemy', seat === -1 ? new Board() : game.enemy);
    game.phase = PHASE.PLACEMENT;

    // The battle so far, as it stands.
    for (const c of [0, 1]) {
      const side = this.sideOf(c ^ 1);
      const target = side === 'player' ? game.player : game.enemy;
      for (const x of t.shots[c]) {
        if (!x.result) continue;
        target.shots[idx(x.r, x.c)] = x.result === 'miss' ? SHOT_MISS : SHOT_HIT;
        board.markShot(side, x.r, x.c, x.result);
        if (x.result === 'sunk') this.sinkAt(side, x.ship, false);
        else if (x.result === 'hit') this.hitAt(side, x.r, x.c, false);
      }
    }
    hud.show(true);
    this.titles = null;
    hud.setFleets(game.player, game.enemy);
    this.phaseChanged();
    this.answerPending();
    this.revealIfOver();
    this.showRevealed(false);
  }

  /** The HUD, the phase and the camera, from the table. */
  phaseChanged() {
    const { ctx } = this;
    const { S, hud } = ctx;
    const t = this.table;
    const seat = this.seat;
    const placing = t.phase === 'placing' && seat !== -1 && !t.commits[seat];
    S.phase = placing ? 'placement' : t.phase === 'over' ? 'over' : 'battle';
    ctx.game.phase = placing ? PHASE.PLACEMENT : PHASE.BATTLE;
    hud.setMode(placing ? 'placement' : 'battle');
    hud.setReadyLabel(placing ? 'Ready' : null);
    hud.setFireVisible(false);
    ctx.layout();
    if (placing) ctx.setView('player');
    else if (t.phase === 'battle') ctx.setView(seat !== -1 && t.turn === seat ? 'enemy' : 'player');
    this.status();
    if (t.phase === 'over') this.showOver();
    else ctx.audio.setMusicState(t.phase === 'battle' ? 'battle' : 'calm');
  }

  /** The status line: whose move it is, or what is awaited. */
  status() {
    const t = this.table;
    const seat = this.seat;
    const { hud } = this.ctx;
    if (!t) return;
    hud.setNames(...(seat === -1 ? [this.name(0), this.name(1)] : [`${this.name(seat)} (you)`, this.name(seat ^ 1)]));
    // Over the boards: a watcher's are the two admirals' fleets. Redrawn only when the words change.
    const titles = seat === -1 ? `${this.name(0)}'s fleet|${this.name(1)}'s fleet` : '';
    if (titles !== this.titles) {
      this.titles = titles;
      this.ctx.board.setTitles(titles ? titles.split('|') : undefined);
      hud.setTabLabels(...(titles ? titles.split('|') : []));
    }
    const away = (c) => {
      const p = this.room.presence(t.seats[c]);
      return p === 'here' ? '' : p === null ? ' (not here)' : ` (${p})`;
    };
    if (!t.seats[0] || !t.seats[1]) return hud.setStatus('Waiting for a second admiral — share the invite (👥)');
    if (t.phase === 'placing') {
      if (seat !== -1 && !t.commits[seat]) return hud.setStatus('Place your fleet, then Ready');
      const waiting = [0, 1].filter((c) => !t.commits[c]).map((c) => this.name(c) + away(c));
      return hud.setStatus(`Waiting for ${waiting.join(' and ')} to place their fleet`);
    }
    if (t.phase === 'over') return hud.setStatus(t.winner === seat ? 'Victory!' : seat === -1 ? `${this.name(t.winner)} wins` : 'Defeat', t.winner === seat ? 'win' : 'bad');
    if (seat !== -1 && !this.mine && t.commits[seat]) return hud.setStatus('Your fleet is not in this browser: you can only resign (menu)', 'bad');
    if (t.pending) return hud.setStatus(`Waiting for ${this.name(t.pending.by ^ 1)}${away(t.pending.by ^ 1)} to answer`);
    if (t.turn === seat) return hud.setStatus('Your turn — pick a target');
    return hud.setStatus(`${this.name(t.turn)}${away(t.turn)} is aiming…`);
  }

  canFire() {
    const t = this.table;
    const { S } = this.ctx;
    return !!t && t.phase === 'battle' && !S.paused && t.turn === this.seat && !t.pending && !this.sent && !this.showing && !!this.mine;
  }

  /** Placement done: promise the fleet, keep it here, and say so. */
  ready() {
    const t = this.table;
    const seat = this.seat;
    if (seat === -1 || t.commits[seat] || t.phase !== 'placing') return;
    const fleet = toFleet(this.ctx.game.player);
    const salt = randomSalt();
    const commit = promise(fleet, salt);
    try {
      keepFleet(localStorage, commit, fleet, salt);
    } catch {
      this.ctx.hud.toast('This browser will not keep your fleet: you could not answer after a reload');
    }
    this.mine = { fleet, salt };
    if (!this.room.submit({ t: 'ready', n: t.n, commit })) this.ctx.hud.toast('Not connected: try again in a moment');
  }

  fire(r, c) {
    const t = this.table;
    if (!this.canFire() || this.ctx.game.enemy.isShot(r, c)) return false;
    const k = t.shots[this.seat].length;
    if (!this.room.submit({ t: 'shot', n: t.n, k, r, c })) {
      this.ctx.hud.toast('Not connected: the shot was not fired');
      return false;
    }
    this.sent = { n: t.n, k };
    this.ctx.board.setAim(null);
    this.ctx.hud.setStatus(`Firing at ${cellName(r, c)}…`);
    return true;
  }

  /** A shot at this page's fleet that nobody has answered: answer it, from the fleet itself. */
  answerPending() {
    const t = this.table;
    const seat = this.seat;
    if (!t || t.phase !== 'battle' || !t.pending || seat === -1 || t.pending.by !== (seat ^ 1) || !this.mine) return;
    const key = `${t.n}:${t.pending.k}`;
    if (this.answered.has(key)) return;
    const shots = t.shots[seat ^ 1];
    const shot = shots[t.pending.k];
    const answer = answerFor(this.mine.fleet, shots.slice(0, t.pending.k), shot.r, shot.c);
    if (this.room.submit({ t: 'answer', n: t.n, k: t.pending.k, ...answer })) this.answered.add(key);
  }

  /** After the battle, this page shows its fleet: every page then checks the promise and every answer given. */
  revealIfOver() {
    const t = this.table;
    const seat = this.seat;
    if (!t || t.phase !== 'over' || seat === -1 || t.reveals[seat] || !this.mine) return;
    const key = `${t.n}:reveal`;
    if (this.answered.has(key)) return;
    if (this.room.submit({ t: 'reveal', n: t.n, fleet: this.mine.fleet, salt: this.mine.salt })) this.answered.add(key);
  }

  /** The table changed. */
  changed(what) {
    const t = this.table;
    if (t.n !== this.n || this.seat !== this.builtSeat) return void this.rebuild();
    switch (what.t) {
      case 'shot':
        if (this.sent && what.by === this.seat && what.k === this.sent.k) this.sent = null;
        this.play((gen) => this.showShot(what, gen));
        break;
      case 'answer':
        this.ctx.game[this.sideOf(what.by ^ 1) === 'player' ? 'player' : 'enemy'].shots[idx(what.r, what.c)] = what.result === 'miss' ? SHOT_MISS : SHOT_HIT;
        this.play((gen) => this.showAnswer(what, gen));
        break;
      case 'ready':
        this.play(async () => this.phaseChanged());
        break;
      case 'resign':
      case 'stand':
        this.play(async () => this.phaseChanged());
        break;
      case 'reveal':
        // Shown, and checked by every page: this browser need not keep it any more.
        if (what.c === this.seat) forgetFleet(t.commits[what.c]);
        if (t.phase === 'over') this.play(async () => {
          this.showOver();
          this.showRevealed(true);
        });
        break;
      default:
        this.status();
    }
    this.answerPending();
    this.revealIfOver();
  }

  /** One thing at a time on screen, in the order the table had them. */
  play(fn) {
    const gen = this.gen;
    this.queue = this.queue.then(async () => {
      if (gen !== this.gen) return;
      this.showing = true;
      try { await fn(gen); } catch (e) { console.error(e); }
      if (gen === this.gen) this.showing = false;
    });
  }

  async wait(seconds, gen) {
    await this.ctx.clock.wait(seconds);
    return gen === this.gen;
  }

  async showShot({ by, r, c }, gen) {
    const { ctx } = this;
    const fx = ctx.fx();
    const side = this.sideOf(by ^ 1);
    const to = cellCenter(side, r, c);
    to.y = swellHeight(to.x, to.z, ctx.clock.time);
    ctx.setView(side);
    if (by === this.seat) {
      const shooters = ctx.fleet.views.player.filter((v) => !v.sunk && !v.sinking);
      const sv = shooters[Math.floor(Math.random() * shooters.length)] ?? ctx.fleet.views.player[0];
      const from = sv.localToWorld(new THREE.Vector3(sv.model.length * 0.22, 0.42, 0));
      const dir = new THREE.Vector3().subVectors(to, from).setY(0).normalize().setY(0.35).normalize();
      fx.muzzle(from, dir);
      ctx.audio.cue('fire', { x: from.x });
      ctx.audio.cue('whistle', { x: to.x, duration: TIMING.shellFlight });
      ctx.hud.setStatus(`Firing at ${cellName(r, c)}…`);
      await fx.shell(from, to, TIMING.shellFlight);
    } else {
      const other = side === 'player' ? 'enemy' : 'player';
      const from = new THREE.Vector3(BOARD_CENTER_X[other] + (Math.random() - 0.5) * 10, 0.6, -70);
      ctx.audio.cue('distantFire', { x: 6 });
      ctx.audio.cue('incoming', { x: to.x, duration: TIMING.aiShellFlight });
      ctx.hud.setStatus(`${this.name(by)} fires at ${cellName(r, c)}…`);
      await fx.shell(from, to, TIMING.aiShellFlight, { incoming: true });
    }
    return gen === this.gen;
  }

  async showAnswer({ by, r, c, result, ship, over }, gen) {
    const { ctx } = this;
    const side = this.sideOf(by ^ 1);
    const mine = side === 'player' && this.seat !== -1;
    const pos = cellCenter(side, r, c);
    pos.y = swellHeight(pos.x, pos.z, ctx.clock.time);
    ctx.board.markShot(side, r, c, result);
    const fx = ctx.fx();
    let extra = 0;
    if (result === 'miss') {
      fx.splash(pos);
      ctx.audio.cue('splash', { x: pos.x });
      ctx.hud.setStatus(`${cellName(r, c)}: miss`, 'miss');
    } else {
      fx.explosion(pos.clone().setY(pos.y + 0.25), mine ? 1 : 0.9);
      ctx.audio.cue('explosion', { x: pos.x, near: mine });
      if (mine) ctx.r.rig.shake(0.18);
      if (result === 'hit') {
        this.hitAt(side, r, c, true);
        ctx.hud.setStatus(`${cellName(r, c)}: hit!`, mine ? 'bad' : 'good');
      } else {
        this.hitAt(side, r, c, true);
        this.sinkAt(side, ship, true);
        const kind = SHIP_BY_TYPE[ship.type].name;
        ctx.hud.setStatus(by === this.seat ? `You sank their ${kind}!` : mine ? `They sank your ${kind}!` : `${this.name(by)} sank a ${kind}`, mine ? 'bad' : 'good');
        ctx.audio.cue('sunk', { x: pos.x, mine });
        extra = TIMING.afterSunk;
      }
    }
    ctx.hud.setFleets(ctx.game.player, ctx.game.enemy);
    if (!(await this.wait(TIMING.afterImpact + extra, gen))) return;
    if (over) {
      this.phaseChanged();
      return;
    }
    const t = this.table;
    if (t.phase === 'battle') ctx.setView(this.seat !== -1 && t.turn === this.seat ? 'enemy' : 'player');
    this.status();
  }

  /** A hit on a side: on the ship there, if this page draws one, or a fire on the water where it must be. */
  hitAt(side, r, c, live) {
    const { ctx } = this;
    const fx = ctx.fx();
    const b = side === 'player' ? ctx.game.player : ctx.game.enemy;
    const views = ctx.fleet.views[side];
    const si = b.grid[idx(r, c)];
    const view = side === 'player' && views.length && si !== -1 ? views[si] : null;
    if (view) {
      const k = b.ships[si].cells.indexOf(idx(r, c));
      view.addHit(k, live);
      const local = new THREE.Vector3(view.cellLocalX(k), 0.3, 0);
      fx.addFire((out) => view.localToWorld(local, out), 1, side);
    } else {
      const pos = cellCenter(side, r, c);
      fx.addFire((out) => out.set(pos.x, swellHeight(pos.x, pos.z, ctx.clock.time) + 0.08, pos.z), 0.8, side);
    }
  }

  /** A ship sank: where it lay is known now; it shows, burns out and goes down. */
  sinkAt(side, ship, live) {
    const { ctx } = this;
    const b = side === 'player' ? ctx.game.player : ctx.game.enemy;
    const si = b.ships.findIndex((s) => s.type === ship.type);
    const cells = cellsOf(ship);
    if (si !== -1) {
      const s = b.ships[si];
      if (side === 'enemy') Object.assign(s, { r: ship.r, c: ship.c, horizontal: ship.h, cells });
      s.sunk = true;
    }
    ctx.board.markSunk(side, { cells });
    const view = si !== -1 ? ctx.fleet.views[side][si] : null;
    if (!view) return;
    if (side === 'enemy') {
      view.setPlacement(b.ships[si]);
      view.show(!live);
      for (let j = 0; j < cells.length; j++) view.addHit(j, false);
    }
    if (live) ctx.fx().sink(view, !!ctx.r.tier?.ultra);
    else view.settle(!!ctx.r.tier?.ultra);
  }

  /** After the battle the other fleet is shown: its ships that were never found come up where they were. */
  showRevealed(live) {
    const t = this.table;
    const seat = this.seat;
    const shown = seat !== -1 && t.phase === 'over' ? t.reveals[seat ^ 1] : null;
    if (!shown) return;
    const b = this.ctx.game.enemy;
    const views = this.ctx.fleet.views.enemy;
    for (const ship of shown.fleet) {
      const si = b.ships.findIndex((s) => s.type === ship.type);
      const s = b.ships[si];
      const view = views[si];
      if (!s || !view || s.sunk || view.revealed) continue;
      Object.assign(s, { r: ship.r, c: ship.c, horizontal: ship.h, cells: cellsOf(ship) });
      view.setPlacement(s);
      view.show(!live);
    }
  }

  /** The game is over: who won, whether both fleets were as promised, and the next game for the admirals. */
  showOver() {
    const t = this.table;
    const seat = this.seat;
    const { ctx } = this;
    const lines = [0, 1].map((c) => {
      const v = t.verdicts[c];
      return `${this.name(c)}: ${t.shots[c].length} shots, ${t.shots[c].filter((x) => x.result && x.result !== 'miss').length} hits` +
        (v === 'kept' ? ' · fleet as promised' : v === 'broken' ? ' · fleet NOT as promised' : ' · fleet not shown yet');
    });
    const won = t.winner === seat;
    const how = t.how === 'resign' ? 'by resignation' : t.how === 'broken' ? 'because the other fleet was not as promised' : 'every ship sunk';
    ctx.audio.setMusicState(won ? 'victory' : seat === -1 ? 'calm' : 'defeat');
    ctx.overlays.showRoomOver({
      // Somebody watching sees a winner, in the winner's colour.
      win: won || seat === -1,
      banner: seat === -1 ? `${this.name(t.winner).toUpperCase()} WINS` : won ? 'VICTORY' : 'DEFEAT',
      sub: seat === -1 ? `${this.name(t.winner)} won, ${how}.` : won ? `You won, ${how}.` : `${this.name(t.winner)} won, ${how}.`,
      lines,
      canNext: seat !== -1,
    });
    this.status();
  }

  /** The menu's room part. */
  menu() {
    const t = this.table;
    const seat = this.seat;
    return {
      canResign: seat !== -1 && t.phase !== 'over' && !!t.seats[seat ^ 1],
      canStand: seat !== -1,
      canSit: seat === -1 && t.seats.includes(null),
      canNext: seat !== -1 && (t.phase === 'over' || (!t.commits[0] && !t.commits[1])),
      resign: () => this.room?.submit({ t: 'resign', n: t.n }),
      stand: () => this.room?.submit({ t: 'stand' }),
      sit: () => this.room?.sit(t.seats.indexOf(null)),
      next: () => this.room?.submit({ t: 'new', n: t.n }),
    };
  }
}
