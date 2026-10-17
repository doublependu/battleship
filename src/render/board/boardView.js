// Board presentation: labels, floating hit/miss buoys, and the in-water overlays (cell states, aim, placement).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOARD_CENTER_X } from '../../config.js';
import { addSwell } from '../swellMaterial.js';
import { createLabels, setTitles } from './labels.js';

export const SIDE_INDEX = { player: 0, enemy: 1 };

export function cellCenter(side, r, c, out = new THREE.Vector3()) {
  return out.set(BOARD_CENTER_X[side] - 4.5 + c, 0, -4.5 + r);
}

/** World xz -> {side, r, c} or null. */
export function cellAt(x, z) {
  for (const side of ['player', 'enemy']) {
    const lx = x - BOARD_CENTER_X[side] + 5;
    const lz = z + 5;
    if (lx >= 0 && lx < 10 && lz >= 0 && lz < 10) return { side, r: Math.floor(lz), c: Math.floor(lx) };
  }
  return null;
}

function buoyGeometry() {
  const body = new THREE.CylinderGeometry(0.11, 0.15, 0.22, 10, 1);
  body.translate(0, 0.05, 0);
  const top = new THREE.ConeGeometry(0.1, 0.2, 10, 1);
  top.translate(0, 0.26, 0);
  const g = mergeGeometries([body.toNonIndexed(), top.toNonIndexed()]);
  g.computeVertexNormals();
  return g;
}

export class BoardView {
  constructor(renderer) {
    this.r = renderer;
    this.ocean = renderer.ocean;
    this.labels = createLabels();
    renderer.scene.add(this.labels);
    const geo = buoyGeometry();
    const make = (color) => {
      const mat = addSwell(new THREE.MeshLambertMaterial({ color }), this.ocean.uniforms, 1);
      const mesh = new THREE.InstancedMesh(geo, mat, 100);
      mesh.count = 0;
      mesh.frustumCulled = false;
      renderer.scene.add(mesh);
      return mesh;
    };
    this.missBuoys = make(0xf2f5f7);
    this.hitBuoys = make(0xd62f22);
    this.hitKeys = [];
    this.alpha = 0;
    this.alphaGoal = 0;
    this.m = new THREE.Matrix4();
    this.v = new THREE.Vector3();
  }

  reset() {
    this.ocean.clearCells();
    this.missBuoys.count = 0;
    this.hitBuoys.count = 0;
    this.hitKeys = [];
    this.setAim(null);
    this.setPlacement(null);
  }

  /** The words over the two boards; none: "your fleet" and "enemy waters". */
  setTitles(titles) {
    setTitles(this.labels, titles);
  }

  /** Show/hide the grid, labels and buoys (title screen hides them). */
  setVisible(on) {
    this.alphaGoal = on ? 1 : 0;
  }

  #addBuoy(mesh, side, r, c) {
    cellCenter(side, r, c, this.v);
    this.m.makeTranslation(this.v.x, 0, this.v.z);
    mesh.setMatrixAt(mesh.count++, this.m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Record a resolved shot. side = the board that was shot at. */
  markShot(side, r, c, result) {
    const state = result === 'miss' ? 1 : 2;
    this.ocean.setCell(SIDE_INDEX[side], r, c, state);
    if (result === 'miss') this.#addBuoy(this.missBuoys, side, r, c);
    else if (side === 'enemy') {
      this.hitKeys.push(`${r},${c}`);
      this.#addBuoy(this.hitBuoys, side, r, c);
    }
  }

  /** A ship was sunk: mark its cells and remove the red buoys (the revealed ship shows the damage). */
  markSunk(side, ship) {
    for (const i of ship.cells) this.ocean.setCell(SIDE_INDEX[side], Math.floor(i / 10), i % 10, 3);
    if (side !== 'enemy') return;
    const sunk = new Set(ship.cells.map((i) => `${Math.floor(i / 10)},${i % 10}`));
    const keep = this.hitKeys.filter((k) => !sunk.has(k));
    this.hitKeys = [];
    this.hitBuoys.count = 0;
    for (const k of keep) {
      const [r, c] = k.split(',').map(Number);
      this.hitKeys.push(k);
      this.#addBuoy(this.hitBuoys, 'enemy', r, c);
    }
  }

  setAim(cell, valid = true) {
    if (!cell) return this.ocean.setAim(0, 0, false, false);
    cellCenter(cell.side, cell.r, cell.c, this.v);
    this.ocean.setAim(this.v.x, this.v.z, true, valid);
  }

  /** Placement preview: ship footprint rect + validity. */
  setPlacement(ship, valid) {
    if (!ship) return this.ocean.setPlacement(null, 0);
    const a = cellCenter('player', ship.r, ship.c, new THREE.Vector3());
    const len = ship.length - 1;
    const b = cellCenter('player', ship.horizontal ? ship.r : ship.r + len, ship.horizontal ? ship.c + len : ship.c, this.v);
    this.ocean.setPlacement({ minX: Math.min(a.x, b.x) - 0.5, minZ: Math.min(a.z, b.z) - 0.5,
      maxX: Math.max(a.x, b.x) + 0.5, maxZ: Math.max(a.z, b.z) + 0.5 }, valid ? 1 : 2);
  }

  update(dt) {
    this.alpha += (this.alphaGoal - this.alpha) * (1 - Math.exp(-dt * 5));
    this.ocean.uniforms.uBoardAlpha.value = this.alpha;
    this.labels.material.opacity = this.alpha;
    this.labels.visible = this.alpha > 0.01;
    this.missBuoys.visible = this.hitBuoys.visible = this.alpha > 0.01;
  }
}
