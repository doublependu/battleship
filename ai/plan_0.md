# Plan 0: 3D Battleship (human vs AI), three.js + adapted "real water"

Answers `ai/prompt_0.md`. Nothing has been built yet. This file only describes the plan.

---

## 1. Summary

A static single-page web game. You play classic 10×10 Battleship against an AI, and both fleets float on one
animated ocean. The game rules and the AI live in plain JavaScript with no rendering code, so they can be
unit-tested and simulated headlessly. Rendering uses three.js (`WebGLRenderer` + GLSL `ShaderMaterial`s).
The ocean is an adapted version of jeantimex/threejs-water: I keep its GPU wave-equation heightfield and drop
its pool, caustics and ray-tracing pipeline. The ship models are built procedurally in code, and all effects
are procedural GPU particles. Nothing heavy is downloaded besides the JS bundle, which is how the 1–3 s load
target is met. The site deploys to Cloudflare Workers Static Assets with Wrangler, with `preview_urls: false`.

---

## 2. Key decisions

| Topic | Decision | Why |
|---|---|---|
| Tooling | Vite, **vanilla JS** template (as in README), ES modules, JSDoc types | Matches the README's setup command. Vite gives hashed, minified, tree-shaken output. |
| 3D | three.js latest (currently 0.186), `WebGLRenderer` only | WebGL2 runs on every target device. `WebGPURenderer` would add bundle weight and compatibility risk for no gain here. |
| Water | **Adapt** threejs-water instead of using it as is | See §5.2. The upstream demo is a *pool* (tiles, caustics, glass-clear water viewed from above). Each frame it renders several screen-sized render targets plus a ray-traced surface at full devicePixelRatio. It also downloads about 230 KB of JPGs. That is too heavy for entry-level phones and looks wrong for open sea. |
| Ship models | Procedural low-poly geometry, merged per ship, vertex colours, 1 draw call per ship (per half for ships that break) | No GLTF/texture downloads, small JS, cheap to render. |
| Assets | Zero image, font or model downloads. Noise and puff textures are generated at startup. System font stack. | Keeps the load budget for JS only. |
| Rules | 1990 Milton Bradley fleet: Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2 (17 cells). Ships are horizontal or vertical, may not overlap, **may touch**. Players **alternate single shots** (a hit gives no extra shot). The defender announces hit / miss / "sunk + ship type". | Classic rules from the Wikipedia reference. Salvo is a later option. |
| Turn order | Human fires first | Simple and feels good. The balance simulation accounts for the first-mover advantage. |
| AI fairness | The AI only receives what a human opponent would hear (hit / miss / sunk + type). It never imports or reads the player's board. | "Balanced and fun" needs an AI that is not cheating. The module boundary enforces this. |
| Deploy | Wrangler + Workers Static Assets (`assets.directory: ./dist`, `preview_urls: false`) | Matches the requirement. Pages-style `_headers` still works for cache headers. |

---

## 3. Project layout

```
index.html                 inline critical CSS + loading/title screen markup (paints before JS loads)
public/
  _headers                 cache rules (hashed /assets/* immutable, HTML revalidate)
  favicon.svg
src/
  main.js                  bootstrap: renderer, loop, wiring, readiness mark
  config.js                board size, fleet, timings, difficulty params, quality tiers
  game/                    *** no three.js imports allowed here ***
    rng.js                 seeded PRNG (mulberry32); ?seed= in URL for reproducible games
    board.js               grid, ship placement/validation, receiveShot -> {miss|hit|sunk, type}
    fleet.js               ship definitions, random fleet placement
    game.js                state machine + event emitter (phase, turn, results, stats)
    ai/
      common.js            AI interface: nextShot(), observe(cell, result, sunkType?)
      easy.js normal.js hard.js
  director.js              turn sequencer: logic result -> awaits animations -> next turn (pause-aware)
  render/
    renderer.js            WebGLRenderer setup, quality tier detection, adaptive resolution
    clock.js               game clock (stops when paused; all shader time uniforms use it)
    camera.js              fit-both / focus-one framing, tweens, shake
    sky.js                 procedural sky gradient + sun (shared with water reflection + fog)
    ocean/
      sim.js               adapted from threejs-water Water.js (ping-pong heightfield)
      swell.js             analytic swell params + JS sampler (same maths as GLSL)
      ocean.js             ocean mesh + material
      shaders/*.glsl       sim step / drop / normals (adapted), ocean surface (new)
    board/
      boardView.js         grid + aim/hover drawn in ocean shader, labels, hit/miss markers
      labels.js            canvas-generated label atlas (A–J, 1–10, "YOUR FLEET", "ENEMY WATERS")
    ships/
      parts.js             hull/turret/funnel/mast/deck primitives
      models.js            Carrier, Battleship, Cruiser, Submarine, Destroyer
      shipView.js          bobbing, damage state, reveal, sinking/breaking
    fx/
      particles.js         GPU instanced particle pools (additive + alpha), ring buffer
      textures.js          procedural puff/spark textures
      shell.js splash.js explosion.js fire.js sinking.js
  input/
    pointer.js             pointer events -> plane raycast -> cell; aim/fire; placement drag
    keyboard.js            arrows/Enter/Space/R/P/Esc
    noZoom.js              pinch/double-tap/gesture zoom blocking
  ui/
    hud.js overlays.js styles.css   (title, placement bar, HUD, pause, game over, fork ribbon, version)
  debug/
    testHook.js            window.__bs (only with ?e2e), exposes player-visible info only
    stats.js               ?stats overlay: fps, frame ms, draw calls, triangles, tier, DPR
tests/unit/*.test.js       Vitest: rules, placement, AI legality, game flow
scripts/
  sim.mjs                  headless balance simulation (bots vs AI difficulties)
  play.mjs                 Playwright "human" player: real clicks/taps, video recording
  loadtime.mjs             throttled load-time measurement
  version.mjs              commit-hash helper used by vite.config.js
wrangler.jsonc  vite.config.js  package.json
THIRD_PARTY_NOTICES.md     MIT notice for adapted threejs-water / WebGL Water code
```

`.gitignore` additions: `recordings/`, `test-results/`, `playwright-report/`, `.wrangler/`.

---

## 4. Game logic and AI (`src/game`)

### 4.1 State machine
`LOADING → TITLE → PLACEMENT → BATTLE(PLAYER_TURN ⇄ AI_TURN) → GAME_OVER`, with `PAUSED` available as an
overlay state from TITLE onwards.

- The logic is synchronous and pure, and each shot resolves immediately. `director.js` turns that into
  pacing: player input → `game.fire()` → await shell + impact animation → update HUD → (if not over) AI
  "thinking" delay → `ai.nextShot()` → `game.fire()` → await animation → hand back to the player.
- Input stays locked while the director is busy. Already-shot cells can't be targeted (shown with a
  "disabled" cursor/aim colour).
- Stats tracked: shots, hits, accuracy, turns, duration. They are shown on the game-over screen.

### 4.2 AI difficulties
All three use the same interface and only see public results. Ties are broken randomly with the seeded RNG.

| Level | Hunt mode | Target mode | Rough expected shots-to-win* |
|---|---|---|---|
| Easy ("Recruit") | uniform random | tries neighbours of hits, but drifts back to random hunting with probability *p_drift* | ~75–90 |
| Normal ("Captain") | checkerboard parity on the smallest remaining ship, plus a tunable *mistake rate* (random shot) | follows the line of consecutive hits, then the opposite end | ~55–65 |
| Hard ("Admiral") | probability density over all legal placements of the remaining ships (uses misses, hits, sunk types) | same density function weighted towards unresolved hits | ~42–48 |

\* Starting estimates from published Battleship strategy analyses. `scripts/sim.mjs` measures the real values
and tunes *p_drift* and the mistake rate.

AI ship placement is random and legal. Hard also lowers the chance of edge-hugging/clustered layouts so the
fleet is not easy to read.

### 4.3 Balance targets (checked by simulation, §8.2)
The "human proxy" bot is hunt/target with parity plus a little noise (≈ an attentive human, ~55–65 shots).
Its target win rate against each level, with the human moving first:
- Easy: ~80–90%
- Normal (default): ~55–65%
- Hard: ~25–35%

"Close game" metric: the share of games where the loser had ≤ 3 ship cells left to find. Normal should
maximise this.

---

## 5. Rendering

### 5.1 Scene layout and camera
- World units: 1 cell = 1 unit. The two 10×10 boards sit side by side on the same ocean ("YOUR FLEET" left,
  "ENEMY WATERS" right) with a gap, row/column labels on the outer edges and floating titles.
- Perspective camera tilted about 50–60° so the ships read as 3D and the grid stays easy to click.
- **One framing rule covers every screen size and aspect ratio.** If both boards fit with cells of at least
  about 30 CSS px, use **fit-both** mode. Otherwise use **focus** mode: the camera frames the board that
  matters (enemy board on the player's turn, own fleet while the AI fires) and pans smoothly between them. A
  tap-able tab/mini-map lets the player peek at the other board. Wide landscape screens get fit-both, and
  portrait phones or narrow windows get focus.
- Fitting projects the board bounding box (including ship height and HUD safe areas) and solves for the
  camera distance. It runs on every resize, so rotating the phone mid-game simply re-frames. No game state
  is touched and nothing is rebuilt.
- Small camera shake when the player's ships are hit. It is suppressed if `prefers-reduced-motion` is set.

### 5.2 Water: what is kept from threejs-water and what changes
**Kept / adapted** (MIT, Evan Wallace 2011 + Yong Su 2026; notice kept in file headers + `THIRD_PARTY_NOTICES.md`):
- `Water.ts`: ping-pong heightfield render targets (R height, G velocity, BA normals), `addDrop`,
  `stepSimulation`, `updateNormals`, and the float → half-float render target fallback.
- `WaveSimulation.frag`, `WaterRipple.frag`, `WaterNormal.frag`, including its iOS precision fixes (cleared
  targets, nearest filtering, clamped normal reconstruction).
- The Fresnel (Schlick) reflect/refract blending idea.

**Dropped:** pool walls/tiles, caustics pass, object reflection/refraction/shadow render targets, per-object
ray intersection, cubemap JPGs, lil-gui, three-mesh-bvh, vite-plugin-glsl (Vite `?raw` imports are enough).

**Changed / new:**
1. **Simulation domain.** One sim texture covers a rectangle around both boards plus a margin (high tier
   256×128, low tier 128×64). Pool walls reflect waves, so I replace the reflective boundary with an
   **absorbing sponge layer**, and the ocean shader fades the sim contribution to 0 at the domain edge.
   Ripples never "hit a wall".
2. **Fixed timestep.** Upstream runs 2 steps on every frame, so wave speed depends on frame rate. I switch to
   a 60 Hz accumulator capped at 2 steps per frame (30 Hz on the low tier).
3. **Analytic swell.** 3–4 summed Gerstner/sine waves at low amplitude give a gentle open-sea motion
   everywhere, including out to the horizon. The same function exists in GLSL (vertex displacement + normals)
   and JS (`swell.js`), so **ships bob on the CPU with zero GPU readback.** Interactive sim ripples are
   visual only.
4. **Sim sources.** Shell splashes (`addDrop`), explosions (stronger drops), sinking ships (repeated drops
   along the hull) and, on the high tier only, a tiny hull-bob ripple.
5. **Ocean surface shader** (new, single pass). It combines:
   - swell normals + sim normals + 2 scrolling procedural detail-normal layers (detail layers off on the low tier)
   - Fresnel blend of the procedural sky reflection and a deep/shallow water colour
   - sun specular
   - cheap crest "subsurface" tint
   - foam from sim velocity, impact rings and hull contact (ship footprints as a small uniform array)
   - a dark contact patch under hulls in place of real shadows
   - oil slicks where ships sank
   - distance fog into the sky colour
   - board grid lines (anti-aliased with `fwidth`), aim/hover highlight and placement validity tint, drawn
     directly in the water so they ride the waves
6. **Fallback.** If float/half-float render targets are unavailable, the interactive sim is disabled and the
   ocean runs on analytic swell alone. The game is still fully playable.

### 5.3 Ships
- Built from primitives (extruded tapered hull with pointed bow and rounded/transom stern, deck, red
  boot-topping at the waterline, superstructure blocks, turrets with barrels, funnels, masts/radar, carrier
  flight deck + island, submarine sail). Each model is merged into one `BufferGeometry` with vertex colours.
  Carrier and Battleship are built as **fore/aft halves** so they can break in two when sinking. One shared
  material: `MeshStandardMaterial` on high/medium tiers, `MeshLambertMaterial` on low.
- **Bobbing:** sample the swell at bow, stern, port and starboard → heave, pitch and roll, smoothed with a
  critically damped spring. The amplitude is clamped so a ship never visually leaves its cells.
- **Damage:** each hit cell gets a scorch darkening (a per-ship uniform/attribute mask) plus persistent fire
  and smoke emitters, attached to the ship so they bob with it.
- **Enemy fleet:** hidden until it is sunk. A hit on an enemy cell shows a red marker buoy + fire/smoke
  burning on the water. When a ship is sunk it is revealed (fade/rise in with its hit cells burning) and then
  plays the sinking sequence. On defeat, the surviving enemy ships are revealed on the game-over screen.
- **Markers:** misses are small white floating buoys and hits are red. They are instanced (one draw call per
  colour) and bob with the swell.

### 5.4 Effects
All particles are GPU-driven: `InstancedMesh` billboards whose per-instance attributes are spawn position,
velocity, spawn time, lifetime, size curve and colour ramp. Gravity and drag are computed in the vertex
shader from game-clock time, so the CPU only writes to a ring buffer on spawn. There are two pools:
additive (fire, sparks, muzzle flash) and alpha (smoke, spray, debris). The pool size depends on the tier
(about 2048 high, 512 low).

| Event | Effect |
|---|---|
| Fire | muzzle flash + smoke puff at the shooter (a random surviving player ship; AI shots come in from the horizon behind the enemy board), shell travels on an arc with a spark trail (~0.7–1.0 s) |
| Miss | water column spray + foam ring + sim drop |
| Hit | fireball, sparks, debris, smoke, brief flash from one reusable point light (always present, so materials never recompile), a sim drop, scorch mark, persistent fire/smoke on that cell |
| Sunk | chain of secondary explosions along the hull, list/roll, bow- or stern-first slide under. Big ships break in two and each half pivots and sinks. Bubbles + foam boil, smoke column, oil slick left behind. Water is opaque, so the surface clips the hull naturally. |

- All shaders and materials are compiled during loading with `renderer.compileAsync` and a hidden warm-up
  render of every effect, so the first explosion does not hitch.

### 5.5 Quality tiers and adaptive resolution
- **Initial tier** comes from WebGL caps, `WEBGL_debug_renderer_info` (GPU string), `hardwareConcurrency`,
  `deviceMemory`, touch/mobile hints and screen size.

  | Tier | DPR cap | Sim | Detail normals | Particles | Material |
  |---|---|---|---|---|---|
  | high | 2 | 256×128 @60 Hz | on | 2048 | Standard |
  | medium | 1.5 | 256×128 @60 Hz | on | 1024 | Standard |
  | low | 1 | 128×64 @30 Hz | off | 512 | Lambert |

- **At runtime** a frame-time monitor adjusts render resolution in 0.25 DPR steps (floor 0.75) and then drops
  a tier if p90 frame time stays above the target. Targets: 60 fps on PCs with integrated GPUs, a stable
  ≥30 fps on entry-level phones. Hysteresis lets it step back up.
- Render budgets: ≤ 60 draw calls typical (≤ 100 worst case during a sinking), ≤ 150k triangles, no shadow
  maps, no post-processing.

---

## 6. UI, input and responsive behaviour

### 6.1 Screens
- **Loading → Title (same screen).** Inline HTML/CSS in `index.html`, so it paints before any JS arrives.
  It has the title, a progress bar, and the "Fork me on GitHub" corner ribbon (inline SVG,
  `https://github.com/doublependu/battleship`). When it is ready, the progress bar turns into
  difficulty buttons + **Play**, with the live ocean visible behind it. The ribbon stays up the whole time.
- **Placement.** The fleet starts randomly placed, so the player can start immediately. The player can drag
  a ship to move it (snaps to cells, red tint when invalid), tap or click a ship to rotate it, or use the
  **Randomize**, **Rotate** and **Start Battle** buttons.
- **Battle HUD.** Turn/status line (e.g. "B7: Hit!", "You sank their Cruiser!"), a remaining-ships indicator
  for each side, a pause button, and the board tab/mini-map in focus mode.
- **Pause.** Opened with the button, Esc or P, and automatically on `visibilitychange`/blur. It stops the
  game clock, the director timers and the sim. It offers Resume, Restart and difficulty (applies next game),
  plus the **Fork me** ribbon.
- **Game over.** Victory/defeat, stats, revealed enemy fleet, Play again.
- **Version label** `v.<first 4 chars of commit>` in the **bottom-left** corner. That corner is reserved in
  every layout and offset by `env(safe-area-inset-*)`. It is small and semi-transparent, and also shown on
  the title and pause screens.

### 6.2 Input
- Pointer Events for mouse, touch and pen. Picking intersects the ray with the flat plane y=0
  mathematically, which is cheap and unaffected by waves.
- **Mouse:** hover highlight, click to fire.
- **Touch:** first tap aims (crosshair + cell name), tapping the same cell again (or a **Fire** button)
  fires. This prevents mis-taps on small screens.
- **Keyboard:** arrows move the aim, Enter/Space fires, R rotates during placement, P/Esc pauses.

### 6.3 Full screen, rotation and zoom
- `html, body, #app { position: fixed; inset: 0; overflow: hidden; height: 100dvh }` (falls back to
  `100vh`), `overscroll-behavior: none`, safe-area padding for the HUD.
- `ResizeObserver` on the container plus `visualViewport` resize. On each one: set the renderer size from the
  CSS size × capped DPR, update the camera aspect and re-fit (§5.1). This is safe mid-animation and
  mid-placement. No layout math depends on `orientationchange` timing.
- Zoom blocking:
  - viewport meta `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`
  - `touch-action: none` on the canvas and `manipulation` on buttons (removes double-tap zoom)
  - `preventDefault` on Safari `gesturestart/gesturechange/gestureend` and on multi-touch `touchmove`
    (passive: false)
  - `-webkit-text-size-adjust: 100%`, `user-select: none`, `-webkit-touch-callout: none`
  - no text inputs, which avoids iOS focus zoom
- Nice to have: a fullscreen toggle where the Fullscreen API exists (Android/desktop; iPhone Safari doesn't
  support it).

---

## 7. Load-time strategy and budgets

What "average internet" means: the global median mobile download is about 90 Mbps (Ookla, 2025–26). The
bottleneck on a cheap phone is therefore **JS parse + WebGL setup + shader compile**, not bandwidth.

- Critical path: `index.html` (inline CSS + loading markup, about 6 KB) → one module JS chunk (with
  `modulepreload`). There are no other critical requests.
- Budgets: **initial JS ≤ 200 KB brotli, total initial transfer ≤ 250 KB.** Size is checked on every build
  (a Vite build report; `npm run size` fails if a budget is exceeded).
- Non-critical code (effects, sinking, mini-map) goes in a dynamic `import()` prefetched at idle right after
  the first frame. It is guaranteed to be loaded before the player's first shot.
- Only named three.js imports, nothing from `three/examples` except `BufferGeometryUtils.mergeGeometries`
  (or a tiny local merge).
- Shaders are compiled asynchronously (`compileAsync`, which uses `KHR_parallel_shader_compile` where
  available) while the loading bar runs.
- "Ready" = ocean rendering + title screen interactive, marked with `performance.mark('bs-ready')`.
- **Targets** (measured by `scripts/loadtime.mjs`, §8.4):

  | Profile | Network | CPU | Target | Hard limit |
  |---|---|---|---|---|
  | Desktop | 20 Mbps / 60 ms RTT | none | ≤ 1 s | 4 s |
  | Mobile proxy | 10 Mbps / 100 ms RTT | 4× throttle | ≤ 2.5 s | 4 s |

- Cloudflare caching via `public/_headers`:
  `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`; HTML keeps the default revalidation.
  Cloudflare compresses with brotli automatically.

---

## 8. Testing, play scripts and balance

### 8.1 Unit tests (Vitest, Node, fast)
- placement validity (bounds, overlap, touching allowed)
- random fleet always legal (fuzz with 10k seeds)
- shot results / sunk detection / win detection
- no duplicate shots accepted
- AI never repeats a cell and never fires out of bounds
- the AI module never touches the opponent's `Board` (structural test: the AI only receives result objects)
- game flow and phase transitions

### 8.2 Balance simulation (`npm run sim`)
- Pure Node, using the same `src/game` modules: bots {random, novice, human-proxy, expert} × AI {easy,
  normal, hard}, about 10k games per pairing, with the human always moving first.
- Prints win rate, mean/median shots-to-win, the close-game share and a game-length histogram.
- Used to tune `p_drift` and the mistake rate until the §4.3 targets are hit. The final numbers go in `next_0.md`.

### 8.3 Human-play scripts (`npm run play`, Playwright with the installed Google Chrome)
- Runs against `vite preview` of the production build, opened with `?e2e&seed=<n>`.
- `window.__bs` (only with `?e2e`) exposes **player-visible state only**: phase, turn, idle flag, the shot
  results the player can see, own fleet, ready flag, fps, and `cellToClient(board, row, col)`. It never
  exposes hidden enemy ship positions, so the script has to play fairly, like a human.
- The script plays like a person:
  - waits for ready
  - picks a difficulty
  - placement: randomize, or drags a ship and rotates one, using real pointer events
  - plays the human-proxy strategy by **clicking/tapping projected screen coordinates**, which tests
    raycasting/picking end to end
  - pauses and resumes once
  - plays to game over, then Play again
- Options: `--games N --device desktop|pixel7|iphone13|tablet --difficulty --rotate --headed --speed`
  (`--speed` speeds animations up for bulk runs; default is real speed for reference recordings).
- `--rotate` swaps portrait/landscape **mid-game** (during placement, mid-shot animation and on the AI turn).
  After each swap it asserts:
  - canvas CSS size = viewport
  - drawing buffer = viewport × DPR cap
  - `visualViewport.scale === 1`
  - every board cell's projected point is on-screen, and clicking it targets that exact cell
- Pinch-gesture test (CDP touch emulation) asserts the page scale stays 1.
- Fails (non-zero exit) on any console error, page error or invariant violation:
  - one result per shot
  - the game ends exactly when 17 cells are hit
  - stats are consistent
  - ships never leave their cells
- **Recordings:** Playwright video (`.webm`), periodic screenshots, and a JSON log (seed, shots, results,
  timings, fps samples, errors) go to `recordings/<timestamp>-<device>-<difficulty>/`. This folder is
  gitignored and never committed. I review them to find visual bugs, pacing problems and fun/balance issues.
- Note: headless Linux Chrome may fall back to SwiftShader (software GL). That is fine for functional runs,
  but performance numbers come from headed runs with the GPU and from §8.4.

### 8.4 Performance and load scripts
- `npm run loadtime`: CDP network + CPU throttling for both profiles in §7, cold cache, 5 runs each. Reports
  the median/max time to `bs-ready` and fails above the hard limit.
- `npm run perf`: scripted heavy scene (several simultaneous fires + one sinking) with 4× CPU throttle. Logs
  frame-time p50/p90, draw calls and triangles from `?stats`.
- A real-device check needs a physical phone. I'll give you the steps (`npm run dev -- --host` on LAN, or
  the deployed URL + `?stats`), since I can't run them myself.

---

## 9. Versioning and deployment

- `vite.config.js` defines `__APP_VERSION__ = "v." + sha.slice(0, 4)`. `sha` comes from
  `WORKERS_CI_COMMIT_SHA` (Cloudflare builds) or else `git rev-parse HEAD`, with fallback `v.dev`. If the tree
  is dirty, the deploy script prints a warning, because the label shows HEAD and not the uncommitted changes.
  The label template itself stays exactly `v.xxxx`.
- `wrangler.jsonc`:
  ```jsonc
  {
    "name": "battleship",
    "compatibility_date": "<date at implementation>",
    "assets": { "directory": "./dist" },
    "preview_urls": false
  }
  ```
- npm scripts:
  - `dev`, `build`, `preview`
  - `test` (vitest), `sim`, `play`, `loadtime`, `perf`, `size`
  - `deploy` = `npm run build && wrangler deploy`
  - `deploy:dry` = `npm run build && wrangler deploy --dry-run`
- `wrangler` is a devDependency. I only run the dry run; you do the login and the real deploy (README).
- README update: setup, scripts, deploy, credits (threejs-water / WebGL Water, MIT).

---

## 10. Milestones (each one ends runnable and verified)

1. **Scaffold.**
   - Vite vanilla + three, folder layout, inline loading/title screen with fork ribbon, version label,
     `wrangler.jsonc`, `_headers`, `.gitignore` additions, `deploy:dry` passes
   - baseline bundle size recorded
2. **Game core.**
   - `src/game` rules, fleet, state machine, 3 AIs, Vitest suite, `npm run sim` with first balance numbers
   - no rendering yet
3. **Ocean.**
   - adapted sim (sponge boundary, fixed timestep), analytic swell, ocean shader, procedural sky + fog
   - quality tiers + adaptive DPR, responsive fit-both/focus camera, rotation handling, `?stats`
   - first load/perf measurement
4. **Playable game.**
   - grid/labels/aim in water, picking, markers, director + HUD, pause, game over, keyboard
   - placeholder box ships
   - full game playable on desktop and mobile emulation
5. **Ships.** Procedural models, bobbing, damage marks, reveal of the enemy fleet, placement drag/rotate/randomize.
6. **Effects.** Shell + muzzle flash, splash, explosion, persistent fire/smoke, sinking/breaking/oil slick, camera shake, shader warm-up.
7. **Play scripts and tuning.**
   - `npm run play` across devices/difficulties with `--rotate`, recordings reviewed
   - bugs fixed
   - AI tuned to §4.3 targets, pacing tuned (target round of about 2.5–3 s, a full game of about 3–4 min)
8. **Hardening.**
   - load/perf budgets met on both profiles, adaptive quality tuned
   - final `deploy:dry`, README/notice
   - write `ai/next_0.md`

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Full-screen water shader is fill-rate bound on entry-level phone GPUs | DPR cap 1 + cheap shader path on the low tier, adaptive resolution, single-pass ocean |
| Half-float render targets missing or imprecise (older iOS/Android) | Keep upstream precision fixes; analytic-only ocean fallback |
| Shader compile stalls (first load / first explosion) | `compileAsync` + warm-up renders during loading; constant light count |
| Waves make grid cells hard to read or click | Small swell amplitude near boards, grid drawn in the water shader, picking on a flat plane |
| iOS Safari zoom/viewport quirks can't be fully tested on Linux | Belt-and-braces zoom blocking; Playwright WebKit as a proxy; manual iPhone check listed in `next_0.md` |
| Headless WebGL slow or flaky in Playwright | Use installed Chrome, wait on `__bs.idle` instead of sleeps, `--speed` for bulk runs |
| AI too strong or too weak for real people | Tunable parameters + simulation targets + recorded play review; default Normal |
| Version label shows HEAD when deploying uncommitted work | Dirty-tree warning in the deploy script |
| Licence compliance for adapted water code | MIT notice in adapted files + `THIRD_PARTY_NOTICES.md` |

---

## 12. Assumptions (defaults I'll use unless you say otherwise)

1. 1990 Milton Bradley fleet; ships may touch; alternate single shots; human fires first.
2. Three difficulties, default **Normal**. Salvo mode is not in v1.
3. Plain JS (Vite vanilla template, as in the README) with JSDoc types, not TypeScript.
4. No sound in v1, since the prompt doesn't ask for it. Procedurally synthesised Web Audio SFX (about 2 KB,
   no downloads) would be the obvious next step.
5. Fork link target: `https://github.com/doublependu/battleship` (from `git remote`).
6. No analytics, accounts, persistence or multiplayer. The difficulty choice is stored in `localStorage` only.

---

## 13. Requirement checklist (prompt → where it's covered)

| Prompt requirement | Section |
|---|---|
| Classic Battleship, human vs AI, browser | §4, §6 |
| three.js 3D rendering | §5 |
| Real water (threejs-water), use or adapt | §5.2 (adapt, reasons in §2) |
| 3D battleship models moving with the waves | §5.3 |
| Explosions, sinking and destruction | §5.4 |
| Fork-me link on loading and pause screens | §6.1 |
| Static site, Wrangler/Cloudflare, `preview_urls = false` | §9 |
| Version `v.<4 chars of commit>` in an unused corner | §6.1, §9 |
| Responsive full screen, mid-game rotation, block stuck zoom | §5.1, §6.3, §8.3 |
| Human-play scripts, balance/fun, recordings not committed, bug finding | §4.3, §8.2, §8.3 |
| Load 1–3 s (≤4 s max) | §7, §8.4 |
| Runs well on integrated-GPU PCs and entry-level phones | §5.5, §8.4 |
