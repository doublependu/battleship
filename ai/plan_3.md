# Plan 3: p3p2's own button, watchers who take turns, and three videos

Answers `ai/prompt_3.md`. Nothing has been built yet. This file only describes the plan.

---

## 1. Summary

1. **p3p2's button and box.** There is no reason left to replace p3p2's button. The game already uses p3p2's
   panel (the box) as it is. It hides only p3p2's own button (`ui.button: false`, `src/net/company.js:17`) and
   draws a 👥 button of its own (`src/ui/hud.js:26`). That came from the reference port, where every corner was
   taken. Since then the 👥 moved to the top right, so the corner it needed is free. p3p2's button also does things
   ours doesn't: it shows how many people are in the room, has a badge for unread chat, and pulses while the server
   is heard from. **Plan:** turn p3p2's button on and remove ours. "👥 Play with a friend" stays in the main menu
   (and the pause menu) and opens the same panel. One thing needs care: the "Fork me on GitHub" ribbon is in the
   same corner on the title and pause screens (§2.3).
2. **Watchers take turns: yes, with no change to p3p2.** The seats are already the game's own state, built from
   the room's log (`src/net/table.js`). A queue of challengers ("the line") is more of that state. The rule:
   **winner stays, the loser gives up their seat to the next in line**. A watcher is asked: "Do you want to play or
   just keep watching?" (§3).
3. **Videos: `npm run film`.** It plays like a person: the cursor moves between cells, it pauses to think, and it
   drags ships. It records each take in headed Chrome by capturing its own tab (a pilot measured about 57 fps at
   1080p with the game's sound). ffmpeg then cuts three videos: **YouTube** (16:9, about 5 minutes, with chapters),
   **YouTube Short** (9:16, ≤ 60 s) and **X** (16:9, about 45 s, with captions). `play.mjs` gets the same
   human-like pacing as an option (§4).

---

## 2. Item 1: p3p2's own button and panel

### 2.1 Why the game has its own button today

| | p3p2 gives | The game uses |
|---|---|---|
| Panel ("box"): Join?, invite link, QR, who's here, chat | yes | **yes, unchanged**, opened by `p3p2.open()` |
| Button ("logo"): p3p2's mark, member count, unread badge, teal pulse while the server is heard from | yes | **no**: `button: false`, plus our own 👥 icon |

- **Where it came from.** The reference (`p3p2_test_repos/battleship`, branch `p3p2`) says: "Top left are pause
  and sound, the status runs along the top, the buttons along the bottom, and the version is bottom left: no corner
  to spare." So it put a 👥 beside pause. In plan 1 that 👥 covered the status line on narrow phones, so it moved
  to the top right (`next_1.md` §3.1). That freed corner is exactly where p3p2's button sits by default. The
  original reason no longer applies.
- **Plan 1's other reason** was an SVG icon "in the style of pause and sound". That's only cosmetic.
- **What ours is missing:** with the panel closed, a chat message from the other admiral goes unnoticed today.
  p3p2's button shows an unread count, the room's size and whether the connection is live.

So the game should use p3p2's button as it comes.

### 2.2 Changes

| File | Change |
|---|---|
| `src/net/company.js` | `ui: { corner: 'top-right', chatKey: 't' }`: drop `button: false`. Chat stays on **T**, because Enter fires |
| `src/ui/hud.js`, `src/ui/styles.css`, `src/ui/icons.js` | Remove the HUD's 👥 button (`.iconbar.right`, `ICONS.people`) |
| `index.html`, `src/ui/overlays.js` | "Play with a friend" stays in the title menu and the pause menu, and still calls `company.open()` = `p3p2.open()`, the same panel. The 👥 emoji becomes p3p2's mark (its two SVG paths, copied from `@p3p2/client`, MIT), so the menu button and the corner button look like one thing (open question 2) |
| `src/net/play.js:223` | "share the invite (👥)" → "send them the invite (top right)" |
| `src/ui/styles.css` | `p3p2-panel { top: max(12px, env(safe-area-inset-top)) !important; right: max(12px, env(safe-area-inset-right)) !important }`. p3p2 places its element at a fixed 12 px. On an iPhone on its side, that puts the corner under the rounded edge. This moves the element only, not its look. Our own icons already do the same. It could also go into p3p2 later, but it isn't required |
| `src/ui/styles.css` | The status line keeps clear of the button: `.topbar` side padding 64 → 76 px. With a count, the button reaches about 70 px from the edge |
| `index.html` | Fork ribbon (§2.3) |

- **When the button appears:** `new P3P2()` runs after `bs-ready` (`src/main.js:641`), so the button appears
  with the menu, not during loading. It comes from the 2 KB entry that is already in the bundle. It loads nothing
  and asks no server anything until it's clicked. Initial size changes by a few hundred bytes at most.
- **Touch and keys:** p3p2 already stops the button's touches and the panel's keys from reaching the game. Escape
  closes the panel without pausing, as now.
- **Stacking:** p3p2's element has the top z-index. On a phone, a tall settings or game-over card can reach the
  top of the screen and go under the button. The layout check below catches that. If it happens, the fix is a top
  margin on those cards on narrow screens.

### 2.3 The fork ribbon and the button share the top-right corner

On the title and pause screens, the ribbon's band crosses roughly 60–120 px from the corner at the button's
height. The button covers about 12–70 px. The two touch. **Default:** move the band about 25 px further out
(box 150 → ~190 px) so the button sits inside the corner, clear of the band. I'll check this with screenshots at
360×640, 390×844, 667×375, 1366×768 and 2560×1440. Alternatives are in open question 1.

### 2.4 Tests

- **`play.mjs` `checkLayout`:** p3p2's button must not overlap any visible game button, the status line or the
  Maize.Live link. Checked on the title, placement, battle, pause, settings and game-over screens, on desktop,
  pixel7, iphone13 and tablet, with `--rotate`.
- **`friends.mjs`:**
  - opens the panel with p3p2's button (`p3p2-panel` → button "Multiplayer"), not `.hud [data-k="friends"]`
  - the button shows 3 members
  - Grace chats while Ada's panel is closed, and Ada's button reads "Multiplayer, 1 unread message"
  - the title's "Play with a friend" opens the same panel
  - an ordinary visit still loads no room code and asks no server anything
- **`npm run size`:** within ±0.5 KB.

---

## 3. Item 2: watchers take turns

### 3.1 Without any update to p3p2? Yes

`docs/sharing-state.md` in p3p2 already describes a game in turns as "the log alone: the seats, every move, the
next game". The battle works that way now: `sit`, `stand`, `ready`, `shot`, `answer` and `new` are ops in the room's
log, and every page applies them in the same order. A line of challengers is a few more ops of the same kind. Here
is what each part needs and where it comes from:

| Need | From |
|---|---|
| The same order of "I want to play" on every page | the room's log (as now) |
| Who is here, who left | `room.members`, member state, `member-leave` (after p3p2's 30 s grace) |
| Late joiners see the line | snapshots (`save()` / `load()`), as now |
| How many can watch | the room's max members (server setting), as now |

Nothing is missing from p3p2. One optional extra would need p3p2: letting a game put tags such as "playing" or
"next" in the panel's member list. The game can show this itself, so it isn't needed.

### 3.2 Rules (`src/net/table.js`)

- **`line`**: the pids (and names) of watchers who want to play, in the order they asked.
- **New ops:**
  - `{ t: 'line', name }`: a watcher asks to play and goes to the end of the line. Ignored for a seated member or
    someone already in line.
  - `{ t: 'unline' }`: leave the line ("Just watch").
  - `{ t: 'gone', pid }`: take someone out of the line who has left the room. Their own page can't send it. The
    admirals' pages send it on p3p2's `member-leave`; if no admiral is here, the first in line who is here sends it.
    It's accepted only for a pid in the line, never for a seat. If they come back, they're asked again.
- **`new` after a finished battle, with a line:** the loser's seat goes to the first in line, and the winner stays.
  The challenger takes seat 0, so the challenger fires first. "Loser" includes resigning and a broken promise
  (`winner ^ 1`). The seat changes hands only if it is **still held by the pid who lost**. This matters if the loser
  `stand`s after the end: their seat has already gone to the line by then, and the newcomer must not be replaced
  in turn.
- **`new` without a line:** same as today. The two swap, so the other fires first.
- **Who may send `new`:** either admiral, as now. Once the battle is over, the first in line may send it too, so the
  line never waits for admirals who walked away after the end.
- **A free seat and a non-empty line never exist together.**
  - When `stand` frees a seat, the first in line takes it in the same op.
  - A `line` op while a seat is free seats the asker at once.
  - With no line, arrivals still sit in a free seat automatically, as now (the first two play).
- **Format:** `TABLE_VERSION` goes from '1' to '2'. The snapshot gains `line` (a missing one loads as empty), and the
  fingerprint includes it. p3p2 keeps pages with a different game version apart, so an old page and a new one never
  share a room.

### 3.3 What players see (`src/net/play.js`, `src/ui/hud.js`, `src/ui/overlays.js`)

- **On arriving at a full table:** a small prompt above the board tabs that doesn't cover the boards: "Ada and Grace
  are playing. Do you want to play or just keep watching?" with **[Play next]** and **[Just watch]**. A watcher seated
  automatically at a free seat isn't asked.
- **The status line for a watcher:** "Ada vs Grace · you're next", "… · you're 2nd in line", or "… · Lin is next".
- **At the end:** the room's end card adds a line such as "Next battle: Lin vs Ada (Ada stays)". The first in line
  gets a **Next battle** button.
- **The loser, when there's a line:** when the next battle starts they become a watcher, with the toast "Lin takes
  your seat". They're then asked the same question. "Play next" puts them at the end of the line.
- **The menu for a watcher:** **Play next** (joins the line, or sits at once if a seat is free; this replaces "Take
  the free seat") or **Just watch** (leaves the line).
- **Toasts:** "Lin takes Grace's seat" and "Battle 3: Lin fires first".
- **"Just watch" sticks:** that watcher isn't asked again in this room (remembered for the tab in `sessionStorage`)
  unless they pick "Play next" from the menu.

### 3.4 Tests

- **`tests/unit/table.test.js`:**
  - `line` / `unline` / `gone`, and repeats ignored
  - `new` puts the first in line in the loser's seat, the winner stays and the challenger fires first
  - the same after a resign and after a broken promise
  - no line: the two swap as before
  - the loser `stand`s after the end and the newcomer is not replaced
  - `stand` with a line gives the seat to the line
  - `line` while a seat is free sits at once
  - a seated member can't join the line
  - `gone` can't touch a seat
  - snapshot = replay, with a line
  - an old snapshot without `line` loads
  - the fingerprint covers the line
- **`friends.mjs`:**
  - Lin, the watcher, is asked on arriving and chooses "Play next"
  - after the battle, Next battle: Lin has the loser's seat, the winner stays, Lin fires first, and every page agrees
    on the fingerprint
  - the loser is asked and chooses "Just watch"
  - the second battle ends by resignation (it's quick) with no line, so the two swap as before
  - someone in the line closes their page, and 30 s later they're out of the line on every page
  - it also passes with `--engines` and `--via`

---

## 4. Item 3: playing like a person, and three videos

### 4.1 Where the scripts are today

- `play.mjs` plays against the AI with real clicks, but every move is instant. Its video is Playwright's: 25 fps
  VP9 at the viewport size (for example 412×838 at 0.8 Mbps). That's fine for debugging but not for YouTube. Sound
  is recorded only with `--recaudio` and muxed by offset.
- `friends.mjs` plays three browsers through a real p3p2 server, with `--video`.

### 4.2 What I checked (pilot on this PC; script in the scratchpad, not committed)

The setup: headed Chrome 156 with Ultra, in a battle with shots. The page records itself with
`getDisplayMedia({ preferCurrentTab: true })`, auto-accepted with `--auto-accept-this-tab-capture`, and a
`MediaRecorder` at 40 Mbps.

| Run | Result |
|---|---|
| H.264 (`video/mp4;codecs=avc1.640033,opus`), 1080p | **57 fps** recorded (median frame 16.9 ms, p95 18–19 ms), no decode errors. The game ran at 52–57 fps meanwhile. One gap of 56–128 ms per take |
| VP9, 1080p | 52.5 fps; the game dropped to 46 fps (VP9 costs more to encode) |
| What is recorded | The page as shown (canvas, HUD, menus) plus the tab's sound |
| Window size | GNOME on Wayland gives the window less room than asked: a 1920×1080 viewport came out as 1904×1052, with the right and bottom edges cut. A 608×1080 viewport in a larger window came out exactly 608×1080. Fullscreen and `--kiosk` were ignored (1241×1308). Under XWayland it ran at 4 fps |
| Emulated pixel ratio | Not used by the capture: 608×1080 at 1.78× still recorded 608×1080, with H.264 decode errors |
| Sound | The tab's sound is **mono**. The game's own tap (`?recaudio`, the limiter output) is stereo |

**Conclusions:**
- Use tab capture in headed Chrome. Headless can't be used: it showed grey frames (`next_2.md` §3.1).
- The viewport must fit inside the real window. The script measures the window's content area and uses the largest
  16:9 (or 9:16) viewport that fits. The cut then scales to 1920×1080, which is about 3% here.
- **The Short is upscaled.** A 1440 px tall screen fits at most about 760×1350 in portrait. That gets scaled ×1.42 to
  1080×1920 (open question 5).
- One `MediaRecorder` gets the video from the tab capture and the **stereo audio from the game's own tap**. Sound
  and picture are then in sync by construction.

### 4.3 Game-side hooks (only with `?e2e`, under `__bs.film`)

| Hook | Why |
|---|---|
| `holdResolution()` | The adaptive resolution stays at 100%. Recording costs a few fps, which could otherwise step it down to 75% in the middle of a take |
| `audioStream()` | The game's stereo `MediaStream`. The `?recaudio` tap is refactored so it can be reused |
| `look({ side, r, c, dist, pitch, yaw })` / `release()` | Camera targets for close-ups, eased by the camera rig as usual: a ship burning, going down, the wreck and caustics on the seabed. Firing happens only in the normal views |

These add under 0.5 KB, and they do nothing without `?e2e`.

### 4.4 Playing like a person (`scripts/lib/human.mjs`, used by `film.mjs` and `play.mjs --human`)

- **Mouse:** moves along eased curves with a slight overshoot and never jumps. It hovers before firing, so the game's
  aim marker shows where it's going, and sometimes hovers a neighbouring cell first. Think time is 0.6–2 s: longer
  after a hit, and longer before the shot that sinks a ship. On desktop it sometimes fires with Enter.
- **Placement:** drags two or three ships, taps one to rotate it, and may press Randomize once.
- **Touch:** a tap, then the second tap that fires, as the game expects.
- **A cursor and tap rings drawn by the script** (an init script, DOM only). The capture doesn't show the system
  cursor.
- **Shot choice:** still the existing `human-proxy` bot.
- **`play.mjs --human`:** adds this pacing. It's off by default, and the checks don't change.

### 4.5 Takes (`scripts/film/takes.mjs`)

Each take sets the viewport, URL (`?e2e&seed&quality`), tier and actions. It writes **markers** (for example
"hit at 41.2 s", "battleship sunk at 63.0 s") to `takes/<name>.json`, so the cut can be made from them. Recording
starts after a warm-up shot, which keeps the pilot's one long gap (probably the first explosion's shaders
compiling) out of the take.

| Take | What | Device / tier |
|---|---|---|
| `sea` | Title screen, slow camera drift over the water: the cold open and backgrounds | desktop, Ultra |
| `load` | Cold load to the menu, with the measured time as a caption | desktop |
| `placement` | Drag, rotate, randomize | desktop, Ultra |
| `battle-ai` | A whole game against Captain, with a seed chosen by casting (below) | desktop, Ultra |
| `closeups` | `look()`: a hit and its fire, a ship going down, the wreck on the seabed | desktop, Ultra |
| `tiers` | Mid-battle with fires burning: Settings → Low, Medium, High, Ultra. Wrecks appear on Ultra | desktop |
| `phone` | Portrait, touch: placement, a few shots, and a turn to landscape mid-game | portrait viewport |
| `friends` | Local p3p2 server. Ada and Grace as two phone windows side by side, Lin watching. Invite link and QR, chat, shots crossing, the end, Lin takes the loser's seat (item 2) | 3 windows, High (if three Ultra windows drop frames) |

**Casting (`--cast N`)** runs `battle-ai` headless at speed 6 with no video, for N seeds. It keeps a seed where:
the player wins against Captain, the AI has 1–2 ships left, and each side has sunk at least one ship by the middle
of the game, with 40–60 player shots.

**Frame check:** after each take, ffprobe reads the frame times. A take fails if more than 2% of its frames are
over 34 ms, or if any gap is over 100 ms within ±3 s of a marker. The script then records it again.

### 4.6 Cuts (`scripts/film/edit.mjs`, ffmpeg)

| Cut | Format | Content |
|---|---|---|
| **YouTube** | 1920×1080, 60 fps, H.264 CRF 18, AAC 48 kHz stereo, about 5:00 | Chapters: cold open, loads in a moment, placement, a battle with the AI, close-ups, graphics tiers, phones, play with a friend and taking turns, outro |
| **YouTube Short** | 1080×1920, 60 fps, ≤ 60 s | A sinking in the first 2 s, placement in 4 s, hits, the big sinking, VICTORY, end card; ends where it starts so it loops |
| **X** | 1920×1080, 60 fps, about 45 s (X allows 2:20 without Premium), H.264 + AAC, ≤ 512 MB | The YouTube highlights, with captions burned in, because X autoplays muted |

- **Edits** come from the markers: cut around hits and sinkings, and drop runs of misses or play them at 2× with a
  "2×" badge.
- **Captions and cards** are drawn from HTML (`system-ui`, the game's colours) into transparent PNGs with
  Playwright, then overlaid by ffmpeg. That way no font files or `drawtext` setup are needed. The Short keeps text
  out of the areas YouTube's own buttons cover.
- **Sound:** the game's own synthesized music and sound, so there are no copyright claims. Crossfades between takes,
  loudness at −14 LUFS.
- **Extras:** `thumbnail.png` (1280×720: a sinking on Ultra with the title), and `youtube.txt` (title, description
  with chapters, tags).
- **Output:** everything goes to `recordings/film-<stamp>/` (gitignored, as the spec asks). I don't upload anything;
  that's yours.

### 4.7 Commands

`npm run film` records the takes it needs and makes all three cuts. Options:
- `--cast 20`
- `--takes battle-ai,closeups` (record just those again)
- `--cut youtube|short|x` (cut again from the takes already there)
- `--from recordings/film-…`
- `--server` / `--invite` for the `friends` take (as in `friends.mjs`)

It always runs headed. **The takes need the desktop for about 15 minutes, with the windows kept in front.**

### 4.8 Claims in the captions

The captions say only what has been measured:
- no images, models or audio files are downloaded
- it's interactive in well under a second (`npm run loadtime`: 309 ms desktop, 706 ms mobile proxy)
- the phone shots are labelled as a phone-sized screen

The videos are filmed on this PC (RTX 3060) on Ultra, and say "Ultra graphics" where it shows. They make no claim
about frame rates on real phones, which haven't been tested.

---

## 5. Order of work (each step ends runnable and checked)

1. **Item 1:** p3p2's button, remove ours, fork ribbon, safe-area rule. Then the layout check in `play.mjs` and the
   `friends.mjs` changes. Screenshots for the ribbon.
2. **Item 2, rules:** `table.js` and the unit tests.
3. **Item 2, screens:** `play.js`, `company.js` (`gone` on `member-leave`), HUD prompt, menu, end card. Then the
   rotation scenario in `friends.mjs`.
4. **Item 3, base:** e2e hooks, `human.mjs`, and `play.mjs --human`.
5. **Item 3, capture:** the capture library (window fit, stereo game audio, frame check), tried on a 10 s take.
6. **Item 3, film:** takes, casting, cuts. I'll look through frames of all three cuts before calling them done.
7. **Regression:**
   - `npm test`, `size`, `loadtime`, `perf`, `flash`
   - `play`: desktop, pixel7 and iphone13, with `--rotate --switch-quality`
   - `friends`: plain, `--engines` and `--via`
8. **Wrap-up:** `README.md` (the button, taking turns, `npm run film`) and `ai/next_3.md`.

---

## 6. Risks and limits

- **Window sizing on this desktop.** The fit (§4.2) works around it. The Short is upscaled.
- **Recording costs frames.** The game ran at 52–57 fps while recording. The frame check catches bad takes, and the
  `friends` take may have to drop to High with three windows.
- **Takes need the screen.** They can't run headless or in the background.
- **The `friends` take needs a local p3p2 server**, as `npm run friends` does.
- **An admiral who leaves mid-battle still stalls the table** (as before). With a line waiting, that's more
  noticeable. The `gone` op could later cover seats too (open question 6).
- **Next battle before the loser's fleet is shown** loses that reveal. That was already the case with two players.
- **Platform limits change.** Shorts currently allow up to 3 minutes; X allows 2:20 without Premium. I'll note
  them in `next_3.md`, to check at upload.
- **No real phones** (as before).

---

## 7. Open questions (I'll use the default unless you say otherwise)

1. **Fork ribbon vs p3p2's button.**
   - **Default:** move the ribbon's band outward, so the button sits in the corner inside it.
   - Alternative: ribbon top left, with the title's settings and sound moved elsewhere.
   - Alternative: a "Fork me on GitHub" text link next to "More games on Maize.Live".
2. **p3p2's mark on the menu buttons** in place of 👥: **default yes.**
3. **The loser** becomes a watcher and is asked again (**default**), or goes to the end of the line automatically.
4. **After a change of admiral, the challenger fires first** (**default**), or the winner does.
5. **The Short** is upscaled from about 760×1350 (**default**). The alternative is to film it on a portrait
   monitor.
6. **An admiral gone for good:** leave it as now (**default**), or let the other admiral or the line take the seat
   after, say, 5 minutes away. That's deterministic, using the log's server time per op.
7. **End card and description:**
   - Which address to show for the game? **Default:** no address in the video, and "link in the description" with
     the address left for you to fill in.
   - Add Maize.Live and @RadWebGame? **Default:** yes, as on the title screen and in the README.
8. **No voice-over:** music, sound and captions only (**default**).

---

## 8. Requirement checklist

| Requirement | Where |
|---|---|
| Is there a reason the p3p2 logo and box aren't used as they are? | §2.1: no, not any more |
| Use what comes with the p3p2 client | §2.2: p3p2's button and panel, as they come; only the element's position follows safe areas |
| Keep "Play with a friend" in the main menu, opening the same box | §2.2: opens `p3p2.open()`, the same panel |
| Watchers take turns | §3.2: a line; winner stays, loser yields |
| Ask "Do you want to play or just keep watching?" | §3.3 |
| Maybe only replace the loser after each game | §3.2 (default; open questions 3–4) |
| Possible without any update to p3p2? | §3.1: yes |
| Script autoplays as a human player | §4.4 (`film.mjs`, `play.mjs --human`) |
| YouTube video, ~5 min, cool features | §4.5–4.6 |
| YouTube Short | §4.6 |
| Video for X | §4.6 |
| Recordings not committed | `recordings/` is gitignored |
| Spec: load in 2–3 s (4 s max) | The initial bundle doesn't grow beyond a few hundred bytes; the room code stays lazy. Checked with `npm run size` and `loadtime` |
| Spec: average PC / entry-level phone | No new per-frame work. Film hooks run only with `?e2e`. Layout checked on phone sizes |
