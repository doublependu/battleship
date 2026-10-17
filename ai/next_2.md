# Next 2: what was built for plan 2, and what to do next

Implements `ai/plan_2.md` (answers `ai/prompt_2.md`). Nothing is committed or deployed. That's for you.

---

## 1. What changed

| Item | Where | Notes |
|---|---|---|
| Size changes take effect just before drawing | `src/render/renderer.js` | `resize()` updates the camera now and marks the canvas size dirty. `render()` applies it first (`#applySize()`): the canvas only when its size or pixel ratio changes, then the Ultra targets. Removes the empty frame |
| "Slow" by the average frame time | `src/render/quality.js` (`frameWindowVerdict`), `renderer.js` (`trackFrame`) | Average of each 90-frame window, each frame capped at 3× budget. Slow above 1.15× budget, fast below 1.05×. Counters, steps, floor and the Auto tier drop are unchanged |
| `__bs.feedMonitor(ms, frames)` | `src/main.js` (e2e hook) | The monitor sees `ms` as the interval of the next frames: forces a resolution step through the real path |
| `npm run flash` | `scripts/flash.mjs`, `package.json` | Records every frame shown while the monitor steps down and back up, and while the viewport is resized. Fails on a one-frame spike. Saves each flash with its neighbours to `recordings/flash/` |
| Tests | `tests/unit/quality.test.js` | 65 unit tests (was 60): uneven frames on time on average, really late frames, one stall, the band in between, the phone budget |
| Docs | `README.md` | `npm run flash` in the scripts table; one sentence on adaptive resolution under "Graphics tiers" |

## 2. Measured (this machine)

- **Flash check** (`npm run flash`, headed Chrome, Ultra and High):

  | | Old renderer | Now |
  |---|---|---|
  | Ultra | 2 flashes (step down, step up) | 0 |
  | High | 2 flashes (step down, step up) | 0 |

  Every flash frame was the page's CSS gradient. **High flashed too**: any tier flashes on a resolution step;
  Ultra in Firefox was just the case that made steps happen.
- **System Firefox (snap 157), full screen 2560×1440, Ultra**, driven over WebDriver BiDi (§4):
  - Forced step: at the end of the frame that changed resolution, the canvas holds the ocean colour
    (`124,186,177`); before, it held `0,0,0,0`. The new size shows on the next frame.
  - 60 s of battle with 20 shots: no resizes, every window "fast".
- **Rules side by side** (monitor disabled, so the resolution stayed put):

  | Run | Windows | Slow, old rule (p90 > 1.3×) | Slow, new rule |
  |---|---|---|---|
  | Firefox Ultra 2560×1440, 45 s with shots | 16 | 5 | 0 |
  | Chrome Ultra 2560×1300 / 5120×2600 | 19 / 19 | 0 / 0 | 0 / 0 |
  | Chrome desktop budget, busy-wait 17 / 20 / 26 ms (51 / 43 / 37 fps) | 8 / 7 / 6 | 6 / 7 / 6 | 5 / 7 / 6 |
  | Phone profile, phone budget, busy-wait 28 / 33 / 38 / 45 ms (35 / 30 / 26 / 22 fps) | 5 / 4 / 4 / 3 | 0 / 0 / 1 / 3 | 0 / 0 / 4 / 3 |

  On the phone budget the new rule is a little stricter at 26 fps, which is under the 30 fps target.
- **Regression**, all passing:
  - `npm test`: 65 tests
  - `npm run size`: initial JS 144.0 KB brotli (before 143.9), transfer 147.3 KB
  - `npm run loadtime`: desktop 309 / 409 ms, mobile proxy 706 / 742 ms (median / max)
  - `npm run perf`, desktop and phone: all four tiers at 60 fps, no long tasks
  - `npm run play` at speed 3, no problems: desktop on Auto (with the Ultra toast); Pixel 7 seed 12 and
    iPhone 13, both with `--rotate --switch-quality`

## 3. Deviations from plan 2 (and why)

1. **`npm run flash` is headed by default** (`--headless` to override). Headless Chrome on this machine shows
   frames with ships and labels on flat grey, no sea or sky, about twice a second. They never appeared in headed
   Chrome or Firefox, and they'd fail the check on every run.
2. **The check skips frames of a different size.** While the viewport changes, the screencast can put one frame of
   the old size between two of the new one. That isn't a flash.
3. **The window-resize path didn't flash on HEAD in headed Chrome.** The check exercises it anyway, and the fix
   covers it (the `ResizeObserver` resize is deferred like the others). Not checked in Firefox.
4. **The shadow comparison needed an artificial load.** This PC runs `perf`'s phone profile at 60 fps on every
   tier, so both rules agree trivially. A busy-wait before each frame gave the slow cases in the table above.
5. **The 60 s Firefox run was smooth this time** (slowest 10% at 17 ms throughout), unlike the 24 ms windows
   measured before the fix. So that run shows no regression, but not the new rule at work in Firefox. That rests
   on the 45 s measurement above and the unit tests.

## 4. Not verified / known limitations

- **No real phones.** The phone budget keeps the same ratios, and the comparison is emulated.
- **Firefox is checked by hand only.** Playwright's Firefox stops drawing after a few seconds on this desktop, so
  I drove the system Firefox over WebDriver BiDi: `firefox --remote-debugging-port 9333 --no-remote
  --new-instance -profile ~/snap/firefox/common/bs-repro-profile --kiosk`, then `session.new`,
  `browsingContext.navigate` and `script.evaluate` over `ws://127.0.0.1:9333/session`. The profile is deleted
  afterwards. The window must stay in front: Firefox on Wayland stops drawing when it's hidden. Per plan_2's
  default, the driver isn't in the repo.
- **Firefox's uneven frame pacing stays.** It's the browser's. I haven't checked whether it's visible as judder.
- **The headless grey frames** (§3.1) are not investigated further.

## 5. What to do next

1. **Check it in your Firefox**: Ultra, play a game, watch for flashes. Settings → Show FPS shows the resolution
   (`1.00x`, or `0.75x` after a step).
2. **Commit and deploy** (`npm run deploy`).
3. **Leftovers from `next_1.md`** still apply: a p3p2 server for players, two real phones on the LAN, room
   features, real-device tier checks.
