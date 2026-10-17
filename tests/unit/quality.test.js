import { describe, expect, it } from 'vitest';
import { RIPPLE_SPEED } from '../../src/config.js';
import { Ripples } from '../../src/render/ocean/ripples.js';
import { benchmarkDecision, classifyGpu, frameWindowVerdict, staticGuess, TierBenchmark } from '../../src/render/quality.js';

const base = { webgl2: true, floatRT: true, halfFloatRT: true, parallelCompile: true, timerQuery: false, maxTexture: 16384,
  gpu: '', cores: 8, memory: 8, mobile: false, pixels: 1e6, saveData: false };

describe('GPU classification', () => {
  it.each([
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'software'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 6GB Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['Apple M2', 'ultra'],
    ['Adreno (TM) 506', 'low'],
    ['Mali-G52 MC2', 'low'],
    ['Adreno (TM) 619', 'medium'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium'],
    ['Adreno (TM) 730', 'high'],
    ['Apple GPU', 'high'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
    ['Some Future GPU', 'unknown'],
  ])('%s -> %s', (gpu, family) => expect(classifyGpu(gpu)).toBe(family));
});

describe('static guess', () => {
  it('software GL -> Low with the sim off', () => {
    const g = staticGuess({ ...base, gpu: 'SwiftShader' });
    expect(g).toMatchObject({ guess: 'low', maxAuto: 'low', simAllowed: false, ultraAllowed: false });
  });
  it('no float buffers -> no sim, no Ultra', () => {
    const g = staticGuess({ ...base, floatRT: false, halfFloatRT: false, gpu: 'NVIDIA GeForce RTX 4090' });
    expect(g.simAllowed).toBe(false);
    expect(g.maxAuto).toBe('high');
  });
  it('<= 2 GB memory caps Auto at Medium', () => {
    expect(staticGuess({ ...base, memory: 2, gpu: 'Apple M1' }).maxAuto).toBe('medium');
  });
  it('no parallel shader compile or Save-Data -> no auto Ultra', () => {
    expect(staticGuess({ ...base, gpu: 'Apple M1', parallelCompile: false }).maxAuto).toBe('high');
    expect(staticGuess({ ...base, gpu: 'Apple M1', saveData: true }).maxAuto).toBe('high');
  });
  it('unknown GPUs start at Medium on phones and High on desktops', () => {
    expect(staticGuess({ ...base, gpu: '?', mobile: true }).guess).toBe('medium');
    expect(staticGuess({ ...base, gpu: '?' }).guess).toBe('high');
  });
});

describe('benchmark decision', () => {
  const tried = new Set(['medium']);
  it('steps up with plenty of headroom, down when over 85%', () => {
    expect(benchmarkDecision({ tier: 'medium', cost: 5, budget: 16.7, maxAuto: 'ultra', tried })).toEqual({ action: 'up', tier: 'high' });
    expect(benchmarkDecision({ tier: 'medium', cost: 15, budget: 16.7, maxAuto: 'ultra', tried })).toEqual({ action: 'down', tier: 'low' });
    expect(benchmarkDecision({ tier: 'medium', cost: 11, budget: 16.7, maxAuto: 'ultra', tried }).action).toBe('stop');
  });
  it('respects maxAuto and never re-tries a tier', () => {
    expect(benchmarkDecision({ tier: 'high', cost: 2, budget: 16.7, maxAuto: 'high', tried }).action).toBe('stop');
    expect(benchmarkDecision({ tier: 'medium', cost: 2, budget: 16.7, maxAuto: 'ultra', tried: new Set(['high']) }).action).toBe('stop');
  });

  it('state machine: climbs, backtracks from a slow tier, and settles', async () => {
    const costs = { low: 2, medium: 5, high: 7, ultra: 30 };
    let now = 0;
    const switched = [];
    let done = null;
    const b = new TierBenchmark({ start: 'medium', budget: 16.7, maxAuto: 'ultra', now: () => now,
      switchTier: async (t) => switched.push(t), onDone: (tier) => (done = tier) });
    for (let i = 0; i < 400 && !done; i++) {
      now += 16;
      b.sample([costs[b.tier]]);
      await Promise.resolve();
    }
    expect(switched).toEqual(['high', 'ultra', 'high']);
    expect(done).toBe('high');
  });
});

describe('adaptive resolution verdict', () => {
  const frames = (pattern) => Array.from({ length: 90 }, (_, i) => pattern[i % pattern.length]);
  const desktop = 1000 / 60;
  const phone = 1000 / 30;

  it('uneven frames that are on time on average are not slow (Firefox: pairs of 10 and 24 ms)', () => {
    expect(frameWindowVerdict(frames([10, 24]), desktop)).toBe('fast');
    expect(frameWindowVerdict(frames([16.7]), desktop)).toBe('fast');
  });
  it('slow when frames really are late', () => {
    expect(frameWindowVerdict(frames([20]), desktop)).toBe('slow');
    expect(frameWindowVerdict(frames([16.7, 16.7, 33.3]), desktop)).toBe('slow'); // a vsync missed in every three frames
  });
  it('one stall does not decide it (each frame counts as at most 3x budget)', () => {
    const stalled = frames([16.7]);
    stalled[40] = 250;
    expect(frameWindowVerdict(stalled, desktop)).toBe('fast');
  });
  it('keeps the resolution in between', () => {
    expect(frameWindowVerdict(frames([18.3]), desktop)).toBe(null);
  });
  it('same verdicts on the phone budget at double the times', () => {
    expect(frameWindowVerdict(frames([20, 48]), phone)).toBe('fast');
    expect(frameWindowVerdict(frames([40]), phone)).toBe('slow');
    expect(frameWindowVerdict(frames([33.3, 33.3, 66.7]), phone)).toBe('slow');
    expect(frameWindowVerdict(frames([36.6]), phone)).toBe(null);
  });
});

describe('CPU ripple model', () => {
  it('a ring arrives at the GPU sim wave speed and decays', () => {
    const r = new Ripples();
    r.add(0, 0, 0.6, -0.3, 0);
    const dist = 6;
    const arrival = dist / RIPPLE_SPEED;
    expect(Math.abs(r.height(dist, 0, arrival * 0.4))).toBeLessThan(1e-4); // not there yet
    let peak = 0;
    for (let t = arrival - 0.3; t < arrival + 0.5; t += 0.01) peak = Math.max(peak, Math.abs(r.height(dist, 0, t)));
    expect(peak).toBeGreaterThan(0.005);
    let late = 0;
    for (let t = arrival + 3; t < arrival + 3.5; t += 0.01) late = Math.max(late, Math.abs(r.height(dist + 12, 0, t + 3)));
    expect(late).toBeLessThan(peak);
  });
  it('keeps a bounded number of drops and prunes old ones', () => {
    const r = new Ripples();
    for (let i = 0; i < 40; i++) r.add(i, 0, 0.5, 0.2, i * 0.01);
    expect(r.drops.length).toBeLessThanOrEqual(16);
    r.prune(100);
    expect(r.drops.length).toBe(0);
  });
});
