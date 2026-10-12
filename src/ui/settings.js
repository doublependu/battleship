// Settings: persisted in localStorage, edited in one panel shared by the title and pause screens.
import { DEFAULT_DIFFICULTY, DIFFICULTIES, TIERS, TIER_ORDER } from '../config.js';

const KEY = 'bs.settings.v1';
const DEFAULTS = {
  difficulty: DEFAULT_DIFFICULTY,
  graphics: 'auto',
  showFps: false,
  muted: false,
  volumes: { effects: 1, ambience: 0.7, music: 0.5 },
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const out = { ...DEFAULTS, ...s, volumes: { ...DEFAULTS.volumes, ...(s.volumes ?? {}) } };
    if (!DIFFICULTIES[out.difficulty]) out.difficulty = DEFAULT_DIFFICULTY;
    if (out.graphics !== 'auto' && !TIERS[out.graphics]) out.graphics = 'auto';
    return out;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

const TIER_NOTES = {
  low: 'Lightest: simple water, fewer effects. For older phones.',
  medium: 'Sea shader with detail waves and full effects.',
  high: 'Adds see-through water around hulls and hull ripples.',
  ultra: 'Real water: reflections, refraction, caustics, a seabed and wrecks.',
};

/**
 * Settings panel. `ctx` provides { settings, detectedTier(), currentTier(), onChange(settings, what) }.
 */
export class SettingsPanel {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.el = document.createElement('div');
    this.el.className = 'overlay';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="card settings" role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <h3>Graphics</h3>
        <div class="seg" role="radiogroup" data-k="graphics">
          <button role="radio" data-v="auto">Auto</button>
          ${TIER_ORDER.map((t) => `<button role="radio" data-v="${t}">${TIERS[t].name}</button>`).join('')}
        </div>
        <p class="note" data-k="tiernote"></p>
        <label>Show FPS <input type="checkbox" data-k="showFps"></label>
        <h3>Sound</h3>
        <label>Mute all <input type="checkbox" data-k="muted"></label>
        <label>Effects <input type="range" min="0" max="1" step="0.05" data-k="effects"></label>
        <label>Ambience <input type="range" min="0" max="1" step="0.05" data-k="ambience"></label>
        <label>Music <input type="range" min="0" max="1" step="0.05" data-k="music"></label>
        <div class="stack"><button class="btn go" data-k="close">Done</button></div>
      </div>`;
    root.appendChild(this.el);
    const q = (k) => this.el.querySelector(`[data-k="${k}"]`);
    q('graphics').addEventListener('click', (e) => {
      const v = e.target.closest('button')?.dataset.v;
      if (!v) return;
      this.ctx.settings.graphics = v;
      this.#commit('graphics');
    });
    q('showFps').addEventListener('change', (e) => {
      this.ctx.settings.showFps = e.target.checked;
      this.#commit('showFps');
    });
    q('muted').addEventListener('change', (e) => {
      this.ctx.settings.muted = e.target.checked;
      this.#commit('sound');
    });
    for (const k of ['effects', 'ambience', 'music']) {
      q(k).addEventListener('input', (e) => {
        this.ctx.settings.volumes[k] = Number(e.target.value);
        this.#commit('sound');
      });
    }
    q('close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    this.q = q;
  }

  #commit(what) {
    saveSettings(this.ctx.settings);
    this.ctx.onChange(this.ctx.settings, what);
    this.refresh();
  }

  refresh() {
    const s = this.ctx.settings;
    const detected = this.ctx.detectedTier();
    const current = this.ctx.currentTier();
    for (const b of this.q('graphics').querySelectorAll('button')) {
      b.setAttribute('aria-checked', String(b.dataset.v === s.graphics));
      if (b.dataset.v === 'auto') b.textContent = detected ? `Auto (${TIERS[detected].name})` : 'Auto';
    }
    const shown = s.graphics === 'auto' ? current : s.graphics;
    let note = TIER_NOTES[shown] ?? '';
    if (s.graphics !== 'auto' && detected && TIER_ORDER.indexOf(s.graphics) > TIER_ORDER.indexOf(detected)) {
      note = `May run slowly on this device. ${note}`;
    }
    if (this.ctx.ultraUnavailable?.() && s.graphics === 'ultra') note = 'Ultra needs float render targets, which this browser lacks.';
    this.q('tiernote').textContent = note;
    this.q('showFps').checked = s.showFps;
    this.q('muted').checked = s.muted;
    for (const k of ['effects', 'ambience', 'music']) this.q(k).value = String(s.volumes[k]);
  }

  open() {
    this.refresh();
    this.el.hidden = false;
  }

  close() {
    this.el.hidden = true;
    this.ctx.onClose?.();
  }

  get isOpen() {
    return !this.el.hidden;
  }
}
