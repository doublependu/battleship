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
