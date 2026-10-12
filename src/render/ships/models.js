// Procedural ship models. Local space: bow at +x, waterline at y = 0, beam along z, centred on the ship.
// Carrier and Battleship are built as aft/fore halves (split at x = 0) so they can break in two.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, COLORS, cyl, hull, turret } from './parts.js';

function merge(parts) {
  for (const p of parts) if (p.attributes.normal) p.deleteAttribute('normal');
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

function mast(x, y, h, z = 0) {
  return [
    cyl(0.018, 0.026, h, x, y, z, COLORS.superDark, 'y', 5),
    box(0.04, 0.025, 0.34, x, y + h * 0.72, z, COLORS.superDark),
    box(0.07, 0.07, 0.07, x, y + h, z, COLORS.black),
  ];
}

function windows(x, y, w, d) {
  return [box(w, 0.035, d + 0.01, x, y, 0, COLORS.window)];
}

const BUILDERS = {
  carrier() {
    const L = 4.75;
    const spec = { length: L, beam: 0.62, freeboard: 0.26, draft: 0.26, bowLength: 0.85, transom: true };
    const parts = [];
    // flight deck with overhang, markings, island on starboard (+z when the bow points to +x), parked aircraft
    parts.push(box(4.85, 0.05, 0.98, 0.05, 0.3, -0.06, COLORS.flight));
    parts.push(box(4.4, 0.012, 0.03, 0.0, 0.35, -0.06, COLORS.marking));
    for (let i = 0; i < 7; i++) parts.push(box(0.16, 0.012, 0.025, -2.0 + i * 0.62, 0.351, -0.33, COLORS.marking));
    parts.push(box(0.75, 0.3, 0.16, 0.45, 0.35, 0.36, COLORS.super));
    parts.push(...windows(0.45, 0.58, 0.76, 0.16));
    parts.push(box(0.28, 0.16, 0.14, 0.3, 0.65, 0.36, COLORS.superDark));
    parts.push(...mast(0.62, 0.65, 0.42, 0.36));
    for (const [x, z] of [[-1.6, -0.25], [-1.1, -0.3], [-0.5, -0.28], [1.5, -0.2]]) {
      parts.push(box(0.28, 0.04, 0.05, x, 0.355, z, COLORS.superDark));
      parts.push(box(0.08, 0.025, 0.3, x + 0.02, 0.37, z, COLORS.superDark));
      parts.push(box(0.04, 0.06, 0.12, x - 0.12, 0.37, z, COLORS.superDark));
    }
    return { spec, parts, breaks: true };
  },
  battleship() {
    const L = 3.8;
    const spec = { length: L, beam: 0.6, freeboard: 0.2, draft: 0.24, bowLength: 1.0 };
    const parts = [];
    parts.push(...turret(1.05, 0.2, 0.34, 3, 1));
    parts.push(...turret(0.62, 0.3, 0.34, 3, 1));
    parts.push(box(0.3, 0.1, 0.34, 0.62, 0.2, 0, COLORS.superDark));
    parts.push(...turret(-1.15, 0.2, 0.34, 3, -1));
    parts.push(box(1.1, 0.16, 0.42, -0.05, 0.2, 0, COLORS.super));
    parts.push(box(0.55, 0.16, 0.34, 0.2, 0.36, 0, COLORS.super));
    parts.push(...windows(0.2, 0.46, 0.56, 0.34));
    parts.push(box(0.26, 0.16, 0.24, 0.25, 0.52, 0, COLORS.superDark));
    parts.push(cyl(0.085, 0.1, 0.32, -0.32, 0.36, 0, COLORS.superDark, 'y', 10));
    parts.push(box(0.2, 0.04, 0.2, -0.32, 0.68, 0, COLORS.black));
    parts.push(...mast(0.25, 0.68, 0.5));
    for (const z of [-0.16, 0.16]) parts.push(cyl(0.025, 0.03, 0.22, -0.6, 0.34, z, COLORS.black, 'x', 5));
    return { spec, parts, breaks: true };
  },
  cruiser() {
    const L = 2.8;
    const spec = { length: L, beam: 0.48, freeboard: 0.18, draft: 0.2, bowLength: 0.8 };
    const parts = [];
    parts.push(...turret(0.75, 0.18, 0.28, 2, 1));
    parts.push(...turret(-0.85, 0.18, 0.28, 2, -1));
    parts.push(box(0.8, 0.14, 0.34, 0.0, 0.18, 0, COLORS.super));
    parts.push(box(0.36, 0.14, 0.28, 0.2, 0.32, 0, COLORS.super));
    parts.push(...windows(0.2, 0.41, 0.37, 0.28));
    parts.push(cyl(0.07, 0.085, 0.26, -0.22, 0.32, 0, COLORS.superDark, 'y', 10));
    parts.push(box(0.16, 0.03, 0.16, -0.22, 0.58, 0, COLORS.black));
    parts.push(...mast(0.25, 0.46, 0.42));
    return { spec, parts, breaks: false };
  },
  submarine() {
    const L = 2.85;
    const parts = [];
    const body = new THREE.CapsuleGeometry(0.17, L - 0.34, 6, 12);
    body.rotateZ(Math.PI / 2);
    body.scale(1, 0.95, 1);
    body.translate(0, -0.06, 0);
    const pos = body.attributes.position;
    // taper the stern
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (x < -0.6) {
        const t = Math.min(1, (-0.6 - x) / (L / 2 - 0.6));
        pos.setY(i, (pos.getY(i) + 0.06) * (1 - t * 0.6) - 0.06);
        pos.setZ(i, pos.getZ(i) * (1 - t * 0.6));
      }
    }
    const hullGeo = body.toNonIndexed();
    const colors = new Float32Array(hullGeo.attributes.position.count * 3);
    for (let i = 0; i < hullGeo.attributes.position.count; i++) {
      const y = hullGeo.attributes.position.getY(i);
      (y > -0.02 ? COLORS.sub : COLORS.black).toArray(colors, i * 3);
    }
    hullGeo.deleteAttribute('uv');
    hullGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(hullGeo);
    parts.push(box(0.42, 0.26, 0.12, 0.45, 0.07, 0, COLORS.sub));
    parts.push(box(0.04, 0.02, 0.4, 0.5, 0.25, 0, COLORS.sub));
    parts.push(cyl(0.012, 0.012, 0.22, 0.38, 0.32, 0, COLORS.black, 'y', 4));
    parts.push(cyl(0.012, 0.012, 0.15, 0.55, 0.32, 0, COLORS.black, 'y', 4));
    parts.push(box(0.2, 0.2, 0.025, -1.3, -0.05, 0, COLORS.sub));
    parts.push(box(0.16, 0.02, 0.36, -1.3, -0.05, 0, COLORS.sub));
    return { spec: { length: L, beam: 0.34, freeboard: 0.11, draft: 0.23 }, parts, breaks: false, noHull: true };
  },
  destroyer() {
    const L = 1.82;
    const spec = { length: L, beam: 0.36, freeboard: 0.15, draft: 0.15, bowLength: 0.6 };
    const parts = [];
    parts.push(...turret(0.48, 0.15, 0.22, 1, 1));
    parts.push(box(0.5, 0.13, 0.26, -0.05, 0.15, 0, COLORS.super));
    parts.push(box(0.2, 0.1, 0.22, 0.1, 0.28, 0, COLORS.super));
    parts.push(...windows(0.1, 0.34, 0.21, 0.22));
    parts.push(cyl(0.05, 0.06, 0.2, -0.22, 0.28, 0, COLORS.superDark, 'y', 8));
    parts.push(...mast(0.12, 0.38, 0.32));
    parts.push(box(0.16, 0.08, 0.14, -0.62, 0.15, 0, COLORS.gun));
    return { spec, parts, breaks: false };
  },
};

const cache = new Map();

/**
 * @returns {{halves: THREE.BufferGeometry[], length:number, beam:number, draft:number, height:number, breaks:boolean}}
 * halves = [whole] or [aft, fore] for ships that break in two.
 */
export function buildShip(type) {
  if (cache.has(type)) return cache.get(type);
  const { spec, parts, breaks, noHull } = BUILDERS[type]();
  const centerX = (g) => {
    g.computeBoundingBox();
    return (g.boundingBox.min.x + g.boundingBox.max.x) / 2;
  };
  let halves;
  if (breaks) {
    const aft = parts.filter((p) => centerX(p) <= 0);
    const fore = parts.filter((p) => centerX(p) > 0);
    aft.push(hull({ ...spec, x1: 0 }));
    fore.push(hull({ ...spec, x0: 0 }));
    halves = [merge(aft), merge(fore)];
  } else {
    if (!noHull) parts.push(hull(spec));
    halves = [merge(parts)];
  }
  let height = 0;
  for (const h of halves) height = Math.max(height, h.boundingBox.max.y);
  const model = { halves, length: spec.length, beam: spec.beam, draft: spec.draft, height, breaks };
  cache.set(type, model);
  return model;
}
