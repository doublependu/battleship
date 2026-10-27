# Next 3: what was built for plan 3, and what to do next

Implements `ai/plan_3.md` (answers `ai/prompt_3.md`). It was built in two sessions: "itr 3, take 1" (commit
`4dd3495`), which was cut short before the videos were cut, and a second session that checked it, fixed the
recordings and finished it. Nothing is committed, deployed or uploaded. That's for you.

---

## 1. What changed

| Item | Where | Notes |
|---|---|---|
| p3p2's own button | `src/net/company.js` (`button: false` gone), `src/ui/hud.js`, `src/ui/icons.js`, `src/ui/styles.css` | The HUD's 👥 is gone. p3p2's button sits top right, with the room's count and unread chat. Its element follows the safe areas. The status line keeps clear of it (`.topbar` padding, narrow-screen rule) |
| "Play with a friend" | `index.html`, `src/ui/overlays.js` | Still on the title screen and in the pause menu, opening the same panel (`p3p2.open()`). It wears p3p2's mark (`P3P2_MARK`, from `@p3p2/client`, MIT) in place of 👥 |
| Fork ribbon | `index.html` | Band moved out (box 150 → 190 px), so p3p2's button sits in the corner inside it |
| The line | `src/net/table.js` | Ops `line`, `unline`, `gone`. `new` after a battle: the winner stays, the first in line takes the loser's seat (if the loser still holds it) and fires first. With no line, the two swap as before. A seat that is left goes to the line at once, and a free seat seats whoever asks to play. The first in line may start the next battle once this one is over. Snapshot: `line`, `loser`, `fought`. Fingerprint covers the line. `TABLE_VERSION` 1 → 2 |
| Taking out who left | `src/net/company.js` (`tidy`) | On p3p2's `member-leave`, an admiral's page (or, with no admiral here, the first in line who is) sends `gone` for each pid in line that is no longer in the room |
| The watcher's question | `src/net/play.js` (`ask`, `answer`), `src/ui/hud.js` (`setAsk`), `src/main.js` | "Ada and Grace are playing. Do you want to play or just keep watching?" with Play next / Just watch, above the board tabs. In line: "You play next…" or "You are number N in line". "Just watch" is remembered for the room in `sessionStorage`. Menu: Play next / Just watch. End card: "Next battle: Lin vs Ada, who stays". Toasts for a change of seat |
| Ultra reflection fix | `src/render/ocean/ultra/shaders/surface.frag.glsl` | The reflection's alpha is clamped: additive fire pushed it past 1 in the half-float target, which gave yellow and purple fringes round an explosion |
| Film hooks (`?e2e` only) | `src/main.js` (`__bs.film`), `src/render/camera.js` (`setFilm`), `src/audio/engine.js` (`tap`) | `holdResolution()`, `look()` / `release()` (slow eased camera, optional spin), `audioStream()` (the limiter's stereo output; `?recaudio` uses the same tap) |
| Playing like a person | `scripts/lib/human.mjs`, `scripts/play.mjs --human` | Eased mouse paths with overshoot, hover before a click, think times by situation, drags, touch taps; the cursor and tap rings drawn into the page |
| `npm run film` | `scripts/film.mjs`, `scripts/film/capture.mjs`, `takes.mjs`, `edit.mjs` | Takes in headed Chrome that records its own tab (H.264 at up to 60 fps, the game's stereo mix), markers per take, three cuts with ffmpeg, captions drawn from HTML |
| Checks | `tests/unit/table.test.js`, `scripts/friends.mjs`, `scripts/play.mjs` | 8 new unit tests for the line (73 in all). `friends`: p3p2's button (count, unread chat), the title's "Play with a friend", the watcher asked, the loser replaced, the swap with no line, someone leaving the line. `play`: p3p2's button covers nothing on the title, pause, settings and game-over screens |
| Docs | `README.md` | The button, watchers taking turns, `--human`, `npm run film` |

## 2. Measured (this machine)

- `npm test`: 73 tests pass.
- `npm run size`: initial JS **145.0 KB** brotli, transfer 148.5 KB. Before this iteration (`2520568`, with p3p2
  0.2.0): 144.3 / 147.6. So +0.7 KB for the button, the question, the menu items and the film hooks.
- `npm run loadtime`: desktop 310 / 393 ms, mobile proxy 714 / 746 ms (median / max). Unchanged.
- `npm run perf`, desktop and phone: all four tiers at 60 fps, no long tasks.
- `npm run flash`: Ultra and High, 0 flashes.
- `npm run play --rotate --switch-quality --speed 3`: desktop, Pixel 7 and iPhone 13 pass, p3p2's button checks
  included. `--human --speed 2`: desktop and Pixel 7 pass; seed 12 plays the same game on both.
- `npm run friends` against a local p3p2 0.2.0 server: plain, `--engines` (Grace in Firefox, Edsger in WebKit) and
  `--via` (p3p2's lag proxy, 100 ± 30 ms) all pass. Someone who closes their page is out of the line after 30–31 s
  (p3p2's grace).
- Ribbon and button, title screen at 360×640, 390×844, 667×375, 1366×768 and 2560×1440: no point of the button
  is under the band.
- **Film takes** (seed 8, a win against Captain with the AI one ship short; Ultra except tiers and friends):

  | Take | Length | fps | Longest gap |
  |---|---|---|---|
  | sea | 36 s | 55.7 | under 34 ms |
  | battle-ai | 4:50 | 57.2 | 37 ms |
  | tiers | 67 s | 56.4 | 35 ms |
  | phone (upright, 1013×1799) | 4:55 | 56.8 | 294 ms, as the battle starts |
  | phone-sideways (1704×959) | 77 s | 56.8 | 261 ms, as the battle starts |
  | friends (three 600×1067 windows, High) | 2:43–2:59 | 57.4 | about 250 ms in each window's first second |

## 3. The videos

In `recordings/film-2026-10-27T16-46-26-928Z/` (gitignored):

| File | Format | Length | Sound | Content |
|---|---|---|---|---|
| `youtube.mp4` | 1920×1080, 60 fps, H.264 + AAC, 395 MB | 5:02 | −14.1 LUFS, peak −1.3 dBTP | Cold open (the last sinking, title), no downloads / load time, real water, placement, the battle with close-ups, VICTORY, the four tiers, phones, the three friends side by side (link and QR, joining, the watcher's question, chat, the end, the loser replaced), end card |
| `youtube.txt` | | | | Title, description (with `<the game's address>` to fill in), 7 chapters (each 10 s or more), tags |
| `thumbnail.png` | 1280×720 | | | The last sinking on Ultra, with the title |
| `short.mp4` | 1080×1920, 60 fps | 53 s | −14.0 LUFS, peak −1.9 dBTP | A sinking first, placement, hits and sinkings, VICTORY, end card over the open sea |
| `x.mp4` | 1920×1080, 60 fps, 96 MB | 60 s | −14.0 LUFS, peak −1.9 dBTP | Sinking with title, highlights, Low vs Ultra, a phone, the friends, end card; captions burned in |

The sound used to be normalised by one `loudnorm` pass, which came out at −15.4 LUFS with a true peak of
+1.3 dBFS once in AAC. Now `join()` measures the mix, applies one gain and a limiter at 4× the rate 3 dB under full
scale, and measures again (`edit.mjs`). The X cut is a minute, not the plan's 45 s: five sinkings in close-up don't
fit in less. X allows 2:20.

## 4. Deviations from plan 3 (and why)

1. **Chrome's "sharing this tab" bar spoiled the first takes.** Once a tab records itself, Chrome shows a bar over
   the page that takes 56 units of its height, while the recording keeps the size it started at. Every take of
   take 1 but the upright phone had a smeared strip 55–120 px tall along the bottom, and the friends windows (three
   recordings in one browser, so a bar per recording in every window) lost up to about 200 px. Take 1 put the strip
   down to "a window taller than the screen" and dealt with it only for the upright phone. Now (`capture.mjs`) the capture starts first, the
   window grows by the bar, and only then does the recorder start. Each friend has a browser of their own. A window
   that would then be taller than the screen (both phones at 2.16×) keeps the game's area clear of the bar instead,
   and the cut scales it up 6–13%. All six takes were recorded again.
2. **No address in the videos.** Take 1 put `ch0.maize.live` on the end card and in the description. Nothing in the
   repository says the game is there, so per plan §7.7's default the end card says "Link in the description", and
   `youtube.txt` has `<the game's address>` for you to fill in.
3. **No `load` take.** The recorder runs inside the page, so a reload ends it. The cold open says what
   `npm run loadtime` measured ("about a third of a second on a desktop") over the title screen instead.
4. **The frame check reports, it doesn't record again.** Both phone takes freeze for 260–290 ms on the frame the
   battle starts (desktop takes don't), every time, so a retake wouldn't help. The cuts stop their placement clips
   just before it. See §5.
5. **The `phone` take doesn't turn mid-game.** The sideways phone is a take of its own (placement and a few shots).
6. **Names:** the friends are Ada, Grace and Edsger (Lin in the plan).

## 5. Not verified / known limitations

- **The battle-start freeze on the phone takes** (a phone-sized window at 2.16×, Ultra, 1080×1920 pixels): 260–290 ms
  on the first frame of the battle, in both phone takes, in both rounds of filming. Not seen on the desktop takes or in
  `perf`. Probably a shader or render target made on first use of the battle view at that size. Not investigated.
  It could show as a hitch on a real high-DPR phone on Ultra.
- **I looked at the cuts as frame sheets and checked their loudness, but didn't watch them through with sound.**
- **No real phones** (as before). The phone shots are phone-sized windows on this PC, and the description says so.
- **Platform limits change.** Shorts now allow up to 3 minutes, and X allows 2:20 without Premium; both cuts are well
  under. Check at upload.
- **The friends take needs a local p3p2 server** (`npm run dev` in p3p2, with `P3P2_OWNER_PASSWORD`).

## 6. What to do next

1. **Watch the three videos** in `recordings/film-2026-10-27T16-46-26-928Z/`: `youtube.mp4`, `short.mp4`, `x.mp4`,
   and `thumbnail.png`. Fill in the game's address in `youtube.txt`, then upload.
2. **Commit and deploy** (`npm run deploy`). `TABLE_VERSION` is now 2, so pages before this deploy and after it
   are kept in separate rooms by p3p2.
3. **The battle-start freeze** on high-DPR Ultra (§5): worth a look with a profiler at 1080×1920.
4. **Plan open question 6** (an admiral gone for good still stalls the table) is left as it was, by default.
5. **Leftovers from `next_1.md`** still apply: a p3p2 server on https for players, two real phones on the LAN,
   real-device tier checks.
