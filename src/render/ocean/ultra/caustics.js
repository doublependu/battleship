// Caustics target, adapted from threejs-water CausticsPass.ts (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su).
// Renders a refracted-light grid over the sim domain into a seabed-space intensity texture each frame.
import * as THREE from 'three';
import { SWELL_GLSL } from '../swell.js';
import frag from './shaders/caustics.frag.glsl?raw';
import vert from './shaders/caustics.vert.glsl?raw';

export const SEABED_Y = -3;

export class CausticsPass {
  constructor(renderer, oceanUniforms) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(512, 256, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: `uniform vec3 uSunDir;\n${SWELL_GLSL}${vert}`,
      fragmentShader: frag,
      uniforms: {
        uTime: oceanUniforms.uTime,
        uWaveA: oceanUniforms.uWaveA,
        uWaveB: oceanUniforms.uWaveB,
        uSunDir: oceanUniforms.uSunDir,
        uSim: oceanUniforms.uSim,
        uSimDomain: oceanUniforms.uSimDomain,
        uSimOn: oceanUniforms.uSimOn,
        uSeabedY: { value: SEABED_Y },
        uDetail: oceanUniforms.uDetail,
        uHulls: oceanUniforms.uHulls,
        uHullSink: oceanUniforms.uHullSink,
        uHullCount: oceanUniforms.uHullCount,
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 256, 128), this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  get texture() {
    return this.target.texture;
  }

  update() {
    const r = this.renderer;
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, this.camera);
    r.setClearColor(prevColor, prevAlpha);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
