// In-game HUD: status line, remaining fleets, pause/mute buttons, placement bar, board tabs, Fire button, the
// watcher's question in a room, toast and FPS readout. Reports its occupied heights so the camera keeps the boards clear of it.
import { FLEET } from '../config.js';
import { ICONS } from './icons.js';

export class Hud {
  /** @param {HTMLElement} root @param {object} actions */
  constructor(root, actions) {
    this.actions = actions;
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="topbar">
        <div class="status" data-k="status" aria-live="polite">&nbsp;</div>
        <div class="fleets" data-k="fleets">
          <span class="side"><b data-k="name-player">You</b><span data-k="pips-player"></span></span>
          <span class="side"><b data-k="name-enemy">Enemy</b><span data-k="pips-enemy"></span></span>
        </div>
      </div>
      <div class="iconbar">
        <button class="icon" data-k="pause" aria-label="Pause">${ICONS.pause}</button>
        <button class="icon" data-k="mute" aria-label="Mute">${ICONS.soundOn}</button>
      </div>
      <div class="bottombar">
        <div class="ask" data-k="ask" hidden>
          <p data-k="ask-text"></p>
          <div class="row">
            <button class="btn go" data-k="ask-play">Play next</button>
            <button class="btn ghost" data-k="ask-watch">Just watch</button>
          </div>
        </div>
        <div data-k="placement" hidden>
          <p class="hint">Drag a ship to move it · tap a ship to rotate it</p>
          <div class="row">
            <button class="btn ghost" data-k="randomize">Randomize</button>
            <button class="btn ghost" data-k="rotate">Rotate</button>
            <button class="btn go" data-k="start">Start Battle</button>
          </div>
        </div>
        <div data-k="battle" hidden>
          <div class="row">
            <button class="btn fire" data-k="fire" hidden>FIRE</button>
          </div>
          <div class="tabs" data-k="tabs" hidden>
            <button data-v="player" aria-pressed="false">Your fleet</button>
            <button data-v="enemy" aria-pressed="true">Enemy waters</button>
          </div>
        </div>
      </div>`;
    root.appendChild(this.el);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast hide';
    root.appendChild(this.toastEl);
    this.fpsEl = document.createElement('div');
    this.fpsEl.id = 'fps';
    this.fpsEl.hidden = true;
    document.body.appendChild(this.fpsEl);

    const q = (k) => this.el.querySelector(`[data-k="${k}"]`);
    this.q = q;
    const on = (k, fn) => q(k).addEventListener('click', fn);
    on('pause', () => actions.pause());
    on('mute', () => actions.toggleMute());
    on('randomize', () => actions.randomize());
    on('rotate', () => actions.rotate());
    on('start', () => actions.startBattle());
    on('fire', () => actions.fire());
    on('ask-play', () => actions.ask(true));
    on('ask-watch', () => actions.ask(false));
    q('tabs').addEventListener('click', (e) => {
      const v = e.target.closest('button')?.dataset.v;
      if (v) actions.peek(v);
    });
    this.toastTimer = 0;
  }

  show(on) {
    this.el.hidden = !on;
  }

  setMode(mode) {
    this.q('placement').hidden = mode !== 'placement';
    this.q('battle').hidden = mode !== 'battle';
    this.q('fleets').hidden = mode === 'placement';
  }

  /** The names over the two fleets' pips: yours and theirs, or the two admirals' for somebody watching. */
  setNames(left, right) {
    this.q('name-player').textContent = left;
    this.q('name-enemy').textContent = right;
  }

  /** The focus-mode tabs: your fleet and the enemy's waters, or the two admirals' fleets for somebody watching. */
  setTabLabels(player = 'Your fleet', enemy = 'Enemy waters') {
    const [a, b] = this.q('tabs').querySelectorAll('button');
    a.textContent = player;
    b.textContent = enemy;
  }

  /** The placement bar's button: "Start Battle" against the AI, "Ready" with a friend. */
  setReadyLabel(label) {
    this.q('start').textContent = label ?? 'Start Battle';
  }

  setStatus(text, tone = '') {
    const el = this.q('status');
    el.textContent = text;
    el.className = `status ${tone}`;
  }

  setFleets(playerBoard, enemyBoard) {
    const pips = (board) =>
      FLEET.map((def) => {
        const ship = board.ships.find((s) => s.type === def.type);
        return `<i class="pip${ship?.sunk ? ' sunk' : ''}" style="width:${def.length * 7}px" title="${def.name}"></i>`;
      }).join('');
    this.q('pips-player').innerHTML = pips(playerBoard);
    this.q('pips-enemy').innerHTML = pips(enemyBoard);
  }

  setMuted(muted, waiting = false) {
    const b = this.q('mute');
    b.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    b.classList.toggle('waiting', waiting);
    b.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  /** Focus-mode board tabs: visible only when one board is shown at a time. */
  setTabs(visible, active) {
    const tabs = this.q('tabs');
    tabs.hidden = !visible;
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === active));
  }

  /** A watcher in a room: { ask, text } asks whether to play (or says where they are in line); null hides it. */
  setAsk(state) {
    this.q('ask').hidden = !state;
    if (!state) return;
    this.q('ask-text').textContent = state.text;
    this.q('ask-play').hidden = !state.ask;
  }

  setFireVisible(on) {
    this.q('fire').hidden = !on;
  }

  toast(text, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hide');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hide'), ms);
  }

  setFps(visible, text = '') {
    this.fpsEl.hidden = !visible;
    if (visible) this.fpsEl.textContent = text;
  }

  /** Screen space taken by HUD elements, for camera framing. */
  insets(mode, tabs) {
    if (!this.safeProbe) {
      this.safeProbe = document.createElement('div');
      this.safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
      document.body.appendChild(this.safeProbe);
    }
    const cs = getComputedStyle(this.safeProbe);
    const sat = parseFloat(cs.paddingTop) || 0;
    const sab = parseFloat(cs.paddingBottom) || 0;
    const narrow = innerWidth < 520;
    const short = innerHeight < 500;
    const top = (mode === 'placement' ? 52 : short ? 70 : 84) + sat + (narrow ? 8 : 0);
    let bottom = 16 + sab;
    if (mode === 'placement') bottom = (narrow && innerWidth < 380 ? 132 : short ? 84 : 92) + sab;
    else if (tabs) bottom = (short ? 58 : 70) + sab;
    const ask = this.q('ask');
    if (!ask.hidden) bottom += ask.offsetHeight + 8;
    return { top, bottom, left: 10, right: 10 };
  }
}
