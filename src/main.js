// Bootstrap: probe -> renderer -> first frame (bs-ready) -> menu; game flow wiring and the frame loop.
import './ui/styles.css';
import * as THREE from 'three';
import { DIFFICULTIES, TIERS, TIER_ORDER, TOTAL_SHIP_CELLS, cellName } from './config.js';
import { AudioFacade } from './audio/index.js';
import { Director } from './director.js';
import { idx } from './game/board.js';
import { Game, PHASE } from './game/game.js';
import { bindKeyboard } from './input/keyboard.js';
import { blockZoom } from './input/noZoom.js';
import { PointerInput } from './input/pointer.js';
import { BoardView, cellAt, cellCenter } from './render/board/boardView.js';
import { GameClock } from './render/clock.js';
import { Ripples } from './render/ocean/ripples.js';
import { swellHeight } from './render/ocean/swell.js';
import {
  collectInfo, FrameCostMeter, frameBudgetMs, loadStoredAuto, staticGuess, storageKey, storeAuto, TierBenchmark,
} from './render/quality.js';
import { Renderer } from './render/renderer.js';
import { FleetView } from './render/ships/fleetView.js';
import { Hud } from './ui/hud.js';
import { Overlays } from './ui/overlays.js';
import { loadSettings, saveSettings, SettingsPanel } from './ui/settings.js';
import { openCompany } from './net/company.js';

const params = new URLSearchParams(location.search);
const E2E = params.has('e2e');
const forcedTier = TIERS[params.get('quality')] ? params.get('quality') : null;
const seed = params.has('seed') ? Number(params.get('seed')) : undefined;

blockZoom();
const app = document.getElementById('app');
const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui');
const settings = loadSettings();
const audio = new AudioFacade();
audio.logEnabled = E2E;

const S = {
  phase: 'loading',
  paused: false,
  ready: false,
  aim: null,
  touchAim: null,
  selectedShip: 0,
  drag: null,
  autoTier: null,
  /** The tier the player was last shown: on the title or pause screen, or in a toast. */
  toldTier: null,
  tierSwitch: Promise.resolve(),
  fx: null,
  fxLoading: null,
  benchmark: null,
  shotLog: [],
  errors: [],
  /** The battle in a room (`net/play.js`), or null: against the AI. */
  room: null,
};
/** The room's side of things, once the page is up: `open()` shows the p3p2 panel. */
let company = null;

// ---------------------------------------------------------------- overlays first (they paint immediately)
const overlays = new Overlays(uiRoot, {
  play: () => startPlacement(),
  setDifficulty: (d) => setDifficulty(d),
  openSettings: () => settingsPanel.open(),
  toggleMute: () => toggleMute(),
  resume: () => setPaused(false),
  restart: () => {
    setPaused(false);
    startPlacement();
  },
  playAgain: () => (S.room ? S.room.menu().next() : startPlacement()),
  toMenu: () => (S.room ? overlays.showGameOver(null) : toTitle()),
  friends: () => {
    setPaused(false);
    company?.open();
  },
  room: (what) => {
    setPaused(false);
    S.room?.menu()[what]?.();
  },
});
overlays.setLoading(0.15, 'Checking your device…');
overlays.setDifficulty(settings.difficulty);

// ---------------------------------------------------------------- static probe (no network, < 5 ms)
function probeGl() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const info = collectInfo(gl);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return info;
}
const info = probeGl();
if (!info.webgl2) {
  overlays.showUnsupported();
  throw new Error('WebGL2 not available');
}
const guess = staticGuess(info);
const qKey = storageKey(info);
const stored = loadStoredAuto(qKey);
S.autoTier = stored?.tier ?? guess.guess;
const budget = frameBudgetMs(info);
const wantedTier = () => forcedTier ?? (settings.graphics === 'auto' ? S.autoTier : settings.graphics);

// ---------------------------------------------------------------- renderer + world
let r;
try {
  r = new Renderer(canvas, { antialias: guess.guess !== 'low' && !(info.mobile && devicePixelRatio > 2.5) });
} catch {
  overlays.showUnsupported();
  throw new Error('WebGL renderer failed');
}
const clock = new GameClock();
clock.speed = Number(params.get('speed') ?? 1) || 1;
const game = new Game(seed);
const ripples = new Ripples();
const board = new BoardView(r);
const fleet = new FleetView(r, ripples);
audio.setSettings(settings);

const startTier = (() => {
  const t = wantedTier();
  return t === 'ultra' ? 'high' : t; // Ultra is never on the critical path
})();
overlays.setLoading(0.35, 'Building the ocean…');
await r.setTier(startTier);
audio.setTier(r.tier);
fleet.setFleet('player', game.player);
fleet.setFleet('enemy', game.enemy);
overlays.setLoading(0.7, 'Compiling shaders…');

const hud = new Hud(uiRoot, {
  pause: () => setPaused(true),
  toggleMute: () => toggleMute(),
  randomize: () => randomizeFleet(),
  rotate: () => rotateSelected(),
  startBattle: () => startBattle(),
  fire: () => S.touchAim && fireAt(S.touchAim.r, S.touchAim.c),
  peek: (side) => setView(side),
  ask: (play) => S.room?.answer(play),
});

const settingsPanel = new SettingsPanel(uiRoot, {
  settings,
  detectedTier: () => S.autoTier,
  currentTier: () => r.tierName,
  ultraUnavailable: () => !guess.ultraAllowed,
  onChange: (s, what) => {
    if (what === 'graphics') applyGraphics();
    if (what === 'showFps') hud.setFps(s.showFps || params.has('stats'));
    if (what === 'sound') {
      audio.setSettings(s);
      updateSoundIcons();
    }
  },
});

const director = new Director({
  game, clock, r, board, fleet, hud,
  fx: () => S.fx,
  audio: () => audio,
  events: {
    onShot: (shot) => S.shotLog.push({ by: shot.by, r: shot.r, c: shot.c, result: shot.result, type: shot.type ?? null }),
    onResolved: () => {
      const close = (b) => b.shipsLeft() <= 1 || b.cellsLeft() <= 3;
      if (S.phase === 'battle') audio.setMusicState(close(game.player) || close(game.enemy) ? 'tension' : 'battle');
    },
    onView: (side) => setView(side),
    onPlayerTurn: () => {
      if (S.aim) board.setAim(S.aim, !game.enemy.isShot(S.aim.r, S.aim.c));
    },
    onGameOver: (winner, now) => {
      S.phase = 'over';
      game.stats.endedAt = now;
      audio.setMusicState(winner === 'player' ? 'victory' : 'defeat');
      hud.setStatus(winner === 'player' ? 'Victory!' : 'Defeat', winner === 'player' ? 'win' : 'bad');
      overlays.showGameOver({ winner, stats: game.stats, difficulty: game.difficulty, enemyShipsLeft: game.enemy.shipsLeft() });
    },
  },
});

// ---------------------------------------------------------------- layout
function hudMode() {
  return S.phase === 'placement' ? 'placement' : S.phase === 'battle' || S.phase === 'over' ? 'battle' : 'title';
}

function layout() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  const mode = hudMode();
  let insets = mode === 'title' ? { top: 0, bottom: 0, left: 0, right: 0 } : hud.insets(mode, false);
  r.resize(w, h, insets);
  if (mode === 'battle' && r.rig.layout === 'focus') {
    insets = hud.insets(mode, true);
    r.setInsets(insets);
  }
  hud.setTabs(mode === 'battle' && r.rig.layout === 'focus', r.rig.focused);
}
new ResizeObserver(() => layout()).observe(app);
visualViewport?.addEventListener('resize', () => layout());
addEventListener('orientationchange', () => setTimeout(layout, 50));

function setView(side) {
  r.rig.show(side);
  hud.setTabs(S.phase !== 'placement' && r.rig.layout === 'focus', r.rig.focused);
}

// ---------------------------------------------------------------- game flow
function setDifficulty(d) {
  settings.difficulty = d;
  saveSettings(settings);
  overlays.setDifficulty(d);
}

function loadFx() {
  S.fxLoading ??= import('./render/fx/index.js').then((m) => {
    S.fx = new m.Effects(r, ripples);
    return S.fx;
  });
  return S.fxLoading;
}

async function startPlacement() {
  audio.unlock();
  await loadFx();
  director.reset();
  overlays.showGameOver(null);
  overlays.showTitle(false);
  game.newGame(settings.difficulty);
  ripples.clear();
  fleet.setFleet('player', game.player);
  fleet.setFleet('enemy', game.enemy);
  board.reset();
  board.setVisible(true);
  S.phase = 'placement';
  S.selectedShip = 0;
  S.aim = null;
  S.touchAim = null;
  S.shotLog = [];
  hud.show(true);
  hud.setMode('placement');
  hud.setFireVisible(false);
  hud.setStatus('Place your fleet');
  hud.setFleets(game.player, game.enemy);
  audio.setMusicState('calm');
  layout();
  setView('player');
}

function startBattle() {
  if (S.phase !== 'placement') return;
  cancelDrag();
  if (S.room) return S.room.ready();
  game.startBattle(clock.time);
  S.phase = 'battle';
  hud.setMode('battle');
  hud.setFleets(game.player, game.enemy);
  hud.setStatus('Your turn — pick a target');
  audio.setMusicState('battle');
  audio.cue('ui');
  layout();
  setView('enemy');
}

function toTitle() {
  director.reset();
  overlays.showGameOver(null);
  S.phase = 'title';
  hud.show(false);
  board.setVisible(false);
  board.reset();
  game.newGame(settings.difficulty);
  fleet.setFleet('player', game.player);
  fleet.setFleet('enemy', game.enemy);
  game.phase = PHASE.TITLE;
  overlays.showTitle(true);
  audio.setMusicState('calm');
  layout();
  r.rig.show('title');
}

function setPaused(on) {
  // After a battle in a room the menu still has the next one, and leaving the table.
  if (on && (S.phase === 'title' || S.phase === 'loading' || (S.phase === 'over' && !S.room))) return;
  if (S.paused === on) return;
  S.paused = on;
  clock.paused = on;
  overlays.setRoom(S.room ? S.room.menu() : null);
  overlays.showPause(on);
  if (on) {
    S.toldTier = r.tierName;
    audio.suspend();
    cancelDrag();
  } else {
    audio.resume();
    settingsPanel.close();
  }
}

function toggleMute() {
  audio.unlock();
  settings.muted = !settings.muted;
  saveSettings(settings);
  audio.setSettings(settings);
  updateSoundIcons();
}

function updateSoundIcons() {
  const waiting = audio.state !== 'running' && audio.state !== 'suspended';
  overlays.setSound(settings.muted, waiting);
  hud.setMuted(settings.muted, waiting && !settings.muted);
}

async function fireAt(row, col) {
  if (S.room) {
    S.touchAim = null;
    hud.setFireVisible(false);
    if (!S.room.fire(row, col)) audio.cue('invalid');
    return;
  }
  if (S.phase !== 'battle' || S.paused) return;
  if (!game.canPlayerFire(row, col) || director.busy) return;
  S.touchAim = null;
  hud.setFireVisible(false);
  board.setAim(null);
  const ok = await director.playerFire(row, col);
  if (!ok) audio.cue('invalid');
}

// ---------------------------------------------------------------- placement
function shipAtCell(cell) {
  if (!cell || cell.side !== 'player') return -1;
  return game.player.grid[idx(cell.r, cell.c)];
}

function placementTarget(drag, cell) {
  const ship = game.player.ships[drag.index];
  const r0 = ship.horizontal ? cell.r : cell.r - drag.offset;
  const c0 = ship.horizontal ? cell.c - drag.offset : cell.c;
  const rr = Math.max(0, Math.min(ship.horizontal ? 9 : 10 - ship.length, r0));
  const cc = Math.max(0, Math.min(ship.horizontal ? 10 - ship.length : 9, c0));
  return { r: rr, c: cc, horizontal: ship.horizontal, length: ship.length };
}

function cancelDrag() {
  if (!S.drag) return;
  const v = fleet.view('player', S.drag.index);
  v.setPlacement(game.player.ships[S.drag.index]);
  v.lift = 0;
  board.setPlacement(null);
  S.drag = null;
}

function rotateShip(index, pivotCell) {
  const b = game.player;
  const ship = b.ships[index];
  const h = !ship.horizontal;
  const pivot = pivotCell ?? { r: ship.r, c: ship.c };
  const k0 = ship.horizontal ? pivot.c - ship.c : pivot.r - ship.r;
  for (const k of [k0, ...Array.from({ length: ship.length }, (_, i) => i)]) {
    const r0 = h ? pivot.r : pivot.r - k;
    const c0 = h ? pivot.c - k : pivot.c;
    if (b.moveShip(index, r0, c0, h)) {
      fleet.view('player', index).setPlacement(ship);
      audio.cue('rotate');
      return true;
    }
  }
  audio.cue('invalid');
  hud.toast('No room to rotate it here');
  return false;
}

function rotateSelected() {
  if (S.phase !== 'placement') return;
  rotateShip(S.selectedShip);
}

function randomizeFleet() {
  if (S.phase !== 'placement') return;
  cancelDrag();
  game.randomizePlayerFleet();
  game.player.ships.forEach((s, i) => fleet.view('player', i).setPlacement(s));
  audio.cue('shuffle');
}

const placement = {
  down(cell) {
    if (S.phase !== 'placement' || S.paused) return false;
    const index = shipAtCell(cell);
    if (index < 0) return false;
    const ship = game.player.ships[index];
    S.selectedShip = index;
    S.drag = { index, offset: ship.horizontal ? cell.c - ship.c : cell.r - ship.r, cell, target: null, valid: true };
    return true;
  },
  move(p) {
    const d = S.drag;
    if (!d) return;
    const cx = Math.max(-11, Math.min(-2, p.x));
    const cz = Math.max(-4.99, Math.min(4.99, p.z));
    const cell = { side: 'player', r: Math.floor(cz + 5), c: Math.floor(cx + 11.5) };
    const t = placementTarget(d, cell);
    d.target = t;
    d.valid = game.player.canPlace(t.length, t.r, t.c, t.horizontal, d.index);
    const v = fleet.view('player', d.index);
    v.setPlacement(t);
    v.lift = 0.18;
    board.setPlacement(t, d.valid);
  },
  up(dragged) {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    const v = fleet.view('player', d.index);
    v.lift = 0;
    board.setPlacement(null);
    if (!dragged) {
      rotateShip(d.index, d.cell);
      return;
    }
    if (d.target && d.valid) {
      game.player.moveShip(d.index, d.target.r, d.target.c, d.target.horizontal);
      audio.cue('snap');
    } else audio.cue('invalid');
    v.setPlacement(game.player.ships[d.index]);
  },
  cancel: () => cancelDrag(),
};

// ---------------------------------------------------------------- input
const canFireNow = () => (S.room ? S.room.canFire() : S.phase === 'battle' && !S.paused && !director.busy && game.turn === 'player');

const pointer = new PointerInput({
  canvas,
  camera: r.camera,
  enabled: () => !S.paused && (S.phase === 'placement' || S.phase === 'battle'),
  placement,
  onHover(cell) {
    if (S.phase === 'placement') {
      canvas.style.cursor = shipAtCell(cell) >= 0 ? 'grab' : 'default';
      return;
    }
    if (!canFireNow() || !cell || cell.side !== 'enemy') {
      board.setAim(null);
      canvas.style.cursor = 'default';
      return;
    }
    const valid = !game.enemy.isShot(cell.r, cell.c);
    if (!S.aim || S.aim.r !== cell.r || S.aim.c !== cell.c) audio.cue('tick');
    S.aim = cell;
    board.setAim(cell, valid);
    canvas.style.cursor = valid ? 'crosshair' : 'not-allowed';
  },
  onTap(cell, touch) {
    audio.unlock();
    if (!canFireNow() || cell.side !== 'enemy') return;
    if (game.enemy.isShot(cell.r, cell.c)) {
      audio.cue('invalid');
      return;
    }
    if (touch && !(S.touchAim && S.touchAim.r === cell.r && S.touchAim.c === cell.c)) {
      S.touchAim = cell;
      S.aim = cell;
      board.setAim(cell, true);
      hud.setFireVisible(true);
      hud.setStatus(`Aim: ${cellName(cell.r, cell.c)} — tap again or press FIRE`);
      audio.cue('tick');
      return;
    }
    fireAt(cell.r, cell.c);
  },
});

bindKeyboard({
  pauseToggle: () => {
    if (settingsPanel.isOpen) settingsPanel.close();
    else setPaused(!S.paused);
  },
  toggleMute: () => toggleMute(),
  rotate: () => rotateSelected(),
  moveAim(dr, dc) {
    if (!canFireNow()) return;
    const a = S.aim ?? { side: 'enemy', r: 4, c: 4 };
    S.aim = { side: 'enemy', r: Math.max(0, Math.min(9, a.r + dr)), c: Math.max(0, Math.min(9, a.c + dc)) };
    board.setAim(S.aim, !game.enemy.isShot(S.aim.r, S.aim.c));
    audio.cue('tick');
  },
  fireAim: () => {
    audio.unlock();
    if (S.phase === 'title' && S.ready) return startPlacement();
    if (S.aim && canFireNow()) fireAt(S.aim.r, S.aim.c);
  },
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // In a room there is no AI to hold back: the battle goes on, and this page still answers the shots at it.
    if (!S.room) setPaused(true);
    audio.suspend();
  } else if (!S.paused) audio.resume();
});
addEventListener('blur', () => {
  if (!E2E && !S.room) setPaused(true);
});
// Any first gesture unlocks audio (browser autoplay rules). Touch only grants activation on pointerup/touchend.
for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) addEventListener(type, () => {
  audio.unlock();
  setTimeout(updateSoundIcons, 300);
}, { capture: true });

// ---------------------------------------------------------------- graphics tiers
function switchTier(name) {
  S.tierSwitch = S.tierSwitch.then(async () => {
    if (r.tierName === name) return;
    await r.setTier(name);
    audio.setTier(r.tier);
    layout();
    settingsPanel.refresh();
    updateTierHint();
  }).catch((e) => console.error('Tier switch failed', e));
  return S.tierSwitch;
}

/**
 * Names the tier on screen on the title and pause screens. Auto starts on High and its benchmark often ends after
 * PLAY, on Ultra: whoever only saw "High" on the title is then told by a toast (`tellTier`).
 */
function updateTierHint() {
  const auto = settings.graphics === 'auto' && !forcedTier;
  overlays.setTierHint(r.tierName, auto, auto && !S.benchDone);
  if (overlays.titleOpen || overlays.pauseOpen) S.toldTier = r.tierName;
}

function tellTier() {
  if (overlays.titleOpen || r.tierName === S.toldTier) return;
  S.toldTier = r.tierName;
  hud.toast(`Graphics: ${TIERS[r.tierName].name} (auto)`);
}

function applyGraphics() {
  r.autoTier = settings.graphics === 'auto' && !forcedTier;
  if (r.autoTier && !S.benchmark && !S.benchDone) startBenchmark(true);
  switchTier(wantedTier());
}

function startBenchmark(quick) {
  const meter = new FrameCostMeter(r.gl);
  S.benchmark = {
    meter,
    bench: new TierBenchmark({
      start: r.tierName,
      budget,
      maxAuto: guess.maxAuto,
      quick,
      switchTier: (t) => switchTier(t),
      onDone: (tier, cost, log) => {
        S.autoTier = tier;
        S.benchDone = true;
        S.benchLog = log;
        storeAuto(qKey, tier, cost);
        meter.dispose();
        S.benchmark = null;
        S.afterBenchmark?.();
        // The tier it settled on may still be switching in.
        S.tierSwitch.then(() => {
          updateTierHint();
          tellTier();
          settingsPanel.refresh();
        });
      },
    }),
  };
}

// ---------------------------------------------------------------- frame loop
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
let fpsText = '';
function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const dt = clock.tick(realDt);
  const t = clock.time;
  ripples.prune(t);
  board.update(realDt);
  fleet.update(dt, t);
  S.fx?.update(dt, t);
  audio.tick(S.fx && (S.phase === 'battle' || S.phase === 'over') ? S.fx.fireCounts() : null);
  r.rig.update(realDt, now / 1000);
  const bm = S.benchmark;
  if (bm && !bm.bench.busy) bm.meter.begin();
  r.render(t, dt);
  if (bm && !bm.bench.busy) bm.bench.sample(bm.meter.end());
  if (S.ready && !document.hidden) {
    const change = r.trackFrame(realDt * 1000, budget);
    if (change === 'down' && r.autoTier) {
      const lower = TIER_ORDER[TIER_ORDER.indexOf(r.tierName) - 1];
      if (lower) {
        S.autoTier = lower;
        S.toldTier = lower;
        switchTier(lower);
        hud.toast('Graphics lowered to keep the game smooth');
      }
    }
  }
  fpsAcc += realDt;
  fpsFrames++;
  if (fpsAcc >= 0.5) {
    const st = r.stats();
    fpsText = `${Math.round(fpsFrames / fpsAcc)} fps · ${TIERS[st.tier]?.name ?? ''} · ${st.dpr.toFixed(2)}x`;
    if (params.has('stats')) fpsText += ` · ${st.calls} calls · ${(st.triangles / 1000).toFixed(0)}k tris`;
    S.fps = Math.round(fpsFrames / fpsAcc);
    fpsAcc = 0;
    fpsFrames = 0;
    hud.setFps(settings.showFps || params.has('stats'), fpsText);
  }
}

// ---------------------------------------------------------------- go
layout();
r.rig.show('title', true);
overlays.showTitle(true);
S.phase = 'title';
requestAnimationFrame((t0) => {
  last = t0;
  frame(t0);
  requestAnimationFrame(() => {
    performance.mark('bs-ready');
    S.ready = true;
    overlays.setLoading(1);
    overlays.showMenu();
    r.autoTier = settings.graphics === 'auto' && !forcedTier;
    updateTierHint();
    updateSoundIcons();
    hud.setFps(settings.showFps || params.has('stats'), '');
    // Friends: a room on a p3p2 server (net/company.js). Only now, so that an invite never holds up the first frame.
    company = openCompany({
      game, board, fleet, hud, overlays, r, clock, ripples, S, director, audio,
      fx: () => S.fx,
      loadFx,
      setView,
      layout,
      toTitle,
    });
    // Deferred work first, then let the page settle before benchmarking so the numbers aren't noisy.
    // Audio cue rendering waits for the benchmark (sound can't play before the first tap anyway).
    const loadAudio = () => audio.load().then(() => updateSoundIcons());
    loadFx().then(() => setTimeout(() => {
      if (r.autoTier) {
        startBenchmark(!!stored);
        S.afterBenchmark = loadAudio;
        setTimeout(loadAudio, 6000);
      } else {
        loadAudio();
        if (wantedTier() !== r.tierName) switchTier(wantedTier());
      }
    }, 400));
  });
});

audio.setSwell((x, z) => swellHeight(x, z, clock.time));
{
  const pv = new THREE.Vector3();
  audio.setPanner((x) => pv.set(x, 0, r.rig.cur.target.z).project(r.camera).x * 0.8);
}

// ---------------------------------------------------------------- e2e hook (player-visible info only)
// Also in a dev build: a page opened from an invite link has no `?e2e` in its address.
if (E2E || import.meta.env.DEV) {
  addEventListener('error', (e) => S.errors.push(String(e.message)));
  const v = cellCenter('enemy', 0, 0);
  const toasts = [];
  const toast = hud.toast.bind(hud);
  hud.toast = (text, ms) => {
    toasts.push(text);
    toast(text, ms);
  };
  window.__bs = {
    get phase() {
      return S.phase;
    },
    get turn() {
      return game.turn;
    },
    get idle() {
      return S.phase === 'battle' ? canFireNow() : S.phase !== 'loading';
    },
    get ready() {
      return S.ready && !!S.fx;
    },
    get paused() {
      return S.paused;
    },
    get fps() {
      return S.fps ?? 0;
    },
    /** Shot results the player can see (their own shots and the enemy's shots at them). */
    get shots() {
      return S.shotLog.map((s) => ({ ...s }));
    },
    get ownFleet() {
      return game.player.ships.map((s) => ({ type: s.type, r: s.r, c: s.c, horizontal: s.horizontal, length: s.length, sunk: s.sunk }));
    },
    /** Where the hits on this page's own ships are drawn: the cell under each scorch on a hull, as [row, col]. */
    get hullHits() {
      return fleet.views.player.flatMap((sv) =>
        sv.hits.map((x) => {
          const p = sv.localToWorld(new THREE.Vector3(x, 0, 0));
          const at = cellAt(p.x, p.z);
          return at && [at.r, at.c];
        }));
    },
    get winner() {
      return game.winner;
    },
    get stats() {
      return structuredClone(game.stats);
    },
    get enemyCellsLeft() {
      return TOTAL_SHIP_CELLS - (game.stats?.player.hits ?? 0);
    },
    cellToClient(boardSide, row, col) {
      const p = cellCenter(boardSide, row, col, v);
      p.y = 0;
      p.project(r.camera);
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    },
    get view() {
      return { layout: r.rig.layout, focused: r.rig.focused, settled: r.rig.settled };
    },
    get canvasSize() {
      return { css: [canvas.clientWidth, canvas.clientHeight], buffer: [canvas.width, canvas.height], dpr: r.pixelRatio,
        maxDpr: r.maxDpr };
    },
    get audio() {
      return { ...audio.stats(), log: audio.log.map((l) => l.name), muted: settings.muted };
    },
    get quality() {
      return { detected: S.autoTier, current: r.tierName, auto: r.autoTier, guess, info: { gpu: info.gpu, mobile: info.mobile },
        benchmark: S.benchLog ?? null, benchmarking: !!S.benchmark, hullsInWater: fleet.hullCount ?? 0,
        visibleShips: fleet.all().filter((x) => x.footprint()).length,
        sunk: fleet.all().filter((x) => x.sunk).length, wrecks: fleet.all().filter((x) => x.sunk && x.group.visible).length };
    },
    /** Every toast so far, oldest first. */
    toasts,
    get errors() {
      return [...S.errors];
    },
    /** Which cell is under a client point (pure picking geometry, for the rotation test). */
    pick(x, y) {
      return pointer.cellAtClient(x, y);
    },
    get enemyRevealed() {
      return fleet.views.enemy.filter((x) => x.revealed).length;
    },
    setSpeed(x) {
      clock.speed = x;
    },
    /** Perf scenario (visuals only, own fleet): fires on six cells, explosions and one sinking. */
    perfScene() {
      if (!S.fx) return false;
      const views = fleet.views.player;
      let n = 0;
      for (const v of views) {
        for (let k = 0; k < v.length && n < 6; k++, n++) {
          const local = new THREE.Vector3(v.cellLocalX(k), 0.3, 0);
          S.fx.addFire((out) => v.localToWorld(local, out), 1, 'player');
          S.fx.explosion(v.localToWorld(local.clone()), 1);
        }
      }
      const victim = views.find((v) => v.type === 'battleship') ?? views[0];
      S.fx.sink(victim, !!r.tier?.ultra);
      return true;
    },
    /** The frame-time monitor sees `ms` as the interval of the next `frames` frames (flash check: forces a step). */
    feedMonitor(ms, frames) {
      let left = frames;
      r.trackFrame = (_, budget) => {
        if (--left <= 0) delete r.trackFrame;
        return Renderer.prototype.trackFrame.call(r, ms, budget);
      };
    },
    difficulties: Object.keys(DIFFICULTIES),
    /** For the film (`npm run film`): the camera, the resolution and the sound, while a take is recorded. */
    film: {
      /** The render resolution stays at 100%: recording costs a few frames, which must not step it down. */
      holdResolution() {
        r.trackFrame = () => null;
        r.dprScale = 1;
        r.resize(r.cssWidth, r.cssHeight);
      },
      /**
       * Holds the camera on a cell of a board ({ side, r, c }) or a point ({ x, z }), from `dist` away, `pitch` and
       * `yaw` in degrees, turning `spin` degrees a second; eased slowly from where it is.
       */
      look({ side, r: row, c: col, x = 0, z = 0, y = 0, dist = 12, pitch = 30, yaw = 0, spin = 0 }) {
        const p = side ? cellCenter(side, row, col) : new THREE.Vector3(x, y, z);
        const rad = THREE.MathUtils.degToRad;
        r.rig.setFilm({ target: [p.x, y, p.z], dist, pitch: rad(pitch), yaw: rad(yaw), spin: rad(spin) });
      },
      /** The game's own framing again. */
      release() {
        r.rig.setFilm(null);
      },
      get looking() {
        return !!r.rig.film;
      },
      /** The game's sound as a stereo MediaStream, once sound is on; null before. */
      audioStream() {
        return audio.engine?.tap() ?? null;
      },
    },
  };
}

// Dev-only handle for visual iteration (stripped from production builds).
if (import.meta.env.DEV) window.__dbg = { game, r, fleet, board, director, clock, ripples, S, audio, startPlacement, startBattle };
