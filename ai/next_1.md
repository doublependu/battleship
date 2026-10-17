# Next 1: what was built for plan 1, and what to do next

Implements `ai/plan_1.md` (answers `ai/prompt_1.md`). Nothing is committed or deployed. That's for you.

---

## 1. What changed

| Item | Where | Notes |
|---|---|---|
| Sunk ships "on High" | `src/main.js`, `src/ui/overlays.js` | You were on Ultra. Auto starts on High and its benchmark moves to Ultra 1–2 s later, usually after PLAY. Now: a toast "Graphics: Ultra (auto)" when Auto changes the tier after the title, the tier on the pause screen, and "(auto, checking…)" on the title while Auto is deciding. |
| Wrecks follow the tier on screen | `src/render/ships/shipView.js` (`settle()`), `fleetView.js` | Ultra shows every sunk ship as a wreck, including ships sunk on another tier. Leaving Ultra hides them. A sinking under way ends the new tier's way. Replaces deviation 6 of `next_0.md`. |
| Play with a friend | `src/net/` (`company.js`, `play.js`, `table.js`, `sha256.js`), `src/main.js`, `src/ui/*`, `index.html` | Ported from the reference (`p3p2_test_repos/battleship`, branch `p3p2`) onto `@p3p2/client@^0.1.1` from npm. Same design: a promise per fleet, each page answers the shots at its own fleet, both fleets are revealed and checked at the end. |
| More games on Maize.Live | `index.html` (title/loading), `src/ui/overlays.js` (pause) | In the page layout, so it can't overlap buttons. Opens in a new tab. |
| Tests | `tests/unit/shipView.test.js`, `tests/unit/table.test.js` | 60 unit tests (was 49). New: wrecks per tier, table rules and SHA-256 (from the reference), fleet-store pruning. |
| `scripts/friends.mjs` (`npm run friends`) | new | Two admirals and a watcher play a whole battle through a real p3p2 server, by clicking cells. `--engines` puts Firefox and WebKit at the table, and `--via` routes it through p3p2's lag proxy. |
| `scripts/play.mjs` | | Checks the number of wrecks after each tier switch and at game over, and checks the Auto toast. Shot numbers in its messages. The tier switch moved from shot 10 to shot 24, so some ships have sunk by then. |
| `scripts/loadtime.mjs` | | `--invite`: opens the game from an invite to a server that never answers. |
| Docs | `README.md`, `THIRD_PARTY_NOTICES.md` | How to play with a friend and test it, the tiers and wrecks, the new script, notices for `@p3p2/client` and lean-qr. |

**Changes from the reference port:**
- **Lazy room code.** `play.js` and `table.js` load only with the first room, and `openCompany()` runs after `bs-ready`.
- **Chat key.** Chat opens with **T**, because Enter both fired and opened chat (the panel's Enter listener ignores `defaultPrevented`).
- **Fleet storage.** Saved fleets are removed once revealed, and at most 10 are kept.
- **Wrecks after a rebuild.** Ships that sank before the page came in are placed with `settle()`.
- **"Menu", not "Paused".** In a room the pause menu is titled "Menu".
- **People button.** It's an SVG icon.

## 2. Measured (this machine, headless Chrome; HEAD measured in the same session for comparison)

- **Bundle** (`npm run size`): initial JS **143.9 KB** brotli (HEAD 139.5; budget 200), initial transfer **147.2 KB** (HEAD 142.5; budget 250).
  The p3p2 entry is 2.1 KB. The room code (play 4.0 KB, table 2.8 KB) and p3p2's room client, panel and QR (~13 KB)
  are deferred. An ordinary visit loads none of them and contacts no server (checked by `friends.mjs`).
- **Load to `bs-ready`** (`npm run loadtime`, 5 runs, median / max):

  | Profile | HEAD | Now | Now, `--invite` |
  |---|---|---|---|
  | Desktop, 20 Mbps / 60 ms | 306 / 415 ms | 314 / 529 ms | 339 / 436 ms |
  | Mobile proxy, 10 Mbps / 100 ms, 4× CPU | 693 / 751 ms | 723 / 749 ms | 738 / 862 ms |

- **Perf** (`npm run perf`): unchanged. All four tiers hold 60 fps (p90 16.7 ms), no long tasks.
- **Play** (`npm run play`, speed 3): 7 games, all checks passing, including the new wreck and toast checks:
  - desktop on Auto ×3
  - Pixel 7 with `--rotate --switch-quality` (seed 12)
  - iPhone 13 on High / Admiral
  - iPhone 13 with `--rotate --switch-quality`
  - tablet on Ultra / Recruit

  The Auto runs show the toast, e.g. "tier high -> ultra after PLAY, toast: Graphics: Ultra (auto)".
- **Friends** (`npm run friends` against a p3p2 0.1.1 server from your checkout, in-memory, on :8090). All checks passed in:
  - a plain run
  - `--engines` (Ada in Chrome, Grace in Firefox, the watcher in WebKit on an iPhone 13 screen)
  - `--via` the lag proxy (150 ms each way, 50 ms jitter, every connection cut every 30 s)

  What it checks:
  - an ordinary visit loads no room code
  - the first two to arrive sit and the third watches
  - before the end the room holds only promises, never fleets
  - Enter fires without opening chat, T opens it, and Escape closes it without pausing
  - a reload mid-battle restores the table and the fleet
  - a shot at a closed page waits until the page is back
  - all pages agree on the table after every round
  - the watcher sees no ships afloat
  - both fleets are found as promised
  - Ada's browser no longer keeps her fleet after the reveal, and Grace sees Ada's unfound ships
  - the panel fits a phone both ways round
  - the menu works after "View the boards"
  - the next battle swaps who fires first

## 3. Deviations from plan 1 (and why)

1. **The 👥 button sits top right in a game**, not beside pause and sound. Next to them it covered the status line on
   narrow phones. Top right has room, and it's where the panel opens.
2. **Short-screen layout** for the title and pause screens (`max-height: 520px`). On a phone on its side, the new
   button and link pushed the title off the top and the link off the bottom. The pause menu now uses two columns there.
3. **Small additions to the room**: at the end, the other fleet's unfound ships appear where they were. A watcher's
   board tabs name the two admirals. The music follows the room's battle. The menu opens after a battle ends, so
   "Next battle" and "Leave the table" stay reachable after "View the boards"; before, the menu couldn't be opened
   once a game was over.
4. **Two pre-existing bugs fixed along the way:**
   - The sinking curve overshot its floor, so wrecks lay about 0.1 below the seabed.
   - `CameraRig.show(…, immediate)` reported `settled` before the camera had moved. A cell projected in that frame was
     wrong. It made `npm run play` fail on Pixel 7 seed 12 (same failure on HEAD). Players weren't affected.
5. **The scripts start `vite preview` directly, not through `npx`.** `kill()` only stopped `npx`, which left a
   preview server running on :4173.
6. **The p3p2 repo's battleship spec was not run.** `~/Repos/mine/private/p3p2-private` holds the spec but not the
   Playwright config and helpers it imports, and I didn't want to change another repo. `friends.mjs` covers the same
   ground (three engines, lag, drops, reload, away). It doesn't cover the cost measurement. The hooks that spec uses
   are kept (`__bs.room`, `hullHits`, and `__bs` in dev builds).
7. **Size**: +4.4 KB initial, a bit over the ~3 KB I estimated. Rolldown splits the modules shared with the lazy room
   chunk (config, game, swell) into small chunks of their own.

## 4. Not verified / known limitations

- **No real phones, no real iOS Safari.** WebKit was emulated on Linux.
- **No deployed p3p2 server.** The deployed game is on https, so its rooms need a p3p2 server on https too (a page on
  https can't open `ws://`). LAN play over http works, which is why SHA-256 is plain JS.
- **A player who stops answering stalls the battle.** The other admiral can only leave. A modified page that lies
  is caught at the reveal, but one that never reveals is not.
- **A watcher sees marks, not ships.** Watchers have no ship views, so sunk ships aren't drawn for them. This is as in
  the reference.
- **p3p2 quirk.** After Grace closed her tab and reopened the invite, the panel briefly listed her twice: the closed
  tab's member stays for the server's grace period. That comes from p3p2, not the game.
- **One placement screenshot** on a small phone showed only one of five ships drawn. I couldn't reproduce it in
  several runs, either at HEAD or now, so I've left it as a one-off of the headless GPU.
- **I can't listen**, so I haven't heard the music changes in a room.

## 5. What to do next

1. **Commit and deploy** (`npm run deploy`).
2. **Choose a p3p2 server for players** (plan 1, open question 1). It must be on https for the deployed game. Once
   you have one, a line under "Play with a friend" could point to where to get a room URL.
3. **Two real phones on the LAN**: `npm run dev -- --host`, a p3p2 server on the LAN address, a room for
   `http://<LAN address>:5173/`. Check:
   - the panel and keyboard on iOS
   - a shot while the other phone is locked
   - rotating in the middle of a battle
4. **Possible room features**: a time limit for an admiral who stops answering; ship views for watchers (sunk ships
   and the end reveal); tension music near the end as in solo play.
5. **Leftovers from `next_0.md`** still apply: real-device tier checks, probe thresholds, human play-tests for
   balance.
