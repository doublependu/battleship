// Turn sequencer: logic result -> shell + impact animation -> HUD -> AI "thinking" -> AI shot -> back to the
// player. Waits use the game clock, so pausing freezes the whole sequence. restart() abandons in-flight
// sequences (their waits are cancelled and every await re-checks the generation).
import * as THREE from 'three';
import { BOARD_CENTER_X, SHIP_BY_TYPE, TIMING } from './config.js';
import { cellCenter } from './render/board/boardView.js';
import { swellHeight } from './render/ocean/swell.js';

export class Director {
  /**
   * @param {object} ctx { game, clock, r, board, fleet, fx (getter), audio (getter), hud, events }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.gen = 0;
    this.busy = false;
    this.fires = new Map();
    this.sinkingUntil = 0;
  }

  get fx() {
    return this.ctx.fx();
  }

  get audio() {
    return this.ctx.audio();
  }

  reset() {
    this.gen++;
    this.busy = false;
    this.ctx.clock.cancelWaits();
    for (const f of this.fires.values()) f.stop(0.01);
    this.fires.clear();
    this.fx?.reset();
  }

  async #wait(seconds, gen) {
    await this.ctx.clock.wait(seconds);
    return gen === this.gen;
  }

  /** Player fires at an enemy cell. Returns false if the shot isn't allowed right now. */
  async playerFire(r, c) {
    const { game, clock, fleet, hud } = this.ctx;
    if (this.busy || !game.canPlayerFire(r, c) || !this.fx) return false;
    this.busy = true;
    const gen = this.gen;
    const shot = game.playerFire(r, c, clock.time);
    this.ctx.events.onShot?.(shot);
    hud.setStatus(`Firing at ${shot.name}…`);
    const shooters = fleet.views.player.filter((v) => !v.sunk && !v.sinking);
    const sv = shooters[Math.floor(Math.random() * shooters.length)] ?? fleet.views.player[0];
    const from = sv.localToWorld(new THREE.Vector3(sv.model.length * 0.22, 0.42, 0));
    const to = cellCenter('enemy', r, c);
    to.y = swellHeight(to.x, to.z, clock.time);
    const dir = new THREE.Vector3().subVectors(to, from).setY(0).normalize().setY(0.35).normalize();
    this.fx.muzzle(from, dir);
    this.audio.cue('fire', { x: from.x });
    this.audio.cue('whistle', { x: to.x, duration: TIMING.shellFlight });
    await this.fx.shell(from, to, TIMING.shellFlight);
    if (gen !== this.gen) return true;
    const sunkWait = this.#impact('enemy', shot);
    this.ctx.events.onResolved?.(shot);
    if (!(await this.#wait(TIMING.afterImpact + sunkWait, gen))) return true;
    if (shot.over) return this.#gameOver(gen);
    this.#aiTurn(gen);
    return true;
  }

  async #aiTurn(gen) {
    const { game, clock, r, hud } = this.ctx;
    const focus = r.rig.layout === 'focus';
    this.ctx.events.onView?.('player');
    hud.setStatus('Enemy is aiming…');
    if (!(await this.#wait(TIMING.aiThink + (focus ? TIMING.cameraPan : 0), gen))) return;
    const shot = game.aiFire(clock.time);
    this.ctx.events.onShot?.(shot);
    const to = cellCenter('player', shot.r, shot.c);
    to.y = swellHeight(to.x, to.z, clock.time);
    const from = new THREE.Vector3(BOARD_CENTER_X.enemy + (Math.random() - 0.5) * 10, 0.6, -70);
    this.audio.cue('distantFire', { x: 6 });
    this.audio.cue('incoming', { x: to.x, duration: TIMING.aiShellFlight });
    await this.fx.shell(from, to, TIMING.aiShellFlight, { incoming: true });
    if (gen !== this.gen) return;
    const sunkWait = this.#impact('player', shot);
    this.ctx.events.onResolved?.(shot);
    if (!(await this.#wait(TIMING.afterImpact + sunkWait, gen))) return;
    if (shot.over) {
      this.#gameOver(gen);
      return;
    }
    this.ctx.events.onView?.('enemy');
    if (focus && !(await this.#wait(TIMING.cameraPan * 0.6, gen))) return;
    hud.setStatus('Your turn — pick a target');
    this.busy = false;
    this.ctx.events.onPlayerTurn?.();
  }

  /** Visuals + sound + HUD for a resolved shot. Returns extra seconds to wait for a sinking. */
  #impact(side, shot) {
    const { board, fleet, hud, r, clock, game } = this.ctx;
    const pos = cellCenter(side, shot.r, shot.c);
    pos.y = swellHeight(pos.x, pos.z, clock.time);
    board.markShot(side, shot.r, shot.c, shot.result);
    const mine = side === 'player';
    if (shot.result === 'miss') {
      this.fx.splash(pos);
      this.audio.cue('splash', { x: pos.x });
      hud.setStatus(mine ? `Enemy fired at ${shot.name}: miss` : `${shot.name}: Miss`, 'miss');
      return 0;
    }
    const view = fleet.view(side, shot.ship.index);
    const k = shot.ship.cells.indexOf(shot.r * 10 + shot.c);
    this.fx.explosion(pos.clone().setY(pos.y + 0.25), mine ? 1 : 0.9);
    this.audio.cue('explosion', { x: pos.x, near: mine });
    let fire;
    if (mine || view.revealed) {
      view.addHit(k);
      const local = new THREE.Vector3(view.cellLocalX(k), 0.3, 0);
      fire = this.fx.addFire((out) => view.localToWorld(local, out), 1, side);
    } else {
      fire = this.fx.addFire((out) => out.set(pos.x, swellHeight(pos.x, pos.z, clock.time) + 0.08, pos.z), 0.8, side);
    }
    this.fires.set(`${side}:${shot.r},${shot.c}`, fire);
    if (mine) r.rig.shake(0.18);
    if (shot.result !== 'sunk') {
      hud.setStatus(mine ? `Enemy hit your ship at ${shot.name}!` : `${shot.name}: Hit!`, mine ? 'bad' : 'good');
      return 0;
    }
    // Sunk: reveal (enemy), sink, oil slick, HUD.
    const name = SHIP_BY_TYPE[shot.type].name;
    if (!mine) {
      view.show();
      for (let j = 0; j < shot.ship.length; j++) view.addHit(j, false);
    }
    board.markSunk(side, shot.ship);
    for (const i of shot.ship.cells) this.fires.get(`${side}:${Math.floor(i / 10)},${i % 10}`)?.stop(3.5);
    this.fx.sink(view, !!r.tier?.ultra);
    this.audio.cue('sunk', { x: pos.x, mine, breaks: view.model.breaks });
    hud.setFleets(game.player, game.enemy);
    hud.setStatus(mine ? `They sank your ${name}!` : `You sank their ${name}!`, mine ? 'bad' : 'good');
    return TIMING.afterSunk;
  }

  async #gameOver(gen) {
    const { game, fleet, clock } = this.ctx;
    if (!(await this.#wait(0.6, gen))) return true;
    if (game.winner === 'ai') {
      for (const v of fleet.views.enemy) if (!v.revealed) v.show();
    }
    this.audio.cue(game.winner === 'player' ? 'victory' : 'defeat');
    this.ctx.events.onGameOver?.(game.winner, clock.time);
    return true;
  }
}
