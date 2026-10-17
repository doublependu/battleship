# Plan 1: sunk ships on "High", play with a friend (p3p2), and a Maize.Live link

Answers `ai/prompt_1.md`. Nothing has been built yet. This file only describes the plan.

---

## 1. Summary

1. **Issue: sunk ships seen "on High".** On High, a sunk ship should only be visible while it goes down, and
   then it is gone. Only Ultra keeps wrecks on the seabed. I reproduced what you most likely saw: **Auto starts
   every visit on High** (Ultra is never on the critical path), so the title says "Graphics: High (auto)".
   **1–2 s later it switches to Ultra**, usually after you have already pressed PLAY, and nothing in the game
   tells you. So you were on Ultra, which has wrecks. The fix makes the tier you're on visible, and makes wrecks
   follow the current tier instead of the tier at the moment the ship sank (§2).
2. **Feature: play with a friend.** Port the working p3p2 integration from the reference
   (`~/Repos/mine/public/p3p2_test_repos/battleship`, branch `p3p2`, commit `5c9952f`). It started from the same
   `itr 0` commit as this repo, and its one game fix (`cellLocalX`) is already on `main` as `df75b78`. Use the
   published `@p3p2/client@^0.1.1` from npm instead of its vendored tarball. Fix a few things I found while
   reading it: Enter both fires and opens chat, the room code adds weight to every visit, and saved fleets pile
   up in storage (§3).
3. **Feature: "More games on Maize.Live"** on the loading/title screen and the pause screen. It sits in the
   page layout so it can't overlap buttons on short screens (§4).

---

## 2. Issue: sunk ships seen "on High"

### 2.1 What each tier is meant to show

| Tier | While sinking (≈4.8 s) | Afterwards |
|---|---|---|
| Low / Medium | Goes under the opaque surface | Hidden |
| High | Seen going down through the clear patch of water around its hull (`SEE_THROUGH`) | Hidden (`group.visible = false`) |
| Ultra | Seen going down through clear water | Stays as a wreck on the seabed, 3 m down (by design, `next_0.md` §3.6) |

### 2.2 What I checked (Playwright, headless Chrome, this machine; scripts in the scratchpad, not committed)

- `?quality=high`: I sank a Destroyer and a Carrier. Both were visible while going down and hidden once
  `sunk` (`visible=false`, y = −4.0). Frames at 3 s and 9 s confirm it. **High itself works as designed.**
- **Auto (no `?quality`)**, on the first and second visit: when the page is ready, the title says
  `Graphics: High (auto)` and the tier is `high`. One to two seconds later the tier is `ultra`, already
  during placement. The hint updates only on the title screen, which is gone by then, and no toast is shown.
  The only toast is for a downgrade ("Graphics lowered…").
- I sank a ship on Ultra, then switched to High: the wreck stays `visible=true` at y = −2.6. The opaque water
  hides it, but it still costs draw calls. It can also show through the clear patch around a ship afloat next
  to it.

### 2.3 Fix

1. **Show the tier you're on.**
   - When Auto changes the tier *after* the title screen (in either direction), show a toast:
     "Graphics: Ultra (auto)". Downgrades keep their existing message.
   - The pause screen gets a small line "Graphics: Ultra (auto)" under the buttons, the same text as the
     title hint.
   - While Auto is still deciding, the title hint says "Graphics: High (auto, checking…)".
2. **Wrecks follow the current tier.** Today, what you see depends on the tier at the moment of sinking. After
   the fix it depends on the tier you're on now.
   - `ShipView.settle(ultra)`: for a sunk ship, Ultra puts it at its wreck pose: on the seabed, listing, halves
     broken apart, burnt, every cell hit. That is the same pose the sinking animation ends in today. Any other
     tier hides it.
   - `FleetView.prepareTier().apply()` calls `settle(tier.ultra)` on every sunk view. A sinking that is still
     running takes the new tier's ending (`sinking.ultra = tier.ultra`).
   - The multiplayer rebuild (§3) draws ships that sank before the page came in with `settle()` too. That
     replaces the reference's `group.visible = false`, so a page that joins later shows the same seabed.
   - This replaces deviation 6 of `next_0.md` ("wrecks only for ships sunk while on Ultra").
3. **Say it in the README** ("Graphics tiers"): sunk ships stay on the seabed only on Ultra.

### 2.4 Tests

- Unit (`tests/unit/shipView.test.js`): a sunk ship is hidden by `settle(false)`, and `settle(true)` shows it at
  the seabed with the wreck pose. A tier switch in the middle of a sinking ends with the new tier's result.
- `npm run play -- --switch-quality` (Low → Ultra → Low mid-game) gets a new check: the number of visible sunk
  ships equals the number sunk on Ultra and is 0 on other tiers. A second new check: the toast appears when Auto
  moves to Ultra during placement.

---

## 3. Feature: play with a friend (p3p2)

### 3.1 Design (kept from the reference)

- **Two admirals, anyone else watches.** The first two in the room take the seats. The battle lives in the
  room's log, so it can go on over days. A shot at an admiral who is away waits until their page is back.
- **Each fleet stays in its own browser.** When an admiral is ready, their page puts a promise in the log:
  SHA-256 of the fleet plus a random salt. The fleet itself goes to `localStorage` under that promise.
- **The defender's page answers each shot by itself**, from the fleet, as soon as it sees the shot. The admiral
  only needs the page open, not to be at the keyboard.
- **At the end both pages reveal their fleets.** Every page checks each fleet against its promise and against
  every answer given. A fleet that doesn't match loses, and every screen says so.
- SHA-256 is plain JS (`src/net/sha256.js`), because `crypto.subtle` exists only on https/localhost pages and
  LAN play is over http.
- **Ops**: `sit`, `stand`, `ready {commit}`, `shot {k,r,c}`, `answer {k,result,ship?}`, `resign`,
  `reveal {fleet,salt}`, `new`. All are checked in `Table.apply`, so every page builds the same table from the
  same log. `new` swaps the seats, so the other admiral fires first in the next battle.
- **Switched off in a room**: the AI, the difficulty picker, Restart, and the auto-pause on blur or a hidden tab.
  The battle goes on, and the page keeps answering.
- `game.version` is the format of the ops (`TABLE_VERSION = '1'`), not the build hash, so two different deploys
  can share a room as long as the ops are the same. Bump it whenever an op changes.

The API of the published `@p3p2/client@0.1.1` matches the reference's vendored `0.0.0`: I diffed
`types.d.ts` and `index.d.ts`, and only one comment changed. The published `README` adds one setup step,
`optimizeDeps.exclude`.

### 3.2 Files

| File | Change |
|---|---|
| `package.json` | `npm install @p3p2/client` (^0.1.1) |
| `vite.config.js` | `optimizeDeps: { exclude: ['@p3p2/client'] }` (from the client's README: otherwise the dev server hands out the whole library in one piece) |
| `src/net/company.js` | New, static, small. Creates `P3P2` and wires `room` / `leave`. Imports `play.js` + `table.js` **only when a room starts** (§3.4) |
| `src/net/table.js`, `src/net/sha256.js` | From the reference, unchanged except the fleet-store note |
| `src/net/play.js` | From the reference. `sinkAt(…, live=false)` uses `settle()` (§2.3). The fleet store is pruned (§3.3) |
| `src/main.js` | `S.room` branches in `fireAt`, `canFireNow`, `startBattle`, `setPaused`, visibility/blur, overlay actions. `openCompany(ctx)` is called **after `bs-ready`**. The `__bs.room` and `__bs.hullHits` hooks, and `__bs` in dev builds (an invite link has no `?e2e`) |
| `src/ui/hud.js` | People button beside pause and sound, `setNames()`, `setReadyLabel()` ("Ready" in a room) |
| `src/ui/icons.js` | An SVG "people" icon in the style of pause and sound. An emoji looks different on every OS |
| `src/ui/overlays.js` | Pause menu in a room (take the free seat / next battle / resign / leave the table; no restart or difficulty; heading "Menu" because the battle doesn't stop), the room's end screen with a verdict line per fleet |
| `index.html` | "👥 Play with a friend" under PLAY, in the inline markup like the rest of the title. Subtitle: "Against the AI or a friend, on real water" |
| `src/render/board/labels.js`, `boardView.js` | `setTitles()`: a watcher sees "ADA'S FLEET / GRACE'S FLEET" over the boards |
| `src/input/keyboard.js` | No change needed (see §3.3, chat key) |
| `tests/unit/table.test.js` | From the reference (sha256 vectors, fleet validity, table rules, snapshot = replay) plus the new pruning test |
| `scripts/friends.mjs` | New two-browser test (§3.6) |
| `README.md`, `THIRD_PARTY_NOTICES.md` | How to play with a friend and test it locally. Notices for `@p3p2/client` (MIT) and the `lean-qr` it bundles (MIT) |

### 3.3 Changes from the reference

1. **npm package, not `vendor/p3p2-client.tar.gz`**, plus the `optimizeDeps` line.
2. **Enter both fires and opens chat.** The panel listens for its `chatKey` (default Enter) on `window` and
   doesn't check `defaultPrevented`, so in a room Enter fires at the aimed cell *and* opens chat. I'll set
   `ui.chatKey: 't'`, which the game doesn't use (it uses P, Esc, M, R, arrows, Enter, Space). Typing inside the
   panel is already safe: it stops `keydown` from leaving its shadow root.
3. **Room code loads only for a room** (§3.4).
4. **Saved fleets are cleaned up.** The reference keeps `battleship:fleet:<promise>` forever, one per battle.
   Each one is removed once its reveal is in the table. At most the 10 newest are kept, in case a battle is
   abandoned.
5. **Wrecks on rebuild** follow §2.3.
6. **The fork ribbon and the panel share the top-right corner** on the title screen. The panel should win:
   I'll check with a screenshot and, if needed, put the ribbon below the panel's z-index. The ribbon only exists
   on the title and pause screens, and opening the panel from the pause screen closes it.
7. **Pause in a room** is titled "Menu". The local clock still stops, so animations queue and play in order on
   Resume. That is the reference's behaviour, and it's fine. Answers are sent from `apply`, which doesn't wait
   on the clock.

### 3.4 Load time and performance

- **Ordinary visit**: `p3p2.start()` resolves to null without loading anything or contacting a server. The
  initial bundle gains only the client entry (< 2 KB gzip) and `company.js`. `play.js`, `table.js` and
  `sha256.js` (~7 KB brotli together) move to a chunk imported on the first `room` event, along with p3p2's own
  lazy room client and panel (< 15 KB gzip). `npm run size` must show initial JS ≤ ~143 KB brotli (budget 200),
  and `npm run loadtime` must stay at ~0.5 s desktop and ~0.7 s on the mobile proxy.
- **Invite visit** (`?room=…`): `start()` runs after `bs-ready`, so the title is interactive first and the
  "Join?" prompt follows. `scripts/loadtime.mjs` gets `--invite`, which measures with an invite to an
  unreachable server: `bs-ready` must not move, and the page must not throw.
- **Rendering**: no per-frame network work. A battle is turn-based ops, with no presence traffic.

### 3.5 What the player sees

1. Title: **PLAY** and **👥 Play with a friend**. In game, the people button sits beside pause and sound.
2. The p3p2 panel: paste a room URL from a p3p2 server, then Host. You get an invite link and a QR code.
3. A friend opens the invite, gets "Join?", and is in the room. Both place fleets, then **Ready**. The battle
   starts when both are ready.
4. A shot flies when the room has it and lands when the other page answers. The status line says whose turn it
   is, who is away, and what is awaited.
5. End screen: winner, how they won, and per fleet "fleet as promised" / "NOT as promised". **Next battle**
   swaps who fires first.
6. A third person watches: two boards of water, the shots, and ships only as they sink.
7. A browser that lost its fleet (storage cleared, another browser) is told so and can only resign.
8. Leaving the room goes back to the title. The AI game is there as before.

### 3.6 Testing

- **Unit**: `tests/unit/table.test.js` (from the reference) plus pruning. `npm test` stays green.
- **Two browsers, own script**: `scripts/friends.mjs --room <room URL> [--device …] [--headed]`. It needs a
  local p3p2 server (`cd ~/Repos/mine/private/p3p2 && npm run dev`, portal at http://localhost:8080) with a room
  created for the game's address (`:5173` dev or `:4173` preview). Three Playwright contexts (two admirals and
  a watcher) play a whole battle by clicking cells (`__bs.cellToClient`). It checks:
  - every page's `__bs.room.table().fingerprint` is the same after every answer
  - no fleet appears in the table before the end, and both verdicts are `kept`
  - the watcher sees no ships except sunk ones
  - a reload mid-battle comes back to the same table
  - a shot at a closed page waits, and is answered when the page reopens
  - Enter in a room fires without opening chat, and T opens chat
  - Next battle swaps the first shooter
  - the panel and the people button fit on a phone, both orientations

  Recordings go to `recordings/` (gitignored). If a room from an earlier run still has a battle, the script
  resigns and starts a new one.
- **The p3p2 repo's own spec**, which already covers lag, drops, Firefox + WebKit at one table, and cost:
  `GAMES_DIR=~/Repos/mine/public GAMES=battleship` in `~/Repos/mine/private/p3p2-private`
  (`e2e/tests/games/battleship.spec.ts`, 10 tests). This repo's folder is already named `battleship`. Skip
  `games:client`, so the published client is what gets tested. The hooks it uses (`__bs.room`, `hullHits`,
  `__bs` in dev) are kept.
- **Regression**: `npm run size`, `loadtime` (plain and `--invite`), `perf`, and `play` (3 single-player games
  across devices, with `--rotate` and `--switch-quality`), so nothing changes for single-player.

---

## 4. Feature: "More games on Maize.Live"

- **Title / loading**: `<p class="more"><a href="https://maize.live" target="_blank" rel="noopener">More games on
  <b>Maize.Live</b></a></p>`, the last element in `#title` in `index.html`. It paints before JS, so it is on the
  loading screen from the first frame, and it stays on the menu.
- **Pause**: the same line at the bottom of the pause card (`overlays.js`), the solo and room versions both.
- **Why in the layout, not fixed to a corner**: the version label is bottom-left, the fork ribbon top-right, the
  title iconbar top-left. A fixed bottom link would cover PLAY on short landscape phones. In the flex column it
  can't overlap anything.
- Style: small (13–14 px), the `.sub` text shadow so it reads on bright water, a tap target ≥ 44 px tall on
  touch.
- **Check**: `play.mjs` `checkLayout` adds the link (inside the viewport, not overlapping buttons) on
  desktop / iPhone 13 / Pixel 7 / tablet, upright and on its side. Clicking it opens a new tab and doesn't start
  a game (the canvas and title get no pointer events from it).

---

## 5. Order of work (each step ends runnable and checked)

1. §2: tier toast / pause line / "checking…", `settle()` on tier change, unit tests, the `play.mjs` check.
2. §4: the Maize.Live link in title and pause, layout checks.
3. §3 port: install, vite config, `src/net/*`, wiring, UI, `table.test.js`. Two browsers by hand against the
   local server.
4. §3 changes: lazy room chunk, `chatKey`, fleet pruning, "Menu" heading, SVG icon, ribbon vs. panel.
5. `scripts/friends.mjs`, then the p3p2 repo's spec against this checkout.
6. Regression runs, README, THIRD_PARTY_NOTICES, `ai/next_1.md`. No commit or push: that's yours.

---

## 6. Risks and limits

- **A room needs a p3p2 server.** The game needs no config: the panel takes any room URL. But someone must run a
  server (the `p3p2/p3p2` Docker image) and hand out room URLs. Without one, "Play with a friend" opens a panel
  that asks for a URL the player doesn't have (see §7, question 1).
- **A player who stops answering stalls the battle.** A modified page can't lie and win, because the reveal
  catches it. But it can stop answering or refuse to reveal, and the other admiral can only leave. Same as the
  reference. A timeout rule is possible later.
- **A lost fleet** (storage cleared, another browser) can only resign. This is the price of the server never
  holding fleets.
- **No real phones or iOS Safari here.** The p3p2 spec runs WebKit beside Chrome, but that's still emulation.
- **The client is 0.1.x.** I'll pin `^0.1.1`. The p3p2 docs promise that newer servers accept every released
  client.

---

## 7. Open questions (I'll use the default unless you say otherwise)

1. **Which p3p2 server will players use?** Default: none built in. The README explains how to get a room URL,
   and the panel's setup text stays p3p2's own. If there's a public server (p3p2.me?), I can add a line under
   "Play with a friend" pointing to it.
2. **Keep wrecks on Ultra?** Default: yes. With §2.3 they're consistent and only on Ultra.
3. **Chat key**: default `T`. The alternative is no key at all, only the people button.
4. **Defaults kept from the reference**: no AI in a room, no auto-pause, the admirals swap who fires first each
   battle, and watchers see no ships until they sink.

---

## 8. Requirement checklist

| Prompt item | Where |
|---|---|
| Issue 1: sunk ships visible on High | §2: cause reproduced (Auto shows High, then runs Ultra), honest tier display, wrecks follow the current tier |
| Feature 1: multiplayer with `@p3p2/client` | §3: npm package, design and code from the reference, fixes, lazy loading, tests |
| …using the reference repo | §3.1–3.3: what's kept and what changes |
| Feature 2: "more games on Maize.Live" on loading and pause screens | §4 |
| Spec: initial load 1–3 s, 4 s max | §3.4: +≤ 3 KB initial, room code lazy, `start()` after `bs-ready`, loadtime incl. `--invite` |
| Spec: average PC / entry-level phone | No new per-frame work. Ultra-only wrecks unchanged in cost. Phone layout checks for the panel, button and link |
