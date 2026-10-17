// Throttled load-time measurement (plan §7): time from navigation start to performance.mark('bs-ready')
// (ocean rendering + title screen interactive), cold cache, 5 runs per profile. Fails above the hard limit.
// Usage: npm run build && npm run loadtime [-- --runs 5 --url http://localhost:4173 --invite]
// --invite: the page is opened from an invite link to a p3p2 server that never answers. The title must come up as
// fast as ever (the room client starts after bs-ready), and the page must not throw.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const RUNS = Number(opt('runs', 5));
let url = opt('url', '');
const HARD_LIMIT = 4000;
const INVITE = args.includes('--invite');
// 10.255.255.1 is not routed: the connection hangs, the worst a server can do.

const PROFILES = [
  { name: 'Desktop', down: 20e6, up: 5e6, rtt: 60, cpu: 1, target: 1000, viewport: { width: 1366, height: 768 }, mobile: false },
  { name: 'Mobile proxy', down: 10e6, up: 3e6, rtt: 100, cpu: 4, target: 2500, viewport: { width: 412, height: 915 }, mobile: true },
];

let server;
if (!url) {
  url = 'http://localhost:4173';
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' }); // not npx: kill() must reach vite
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      /* starting */
    }
    await sleep(250);
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl'] });
let failed = false;
for (const p of PROFILES) {
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext({ viewport: p.viewport, isMobile: p.mobile, hasTouch: p.mobile,
      deviceScaleFactor: p.mobile ? 2.625 : 1 });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.rtt,
      downloadThroughput: p.down / 8, uploadThroughput: p.up / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(INVITE ? `${url}/?room=${encodeURIComponent('http://10.255.255.1:8080/abcdefghij')}` : url, { waitUntil: 'commit' });
    await page.waitForFunction(() => performance.getEntriesByName('bs-ready').length > 0, null, { timeout: 30000, polling: 50 });
    const ms = await page.evaluate(() => performance.getEntriesByName('bs-ready')[0].startTime);
    const transfer = await page.evaluate(() => performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || 0), 0)
      + (performance.getEntriesByType('navigation')[0]?.transferSize ?? 0));
    times.push(ms);
    if (INVITE) await page.waitForTimeout(1500); // the room client is loading and asking by now
    if (errors.length) {
      failed = true;
      console.log(`  page errors: ${errors.join('; ')}`);
    }
    console.log(`  ${p.name} run ${i + 1}: ${Math.round(ms)} ms (transfer ${(transfer / 1024).toFixed(0)} KB)`);
    await context.close();
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const max = times[times.length - 1];
  const ok = max <= HARD_LIMIT;
  if (!ok) failed = true;
  console.log(`${p.name}: median ${Math.round(median)} ms, max ${Math.round(max)} ms (target ${p.target} ms, hard limit ${HARD_LIMIT} ms) ${ok ? (median <= p.target ? 'OK' : 'OVER TARGET') : 'FAIL'}\n`);
}
await browser.close();
server?.kill();
process.exit(failed ? 1 : 0);
