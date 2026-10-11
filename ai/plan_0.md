# Plan 0: 3D Battleship (human vs AI), three.js + adapted "real water"

Answers `ai/prompt_0.md`. Nothing has been built yet. This file only describes the plan.

---

## 1. Summary

A static single-page web game. You play classic 10×10 Battleship against an AI, and both fleets float on one
animated ocean. The game rules and the AI live in plain JavaScript with no rendering code, so they can be
unit-tested and simulated headlessly. Rendering uses three.js (`WebGLRenderer` + GLSL `ShaderMaterial`s).
The ocean is an adapted version of jeantimex/threejs-water, in four graphics tiers. Low, Medium and High keep
its GPU wave-equation heightfield and replace the rest with a cheap single-pass sea shader. **Ultra ("real
water")** keeps most of its pipeline (ray-traced reflection/refraction, object passes, caustics) with the pool
turned into a shallow seabed. At startup the client probes the device and browser, then benchmarks the live
ocean, and uses the result as the default. The player can lower or raise it in the settings. The ship
models are built procedurally in code, and all effects are procedural GPU particles. Battle sounds and
background sound (sea ambience + generative music) are synthesized with the Web Audio API, so they add no
downloads either. Nothing heavy is downloaded besides the JS bundle, which is how the 1–3 s load target is
met. The site deploys to Cloudflare Workers Static Assets with Wrangler, with `preview_urls: false`.

---

## 2. Key decisions

| Topic | Decision | Why |
|---|---|---|
| Tooling | Vite, **vanilla JS** template (as in README), ES modules, JSDoc types | Matches the README's setup command. Vite gives hashed, minified, tree-shaken output. |
| 3D | three.js latest (currently 0.186), `WebGLRenderer` only | WebGL2 runs on every target device. `WebGPURenderer` would add bundle weight and compatibility risk for no gain here. |
| Water | **Adapt** threejs-water, at two fidelity levels: a light sea shader (Low/Medium/High) and **Ultra**, which keeps most of upstream's pipeline | See §5.2. The upstream demo is a *pool* (tiles, caustics, glass-clear water viewed from above). Each frame it renders several screen-sized render targets plus a ray-traced surface at full devicePixelRatio, and it downloads about 230 KB of JPGs. That is too heavy for entry-level phones, but good GPUs can afford it, so it becomes the top tier instead of being dropped. Ultra also downloads nothing: its sky and seabed are procedural. |
| Graphics default | **Auto**: a static device/browser check, then a short live benchmark on the title screen, picks the tier. Low/Medium/High/Ultra can be chosen in the settings. | One fixed tier is either too heavy for cheap phones or wastes good GPUs. Measuring the real ocean on the real device beats guessing from the GPU name alone. |
| Ship models | Procedural low-poly geometry, merged per ship, vertex colours, 1 draw call per ship (per half for ships that break) | No GLTF/texture downloads, small JS, cheap to render. |
| Assets | Zero image, font, model or audio downloads. Noise and puff textures are generated at startup. System font stack. | Keeps the load budget for JS only. |
| Sound | Web Audio API, **all procedurally synthesized**, no audio library. One-shot effects are pre-rendered to buffers with `OfflineAudioContext`. Ambience and music run live. | No audio files, so the load budget is untouched. Buffer playback is cheap on entry-level phones. Nothing here needs Howler or Tone.js. |
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
    renderer.js            WebGLRenderer setup, adaptive resolution, live tier switching
    quality.js             device/browser probe, title-screen benchmark, Auto tier choice + persistence
    clock.js               game clock (stops when paused; all shader time uniforms use it)
    camera.js              fit-both / focus-one framing, tweens, shake
    sky.js                 procedural sky gradient + sun (shared with water reflection + fog)
    ocean/
      sim.js               ported from threejs-water src/Water.ts (TypeScript -> JS; ping-pong heightfield)
      swell.js             analytic swell params + JS sampler (same maths as GLSL)
      ripples.js           CPU ring-wave model of recent sim drops, so ships rock on ripples (§5.3)
      ocean.js             ocean mesh + material (Low/Medium/High)
      shaders/*.glsl       sim step / drop / normals (adapted), ocean surface (new)
      ultra/               lazy chunk, only loaded for the Ultra tier
        objectPasses.js    reflection / clipped reflection / refraction / shadow targets (from ObjectTexturePass.ts)
        caustics.js        caustics target (from CausticsPass.ts)
        seabed.js          procedural shallow seabed (replaces the pool), wreck resting
        skyCube.js         procedural sky rendered once into a cube target (replaces the cubemap JPGs)
        shaders/*.glsl     surface (from WaterAbove.frag), caustics, seabed
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
  audio/                   in the deferred chunk; a tiny no-op facade until loaded + first user gesture
    engine.js              AudioContext unlock, buses, limiter, reverb, suspend/resume, volume settings
    synth.js               procedural cue recipes rendered to AudioBuffers (OfflineAudioContext)
    sfx.js                 game/FX events -> cues: variants, panning, voice limit, ducking
    ambience.js            sea + wind bed, driven by swell.js
    music.js               generative score, lookahead sequencer, intensity states
  input/
    pointer.js             pointer events -> plane raycast -> cell; aim/fire; placement drag
    keyboard.js            arrows/Enter/Space/R/P/Esc
    noZoom.js              pinch/double-tap/gesture zoom blocking
  ui/
    hud.js overlays.js styles.css   (title, placement bar, HUD, pause, game over, fork ribbon, version)
    settings.js            graphics + sound settings panel, shared by the title and pause screens
  debug/
    testHook.js            window.__bs (only with ?e2e), exposes player-visible info only
    stats.js               ?stats overlay: fps, frame ms, draw calls, triangles, tier, DPR
tests/unit/*.test.js       Vitest: rules, placement, AI legality, game flow, tier decision, ripples, sound mapping
scripts/
  sim.mjs                  headless balance simulation (bots vs AI difficulties)
  play.mjs                 Playwright "human" player: real clicks/taps, video recording
  loadtime.mjs             throttled load-time measurement
  probe.mjs                Auto-tier probe check across CPU throttles and screen sizes
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
| Hard ("Admiral") | probability density over all legal placements of the remaining ships (uses misses, hits, sunk types), then picks among the highest-density cells with a softmax *temperature* τ. τ = 0 is the pure, strongest version | same density function weighted towards unresolved hits (τ not applied, so it finishes ships cleanly) | ~50–55 after tuning (pure density ≈ 42–48) |

\* Starting estimates from published Battleship strategy analyses. `scripts/sim.mjs` measures the real values
and tunes *p_drift*, the mistake rate and τ.

AI ship placement is random and legal. Hard also lowers the chance of edge-hugging/clustered layouts so the
fleet is not easy to read.

### 4.3 Balance targets (checked by simulation, §8.2)
The "human proxy" bot is hunt/target with parity plus a little noise (≈ an attentive human, ~55–65 shots).
Its target win rate against each level, with the human moving first:
- Easy: ~80–90%
- Normal (default): ~55–65%
- Hard: ~25–35%

Why Hard needs τ: at full strength (~42–48 shots) Hard beats a ~55–65-shot player about 90% of the time,
even when the player moves first. The 25–35% target is only reachable by softening its hunt mode, which
τ does while the AI still looks smart (it never fires at obviously empty water). If you'd like a merciless
top level later, τ = 0 can become a fourth difficulty.

"Close game" metric: the share of games where the loser had ≤ 3 ship cells left to find. Normal should
maximise this.

---

## 5. Rendering and sound

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
There are two water pipelines on one shared simulation. **Sea** (Low, Medium, High) is a light single-pass
shader. **Ultra ("real water")** keeps most of upstream's pipeline. Which one runs is decided per device
(§5.5) and can be changed live. Gameplay is identical on every tier.

**Kept / adapted in every tier** (MIT, Evan Wallace 2011 + Yong Su 2026; notice kept in file headers +
`THIRD_PARTY_NOTICES.md`):
- `src/Water.ts`, ported to JS: ping-pong heightfield render targets (R height, G velocity, BA normals),
  `addDrop`, `stepSimulation`, `updateNormals`, and the float → half-float render target fallback.
- `WaveSimulation.frag`, `WaterRipple.frag`, `WaterNormal.frag`, including its iOS precision fixes (cleared
  targets, nearest filtering, clamped normal reconstruction).
- The Fresnel (Schlick) reflect/refract blending.

**Dropped in every tier:** pool walls/tiles, the underwater camera view (`WaterBelow.frag`; the camera never
goes under), cubemap JPGs, the demo objects (sphere/cube/torus knot/duck) and their drag physics, lil-gui,
three-mesh-bvh, vite-plugin-glsl (Vite `?raw` imports are enough).

**Changed / new** (items 1–4 and 7 apply to every tier; 5–6 name their tiers):
1. **Simulation domain.** One sim texture covers a rectangle around both boards plus a margin (Ultra
   512×256, Medium/High 256×128, Low 128×64). Pool walls reflect waves, so I replace the reflective boundary
   with an **absorbing sponge layer**, and the water shader fades the sim contribution to 0 at the domain
   edge. Ripples never "hit a wall".
2. **Fixed timestep.** Upstream runs 2 steps on every frame, so wave speed depends on frame rate. I switch to
   a 60 Hz accumulator capped at 2 steps per frame (30 Hz on Low).
3. **Analytic swell.** 3–4 summed Gerstner/sine waves at low amplitude give a gentle open-sea motion
   everywhere, including out to the horizon. The same function exists in GLSL (vertex displacement + normals)
   and JS (`swell.js`), so **ships bob on the CPU with zero GPU readback.** Ships also rock on sim ripples
   through a CPU model of the same waves (§5.3), still without readback.
4. **Sim sources.** Shell splashes (`addDrop`), explosions (stronger drops), sinking ships (repeated drops
   along the hull). On High, a tiny hull-bob ripple; on Ultra, upstream's box volume displacement instead
   (see below).
5. **Sea surface shader** (Low/Medium/High; new, single pass). It combines:
   - swell normals + sim normals + 2 scrolling procedural detail-normal layers (detail layers off on Low)
   - Fresnel blend of the procedural sky reflection and a deep/shallow water colour
   - sun specular
   - cheap crest "subsurface" tint
   - foam from sim velocity, impact rings and hull contact (ship footprints as a small uniform array)
   - a dark contact patch under hulls in place of real shadows
   - oil slicks where ships sank
   - distance fog into the sky colour
   - board grid lines (anti-aliased with `fwidth`), aim/hover highlight and placement validity tint, drawn
     directly in the water so they ride the waves

   The game overlays (grid, aim, placement tint, foam, oil slicks, fog) live in one GLSL include, so the
   Ultra surface shader uses exactly the same ones.
6. **Shallow see-through near hulls (High).** This is a cheap stand-in for refraction, with no extra render
   targets. The ship shader tints and fogs fragments below the waterline towards the water colour by depth.
   Inside hull footprints, the water is drawn slightly transparent (alpha ~0.6–0.8, fading with distance from
   the hull). The submerged hull and the first metres of a sinking ship stay visible instead of being cut off
   at the surface.
7. **Fallback.** If float/half-float render targets are unavailable, the interactive sim is disabled and the
   ocean runs on analytic swell alone. Ultra is unavailable then. The game is still fully playable.

**Ultra tier ("real water"): most of threejs-water kept, adapted to open sea**
- **Sim height moves the geometry.** The sim height is added to the vertex displacement, not just the normals,
  on a dense patch over the boards (~256×128 quads) plus a coarse ring out to the horizon. The surface shader
  keeps upstream's 5-step parallax refinement of the sim lookup.
- **Ray-traced reflection and refraction with Fresnel** (from `WaterAbove.frag`). The refracted ray is traced
  against the seabed plane and each ship's hull box. The reflected ray is traced against the hull boxes, then
  the sky. Ships always lie along the grid axes, so upstream's axis-aligned slab test `intersectCube` fits as
  is. Bobbing tilt is small, and tilted sinking halves use their bounding box. At most 10 hull boxes (5 per
  side) are tested.
- **Object passes** (from `ObjectTexturePass.ts`). Ships and their persistent fires are rendered into
  reflection / clipped-reflection / refraction targets at half resolution (longest side capped at 1024, as
  upstream). These are sampled at the ray–box hit points, so hulls are seen through the water, refracted, and
  burning ships are reflected in it.
- **Seabed instead of the pool.** Refraction and caustics need a floor, so the pool becomes a shallow sandy
  seabed about 3 cells deep under the boards (deep enough for a whole wreck): procedural sand ripples and
  scattered rocks in the shader, no textures. Beyond the
  boards it fades into deep water through depth-based absorption. **Sunk ships come to rest on the seabed as
  wrecks** and stay visible for the rest of the game.
- **Caustics** (from `CausticsPass.ts`, differential-area method). Rendered from the sim into a 512² target
  (upstream 1024²) and projected onto the seabed, the wrecks and the submerged hulls. Ship footprints go into
  upstream's shadow target, so hulls cast shadows into the caustics.
- **Ship volume displacement** (upstream `moveCube`). Each ship's bob and sinking motion displaces the
  water, so hulls push out small ripples and sinking ships drag the surface down with them.
- **Sky** (replaces the cubemap JPGs): the procedural sky from `sky.js` is rendered once into a small
  `WebGLCubeRenderTarget` (128² per face). Still zero downloads.
- **Hidden ships stay hidden (all tiers).** Only visible ships feed the water: your fleet and enemy ships
  already revealed by sinking. Hidden enemy ships are never in the hull-box list, the object passes, the
  displacement, the shadow target or the foam/contact footprints. Otherwise a reflection or a ripple would
  give their position away. A play-script check covers this (§8.3).
- **Cost:** about 7–8 render passes per frame instead of 2–3. Ultra is only picked by Auto where the
  benchmark measures enough headroom (§5.5). Its code is a lazy chunk, and its shaders compile only when
  it is first used.

### 5.3 Ships
- Built from primitives (extruded tapered hull with pointed bow and rounded/transom stern, deck, red
  boot-topping at the waterline, superstructure blocks, turrets with barrels, funnels, masts/radar, carrier
  flight deck + island, submarine sail). Each model is merged into one `BufferGeometry` with vertex colours.
  Carrier and Battleship are built as **fore/aft halves** so they can break in two when sinking. One shared
  material: `MeshStandardMaterial` on Medium and above, `MeshLambertMaterial` on Low. On High and Ultra it
  gets an underwater depth tint (`onBeforeCompile`), and on Ultra also caustics on the submerged parts.
- **Bobbing:** sample the water height at bow, stern, port and starboard → heave, pitch and roll, smoothed
  with a critically damped spring. The amplitude is clamped so a ship never visually leaves its cells. The
  water height is the swell plus the ripples:
  - **Ripples** (`ripples.js`): every sim drop (splash, explosion, sinking) is also logged on the CPU as
    {position, time, strength}. A travelling ring packet, `A·e^(−d·t)·sin(k(r − c·t))` windowed around
    `r = c·t`, approximates its height anywhere. Wave speed `c` and damping `d` are calibrated against the
    GPU sim, so ships rock exactly when the visible ring passes under them. Up to ~16 live drops are summed
    at 4 points × 10 ships, which costs microseconds and needs no GPU readback.
  - **Hit impulse:** a hit on a ship adds a short roll/pitch kick away from the impact into the same spring.
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
| Sunk | chain of secondary explosions along the hull, list/roll, bow- or stern-first slide under. Big ships break in two and each half pivots and sinks. Bubbles + foam boil, smoke column, oil slick left behind. Low/Medium: the opaque surface clips the hull. High: the hull fades out through the shallow see-through layer. Ultra: the wreck sinks visibly through the water and settles on the seabed. |

- The current tier's shaders and materials are compiled during loading with `renderer.compileAsync` and a
  hidden warm-up render of every effect, so the first explosion does not hitch. A tier switch compiles and
  warms up the new tier's shaders the same way before swapping.

### 5.5 Quality tiers, device probe and graphics settings

| Tier | Meant for (the benchmark decides) | DPR cap | Water | Sim | Particles | Ship material |
|---|---|---|---|---|---|---|
| Low | entry-level phones, old iGPUs, software GL | 1 | sea shader, no detail normals | 128×64 @30 Hz | 512 | Lambert |
| Medium | mid-range phones, typical iGPU laptops | 1.5 | sea shader | 256×128 @60 Hz | 1024 | Standard |
| High | recent phones/tablets, good iGPUs | 2 | sea shader + see-through near hulls | 256×128 @60 Hz | 2048 | Standard + depth tint |
| Ultra | discrete GPUs, Apple M-series, strong iGPUs | 2 | real water (§5.2): ray-traced reflection/refraction, object passes, caustics, seabed, wrecks | 512×256 @60 Hz, moves geometry | 2048 | Standard + depth tint + caustics |

Frame budget: 60 fps (16.7 ms) on PCs, a stable ≥ 30 fps (33 ms) on phones and tablets.

**Device and browser probe** (`render/quality.js`). It runs in two stages, and neither delays `bs-ready`:
1. **Static check**, before the first frame (< 5 ms, no network):
   - **Browser capabilities:** WebGL2 (if missing, the loading screen shows a friendly "needs a WebGL2
     browser" message with the fork link still there; three.js no longer supports WebGL1), float or
     half-float colour buffers (none → sim off, Ultra off), `MAX_TEXTURE_SIZE`, `KHR_parallel_shader_compile`
     (without it, Ultra is never auto-enabled mid-game because compiling it could hitch),
     `EXT_disjoint_timer_query_webgl2`.
   - **Device hints:** GPU string from `WEBGL_debug_renderer_info`, `hardwareConcurrency`, `deviceMemory`
     (≤ 2 GB caps Auto at Medium), `userAgentData.mobile` / coarse pointer, screen pixels × DPR,
     `navigator.connection.saveData` (no auto-Ultra).
   - **GPU family table** (a few hundred bytes) maps the GPU string to a starting guess. Software renderers
     (SwiftShader, llvmpipe, Microsoft Basic Render Driver) → Low with the sim off. Old Mali/Adreno/PowerVR
     → Low. Adreno 6xx, Mali-G5x/G6x, Intel UHD → Medium. Adreno 7xx+, Immortalis, Apple mobile GPUs, Iris
     Xe, Radeon iGPUs → High. Apple M-series and discrete GeForce/Radeon/Arc → Ultra candidate.
   - Safari reports only "Apple GPU", and Firefox may mask the string, so the guess is just a start. I don't
     use the `detect-gpu` library because it fetches benchmark data at startup, an extra request on the
     critical path.
2. **Live benchmark on the title screen**, right after `bs-ready`, while the player reads the title:
   - The title ocean first renders at `min(guess, High)`, so Ultra is never on the critical path.
   - After 20 warm-up frames, 60 frames of the real ocean at the real screen size are measured. GPU time
     comes from the timer query where it exists. Elsewhere, a 1×1 `readPixels` on sampled frames measures
     submit-to-finish time. Frame *cost* is measured, not rAF intervals, because rAF caps would distort the
     result (iOS Low Power Mode 30 Hz, 120 Hz displays, throttled iframes).
   - If p90 cost is ≤ 50% of the frame budget, it loads/compiles the next tier up and tests it for 30
     frames. If ≥ 85%, it steps down. It stops when stable, within about 3 s. If the player presses Play
     first, it finishes during placement, which isn't timing-sensitive.
   - The result becomes the **Auto** tier. It is stored in `localStorage` keyed by GPU string + screen size +
     browser version. Return visits start at the stored tier and only run a short 30-frame check. A full
     probe runs again when the key changes.

**Graphics settings** (in the settings panel on the title screen and on the pause screen, next to sound):
- `Graphics: Auto (High) · Low · Medium · High · Ultra`. Auto shows what was detected. Lower tiers cut
  back, higher tiers improve. A tier above the detected one is marked "may run slowly on this device".
- Changes apply live without a reload. The new tier compiles in the background, then swaps in. Game state is
  untouched. The choice is stored in `localStorage`.
- `Show FPS` toggle (small readout next to the version label). `?quality=low|medium|high|ultra` overrides the
  probe for testing.

**At runtime** a frame-time monitor scales render resolution in 0.25 DPR steps (floor 0.75) within the
current tier. On **Auto**, it can also drop a tier if p90 stays over budget (for example, a phone heating up
after a few minutes). A small toast says "Graphics lowered to keep the game smooth", and hysteresis lets it
step back up. On a **manually chosen** tier it only adjusts resolution and never changes the tier.

**Render budgets:**
- Low–High: ≤ 60 draw calls typical (≤ 100 worst case during a sinking), ≤ 150k triangles.
- Ultra: ≤ 150 draw calls (the object passes redraw the visible ships), ≤ 250k triangles.
- All tiers: no shadow maps, no post-processing.

### 5.6 Sound: battle effects and background
**Approach.** Everything is synthesized with the Web Audio API, and there are no audio files. One-shot cues
(cannon, whistle, splash, explosions, sinking) are rendered once into `AudioBuffer`s with
`OfflineAudioContext`. This happens at idle after `bs-ready`, one cue at a time. Offline rendering doesn't
need a user gesture and runs off the main thread. Each cue gets 3 random variants (2 on Low),
rendered mono at 32 kHz to save memory (about 5–10 MB in total). At play time each cue is a cheap
`AudioBufferSourceNode` with random detune (±80 cents) and gain (±2 dB), so repeated hits never sound
identical. If a cue isn't rendered yet, it is skipped silently. Only the ambience bed and the music
sequencer run live.

**Audio graph**
```
sfx voices + fire loops ──> sfx bus ───────┐
sea + wind ──────────────> ambience bus ───┼──> master gain ──> limiter (DynamicsCompressor) ──> out
music ───────────────────> music bus ──────┘
            reverb send ──> shared ConvolverNode (generated ~1 s IR; Medium and above)
```
- The music bus ducks (about −6 dB for ~0.6 s) under big explosions and sinkings, so they cut through.
- The limiter keeps stacked explosions in a sinking chain from clipping.
- Stereo position uses `StereoPannerNode` (cheap) and not HRTF `PannerNode`. Pan = the event's projected
  screen x, so the panning stays right in both fit-both and focus camera modes.
- Voice limit per tier: Ultra/High 24, Medium 16, Low 10. When it's full, the oldest quiet voice is stolen.
  Burning-ship loops are capped at 4 (Low: 2).
- Cues are fired by the same director/FX events that start the visuals, and scheduled on the audio clock so
  they stay in sync. The shell whistle's length matches the shell's flight time.

**Battle sounds**

| Event | Sound |
|---|---|
| Player fires | cannon boom: noise burst through a falling low-pass + sub thump (sine 60→35 Hz) + short metallic ring, panned to the firing ship |
| AI fires | the same boom low-passed and quieter (distant, behind the horizon), then a rising "incoming" whistle |
| Shell in flight | descending whistle (band-passed noise + sine glide), length = flight time |
| Miss | splash: band-passed noise burst + bubbly tail (short random sine chirps) |
| Hit | explosion: bright crack transient + low-passed noise body (0.8–1.5 s) + sub thump + metal clang. Hits on your own fleet are louder and closer, matching the camera shake |
| Burning cell | quiet crackle loop per burning ship (sparse random clicks + low rumble), gain grows with the number of fires |
| Sunk | secondary explosions timed to the visual chain, a hull groan (resonant filter sweep), a break crack for ships that split, then bubbles + a big splash as it goes under. Music stinger |
| Placement / UI | snap tick, rotate swish, invalid buzz, randomize shuffle, button click, aim tick when the aim moves to a new cell (rate-limited) |
| Game over | victory fanfare or defeat motif, played by the music synth |

**Background sound**
1. **Sea ambience.** A looped pink/brown-noise wash through a low-pass. Its gain and cutoff follow the same
   swell function as the visuals (`swell.js`), so the waves you hear match the waves you see. A faint wind
   layer (band-passed noise, slow random modulation) sits on top. It runs on the title screen too, once
   sound is unlocked.
2. **Music.** A sparse, generative naval score in a minor mode: low drone/pad, timpani-like drum (pre-rendered
   buffer) and a plucked ostinato, played by a few live oscillator voices. A lookahead sequencer schedules
   ~100 ms ahead on the audio clock. Patterns come from the seeded RNG, so `?seed=` reproduces the score.
   Intensity follows the game state and crossfades on bar boundaries:

   | State | Music |
   |---|---|
   | Title / placement | calm: slow drone + pad, sparse motif |
   | Battle | adds a slow drum pulse + ostinato |
   | Tension (either side has 1 ship or ≤ 3 cells left) | faster pulse, higher ostinato, more drums |
   | Game over | victory/defeat stinger, then back to calm |

**Lifecycle and platform rules**
- Browsers only allow audio after a user gesture. The `AudioContext` is created and resumed inside the first
  tap/click/key on the title screen (at the latest, the **Play** button). Until then the title is silent and
  its speaker button shows that sound is waiting.
- Pause and `visibilitychange` (hidden) call `ctx.suspend()`, so sound freezes along with the game clock.
  Resume calls `ctx.resume()`.
- iOS: the `interrupted` state (calls, Siri, app switch) is resumed on the next gesture or visibility
  return. The ring/silent switch is respected (I don't force `navigator.audioSession.type = 'playback'`).
- If Web Audio is missing or throws, the game runs silently with no console errors.
- No reverb on Low, because convolution is the most expensive node on cheap Android phones.

**Settings.** A speaker (mute) button on the title screen, in the HUD next to pause, and on the pause
screen. `M` toggles mute. The settings panel (title and pause screens) has **Effects**, **Ambience** and
**Music** volume sliders.
Defaults: sound on, effects 100%, ambience 70%, music 50%. Stored in `localStorage` with the difficulty.

---

## 6. UI, input and responsive behaviour

### 6.1 Screens
- **Loading → Title (same screen).** Inline HTML/CSS in `index.html`, so it paints before any JS arrives.
  It has the title, a progress bar, and the "Fork me on GitHub" corner ribbon (inline SVG,
  `https://github.com/doublependu/battleship`). When it is ready, the progress bar turns into
  difficulty buttons + **Play**, with the live ocean visible behind it. The ribbon stays up the whole time.
  A speaker button unlocks sound (§5.6). Otherwise the first tap/click does. A settings button opens the
  shared settings panel: Graphics (Auto shows the detected tier, §5.5), Show FPS, and the sound volumes.
- **Placement.** The fleet starts randomly placed, so the player can start immediately. The player can drag
  a ship to move it (snaps to cells, red tint when invalid), tap or click a ship to rotate it, or use the
  **Randomize**, **Rotate** and **Start Battle** buttons.
- **Battle HUD.** Turn/status line (e.g. "B7: Hit!", "You sank their Cruiser!"), a remaining-ships indicator
  for each side, a pause button with a mute button next to it, and the board tab/mini-map in focus mode.
- **Pause.** Opened with the button, Esc or P, and automatically on `visibilitychange`/blur. It stops the
  game clock, the director timers, the sim and the audio. It offers Resume, Restart, difficulty (applies next
  game), the settings panel (graphics tier, Show FPS, Effects/Ambience/Music volume, mute), plus the
  **Fork me** ribbon. A graphics change made here is applied before Resume.
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
- **Keyboard:** arrows move the aim, Enter/Space fires, R rotates during placement, P/Esc pauses, M mutes.

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
- Sound adds no critical-path work. The audio code (about 5–8 KB brotli) is in the deferred chunk, there are
  no audio files, the `AudioContext` is only created on the first gesture, and cue buffers are rendered at
  idle after `bs-ready` (§5.6).
- Graphics tiers add no critical-path work either. The static probe takes < 5 ms. The title ocean starts at
  `min(guess, High)`, and the live benchmark runs after `bs-ready` (§5.5). The Ultra code (object passes,
  caustics, seabed, sky cube; about 15–25 KB brotli) is a separate lazy chunk. It is only fetched when the
  probe proposes Ultra or the player picks it, and it doesn't count towards the initial budget.
- Only named three.js imports, nothing from `three/examples` except `BufferGeometryUtils.mergeGeometries`
  (or a tiny local merge).
- The starting tier's shaders are compiled asynchronously (`compileAsync`, which uses
  `KHR_parallel_shader_compile` where available) while the loading bar runs.
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
- sound: event → cue mapping, voice stealing and settings persistence, with a stub audio context (Node has
  no Web Audio)
- quality: GPU-string classification and the tier decision (a pure function of probe inputs + benchmark
  samples → tier), including software GL → Low, no float buffers → no sim/Ultra, ≤ 2 GB → max Medium
- ripples: the CPU ring-wave model's arrival time and decay match the values calibrated from the GPU sim

### 8.2 Balance simulation (`npm run sim`)
- Pure Node, using the same `src/game` modules: bots {random, novice, human-proxy, expert} × AI {easy,
  normal, hard}, about 10k games per pairing, with the human always moving first.
- Prints win rate, mean/median shots-to-win, the close-game share and a game-length histogram.
- Used to tune `p_drift`, the mistake rate and Hard's τ until the §4.3 targets are hit. The final numbers go
  in `next_0.md`.

### 8.3 Human-play scripts (`npm run play`, Playwright with the installed Google Chrome)
- Runs against `vite preview` of the production build, opened with `?e2e&seed=<n>`.
- `window.__bs` (only with `?e2e`) exposes **player-visible state only**: phase, turn, idle flag, the shot
  results the player can see, own fleet, ready flag, fps, `cellToClient(board, row, col)`, `audio`
  (context state, active voices, a log of triggered cue names with game-clock times), and `quality`
  (detected tier, current tier, Auto or manual, probe samples, and the number of hulls fed to the water). It
  never exposes hidden enemy ship positions, so the script has to play fairly, like a human.
- The script plays like a person:
  - waits for ready
  - picks a difficulty
  - placement: randomize, or drags a ship and rotates one, using real pointer events
  - plays the human-proxy strategy by **clicking/tapping projected screen coordinates**, which tests
    raycasting/picking end to end
  - pauses and resumes once
  - plays to game over, then Play again
- Options: `--games N --device desktop|pixel7|iphone13|tablet --difficulty --quality auto|low|medium|high|ultra
  --rotate --switch-quality --headed --speed` (`--speed` speeds animations up for bulk runs; default is real
  speed for reference recordings).
- `--switch-quality` changes the graphics tier mid-game through the settings panel (Low → Ultra → Low,
  including during a sinking). It asserts that game state, aim and camera framing are unchanged and that
  there are no errors.
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
  - sound: every shot logs one fire cue and one outcome cue (splash or explosion), every sunk ship logs a
    sinking cue, pause → context `suspended`, resume → `running`, mute → master gain 0
  - hidden ships: on every tier, the number of hulls fed to the water always equals your ships + the enemy
    ships already sunk. Only the count is exposed, so this checks the rule without leaking positions.
- **Recordings:** Playwright video (`.webm`), periodic screenshots, and a JSON log (seed, shots, results,
  timings, fps samples, cue log, errors) go to `recordings/<timestamp>-<device>-<difficulty>/`. This folder is
  gitignored and never committed. I review them to find visual bugs, pacing problems and fun/balance issues.
- **Audio in recordings:** Playwright video has no audio track (and Playwright mutes output by default; the
  audio graph still runs). With `?e2e&recaudio`, the game taps the master bus into a
  `MediaStreamAudioDestinationNode` + `MediaRecorder`. The script saves `audio.webm` next to the video and, if
  `ffmpeg` is installed, muxes both into `gameplay.webm`, so sound sync and mix can be reviewed.
- Note: headless Linux Chrome may fall back to SwiftShader (software GL). That is fine for functional runs,
  including `--quality ultra` (slow but correct), but performance numbers come from headed runs with the GPU
  and from §8.4. On SwiftShader, Auto must pick Low, and the script asserts that.

### 8.4 Performance and load scripts
- `npm run loadtime`: CDP network + CPU throttling for both profiles in §7, cold cache, 5 runs each. Reports
  the median/max time to `bs-ready` and fails above the hard limit.
- `npm run perf`: scripted heavy scene (several simultaneous fires + one sinking) with 4× CPU throttle and
  sound on. Logs frame-time p50/p90, draw calls and triangles from `?stats`. Also checks that cue rendering
  causes no main-thread long tasks (> 50 ms) and finishes before the first shot is possible. It runs once
  per tier (`--quality`), and the Ultra numbers decide its "enough headroom" threshold.
- `npm run probe`: runs the Auto probe headed under each CPU throttle (1×, 4×, 6×) and window size (phone,
  laptop, 4K). It logs the static guess, benchmark samples, chosen tier and time to decide. It fails if the
  probe delays `bs-ready`, takes more than ~3 s, or picks a tier that then misses the frame budget in
  `npm run perf`.
- A real-device check needs a physical phone. I'll give you the steps (`npm run dev -- --host` on LAN, or
  the deployed URL + `?stats`), since I can't run them myself. That checklist includes noting which tier
  Auto picked on each phone and whether it feels smooth.

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
  - `test` (vitest), `sim`, `play`, `loadtime`, `perf`, `probe`, `size`
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
   - Low/Medium/High tiers, device probe (static check + title-screen benchmark), Auto + settings panel
     (Graphics, Show FPS), live tier switching, adaptive DPR
   - responsive fit-both/focus camera, rotation handling, `?stats`
   - first load/perf/probe measurement
4. **Playable game.**
   - grid/labels/aim in water, picking, markers, director + HUD, pause, game over, keyboard
   - placeholder box ships
   - full game playable on desktop and mobile emulation
5. **Ships.** Procedural models, bobbing on swell + CPU ripple model + hit impulses, underwater depth tint and
   see-through near hulls (High), damage marks, reveal of the enemy fleet, placement drag/rotate/randomize.
6. **Effects.** Shell + muzzle flash, splash, explosion, persistent fire/smoke, sinking/breaking/oil slick, camera shake, shader warm-up.
7. **Sound.**
   - audio engine (unlock, buses, limiter, suspend/resume, iOS interruption), mute button, `M`, volume sliders
   - battle cues synced to the effects, sea ambience, generative music with intensity states
   - cue log in `__bs.audio`, audio capture for recordings, tier voice limits
8. **Ultra water.**
   - lazy Ultra chunk: sim height in geometry + parallax refinement, ray-traced reflection/refraction against
     hull boxes, object passes, seabed, caustics + ship shadows, `moveCube` displacement, procedural sky cube
   - wrecks resting on the seabed, hidden-ship rule enforced, probe allowed to pick Ultra
   - side-by-side screenshots of all four tiers on the same seed for review
9. **Play scripts and tuning.**
   - `npm run play` across devices/difficulties/tiers with `--rotate` and `--switch-quality`, recordings reviewed
   - bugs fixed
   - AI tuned to §4.3 targets (including Hard's τ), pacing tuned (target round of about 2.5–3 s, a full game
     of about 3–4 min)
   - sound mix tuned from the muxed recordings (levels, ducking, repetition fatigue)
10. **Hardening.**
    - load/perf budgets met on both profiles and every tier, probe thresholds tuned with `npm run probe`
    - final `deploy:dry`, README/notice
    - write `ai/next_0.md`

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Full-screen water shader is fill-rate bound on entry-level phone GPUs | DPR cap 1 + cheap shader path on Low, adaptive resolution, single-pass sea shader; the probe benchmarks before choosing |
| Half-float render targets missing or imprecise (older iOS/Android) | Keep upstream precision fixes; analytic-only ocean fallback |
| Shader compile stalls (first load / first explosion) | `compileAsync` + warm-up renders during loading; constant light count |
| Waves make grid cells hard to read or click | Small swell amplitude near boards, grid drawn in the water shader, picking on a flat plane |
| iOS Safari zoom/viewport quirks can't be fully tested on Linux | Belt-and-braces zoom blocking; Playwright WebKit as a proxy; manual iPhone check listed in `next_0.md` |
| Headless WebGL slow or flaky in Playwright | Use installed Chrome, wait on `__bs.idle` instead of sleeps, `--speed` for bulk runs |
| AI too strong or too weak for real people | Tunable parameters + simulation targets + recorded play review; default Normal |
| Version label shows HEAD when deploying uncommitted work | Dirty-tree warning in the deploy script |
| Licence compliance for adapted water code | MIT notice in adapted files + `THIRD_PARTY_NOTICES.md` |
| Autoplay rules / iOS interruptions leave the game silent | Unlock on the first gesture; resume on the next gesture or visibility return; speaker button shows the state |
| Synthesized sounds feel cheap or repetitive | Layered recipes, random variants + detune, reverb, mix tuned from recordings. Any single cue can later be swapped for a small lazily loaded CC0 recording without changing the event mapping |
| Audio CPU/memory on entry-level phones | Pre-rendered mono 32 kHz buffers, voice cap per tier, no reverb on Low |
| Sinking chains turn into clipping noise | Master limiter, music ducking, per-cue cooldowns |
| Probe picks a tier that is too heavy (benchmark noise, phones heating up later) | Conservative thresholds (step up only at ≤ 50% of budget), runtime monitor drops a tier on Auto, player can always lower it |
| GPU string masked or generic (Safari "Apple GPU", Firefox) | The static guess is only a starting point; the live benchmark decides |
| Ultra too heavy even on good iGPUs | Half-resolution object passes, 512² caustics, only auto-picked with measured headroom; it stays available manually |
| Tier switch mid-game hitches or breaks state | Compile + warm up before swapping, swap only between frames, game state lives outside the renderer; `--switch-quality` test |
| Water reveals hidden enemy ships (reflection, refraction, ripples, foam) | Only visible ships feed the water, on every tier; play-script count check (§8.3) |
| Players notice wrecks only on Ultra and think other tiers are missing something | Tiers are cosmetic and gameplay is identical; the settings panel describes what each tier adds |

---

## 12. Assumptions (defaults I'll use unless you say otherwise)

1. 1990 Milton Bradley fleet; ships may touch; alternate single shots; human fires first.
2. Three difficulties, default **Normal**. Salvo mode is not in v1.
3. Plain JS (Vite vanilla template, as in the README) with JSDoc types, not TypeScript.
4. Sound is in v1 (§5.6) and on by default, though browsers only let it start after the first tap/click.
   Everything is synthesized, with no audio files. The music is a generative synth score, not a recorded
   orchestral track. If you want a composed/recorded soundtrack, it can be lazy-loaded after `bs-ready`
   (about 0.5–1 MB Opus) without affecting the load budget.
5. Fork link target: `https://github.com/doublependu/battleship` (from `git remote`).
6. No analytics, accounts, persistence or multiplayer. Only the difficulty, sound and graphics settings (plus
   the Auto probe result) are stored, in `localStorage`.
7. Graphics default is **Auto** (the probe result). Tiers are cosmetic, and gameplay, AI and timing are
   identical on every tier. The Ultra seabed makes the board area a shallow, clear sea (reef-like) rather
   than deep ocean. That is the price of keeping refraction and caustics, which need a floor to show.
8. Hard is softened with τ to reach the 25–35% target. A full-strength level is not in v1.

---

## 13. Requirement checklist (prompt → where it's covered)

| Prompt requirement | Section |
|---|---|
| Classic Battleship, human vs AI, browser | §4, §6 |
| three.js 3D rendering | §5 |
| Real water (threejs-water), use or adapt | §5.2 (adapted; Ultra keeps most of it), reasons in §2 |
| 3D battleship models moving with the waves | §5.3 (swell + sim ripples + hit impulses) |
| Explosions, sinking and destruction | §5.4 |
| Battle sound and background sound (added in review, not in `prompt_0.md`) | §5.6, §6.1 |
| Device/browser probe picks the graphics default; player can lower or raise it (added in review) | §5.5, §6.1, §8.4 |
| Fork-me link on loading and pause screens | §6.1 |
| Static site, Wrangler/Cloudflare, `preview_urls = false` | §9 |
| Version `v.<4 chars of commit>` in an unused corner | §6.1, §9 |
| Responsive full screen, mid-game rotation, block stuck zoom | §5.1, §6.3, §8.3 |
| Human-play scripts, balance/fun, recordings not committed, bug finding | §4.3, §8.2, §8.3 |
| Load 1–3 s (≤4 s max) | §7, §8.4 |
| Runs well on integrated-GPU PCs and entry-level phones | §5.5, §8.4 |
