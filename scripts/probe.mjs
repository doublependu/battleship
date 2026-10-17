// Auto graphics probe check (plan §8.4): runs the Auto probe under several CPU throttles and screen sizes,
// logs the static guess, benchmark samples, chosen tier and time to decide. Fails if the probe takes more
// than ~3.5 s after bs-ready, or the chosen tier then misses the frame budget.
// Usage: npm run build && npm run probe [-- --headed]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
let url = opt('url', '');
const SCREENS = [
  { name: 'phone', width: 412, height: 915, scale: 2.625, mobile: true },
  { name: 'laptop', width: 1366, height: 768, scale: 1, mobile: false },
  { name: '4K', width: 1920, height: 1080, scale: 2, mobile: false },
];
const CPUS = [1, 4, 6];

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
const browser = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed'),
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl'] });
let failed = false;
for (const s of SCREENS) {
  for (const cpu of CPUS) {
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.scale,
      isMobile: s.mobile, hasTouch: s.mobile });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto(`${url}/?e2e`);
    await page.waitForFunction(() => performance.getEntriesByName('bs-ready').length > 0, null, { timeout: 30000 });
    const ready = await page.evaluate(() => performance.getEntriesByName('bs-ready')[0].startTime);
    const t0 = Date.now();
    await page.waitForFunction('window.__bs && __bs.quality.benchmark && !__bs.quality.benchmarking', null, { timeout: 15000 })
      .catch(() => {});
    const decideMs = Date.now() - t0;
    await sleep(800);
    const q = await page.evaluate('__bs.quality');
    const budget = s.mobile ? 1000 / 30 : 1000 / 60;
    const p90 = await page.evaluate(async () => {
      const iv = [];
      let last = performance.now();
      await new Promise((resolve) => {
        const t0 = last;
        const f = (now) => {
          iv.push(now - last);
          last = now;
          if (now - t0 < 3000) requestAnimationFrame(f);
          else resolve();
        };
        requestAnimationFrame(f);
      });
      iv.sort((a, b) => a - b);
      return iv[Math.floor(iv.length * 0.9)];
    });
    const problems = [];
    if (!q.benchmark) problems.push('no benchmark result');
    if (decideMs > 3500 + 1000) problems.push(`decision took ${decideMs} ms`);
    if (p90 > budget * 1.35) problems.push(`chosen tier misses budget (p90 ${p90.toFixed(1)} ms)`);
    if (problems.length) failed = true;
    const log = (q.benchmark ?? []).map((b) => `${b.tier}:${b.cost}ms`).join(' → ');
    console.log(`${s.name.padEnd(6)} cpu ${cpu}x  ready ${Math.round(ready)} ms  guess ${q.guess.guess.padEnd(6)} → ${String(q.current).padEnd(6)}` +
      ` (${decideMs} ms; ${log})  p90 ${p90.toFixed(1)} ms ${problems.length ? `FAIL: ${problems.join(', ')}` : 'OK'}`);
    await context.close();
  }
}
await browser.close();
server?.kill();
process.exit(failed ? 1 : 0);
