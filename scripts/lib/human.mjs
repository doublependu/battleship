// Playing like a person: the mouse travels along a gentle curve and slows into its target (a little past it, then
// back), hovers before it clicks, and the player stops to think now and then. Touch taps where a finger would. The
// cursor and the taps are drawn into the page (`installCursor`), because a recording of the page shows no cursor.
// Used by `play.mjs --human` and by the film (`film.mjs`).
import { setTimeout as sleep } from 'node:timers/promises';

/** Seconds to think, by what is being decided: [shortest, longest]. */
const THINK = {
  aim: [0.6, 1.5], // the next shot
  hit: [1.1, 2.0], // after a hit: where the rest of the ship is
  sink: [1.4, 2.4], // the shot that may sink it
  menu: [0.4, 0.9], // a button
  look: [0.8, 1.6], // looking at the boards
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * @param page a Playwright page
 * @param opts touch: taps instead of clicks; rng: () => [0, 1); pace: think times are multiplied by it
 */
export function createHuman(page, { touch = false, rng = Math.random, pace = 1 } = {}) {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  let at = { x: vp.width * 0.55, y: vp.height * 0.6 };
  const between = (a, b) => a + (b - a) * rng();

  /** The mouse to (x, y): a curve, slowing at the end, a few pixels past and back. */
  async function moveTo(x, y) {
    if (touch) {
      at = { x, y };
      return;
    }
    const from = at;
    const dist = Math.hypot(x - from.x, y - from.y);
    if (dist < 2) return;
    const ms = Math.min(900, 180 + dist * 0.9) * between(0.85, 1.15);
    const steps = Math.max(8, Math.round(ms / 16));
    // A bend to one side, and an overshoot along the way.
    const bend = between(-0.12, 0.12) * dist;
    const nx = -(y - from.y) / dist;
    const ny = (x - from.x) / dist;
    const over = Math.min(10, dist * 0.04);
    const ox = x + ((x - from.x) / dist) * over;
    const oy = y + ((y - from.y) / dist) * over;
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      const arc = Math.sin(Math.PI * t) * bend;
      await page.mouse.move(from.x + (ox - from.x) * t + nx * arc, from.y + (oy - from.y) * t + ny * arc);
      await sleep(ms / steps);
    }
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(ox + (x - ox) * (i / 4), oy + (y - oy) * (i / 4));
      await sleep(16);
    }
    at = { x, y };
  }

  async function think(kind = 'aim') {
    const [a, b] = THINK[kind] ?? THINK.aim;
    await sleep(between(a, b) * 1000 * pace);
  }

  /** A click, or a tap: after the hand has got there. */
  async function press(x, y) {
    await moveTo(x, y);
    if (touch) {
      await page.touchscreen.tap(x, y);
    } else {
      await sleep(between(60, 160));
      await page.mouse.click(x, y, { delay: between(40, 90) });
    }
  }

  /** A button or anything else on the page, by selector: pressed near its middle, as a hand would. */
  async function pressElement(selector) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: 15000 });
    const box = await el.boundingBox();
    await press(box.x + box.width * between(0.4, 0.6), box.y + box.height * between(0.4, 0.6));
  }

  /** A drag from one point to another: held down, moved smoothly, let go. */
  async function drag(from, to) {
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      const point = (p) => [{ x: p.x, y: p.y, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) });
      await sleep(between(120, 220));
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }) });
        await sleep(22);
      }
      await sleep(between(80, 160));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
      at = to;
      return;
    }
    await moveTo(from.x, from.y);
    await page.mouse.down();
    await sleep(between(120, 220));
    const steps = 28;
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      await sleep(18);
    }
    await sleep(between(80, 160));
    await page.mouse.up();
    at = to;
  }

  /** Over a cell or two near the target first, sometimes, the way a player makes up their mind. */
  async function hesitate(points) {
    for (const p of points) {
      await moveTo(p.x, p.y);
      await sleep(between(150, 400));
    }
  }

  return { moveTo, think, press, pressElement, drag, hesitate, get at() { return at; } };
}

/**
 * Draws the mouse cursor (an arrow) and touch taps (a ring that fades) into every page of a context, above
 * everything else, ignoring the pointer. For recordings, which show no cursor.
 */
export async function installCursor(context) {
  await context.addInitScript(() => {
    const ready = () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="26" height="26">' +
        '<path d="M3 2l16 9.5-7 1.3-3.6 6.7z" fill="#fff" stroke="#0b2a40" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      const cursor = document.createElement('div');
      cursor.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;' +
        'transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));display:none';
      cursor.innerHTML = svg;
      document.documentElement.append(cursor);
      addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        cursor.style.display = 'block';
        cursor.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`;
      }, { capture: true, passive: true });
      addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        const ring = document.createElement('div');
        ring.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;` +
          'border-radius:50%;border:3px solid rgba(255,255,255,.9);background:rgba(255,255,255,.18);z-index:2147483647;' +
          'pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out;box-shadow:0 0 6px rgba(0,0,0,.4)';
        document.documentElement.append(ring);
        requestAnimationFrame(() => {
          ring.style.transform = 'scale(1.6)';
          ring.style.opacity = '0';
        });
        setTimeout(() => ring.remove(), 600);
      }, { capture: true, passive: true });
    };
    if (document.documentElement) ready();
    else addEventListener('DOMContentLoaded', ready);
  });
}
