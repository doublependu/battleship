// Flash check (plan 2): records every frame the browser shows while the render resolution changes, and fails on a
// one-frame spike: a frame unlike both its neighbours while they are alike (an empty canvas, showing black or the
// page's background). Changes come from the frame-time monitor (a step down and back up, via __bs.feedMonitor)
// and from viewport resizes (the ResizeObserver path).
// Headed by default: headless Chrome here shows frames with no sea or sky that a real window never shows.
// Usage: npm run build && npm run flash [-- --tiers ultra,high --headless --url http://localhost:5173]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const TIERS = opt('tiers', 'ultra,high').split(',');
const VIEWPORT = { width: 1280, height: 720 };
const RESIZES = [[1200, 700], [1366, 768], [1280, 720]];
const THUMB = [32, 18];
const SPIKE = 10; // mean grey-level difference (0-255) that counts as "unlike"
const OUT = 'recordings/flash'; // each flash with its neighbours, as JPEGs (gitignored)
rmSync(OUT, { recursive: true, force: true });
let url = opt('url', '');

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
const browser = await chromium.launch({ channel: 'chrome', headless: args.includes('--headless'),
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl'] });
// Decodes the recorded JPEGs into small grey thumbnails.
const decoder = await (await browser.newContext()).newPage();

async function thumbnails(frames) {
  const out = [];
  for (let i = 0; i < frames.length; i += 100) {
    out.push(...await decoder.evaluate(async ([list, [w, h]]) => {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d', { willReadFrequently: true });
      const res = [];
      for (const b64 of list) {
        const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
        g.drawImage(img, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        const grey = [];
        for (let p = 0; p < d.length; p += 4) grey.push(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
        res.push({ grey, size: `${img.width}x${img.height}` });
      }
      return res;
    }, [frames.slice(i, i + 100).map((f) => f.data), THUMB]));
  }
  return out;
}

const diff = (a, b) => a.grey.reduce((s, v, i) => s + Math.abs(v - b.grey[i]), 0) / a.grey.length;

let failed = false;
for (const tier of TIERS) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?e2e&seed=5&quality=${tier}`);
  await page.waitForFunction('window.__bs && __bs.ready', null, { timeout: 30000 });
  await page.click('#play');
  await page.waitForFunction('__bs.phase === "placement" && __bs.view.settled', null, { timeout: 15000 });
  await page.click('[data-k="start"]');
  await page.waitForFunction(`__bs.quality.current === '${tier}' && __bs.view.settled`, null, { timeout: 20000 });

  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const marks = [];
  const mark = (what) => marks.push({ what, t: Date.now() / 1000 });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 320, maxHeight: 180, everyNthFrame: 1 });
  await sleep(1000);

  // A step down and back up through the real monitor path (trackFrame runs after the frame is drawn).
  const full = await page.evaluate('__bs.canvasSize.buffer[0]');
  mark('monitor step down');
  await page.evaluate('__bs.feedMonitor(40, 270)');
  await page.waitForFunction(`__bs.canvasSize.buffer[0] < ${full}`, null, { timeout: 30000 });
  const down = await page.evaluate('__bs.canvasSize.buffer');
  await sleep(500);
  mark('monitor step up');
  await page.evaluate('__bs.feedMonitor(10, 90 * 33)');
  await page.waitForFunction(`__bs.canvasSize.buffer[0] === ${full}`, null, { timeout: 90000 });
  await page.evaluate('__bs.feedMonitor(10, 1)');
  await sleep(500);

  for (const [width, height] of RESIZES) {
    mark(`viewport ${width}x${height}`);
    await page.setViewportSize({ width, height });
    await sleep(700);
  }
  await cdp.send('Page.stopScreencast');
  await sleep(200);

  const thumbs = await thumbnails(frames);
  const t0 = frames[0]?.t ?? 0;
  const near = (t) => marks.reduce((best, m) => (m.t <= t + 0.05 && (!best || m.t > best.t) ? m : best), null)?.what ?? 'start';
  const steps = [];
  const spikes = [];
  for (let i = 1; i < thumbs.length - 1; i++) {
    const before = diff(thumbs[i - 1], thumbs[i]);
    const after = diff(thumbs[i], thumbs[i + 1]);
    steps.push(before);
    const across = diff(thumbs[i - 1], thumbs[i + 1]);
    // While the viewport changes, a frame of the old size can come between two of the new one: not a flash.
    if (thumbs[i].size !== thumbs[i - 1].size || thumbs[i].size !== thumbs[i + 1].size) continue;
    if (Math.min(before, after) > SPIKE && across < Math.min(before, after) / 3) {
      mkdirSync(OUT, { recursive: true });
      for (const k of [-1, 0, 1]) writeFileSync(`${OUT}/${tier}-${i}${['-before', '', '-after'][k + 1]}.jpg`, Buffer.from(frames[i + k].data, 'base64'));
      spikes.push(`frame ${i} at ${(frames[i].t - t0).toFixed(2)} s (after "${near(frames[i].t)}"): ` +
        `${before.toFixed(1)} / ${after.toFixed(1)} from its neighbours, ${across.toFixed(1)} between them`);
    }
  }
  const secs = (frames.at(-1)?.t ?? 0) - t0;
  const fps = frames.length / Math.max(secs, 1e-3);
  steps.sort((a, b) => a - b);
  const ok = !spikes.length && !errors.length;
  if (!ok) failed = true;
  console.log(`${tier.padEnd(6)} ${frames.length} frames in ${secs.toFixed(1)} s (${fps.toFixed(0)}/s), ` +
    `step down to ${down.join('x')}, frame-to-frame difference median ${steps[steps.length >> 1]?.toFixed(2)} ` +
    `max ${steps.at(-1)?.toFixed(1)}: ${spikes.length} flash${spikes.length === 1 ? '' : 'es'} ${ok ? 'OK' : 'FAIL'}`);
  for (const s of spikes) console.log(`  ${s}`);
  if (spikes.length) console.log(`  frames saved in ${OUT}/`);
  for (const e of errors) console.log(`  error: ${e}`);
  if (fps < 40) console.log('  warning: under 40 recorded frames/s, so a one-frame flash could fall between them');
  await context.close();
}
await browser.close();
server?.kill();
process.exit(failed ? 1 : 0);
