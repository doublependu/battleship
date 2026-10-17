// Camera framing: one rule for every screen size and aspect ratio (plan §5.1).
// fit-both if both boards fit with cells >= MIN_CELL_PX, otherwise focus on one board and pan between them.
import * as THREE from 'three';
import { BOARD_CENTER_X } from '../config.js';

const MIN_CELL_PX = 30;
const PITCH = THREE.MathUtils.degToRad(57);
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const boardBox = (side) => {
  const cx = BOARD_CENTER_X[side];
  return { minX: cx - 5.9, maxX: cx + 5.25, minZ: -7.0, maxZ: 5.25, maxY: 0.9 };
};
const BOXES = {
  player: boardBox('player'),
  enemy: boardBox('enemy'),
  both: { minX: BOARD_CENTER_X.player - 5.9, maxX: BOARD_CENTER_X.enemy + 5.25, minZ: -7.0, maxZ: 5.25, maxY: 0.9 },
};

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.width = 1;
    this.height = 1;
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };
    this.view = 'title';
    this.layout = 'both';
    this.cur = { target: new THREE.Vector3(0, 0, -2), dist: 30, pitch: 0.25, yaw: 0 };
    this.goal = { target: new THREE.Vector3(0, 0, -2), dist: 30, pitch: 0.25, yaw: 0 };
    this.fits = {};
    this.shakeAmp = 0;
    this.shakeOffset = new THREE.Vector3();
    this.tmp = new THREE.PerspectiveCamera(camera.fov, 1, 0.1, 2000);
    this.v = new THREE.Vector3();
  }

  setViewport(width, height, insets = this.insets) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.insets = insets;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.tmp.aspect = this.camera.aspect;
    this.tmp.updateProjectionMatrix();
    this.fits.both = this.#fit(BOXES.both);
    this.fits.player = this.#fit(BOXES.player);
    this.fits.enemy = this.#fit(BOXES.enemy);
    // Focus mode only helps if it actually makes cells bigger (on short landscape phones it doesn't).
    const both = this.#cellPx(this.fits.both);
    const single = this.#cellPx(this.fits.player);
    this.layout = both >= MIN_CELL_PX || both >= single * 0.82 ? 'both' : 'focus';
    this.show(this.view, true);
  }

  /** view: 'title' | 'player' | 'enemy' | 'both'. In fit-both layout, 'player'/'enemy' frame both boards. */
  show(view, immediate = false) {
    this.view = view;
    if (view === 'title') {
      const aspect = this.width / this.height;
      this.goal.target.set(0, 0, aspect < 1 ? -4 : -3);
      this.goal.dist = aspect < 1 ? 46 : 30;
      this.goal.pitch = THREE.MathUtils.degToRad(aspect < 1 ? 20 : 15);
    } else {
      const key = this.layout === 'both' ? 'both' : view === 'both' ? 'enemy' : view;
      const f = this.fits[key];
      this.goal.target.copy(f.target);
      this.goal.dist = f.dist;
      this.goal.pitch = PITCH;
    }
    this.goal.yaw = 0;
    if (immediate || reducedMotion) {
      this.cur.target.copy(this.goal.target);
      this.cur.dist = this.goal.dist;
      this.cur.pitch = this.goal.pitch;
      this.cur.yaw = this.goal.yaw;
      // Now, not at the next frame: `settled` is already true, and whatever projects through the camera before that
      // frame (a click's cell, the e2e player's cellToClient) must see where it is.
      this.#place(this.camera, this.cur.target, this.cur.dist, this.cur.pitch, this.cur.yaw);
    }
  }

  /** Which board a focus-mode camera is showing, or 'both'. */
  get focused() {
    return this.layout === 'both' || this.view === 'title' ? 'both' : this.view === 'both' ? 'enemy' : this.view;
  }

  /** True once the camera has reached its framing (used by the e2e player before it clicks). */
  get settled() {
    return this.cur.target.distanceTo(this.goal.target) < 0.02 && Math.abs(this.cur.dist - this.goal.dist) < 0.02 &&
      Math.abs(this.cur.pitch - this.goal.pitch) < 0.002;
  }

  shake(strength) {
    if (!reducedMotion) this.shakeAmp = Math.max(this.shakeAmp, strength);
  }

  update(dt, time) {
    const k = 1 - Math.exp(-dt * 5.5);
    this.cur.target.lerp(this.goal.target, k);
    this.cur.dist += (this.goal.dist - this.cur.dist) * k;
    this.cur.pitch += (this.goal.pitch - this.cur.pitch) * k;
    let yaw = this.goal.yaw;
    if (this.view === 'title' && !reducedMotion) yaw = Math.sin(time * 0.05) * 0.14;
    this.cur.yaw += (yaw - this.cur.yaw) * k;
    this.#place(this.camera, this.cur.target, this.cur.dist, this.cur.pitch, this.cur.yaw);
    if (this.shakeAmp > 0.001) {
      this.shakeOffset.set(Math.sin(time * 61), Math.sin(time * 47 + 1), Math.sin(time * 53 + 2)).multiplyScalar(this.shakeAmp);
      this.camera.position.add(this.shakeOffset);
      this.shakeAmp *= Math.exp(-dt * 7);
    }
  }

  #place(cam, target, dist, pitch, yaw) {
    cam.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(dist)
      .add(target);
    cam.lookAt(target);
    cam.updateMatrixWorld();
  }

  /** Smallest on-screen cell width (CSS px) for a fit: the far row is the smallest. */
  #cellPx(fit) {
    this.#place(this.tmp, fit.target, fit.dist, PITCH, 0);
    const a = this.v.set(BOARD_CENTER_X.player - 5, 0, -5).project(this.tmp).x;
    const b = this.v.set(BOARD_CENTER_X.player - 4, 0, -5).project(this.tmp).x;
    return Math.abs(b - a) * 0.5 * this.width;
  }

  #ndcBounds(box, target, dist) {
    this.#place(this.tmp, target, dist, PITCH, 0);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const x of [box.minX, box.maxX]) for (const y of [0, box.maxY]) for (const z of [box.minZ, box.maxZ]) {
      this.v.set(x, y, z).project(this.tmp);
      x0 = Math.min(x0, this.v.x);
      x1 = Math.max(x1, this.v.x);
      y0 = Math.min(y0, this.v.y);
      y1 = Math.max(y1, this.v.y);
    }
    return { x0, x1, y0, y1 };
  }

  #fit(box) {
    const { top, bottom, left, right } = this.insets;
    const sx0 = -1 + (2 * left) / this.width;
    const sx1 = 1 - (2 * right) / this.width;
    const sy0 = -1 + (2 * bottom) / this.height;
    const sy1 = 1 - (2 * top) / this.height;
    const target = new THREE.Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2);
    let dist = 30;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    for (let iter = 0; iter < 8; iter++) {
      const b = this.#ndcBounds(box, target, dist);
      const scale = Math.max((b.x1 - b.x0) / (sx1 - sx0), (b.y1 - b.y0) / (sy1 - sy0));
      dist = THREE.MathUtils.clamp(dist * scale * 1.02, 4, 400);
      const c = this.#ndcBounds(box, target, dist);
      const halfH = dist * Math.tan(halfFov);
      // Content right of the safe centre -> move the camera right; content too high -> move it forward.
      target.x += ((c.x0 + c.x1) / 2 - (sx0 + sx1) / 2) * halfH * this.camera.aspect;
      target.z -= (((c.y0 + c.y1) / 2 - (sy0 + sy1) / 2) * halfH) / Math.sin(PITCH);
    }
    return { target, dist };
  }
}
