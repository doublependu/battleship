// WebGLRenderer setup, resize/DPR handling, adaptive resolution and live tier switching.
import * as THREE from 'three';
import { TIERS, TIER_ORDER } from '../config.js';
import { CameraRig } from './camera.js';
import { Ocean } from './ocean/ocean.js';
import { WaterSim } from './ocean/sim.js';
import { createSkyDome, skyUniforms, SUN_COLOR, SUN_DIR } from './sky.js';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{antialias:boolean}} opts
   */
  constructor(canvas, { antialias }) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.gl = this.renderer.getContext();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 1600);
    this.rig = new CameraRig(this.camera);
    this.shared = { uTime: { value: 0 }, ...skyUniforms() };
    this.scene.add(createSkyDome(this.shared));

    this.sun = new THREE.DirectionalLight(SUN_COLOR, 2.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(50);
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe4f2, 0x1d4f66, 1.15);
    this.scene.add(this.hemi);
    // One reusable flash light, always present so materials never recompile when it fires.
    this.flash = new THREE.PointLight(0xffa860, 0, 14, 1.6);
    this.flash.position.set(0, 1.2, 0);
    this.scene.add(this.flash);
    // Lights also light the Ultra object passes (ships are on layer 1).
    for (const l of [this.sun, this.hemi, this.flash]) l.layers.enable(1);

    this.ocean = new Ocean(this.shared);
    this.scene.add(this.ocean.mesh);
    this.sim = null;
    this.tierName = null;
    this.tier = null;
    /** Subsystems that change with the tier: { prepareTier(tier) -> {objects?, apply()} }. */
    this.tierClients = [];
    this.ultra = null;

    this.dprScale = 1;
    this.cssWidth = 1;
    this.cssHeight = 1;
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };
    this.monitor = { samples: [], slowWindows: 0, fastWindows: 0, stableNeeded: 4, onTierDrop: null };
    this.autoTier = false;
    this.lastMs = 0;
  }

  get maxDpr() {
    return Math.min(window.devicePixelRatio || 1, this.tier?.dprCap ?? 1);
  }

  get pixelRatio() {
    return Math.max(0.75, this.maxDpr * this.dprScale);
  }

  resize(width, height, insets = this.insets) {
    this.cssWidth = Math.max(1, Math.round(width));
    this.cssHeight = Math.max(1, Math.round(height));
    this.insets = insets;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.cssWidth, this.cssHeight, false);
    this.rig.setViewport(this.cssWidth, this.cssHeight, insets);
    this.ultra?.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
  }

  setInsets(insets) {
    this.insets = insets;
    this.rig.setViewport(this.cssWidth, this.cssHeight, insets);
  }

  /**
   * Switch graphics tier live. New materials are compiled off-screen first, then swapped in, so the game
   * keeps rendering and its state is untouched.
   */
  async setTier(name) {
    const tier = { ...TIERS[name], key: name };
    const prevSim = this.sim;
    const prevUltra = this.ultra;
    let sim = prevSim;
    const simChanged = !prevSim || prevSim.size.x !== tier.sim[0] || prevSim.hz !== tier.simHz;
    if (simChanged) sim = new WaterSim(this.renderer, tier);
    let ultra = null;
    let oceanMaterial = null;
    if (tier.ultra && sim.enabled) {
      const mod = await import('./ocean/ultra/index.js');
      ultra = new mod.UltraWater(this, sim);
      oceanMaterial = ultra.surfaceMaterial;
    } else if (tier.ultra) {
      tier.ultra = false;
    }
    if (!oceanMaterial) oceanMaterial = this.ocean.createSeaMaterial(tier);

    const prepared = this.tierClients.map((c) => c.prepareTier(tier, ultra));
    const compileScene = new THREE.Scene();
    compileScene.add(new THREE.Mesh(this.ocean.mesh.geometry, oceanMaterial));
    for (const p of prepared) for (const o of p.objects ?? []) compileScene.add(o);
    for (const o of ultra?.compileObjects ?? []) compileScene.add(o);
    compileScene.add(this.sun.clone(), this.hemi.clone(), this.flash.clone());
    try {
      await this.renderer.compileAsync(compileScene, this.camera);
    } catch {
      /* compileAsync is an optimisation; render will compile synchronously if it fails */
    }

    this.tier = tier;
    this.tierName = name;
    this.sim = sim;
    this.ultra = ultra;
    this.ocean.setTier(tier, sim, oceanMaterial);
    for (const p of prepared) p.apply();
    if (simChanged && prevSim) prevSim.dispose();
    if (prevUltra && prevUltra !== ultra) prevUltra.dispose();
    this.dprScale = 1;
    this.monitor.samples = [];
    this.resize(this.cssWidth, this.cssHeight);
  }

  /** Adaptive resolution from frame intervals. Returns 'down' | 'up' | null when the tier should change. */
  trackFrame(intervalMs, budgetMs) {
    const m = this.monitor;
    m.samples.push(intervalMs);
    if (m.samples.length < 90) return null;
    const sorted = [...m.samples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    m.samples = [];
    if (p90 > budgetMs * 1.3) {
      m.fastWindows = 0;
      if (++m.slowWindows >= 2) {
        m.slowWindows = 0;
        m.stableNeeded = Math.min(32, m.stableNeeded * 2);
        if (this.pixelRatio > 0.75 + 1e-3) {
          this.dprScale = Math.max(0.75 / this.maxDpr, this.dprScale - 0.25 / this.maxDpr);
          this.resize(this.cssWidth, this.cssHeight);
        } else if (this.autoTier && TIER_ORDER.indexOf(this.tierName) > 0) {
          return 'down';
        }
      }
    } else if (p90 < budgetMs * 1.1) {
      m.slowWindows = 0;
      if (++m.fastWindows >= m.stableNeeded && this.dprScale < 1) {
        m.fastWindows = 0;
        this.dprScale = Math.min(1, this.dprScale + 0.25 / this.maxDpr);
        this.resize(this.cssWidth, this.cssHeight);
      }
    }
    return null;
  }

  render(time, dt) {
    this.shared.uTime.value = time;
    if (this.sim) this.sim.update(dt);
    this.ocean.update();
    this.ultra?.beforeRender(time);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  stats() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, dpr: this.pixelRatio, tier: this.tierName };
  }
}
