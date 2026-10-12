# Next 0: what was built for plan 0, and what to do next

Implements `ai/plan_0.md` (answers `ai/prompt_0.md`). Nothing is committed or deployed. That's for you.

---

## 1. What's in the repo

| Area | Where | Notes |
|---|---|---|
| Rules, fleet, state machine | `src/game/` | Pure JS, no three.js. Seeded RNG (`?seed=`). |
| AI (Recruit / Captain / Admiral) | `src/game/ai/` | Only sees hit / miss / sunk + type. Hard uses density + softmax τ. |
| Ocean (Low/Medium/High) | `src/render/ocean/` | Ported sim (`sim.js` from `Water.ts`), sponge boundary, fixed timestep, analytic swell, sea shader, overlays. |
| Ultra "real water" | `src/render/ocean/ultra/` (lazy chunk) | Refraction (hull boxes + projected texture), planar reflection + ray-traced sky cube, caustics, seabed, wrecks, sim height in geometry. |
| Device probe + Auto tier | `src/render/quality.js` | Static check + title-screen benchmark, stored per GPU/screen/browser. |
| Ships | `src/render/ships/` | Procedural models, fore/aft halves for Carrier/Battleship, bobbing on swell + CPU ripples + hit kicks, scorch, dissolve reveal, sinking/breaking. |
| Effects | `src/render/fx/` (deferred chunk) | GPU particles, shells, splashes, explosions, fires, sinking sequence, oil slicks. |
| Sound | `src/audio/` (engine in a deferred chunk) | All synthesized. Cues pre-rendered with OfflineAudioContext; live whistles, sea ambience, generative music. |
| UI | `src/ui/`, `index.html` | Title/loading (inline, paints before JS), HUD, placement bar, pause, game over, settings, fork ribbon, version label. |
| Turn pacing | `src/director.js` | Pause-aware (game clock), restart-safe. |
| Input | `src/input/` | Pointer (mouse/touch/pen), keyboard, zoom blocking. |
| Scripts | `scripts/` | `sim`, `play`, `loadtime`, `perf`, `probe`, `size`, `version`. |
| Tests | `tests/unit/` | 41 tests: rules, placement, AI legality/fairness, flow, tier decision, ripple model, sound mapping, settings. |
| Deploy | `wrangler.jsonc`, `public/_headers` | Workers Static Assets, `preview_urls: false`. `npm run deploy:dry` passes. |

## 2. Measured results (this machine: Intel Raptor Lake iGPU, headless Chrome via ANGLE/GL)

- **Bundle** (`npm run size`): initial JS **139.5 KB** brotli (budget 200), initial transfer **142.5 KB** (budget 250).
  Deferred: audio engine 5.6 KB, Ultra 4.7 KB, effects 4.0 KB.
- **Load to `bs-ready`** (`npm run loadtime`, cold cache, preview server):

  | Profile | Median | Max | Target / hard limit |
  |---|---|---|---|
  | Desktop, 20 Mbps / 60 ms | 523 ms | 911 ms | 1 s / 4 s |
  | Mobile proxy, 10 Mbps / 100 ms, 4× CPU | 686 ms | 693 ms | 2.5 s / 4 s |

- **Perf** (`npm run perf`, heavy scene: 6 fires + explosions + a sinking): every tier holds 60 fps (p90 16.7 ms), no
  long tasks, both at 1366×768 with 4× CPU and at 412×915 @2.6 DPR with 6× CPU. Main-pass draw calls ≈ 5–12;
  triangles 15k (Low) → 184k (Ultra).
- **Auto probe** (`npm run probe`): decisions 1.3–3.7 s after `bs-ready` (never delays it). Laptop size → High or
  Ultra, phone size → Ultra, 1920×1080 @2 DPR → Medium. Every chosen tier then held 60 fps.
- **Balance** (`npm run sim`, 10k games per pairing, human-proxy bot moving first):

  | Level | Win rate (target) | AI shots to win | Params |
  |---|---|---|---|
  | Recruit | 85.6% (80–90%) | 67.6 | `pDrift 0.55` |
  | Captain | 59.8% (55–65%) | 55.3 | `mistakeRate 0.4` |
  | Admiral | 30.1% (25–35%) | 45.7 | `temperature 0.12` |

  The human-proxy bot averages ~52 shots. Pure density (τ = 0) averages ~43.
- **Play scripts** (`npm run play`): 9 full games with all checks passing (after fixing two script-side issues), across desktop / iPhone 13 / iPad / Pixel 7,
  all three difficulties and all four tiers, with `--rotate` (mid-game), `--switch-quality` (Low → Ultra → Low
  mid-game), drag placement, tap-to-rotate, pause/resume, and the pinch test. Hidden-ship check and audio cue
  checks passed. A real-speed game takes about 3 minutes.
- **Sound** (captured with `--recaudio`): integrated −17 to −19 LUFS, peaks −0.9 dBFS (limiter, no clipping), no
  silent gaps. The bed (sea + calm music) sits around −28 LUFS, so effects have ~12 LU of headroom.

## 3. Deviations from plan 0 (and why)

1. **Skipped the placeholder box ships** (milestone 4) and went straight to the procedural models.
2. **High uses the batched hull volume displacement** (the same single pass as Ultra) instead of a separate
   "tiny hull-bob ripple". It's one cheap pass for all hulls and looks better.
3. **Ultra reflections** use a planar mirror pass sampled at the surface point with normal distortion, over the
   ray-traced sky cube. Reflected-ray box tests would miss fire and smoke. Refraction follows upstream (ray vs
   hull boxes, then the projected texture).
4. **Ultra hull shadows** on the seabed are analytic soft footprint shadows in the caustics pass, not upstream's
   shadow target. Box shadows looked like hard slabs.
5. **Caustics include the fine detail waves**, in rotated layers. The swell alone is too gentle to focus light at
   3 m, and a single detail layer produced stripes.
6. **Wrecks only exist for ships sunk while on Ultra.** Switching to Ultra later doesn't bring back earlier ships.
7. **Burning crackle** is two loops (your fleet left, enemy right) whose level follows the number of fires, not
   one loop per ship.
8. **Benchmark** uses the median of a baseline-corrected `readPixels` sync cost when there's no GPU timer query.
   It starts after the effects chunk has loaded. Audio cue rendering waits until the benchmark is done.
9. **Layout rule extended:** fit-both is also used when focus mode wouldn't make cells bigger. On landscape phones
   both modes are height-limited, so showing both boards is strictly better.
10. **Fork ribbon** is CSS, not SVG. It shows on the loading/title and pause screens.
11. **Sinking pacing:** the camera holds 2.3 s on a sinking ship before the turn moves on, so you see it go
    down in focus mode too.

## 4. Not verified / known limitations

- **No real devices.** All runs used Chromium with device emulation on one Linux laptop, so entry-level-phone GPU
  performance and iOS Safari are unverified. WebKit isn't installed for Playwright.
- **GPU timer query is unavailable here**, so the probe used the `readPixels` fallback. Thresholds may need tuning
  with real-device data.
- **I can't listen.** The synthesized sounds were checked by levels and spectrum only, not by ear.
- **The human-proxy bot (~52 shots) may be stronger than a casual player**, so real win rates could come out
  below the targets (especially on Captain).
- **Auto-pause on window `blur`** (per plan) also triggers when clicking into DevTools or another monitor.
- **Ultra looks like a clear, shallow reef sea**, as planned (assumption 7).

## 5. What to do next

1. **Deploy:** `npx wrangler login`, then `npm run deploy` (commit first so the `v.xxxx` label matches).
2. **Real-device check** (deployed URL, or `npm run dev -- --host` on the LAN; add `?stats` for FPS / tier / DPR):
   - load time on mobile data, and which tier Auto picks and whether it feels smooth after a few minutes
     (thermal throttling should drop the tier with a toast)
   - rotate mid-game (placement, mid-shot, AI turn), pinch / double-tap zoom blocked, no stuck zoom
   - iPhone: sound starts on first tap, ring/silent switch respected, resumes after an app switch / call
   - an entry-level Android phone: Low or Medium should be chosen and stay at ≥ 30 fps
3. **Tune probe thresholds** from real-device numbers. Consider adding a GPU-timer path check on Windows/macOS
   Chrome, where `EXT_disjoint_timer_query_webgl2` is usually available.
4. **Human play-tests** for balance and fun. If players find Captain too hard, raise `normal.mistakeRate`.
   Consider exposing τ = 0 as a fourth difficulty.
5. **Polish candidates:**
   - slightly taller ships (vertical exaggeration) for readability
   - a less hazy horizon on the title screen
   - smoke with more structure
   - optionally a recorded soundtrack, lazy-loaded after `bs-ready`
6. **Later features:** Salvo mode, a Playwright WebKit run, and persisting the last game result.
