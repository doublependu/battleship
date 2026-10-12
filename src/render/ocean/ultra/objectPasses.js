// Object passes, adapted from threejs-water ObjectTexturePass.ts
// (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su). See THIRD_PARTY_NOTICES.md.
// Refraction: visible ships (and wrecks) below the waterline, from the main camera.
// Reflection: visible ships above the waterline plus fire/smoke particles, from a camera mirrored in y = 0.
// Both at half resolution (longest side capped at 1024, as upstream). Ships are on layer 1, particles on 2.
import * as THREE from 'three';

export const LAYER_SHIPS = 1;
export const LAYER_FX = 2;

export class ObjectPasses {
  constructor(renderer, clipUniform) {
    this.renderer = renderer;
    this.clip = clipUniform;
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false };
    this.refraction = new THREE.WebGLRenderTarget(16, 16, opts);
    this.reflection = new THREE.WebGLRenderTarget(16, 16, opts);
    this.refractionCam = new THREE.PerspectiveCamera();
    this.mirrorCam = new THREE.PerspectiveCamera();
    this.viewProj = new THREE.Matrix4();
    this.reflectionVP = new THREE.Matrix4();
    this.v = new THREE.Vector3();
    this.t = new THREE.Vector3();
  }

  setSize(width, height) {
    const scale = Math.min(0.5, 1024 / Math.max(width, height));
    const w = Math.max(1, Math.floor(width * scale));
    const h = Math.max(1, Math.floor(height * scale));
    this.refraction.setSize(w, h);
    this.reflection.setSize(w, h);
  }

  update(scene, camera) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);

    // refraction: main camera, ships only, keep y < 0
    const rc = this.refractionCam;
    rc.copy(camera);
    rc.layers.set(LAYER_SHIPS);
    this.clip.value = -1;
    r.setRenderTarget(this.refraction);
    r.clear();
    r.render(scene, rc);
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    // reflection: camera mirrored in the water plane, ships + effects, keep y > 0
    const mc = this.mirrorCam;
    mc.copy(camera);
    mc.position.set(camera.position.x, -camera.position.y, camera.position.z);
    camera.getWorldDirection(this.v);
    this.t.copy(camera.position).add(this.v);
    this.t.y = -this.t.y;
    mc.up.set(0, -1, 0);
    mc.lookAt(this.t);
    mc.updateMatrixWorld();
    mc.layers.set(LAYER_SHIPS);
    mc.layers.enable(LAYER_FX);
    this.clip.value = 1;
    r.setRenderTarget(this.reflection);
    r.clear();
    r.render(scene, mc);
    this.reflectionVP.multiplyMatrices(mc.projectionMatrix, mc.matrixWorldInverse);

    this.clip.value = 0;
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
  }

  dispose() {
    this.refraction.dispose();
    this.reflection.dispose();
  }
}
