# Plan 2: the screen flash on Ultra

Answers `ai/prompt_2.md`. Nothing has been built yet. This file only describes the plan.

---

## 1. Summary

**Cause.** The flash is one empty frame. It happens when the adaptive resolution resizes the canvas: the frame loop
draws the scene (`src/main.js:597`), *then* asks the frame-time monitor (`src/main.js:600`, `Renderer.trackFrame`)
whether to change the resolution. When it does, `resize()` sets the canvas's width and height, which empties its
drawing buffer. The browser then shows that empty buffer for one frame: black, or the page's sky-to-sea CSS gradient
behind the canvas (`index.html:19`).

**Why only Ultra, and only in Firefox.** I reproduced it in the system Firefox (snap, 157), your default browser,
full screen at 2560×1440. Ultra averages about 17 ms a frame there (≈59 fps), but the frames come unevenly in
pairs of about 10 ms and 24 ms. The monitor judges each 90-frame window by its slowest 10% of frames (p90), and
24 ms is over its "slow" line (1.3 × 16.7 = 21.7 ms). So it drops the resolution to 75% (2560×1440 → 1920×1080),
and later raises it again. Every change is one flash. Chrome on the same PC never crosses the line, even with a
5120×2600 canvas.

**Two fixes, both planned:**
1. **Resize just before drawing** (§3). Any resize, from any path, then lands before the frame is drawn. This
   removes the flash itself, including during window resizing.
2. **Judge "slow" by the average frame time** (§4), with each frame counted as at most 3× the budget so a single
   stall doesn't count. Firefox at ≈59 fps then keeps full resolution. A device that is really slow still drops,
   as before.

Fix 1 alone leaves Firefox at a needlessly soft 75% that visibly sharpens and blurs every so often. Fix 2 alone
makes the flash rarer but keeps it on every device that does need a resolution change.

---

## 2. What I checked (this PC: RTX 3060, 2560×1440 at 1×, GNOME on Wayland; scripts in the scratchpad, not committed)

Playwright's own Firefox stops drawing after a few seconds on this desktop, so I drove the system Firefox over
WebDriver BiDi with a throwaway profile, in kiosk mode.

| Run | Result |
|---|---|
| Firefox, Ultra, 30 s, monitor live | One resize at 19.7 s: 2560×1440 → 1920×1080, called from `trackFrame` (`renderer.js:148`) |
| Firefox, forced step down | Canvas read back at the end of the frame that resized: `0,0,0,0` (empty). Ordinary frames: ocean colour, e.g. `99,163,156,255` |
| Chrome, forced step down, screen recorded | The frame after the resize shows the page's CSS gradient: sky, horizon, dark sea, no boards, no ships. Next frame is normal |
| Chrome, Ultra, 2560×1300 and 5120×2600 | No slow windows, no resize, no dark frames |

**The monitor's rule against a candidate rule** (monitor disabled for these runs so the resolution stayed put;
"slow" = windows over the slow line):

| Run | Windows | Slow, current rule (p90 > 1.3× budget) | Slow, average with each frame capped at 3× budget (> 1.15× budget) |
|---|---|---|---|
| Firefox, Ultra, 2560×1440, 45 s with shots | 16 | 5 | 0 |
| Chrome, Ultra, 2560×1300, 30 s with shots | 19 | 0 | 0 |
| Chrome, Ultra, 5120×2600, 30 s with shots | 19 | 0 | 0 |

In the Firefox run, the averages were 16.6–18.0 ms except one window with a 250 ms stall (24.1 ms). Capped, that
window is 18.4 ms. The p90s were 17–26 ms.

**Does the candidate rule still catch a slow machine?** Chrome, Ultra, 1280×720, with an artificial busy-wait
before each frame:

| Extra work per frame | Delivered fps | Windows | Slow, current rule | Slow, candidate rule |
|---|---|---|---|---|
| 13 ms | 59 | 9 | 0 | 0 |
| 15 ms | 59 | 9 | 0 | 0 |
| 17 ms | 51 | 8 | 6 | 5 |
| 20 ms | 43 | 7 | 7 | 7 |
| 26 ms | 37 | 6 | 6 | 6 |

The two rules agree once frames really are slow. They differ only on uneven frames at full speed, which is the
Firefox case.

Not checked: real phones, and the flash during window resizing (§3.1). The order of events says it should flash too,
and the new check (§5) will show whether it does on HEAD.

---

## 3. Fix 1: size changes take effect just before drawing

### 3.1 Where resizes come from today

| Path | When it runs | Flashes? |
|---|---|---|
| `trackFrame` → `resize()` | Inside the frame, after drawing | **Yes** (the reported flash) |
| `ResizeObserver` → `layout()` → `resize()` (`main.js:201`) | After the frame's callbacks, before the browser paints | Expected yes, while resizing the window |
| `setTier()` → `resize()` | After `compileAsync`, which resolves from a timer | No: the next frame draws before the browser paints |
| `layout()` from PLAY, battle start, title, tier switch | In event handlers | No, same reason |

### 3.2 Change (`src/render/renderer.js`)

- `resize(width, height, insets)` keeps the parts that must happen now: the CSS size, the insets and
  `rig.setViewport()`. `layout()` reads `r.rig.layout` right after it, and picking uses the camera. It no longer
  touches the canvas. It sets `this.sizeDirty = true`.
- A new private `#applySize()` does the rest:
  - `setPixelRatio` and `setSize`, only when the buffer size or pixel ratio actually changes, since writing the
    canvas width empties it even at the same value.
  - Then `ultra?.setSize()`, always. Three skips it when nothing changed, and a new `UltraWater` starts with
    16×16 targets.
- `render()` calls `#applySize()` first when `sizeDirty` is set, before the sim, caustics and object passes.
- The callers stay as they are: every path goes through `resize()`.

**Side effect:** while the window is being resized, the browser shows the previous frame stretched for one frame,
instead of an empty one.

### 3.3 Nothing else needs to change

- Picking (`pointer.js`) uses the canvas's CSS rect, not its buffer.
- `__bs.canvasSize.buffer` updates on the next frame. `play.mjs` already waits several frames before
  `checkLayout()` (150 ms plus `settle()` after a rotation, 600 ms after a tier switch).

---

## 4. Fix 2: "slow" by the average frame time

### 4.1 Rule

- A new pure function in `src/render/quality.js`, `frameWindowVerdict(samples, budget)`. It returns `'slow'`,
  `'fast'` or `null`, next to `benchmarkDecision`, so it can be unit tested.
- **Average of the window's frame intervals, each capped at 3× budget.** The cap keeps a single stall (a hidden
  window, a GC pause, a shader compiling on first use) from counting. Lower resolution wouldn't help those anyway.
- **Slow** if the average is over 1.15× budget. **Fast** if it is under 1.05× budget. In between, no change.

| | Budget | Slow above | Fast below |
|---|---|---|---|
| Desktop | 16.7 ms (60 fps) | 19.2 ms (≈52 fps) | 17.5 ms (≈57 fps) |
| Phone | 33.3 ms (30 fps) | 38.3 ms (≈26 fps) | 35.0 ms (≈29 fps) |

### 4.2 What stays the same

- `trackFrame` keeps its windows of 90 frames, its counters (2 slow windows to step down; `stableNeeded` fast
  windows to step up, doubling up to 32), its 0.25 steps and the 0.75 floor, and the `'down'` tier drop on Auto.
- Only the verdict per window changes. On a manually chosen tier it still only changes resolution, as in
  `plan_0.md`.

---

## 5. Tests

1. **New check script `scripts/flash.mjs`** (`npm run flash`), in the style of `perf.mjs`:
   - Uses `vite preview` and Chrome, headless by default or `--headed`, Ultra and High.
   - Records every composited frame (CDP screencast, small JPEGs). The frames are decoded in a second page, so
     no new dependency.
   - Triggers:
     - a step down and back up through the real `trackFrame` path, using a new e2e hook,
       `__bs.feedMonitor(ms, frames)`, which hands the monitor a fixed interval for some frames
     - three viewport resizes, the `ResizeObserver` path
   - Fails on any **one-frame spike**: a frame that differs a lot from both neighbours, while the neighbours are
     close to each other. A real change of framing, after a resize for example, persists, so it isn't a spike.
   - It must **fail on HEAD first**, so that it's known to catch the flash.
2. **Unit tests** (`tests/unit/quality.test.js`) for `frameWindowVerdict`:
   - Firefox-like pairs of 10/24 ms averaging 17 ms → not slow
   - steady 20 ms → slow
   - 59 fps with one 250 ms stall → not slow
   - one vsync missed in every three frames → slow
   - steady 16.7 ms → fast
   - the phone budget gives the same verdicts at double the times
3. **Firefox, by hand** with the BiDi driver from the scratchpad (system Firefox, kiosk, 2560×1440):
   - Ultra, 60 s of battle with shots: no resizes
   - forced step: the canvas is not empty at the end of the frame
4. **Shadow comparison on the phone profile.** `npm run perf -- --device phone --cpu 6` logs both rules side by
   side for each tier, to see where they would differ on a slow phone before the old one is removed.
5. **Regression**:
   - `npm test`
   - `npm run perf`, desktop and phone
   - `npm run play` (desktop on Auto, Pixel 7 and iPhone 13 with `--rotate --switch-quality`), whose
     `checkLayout()` covers the buffer size after rotations and tier switches
   - `npm run size` and `npm run loadtime`: the load path doesn't change

---

## 6. Order of work (each step ends runnable and checked)

1. `scripts/flash.mjs` and `__bs.feedMonitor`. Confirm it fails on HEAD, for the monitor step and, if it does,
   for the viewport resize.
2. §3: deferred size in `Renderer`. `flash.mjs` passes, and so do the `play.mjs` layout checks.
3. §4: `frameWindowVerdict` and its unit tests, the shadow comparison on the phone profile, then `trackFrame`
   switches over.
4. Firefox by hand (§5.3).
5. Regression runs. One sentence in the README under "Graphics tiers": within a tier, the resolution drops (down
   to 75%) while frames are slow and comes back when they're fast. Then `ai/next_2.md`. No commit or push.

---

## 7. Risks and limits

- **An average hides stutter.** A device that keeps its average up but hitches now and then won't drop resolution.
  Those hitches come from the CPU or shader compiles, which resolution doesn't fix.
- **Firefox's uneven frame pacing stays.** It's the browser's, not the game's. I haven't checked whether the
  10/24 ms pairs are visible as judder.
- **Ultra in Firefox at 2560×1440 is close to its limit.** On a slightly slower PC, Firefox will really be slow and
  drop to 75%. That's the right behaviour, and after §3 it happens without a flash.
- **No real phones.** The phone thresholds keep the same ratios to the budget. The shadow comparison (§5.4) is
  emulated.
- **One stretched frame** while resizing the window, instead of an empty one.

---

## 8. Open questions (I'll use the default unless you say otherwise)

1. **Thresholds**: slow above 1.15× budget, fast below 1.05×, frames capped at 3× budget. Default: these.
2. **Keep the system-Firefox driver as a repo script** (`scripts/firefox.mjs`)? It is the only reliable way to
   test in Firefox on this desktop, but it's tied to this machine (snap path, a kiosk window over the desktop).
   Default: no, it stays out of the repo, and `next_2.md` says how it was run.

---

## 9. Requirement checklist

| Prompt item | Where |
|---|---|
| Issue 1: flash every few seconds on Ultra on this PC | §1–2 cause reproduced in Firefox. §3 removes the empty frame. §4 stops needless resolution changes |
| Spec: initial load 1–3 s, 4 s max | No change to the load path. A few lines of code, no new dependency |
| Spec: average PC / entry-level phone | §4 keeps dropping resolution when frames are really slow (synthetic load table, §2). Shadow comparison on the phone profile (§5.4) |
