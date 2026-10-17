// Playwright "human" player: plays real games through real clicks/taps on projected cell positions.
// It only sees what a human sees (window.__bs exposes player-visible info only) and plays the human-proxy
// strategy. Recordings go to recordings/ (gitignored).
//
// Usage: npm run play -- [--games 1] [--device desktop|pixel7|iphone13|tablet] [--difficulty normal]
//   [--quality auto|low|medium|high|ultra] [--rotate] [--switch-quality] [--headed] [--speed 1] [--seed 1]
//   [--url http://localhost:5173] [--no-video] [--placement random|drag]
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, devices } from 'playwright';
import { createBot } from '../src/game/ai/index.js';
import { createRng } from '../src/game/rng.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const GAMES = Number(opt('games', 1));
const DEVICE = opt('device', 'desktop');
const DIFFICULTY = opt('difficulty', 'normal');
const QUALITY = opt('quality', 'auto');
const SPEED = Number(opt('speed', 1));
const SEED = Number(opt('seed', Date.now() % 100000));
const PLACEMENT = opt('placement', 'drag');
let URL_BASE = opt('url', '');

const DEVICES = {
  desktop: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  pixel7: devices['Pixel 7'],
  iphone13: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
  tablet: { ...devices['iPad (gen 7)'], defaultBrowserType: 'chromium' },
};
const device = DEVICES[DEVICE];
if (!device) throw new Error(`Unknown device ${DEVICE}`);
const touch = !!device.hasTouch;

let server;
async function ensureServer() {
  if (URL_BASE) return;
  URL_BASE = 'http://localhost:4173';
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' }); // not npx: kill() must reach vite
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL_BASE)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('vite preview did not start (run npm run build first)');
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = `recordings/${stamp}-${DEVICE}-${DIFFICULTY}-${QUALITY}`;
mkdirSync(outDir, { recursive: true });
const log = { seed: SEED, device: DEVICE, difficulty: DIFFICULTY, quality: QUALITY, speed: SPEED, games: [], errors: [], fps: [] };
const fail = (msg) => {
  log.errors.push(msg);
  console.error(`✗ ${msg}`);
};

await ensureServer();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !flag('headed'),
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  ...device,
  recordVideo: flag('no-video') ? undefined : { dir: outDir, size: device.viewport },
});
const pageCreatedAt = Date.now();
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') fail(`console error: ${m.text()}`);
});
page.on('pageerror', (e) => fail(`page error: ${e.message}`));

const q = new URLSearchParams({ e2e: '', seed: String(SEED), speed: String(SPEED) });
if (QUALITY !== 'auto') q.set('quality', QUALITY);
if (flag('recaudio')) q.set('recaudio', '');
await page.goto(`${URL_BASE}/?${q.toString().replace('e2e=', 'e2e')}`);
const bs = (expr) => page.evaluate(`window.__bs && (${expr})`);
const waitFor = async (expr, timeout = 30000) => {
  await page.waitForFunction(`!!(window.__bs && (${expr}))`, null, { timeout, polling: 50 });
};
let shotNo = 0;
const screenshot = (name) => page.screenshot({ path: `${outDir}/${String(shotNo).padStart(3, '0')}-${name}.png` });

async function tap(x, y) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function drag(from, to) {
  if (touch) {
    // Synthesize a touch drag through CDP (Playwright has no touch move helper).
    const cdp = await context.newCDPSession(page);
    const point = (p) => [{ x: p.x, y: p.y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
    for (let i = 1; i <= 12; i++) {
      const p = { x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(p) });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  }
}

async function clickButton(selector) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 15000 });
  if (touch) await el.tap();
  else await el.click();
}

/** Rotation checks: canvas fills the viewport, buffer = css x dpr, no page zoom, every cell is on-screen and picks itself. */
async function checkLayout(label, cells = true) {
  const vp = page.viewportSize();
  const cs = await bs('__bs.canvasSize');
  const scale = await page.evaluate('visualViewport ? visualViewport.scale : 1');
  if (cs.css[0] !== vp.width || cs.css[1] !== vp.height) fail(`${label}: canvas css ${cs.css} != viewport ${vp.width}x${vp.height}`);
  const wantW = Math.round(vp.width * cs.dpr);
  if (Math.abs(cs.buffer[0] - wantW) > 2) fail(`${label}: buffer ${cs.buffer[0]} != ${wantW}`);
  if (Math.abs(scale - 1) > 1e-3) fail(`${label}: visualViewport.scale = ${scale}`);
  if (!cells) return;
  const view = await bs('__bs.view');
  const sides = view.focused === 'both' ? ['player', 'enemy'] : [view.focused];
  for (const side of sides) {
    const bad = await page.evaluate(([s, w, h]) => {
      const out = [];
      for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
        const p = window.__bs.cellToClient(s, r, c);
        if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) out.push(`${s}${r},${c} off-screen`);
        const k = window.__bs.pick(p.x, p.y);
        if (!k || k.side !== s || k.r !== r || k.c !== c) out.push(`${s}${r},${c} picks ${JSON.stringify(k)}`);
      }
      return out;
    }, [side, vp.width, vp.height]);
    if (bad.length) fail(`${label}: ${bad.slice(0, 4).join('; ')}${bad.length > 4 ? ` (+${bad.length - 4})` : ''}`);
  }
}

async function rotateViewport(label) {
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await sleep(150);
  await settle();
  await checkLayout(`${label} after rotate to ${vp.height}x${vp.width}`);
}

async function pinchTest() {
  if (!touch) return;
  const cdp = await context.newCDPSession(page);
  const vp = page.viewportSize();
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 20, y: cy, id: 1 }, { x: cx + 20, y: cy, id: 2 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
      touchPoints: [{ x: cx - 20 - i * 15, y: cy, id: 1 }, { x: cx + 20 + i * 15, y: cy, id: 2 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await sleep(300);
  const scale = await page.evaluate('visualViewport ? visualViewport.scale : 1');
  if (Math.abs(scale - 1) > 1e-3) fail(`pinch zoomed the page (scale ${scale})`);
}

const settle = () => waitFor('__bs.view.settled', 10000).catch(() => fail('camera never settled'));

async function placeFleet() {
  await settle();
  if (PLACEMENT === 'random') {
    await clickButton('[data-k="randomize"]');
    return;
  }
  // Drag the destroyer somewhere legal, then tap the cruiser to rotate it.
  const fleetBefore = await bs('__bs.ownFleet');
  const ship = fleetBefore.find((s) => s.type === 'destroyer');
  const occupied = new Set();
  for (const s of fleetBefore) for (let k = 0; k < s.length; k++) occupied.add(`${s.horizontal ? s.r : s.r + k},${s.horizontal ? s.c + k : s.c}`);
  let target = null;
  for (let r = 0; r < 10 && !target; r++) for (let c = 0; c < 9 && !target; c++) {
    const cells = ship.horizontal ? [[r, c], [r, c + 1]] : [[r, c], [r + 1, c]];
    if (cells.every(([rr, cc]) => rr < 10 && cc < 10 && (!occupied.has(`${rr},${cc}`) ||
      (rr === ship.r && cc === ship.c) || (ship.horizontal ? rr === ship.r && cc === ship.c + 1 : rr === ship.r + 1 && cc === ship.c)))) {
      if (r !== ship.r || c !== ship.c) target = { r, c };
    }
  }
  if (target) {
    const from = await bs(`__bs.cellToClient('player', ${ship.r}, ${ship.c})`);
    const to = await bs(`__bs.cellToClient('player', ${target.r}, ${target.c})`);
    await drag(from, to);
    await sleep(200);
    const after = (await bs('__bs.ownFleet')).find((s) => s.type === 'destroyer');
    if (after.r !== target.r || after.c !== target.c) fail(`drag placement: destroyer at ${after.r},${after.c}, expected ${target.r},${target.c}`);
  }
  const cruiser = (await bs('__bs.ownFleet')).find((s) => s.type === 'cruiser');
  const p = await bs(`__bs.cellToClient('player', ${cruiser.r}, ${cruiser.c})`);
  await tap(p.x, p.y);
  await sleep(200);
  const rotated = (await bs('__bs.ownFleet')).find((s) => s.type === 'cruiser');
  if (rotated.horizontal === cruiser.horizontal) console.log('  (cruiser had no room to rotate — ok)');
}

async function playGame(g) {
  const rng = createRng(SEED + g);
  const bot = createBot('human-proxy', rng);
  const started = Date.now();
  await waitFor(`__bs.phase === 'placement'`);
  await sleep(300);
  if (flag('rotate')) await rotateViewport('placement');
  await placeFleet();
  await screenshot(`g${g}-placement`);
  await clickButton('[data-k="start"]');
  await waitFor(`__bs.phase === 'battle'`);
  await settle();
  await checkLayout('battle start');
  let myShots = 0;
  let paused = false;
  while (true) {
    await waitFor(`__bs.phase === 'over' || __bs.idle`, 60000);
    if ((await bs('__bs.phase')) === 'over') break;
    const i = bot.nextShot();
    const r = Math.floor(i / 10);
    const c = i % 10;
    const view = await bs('__bs.view');
    if (view.focused === 'player') {
      await clickButton('[data-k="tabs"] [data-v="enemy"]');
    }
    await settle();
    const before = (await bs('__bs.shots')).length;
    const p = await bs(`__bs.cellToClient('enemy', ${r}, ${c})`);
    await tap(p.x, p.y);
    if (touch) {
      await sleep(80);
      await tap(p.x, p.y); // second tap fires
    }
    await waitFor(`__bs.shots.length > ${before}`, 15000).catch(() => fail(`shot ${myShots + 1} at ${r},${c} did not register`));
    const shots = await bs('__bs.shots');
    const mine = shots.slice(before).filter((s) => s.by === 'player');
    if (mine.length !== 1) fail(`shot ${myShots + 1}: expected exactly one player result, got ${mine.length}`);
    else if (mine[0].r !== r || mine[0].c !== c) fail(`shot ${myShots + 1}: clicked ${r},${c} but fired at ${mine[0].r},${mine[0].c}`);
    const res = mine[0] ?? { result: 'miss' };
    bot.observe(i, res.result, res.type ?? undefined);
    myShots++;
    shotNo++;
    if (myShots % 12 === 0) await screenshot(`g${g}-shot${myShots}`);
    if (myShots % 5 === 0) log.fps.push(await bs('__bs.fps'));
    // hidden enemy ships must never feed the water
    const q2 = await bs('__bs.quality');
    const revealed = await bs('__bs.enemyRevealed');
    if (q2.hullsInWater > 5 + revealed) fail(`water has ${q2.hullsInWater} hulls but only 5 + ${revealed} ships are visible`);
    if (!paused && myShots === 8) {
      paused = true;
      await page.keyboard.press('p');
      await waitFor('__bs.paused');
      await screenshot(`g${g}-paused`);
      const a = await bs('__bs.audio');
      if (a.state === 'running') fail('audio still running while paused');
      await clickButton('[data-k="resume"]');
      await waitFor('!__bs.paused');
    }
    if (flag('rotate') && (myShots === 5 || myShots === 15)) await rotateViewport(`shot ${myShots}`);
    if (flag('switch-quality') && myShots === 24) await switchQuality();
    if (myShots > 100) {
      fail('game did not end after 100 shots');
      break;
    }
  }
  await sleep(1500 / SPEED);
  await screenshot(`g${g}-over`);
  await sleep(5000 / SPEED); // the last ship finishes going down
  await checkWrecks('game over');
  const stats = await bs('__bs.stats');
  const winner = await bs('__bs.winner');
  const shots = await bs('__bs.shots');
  const pHits = shots.filter((s) => s.by === 'player' && s.result !== 'miss').length;
  const aHits = shots.filter((s) => s.by === 'ai' && s.result !== 'miss').length;
  if (winner === 'player' && pHits !== 17) fail(`player won with ${pHits} hits`);
  if (winner === 'ai' && aHits !== 17) fail(`AI won with ${aHits} hits`);
  if (stats.player.hits !== pHits || stats.ai.hits !== aHits) fail('stats disagree with shot log');
  if (stats.player.shots !== shots.filter((s) => s.by === 'player').length) fail('player shot count mismatch');
  const audio = await bs('__bs.audio');
  const cues = audio.log;
  const count = (n) => cues.filter((x) => x === n).length;
  if (count('fire') < stats.player.shots) fail(`fire cues ${count('fire')} < player shots ${stats.player.shots}`);
  const outcomes = count('splash') + count('explosion');
  if (outcomes < stats.player.shots + stats.ai.shots) fail(`outcome cues ${outcomes} < shots ${stats.player.shots + stats.ai.shots}`);
  const result = { game: g, winner, playerShots: stats.player.shots, aiShots: stats.ai.shots, seconds: Math.round((Date.now() - started) / 1000),
    sunkCues: count('sunk') };
  log.games.push(result);
  console.log(`game ${g}: ${winner} won — player ${stats.player.shots} shots, AI ${stats.ai.shots} shots, ${result.seconds}s`);
}

/** Sunk ships follow the tier on screen: wrecks on the seabed on Ultra, none on any other tier. */
async function checkWrecks(label) {
  const q = await bs('__bs.quality');
  const want = q.current === 'ultra' ? q.sunk : 0;
  if (q.wrecks !== want) fail(`${label}: ${q.wrecks} wrecks drawn on ${q.current} with ${q.sunk} ships sunk (want ${want})`);
}

async function switchQuality() {
  for (const tier of ['low', 'ultra', 'low']) {
    await page.keyboard.press('p');
    await waitFor('__bs.paused');
    await clickButton('.overlay:not([hidden]) [data-k="settings"]');
    await clickButton(`[data-k="graphics"] [data-v="${tier}"]`);
    await waitFor(`__bs.quality.current === '${tier}' || ('${tier}' === 'ultra' && __bs.quality.current === 'high')`, 20000)
      .catch(() => fail(`tier did not switch to ${tier}`));
    await clickButton('[data-k="close"]');
    await clickButton('[data-k="resume"]');
    await waitFor('!__bs.paused');
    await sleep(600);
    await checkLayout(`after switching to ${tier}`);
    await checkWrecks(`after switching to ${tier}`);
    await screenshot(`tier-${tier}`);
  }
}

try {
  await waitFor('__bs.ready', 30000);
  await screenshot('title');
  await checkLayout('title', false);
  await pinchTest();
  await clickButton(`#difficulty [data-diff="${DIFFICULTY}"]`);
  const tierAtPlay = (await bs('__bs.quality')).current;
  await clickButton('#play');
  for (let g = 0; g < GAMES; g++) {
    await playGame(g);
    if (g < GAMES - 1) await clickButton('[data-k="again"]');
  }
  const errs = await bs('__bs.errors');
  for (const e of errs) fail(`in-page error: ${e}`);
  // Auto may change the tier after PLAY (it starts on High): the player must be told.
  const q = await bs('__bs.quality');
  if (QUALITY === 'auto' && !flag('switch-quality') && q.current !== tierAtPlay) {
    const toasts = await bs('__bs.toasts');
    if (!toasts.some((t) => t.startsWith('Graphics'))) fail(`tier went ${tierAtPlay} -> ${q.current} after PLAY without a toast`);
    else console.log(`  tier ${tierAtPlay} -> ${q.current} after PLAY, toast: "${toasts.find((t) => t.startsWith('Graphics'))}"`);
  }
} catch (e) {
  fail(`script error: ${e.message}`);
  await page.screenshot({ path: `${outDir}/error.png` }).catch(() => {});
} finally {
  log.quality = await bs('__bs.quality').catch(() => null);
  writeFileSync(`${outDir}/log.json`, JSON.stringify(log, null, 2));
  // Audio capture (?recaudio): the game taps its own output; Playwright video has no audio track.
  let audioOffset = null;
  if (flag('recaudio')) {
    const rec = await page.evaluate(async () => {
      const r = window.__bsAudioRecording;
      return r ? { data: await r.stop(), at: performance.timeOrigin + r.startedAt } : null;
    }).catch(() => null);
    if (rec) {
      writeFileSync(`${outDir}/audio.webm`, Buffer.from(rec.data, 'base64'));
      audioOffset = Math.max(0, (rec.at - pageCreatedAt) / 1000);
    } else fail('no audio recording (was sound unlocked?)');
  }
  const video = page.video();
  await context.close();
  await browser.close();
  server?.kill();
  if (video && audioOffset !== null) {
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', await video.path(), '-itsoffset', String(audioOffset),
        '-i', `${outDir}/audio.webm`, '-map', '0:v', '-map', '1:a', '-c', 'copy', `${outDir}/gameplay.webm`]);
      console.log(`muxed ${outDir}/gameplay.webm (audio offset ${audioOffset.toFixed(2)} s)`);
    } catch (e) {
      console.log(`(ffmpeg mux skipped: ${e.message.split('\n')[0]})`);
    }
  }
}
console.log(`recordings: ${outDir}`);
if (log.errors.length) {
  console.error(`${log.errors.length} problem(s)`);
  process.exit(1);
}
