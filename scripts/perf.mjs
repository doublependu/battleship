// Heavy-scene performance check (plan §8.4): several fires + explosions + one sinking, CPU throttled.
// Logs frame-interval p50/p90, draw calls, triangles, main-thread long tasks; once per tier.
// Usage: npm run build && npm run perf [-- --tiers low,medium,high,ultra --cpu 4 --device desktop|phone --headed]
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const TIERS = opt('tiers', 'low,medium,high,ultra').split(',');
const CPU = Number(opt('cpu', 4));
const DEVICE = opt('device', 'desktop');
let url = opt('url', '');
const vp = DEVICE === 'phone' ? { width: 412, height: 915, scale: 2.625 } : { width: 1366, height: 768, scale: 1 };
const budget = DEVICE === 'phone' ? 1000 / 30 : 1000 / 60;

let server;
if (!url) {
  url = 'http://localhost:4173';
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
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
console.log(`perf: ${DEVICE} ${vp.width}x${vp.height}@${vp.scale}, CPU ${CPU}x, budget ${budget.toFixed(1)} ms`);
let failed = false;
for (const tier of TIERS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale,
    isMobile: DEVICE === 'phone', hasTouch: DEVICE === 'phone' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?e2e&stats&seed=5&quality=${tier}`);
  await page.waitForFunction('window.__bs && __bs.ready', null, { timeout: 30000 });
  await page.click('#play');
  await page.waitForFunction('__bs.phase === "placement" && __bs.view.settled', null, { timeout: 15000 });
  await page.click('[data-k="start"]');
  await page.waitForFunction(`__bs.quality.current === '${tier}'`, null, { timeout: 20000 }).catch(() => {});
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await sleep(1500);
  const result = await page.evaluate(async () => {
    const longTasks = [];
    const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration)));
    try {
      po.observe({ type: 'longtask', buffered: false });
    } catch {
      /* unsupported */
    }
    window.__bs.perfScene();
    const intervals = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const t0 = last;
      const f = (now) => {
        intervals.push(now - last);
        last = now;
        if (now - t0 < 5000) requestAnimationFrame(f);
        else resolve();
      };
      requestAnimationFrame(f);
    });
    po.disconnect();
    intervals.sort((a, b) => a - b);
    const q = (p) => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * p))];
    return { p50: q(0.5), p90: q(0.9), frames: intervals.length, longTasks: longTasks.length,
      worstLongTask: Math.max(0, ...longTasks), stats: document.getElementById('fps').textContent, tier: window.__bs.quality.current };
  });
  const ok = result.p90 <= budget * 1.35;
  if (!ok) failed = true;
  console.log(`${tier.padEnd(7)} → ${result.tier.padEnd(7)} p50 ${result.p50.toFixed(1)} ms  p90 ${result.p90.toFixed(1)} ms  ` +
    `frames ${result.frames}  long tasks ${result.longTasks} (worst ${result.worstLongTask.toFixed(0)} ms)  [${result.stats}] ${ok ? 'OK' : 'SLOW'}` +
    (errors.length ? `  errors: ${errors.join('; ')}` : ''));
  await context.close();
}
await browser.close();
server?.kill();
console.log('Note: headless numbers depend on this machine\'s GPU; real phones need the manual check in ai/next_0.md.');
process.exit(failed ? 1 : 0);
