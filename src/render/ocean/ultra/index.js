// Ultra "real water" tier (lazy chunk): most of threejs-water's pipeline adapted to open sea.
// Per frame: sim (shared) -> caustics -> refraction + reflection object passes -> surface shader.
import * as THREE from 'three';
import { SKY_GLSL } from '../../sky.js';
import overlaysGlsl from '../shaders/overlays.glsl?raw';
import seaVert from '../shaders/sea.vert.glsl?raw';
import { SWELL_GLSL } from '../swell.js';
import { CausticsPass, SEABED_Y } from './caustics.js';
import { ObjectPasses } from './objectPasses.js';
import surfaceFrag from './shaders/surface.frag.glsl?raw';
import { createSkyCube } from './skyCube.js';

const MAX_BOXES = 12;

export class UltraWater {
  /** @param {import('../../renderer.js').Renderer} r */
  constructor(r, sim) {
    this.r = r;
    this.sim = sim;
    const ou = r.ocean.uniforms;
    this.boxUniforms = {
      uBoxMin: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Vector3()) },
      uBoxMax: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Vector3()) },
      uBoxCount: { value: 0 },
    };
    this.clip = { value: 0 };
    this.caustics = new CausticsPass(r.renderer, ou);
    this.passes = new ObjectPasses(r.renderer, this.clip);
    this.skyCube = createSkyCube(r.renderer, r.shared);
    const uniforms = {
      ...ou,
      ...this.boxUniforms,
      uCaustics: { value: this.caustics.texture },
      uReflection: { value: this.passes.reflection.texture },
      uRefraction: { value: this.passes.refraction.texture },
      uSkyCube: { value: this.skyCube.texture },
      uViewProj: { value: this.passes.viewProj },
      uReflectionVP: { value: this.passes.reflectionVP },
      uSeabedY: { value: SEABED_Y },
    };
    this.surfaceMaterial = new THREE.ShaderMaterial({
      uniforms,
      defines: { SIM_GEOMETRY: '' },
      vertexShader: SWELL_GLSL + seaVert,
      fragmentShader: SKY_GLSL + SWELL_GLSL + overlaysGlsl + surfaceFrag,
    });
    /** Extra uniforms for ship materials: caustics on submerged parts + the pass clip switch. */
    this.shipUniforms = {
      uCaustics: { value: this.caustics.texture },
      uCausticsDomain: ou.uSimDomain,
      uClip: this.clip,
    };
    this.compileObjects = [new THREE.Mesh(this.caustics.mesh.geometry, this.caustics.material)];
  }

  setSize(width, height) {
    this.passes.setSize(width, height);
  }

  beforeRender() {
    // Visible hulls and wrecks only (FleetView never includes hidden enemy ships).
    const boxes = this.r.visibleBoxes ?? [];
    const n = Math.min(MAX_BOXES, boxes.length);
    for (let i = 0; i < n; i++) {
      this.boxUniforms.uBoxMin.value[i].copy(boxes[i].min);
      this.boxUniforms.uBoxMax.value[i].copy(boxes[i].max);
    }
    this.boxUniforms.uBoxCount.value = n;
    this.caustics.update();
    this.passes.update(this.r.scene, this.r.camera);
  }

  dispose() {
    this.caustics.dispose();
    this.passes.dispose();
    this.skyCube.dispose();
    this.surfaceMaterial.dispose();
  }
}
