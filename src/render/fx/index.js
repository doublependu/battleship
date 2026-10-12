// Battle effects: muzzle flash, shells, splashes, explosions, persistent fires, sinking sequences, oil slicks.
// Loaded as a deferred chunk right after the first frame (plan §7).
import * as THREE from 'three';
import { ParticlePool } from './particles.js';
import { createPuffTexture } from './textures.js';

const tmp = new THREE.Vector3();

export class Effects {
  constructor(renderer, ripples) {
    this.r = renderer;
    this.ripples = ripples;
    this.map = createPuffTexture();
    this.pools = null;
    this.rate = 1;
    this.fires = new Set();
    this.events = [];
    this.shells = [];
    this.slicks = [];
    this.flashLevel = 0;
    this.group = new THREE.Group();
    renderer.scene.add(this.group);
    this.shellGeo = new THREE.SphereGeometry(0.075, 8, 6);
    this.shellGeo.scale(1.8, 1, 1);
    this.shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.3) });
    renderer.tierClients.push(this);
    if (renderer.tier) this.prepareTier(renderer.tier).apply();
  }

  get now() {
    return this.r.shared.uTime.value;
  }

  prepareTier(tier) {
    const timeUniform = this.r.shared.uTime;
    const add = new ParticlePool(tier.particles, { additive: true, map: this.map, timeUniform });
    const alpha = new ParticlePool(tier.particles, { additive: false, map: this.map, timeUniform });
    return {
      objects: [add.mesh, alpha.mesh],
      apply: () => {
        if (this.pools) for (const p of Object.values(this.pools)) {
          this.group.remove(p.mesh);
          p.dispose();
        }
        this.pools = { add, alpha };
        this.group.add(add.mesh, alpha.mesh);
        this.rate = tier.particles / 2048;
      },
    };
  }

  #rand(a, b) {
    return a + Math.random() * (b - a);
  }

  #randDir(out, spread = 1, upBias = 0) {
    out.set(this.#rand(-1, 1), this.#rand(-1, 1) * spread + upBias, this.#rand(-1, 1));
    return out.normalize();
  }

  /** Splash/explosion impulse in the GPU sim + the CPU ripple model (ships rock on it). */
  waterImpulse(x, z, radius, strength) {
    this.r.sim?.addDrop(x, z, radius, strength);
    this.ripples.add(x, z, radius, strength, this.now);
  }

  muzzle(pos, dir) {
    const t = this.now;
    for (let i = 0; i < 7; i++) {
      this.pools.add.spawn({ pos, vel: tmp.copy(dir).multiplyScalar(this.#rand(2, 4)).addScaledVector(this.#randDir(new THREE.Vector3()), 0.6),
        time: t, life: this.#rand(0.12, 0.22), drag: 6, size0: 0.35, size1: 0.8, c0: [4, 2.6, 1.2, 1], c1: [1.6, 0.5, 0.1, 0] });
    }
    for (let i = 0; i < 6; i++) {
      this.pools.alpha.spawn({ pos, vel: tmp.copy(dir).multiplyScalar(this.#rand(0.8, 1.8)).add(new THREE.Vector3(0, 0.5, 0)),
        time: t, life: this.#rand(1.2, 1.8), drag: 2.2, size0: 0.25, size1: 1.1, spin: 0.4,
        c0: [0.55, 0.55, 0.56, 0.55], c1: [0.7, 0.7, 0.72, 0] });
    }
  }

  /** Shell on a ballistic arc. Resolves at impact. */
  shell(from, to, duration, { incoming = false } = {}) {
    const mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
    mesh.layers.enable(2);
    mesh.position.copy(from);
    this.group.add(mesh);
    const dist = from.distanceTo(to);
    const apex = Math.max(from.y, to.y) + dist * (incoming ? 0.12 : 0.2) + 1.2;
    return new Promise((resolve) => {
      this.shells.push({ mesh, from: from.clone(), to: to.clone(), apex, t0: this.now, duration, resolve, last: from.clone() });
    });
  }

  splash(pos) {
    const t = this.now;
    const n = Math.max(10, Math.round(28 * Math.sqrt(this.rate)));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = this.#rand(0.2, 0.9);
      this.pools.alpha.spawn({ pos: tmp.set(pos.x + Math.cos(a) * 0.08, pos.y, pos.z + Math.sin(a) * 0.08),
        vel: new THREE.Vector3(Math.cos(a) * r, this.#rand(3.5, 7), Math.sin(a) * r), time: t, life: this.#rand(0.9, 1.4),
        drag: 0.7, gravity: 1, size0: this.#rand(0.18, 0.3), size1: this.#rand(0.5, 0.8),
        c0: [0.92, 0.96, 1, 0.9], c1: [0.85, 0.92, 0.97, 0] });
    }
    for (let i = 0; i < 6; i++) {
      this.pools.alpha.spawn({ pos, vel: this.#randDir(new THREE.Vector3(), 0.3, 1.2).multiplyScalar(1.2), time: t,
        life: this.#rand(1.4, 2), drag: 1.5, gravity: 0.05, size0: 0.5, size1: 1.8, c0: [0.9, 0.95, 1, 0.35], c1: [0.9, 0.95, 1, 0] });
    }
    this.waterImpulse(pos.x, pos.z, 0.45, -0.22);
  }

  explosion(pos, scale = 1, { water = true } = {}) {
    const t = this.now;
    const k = Math.sqrt(this.rate);
    for (let i = 0; i < Math.round(16 * k + 4); i++) {
      this.pools.add.spawn({ pos, vel: this.#randDir(new THREE.Vector3(), 1, 0.6).multiplyScalar(this.#rand(0.8, 2) * scale),
        time: t, life: this.#rand(0.5, 0.9), drag: 2.6, gravity: -0.05, size0: 0.5 * scale, size1: this.#rand(1.4, 2.2) * scale,
        spin: this.#rand(-2, 2), c0: [5, 2.8, 1, 1], c1: [1.2, 0.22, 0.04, 0] });
    }
    for (let i = 0; i < Math.round(26 * k + 4); i++) {
      this.pools.add.spawn({ pos, vel: this.#randDir(new THREE.Vector3(), 1, 0.8).multiplyScalar(this.#rand(3, 8) * scale),
        time: t, life: this.#rand(0.5, 1.1), drag: 0.7, gravity: 0.9, size0: 0.07, size1: 0.03,
        c0: [4, 2.5, 1.2, 1], c1: [2, 0.5, 0.1, 0] });
    }
    for (let i = 0; i < Math.round(10 * k + 2); i++) {
      this.pools.alpha.spawn({ pos, vel: this.#randDir(new THREE.Vector3(), 1, 1.2).multiplyScalar(this.#rand(2, 5) * scale),
        time: t, life: this.#rand(1, 1.6), drag: 0.4, gravity: 1, size0: 0.09, size1: 0.07, spin: 6,
        c0: [0.07, 0.06, 0.05, 1], c1: [0.07, 0.06, 0.05, 0.8] });
    }
    for (let i = 0; i < Math.round(10 * k + 3); i++) {
      this.pools.alpha.spawn({ pos: tmp.copy(pos).addScaledVector(this.#randDir(new THREE.Vector3()), 0.2 * scale),
        vel: new THREE.Vector3(this.#rand(-0.4, 0.4), this.#rand(0.8, 1.6), this.#rand(-0.4, 0.4)).multiplyScalar(scale),
        time: t + 0.05, life: this.#rand(2.5, 3.6), drag: 1.1, size0: 0.5 * scale, size1: this.#rand(1.8, 2.6) * scale,
        spin: this.#rand(-0.5, 0.5), c0: [0.2, 0.18, 0.17, 0.8], c1: [0.36, 0.36, 0.38, 0] });
    }
    this.flashLevel = Math.max(this.flashLevel, 45 * scale);
    this.r.flash.position.set(pos.x, pos.y + 0.8, pos.z);
    if (water) this.waterImpulse(pos.x, pos.z, 0.6 * scale, -0.3 * scale);
  }

  /**
   * Persistent fire + smoke. getPos(out) writes the current world position (follows a bobbing ship).
   * @returns {{stop: (fade?:number) => void}}
   */
  addFire(getPos, strength = 1, side = 'enemy') {
    const fire = { getPos, strength, side, acc: 0, smokeAcc: 0, stopAt: Infinity, fade: 1.5, pos: new THREE.Vector3() };
    this.fires.add(fire);
    return {
      stop: (fade = 1.5) => {
        fire.stopAt = Math.min(fire.stopAt, this.now);
        fire.fade = fade;
      },
    };
  }

  /** Burning fires per side (drives the crackle loops). */
  fireCounts() {
    let player = 0;
    let enemy = 0;
    for (const f of this.fires) {
      if (f.smokeOnly || f.stopAt !== Infinity) continue;
      if (f.side === 'player') player++;
      else enemy++;
    }
    return { player, enemy };
  }

  /** Smoke-only column (sinking ships). */
  addSmokeColumn(getPos, duration) {
    const fire = { getPos, strength: 1.8, acc: 0, smokeAcc: 0, stopAt: this.now + duration, fade: 2, pos: new THREE.Vector3(), smokeOnly: true };
    this.fires.add(fire);
  }

  #updateFire(f, dt, t) {
    const fade = f.stopAt === Infinity ? 1 : 1 - (t - f.stopAt) / f.fade;
    if (fade <= 0) {
      this.fires.delete(f);
      return;
    }
    f.getPos(f.pos);
    const s = f.strength * fade;
    if (!f.smokeOnly) {
      f.acc += dt * 22 * this.rate * s;
      while (f.acc >= 1) {
        f.acc--;
        this.pools.add.spawn({ pos: tmp.set(f.pos.x + this.#rand(-0.14, 0.14), f.pos.y, f.pos.z + this.#rand(-0.14, 0.14)),
          vel: new THREE.Vector3(this.#rand(-0.15, 0.15), this.#rand(0.9, 1.6), this.#rand(-0.15, 0.15)), time: t,
          life: this.#rand(0.5, 0.9), drag: 1.2, size0: this.#rand(0.34, 0.48), size1: 0.1, spin: this.#rand(-1, 1),
          c0: [3.4, 1.7, 0.45, 0.95], c1: [1.2, 0.18, 0.03, 0] });
      }
    }
    f.smokeAcc += dt * (f.smokeOnly ? 14 : 7) * Math.max(0.35, this.rate) * s;
    while (f.smokeAcc >= 1) {
      f.smokeAcc--;
      const big = f.smokeOnly ? 1.6 : 1;
      this.pools.alpha.spawn({ pos: tmp.set(f.pos.x + this.#rand(-0.1, 0.1), f.pos.y + 0.25, f.pos.z + this.#rand(-0.1, 0.1)),
        vel: new THREE.Vector3(0.28 + this.#rand(-0.1, 0.1), this.#rand(0.9, 1.4) * big, -0.12 + this.#rand(-0.1, 0.1)),
        time: t, life: this.#rand(2.6, 3.6), drag: 0.55, size0: 0.32 * big, size1: this.#rand(1.6, 2.2) * big,
        spin: this.#rand(-0.4, 0.4), c0: [0.1, 0.09, 0.085, 0.62], c1: [0.32, 0.32, 0.34, 0] });
    }
  }

  /** Bubbles + foam boiling up where a ship goes down. */
  bubbles(x, z, spread) {
    const t = this.now;
    for (let i = 0; i < 4; i++) {
      this.pools.alpha.spawn({ pos: tmp.set(x + this.#rand(-spread, spread), 0.02, z + this.#rand(-spread, spread)),
        vel: new THREE.Vector3(0, this.#rand(0.4, 1.2), 0), time: t, life: this.#rand(0.4, 0.8), drag: 2, gravity: 0.3,
        size0: 0.1, size1: 0.3, c0: [0.85, 0.93, 0.97, 0.75], c1: [0.85, 0.93, 0.97, 0] });
    }
  }

  /**
   * Sinking: secondary explosions along the hull, bubbles + foam, a smoke column, then an oil slick.
   * @returns {number} duration in seconds
   */
  sink(view, ultra) {
    const t0 = this.now;
    view.show(true);
    view.startSinking(t0, ultra);
    const L = view.model.length;
    const local = new THREE.Vector3();
    const at = (dt, fn) => this.events.push({ at: t0 + dt, fn });
    [0.1, 0.45, 0.8, 1.2, 1.8].forEach((d, i) => at(d, () => {
      local.set(this.#rand(-L / 2, L / 2) * 0.85, 0.25, 0);
      this.explosion(view.localToWorld(local, new THREE.Vector3()), i === 3 && view.model.breaks ? 1.25 : 0.75, { water: true });
    }));
    for (let d = 0.8; d < 4.6; d += 0.2) {
      at(d, () => {
        const c = view.center;
        const along = this.#rand(-L / 2, L / 2) * 0.8;
        const x = c.x + (view.horizontal ? along : 0);
        const z = c.z + (view.horizontal ? 0 : along);
        this.bubbles(x, z, 0.25);
        if (Math.random() < 0.5) this.waterImpulse(x, z, 0.35, -0.1);
      });
    }
    this.addSmokeColumn((out) => out.copy(view.center).setY(Math.max(0.1, view.group.position.y + 0.3)), 4.8);
    const slick = { x: view.center.x, z: view.center.z, radius: L * 0.55 + 0.5, strength: 0, t0: t0 + 1.2 };
    this.slicks.push(slick);
    if (this.slicks.length > 10) this.slicks.shift();
    return 4.8;
  }

  reset() {
    this.fires.clear();
    this.events = [];
    for (const s of this.shells) this.group.remove(s.mesh);
    this.shells = [];
    this.slicks = [];
    this.r.ocean.setSlicks([]);
    this.flashLevel = 0;
  }

  update(dt, time) {
    if (!this.pools) return;
    if (this.events.length) {
      const due = this.events.filter((e) => e.at <= time);
      if (due.length) {
        this.events = this.events.filter((e) => e.at > time);
        for (const e of due) e.fn();
      }
    }
    for (const s of [...this.shells]) {
      const p = Math.min(1, (time - s.t0) / s.duration);
      s.mesh.position.lerpVectors(s.from, s.to, p);
      s.mesh.position.y += 4 * (s.apex - (s.from.y + s.to.y) / 2) * p * (1 - p);
      tmp.subVectors(s.mesh.position, s.last);
      if (tmp.lengthSq() > 1e-6) s.mesh.lookAt(tmp.add(s.mesh.position));
      s.mesh.rotateY(-Math.PI / 2);
      if (dt > 0) {
        this.pools.add.spawn({ pos: s.mesh.position, vel: new THREE.Vector3(0, 0.1, 0), time, life: 0.32, drag: 2,
          size0: 0.16, size1: 0.03, c0: [3, 1.8, 0.7, 0.9], c1: [1, 0.3, 0.05, 0] });
        this.pools.alpha.spawn({ pos: s.last, vel: new THREE.Vector3(0, 0.15, 0), time, life: 0.9, drag: 1,
          size0: 0.08, size1: 0.35, c0: [0.75, 0.75, 0.78, 0.3], c1: [0.8, 0.8, 0.82, 0] });
      }
      s.last.copy(s.mesh.position);
      if (p >= 1) {
        this.group.remove(s.mesh);
        this.shells.splice(this.shells.indexOf(s), 1);
        s.resolve();
      }
    }
    if (dt > 0) for (const f of [...this.fires]) this.#updateFire(f, dt, time);
    this.flashLevel *= Math.exp(-dt * 11);
    this.r.flash.intensity = this.flashLevel < 0.05 ? 0 : this.flashLevel;
    if (this.slicks.length) {
      for (const s of this.slicks) s.strength = Math.min(0.9, Math.max(0, (time - s.t0) / 3));
      this.r.ocean.setSlicks(this.slicks);
    }
    this.pools.add.flush();
    this.pools.alpha.flush();
  }
}
