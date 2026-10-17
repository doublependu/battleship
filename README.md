# battleship
a classic battleship game

Against the AI or a friend, in 3D, on real water: three.js rendering, an interactive wave simulation adapted from
[threejs-water](https://github.com/jeantimex/threejs-water), procedural ships, explosions, sinking ships,
and synthesized battle sound and music. No images, models or audio files are downloaded, so the game is
interactive in well under a second on a normal connection.

## Setup and run

```bash
npm install
npm run dev
```

## Initial setup

```bash
npm create vite@latest . -- --template vanilla
claude --dangerously-skip-permissions
```

## Deploy

```bash
npx wrangler login
npm run deploy
```

`npm run deploy` builds and deploys to Cloudflare Workers Static Assets (`wrangler.jsonc`, `preview_urls: false`).
It warns if the working tree is dirty, because the version label (`v.` + first 4 characters of the commit)
shows HEAD. `npm run deploy:dry` builds and validates without deploying.

## Play with a friend

**👥 Play with a friend** (title screen, pause menu, or the button top right in a game) opens the
[p3p2](https://github.com/doublependu/p3p2) panel. Paste a room URL from a p3p2 server, create the invite, and send
the link or the QR code to a friend. The first two in the room are the admirals; anyone after them watches.

- **Each fleet stays in its own browser.** When an admiral is ready, the page puts a promise in the room (a SHA-256
  of the fleet and a random salt) and keeps the fleet in `localStorage`. The page answers every shot at its fleet
  by itself, so the admiral only needs the page open.
- **At the end both fleets are shown**, and every page checks them against the promises and against every answer
  given. A fleet that does not match loses.
- **The battle lives in the room**: close the page and a shot at your fleet waits until you open the invite again
  in the same browser. A browser that lost its fleet (storage cleared, another browser) can only resign.
- In a room there is no AI and no auto-pause, and the admirals take turns firing first. Chat opens with **T**
  (Enter fires).
- An ordinary visit asks no server anything: only the client's 2 KB entry is in the bundle, and the room code
  loads when a room opens.

A room needs a p3p2 server: the [`p3p2/p3p2`](https://hub.docker.com/r/p3p2/p3p2) Docker image
([self-hosting](https://github.com/doublependu/p3p2/blob/main/docs/self-host.md)), whose owner creates rooms in its
portal for the game's address. To try it on one machine, run a server from a p3p2 checkout (`npm run dev`, port 8080),
create a room there for `http://<this machine's LAN address>:5173/`, and open the game with `npm run dev -- --host`
in two browsers (or a private window). `npm run friends` plays a whole battle that way (below).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server, production build, serve the build on :4173 |
| `npm test` | Unit tests (rules, placement, AI, game flow, tier decision, ripple model, sound mapping, settings) |
| `npm run sim` | Balance simulation: bots vs each AI difficulty (`-- --games 10000 --param hard.temperature=0.1`) |
| `npm run play` | Playwright "human" player: real clicks/taps, recordings in `recordings/` (gitignored) |
| `npm run friends` | Two admirals and a watcher play a whole battle through a real p3p2 server (see below) |
| `npm run loadtime` | Throttled load-time check (desktop + mobile proxy), fails above 4 s; `-- --invite` opens it from an invite to a server that never answers |
| `npm run perf` | Heavy-scene frame times per graphics tier (`-- --device phone --cpu 6`) |
| `npm run probe` | Auto graphics probe under several CPU throttles and screen sizes |
| `npm run flash` | Records every frame while the render resolution changes and fails on a one-frame flash (headed Chrome; `-- --tiers ultra,high`) |
| `npm run size` | Bundle size report, fails over the 200 KB (JS) / 250 KB (total) brotli initial budget |

`npm run play` options: `--games N --device desktop|pixel7|iphone13|tablet --difficulty easy|normal|hard
--quality auto|low|medium|high|ultra --rotate --switch-quality --recaudio --speed 3 --headed --seed N
--url http://localhost:5173`. It needs `npm run build` first unless `--url` points at a running server.
`--recaudio` captures the game's own audio and, if `ffmpeg` is installed, muxes it into `gameplay.webm`.

`npm run friends` needs a p3p2 server and either `--room <room URL>`, or `--server <portal URL>` with
`P3P2_OWNER_PASSWORD` set, to create a room for the game's address. It checks that every page builds the same table,
that no fleet reaches the room before the end, a reload, a shot at a closed page, Enter and T, the panel on a phone,
and the next battle. Options: `--url` (default: the build, served on :4173), `--engines` (Firefox and WebKit at the
table too), `--via <origin>` (through p3p2's lag proxy), `--speed 3`, `--headed`, `--video`.

URL parameters: `?quality=low|medium|high|ultra` (force a graphics tier), `?stats` (fps, draw calls,
triangles), `?seed=N` (reproducible games), `?e2e` (test hook used by the scripts).

## Graphics tiers

The game checks the device and browser on startup, then benchmarks the live ocean on the title screen and
picks a tier (Auto). Auto always starts on High at most and may move up to Ultra a moment later; if that happens
after PLAY, a toast says so. The pause screen names the tier too. You can lower or raise it in Settings at any time.
Within a tier, the render resolution drops in steps (down to 75%) while frames are slow on average, and comes back
once they're fast again.

- **Low / Medium / High**: a light single-pass sea shader on the wave simulation; High adds see-through
  water around hulls and hull ripples.
- **Ultra ("real water")**: most of threejs-water's pipeline: refraction and reflection, caustics, a
  shallow seabed, ship ripples, and wrecks that stay visible on the seabed.

Sunk ships: on every tier you see a ship go down; only Ultra keeps it on the seabed afterwards. That follows the tier
on screen: switching to Ultra shows the wrecks of ships sunk earlier, and leaving Ultra hides them.

## Credits

- Water simulation and Ultra water adapted from [threejs-water](https://github.com/jeantimex/threejs-water)
  by Yong Su, a port of [WebGL Water](http://madebyevan.com/webgl-water/) by Evan Wallace (MIT, see
  `THIRD_PARTY_NOTICES.md`).
- [three.js](https://threejs.org) (MIT).
- [@p3p2/client](https://github.com/doublependu/p3p2), with [lean-qr](https://github.com/davidje13/lean-qr) for the
  QR code (MIT).

## Backed by

Man & Bot

Browse web games at [Maize.Live](https://maize.live)
, or watch on YouTube [@RadWebGame](https://www.youtube.com/@RadWebGame)
