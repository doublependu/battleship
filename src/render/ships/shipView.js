// Ship presentation: bobbing (swell + sim ripples + hit kicks), damage scorch, reveal, sinking/breaking.
import * as THREE from 'three';
import { BOARD_CENTER_X } from '../../config.js';
import { swellHeight } from '../ocean/swell.js';
import { buildShip } from './models.js';

const LAYER_SHIPS = 1; // also rendered by the Ultra refraction/reflection passes

const SEABED_Y = -3;

const SHIP_VERT_PRE = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vWorldPos;
`;
const SHIP_FRAG_PRE = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vWorldPos;
uniform float uHitX[5];
uniform int uHitCount;
uniform float uReveal;
uniform float uBurn;
uniform vec3 uWaterTint;
uniform float uClip;
#ifdef CAUSTICS
uniform sampler2D uCaustics;
uniform vec4 uCausticsDomain;
#endif
float shipHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
`;

/** Ship material: lit, vertex coloured, with scorch / reveal / underwater tint injected. */
export function createShipMaterial(tier, extra = {}) {
  const standard = tier.standard;
  const material = standard
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.18, flatShading: true })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const uniforms = {
    uHitX: { value: [0, 0, 0, 0, 0] },
    uHitCount: { value: 0 },
    uReveal: { value: 1 },
    uBurn: { value: 0 },
    uWaterTint: { value: new THREE.Color(0x0b4a5e) },
    uClip: { value: 0 },
    ...extra,
  };
  material.userData.uniforms = uniforms;
  // Ultra handles underwater colour in the water shader (absorption along the refracted path).
  if (tier.seeThrough && !tier.ultra) material.defines = { ...material.defines, UNDERWATER_TINT: '' };
  if (extra.uCaustics) material.defines = { ...material.defines, CAUSTICS: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = SHIP_VERT_PRE + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = position;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = SHIP_FRAG_PRE + shader.fragmentShader
      .replace('void main() {', `void main() {
        if (uReveal < 0.999 && shipHash(floor(vLocalPos * 16.0)) > uReveal) discard;
        if (uClip != 0.0 && vWorldPos.y * uClip < -0.02) discard; // Ultra object passes: keep one side of the water`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float scorch = 0.0;
        for (int i = 0; i < 5; i++) {
          if (i >= uHitCount) break;
          float d = abs(vLocalPos.x - uHitX[i]);
          scorch += (1.0 - smoothstep(0.12, 0.55, d)) * (0.55 + 0.45 * shipHash(floor(vLocalPos * 22.0)));
        }
        diffuseColor.rgb *= 1.0 - 0.78 * clamp(scorch, 0.0, 1.0);
        diffuseColor.rgb *= 1.0 - 0.55 * uBurn;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        #ifdef CAUSTICS
        if (vWorldPos.y < 0.0) {
          vec2 cuv = (vWorldPos.xz - uCausticsDomain.xy) / uCausticsDomain.zw;
          float c = texture2D(uCaustics, cuv).r;
          gl_FragColor.rgb *= 0.75 + c * 0.6 * smoothstep(0.0, -0.3, vWorldPos.y);
        }
        #endif
        #ifdef UNDERWATER_TINT
        float uw = clamp(-vWorldPos.y / 0.7, 0.0, 1.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uWaterTint * 0.55, uw * 0.8);
        #endif`);
  };
  material.customProgramCacheKey = () => `ship-${standard}-${!!tier.seeThrough && !tier.ultra}-${!!extra.uCaustics}`;
  return material;
}

/** Critically damped spring towards a target (per axis). */
function spring(state, target, omega, dt) {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const x = (f * state.x + dt * state.v + hhoo * target) * det;
  state.v = (state.v + hoo * (target - state.x)) * det;
  state.x = x;
}

export class ShipView {
  constructor(side, ship, tier) {
    this.side = side;
    this.type = ship.type;
    this.length = ship.length;
    this.model = buildShip(ship.type);
    this.group = new THREE.Group();
    this.meshes = this.model.halves.map((g) => {
      const mesh = new THREE.Mesh(g, null);
      mesh.layers.enable(LAYER_SHIPS);
      this.group.add(mesh);
      return mesh;
    });
    this.setTierMaterial(createShipMaterial(tier));
    this.hits = [];
    this.heave = { x: 0, v: 0 };
    this.pitch = { x: 0, v: 0 };
    this.roll = { x: 0, v: 0 };
    this.sinking = null;
    this.sunk = false;
    this.revealed = side === 'player';
    this.reveal = this.revealed ? 1 : 0;
    this.group.visible = this.revealed;
    this.lift = 0;
    this.center = new THREE.Vector3();
    this.horizontal = true;
    this.setPlacement(ship);
    this.v = new THREE.Vector3();
  }

  get uniforms() {
    return this.material.userData.uniforms;
  }

  setTierMaterial(material) {
    const prev = this.material;
    this.material = material;
    if (prev) {
      const u = material.userData.uniforms;
      const p = prev.userData.uniforms;
      for (const k of ['uHitX', 'uHitCount', 'uReveal', 'uBurn']) u[k].value = p[k].value;
      prev.dispose();
    }
    for (const m of this.meshes) m.material = material;
  }

  /** Board position (cells) -> world transform. Horizontal ships point their bow to +x, vertical ones to -z. */
  setPlacement(ship) {
    this.horizontal = ship.horizontal;
    const off = (ship.length - 1) / 2;
    const cx = BOARD_CENTER_X[this.side] - 4.5 + ship.c + (ship.horizontal ? off : 0);
    const cz = -4.5 + ship.r + (ship.horizontal ? 0 : off);
    this.center.set(cx, 0, cz);
    this.group.position.set(cx, this.group.position.y, cz);
    this.yaw = ship.horizontal ? 0 : Math.PI / 2;
  }

  /**
   * Local x (along the hull) of the k-th cell of the ship. Cells count from the top-left cell: the stern of a
   * horizontal ship, whose bow points to +x, but the bow of a vertical one, whose bow points to -z (towards row 0).
   */
  cellLocalX(k) {
    const half = (this.length - 1) / 2;
    return this.horizontal ? k - half : half - k;
  }

  addHit(k, kick = true) {
    this.hits.push(this.cellLocalX(k));
    const u = this.uniforms;
    u.uHitX.value = [...this.hits, 0, 0, 0, 0, 0].slice(0, 5);
    u.uHitCount.value = Math.min(5, this.hits.length);
    if (!kick) return;
    // kick: roll away from the impact, pitch towards it
    this.roll.v += (Math.random() < 0.5 ? -1 : 1) * 0.5;
    this.pitch.v += -Math.sign(this.cellLocalX(k) || 0.1) * 0.25;
    this.heave.v -= 0.25;
  }

  /** Enemy ship revealed when sunk: dissolve in. */
  show(instant = false) {
    this.revealed = true;
    this.group.visible = true;
    if (instant) this.reveal = 1;
  }

  /** Start the sinking sequence. ultra: settle on the seabed as a wreck instead of disappearing. */
  startSinking(time, ultra, rng = Math.random) {
    this.sinking = {
      t0: time,
      duration: 4.8,
      afloat: 0.9, // burns and lists before it starts to go under
      bowFirst: rng() < 0.5,
      listDir: rng() < 0.5 ? -1 : 1,
      ultra,
      breakAt: this.model.breaks ? 0.8 : Infinity,
    };
  }

  get sinkProgress() {
    return this.sunk ? 1 : this.sinking ? this.sinking.p ?? 0 : 0;
  }

  /** World position of a ship-local point (for effects attached to the ship). */
  localToWorld(local, out = new THREE.Vector3()) {
    return this.group.localToWorld(out.copy(local));
  }

  #waterHeight(x, z, time, ripples) {
    return swellHeight(x, z, time) + (ripples ? ripples.height(x, z, time) : 0);
  }

  update(dt, time, ripples) {
    if (this.reveal < 1 && this.revealed) this.reveal = Math.min(1, this.reveal + dt * 1.4);
    this.uniforms.uReveal.value = this.reveal;
    if (!this.group.visible) return;
    const c = this.center;
    const hx = this.horizontal ? 1 : 0;
    const hz = this.horizontal ? 0 : -1;
    const half = this.model.length * 0.4;
    const beam = this.model.beam * 0.5;
    const hb = this.#waterHeight(c.x + hx * half, c.z + hz * half, time, ripples);
    const hs = this.#waterHeight(c.x - hx * half, c.z - hz * half, time, ripples);
    const hp = this.#waterHeight(c.x - hz * beam, c.z + hx * beam, time, ripples);
    const hst = this.#waterHeight(c.x + hz * beam, c.z - hx * beam, time, ripples);
    const targetHeave = THREE.MathUtils.clamp((hb + hs + hp + hst) / 4, -0.16, 0.16);
    const targetPitch = THREE.MathUtils.clamp(Math.atan2(hb - hs, half * 2), -0.07, 0.07);
    // Positive roll about local x lowers the +z side, so raise whichever side the water is higher on.
    const targetRoll = THREE.MathUtils.clamp(Math.atan2(hst - hp, beam * 2) * 0.5, -0.1, 0.1);
    const step = Math.min(dt, 1 / 30);
    let n = dt > 0 ? Math.ceil(dt / step) : 0;
    while (n-- > 0) {
      spring(this.heave, targetHeave, 3.2, step);
      spring(this.pitch, targetPitch, 2.6, step);
      spring(this.roll, targetRoll, 2.2, step);
    }
    let y = this.heave.x + this.lift;
    let pitch = this.pitch.x;
    let roll = this.roll.x;

    const s = this.sinking;
    if (s) {
      const t = Math.max(0, time - s.t0);
      const p = Math.min(1, t / s.duration);
      s.p = p;
      const ease = p * p * (3 - 2 * p);
      const list = Math.min(1, t / 1.4);
      roll += s.listDir * (0.22 * list + 0.25 * ease);
      const dir = s.bowFirst ? -1 : 1;
      const floor = s.ultra ? SEABED_Y + this.model.draft + 0.25 : SEABED_Y - 1;
      y += (floor - y) * Math.max(0, (t - s.afloat) / (s.duration - s.afloat)) ** 1.5;
      pitch += dir * 0.32 * Math.sin(Math.min(1, ease * 1.3) * Math.PI) * (s.ultra ? 0.8 : 1);
      if (this.meshes.length === 2) {
        const b = Math.min(1, Math.max(0, (t - s.breakAt) / 2.2));
        const bb = b * b * (3 - 2 * b);
        this.meshes[0].rotation.z = -0.38 * bb;
        this.meshes[1].rotation.z = 0.38 * bb;
        this.meshes[0].position.set(-0.12 * bb, -0.25 * bb, 0);
        this.meshes[1].position.set(0.12 * bb, -0.25 * bb, 0);
      }
      this.uniforms.uBurn.value = Math.min(1, t / 2);
      if (p >= 1) {
        this.sunk = true;
        this.sinking = null;
        if (!s.ultra) this.group.visible = false;
        this.restY = y;
        this.restPitch = pitch;
        this.restRoll = roll;
      }
    }
    if (this.sunk) {
      y = this.restY;
      pitch = this.restPitch;
      roll = this.restRoll;
    }
    this.group.position.y = y;
    this.group.rotation.set(roll, this.yaw, pitch, 'YZX');
  }

  /** Footprint for the water shader, or null if not on the surface. */
  footprint() {
    if (!this.group.visible || !this.revealed || this.sunk) return null;
    const hl = this.model.length / 2;
    const hb = this.model.beam / 2;
    return {
      x: this.center.x,
      z: this.center.z,
      hx: this.horizontal ? hl : hb,
      hz: this.horizontal ? hb : hl,
      sink: this.sinkProgress,
    };
  }

  /** World AABB for the Ultra ray tests (afloat, sinking or wreck), or null when hidden. */
  worldBox(out) {
    if (!this.group.visible || !this.revealed) return null;
    this.group.updateMatrixWorld();
    out.makeEmpty();
    for (const m of this.meshes) out.expandByObject(m);
    return out;
  }

  /** Box for the sim's volume displacement (centre y follows heave and sinking). */
  simBox() {
    if (!this.group.visible || !this.revealed || this.sunk) return null;
    const hl = this.model.length / 2;
    const hb = this.model.beam / 2;
    const fb = this.model.height * 0.35;
    return {
      now: new THREE.Vector3(this.center.x, this.group.position.y + (fb - this.model.draft) / 2, this.center.z),
      half: new THREE.Vector3(this.horizontal ? hl : hb, (fb + this.model.draft) / 2, this.horizontal ? hb : hl),
    };
  }
}
