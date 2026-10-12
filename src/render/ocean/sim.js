// Interactive water heightfield. Ported from threejs-water src/Water.ts
// (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su; TypeScript -> JS). See THIRD_PARTY_NOTICES.md.
// Kept: ping-pong render targets (R height, G velocity, BA normal x/z), drop, step and normal passes,
// float -> half-float fallback, cleared targets + nearest filtering (upstream's iOS precision fixes).
// Changed: world-space domain around both boards, absorbing sponge boundary, fixed timestep with the same
// physical wave speed on every tier, and all hull displacements batched into one pass.
import * as THREE from 'three';
import { RIPPLE_DAMPING, RIPPLE_SPEED, SIM_DOMAIN } from '../../config.js';
import boxFrag from './shaders/box.frag.glsl?raw';
import dropFrag from './shaders/drop.frag.glsl?raw';
import vert from './shaders/fullscreen.vert.glsl?raw';
import normalFrag from './shaders/normal.frag.glsl?raw';
import stepFrag from './shaders/step.frag.glsl?raw';

export function simTextureType(renderer) {
  const ext = renderer.extensions;
  if (ext.has('EXT_color_buffer_float') && ext.has('OES_texture_float_linear')) return THREE.FloatType;
  if (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')) return THREE.HalfFloatType;
  return null;
}

export class WaterSim {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{sim:[number,number], simHz:number}} tier
   */
  constructor(renderer, tier) {
    this.renderer = renderer;
    const type = simTextureType(renderer);
    this.enabled = type !== null;
    const [w, h] = tier.sim;
    this.size = new THREE.Vector2(w, h);
    this.hz = tier.simHz;
    this.maxSteps = Math.max(2, Math.round(tier.simHz / 30));
    this.accumulator = 0;
    this.pendingDrops = [];
    this.boxes = null;
    const d = SIM_DOMAIN;
    this.domain = new THREE.Vector4(d.minX, d.minZ, d.maxX - d.minX, d.maxZ - d.minZ);
    const texelWorld = new THREE.Vector2(this.domain.z / w, this.domain.w / h);
    const dx = Math.min(texelWorld.x, texelWorld.y);
    const coef = Math.min(0.5, ((RIPPLE_SPEED / this.hz) / dx) ** 2);
    const delta = new THREE.Vector2(1 / w, 1 / h);

    if (!this.enabled) return;

    const options = {
      type,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.targetA = new THREE.WebGLRenderTarget(w, h, options);
    this.targetB = new THREE.WebGLRenderTarget(w, h, options);

    const mat = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader, uniforms: { tInput: { value: null }, ...uniforms },
        depthTest: false, depthWrite: false });
    this.stepMaterial = mat(stepFrag, {
      delta: { value: delta },
      uCoef: { value: coef },
      uDamping: { value: Math.exp(-RIPPLE_DAMPING / this.hz) },
      uSponge: { value: Math.max(4, w / 16) },
    });
    this.dropMaterial = mat(dropFrag, {
      uDomain: { value: this.domain },
      uCenter: { value: new THREE.Vector2() },
      uRadius: { value: 0.3 },
      uStrength: { value: 0 },
    });
    this.normalMaterial = mat(normalFrag, { delta: { value: delta }, uTexelWorld: { value: texelWorld } });
    this.boxMaterial = mat(boxFrag, {
      uDomain: { value: this.domain },
      uOld: { value: Array.from({ length: 10 }, () => new THREE.Vector3()) },
      uNew: { value: Array.from({ length: 10 }, () => new THREE.Vector3()) },
      uHalf: { value: Array.from({ length: 10 }, () => new THREE.Vector3(1, 0.2, 0.3)) },
      uCount: { value: 0 },
      uScale: { value: 0.35 },
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.stepMaterial);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.clear();
  }

  get texture() {
    return this.enabled ? this.targetA.texture : null;
  }

  clear() {
    if (!this.enabled) return;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevColor = new THREE.Color();
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of [this.targetA, this.targetB]) {
      r.setRenderTarget(t);
      r.clear();
    }
    r.setRenderTarget(prev);
    r.setClearColor(prevColor, prevAlpha);
  }

  #pass(material) {
    material.uniforms.tInput.value = this.targetA.texture;
    this.quad.material = material;
    this.renderer.setRenderTarget(this.targetB);
    this.renderer.render(this.scene, this.camera);
    [this.targetA, this.targetB] = [this.targetB, this.targetA];
  }

  /** Queue an impulse at world (x, z). Positive strength raises the water. */
  addDrop(x, z, radius, strength) {
    if (!this.enabled) return;
    const d = this.domain;
    if (x < d.x - radius || x > d.x + d.z + radius || z < d.y - radius || z > d.y + d.w + radius) return;
    this.pendingDrops.push([x, z, radius, strength]);
  }

  /**
   * Hull displacement for this frame: arrays of {old, now, half} (Vector3) for visible ships only.
   * Hidden enemy ships must never be passed here (they would show up as ripples).
   */
  setBoxes(boxes) {
    this.boxes = boxes;
  }

  /** Advance by game-time dt with a fixed timestep. Returns true if the texture changed. */
  update(dt) {
    if (!this.enabled) return false;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    let changed = false;
    for (const [x, z, radius, strength] of this.pendingDrops) {
      const u = this.dropMaterial.uniforms;
      u.uCenter.value.set(x, z);
      u.uRadius.value = radius;
      u.uStrength.value = strength;
      this.#pass(this.dropMaterial);
      changed = true;
    }
    this.pendingDrops.length = 0;

    if (this.boxes?.length && dt > 0) {
      const u = this.boxMaterial.uniforms;
      const n = Math.min(10, this.boxes.length);
      for (let i = 0; i < n; i++) {
        u.uOld.value[i].copy(this.boxes[i].old);
        u.uNew.value[i].copy(this.boxes[i].now);
        u.uHalf.value[i].copy(this.boxes[i].half);
      }
      u.uCount.value = n;
      this.#pass(this.boxMaterial);
      changed = true;
    }

    this.accumulator = Math.min(this.accumulator + dt, this.maxSteps / this.hz);
    let steps = 0;
    while (this.accumulator >= 1 / this.hz && steps < this.maxSteps) {
      this.#pass(this.stepMaterial);
      this.accumulator -= 1 / this.hz;
      steps++;
    }
    if (steps || changed) {
      this.#pass(this.normalMaterial);
      changed = true;
    }
    r.setRenderTarget(prev);
    return changed;
  }

  dispose() {
    if (!this.enabled) return;
    for (const t of [this.targetA, this.targetB]) t.dispose();
    for (const m of [this.stepMaterial, this.dropMaterial, this.normalMaterial, this.boxMaterial]) m.dispose();
    this.quad.geometry.dispose();
  }
}
