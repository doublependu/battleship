// Playing with a friend, through a real p3p2 server: two admirals and a watcher, each in a browser profile of its
// own, play a whole battle by clicking cells, the way players do. Every page must build the same table from the
// room's log, no fleet may reach the room before the end, and both fleets must then be found as promised.
//
// It needs a p3p2 server (in the p3p2 repository: `npm run dev`, or the p3p2/p3p2 Docker image) and either a room's
// invite link from its portal, or the portal's owner password to create a room for the game's address:
//
//   npm run build && npm run friends -- --server http://127.0.0.1:8080        (P3P2_OWNER_PASSWORD=… in the env)
//   npm run friends -- --invite 'http://localhost:5173/?room=http://127.0.0.1:8080/…' --url http://localhost:5173
//
// Everybody comes in by the invite, as players do: the first one in is the host.
//
// Options: --headed, --speed 3, --video, --via <origin> (the room through another address: p3p2's lag proxy, say),
// --engines (Grace in Firefox and the watcher in WebKit on an iPhone's screen,
// so that three engines build one table). Screenshots (and videos) go to recordings/ (gitignored).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, devices, firefox, webkit } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const SPEED = Number(opt('speed', 3));
const PORTAL = opt('server', '');
const PASSWORD = opt('password', process.env.P3P2_OWNER_PASSWORD ?? '');
let INVITE = opt('invite', '');
let URL_BASE = opt('url', '');
if (!INVITE && !(PORTAL && PASSWORD)) {
  console.error('Give --invite <invite link>, or --server <portal URL> with P3P2_OWNER_PASSWORD (or --password).');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = `recordings/${stamp}-friends`;
mkdirSync(outDir, { recursive: true });
const problems = [];
const fail = (msg) => {
  problems.push(msg);
  console.error(`✗ ${msg}`);
};
const ok = (msg) => console.log(`✓ ${msg}`);

let server;
if (!URL_BASE) {
  URL_BASE = 'http://localhost:4173';
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' }); // not npx: kill() must reach vite
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(URL_BASE).then((r) => r.ok, () => false);
    if (!up) await sleep(250);
  }
  if (!up) throw new Error('vite preview did not start (run npm run build first)');
}
const GAME = `${URL_BASE}/?e2e&speed=${SPEED}`;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !flag('headed'),
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl', '--autoplay-policy=no-user-gesture-required'],
});
const others = [];
const engine = async (type) => {
  const b = await type.launch({ headless: !flag('headed') });
  others.push(b);
  return b;
};
const DESKTOP = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };

/** A player: a browser profile of their own (two tabs of one browser are one player to the server). */
async function profile(name, device = DESKTOP, on = browser) {
  const context = await on.newContext({ ...device, recordVideo: flag('video') ? { dir: outDir, size: device.viewport } : undefined });
  const page = await context.newPage();
  watch(page, name);
  return { name, context, page };
}

function watch(page, name) {
  page.on('pageerror', (e) => fail(`${name}: page error: ${e.message}`));
  page.on('console', (m) => {
    // A page that is away has its socket closed under it: the client says so and comes back.
    if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) fail(`${name}: console error: ${m.text()}`);
  });
}

const bs = (p, expr) => p.page.evaluate(`window.__bs && (${expr})`);
const table = (p) => bs(p, '__bs.room && __bs.room.table()');
const seat = (p) => bs(p, '__bs.room ? __bs.room.seat() : null');
const fleetOf = (p) => bs(p, '__bs.room && __bs.room.mine()');
const shot = (p, name) => p.page.screenshot({ path: `${outDir}/${name}.png` });

/** Polls until `read()` gives something `good` accepts. */
async function until(what, read, good, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await read();
    if (good(last)) return last;
    await sleep(100);
  }
  throw new Error(`${what} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
}

const SIZES = { carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2 };
const cells = (fleet) => fleet.flatMap((s) => Array.from({ length: SIZES[s.type] }, (_, k) => (s.h ? [s.r, s.c + k] : [s.r + k, s.c])));
const key = ([r, c]) => `${r},${c}`;

async function ready(p) {
  await p.page.waitForFunction(() => window.__bs?.ready === true, null, { timeout: 60000 });
}

/** The owner's side: a room for the game's address, and its invite link from the room's page in the portal. */
async function createRoom() {
  const context = await browser.newContext();
  const portal = await context.newPage();
  // Not the server's address: once a room is on its front page, that is the front page.
  await portal.goto(`${PORTAL.replace(/\/+$/, '')}/login`);
  await portal.getByLabel('Password').fill(PASSWORD);
  await portal.getByRole('button', { name: 'Log in' }).click();
  await portal.getByLabel('Game URL').fill(`${URL_BASE}/`);
  await portal.getByLabel('Room name').fill(`Battleship ${stamp}`);
  await portal.getByRole('button', { name: 'Create room' }).click();
  await portal.getByRole('heading', { name: `Battleship ${stamp}` }).waitFor({ timeout: 15000 });
  const link = portal.getByLabel('Invite link', { exact: true });
  // A server before 0.2 makes no invite with the room: the owner creates it.
  if (!(await link.isVisible())) await portal.getByRole('button', { name: 'Create invite' }).click();
  const invite = await link.inputValue();
  await context.close();
  return invite;
}

/** What an invite carries: `?room=<server>/<code>`, the server without `https://`, any other scheme written out. */
const roomOf = (invite) => new URL(invite).searchParams.get('room') ?? '';
/** The invite's server, as an origin. */
const serverOf = (invite) => {
  const s = roomOf(invite).replace(/\/[^/]*$/, '');
  return new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).origin;
};
/** The same invite through another address of its server: p3p2's lag proxy, say. */
const through = (invite, origin) => {
  const to = new URL(origin);
  return invite.replace(/([?&]room=)[^&#]*\//, `$1${to.protocol === 'https:' ? to.host : to.origin}/`);
};

const panel = (p) => p.page.locator('p3p2-panel');
const panelOpen = (p) => p.page.evaluate(() => document.querySelector('p3p2-panel')?.shadowRoot?.querySelector('section.card')?.hidden === false);
const closePanel = (p) => panel(p).getByRole('button', { name: 'Close' }).click();

/** The first one in, by the invite like everybody: the first seat, and the game's 👥 has the link to pass on. */
async function first(p, invite) {
  await arrive(p, invite);
  await until(`${p.name} takes the first seat`, () => seat(p), (s) => s === 0);
  await p.page.locator('.hud [data-k="friends"]').click();
  const link = p.page.getByLabel('Invite link', { exact: true });
  await link.waitFor({ timeout: 15000 });
  const passOn = await link.inputValue();
  if (roomOf(passOn) !== roomOf(invite)) fail(`${p.name}'s panel passes on ${passOn}, not the room's invite`);
  await closePanel(p);
}

/** Opens the invite and says yes. */
async function arrive(p, invite) {
  await p.page.goto(invite);
  const join = p.page.getByRole('button', { name: 'Join', exact: true });
  await until(`${p.name} is asked to join`, () => join.isEnabled().catch(() => false), Boolean, 60000);
  await p.page.getByLabel('Your name').fill(p.name);
  await join.click();
  await ready(p);
  await until(`${p.name} has the table`, () => table(p), (t) => t !== null);
}

/** Every page has the same table: whichever is a step ahead, the others catch up. */
async function agree(players, label) {
  try {
    await until('the same table on every page', () => Promise.all(players.map((p) => table(p).then((t) => t?.fingerprint))),
      (prints) => new Set(prints).size === 1 && !!prints[0], 20000);
  } catch (e) {
    fail(`${label}: ${e.message}`);
  }
}

/** A shot on the page whose turn it is, by a click on a cell of the enemy's waters; answered by the other page. */
async function fire(p, [r, c], how = 'click') {
  await until(`${p.name} may fire`, () => bs(p, '__bs.room.canFire()'), Boolean, 30000);
  const s = await seat(p);
  const before = (await table(p)).shots[s].length;
  if (how === 'click') {
    const at = await bs(p, `__bs.cellToClient('enemy', ${r}, ${c})`);
    await p.page.mouse.click(at.x, at.y);
  } else if (how === 'tap') {
    const at = await bs(p, `__bs.cellToClient('enemy', ${r}, ${c})`);
    await p.page.touchscreen.tap(at.x, at.y);
    await sleep(120);
    await p.page.touchscreen.tap(at.x, at.y);
  }
  const done = await until(`${p.name}'s shot at ${r},${c} is answered`, () => table(p).then((t) => t.shots[s][before]), (x) => !!x?.result);
  if (done.r !== r || done.c !== c) fail(`${p.name} aimed at ${r},${c} but fired at ${done.r},${done.c}`);
  return done.result;
}

const players = [];
try {
  if (!INVITE) INVITE = await createRoom();
  if (opt('via', '')) INVITE = through(INVITE, opt('via'));
  ok(`invite ${INVITE}`);
  // Opened at the game's test address, which the room's link to pass on is then made from.
  const invite = `${GAME}&room=${roomOf(INVITE)}`;

  // An ordinary visit: nothing goes to any p3p2 server, and the room client is not loaded.
  const ada = await profile('Ada');
  players.push(ada);
  const requests = [];
  ada.page.on('request', (r) => requests.push(r.url()));
  await ada.page.goto(GAME);
  await ready(ada);
  await sleep(1500);
  const roomServer = serverOf(INVITE);
  const leaked = requests.filter((u) => u.startsWith(roomServer) || /p3p2-(core|panel|qr|local)|\/play-|\/table-/.test(u));
  if (leaked.length) fail(`an ordinary visit loaded ${leaked.join(', ')}`);
  else ok('an ordinary visit asks no server anything and loads no room code');

  await first(ada, invite);
  ok('Ada opens the invite first and hosts; her 👥 has the same link to pass on');
  const grace = await profile('Grace', DESKTOP, flag('engines') ? await engine(firefox) : browser);
  players.push(grace);
  await arrive(grace, invite);
  await until('Grace takes the second seat', () => seat(grace), (s) => s === 1);
  // The watcher is on a phone.
  const ed = flag('engines') ? await profile('Edsger', devices['iPhone 13'], await engine(webkit)) : await profile('Edsger', devices['Pixel 7']);
  players.push(ed);
  await arrive(ed, invite);
  if ((await seat(ed)) !== -1) fail(`the third to come is in seat ${await seat(ed)}, not watching`);
  ok('Ada and Grace sit, Edsger watches');

  // Placement as it comes, then Ready.
  for (const p of [ada, grace]) {
    await p.page.getByRole('button', { name: 'Ready' }).click();
    await until(`${p.name}'s promise is in the table`, async () => (await table(p)).commits[await seat(p)], Boolean);
  }
  for (const p of players) await until(`${p.name} sees the battle begin`, () => table(p).then((t) => t.phase), (ph) => ph === 'battle');
  await shot(ada, '01-ada-battle');

  // The promises are in the room; the fleets are not.
  const adaFleet = await fleetOf(ada);
  const graceFleet = await fleetOf(grace);
  const t0 = await table(ed);
  if (!t0.commits.every((c) => /^[0-9a-f]{64}$/.test(c ?? ''))) fail(`promises are not hashes: ${t0.commits}`);
  const leaks = [...adaFleet, ...graceFleet].filter((s) => JSON.stringify(t0).includes(JSON.stringify(s)));
  if (leaks.length || t0.reveals.some(Boolean)) fail('a fleet is in the room before the end');
  if ((await fleetOf(ed)) !== null) fail('the watcher has a fleet');
  ok('only promises in the room, no fleets');
  const tabs = await ed.page.locator('.hud [data-k="tabs"] button').allTextContents();
  if (tabs.join('|') !== "Ada's fleet|Grace's fleet") fail(`the watcher's board tabs say ${tabs.join(' / ')}`);

  // Ada fires at Grace's ships with two misses among them; Grace hits Ada three times, then misses.
  const adaShips = new Set(cells(adaFleet).map(key));
  const graceShips = new Set(cells(graceFleet).map(key));
  const water = (ships) => Array.from({ length: 100 }, (_, i) => [Math.floor(i / 10), i % 10]).filter((x) => !ships.has(key(x))).reverse();
  const adaTargets = cells(graceFleet);
  adaTargets.splice(2, 0, water(graceShips)[0]);
  adaTargets.splice(7, 0, water(graceShips)[1]);
  const graceTargets = [...cells(adaFleet).slice(0, 3), ...water(adaShips)];
  let round = 0;
  let gracePlayer = grace;
  while ((await table(ada)).phase === 'battle') {
    round++;
    const target = adaTargets.shift();
    if (round === 4) {
      // Enter fires at the aimed cell (the arrows move it from the last shot), and does not open chat; T does.
      const last = (await table(ada)).shots[0].at(-1);
      await until('Ada may fire', () => bs(ada, '__bs.room.canFire()'), Boolean);
      const at = await bs(ada, `__bs.cellToClient('enemy', ${last.r}, ${last.c})`);
      await ada.page.mouse.move(at.x, at.y);
      for (let dr = target[0] - last.r; dr !== 0; dr -= Math.sign(dr)) await ada.page.keyboard.press(dr > 0 ? 'ArrowDown' : 'ArrowUp');
      for (let dc = target[1] - last.c; dc !== 0; dc -= Math.sign(dc)) await ada.page.keyboard.press(dc > 0 ? 'ArrowRight' : 'ArrowLeft');
      const before = (await table(ada)).shots[0].length;
      await ada.page.keyboard.press('Enter');
      const done = await until('the shot fired with Enter is answered', () => table(ada).then((t) => t.shots[0][before]), (x) => !!x?.result);
      if (done.r !== target[0] || done.c !== target[1]) fail(`Enter fired at ${done.r},${done.c}, not at the aimed ${target}`);
      if (await panelOpen(ada)) fail('Enter opened the chat');
      await ada.page.keyboard.press('t');
      await until('T opens the chat', () => panelOpen(ada), Boolean, 5000).catch((e) => fail(e.message));
      await shot(ada, '02-ada-chat');
      await ada.page.keyboard.press('Escape');
      await until('Escape closes the chat', () => panelOpen(ada).then((o) => !o), Boolean, 5000).catch((e) => fail(e.message));
      if (await bs(ada, '__bs.paused')) fail('Escape in the chat also paused the game');
      ok('Enter fires without opening chat; T opens it');
    } else if (round === 8) {
      // Grace closes the page; Ada's shot waits; Grace's browser opens the invite again and answers it.
      await gracePlayer.page.close();
      await until('Ada may fire', () => bs(ada, '__bs.room.canFire()'), Boolean);
      const at = await bs(ada, `__bs.cellToClient('enemy', ${target[0]}, ${target[1]})`);
      await ada.page.mouse.click(at.x, at.y);
      await until('the shot waits for Grace', () => table(ada).then((t) => t.pending), (x) => x?.by === 0);
      await sleep(1500);
      if (!(await table(ada)).pending) fail('a shot at a closed page was answered');
      const page = await gracePlayer.context.newPage();
      watch(page, 'Grace');
      gracePlayer = { ...gracePlayer, page };
      players[1] = gracePlayer;
      await arrive(gracePlayer, invite);
      await until('Grace\'s page answers the waiting shot', () => table(ada).then((t) => t.pending), (x) => x === null);
      ok('a shot at a closed page waits, and is answered when it is back');
    } else await fire(ada, target);
    if ((await table(ada)).phase !== 'battle') break;

    if (round === 5) {
      // Grace reloads mid-battle: the same table, and her fleet still in her browser.
      await gracePlayer.page.reload();
      await ready(gracePlayer);
      await until('Grace is back in the room after a reload', () => table(gracePlayer), (t) => t !== null);
      if (JSON.stringify(await fleetOf(gracePlayer)) !== JSON.stringify(graceFleet)) fail('Grace lost her fleet on a reload');
      ok('a reload comes back to the same battle, fleet and all');
    }
    await fire(gracePlayer, graceTargets.shift());
    await agree(players, `round ${round}`);
    if ((await bs(ed, '__bs.quality.visibleShips')) !== 0) fail('the watcher sees ships afloat');
    if (round === 3) await shot(ed, '03-ed-watching');
  }

  // The end: Ada won, both fleets shown and found as promised, on every page.
  for (const p of players) {
    await until(`${p.name} sees Ada win`, () => table(p).then((t) => t.winner), (w) => w === 0).catch((e) => fail(e.message));
    await until(`${p.name} finds both fleets as promised`, () => table(p).then((t) => t.verdicts.join()), (v) => v === 'kept,kept')
      .catch((e) => fail(e.message));
  }
  const banners = { Ada: 'VICTORY', Grace: 'DEFEAT', Edsger: 'ADA WINS' };
  for (const p of players) {
    await until(`${p.name}'s end screen`, () => p.page.locator('.banner').textContent(), (b) => b === banners[p.name], 30000)
      .catch((e) => fail(e.message));
  }
  await agree(players, 'the end');
  ok('Ada wins; every page finds both fleets as promised');
  // Shown, so no longer kept; and Grace sees where Ada's unfound ships were.
  const keptA = await ada.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('battleship:fleet:')).length);
  if (keptA !== 0) fail(`Ada's browser still keeps ${keptA} fleet(s) after showing hers`);
  await until('Grace sees Ada\'s ships', () => bs(gracePlayer, '__bs.enemyRevealed'), (n) => n === 5, 15000).catch((e) => fail(e.message));
  await shot(gracePlayer, '04-grace-over');
  await shot(ed, '05-ed-over');

  // The watcher's phone: the 👥 button and the panel fit, upright and on its side.
  await ed.page.getByRole('button', { name: 'View the boards' }).click();
  for (const [w, h] of [[412, 915], [915, 412]]) {
    await ed.page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await ed.page.locator('.hud [data-k="friends"]').tap();
    await until('the panel opens on the phone', () => panelOpen(ed), Boolean, 5000);
    const box = await panel(ed).getByRole('dialog').boundingBox();
    if (!box || box.x < 0 || box.y < 0 || box.x + box.width > w + 1 || box.y + box.height > h + 1) fail(`the panel leaves a ${w}x${h} screen: ${JSON.stringify(box)}`);
    await shot(ed, `06-ed-panel-${w}x${h}`);
    await closePanel(ed);
  }
  ok('the 👥 button and the panel fit a phone, both ways round');

  // The next battle, from the menu after a look at the boards: the admirals change places, and Grace fires first.
  await gracePlayer.page.getByRole('button', { name: 'View the boards' }).click();
  await gracePlayer.page.getByRole('button', { name: 'Pause' }).click();
  const heading = await gracePlayer.page.locator('.overlay:not([hidden]) h2').textContent();
  if (heading !== 'Menu') fail(`the menu in a room is titled "${heading}"`);
  await gracePlayer.page.getByRole('button', { name: 'Next battle' }).click();
  for (const p of players) await until(`${p.name} sees battle 2`, () => table(p).then((t) => t.n), (n) => n === 2);
  if ((await seat(gracePlayer)) !== 0) fail('Grace did not move to the first seat');
  for (const p of [ada, gracePlayer]) {
    await p.page.getByRole('button', { name: 'Ready' }).click();
    await until(`${p.name}'s promise`, async () => (await table(p)).commits[await seat(p)], Boolean);
  }
  await fire(gracePlayer, [0, 0]);
  await agree(players, 'battle 2');
  ok('next battle: Grace fires first');

  for (const p of players) for (const e of await bs(p, '__bs.errors')) fail(`${p.name}: in-page error: ${e}`);
} catch (e) {
  fail(`script error: ${e.message}`);
  for (const p of players) await p.page.screenshot({ path: `${outDir}/error-${p.name}.png` }).catch(() => {});
} finally {
  writeFileSync(`${outDir}/log.json`, JSON.stringify({ invite: INVITE, problems }, null, 2));
  for (const p of players) await p.context.close().catch(() => {});
  await browser.close();
  for (const b of others) await b.close();
  server?.kill();
}
console.log(`recordings: ${outDir}`);
if (problems.length) {
  console.error(`${problems.length} problem(s)`);
  process.exit(1);
}
