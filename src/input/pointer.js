// Pointer Events for mouse, touch and pen. Picking intersects the camera ray with the flat plane y = 0
// (cheap and unaffected by waves). Mouse: hover + click to fire. Touch: first tap aims, second tap (or FIRE)
// fires. Placement: drag a ship to move it, tap it to rotate.
import * as THREE from 'three';
import { cellAt } from '../render/board/boardView.js';

const DRAG_PX = 8;

export class PointerInput {
  /** ctx: { canvas, camera, onHover(cell, touch), onTap(cell, touch), placement: {down, move, up, cancel} , enabled() } */
  constructor(ctx) {
    this.ctx = ctx;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hit = new THREE.Vector3();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.active = null;
    const c = ctx.canvas;
    c.addEventListener('pointerdown', (e) => this.#down(e));
    c.addEventListener('pointermove', (e) => this.#move(e));
    c.addEventListener('pointerup', (e) => this.#up(e));
    c.addEventListener('pointercancel', (e) => this.#cancel(e));
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.active) ctx.onHover(null, false);
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Client px -> world point on y = 0, or null. */
  worldAt(clientX, clientY) {
    const rect = this.ctx.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.ctx.camera);
    return this.ray.ray.intersectPlane(this.plane, this.hit);
  }

  cellAtClient(x, y) {
    const p = this.worldAt(x, y);
    return p ? cellAt(p.x, p.z) : null;
  }

  #down(e) {
    if (!this.ctx.enabled() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (this.active) return; // ignore extra fingers (pinch is blocked separately)
    const cell = this.cellAtClient(e.clientX, e.clientY);
    this.active = { id: e.pointerId, x: e.clientX, y: e.clientY, cell, dragging: false,
      touch: e.pointerType !== 'mouse', placing: this.ctx.placement.down(cell) };
    if (this.active.placing) this.ctx.canvas.setPointerCapture(e.pointerId);
  }

  #move(e) {
    const a = this.active;
    if (a && a.id === e.pointerId) {
      if (!a.dragging && Math.hypot(e.clientX - a.x, e.clientY - a.y) > DRAG_PX) a.dragging = true;
      if (a.placing && a.dragging) {
        const p = this.worldAt(e.clientX, e.clientY);
        if (p) this.ctx.placement.move(p);
      }
      return;
    }
    if (e.pointerType === 'mouse' && this.ctx.enabled()) this.ctx.onHover(this.cellAtClient(e.clientX, e.clientY), false);
  }

  #up(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    this.active = null;
    if (a.placing) {
      this.ctx.placement.up(a.dragging);
      return;
    }
    if (a.dragging) return;
    const cell = this.cellAtClient(e.clientX, e.clientY);
    if (cell) this.ctx.onTap(cell, a.touch);
  }

  #cancel(e) {
    if (this.active?.id !== e.pointerId) return;
    if (this.active.placing) this.ctx.placement.cancel();
    this.active = null;
  }
}
