// Title menu, pause screen and game-over screen. The title markup is inline in index.html.
import { DIFFICULTIES, TIERS } from '../config.js';
import { ICONS } from './icons.js';

export class Overlays {
  constructor(root, actions) {
    this.actions = actions;
    this.title = document.getElementById('title');
    this.fork = document.getElementById('fork');

    // title extras: settings + sound buttons, tier hint
    const bar = document.createElement('div');
    bar.className = 'iconbar';
    bar.innerHTML = `<button class="icon" data-k="settings" aria-label="Settings">${ICONS.gear}</button>
      <button class="icon waiting" data-k="sound" aria-label="Enable sound">${ICONS.soundOn}</button>`;
    this.title.appendChild(bar);
    this.titleSound = bar.querySelector('[data-k="sound"]');
    bar.querySelector('[data-k="settings"]').addEventListener('click', () => actions.openSettings());
    this.titleSound.addEventListener('click', () => actions.toggleMute());
    this.tierHint = document.createElement('p');
    this.tierHint.className = 'tier';
    document.getElementById('menu').appendChild(this.tierHint);
    this.diff = document.getElementById('difficulty');
    this.diff.addEventListener('click', (e) => {
      const v = e.target.closest('button')?.dataset.diff;
      if (v) actions.setDifficulty(v);
    });
    document.getElementById('play').addEventListener('click', () => actions.play());

    this.pause = document.createElement('div');
    this.pause.className = 'overlay';
    this.pause.hidden = true;
    this.pause.innerHTML = `
      <div class="card">
        <h2>Paused</h2>
        <div class="stack">
          <button class="btn go" data-k="resume">Resume</button>
          <button class="btn" data-k="settings">Settings</button>
          <button class="btn" data-k="restart">Restart</button>
        </div>
        <h3 style="margin:16px 0 8px;font-size:13px;opacity:.75;text-transform:uppercase;letter-spacing:.08em">Next game difficulty</h3>
        <div class="seg" data-k="diff">${Object.entries(DIFFICULTIES)
          .map(([k, d]) => `<button role="radio" data-diff="${k}">${d.label}</button>`)
          .join('')}</div>
      </div>`;
    root.appendChild(this.pause);
    const pq = (k) => this.pause.querySelector(`[data-k="${k}"]`);
    pq('resume').addEventListener('click', () => actions.resume());
    pq('settings').addEventListener('click', () => actions.openSettings());
    pq('restart').addEventListener('click', () => actions.restart());
    pq('diff').addEventListener('click', (e) => {
      const v = e.target.closest('button')?.dataset.diff;
      if (v) actions.setDifficulty(v);
    });
    this.pauseDiff = pq('diff');

    this.over = document.createElement('div');
    this.over.className = 'overlay';
    this.over.hidden = true;
    this.over.innerHTML = `
      <div class="card">
        <p class="banner" data-k="banner"></p>
        <p data-k="sub" style="margin:0 0 6px;opacity:.85"></p>
        <table class="stats" data-k="stats"></table>
        <div class="stack">
          <button class="btn go" data-k="again">Play again</button>
          <button class="btn" data-k="menu">Change difficulty</button>
        </div>
      </div>`;
    root.appendChild(this.over);
    const oq = (k) => this.over.querySelector(`[data-k="${k}"]`);
    oq('again').addEventListener('click', () => actions.playAgain());
    oq('menu').addEventListener('click', () => actions.toMenu());
    this.oq = oq;
  }

  setLoading(fraction, message) {
    document.getElementById('progress').style.width = `${Math.round(Math.max(0.05, fraction) * 100)}%`;
    if (message) document.getElementById('loadmsg').textContent = message;
  }

  showMenu() {
    document.getElementById('loading').hidden = true;
    document.getElementById('menu').hidden = false;
  }

  showTitle(on) {
    this.title.hidden = !on;
    this.#updateFork();
  }

  showUnsupported() {
    document.getElementById('loading').hidden = true;
    document.getElementById('nowebgl').hidden = false;
  }

  setDifficulty(d) {
    for (const el of [...this.diff.querySelectorAll('button'), ...this.pauseDiff.querySelectorAll('button')]) {
      el.setAttribute('aria-checked', String(el.dataset.diff === d));
    }
  }

  setTierHint(tier, auto) {
    this.tierHint.textContent = tier ? `Graphics: ${TIERS[tier].name}${auto ? ' (auto)' : ''}` : '';
  }

  setSound(muted, waiting) {
    this.titleSound.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    this.titleSound.classList.toggle('waiting', waiting && !muted);
    this.titleSound.setAttribute('aria-label', muted ? 'Unmute' : waiting ? 'Enable sound' : 'Mute');
  }

  showPause(on) {
    this.pause.hidden = !on;
    this.#updateFork();
  }

  get pauseOpen() {
    return !this.pause.hidden;
  }

  showGameOver(result) {
    if (!result) {
      this.over.hidden = true;
      return;
    }
    const win = result.winner === 'player';
    const b = this.oq('banner');
    b.textContent = win ? 'VICTORY' : 'DEFEAT';
    b.className = `banner ${win ? 'win' : 'lose'}`;
    this.oq('sub').textContent = win
      ? `You sank the enemy fleet in ${result.stats.player.shots} shots.`
      : `Your fleet was sunk. ${result.enemyShipsLeft} enemy ship${result.enemyShipsLeft === 1 ? '' : 's'} survived.`;
    const s = result.stats;
    const acc = (x) => (x.shots ? `${Math.round((100 * x.hits) / x.shots)}%` : '–');
    const dur = Math.max(0, Math.round(s.endedAt - s.startedAt));
    this.oq('stats').innerHTML = `
      <tr><td></td><td>You</td><td>${DIFFICULTIES[result.difficulty].label}</td></tr>
      <tr><td>Shots</td><td>${s.player.shots}</td><td>${s.ai.shots}</td></tr>
      <tr><td>Hits</td><td>${s.player.hits}</td><td>${s.ai.hits}</td></tr>
      <tr><td>Accuracy</td><td>${acc(s.player)}</td><td>${acc(s.ai)}</td></tr>
      <tr><td>Turns</td><td colspan="2">${s.turns}</td></tr>
      <tr><td>Time</td><td colspan="2">${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}</td></tr>`;
    this.over.hidden = false;
  }

  #updateFork() {
    // Loading/title and pause screens show the fork ribbon.
    this.fork.hidden = this.title.hidden && this.pause.hidden;
  }
}
