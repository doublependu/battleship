// The takes: what each recording shows, played like a person (`lib/human.mjs`) with the same strategy as
// `play.mjs`, so that a seed chosen by casting plays the same game here. Each take writes markers (what happened,
// and when, in seconds from the recording's first frame), which the cut is made from (`edit.mjs`).
import { setTimeout as sleep } from 'node:timers/promises';
import { createBot } from '../../src/game/ai/index.js';
import { createRng } from '../../src/game/rng.js';
import { createHuman } from '../lib/human.mjs';
import { frameCheck, openStudio, openWindow, record, soundOn } from './capture.mjs';

const DESKTOP = { width: 1920, height: 1080, scale: 1 };
/** A phone's screen: 500×889 page units at 2.16 is 1080×1920 pixels (Chrome's windows are at least 500 wide). */
const PHONE = { width: 500, height: 889, scale: 2.16, touch: true };
const PHONE_SIDEWAYS = { width: 889, height: 500, scale: 2.16, touch: true };

const bs = (page, expr) => page.evaluate(`window.__bs && (${expr})`);
const waitFor = (page, expr, timeout = 60000) => page.waitForFunction(`!!(window.__bs && (${expr}))`, null, { timeout, polling: 50 });
const settle = (page) => waitFor(page, '__bs.view.settled', 15000).catch(() => {});

/** A window with the game, sound on, Ultra (or the tier asked for) in place, the resolution held. */
async function stage(browser, size, url, { quality = 'ultra' } = {}) {
  const w = await openWindow(browser, size);
  await w.page.goto(url);
  await waitFor(w.page, '__bs.ready');
  await bs(w.page, '__bs.film.holdResolution()');
  if (quality) await waitFor(w.page, `__bs.quality.current === '${quality}'`, 30000);
  await soundOn(w.page);
  await sleep(1500);
  return w;
}

/** Recording, with markers: `mark(kind, data)` notes what happened now. */
async function rolling(page, file) {
  const rec = await record(page, file);
  const markers = [];
  const mark = (kind, data = {}) => {
    const at = (Date.now() - rec.info.startedAt) / 1000;
    markers.push({ at: Math.round(at * 100) / 100, kind, ...data });
    console.log(`    ${at.toFixed(1).padStart(6)} s  ${kind}${data.type ? ` ${data.type}` : ''}`);
  };
  return {
    mark,
    markers,
    async cut(extra = {}) {
      const done = await rec.stop();
      const check = frameCheck(done.file);
      console.log(`    ${check.frames} frames, ${check.fps.toFixed(1)} fps, ${check.gaps.length} gaps over 34 ms` +
        (check.gaps.length ? ` (longest ${Math.max(...check.gaps.map((g) => g.ms))} ms)` : ''));
      return { file: done.file, startedAt: done.startedAt, size: done.size, markers, check: { fps: check.fps, gaps: check.gaps, slow: check.slow }, ...extra };
    },
  };
}

/** Placement as `play.mjs` does it (so that a cast seed plays the same game): the destroyer dragged, the cruiser turned. */
async function place(page, human) {
  await settle(page);
  await human.think('look');
  const fleet = await bs(page, '__bs.ownFleet');
  const ship = fleet.find((s) => s.type === 'destroyer');
  const occupied = new Set();
  for (const s of fleet) for (let k = 0; k < s.length; k++) occupied.add(`${s.horizontal ? s.r : s.r + k},${s.horizontal ? s.c + k : s.c}`);
  let target = null;
  for (let r = 0; r < 10 && !target; r++) for (let c = 0; c < 9 && !target; c++) {
    const cells = ship.horizontal ? [[r, c], [r, c + 1]] : [[r, c], [r + 1, c]];
    if (cells.every(([rr, cc]) => rr < 10 && cc < 10 && (!occupied.has(`${rr},${cc}`) ||
      (rr === ship.r && cc === ship.c) || (ship.horizontal ? rr === ship.r && cc === ship.c + 1 : rr === ship.r + 1 && cc === ship.c)))) {
      if (r !== ship.r || c !== ship.c) target = { r, c };
    }
  }
  if (target) {
    const from = await bs(page, `__bs.cellToClient('player', ${ship.r}, ${ship.c})`);
    const to = await bs(page, `__bs.cellToClient('player', ${target.r}, ${target.c})`);
    await human.drag(from, to);
    await sleep(500);
  }
  const cruiser = (await bs(page, '__bs.ownFleet')).find((s) => s.type === 'cruiser');
  const p = await bs(page, `__bs.cellToClient('player', ${cruiser.r}, ${cruiser.c})`);
  await human.think('menu');
  await human.press(p.x, p.y);
  await sleep(700);
}

/**
 * A battle against the AI, from the title: difficulty, PLAY, placement, then shot after shot until it is over.
 * Close-ups (when `closeups`): a ship of theirs going down, a hit on one of ours, the wrecks on the seabed.
 */
async function battle(page, human, { seed, touch, mark, closeups = true, maxShots = 200, difficulty = 'normal' }) {
  const bot = createBot('human-proxy', createRng(seed));
  await human.think('look');
  await human.pressElement(`#difficulty [data-diff="${difficulty}"]`);
  await human.think('menu');
  await human.pressElement('#play');
  mark('placement');
  await waitFor(page, `__bs.phase === 'placement'`);
  await place(page, human);
  await human.think('menu');
  await human.pressElement('[data-k="start"]');
  await waitFor(page, `__bs.phase === 'battle'`);
  mark('battle');
  let seen = 0;
  let sunk = 0;
  let ourHits = 0;
  let wreckShown = false;
  const close = async (shot, ms) => {
    await bs(page, `__bs.film.look(${JSON.stringify(shot)})`);
    await sleep(ms);
    await bs(page, '__bs.film.release()');
  };
  /** What the shot log has that the markers do not yet. */
  const news = async () => {
    const shots = await bs(page, '__bs.shots');
    const out = shots.slice(seen);
    seen = shots.length;
    for (const s of out) mark(s.result, { by: s.by, r: s.r, c: s.c, type: s.type });
    return out;
  };
  for (let n = 0; n < maxShots; n++) {
    await waitFor(page, `__bs.phase === 'over' || __bs.idle`, 90000);
    // The AI's shots since ours: a first hit on one of our ships, close.
    for (const s of await news()) {
      if (closeups && s.by === 'ai' && s.result !== 'miss' && ourHits < 2 && touch === false) {
        ourHits++;
        mark('closeup', { what: 'our ship hit' });
        await close({ side: 'player', r: s.r, c: s.c, dist: 7, pitch: 24, yaw: -25, spin: 3 }, 4200);
      }
    }
    if ((await bs(page, '__bs.phase')) === 'over') break;
    await settle(page);
    const i = bot.nextShot();
    const r = Math.floor(i / 10);
    const c = i % 10;
    const view = await bs(page, '__bs.view');
    if (view.focused === 'player') {
      await human.think('look');
      await human.pressElement('[data-k="tabs"] [data-v="enemy"]');
      await settle(page);
    }
    const last = (await bs(page, '__bs.shots')).filter((s) => s.by === 'player').at(-1);
    await human.think(last?.result === 'hit' ? 'hit' : 'aim');
    const p = await bs(page, `__bs.cellToClient('enemy', ${r}, ${c})`);
    if (!touch && (n % 4) === 1) {
      const q = await bs(page, `__bs.cellToClient('enemy', ${Math.min(9, r + 1)}, ${Math.max(0, c - 1)})`);
      await human.hesitate([q]);
    }
    const before = (await bs(page, '__bs.shots')).length;
    await human.press(p.x, p.y);
    if (touch) {
      await sleep(220);
      await human.press(p.x, p.y); // the second tap fires
    }
    await waitFor(page, `__bs.shots.length > ${before}`, 20000);
    const mine = (await news()).find((s) => s.by === 'player');
    if (!mine) continue;
    bot.observe(i, mine.result, mine.type ?? undefined);
    if (closeups && mine.result === 'sunk') {
      sunk++;
      // Their ship comes up where it was, burns out and goes down: close, turning slowly round it.
      mark('closeup', { what: 'their ship sinks', type: mine.type });
      await close({ side: 'enemy', r, c, dist: touch ? 9 : 8, pitch: 22, yaw: 30, spin: -5 }, sunk === 5 ? 6500 : 5200);
      if (sunk === 3 && !wreckShown) {
        // On Ultra the wrecks stay on the seabed, under the moving water.
        wreckShown = true;
        mark('closeup', { what: 'wrecks on the seabed' });
        await close({ side: 'enemy', r, c, dist: 7, pitch: 62, yaw: 10, spin: 2 }, 4500);
      }
    }
  }
  await waitFor(page, `__bs.phase === 'over'`, 30000).catch(() => {});
  await news();
  mark('over', { winner: await bs(page, '__bs.winner') });
}

/** The title screen and the sea: the opening, and backgrounds. */
async function sea({ url, dir }) {
  const browser = await openStudio();
  try {
    const { page } = await stage(browser, DESKTOP, `${url}&quality=ultra`);
    const take = await rolling(page, `${dir}/sea.mp4`);
    take.mark('title');
    await sleep(9000);
    // The sea alone, without the menus: low over the water, turning.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('#title, #fork, #version, p3p2-panel')) el.style.visibility = 'hidden';
    });
    take.mark('clean');
    await bs(page, '__bs.film.look({ x: 0, z: -4, dist: 20, pitch: 13, yaw: -30, spin: 3 })');
    await sleep(12000);
    await bs(page, '__bs.film.look({ x: -8, z: 0, dist: 11, pitch: 21, yaw: 40, spin: -2 })');
    take.mark('clean-close');
    await sleep(9000);
    await bs(page, '__bs.film.release()');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('#title, #fork, #version, p3p2-panel')) el.style.visibility = '';
    });
    take.mark('title-again');
    await sleep(6000);
    return await take.cut({ name: 'sea' });
  } finally {
    await browser.close();
  }
}

/** A whole battle against the AI (Captain), on Ultra, on a desktop screen. */
async function battleAi({ url, dir, seed }) {
  const browser = await openStudio();
  try {
    const { page } = await stage(browser, DESKTOP, `${url}&seed=${seed}&quality=ultra`);
    const human = createHuman(page, { rng: createRng(seed ^ 0x5eed).next });
    const take = await rolling(page, `${dir}/battle-ai.mp4`);
    take.mark('title');
    await battle(page, human, { seed, touch: false, mark: take.mark });
    await sleep(7000); // the end screen and its music
    take.mark('end-card');
    await sleep(3000);
    return await take.cut({ name: 'battle-ai', seed });
  } finally {
    await browser.close();
  }
}

/** The graphics tiers, mid-battle with fires burning: Low, Medium, High, Ultra from the settings. */
async function tiers({ url, dir, seed }) {
  const browser = await openStudio();
  try {
    const { page } = await stage(browser, DESKTOP, `${url}&seed=${seed + 1}`, { quality: null });
    const human = createHuman(page, { rng: createRng(seed).next, pace: 0.7 });
    // Into a battle quickly, at speed, until some ships burn on both sides; then at a normal pace.
    await bs(page, '__bs.setSpeed(4)');
    await page.click('#play');
    await waitFor(page, `__bs.phase === 'placement'`);
    await page.click('[data-k="start"]');
    await waitFor(page, `__bs.phase === 'battle'`);
    const bot = createBot('human-proxy', createRng(seed + 1));
    for (let n = 0; n < 60; n++) {
      await waitFor(page, `__bs.phase === 'over' || __bs.idle`);
      const shots = await bs(page, '__bs.shots');
      const hits = (by) => shots.filter((s) => s.by === by && s.result !== 'miss').length;
      if (hits('player') >= 6 && hits('ai') >= 4) break;
      await settle(page);
      const i = bot.nextShot();
      const p = await bs(page, `__bs.cellToClient('enemy', ${Math.floor(i / 10)}, ${i % 10})`);
      const before = shots.length;
      await page.mouse.click(p.x, p.y);
      await waitFor(page, `__bs.shots.length > ${before}`);
      const mine = (await bs(page, '__bs.shots')).slice(before).find((s) => s.by === 'player');
      if (mine) bot.observe(i, mine.result, mine.type ?? undefined);
    }
    await waitFor(page, '__bs.idle');
    await bs(page, '__bs.setSpeed(1)');
    await sleep(1500);
    const take = await rolling(page, `${dir}/tiers.mp4`);
    for (const tier of ['low', 'medium', 'high', 'ultra']) {
      await human.think('look');
      await human.pressElement('[data-k="pause"]');
      await human.pressElement('.overlay:not([hidden]) [data-k="settings"]');
      await human.think('menu');
      await human.pressElement(`[data-k="graphics"] [data-v="${tier}"]`);
      await waitFor(page, `__bs.quality.current === '${tier}'`, 30000);
      await sleep(600);
      await human.pressElement('[data-k="close"]');
      await human.pressElement('[data-k="resume"]');
      await waitFor(page, '!__bs.paused');
      take.mark(`tier-${tier}`);
      await human.moveTo(1900, 1060);
      await sleep(tier === 'ultra' ? 4000 : 5500);
      if (tier === 'ultra') {
        take.mark('closeup', { what: 'ultra water' });
        await bs(page, `__bs.film.look({ side: 'player', r: 5, c: 5, dist: 10, pitch: 35, yaw: -20, spin: 4 })`);
        await sleep(6000);
        await bs(page, '__bs.film.release()');
        await sleep(2000);
      }
    }
    return await take.cut({ name: 'tiers' });
  } finally {
    await browser.close();
  }
}

/** A battle on a phone's screen, upright: for the Short, and the phones in the long video. */
async function phone({ url, dir, seed }) {
  const browser = await openStudio({ scale: PHONE.scale });
  try {
    const { page, crop } = await stage(browser, PHONE, `${url}&seed=${seed}&quality=ultra`);
    const human = createHuman(page, { touch: true, rng: createRng(seed ^ 0x5eed).next, pace: 0.8 });
    const take = await rolling(page, `${dir}/phone.mp4`);
    take.mark('title');
    await battle(page, human, { seed, touch: true, mark: take.mark });
    await sleep(8000);
    take.mark('end-card');
    return await take.cut({ name: 'phone', crop, seed });
  } finally {
    await browser.close();
  }
}

/** A phone on its side: placement and a few shots. */
async function phoneSideways({ url, dir, seed }) {
  const browser = await openStudio({ scale: PHONE_SIDEWAYS.scale });
  try {
    const { page, crop } = await stage(browser, PHONE_SIDEWAYS, `${url}&seed=${seed + 2}&quality=ultra`);
    const human = createHuman(page, { touch: true, rng: createRng(seed + 2).next, pace: 0.8 });
    const take = await rolling(page, `${dir}/phone-sideways.mp4`);
    take.mark('title');
    await battle(page, human, { seed: seed + 2, touch: true, mark: take.mark, closeups: false, maxShots: 9 });
    await sleep(2000);
    return await take.cut({ name: 'phone-sideways', crop });
  } finally {
    await browser.close();
  }
}

/** The owner's side, in the server's portal: a room for the game's address, and its invite link. */
async function createRoom(portalUrl, password, gameUrl) {
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  try {
    const portal = await b.newPage();
    await portal.goto(`${portalUrl.replace(/\/+$/, '')}/login`);
    await portal.getByLabel('Password').fill(password);
    await portal.getByRole('button', { name: 'Log in' }).click();
    await portal.getByLabel('Game URL').fill(gameUrl);
    const name = 'Friday battles';
    await portal.getByLabel('Room name').fill(name);
    await portal.getByRole('button', { name: 'Create room' }).click();
    await portal.getByRole('heading', { name }).waitFor({ timeout: 15000 });
    const link = portal.getByLabel('Invite link', { exact: true });
    if (!(await link.isVisible())) await portal.getByRole('button', { name: 'Create invite' }).click();
    return await link.inputValue();
  } finally {
    await b.close();
  }
}

/**
 * Play with a friend: three phones side by side, each its own player in its own window, through a real p3p2 server.
 * Ada and Grace play; Edsger watches, is asked, and wants to play: after the battle he takes the loser's seat.
 */
async function friends({ url, dir, server, password }) {
  if (!server || !password) throw new Error('the friends take needs --server <portal URL> and P3P2_OWNER_PASSWORD');
  const base = url.replace(/\/\?.*$/, '');
  const invite = await createRoom(server, password, `${base}/`);
  const room = new URL(invite).searchParams.get('room');
  const link = `${url}&quality=high&room=${room}`;
  const size = { width: 500, height: 889, touch: true };
  const browser = await openStudio({ scale: 1.2 });
  const people = [];
  const t0 = Date.now();
  const markers = [];
  const mark = (kind, data = {}) => {
    const at = (Date.now() - t0) / 1000;
    markers.push({ at: Math.round(at * 100) / 100, kind, ...data });
    console.log(`    ${at.toFixed(1).padStart(6)} s  ${kind}${data.who ? ` ${data.who}` : ''}${data.result ? ` ${data.result}` : ''}`);
  };
  const table = (p) => bs(p.page, '__bs.room && __bs.room.table()');
  const seat = (p) => bs(p.page, '__bs.room ? __bs.room.seat() : null');
  const until = async (read, good, timeout = 60000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const v = await read();
      if (good(v)) return v;
      if (Date.now() > end) throw new Error(`waited too long (last: ${JSON.stringify(v)?.slice(0, 120)})`);
      await sleep(100);
    }
  };
  /** A phone opens the invite, records, and says yes. */
  async function arrive(name, left, rng) {
    const w = await openWindow(browser, { ...size, left, top: 0 });
    const p = { name, ...w, human: createHuman(w.page, { touch: true, rng, pace: 0.7 }) };
    people.push(p);
    await p.page.goto(link);
    await waitFor(p.page, '__bs.ready');
    await bs(p.page, '__bs.film.holdResolution()');
    // Sound on with a tap on the sea, before p3p2's question takes the keys.
    await p.page.touchscreen.tap(40, 520);
    await waitFor(p.page, '__bs.audio.state === "running" && !!__bs.film.audioStream()', 20000);
    p.rec = await record(p.page, `${dir}/friends-${name.toLowerCase()}.mp4`);
    const join = p.page.getByRole('button', { name: 'Join', exact: true });
    await until(() => join.isEnabled().catch(() => false), Boolean);
    mark('asked to join', { who: name });
    await p.human.think('look');
    await p.human.pressElement('p3p2-panel input[placeholder="Player"]');
    await p.page.locator('p3p2-panel input[placeholder="Player"]').fill('');
    await p.page.keyboard.type(name, { delay: 90 });
    await p.human.think('menu');
    await p.human.pressElement('p3p2-panel button.primary');
    await until(() => table(p), (t) => t !== null);
    mark('joined', { who: name });
    return p;
  }
  async function fire(p, [r, c]) {
    await until(() => bs(p.page, '__bs.room.canFire()'), Boolean);
    await settle(p.page);
    const s = await seat(p);
    const before = (await table(p)).shots[s].length;
    await p.human.think('aim');
    const at = await bs(p.page, `__bs.cellToClient('enemy', ${r}, ${c})`);
    await p.human.press(at.x, at.y);
    await sleep(220);
    await p.human.press(at.x, at.y);
    const done = await until(() => table(p).then((t) => t.shots[s][before]), (x) => !!x?.result);
    mark('shot', { who: p.name, result: done.result });
    return done;
  }
  try {
    const ada = await arrive('Ada', 0, createRng(11).next);
    // The link to pass on, and its QR code.
    await ada.human.think('look');
    await ada.human.pressElement('p3p2-panel button.pill');
    mark('panel', { who: 'Ada' });
    await sleep(1500);
    await ada.human.pressElement('p3p2-panel button:text("QR code")');
    mark('qr', { who: 'Ada' });
    await sleep(3500);
    await ada.human.pressElement('p3p2-panel button[aria-label="Close"]');
    const grace = await arrive('Grace', 620, createRng(12).next);
    const ed = await arrive('Edsger', 1240, createRng(13).next);
    await until(() => bs(ed.page, '__bs.room.asking()'), (a) => a?.ask === true);
    mark('ask', { who: 'Edsger' });
    await ed.human.think('look');
    await ed.human.pressElement('[data-k="ask-play"]');
    mark('in line', { who: 'Edsger' });

    // Placement: Ada moves a ship; both are ready.
    await place(ada.page, ada.human);
    for (const p of [ada, grace]) {
      await p.human.think('menu');
      await p.human.pressElement('[data-k="start"]');
    }
    await until(() => table(ada).then((t) => t.phase), (ph) => ph === 'battle');
    mark('battle');
    // Ada finds Grace's ships with a few misses among them; Grace hits Ada three times, then misses.
    const SIZES = { carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2 };
    const cells = (fleet) => fleet.flatMap((s) => Array.from({ length: SIZES[s.type] }, (_, k) => (s.h ? [s.r, s.c + k] : [s.r + k, s.c])));
    const adaFleet = await bs(ada.page, '__bs.room.mine()');
    const graceFleet = await bs(grace.page, '__bs.room.mine()');
    const taken = (fleet) => new Set(cells(fleet).map(([r, c]) => r * 10 + c));
    const water = (fleet) => Array.from({ length: 100 }, (_, i) => i).filter((i) => !taken(fleet).has(i)).map((i) => [Math.floor(i / 10), i % 10]);
    const adaTargets = cells(graceFleet);
    adaTargets.splice(1, 0, water(graceFleet)[37]);
    adaTargets.splice(6, 0, water(graceFleet)[58]);
    adaTargets.splice(11, 0, water(graceFleet)[12]);
    // Enough for every round: Ada needs at most 17 hits and 3 misses.
    const graceTargets = [water(adaFleet)[44], ...cells(adaFleet).slice(0, 3), ...water(adaFleet).filter((_, i) => i % 3 === 1)];
    let round = 0;
    while ((await table(ada)).phase === 'battle' && adaTargets.length) {
      round++;
      await fire(ada, adaTargets.shift());
      if ((await table(ada)).phase !== 'battle') break;
      if (round === 5) {
        // Grace says something, from p3p2's panel; Edsger's button shows it.
        await grace.human.pressElement('p3p2-panel button.pill');
        await grace.human.pressElement('p3p2-panel input[placeholder="Say something…"]');
        await grace.page.keyboard.type('Nice shot! 😅', { delay: 80 });
        await grace.human.pressElement('p3p2-panel button:text("Send")');
        mark('chat', { who: 'Grace' });
        await sleep(1200);
        await grace.human.pressElement('p3p2-panel button[aria-label="Close"]');
      }
      await fire(grace, graceTargets.shift());
    }
    await until(() => table(ed), (t) => t.verdicts.join() === 'kept,kept', 30000).catch(() => {});
    mark('over');
    await sleep(6000);
    // The loser starts the next battle from the end card: the winner stays, Edsger takes Grace's seat and fires first.
    await grace.human.pressElement('.overlay:not([hidden]) [data-k="again"]');
    await until(() => table(ada).then((t) => t.n), (n) => n === 2);
    mark('next battle');
    await until(() => bs(grace.page, '__bs.room.asking()'), (a) => a?.ask === true);
    mark('ask', { who: 'Grace' });
    await sleep(2500);
    await grace.human.pressElement('[data-k="ask-watch"]');
    for (const p of [ed, ada]) {
      await p.human.think('menu');
      await p.human.pressElement('[data-k="start"]');
    }
    await until(() => table(ada).then((t) => t.phase), (ph) => ph === 'battle');
    mark('battle 2');
    await fire(ed, [4, 4]);
    await sleep(4000);
    const recordings = [];
    for (const p of people) {
      const done = await p.rec.stop();
      const check = frameCheck(done.file);
      console.log(`    ${p.name}: ${check.frames} frames, ${check.fps.toFixed(1)} fps, ${check.gaps.length} gaps over 34 ms`);
      recordings.push({ who: p.name, file: done.file, startedAt: done.startedAt, size: done.size, crop: p.crop, check: { fps: check.fps, gaps: check.gaps, slow: check.slow } });
    }
    return { name: 'friends', t0, markers, recordings };
  } finally {
    await browser.close();
  }
}

export const TAKES = { sea, 'battle-ai': battleAi, tiers, phone, 'phone-sideways': phoneSideways, friends };
export { bs, waitFor, settle, stage, rolling, openStudio, openWindow, place };
