// Device + browser probe and Auto graphics tier (plan §5.5).
// Stage 1: static check before the first frame (no network). Stage 2: a live benchmark of the real ocean on
// the title screen, measuring frame *cost* (GPU timer query, or submit-to-finish via a 1x1 readPixels).
import { TIER_ORDER } from '../config.js';

const STORAGE_KEY = 'bs.quality.v1';

/** GPU family table: maps the renderer string to a starting guess. Order matters. */
const GPU_FAMILIES = [
  ['software', /swiftshader|llvmpipe|softpipe|lavapipe|basic render|software/i],
  ['ultra', /apple m\d|nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|radeon r9|arc\(tm\) a\d|arc a\d{3}/i],
  ['low', /adreno[^0-9]*[345]\d\d\b|mali-[t4]|mali-g[35]\d\b|powervr|sgx|videocore|hd graphics [2-5]\d{2,3}\b|gc\d{3,4}/i],
  ['medium', /adreno[^0-9]*6\d\d\b|mali-g[5-7]\d\b|uhd graphics|hd graphics|intel.*graphics \(|mesa intel/i],
  ['high', /adreno[^0-9]*[789]\d\d\b|immortalis|mali-g[6-9]\d\d|xclipse|apple gpu|apple a1[5-9]|iris|arc|radeon|intel\(r\) graphics/i],
];

export function classifyGpu(gpu = '') {
  for (const [family, re] of GPU_FAMILIES) if (re.test(gpu)) return family;
  return 'unknown';
}

/** Collect static facts about the device/browser. `gl` is a WebGL2 context or null. */
export function collectInfo(gl, nav = globalThis.navigator ?? {}, win = globalThis.window ?? {}) {
  const info = {
    webgl2: !!gl,
    floatRT: false,
    halfFloatRT: false,
    parallelCompile: false,
    timerQuery: false,
    maxTexture: 0,
    gpu: '',
    cores: nav.hardwareConcurrency ?? 0,
    memory: nav.deviceMemory,
    mobile: !!(nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(nav.userAgent ?? '')) ||
      !!win.matchMedia?.('(pointer: coarse)').matches,
    pixels: Math.round((win.innerWidth ?? 1280) * (win.innerHeight ?? 720) * Math.min(2, win.devicePixelRatio ?? 1) ** 2),
    saveData: !!nav.connection?.saveData,
  };
  if (!gl) return info;
  info.floatRT = !!gl.getExtension('EXT_color_buffer_float');
  info.halfFloatRT = info.floatRT || !!gl.getExtension('EXT_color_buffer_half_float');
  info.parallelCompile = !!gl.getExtension('KHR_parallel_shader_compile');
  info.timerQuery = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
  info.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  info.gpu = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  return info;
}

const clampTier = (tier, max) => TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier), TIER_ORDER.indexOf(max))];

/**
 * Pure decision from static facts: starting guess + limits for Auto.
 * @returns {{guess:string, maxAuto:string, simAllowed:boolean, ultraAllowed:boolean, family:string}}
 */
export function staticGuess(info) {
  const family = classifyGpu(info.gpu);
  let guess = family === 'unknown' ? (info.mobile ? 'medium' : 'high') : family === 'software' ? 'low' : family;
  let maxAuto = 'ultra';
  let simAllowed = info.floatRT || info.halfFloatRT;
  let ultraAllowed = simAllowed && info.maxTexture >= 2048;
  if (family === 'software') {
    maxAuto = 'low';
    simAllowed = false;
    ultraAllowed = false;
  }
  if (info.memory !== undefined && info.memory <= 2) maxAuto = clampTier(maxAuto, 'medium');
  if (info.mobile && info.cores > 0 && info.cores <= 4) maxAuto = clampTier(maxAuto, 'medium');
  if (!ultraAllowed || info.saveData) maxAuto = clampTier(maxAuto, 'high');
  // Without parallel shader compile, compiling Ultra later could hitch, so Auto never picks it.
  if (!info.parallelCompile) maxAuto = clampTier(maxAuto, 'high');
  guess = clampTier(guess, maxAuto);
  return { guess, maxAuto, simAllowed, ultraAllowed, family };
}

export const frameBudgetMs = (info) => (info.mobile ? 1000 / 30 : 1000 / 60);

const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
};

/**
 * Pure benchmark step: given the current tier and its p90 cost, decide the next action.
 * @returns {{action:'up'|'down'|'stop', tier:string}}
 */
export function benchmarkDecision({ tier, cost, budget, maxAuto, tried }) {
  const i = TIER_ORDER.indexOf(tier);
  const up = TIER_ORDER[i + 1];
  const down = TIER_ORDER[i - 1];
  if (cost >= budget * 0.85 && down) return { action: 'down', tier: down };
  if (cost <= budget * 0.5 && up && TIER_ORDER.indexOf(up) <= TIER_ORDER.indexOf(maxAuto) && !tried.has(up)) {
    return { action: 'up', tier: up };
  }
  return { action: 'stop', tier };
}

/**
 * Adaptive resolution: verdict on one window of frame intervals (ms), 'slow' | 'fast' | null (keep).
 * By the average, with each frame counted as at most 3x budget. Frames that come unevenly but on time on average
 * (Firefox at 60 fps: pairs of ~10 and ~24 ms) aren't slow, and one stall (a hidden window, a GC pause, a shader
 * compiling) doesn't decide it: a lower resolution wouldn't help either.
 */
export function frameWindowVerdict(samples, budget) {
  const mean = samples.reduce((sum, ms) => sum + Math.min(ms, budget * 3), 0) / samples.length;
  if (mean > budget * 1.15) return 'slow';
  if (mean < budget * 1.05) return 'fast';
  return null;
}

export function storageKey(info, nav = globalThis.navigator ?? {}, win = globalThis.window ?? {}) {
  const browser = (nav.userAgent ?? '').match(/(Chrome|Firefox|Version)\/(\d+)/)?.slice(1).join('') ?? '';
  return `${info.gpu}|${win.screen?.width}x${win.screen?.height}@${win.devicePixelRatio}|${browser}`;
}

export function loadStoredAuto(key) {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return s && s.key === key && TIER_ORDER.includes(s.tier) ? s : null;
  } catch {
    return null;
  }
}

export function storeAuto(key, tier, cost) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, tier, cost: Math.round(cost * 10) / 10, at: Date.now() }));
  } catch {
    /* private mode */
  }
}

/**
 * Measures frame cost. Uses EXT_disjoint_timer_query_webgl2 where available, otherwise a 1x1 readPixels
 * after rendering to time submit-to-finish. Only active during the benchmark.
 */
export class FrameCostMeter {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.pixel = new Uint8Array(4);
    this.t0 = 0;
    this.query = null;
    this.baseline = this.ext ? 0 : this.#syncBaseline();
  }

  /** Cost of the readPixels sync itself (flush latency), subtracted from every sample. */
  #syncBaseline() {
    const gl = this.gl;
    const samples = [];
    for (let i = 0; i < 9; i++) {
      const t = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
      samples.push(performance.now() - t);
    }
    return quantile(samples, 0.5);
  }

  begin() {
    this.t0 = performance.now();
    if (this.ext) {
      this.query = this.gl.createQuery();
      this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query);
    }
  }

  /** @returns {number[]} costs (ms) that became available this frame */
  end() {
    const gl = this.gl;
    const out = [];
    if (this.ext) {
      gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push({ q: this.query, cpu: performance.now() - this.t0 });
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      while (this.pending.length && gl.getQueryParameter(this.pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const { q, cpu } = this.pending.shift();
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        gl.deleteQuery(q);
        if (!disjoint) out.push(Math.max(ns / 1e6, cpu));
      }
      if (this.pending.length > 8) this.pending.splice(0, this.pending.length - 8).forEach((p) => gl.deleteQuery(p.q));
    } else {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
      out.push(Math.max(0.1, performance.now() - this.t0 - this.baseline));
    }
    return out;
  }

  dispose() {
    for (const p of this.pending) this.gl.deleteQuery(p.q);
    this.pending = [];
  }
}

/**
 * Title-screen benchmark state machine. Feed it costs each frame; it calls switchTier() to test a tier
 * and onDone(tier, cost) when settled. Never runs before bs-ready.
 */
export class TierBenchmark {
  constructor({ start, budget, maxAuto, switchTier, onDone, quick = false, now = () => performance.now() }) {
    this.tier = start;
    this.budget = budget;
    this.maxAuto = maxAuto;
    this.switchTier = switchTier;
    this.onDone = onDone;
    this.tried = new Set([start]);
    this.samples = [];
    this.warmup = quick ? 10 : 20;
    this.needed = quick ? 30 : 60;
    this.log = [];
    this.done = false;
    this.busy = false;
    this.now = now;
    this.startedAt = now();
    this.lastCost = 0;
  }

  sample(costs) {
    if (this.done || this.busy) return;
    for (const c of costs) {
      if (this.warmup > 0) {
        this.warmup--;
        continue;
      }
      this.samples.push(c);
    }
    if (this.samples.length < this.needed && this.now() - this.startedAt < 6000) return;
    // Median: the sync measurement serialises CPU and GPU work, so spikes overstate real (pipelined) cost.
    const cost = quantile(this.samples, 0.5);
    this.log.push({ tier: this.tier, cost: Math.round(cost * 100) / 100, n: this.samples.length });
    const d = benchmarkDecision({ tier: this.tier, cost, budget: this.budget, maxAuto: this.maxAuto, tried: this.tried });
    const timeUp = this.now() - this.startedAt > 3500;
    const backtrack = d.action === 'down' && this.tried.has(d.tier);
    if (d.action === 'stop' || timeUp || backtrack) {
      if (backtrack) this.#settle(d.tier, this.lastCost);
      else if (d.action === 'down' && timeUp) this.#switch(d.tier).then(() => this.#settle(d.tier, cost));
      else this.#settle(this.tier, cost);
      return;
    }
    this.lastCost = cost;
    this.#switch(d.tier);
  }

  async #switch(tier) {
    this.busy = true;
    this.tried.add(tier);
    this.tier = tier;
    this.samples = [];
    this.warmup = 10;
    this.needed = 30;
    try {
      await this.switchTier(tier);
    } finally {
      this.busy = false;
    }
  }

  #settle(tier, cost) {
    if (this.done) return;
    this.done = true;
    if (tier !== this.tier) {
      this.tier = tier;
      this.switchTier(tier);
    }
    this.onDone(tier, cost, this.log);
  }
}
