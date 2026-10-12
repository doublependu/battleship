// Ocean mesh + sea material (Low/Medium/High). Ultra swaps in its own surface material (ultra/), sharing
// the same uniforms object so overlays, hulls and slicks stay in sync across tier switches.
import * as THREE from 'three';
import { SIM_DOMAIN } from '../../config.js';
import { SKY_GLSL } from '../sky.js';
import overlaysGlsl from './shaders/overlays.glsl?raw';
import seaFrag from './shaders/sea.frag.glsl?raw';
import seaVert from './shaders/sea.vert.glsl?raw';
import { SWELL_GLSL, swellUniforms } from './swell.js';

/** One grid, dense over the boards and growing smoothly (C1) towards the horizon. */
export function warpedGrid(nx, nz, innerX = 19, innerZ = 11, extent = 700, q = 0.62) {
  const axis = (n, inner) => {
    const half = n / 2;
    const s = inner / q;
    const b = (extent - inner - s * (1 - q)) / (1 - q) ** 3;
    const out = [];
    for (let i = -half; i <= half; i++) {
      const t = Math.abs(i) / half;
      const v = t < q ? s * t : inner + s * (t - q) + b * (t - q) ** 3;
      out.push(Math.sign(i) * v);
    }
    return out;
  };
  const xs = axis(nx, innerX);
  const zs = axis(nz, innerZ);
  const positions = new Float32Array(xs.length * zs.length * 3);
  let p = 0;
  for (const z of zs) for (const x of xs) {
    positions[p++] = x;
    positions[p++] = 0;
    positions[p++] = z;
  }
  const indices = [];
  const w = xs.length;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      indices.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), extent * 1.5);
  return geometry;
}

/** Tileable detail normal map (RG = normal x/z), generated at startup from integer-frequency waves. */
export function createDetailTexture(size = 128, waves = 18, seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const comps = [];
  for (let k = 0; k < waves; k++) {
    const m = Math.round((rand() * 2 - 1) * 6);
    const n = Math.round((rand() * 2 - 1) * 6) || 1;
    comps.push({ kx: (2 * Math.PI * m) / size, kz: (2 * Math.PI * n) / size, a: 1 / Math.hypot(m, n), ph: rand() * 6.28 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let gx = 0;
      let gz = 0;
      for (const c of comps) {
        const d = Math.cos(c.kx * x + c.kz * z + c.ph) * c.a;
        gx += d * c.kx * size * 0.05;
        gz += d * c.kz * size * 0.05;
      }
      const i = (z * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, 128 - gx * 40));
      data[i + 1] = Math.max(0, Math.min(255, 128 - gz * 40));
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export class Ocean {
  constructor(shared) {
    this.shared = shared; // sky + time uniforms shared with the sky dome
    this.cells = new Uint8Array(20 * 10 * 4);
    this.cellTexture = new THREE.DataTexture(this.cells, 20, 10, THREE.RGBAFormat);
    this.cellTexture.magFilter = this.cellTexture.minFilter = THREE.NearestFilter;
    this.cellTexture.needsUpdate = true;
    this.detail = createDetailTexture();
    const d = SIM_DOMAIN;
    this.uniforms = {
      ...shared,
      ...swellUniforms(),
      uDeep: { value: new THREE.Color(0x06324c) },
      uShallow: { value: new THREE.Color(0x1d8a99) },
      uFogDensity: { value: 0.0042 },
      uSim: { value: null },
      uSimDomain: { value: new THREE.Vector4(d.minX, d.minZ, d.maxX - d.minX, d.maxZ - d.minZ) },
      uSimOn: { value: 0 },
      uDetail: { value: this.detail },
      uBoardAlpha: { value: 0 },
      uCells: { value: this.cellTexture },
      uAim: { value: new THREE.Vector4() },
      uPlace: { value: new THREE.Vector4() },
      uPlaceState: { value: 0 },
      uHulls: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) },
      uHullSink: { value: new Array(10).fill(0) },
      uHullCount: { value: 0 },
      uSlicks: { value: Array.from({ length: 10 }, () => new THREE.Vector4()) },
      uSlickCount: { value: 0 },
    };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
  }

  /** (Re)build for a tier. Ultra provides its own material via `material`. */
  setTier(tier, sim, material = null) {
    const [nx, nz] = tier.grid;
    this.mesh.geometry.dispose();
    this.mesh.geometry = warpedGrid(nx, nz);
    this.uniforms.uSim.value = sim?.texture ?? null;
    this.uniforms.uSimOn.value = sim?.enabled ? 1 : 0;
    this.sim = sim;
    if (this.mesh.material !== material) this.mesh.material.dispose();
    this.mesh.material = material ?? this.createSeaMaterial(tier);
  }

  createSeaMaterial(tier) {
    const defines = {};
    if (tier.detail) defines.DETAIL = '';
    if (tier.seeThrough) defines.SEE_THROUGH = '';
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines,
      vertexShader: SWELL_GLSL + seaVert,
      fragmentShader: SKY_GLSL + SWELL_GLSL + overlaysGlsl + seaFrag,
      transparent: !!tier.seeThrough,
      depthWrite: true,
    });
  }

  /** Called each frame after the sim update (its ping-pong texture changes). */
  update() {
    if (this.sim?.enabled) this.uniforms.uSim.value = this.sim.texture;
  }

  /** State: 0 none, 1 miss, 2 hit, 3 sunk. side: 0 player board, 1 enemy board. */
  setCell(side, r, c, state) {
    this.cells[(r * 20 + c + side * 10) * 4] = state * 64;
    this.cellTexture.needsUpdate = true;
  }

  clearCells() {
    this.cells.fill(0);
    this.cellTexture.needsUpdate = true;
  }

  setAim(x, z, active, valid) {
    this.uniforms.uAim.value.set(x, z, active ? 1 : 0, valid ? 1 : 0);
  }

  setPlacement(rect, state) {
    if (rect) this.uniforms.uPlace.value.set(rect.minX, rect.minZ, rect.maxX, rect.maxZ);
    this.uniforms.uPlaceState.value = state;
  }

  /** Visible hulls only: [{x, z, hx, hz, sink}]. */
  setHulls(hulls) {
    const n = Math.min(10, hulls.length);
    for (let i = 0; i < n; i++) {
      const h = hulls[i];
      this.uniforms.uHulls.value[i].set(h.x, h.z, h.hx, h.hz);
      this.uniforms.uHullSink.value[i] = h.sink;
    }
    this.uniforms.uHullCount.value = n;
  }

  setSlicks(slicks) {
    const n = Math.min(10, slicks.length);
    for (let i = 0; i < n; i++) {
      const s = slicks[i];
      this.uniforms.uSlicks.value[i].set(s.x, s.z, s.radius, s.strength);
    }
    this.uniforms.uSlickCount.value = n;
  }
}
