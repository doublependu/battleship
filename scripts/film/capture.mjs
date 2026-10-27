// Recording a take: headed Chrome records its own tab, the page exactly as shown (canvas, HUD, menus, the cursor
// drawn by `lib/human.mjs`), with the game's own stereo sound, into an H.264 file at up to 60 fps.
//
// What this desktop (GNOME on Wayland) needs, found by trying (ai/plan_3.md §4.2 and ai/next_3.md):
// - The recording is of the real window, so the window is sized until the page inside it is exactly the size asked
//   for: no viewport emulation, which the recording ignores.
// - A window taller than the screen loses its bottom 56 page units (black in the recording). The game's area is then
//   held above that, the same shape as asked, at the top left; the cut crops it out and scales it up a little. (A
//   window made 56 units taller instead recorded at half the frame rate.)
// - A phone's screen is a small page at a high pixel ratio (`--force-device-scale-factor`), so that a phone layout
//   is recorded at 1080×1920.
// - Not headless: headless Chrome here shows grey frames now and then (ai/next_2.md §3.1).
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { installCursor } from '../lib/human.mjs';

/** Page units lost at the bottom of a window taller than the screen. */
const BAND = 56;

/**
 * Where the pages send what they record: a small HTTP server here, which writes each recording's chunks to its file
 * in order. A page posts the chunk as it is: turning it into text for Playwright would stall the game every second.
 */
let sink = null;
function startSink() {
  sink ??= new Promise((resolve) => {
    const files = new Map();
    const server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') return res.end();
      const out = files.get(req.url.slice(1));
      if (!out) {
        res.statusCode = 404;
        return res.end();
      }
      req.on('data', (d) => out.write(d));
      req.on('end', () => res.end());
    });
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve({ port: server.address().port, files });
    });
  });
  return sink;
}

/** A headed Chrome for windows of one pixel ratio (a phone's screen is a small page at a high ratio). */
export async function openStudio({ scale = 1 } = {}) {
  return chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl', '--autoplay-policy=no-user-gesture-required',
      '--auto-accept-this-tab-capture', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', ...(scale !== 1 ? [`--force-device-scale-factor=${scale}`] : [])],
  });
}

/**
 * A window whose page is `width`×`height` page units, a profile of its own (so that two windows are two players).
 * Returns the page, and the part of the recording that is the page: { w, h } in pixels from the top left.
 */
export async function openWindow(browser, { width, height, touch = false, left = 0, top = 0 }) {
  const context = await browser.newContext({ viewport: null, hasTouch: touch });
  await installCursor(context);
  const page = await context.newPage();
  await page.goto('about:blank');
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  const measure = () => page.evaluate(() => ({ iw: innerWidth, ih: innerHeight, ow: outerWidth, oh: outerHeight, sh: screen.height, dpr: devicePixelRatio }));
  let m = await measure();
  for (let i = 0; i < 5 && (m.iw !== width || m.ih !== height); i++) {
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left, top, width: m.ow + width - m.iw, height: m.oh + height - m.ih } });
    await sleep(500);
    m = await measure();
  }
  if (m.iw !== width || m.ih !== height) throw new Error(`the window's page is ${m.iw}×${m.ih}, not ${width}×${height}`);
  // In pixels: with the pixel ratio forced, the screen's height comes in pixels, not page units.
  const tall = (height + m.oh - m.ih) * m.dpr > m.sh;
  const area = tall ? { w: Math.round(((height - BAND) * width) / height), h: height - BAND } : { w: width, h: height };
  if (tall) {
    // The game's area, and what is placed by the window's edges (the version, p3p2's button, the ribbon), inside it.
    await context.addInitScript(([w, h, dw, dh]) => {
      const style = () => {
        const s = document.createElement('style');
        s.textContent = `#app{right:auto!important;bottom:auto!important;width:${w}px!important;height:${h}px!important}` +
          `#version,#fps{bottom:${dh + 6}px!important}p3p2-panel{right:${dw + 12}px!important}.fork{right:${dw}px!important}`;
        document.documentElement.append(s);
      };
      if (document.documentElement) style();
      else addEventListener('DOMContentLoaded', style);
    }, [area.w, area.h, width - area.w, height - area.h]);
  }
  await cdp.detach();
  // The recording can come out a pixel or two narrower than the page: the cut crops to what is there.
  return { context, page, dpr: m.dpr, crop: { w: Math.round(area.w * m.dpr), h: Math.round(area.h * m.dpr) } };
}

/** Sound on: any key unlocks it (the game's rule for a first gesture); then the game's mix is there to record. */
export async function soundOn(page) {
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => window.__bs?.audio.state === 'running' && !!window.__bs.film.audioStream(), null, { timeout: 20000 });
}

/**
 * Starts recording the page into `file` (H.264 + Opus in MP4). Resolves to { stop() } once it has started;
 * `stop()` resolves to { file, startedAt } with the wall-clock time of the recording's first frame, in ms.
 */
export async function record(page, file) {
  const { port, files } = await startSink();
  const id = `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const out = createWriteStream(file);
  files.set(id, out);
  await page.evaluate((to) => {
    window.__filmStart = async () => {
      const w = Math.round(innerWidth * devicePixelRatio);
      const h = Math.round(innerHeight * devicePixelRatio);
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60, max: 60 }, width: { ideal: w }, height: { ideal: h }, resizeMode: 'none' },
        audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
      });
      // The game's own mix, in stereo (the tab's sound would be mono).
      const sound = window.__bs?.film.audioStream();
      const stream = new MediaStream([...screen.getVideoTracks(), ...(sound ? sound.getAudioTracks() : [])]);
      const mimeType = ['video/mp4;codecs=avc1.640033,opus', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus']
        .find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 30e6, audioBitsPerSecond: 256e3 });
      // One chunk after another, so that they reach the file in order.
      let sent = Promise.resolve();
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        const blob = e.data;
        sent = sent.then(() => fetch(to, { method: 'POST', body: blob }).catch(() => {}));
      };
      const started = new Promise((resolve) => { rec.onstart = () => resolve(Date.now()); });
      rec.start(1000);
      window.__filmStop = () => new Promise((resolve) => {
        rec.onstop = async () => {
          for (const t of screen.getTracks()) t.stop();
          await sent;
          resolve();
        };
        rec.stop();
      });
      return { startedAt: await started, size: [w, h], mimeType, sound: !!sound };
    };
  }, `http://127.0.0.1:${port}/${id}`);
  // getDisplayMedia needs a user's gesture: the call is made as one, with no click on the page.
  const cdp = await page.context().newCDPSession(page);
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: 'window.__filmStart()', userGesture: true, awaitPromise: true, returnByValue: true });
  await cdp.detach();
  if (exceptionDetails) throw new Error(`recording did not start: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  const info = result.value;
  if (!info.sound) console.warn(`  (no game sound in ${file}: sound was not on)`);
  return {
    info,
    async stop() {
      await page.evaluate(() => window.__filmStop());
      files.delete(id);
      await new Promise((resolve) => out.end(resolve));
      return { file, startedAt: info.startedAt, size: info.size };
    },
  };
}

/** Frame times of a recording: frames, fps, and every gap over 34 ms, with when it was (s). */
export function frameCheck(file) {
  const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file], { maxBuffer: 1 << 28 })
    .toString().split('\n').map((x) => Number.parseFloat(x)).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > 0.034) gaps.push({ at: pts[i - 1], ms: Math.round((pts[i] - pts[i - 1]) * 1000) });
  const span = pts.at(-1) - pts[0];
  return { frames: pts.length, seconds: span, fps: (pts.length - 1) / span, gaps, slow: gaps.length / Math.max(1, pts.length) };
}
