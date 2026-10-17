import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FLEET } from '../../src/config.js';
import { Board } from '../../src/game/board.js';
import { cellCenter } from '../../src/render/board/boardView.js';
import { ShipView } from '../../src/render/ships/shipView.js';

/** Where a ship view draws the k-th cell of its ship, on calm water. */
function drawnAt(view, k) {
  view.update(0, 0, null);
  view.group.updateMatrixWorld(true);
  return view.localToWorld(new THREE.Vector3(view.cellLocalX(k), 0, 0));
}

describe('ship view', () => {
  // A hit is drawn on the hull at cellLocalX(k): the scorch, the fire, the pitch. It has to be over the cell that was hit.
  for (const side of ['player', 'enemy']) {
    for (const horizontal of [true, false]) {
      it(`draws each cell of a ${horizontal ? 'horizontal' : 'vertical'} ship over that cell (${side})`, () => {
        for (const def of FLEET) {
          const ship = new Board().addShip(def, 2, 3, horizontal);
          const view = new ShipView(side, ship, { standard: false });
          view.show(true);
          for (let k = 0; k < ship.length; k++) {
            const at = drawnAt(view, k);
            const cell = cellCenter(side, Math.floor(ship.cells[k] / 10), ship.cells[k] % 10);
            expect([def.type, k, at.x, at.z].map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)))
              .toEqual([def.type, k, cell.x, cell.z]);
          }
        }
      });
    }
  }
});

describe('sunk ships and the graphics tier', () => {
  const sunkOn = (ultra) => {
    const view = new ShipView('enemy', new Board().addShip(FLEET[1], 2, 3, true), { standard: false });
    view.show(true);
    view.startSinking(0, ultra);
    for (let t = 0; t <= 6; t += 0.1) view.update(0.1, t, null);
    return view;
  };
  const wreckY = (view) => -3 + view.model.draft + 0.25;

  it('a ship sunk on High is gone; on Ultra it lies on the seabed', () => {
    const high = sunkOn(false);
    expect([high.sunk, high.group.visible]).toEqual([true, false]);
    const ultra = sunkOn(true);
    expect([ultra.sunk, ultra.group.visible]).toEqual([true, true]);
    expect(ultra.group.position.y).toBeCloseTo(wreckY(ultra), 5);
  });

  it('switching tier shows or hides the wrecks: what is on screen now decides, not the tier it sank on', () => {
    const view = sunkOn(true);
    view.settle(false);
    view.update(0.1, 7, null);
    expect(view.group.visible).toBe(false);
    view.settle(true);
    view.update(0.1, 7.1, null);
    expect(view.group.visible).toBe(true);
    expect(view.group.position.y).toBeCloseTo(wreckY(view), 5);
  });

  it('a sinking under way ends the new tier\'s way', () => {
    const view = new ShipView('player', new Board().addShip(FLEET[0], 0, 0, false), { standard: false });
    view.startSinking(0, true);
    for (let t = 0; t <= 2; t += 0.1) view.update(0.1, t, null);
    view.settle(false);
    for (let t = 2; t <= 6; t += 0.1) view.update(0.1, t, null);
    expect([view.sunk, view.group.visible]).toEqual([true, false]);
  });

  it('a ship that sank before this page drew it takes the wreck pose on Ultra, and stays hidden elsewhere', () => {
    const view = new ShipView('enemy', new Board().addShip(FLEET[0], 4, 4, true), { standard: false });
    view.settle(true);
    view.update(0.1, 0, null);
    expect([view.sunk, view.revealed, view.group.visible]).toEqual([true, true, true]);
    expect(view.group.position.y).toBeCloseTo(wreckY(view), 5);
    expect(Math.abs(view.group.rotation.x)).toBeCloseTo(0.47, 5);
    const other = new ShipView('enemy', new Board().addShip(FLEET[2], 6, 0, true), { standard: false });
    other.settle(false);
    expect([other.sunk, other.group.visible]).toEqual([true, false]);
  });
});
