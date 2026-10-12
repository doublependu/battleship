// Both fleets: builds ShipViews from the boards, feeds visible hulls to the water, switches materials per tier.
import * as THREE from 'three';
import { createShipMaterial, ShipView } from './shipView.js';

export class FleetView {
  constructor(renderer, ripples) {
    this.r = renderer;
    this.ripples = ripples;
    this.views = { player: [], enemy: [] };
    this.group = new THREE.Group();
    renderer.scene.add(this.group);
    this.tier = null;
    this.prevBoxes = new Map();
    this.ultraExtra = null;
    renderer.tierClients.push(this);
  }

  /** (Re)build one side's ships from its board. Enemy ships start hidden. */
  setFleet(side, board) {
    for (const v of this.views[side]) this.group.remove(v.group);
    for (const v of this.views[side]) v.material.dispose();
    this.views[side] = board.ships.map((ship) => {
      const v = new ShipView(side, ship, this.tier);
      if (this.ultraExtra) v.setTierMaterial(createShipMaterial(this.tier, this.ultraExtra));
      this.group.add(v.group);
      return v;
    });
    this.prevBoxes.clear();
  }

  view(side, index) {
    return this.views[side][index];
  }

  all() {
    return [...this.views.player, ...this.views.enemy];
  }

  prepareTier(tier, ultra) {
    const extra = ultra?.shipUniforms ?? null;
    const materials = this.all().map(() => createShipMaterial(tier, extra ?? {}));
    const sample = createShipMaterial(tier, extra ?? {});
    const objects = [new THREE.Mesh(this.all()[0]?.model.halves[0] ?? new THREE.BoxGeometry(), sample)];
    return {
      objects,
      apply: () => {
        this.tier = tier;
        this.ultraExtra = extra;
        this.all().forEach((v, i) => v.setTierMaterial(materials[i] ?? createShipMaterial(tier, extra ?? {})));
        sample.dispose();
      },
    };
  }

  update(dt, time) {
    const hulls = [];
    const boxes = [];
    for (const v of this.all()) {
      v.update(dt, time, this.ripples);
      // Only visible ships ever feed the water: hidden enemy ships would give their position away.
      const fp = v.footprint();
      if (fp) hulls.push(fp);
      if (this.tier?.seeThrough) {
        const b = v.simBox();
        if (b) {
          const prev = this.prevBoxes.get(v) ?? b.now.clone();
          boxes.push({ old: prev, now: b.now, half: b.half });
          this.prevBoxes.set(v, b.now.clone());
        } else this.prevBoxes.delete(v);
      }
    }
    this.r.ocean.setHulls(hulls);
    this.r.sim?.setBoxes(boxes);
    if (this.tier?.ultra) {
      this.boxPool ??= Array.from({ length: 12 }, () => new THREE.Box3());
      const list = [];
      for (const v of this.all()) {
        if (list.length >= 12) break;
        const b = v.worldBox(this.boxPool[list.length]);
        if (b && !b.isEmpty()) list.push(b);
      }
      this.r.visibleBoxes = list;
    }
    this.hullCount = hulls.length;
  }
}
