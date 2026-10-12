// Headless balance simulation: bots (human stand-ins) vs each AI difficulty, human always moves first.
// Usage: node scripts/sim.mjs [--games 10000] [--seed 1] [--param hard.temperature=0.3,...]
import { DIFFICULTIES, TOTAL_SHIP_CELLS } from '../src/config.js';
import { createAI, createBot } from '../src/game/ai/index.js';
import { Board } from '../src/game/board.js';
import { placeDiscreetFleet, placeRandomFleet } from '../src/game/fleet.js';
import { createRng } from '../src/game/rng.js';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const GAMES = Number(arg('games', 10000));
const SEED = Number(arg('seed', 1));
const BOTS = (arg('bots', 'random,novice,human-proxy,expert')).split(',');
const LEVELS = (arg('levels', 'easy,normal,hard')).split(',');
for (const kv of (arg('param', '') || '').split(',').filter(Boolean)) {
  const [key, value] = kv.split('=');
  const [level, name] = key.split('.');
  DIFFICULTIES[level][name] = Number(value);
}

/** Cumulative hits after each shot until the fleet is sunk. */
function hitTrace(shooter, board) {
  const trace = [];
  let hits = 0;
  while (!board.allSunk()) {
    const i = shooter.nextShot();
    const res = board.receiveShot(Math.floor(i / 10), i % 10);
    shooter.observe(i, res.result, res.type);
    if (res.result !== 'miss') hits++;
    trace.push(hits);
  }
  return trace;
}

const pct = (x) => `${(100 * x).toFixed(1)}%`;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const rng = createRng(SEED);
const results = {};
console.log(`Balance sim: ${GAMES} games per pairing, human moves first. Params: ${JSON.stringify(DIFFICULTIES)}\n`);
console.log('bot          vs AI      win     human shots (mean/med)   AI shots (mean/med)   close games');
for (const bot of BOTS) {
  for (const level of LEVELS) {
    let wins = 0;
    let close = 0;
    const humanShots = [];
    const aiShots = [];
    for (let g = 0; g < GAMES; g++) {
      const enemy = level === 'hard' ? placeDiscreetFleet(new Board(), rng) : placeRandomFleet(new Board(), rng);
      const player = placeRandomFleet(new Board(), rng);
      const h = hitTrace(createBot(bot, rng.fork()), enemy);
      const a = hitTrace(createAI(level, rng.fork()), player);
      humanShots.push(h.length);
      aiShots.push(a.length);
      const humanWins = h.length <= a.length;
      if (humanWins) wins++;
      // Loser's opponent cells still unfound when the game ended.
      const left = humanWins ? TOTAL_SHIP_CELLS - (a[h.length - 2] ?? 0) : TOTAL_SHIP_CELLS - h[a.length - 1];
      if (left <= 3) close++;
    }
    const mean = (x) => (x.reduce((s, v) => s + v, 0) / x.length).toFixed(1);
    results[`${bot}/${level}`] = { win: wins / GAMES, close: close / GAMES, h: mean(humanShots), a: mean(aiShots) };
    console.log(
      `${bot.padEnd(12)} ${level.padEnd(8)} ${pct(wins / GAMES).padStart(6)}   ` +
        `${mean(humanShots).padStart(5)} / ${String(median(humanShots)).padStart(3)}            ` +
        `${mean(aiShots).padStart(5)} / ${String(median(aiShots)).padStart(3)}         ${pct(close / GAMES)}`,
    );
  }
}

if (args.includes('--hist')) {
  for (const level of LEVELS) {
    const shots = [];
    for (let g = 0; g < 2000; g++) shots.push(hitTrace(createAI(level, rng.fork()), placeRandomFleet(new Board(), rng)).length);
    const bins = new Map();
    for (const s of shots) bins.set(Math.floor(s / 5) * 5, (bins.get(Math.floor(s / 5) * 5) ?? 0) + 1);
    console.log(`\n${level} shots-to-win histogram`);
    for (const k of [...bins.keys()].sort((x, y) => x - y)) {
      console.log(`${String(k).padStart(3)}-${String(k + 4).padEnd(3)} ${'#'.repeat(Math.round(bins.get(k) / 20))}`);
    }
  }
}

const target = { easy: [0.8, 0.9], normal: [0.55, 0.65], hard: [0.25, 0.35] };
if (BOTS.includes('human-proxy')) {
  console.log('\nTargets for human-proxy (plan §4.3):');
  for (const level of LEVELS) {
    const r = results[`human-proxy/${level}`];
    const [lo, hi] = target[level];
    const ok = r.win >= lo - 0.02 && r.win <= hi + 0.02;
    console.log(`  ${level.padEnd(7)} ${pct(r.win)} (target ${pct(lo)}–${pct(hi)}) ${ok ? 'OK' : 'OFF'}`);
  }
}
