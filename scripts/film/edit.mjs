// The cuts: three videos made from the takes' recordings and markers (`takes.mjs`), with ffmpeg.
//
// Each cut is a list of segments: a stretch of a take (or of the three friends' windows side by side), scaled to
// the cut's frame, with a caption at times. Segments are encoded one by one at the same size, rate and sound
// format, joined, and encoded once more with the loudness at −14 LUFS (YouTube's and X's level).
// Captions and cards are HTML, drawn into transparent PNGs by Playwright: no font files for ffmpeg to find.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const GAME = 'ch0.maize.live';
const REPO = 'github.com/doublependu/battleship';
const FPS = 60;

const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
const hasAudio = (file) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]).toString().trim() !== '';
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** A recording as the browser wrote it has no index: a copy with one, so that a seek does not read from the start. */
const seekable = (file) => {
  const out = file.replace(/\.mp4$/, '.seek.mp4');
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(file).mtimeMs) ffmpeg(['-i', file, '-c', 'copy', '-movflags', '+faststart', out]);
  return out;
};

// ---------------------------------------------------------------- captions and cards, from HTML

const CSS = `
  *{box-sizing:border-box;margin:0}
  html,body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif;color:#eef6fb}
  .frame{position:relative;overflow:hidden}
  .cap{position:absolute;background:rgba(5,25,40,.8);border-radius:22px;padding:22px 34px;box-shadow:0 10px 40px rgba(0,0,0,.45)}
  .cap b{display:block;font-weight:800;letter-spacing:.01em}
  .cap span{display:block;color:#ffd166;font-weight:600;margin-top:8px}
  .title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
    text-shadow:0 4px 30px rgba(0,20,40,.8)}
  .title h1{font-weight:900;letter-spacing:.08em;text-transform:uppercase}
  .title p{font-weight:600;opacity:.95}
  .end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
    background:rgba(3,18,30,.62);gap:.5em}
  .end .url{font-weight:900;color:#ffd166;letter-spacing:.02em}
  .end .small{opacity:.9;font-weight:600}
  .label{position:absolute;font-weight:800;text-align:center;text-shadow:0 2px 10px rgba(0,0,0,.8)}
  .label i{font-style:normal;font-weight:600;opacity:.8}
`;

/** Draws captions and cards into PNGs the size of the cut's frame. */
async function painter(dir, w, h) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  let n = 0;
  const tall = h > w;
  return {
    async png(body) {
      const file = `${dir}/card-${String(n++).padStart(3, '0')}.png`;
      await page.setContent(`<!doctype html><style>${CSS}</style><div class="frame" style="width:${w}px;height:${h}px">${body}</div>`);
      await page.screenshot({ path: file, omitBackground: true });
      return file;
    },
    /** A caption: lower left on a wide frame; high up on a tall one, clear of the Shorts buttons. */
    caption(text, sub = '') {
      const style = tall
        ? `left:60px;right:60px;top:${Math.round(h * 0.13)}px;text-align:center;font-size:58px;padding:30px 36px`
        : `left:80px;bottom:96px;max-width:${Math.round(w * 0.62)}px;font-size:44px`;
      return this.png(`<div class="cap" style="${style}"><b>${text}</b>${sub ? `<span style="font-size:${tall ? 40 : 30}px">${sub}</span>` : ''}</div>`);
    },
    title(text, sub) {
      const big = tall ? 150 : 150;
      return this.png(`<div class="title" style="${tall ? `padding-bottom:${Math.round(h * 0.25)}px` : ''}"><h1 style="font-size:${big}px">${text}</h1>` +
        `<p style="font-size:${tall ? 56 : 52}px">${sub}</p></div>`);
    },
    end() {
      const s = tall ? 1.15 : 1;
      return this.png(`<div class="end" style="font-size:${Math.round(44 * s)}px"><div style="font-weight:800;font-size:${Math.round(64 * s)}px">Play free in your browser</div>` +
        `<div class="url" style="font-size:${Math.round(96 * s)}px">${GAME}</div>` +
        `<div class="small" style="margin-top:1em">Fork it: ${REPO}</div>` +
        `<div class="small">More games on Maize.Live · YouTube @RadWebGame</div></div>`);
    },
    labels(items) {
      return this.png(items.map(({ x, y, width, text, sub }) =>
        `<div class="label" style="left:${x}px;top:${y}px;width:${width}px;font-size:34px">${text}${sub ? ` <i>${sub}</i>` : ''}</div>`).join(''));
    },
    close: () => browser.close(),
  };
}

// ---------------------------------------------------------------- segments

/**
 * Encodes one segment: `src` from `from` to `to` (seconds), fitted to w×h. `crop` is the part of the recording
 * that is the page; `fit` 'fill' (same shape), or 'pillar' (an upright phone on a wide frame, over a blur of itself).
 * `caps`: [{ png, from, to }] in the segment's own seconds. `fade`: seconds of fade from and to black.
 */
function segment(out, { src: raw, from, to, crop, fit = 'fill', caps = [], fade = 0, mute = false }, w, h) {
  const src = seekable(raw);
  const len = Math.max(0.2, to - from);
  const inputs = ['-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', src];
  for (const c of caps) inputs.push('-loop', '1', '-t', len.toFixed(3), '-i', c.png);
  const f = [];
  const pre = crop ? `crop='min(iw,${crop.w})':'min(ih,${crop.h})':0:0,` : '';
  if (fit === 'pillar') {
    f.push(`[0:v]${pre}split[a][b]`, `[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=28:2,eq=brightness=-0.12[bg]`,
      `[b]scale=-2:${h}:flags=lanczos[fg]`, `[bg][fg]overlay=(W-w)/2:0,fps=${FPS},setsar=1[v0]`);
  } else {
    f.push(`[0:v]${pre}scale=${w}:${h}:flags=lanczos,fps=${FPS},setsar=1[v0]`);
  }
  let last = 'v0';
  caps.forEach((c, i) => {
    const a = Math.max(0, c.from);
    const b = Math.min(len, c.to);
    f.push(`[${i + 1}:v]format=rgba,fade=t=in:st=${a.toFixed(2)}:d=0.3:alpha=1,fade=t=out:st=${Math.max(a, b - 0.3).toFixed(2)}:d=0.3:alpha=1[c${i}]`,
      `[${last}][c${i}]overlay=0:0:format=auto[v${i + 1}]`);
    last = `v${i + 1}`;
  });
  const fades = fade ? `,fade=t=in:st=0:d=${fade},fade=t=out:st=${(len - fade).toFixed(2)}:d=${fade}` : '';
  f.push(`[${last}]format=yuv420p${fades}[vout]`);
  const audio = !mute && hasAudio(src);
  const af = `atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,` +
    `afade=t=in:d=0.08,afade=t=out:st=${Math.max(0, len - 0.12).toFixed(3)}:d=0.12`;
  if (audio) f.push(`[0:a]${af}[aout]`);
  else f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${len.toFixed(3)}[aout]`);
  ffmpeg([...inputs, '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', len.toFixed(3),
    '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-g', String(FPS), '-c:a', 'pcm_s16le', out]);
  return len;
}

/**
 * The friends' three windows side by side over a blur of the sea, from `from` to `to` in the friends take's time,
 * with their names over them and Ada's sound.
 */
function trio(out, { take, from, to, caps = [], labels, sea }, w, h) {
  const len = Math.max(0.2, to - from);
  const recs = take.recordings;
  const inputs = [];
  const f = [];
  const ph = Math.round(h * 0.84);
  const pw = Math.round((ph * recs[0].crop.w) / recs[0].crop.h / 2) * 2;
  const gap = Math.round((w - 3 * pw) / 4);
  const y = Math.round(h * 0.11);
  recs.forEach((r, i) => {
    const offset = (r.startedAt - take.t0) / 1000;
    const ss = from - offset;
    inputs.push('-ss', Math.max(0, ss).toFixed(3), '-t', len.toFixed(3), '-i', seekable(r.file));
    const pad = ss < 0 ? `,tpad=start_duration=${(-ss).toFixed(3)}:color=0x0b2a40` : '';
    f.push(`[${i}:v]crop='min(iw,${r.crop.w})':'min(ih,${r.crop.h})':0:0,scale=${pw}:${ph}:flags=lanczos,fps=${FPS},setsar=1${pad},tpad=stop_mode=clone:stop_duration=${len.toFixed(2)},trim=0:${len.toFixed(3)}[p${i}]`);
  });
  inputs.push('-ss', sea.from.toFixed(3), '-t', len.toFixed(3), '-i', seekable(sea.file));
  const s = recs.length;
  f.push(`[${s}:v]scale=${w}:${h},boxblur=30:2,eq=brightness=-0.2,fps=${FPS},setsar=1,tpad=stop_mode=clone:stop_duration=${len.toFixed(2)},trim=0:${len.toFixed(3)}[bg]`);
  let last = 'bg';
  recs.forEach((_, i) => {
    f.push(`[${last}][p${i}]overlay=${gap + i * (pw + gap)}:${y}[t${i}]`);
    last = `t${i}`;
  });
  inputs.push('-loop', '1', '-t', len.toFixed(3), '-i', labels);
  f.push(`[${last}][${s + 1}:v]overlay=0:0[l]`);
  last = 'l';
  caps.forEach((c, i) => {
    inputs.push('-loop', '1', '-t', len.toFixed(3), '-i', c.png);
    const a = Math.max(0, c.from);
    const b = Math.min(len, c.to);
    f.push(`[${s + 2 + i}:v]format=rgba,fade=t=in:st=${a.toFixed(2)}:d=0.3:alpha=1,fade=t=out:st=${Math.max(a, b - 0.3).toFixed(2)}:d=0.3:alpha=1[c${i}]`,
      `[${last}][c${i}]overlay=0:0[k${i}]`);
    last = `k${i}`;
  });
  f.push(`[${last}]format=yuv420p[vout]`);
  const ada = recs.findIndex((r) => r.who === 'Ada');
  const adaSs = from - (recs[ada].startedAt - take.t0) / 1000;
  f.push(`[${ada}:a]${adaSs < 0 ? `adelay=${Math.round(-adaSs * 1000)}:all=1,` : ''}apad,atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS,` +
    `aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=0.08,afade=t=out:st=${Math.max(0, len - 0.12).toFixed(3)}:d=0.12[aout]`);
  ffmpeg([...inputs, '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', len.toFixed(3),
    '-c:v', 'libx264', '-crf', '12', '-preset', 'veryfast', '-g', String(FPS), '-c:a', 'pcm_s16le', out]);
  return len;
}

/** Joins the segments and makes the final file: H.264 high, AAC, −14 LUFS, ready to stream from the start. */
function join(parts, out, dir) {
  const list = `${dir}/parts.txt`;
  // Paths in the list are taken from the list's own folder: give them whole.
  writeFileSync(list, parts.map((p) => `file '${resolve(p).replace(/'/g, "'\\''")}'`).join('\n'));
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-profile:v', 'high',
    '-pix_fmt', 'yuv420p', '-r', String(FPS), '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', out]);
}

// ---------------------------------------------------------------- what to show, from the markers

const of = (take, kind, pick = (m) => true) => (take?.markers ?? []).filter((m) => m.kind === kind && pick(m));
const first = (take, kind, pick) => of(take, kind, pick)[0];

/**
 * Stretches of a battle worth seeing, merged where they touch: sinkings (the shot and the close-up after it), hits,
 * the AI's hits, and a couple of misses; the longest list that fits in `budget` seconds, the least telling left out.
 */
function highlights(take, budget, { misses = 2, aiHits = true } = {}) {
  const ms = take.markers;
  const wins = [];
  const closeupLen = (m) => (m.what === 'their ship sinks' ? 5.2 : m.what === 'wrecks on the seabed' ? 4.5 : 4.2);
  for (const m of ms) {
    if (m.kind === 'closeup') wins.push({ from: m.at, to: m.at + closeupLen(m), rank: m.what === 'their ship sinks' ? 0 : 1 });
    else if (m.by === 'player' && m.kind === 'sunk') wins.push({ from: m.at - 2.6, to: m.at + 0.6, rank: 0 });
    else if (m.by === 'player' && m.kind === 'hit') wins.push({ from: m.at - 2.3, to: m.at + 1.6, rank: 2 });
    else if (m.by === 'ai' && m.kind !== 'miss' && aiHits) wins.push({ from: m.at - 2.0, to: m.at + 1.6, rank: 3 });
  }
  for (const m of ms.filter((x) => x.by === 'player' && x.kind === 'miss').slice(0, misses)) wins.push({ from: m.at - 2.3, to: m.at + 1.0, rank: 2 });
  const total = (list) => merge(list).reduce((t, w) => t + w.to - w.from, 0);
  let keep = wins;
  for (let rank = 3; rank > 0 && total(keep) > budget; rank--) {
    // Drop every other window of this rank, from the middle of the battle out, until it fits.
    const ranked = keep.filter((w) => w.rank === rank);
    for (let i = 0; i < ranked.length && total(keep) > budget; i += 2) keep = keep.filter((w) => w !== ranked[i]);
    if (total(keep) > budget) keep = keep.filter((w) => w.rank !== rank);
  }
  return merge(keep);
}

function merge(list) {
  const sorted = [...list].sort((a, b) => a.from - b.from);
  const out = [];
  for (const w of sorted) {
    const prev = out.at(-1);
    if (prev && w.from <= prev.to + 0.4) prev.to = Math.max(prev.to, w.to);
    else out.push({ from: w.from, to: w.to });
  }
  return out;
}

/** The biggest sinking in close-up: the last one (the battle ends with it), or else any. */
const lastSinking = (take) => of(take, 'closeup', (m) => m.what === 'their ship sinks').at(-1);

// ---------------------------------------------------------------- the cuts

async function youtube({ dir, takes }) {
  const W = 1920;
  const H = 1080;
  const work = `${dir}/cut-youtube`;
  mkdirSync(work, { recursive: true });
  const p = await painter(work, W, H);
  const parts = [];
  const chapters = [];
  let t = 0;
  const add = (spec, chapter) => {
    if (chapter) chapters.push({ at: t, title: chapter });
    const file = `${work}/part-${String(parts.length).padStart(3, '0')}.mkv`;
    t += spec.trio ? trio(file, spec, W, H) : segment(file, spec, W, H);
    parts.push(file);
  };
  const ai = takes['battle-ai'];
  const sea = takes.sea;
  try {
    // Cold open: the last ship going down, close; then one of ours hit.
    const sink = lastSinking(ai);
    add({ src: ai.file, from: sink.at - 0.4, to: sink.at + 6.2, caps: [{ png: await p.title('Battleship', 'on real water, in your browser'), from: 0.6, to: 6.0 }], fade: 0.3 }, 'Cold open');
    const ours = first(ai, 'closeup', (m) => m.what === 'our ship hit');
    if (ours) add({ src: ai.file, from: ours.at, to: ours.at + 4.0 });

    // The title screen and the sea.
    if (sea) {
      const clean = first(sea, 'clean');
      add({ src: sea.file, from: 0.5, to: 8.5, caps: [
        { png: await p.caption('No downloads', 'no images, models or audio files: all of it is made in the browser'), from: 0.4, to: 4.2 },
        { png: await p.caption('Ready in well under a second', 'about a third of a second on a desktop'), from: 4.4, to: 7.9 },
      ] }, 'The game');
      add({ src: sea.file, from: clean.at + 0.8, to: clean.at + 9.5, caps: [
        { png: await p.caption('Real water', 'an interactive wave simulation, adapted from threejs-water'), from: 0.8, to: 7.5 },
      ] });
    }

    // Placement.
    const placement = first(ai, 'placement');
    const battle = first(ai, 'battle');
    add({ src: ai.file, from: placement.at - 0.6, to: Math.min(battle.at + 1.5, placement.at + 24), caps: [
      { png: await p.caption('Place your fleet', 'drag a ship to move it, tap it to turn it'), from: 1.0, to: 7.0 },
    ] }, 'Placing the fleet');

    // The battle: highlights, with a few captions along the way.
    const wins = highlights(ai, 150);
    const notes = [
      [await p.caption('Against the AI', 'three levels: Recruit, Captain and Admiral'), 0],
      [await p.caption('Hits burn, and ships go down', 'explosions, fire, smoke, and a sinking for every ship'), Math.floor(wins.length * 0.3)],
      [await p.caption('Sound and music', 'synthesized in the browser, as the battle goes'), Math.floor(wins.length * 0.55)],
      [await p.caption('Wrecks stay on the seabed', 'on Ultra graphics, under the moving water'), wins.findIndex((w) => of(ai, 'closeup', (m) => m.what === 'wrecks on the seabed' && m.at >= w.from && m.at <= w.to).length)],
    ];
    wins.forEach((w, i) => {
      const caps = notes.filter(([, at]) => at === i).map(([png]) => ({ png, from: 0.2, to: Math.min(w.to - w.from, 5) }));
      add({ src: ai.file, from: w.from, to: w.to, caps }, i === 0 ? 'A battle against the AI' : undefined);
    });
    const over = first(ai, 'over');
    const endCard = first(ai, 'end-card');
    add({ src: ai.file, from: over.at - 0.5, to: (endCard?.at ?? over.at + 7) + 1.5 });

    // The graphics tiers.
    const tiers = takes.tiers;
    if (tiers) {
      const low = first(tiers, 'tier-low');
      add({ src: tiers.file, from: Math.max(0, low.at - 6.5), to: low.at + 4.5, caps: [
        { png: await p.caption('Four graphics tiers', 'Auto picks one for your device; change it any time'), from: 0.3, to: 6.0 },
        { png: await p.caption('Low'), from: 6.6, to: 11 },
      ] }, 'Graphics: Low to Ultra');
      for (const [tier, label, sub] of [['medium', 'Medium', ''], ['high', 'High', 'see-through water and ripples around the hulls'],
        ['ultra', 'Ultra', 'refraction, reflections, caustics on a shallow seabed']]) {
        const m = first(tiers, `tier-${tier}`);
        add({ src: tiers.file, from: m.at - 0.2, to: m.at + 4.2, caps: [{ png: await p.caption(label, sub), from: 0.2, to: 4.2 }] });
      }
      const u = first(tiers, 'closeup');
      if (u) add({ src: tiers.file, from: u.at, to: u.at + 6 });
    }

    // Phones.
    const side = takes['phone-sideways'];
    const up = takes.phone;
    if (side) {
      const pl = first(side, 'placement');
      add({ src: side.file, crop: side.crop, from: pl.at - 0.5, to: pl.at + 11, caps: [
        { png: await p.caption('Phones and tablets', 'the same game, laid out for the screen'), from: 0.5, to: 6 },
      ] }, 'On a phone');
    }
    if (up) {
      // A sinking from the middle of the game: the last one runs into the end screen.
      const sinkings = of(up, 'closeup', (m) => m.what === 'their ship sinks');
      const s = sinkings[Math.floor(sinkings.length / 2)];
      const hit = first(up, 'hit', (m) => m.by === 'player');
      if (hit) add({ src: up.file, crop: up.crop, fit: 'pillar', from: hit.at - 2.6, to: hit.at + 1.8, caps: [
        { png: await p.caption('Upright too', 'tap to aim, tap again to fire'), from: 0.3, to: 4.2 },
      ] }, side ? undefined : 'On a phone');
      if (s) add({ src: up.file, crop: up.crop, fit: 'pillar', from: s.at - 0.3, to: s.at + 5.2 });
    }

    // Play with a friend.
    const fr = takes.friends;
    if (fr) {
      const labels = await p.labels(trioLabels(fr, W, H));
      const sea0 = { file: sea?.file ?? ai.file, from: sea ? first(sea, 'clean').at + 1 : 1 };
      const at = (kind, pick) => first(fr, kind, pick)?.at;
      const spans = [
        [at('panel'), at('qr') + 3.5, 'Play with a friend', 'a p3p2 room: send the link, or show its QR code', 'Play with a friend'],
        [at('asked to join', (m) => m.who === 'Grace'), at('joined', (m) => m.who === 'Grace') + 1.5, 'They open the link, and they are in', ''],
        [at('ask', (m) => m.who === 'Edsger'), at('in line', (m) => m.who === 'Edsger') + 2.5, 'A third friend watches', 'and can ask to play next'],
        [at('battle') - 1, at('battle') + 9, 'Each fleet stays in its own browser', 'the room holds only a promise about it'],
        [at('chat') - 4, at('chat') + 2.5, 'Chat while you play', ''],
        [at('over') - 6, at('over') + 5, 'Checked at the end', 'both fleets are shown, and checked against every answer'],
        [at('next battle') - 1.5, at('battle 2') + 4, 'Watchers take turns', 'the winner stays; the next in line takes the loser\'s seat'],
      ];
      let firstSpan = true;
      for (const [from, to, text, sub, chapter] of spans) {
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        add({ trio: true, take: fr, from, to: Math.min(to, from + 14), labels, sea: sea0,
          caps: [{ png: await p.caption(text, sub), from: 0.3, to: Math.min(6, to - from - 0.2) }] }, firstSpan ? chapter : undefined);
        firstSpan = false;
      }
    }

    // The end card, over the sea.
    const endFrom = sea ? first(sea, 'clean-close').at + 0.5 : 2;
    add({ src: sea?.file ?? ai.file, from: endFrom, to: endFrom + 9, caps: [{ png: await p.end(), from: 0.4, to: 9 }], fade: 0.4 }, 'Play it');

    const out = `${dir}/youtube.mp4`;
    join(parts, out, work);
    // The thumbnail: the last sinking, with the title.
    const frame = `${work}/thumb-frame.png`;
    ffmpeg(['-ss', String(sink.at + 2.2), '-i', ai.file, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', frame]);
    const p2 = await painter(work, 1280, 720);
    const over2 = await p2.png('<div class="title" style="background:linear-gradient(rgba(3,18,30,.1),rgba(3,18,30,.55))"><h1 style="font-size:132px">Battleship</h1>' +
      '<p style="font-size:46px">on real water · free in your browser</p></div>');
    await p2.close();
    ffmpeg(['-i', frame, '-i', over2, '-filter_complex', 'overlay=0:0', `${dir}/thumbnail.png`]);
    writeFileSync(`${dir}/youtube.txt`, describe(chapters, duration(out)));
    return out;
  } finally {
    await p.close();
  }
}

/** Where the three names go over the friends' windows (see `trio`). */
function trioLabels(fr, w, h) {
  const recs = fr.recordings;
  const ph = Math.round(h * 0.84);
  const pw = Math.round((ph * recs[0].crop.w) / recs[0].crop.h / 2) * 2;
  const gap = Math.round((w - 3 * pw) / 4);
  const sub = { Ada: 'host', Grace: '', Edsger: 'watching' };
  return recs.map((r, i) => ({ x: gap + i * (pw + gap), y: Math.round(h * 0.11) - 50, width: pw, text: r.who, sub: sub[r.who] }));
}

function describe(chapters, total) {
  const lines = chapters.filter((c, i) => i === 0 || c.at - chapters[i - 1].at >= 10).map((c, i) => `${fmt(i === 0 ? 0 : c.at)} ${c.title}`);
  return `Title: Battleship on real water: free, in your browser (three.js)

Description:
Classic Battleship in 3D, on an interactive water simulation, with explosions, fires and ships that go down.
Play against the AI (Recruit, Captain or Admiral) or with a friend by sending a link. No install and no downloads:
the ships, the sound and the music are all made in the browser, so it is ready in well under a second, on a
desktop or a phone.

Play: https://${GAME}
Source (GPL-3.0, fork it): https://${REPO}
Multiplayer: p3p2, https://p3p2.me
Water adapted from threejs-water by Yong Su (MIT), a port of WebGL Water by Evan Wallace.
More games: https://maize.live

${lines.join('\n')}

Tags: battleship, browser game, three.js, webgl, water simulation, naval battle, multiplayer, indie game

(${fmt(total)} long; filmed on Ultra graphics on a desktop PC; the phone shots are a phone-sized screen.)
`;
}

async function short({ dir, takes }) {
  const W = 1080;
  const H = 1920;
  const up = takes.phone;
  if (!up) throw new Error('the Short needs the phone take');
  const work = `${dir}/cut-short`;
  mkdirSync(work, { recursive: true });
  const p = await painter(work, W, H);
  const parts = [];
  let t = 0;
  const add = (spec) => {
    const file = `${work}/part-${String(parts.length).padStart(3, '0')}.mkv`;
    t += segment(file, { crop: up.crop, src: up.file, ...spec }, W, H);
    parts.push(file);
  };
  try {
    const sink = lastSinking(up) ?? first(up, 'sunk', (m) => m.by === 'player');
    add({ from: sink.at - 0.2, to: sink.at + 4.6, caps: [{ png: await p.caption('Battleship, on real water', 'free, in your browser'), from: 0.2, to: 4.6 }] });
    const pl = first(up, 'placement');
    const battle = first(up, 'battle');
    add({ from: pl.at + 0.8, to: Math.min(battle.at + 0.5, pl.at + 8), caps: [{ png: await p.caption('Drag your ships into place'), from: 0.2, to: 5 }] });
    const wins = highlights(up, 30, { misses: 1, aiHits: false }).filter((w) => !(w.from <= sink.at && w.to >= sink.at));
    const mid = await p.caption('Hits burn. Ships sink.', 'sound and music made as you play');
    wins.forEach((w, i) => add({ from: w.from, to: w.to, caps: i === 1 ? [{ png: mid, from: 0.2, to: Math.min(4, w.to - w.from) }] : [] }));
    const over = first(up, 'over');
    add({ from: over.at - 0.3, to: over.at + 6 });
    add({ from: 1, to: 5.5, caps: [{ png: await p.end(), from: 0.2, to: 5.5 }], fade: 0.3 });
    const out = `${dir}/short.mp4`;
    join(parts, out, work);
    if (duration(out) > 60) console.warn(`  (the Short is ${duration(out).toFixed(1)} s: over 60 s)`);
    return out;
  } finally {
    await p.close();
  }
}

async function x({ dir, takes }) {
  const W = 1920;
  const H = 1080;
  const work = `${dir}/cut-x`;
  mkdirSync(work, { recursive: true });
  const p = await painter(work, W, H);
  const parts = [];
  const add = (spec) => {
    const file = `${work}/part-${String(parts.length).padStart(3, '0')}.mkv`;
    if (spec.trio) trio(file, spec, W, H);
    else segment(file, spec, W, H);
    parts.push(file);
  };
  const ai = takes['battle-ai'];
  try {
    const sink = lastSinking(ai);
    add({ src: ai.file, from: sink.at - 0.2, to: sink.at + 5, caps: [{ png: await p.caption('Battleship, on real water', 'free, in your browser: no install, no downloads'), from: 0.3, to: 5 }] });
    const wins = highlights(ai, 15, { misses: 0, aiHits: false }).filter((w) => !(w.from <= sink.at && w.to >= sink.at)).slice(0, 4);
    const note = await p.caption('Explosions, fire, and ships that go down');
    wins.forEach((w, i) => add({ src: ai.file, from: w.from, to: w.to, caps: i === 0 ? [{ png: note, from: 0.2, to: Math.min(4, w.to - w.from) }] : [] }));
    const tiers = takes.tiers;
    if (tiers) {
      for (const [tier, text] of [['low', 'Low graphics, for any device'], ['ultra', 'Ultra: refraction, caustics, wrecks on the seabed']]) {
        const m = first(tiers, `tier-${tier}`);
        add({ src: tiers.file, from: m.at, to: m.at + 3.2, caps: [{ png: await p.caption(text), from: 0.1, to: 3.2 }] });
      }
    }
    const side = takes['phone-sideways'];
    if (side) {
      const pl = first(side, 'placement');
      add({ src: side.file, crop: side.crop, from: pl.at + 1, to: pl.at + 5.5, caps: [{ png: await p.caption('On phones too'), from: 0.2, to: 4.5 }] });
    }
    const fr = takes.friends;
    if (fr) {
      const sea = takes.sea;
      const labels = await p.labels(trioLabels(fr, W, H));
      const from = first(fr, 'battle').at + 1;
      add({ trio: true, take: fr, from, to: from + 7, labels, sea: { file: sea?.file ?? ai.file, from: sea ? first(sea, 'clean').at + 1 : 1 },
        caps: [{ png: await p.caption('Play with a friend', 'send a link; watchers take turns'), from: 0.3, to: 6.5 }] });
    }
    const sea = takes.sea;
    const endFrom = sea ? first(sea, 'clean-close').at + 0.5 : 2;
    add({ src: sea?.file ?? ai.file, from: endFrom, to: endFrom + 5.5, caps: [{ png: await p.end(), from: 0.2, to: 5.5 }], fade: 0.3 });
    const out = `${dir}/x.mp4`;
    join(parts, out, work);
    return out;
  } finally {
    await p.close();
  }
}

export const CUTS = { youtube, short, x };
