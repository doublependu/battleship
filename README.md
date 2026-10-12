# battleship
a classic battleship game

You against the AI, in 3D, on real water: three.js rendering, an interactive wave simulation adapted from
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

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server, production build, serve the build on :4173 |
| `npm test` | Unit tests (rules, placement, AI, game flow, tier decision, ripple model, sound mapping, settings) |
| `npm run sim` | Balance simulation: bots vs each AI difficulty (`-- --games 10000 --param hard.temperature=0.1`) |
| `npm run play` | Playwright "human" player: real clicks/taps, recordings in `recordings/` (gitignored) |
| `npm run loadtime` | Throttled load-time check (desktop + mobile proxy), fails above 4 s |
| `npm run perf` | Heavy-scene frame times per graphics tier (`-- --device phone --cpu 6`) |
| `npm run probe` | Auto graphics probe under several CPU throttles and screen sizes |
| `npm run size` | Bundle size report, fails over the 200 KB (JS) / 250 KB (total) brotli initial budget |

`npm run play` options: `--games N --device desktop|pixel7|iphone13|tablet --difficulty easy|normal|hard
--quality auto|low|medium|high|ultra --rotate --switch-quality --recaudio --speed 3 --headed --seed N
--url http://localhost:5173`. It needs `npm run build` first unless `--url` points at a running server.
`--recaudio` captures the game's own audio and, if `ffmpeg` is installed, muxes it into `gameplay.webm`.

URL parameters: `?quality=low|medium|high|ultra` (force a graphics tier), `?stats` (fps, draw calls,
triangles), `?seed=N` (reproducible games), `?e2e` (test hook used by the scripts).

## Graphics tiers

The game checks the device and browser on startup, then benchmarks the live ocean on the title screen and
picks a tier (Auto). You can lower or raise it in Settings at any time.

- **Low / Medium / High**: a light single-pass sea shader on the wave simulation; High adds see-through
  water around hulls and hull ripples.
- **Ultra ("real water")**: most of threejs-water's pipeline: refraction and reflection, caustics, a
  shallow seabed, ship ripples, and wrecks that stay visible on the seabed.

## Credits

- Water simulation and Ultra water adapted from [threejs-water](https://github.com/jeantimex/threejs-water)
  by Yong Su, a port of [WebGL Water](http://madebyevan.com/webgl-water/) by Evan Wallace (MIT, see
  `THIRD_PARTY_NOTICES.md`).
- [three.js](https://threejs.org) (MIT).

## Backed by

Man & Bot

Browse web games at [Maize.Live](https://maize.live)
, or watch on YouTube [@RadWebGame](https://www.youtube.com/@RadWebGame)
