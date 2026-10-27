// The film: records takes of the game played like a person, then cuts three videos from them (a YouTube video of
// about five minutes, a YouTube Short, and one for X), with captions, a thumbnail and a description.
//
//   npm run build && npm run film                        every take, then every cut
//   npm run film -- --cast 20                            first pick the battle's seed: a close win against Captain
//   npm run film -- --takes battle-ai,tiers              those takes again (into the latest film folder)
//   npm run film -- --cut youtube --from recordings/film-…   cut again from takes already there
//
// The friends take needs a p3p2 server: --server <portal URL> with P3P2_OWNER_PASSWORD (as `npm run friends`).
// Without it, that take is left out and the cuts do without it.
//
// Headed Chrome records its own tab (scripts/film/capture.mjs): the takes need this desktop for a quarter of an
// hour, with their windows in front. Everything goes to recordings/film-<stamp>/ (gitignored); nothing is uploaded.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { CUTS } from './film/edit.mjs';
import { TAKES } from './film/takes.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const list = (s, all) => (s === 'all' ? all : s === 'none' ? [] : s.split(','));

const latest = () => readdirSync('recordings').filter((d) => d.startsWith('film-')).sort().at(-1);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
// Some takes again, or only cuts: into the latest film. Every take: a new one.
const again = opt('takes', 'all') !== 'all' && latest();
const dir = opt('from', '') || (again ? `recordings/${latest()}` : `recordings/film-${stamp}`);
mkdirSync(dir, { recursive: true });
const takesFile = `${dir}/takes.json`;
const takes = existsSync(takesFile) ? JSON.parse(readFileSync(takesFile, 'utf8')) : {};
const save = () => writeFileSync(takesFile, JSON.stringify(takes, null, 2));

const SERVER = opt('server', '');
const PASSWORD = opt('password', process.env.P3P2_OWNER_PASSWORD ?? '');
const wantTakes = list(opt('takes', opt('from', '') ? 'none' : 'all'), Object.keys(TAKES))
  .filter((t) => t !== 'friends' || (SERVER && PASSWORD) || (console.warn('(no --server: the friends take is left out)'), false));
const wantCuts = list(opt('cut', 'all'), Object.keys(CUTS));

/** Casting: the seed of a close battle the player wins against Captain, from quick runs of `play.mjs`. */
function cast(n, from) {
  let best = null;
  for (let seed = from; seed < from + n; seed++) {
    const out = execFileSync(process.execPath, ['scripts/play.mjs', '--seed', String(seed), '--speed', '8', '--no-video', '--quality', 'low',
      '--difficulty', 'normal', '--url', URL_BASE], { encoding: 'utf8' });
    const m = /game 0: (\w+) won — player (\d+) shots \((\d+) hits\), AI (\d+) shots \((\d+) hits\)/.exec(out);
    if (!m) continue;
    const [, winner, shots, , , aiHits] = m;
    // A win, the AI close behind, and long enough to show things: the closer and the nearer 45 shots, the better.
    const score = winner === 'player' && +shots >= 35 && +shots <= 62 ? +aiHits * 10 - Math.abs(+shots - 45) : -1;
    console.log(`  seed ${seed}: ${winner} won in ${shots} shots, AI ${aiHits} hits${score > (best?.score ?? -1) ? '  ← best so far' : ''}`);
    if (score > (best?.score ?? -1)) best = { seed, score, shots: +shots, aiHits: +aiHits };
  }
  return best;
}

let URL_BASE = opt('url', '');
let server;
if (!URL_BASE) {
  URL_BASE = 'http://localhost:4173';
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(URL_BASE).then((r) => r.ok, () => false);
    if (!up) await sleep(250);
  }
  if (!up) throw new Error('vite preview did not start (run npm run build first)');
}

let failed = 0;
try {
  if (opt('cast', '')) {
    console.log('casting');
    const best = cast(Number(opt('cast')), Number(opt('seed', 1)));
    if (!best) throw new Error('no seed gave a win in casting: try more');
    takes.seed = best.seed;
    save();
    console.log(`  → seed ${best.seed}`);
  }
  const seed = Number(opt('seed', takes.seed ?? 4));
  takes.seed ??= seed;
  for (const name of wantTakes) {
    console.log(`take: ${name}`);
    try {
      takes[name] = await TAKES[name]({ url: `${URL_BASE}/?e2e`, dir, seed, server: SERVER, password: PASSWORD });
      save();
    } catch (e) {
      failed++;
      console.error(`✗ take ${name}: ${e.message}`);
    }
  }
  for (const name of wantCuts) {
    console.log(`cut: ${name}`);
    try {
      const out = await CUTS[name]({ dir, takes });
      console.log(`  → ${out}`);
    } catch (e) {
      failed++;
      console.error(`✗ cut ${name}: ${e.message}`);
    }
  }
} finally {
  server?.kill();
}
console.log(`film: ${dir}`);
if (failed) process.exit(1);
