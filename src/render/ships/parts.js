// Low-poly ship primitives. Every part is non-indexed with a per-vertex colour, so a whole ship merges
// into one flat-shaded geometry (one draw call per ship, or per half for ships that break in two).
import * as THREE from 'three';

export const COLORS = {
  hull: new THREE.Color(0x8e9aa5),
  hullDark: new THREE.Color(0x5d6873),
  deck: new THREE.Color(0x6f7880),
  boot: new THREE.Color(0x1d1f22),
  red: new THREE.Color(0x8a2a22),
  super: new THREE.Color(0xa9b3bc),
  superDark: new THREE.Color(0x7d8892),
  gun: new THREE.Color(0x5a636c),
  black: new THREE.Color(0x24282c),
  flight: new THREE.Color(0x4a5158),
  marking: new THREE.Color(0xe6e2d3),
  sub: new THREE.Color(0x2c3238),
  window: new THREE.Color(0x1b2a36),
};

function colorize(geometry, color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export function box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return colorize(g, color);
}

/** Cylinder; axis 'y' (funnels, masts) or 'x' (barrels pointing along the ship). */
export function cyl(rTop, rBottom, h, x, y, z, color, axis = 'y', segments = 8) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1);
  if (axis === 'x') {
    g.rotateZ(-Math.PI / 2);
    g.translate(x + h / 2, y, z);
  } else g.translate(x, y + h / 2, z);
  return colorize(g, color);
}

/** Turret with n barrels pointing towards `dir` (+1 bow, -1 stern). */
export function turret(x, y, size, barrels, dir, color = COLORS.gun) {
  const parts = [box(size * 1.05, size * 0.38, size * 0.95, x, y, 0, color)];
  parts.push(box(size * 0.55, size * 0.12, size * 0.7, x - dir * size * 0.15, y + size * 0.38, 0, COLORS.superDark));
  const len = size * 1.25;
  for (let b = 0; b < barrels; b++) {
    const z = (b - (barrels - 1) / 2) * size * 0.26;
    const g = cyl(size * 0.055, size * 0.065, len, 0, y + size * 0.2, z, COLORS.black, 'x', 6);
    if (dir < 0) g.rotateY(Math.PI);
    g.translate(x + dir * size * 0.35, 0, 0);
    parts.push(g);
  }
  return parts;
}

/**
 * Lofted hull between x0..x1 of a hull spanning [-length/2, length/2] (bow at +x).
 * Faces are coloured by height: hull grey above, boot-topping at the waterline, anti-fouling red below.
 */
export function hull({ length, beam, freeboard, draft, bowLength = 0.9, transom = false, x0 = -Infinity, x1 = Infinity,
  topColor = COLORS.hull, deckColor = COLORS.deck, belowColor = COLORS.red }) {
  const half = length / 2;
  const a = Math.max(-half, x0);
  const b = Math.min(half, x1);
  const stations = [];
  const steps = Math.max(4, Math.round(((b - a) / length) * 22));
  for (let i = 0; i <= steps; i++) stations.push(a + ((b - a) * i) / steps);
  const width = (x) => {
    const tb = (x - (half - bowLength)) / bowLength;
    const sternLen = beam * (transom ? 0.35 : 0.8);
    const ts = (-half + sternLen - x) / sternLen;
    let w = 1;
    if (tb > 0) w = Math.max(0.02, 1 - tb ** 1.7);
    if (ts > 0) w = transom ? 1 - ts * 0.18 : Math.sqrt(Math.max(0.02, 1 - ts * ts));
    return w * beam * 0.5;
  };
  const sheer = (x) => freeboard + Math.max(0, (x - (half - bowLength * 1.4)) / (bowLength * 1.4)) * 0.07;
  // Cross-section from deck edge down to the keel (y, width factor).
  const profile = (x) => {
    const w = width(x);
    const tb = Math.max(0, (x - (half - bowLength)) / bowLength);
    const d = draft * (1 - tb * 0.55);
    return [[sheer(x), w], [0.03, w * 0.98], [-0.045, w * 0.96], [-d * 0.65, w * 0.8], [-d, w * 0.3], [-d, 0]];
  };
  const pos = [];
  const col = [];
  const tri = (p, q, r, c) => {
    pos.push(...p, ...q, ...r);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  };
  const colorFor = (y) => (y > 0.03 ? topColor : y > -0.045 ? COLORS.boot : belowColor);
  for (let s = 0; s < stations.length - 1; s++) {
    const xa = stations[s];
    const xb = stations[s + 1];
    const pa = profile(xa);
    const pb = profile(xb);
    for (const side of [1, -1]) {
      for (let k = 0; k < pa.length - 1; k++) {
        const A = [xa, pa[k][0], side * pa[k][1]];
        const B = [xb, pb[k][0], side * pb[k][1]];
        const C = [xa, pa[k + 1][0], side * pa[k + 1][1]];
        const D = [xb, pb[k + 1][0], side * pb[k + 1][1]];
        const c = colorFor((pa[k][0] + pa[k + 1][0]) / 2);
        if (side > 0) {
          tri(A, C, B, c);
          tri(B, C, D, c);
        } else {
          tri(A, B, C, c);
          tri(B, D, C, c);
        }
      }
    }
    // deck
    const ya = pa[0][0];
    const yb = pb[0][0];
    tri([xa, ya, -pa[0][1]], [xa, ya, pa[0][1]], [xb, yb, -pb[0][1]], deckColor);
    tri([xb, yb, -pb[0][1]], [xa, ya, pa[0][1]], [xb, yb, pb[0][1]], deckColor);
  }
  // end caps (stern transom / split faces)
  for (const [x, flip] of [[a, false], [b, true]]) {
    const p = profile(x);
    if (p[0][1] < 0.03) continue;
    for (let k = 0; k < p.length - 1; k++) {
      const c = colorFor((p[k][0] + p[k + 1][0]) / 2);
      const A = [x, p[k][0], p[k][1]];
      const B = [x, p[k][0], -p[k][1]];
      const C = [x, p[k + 1][0], p[k + 1][1]];
      const D = [x, p[k + 1][0], -p[k + 1][1]];
      if (flip) {
        tri(A, C, B, c);
        tri(B, C, D, c);
      } else {
        tri(A, B, C, c);
        tri(B, D, C, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
