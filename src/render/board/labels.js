// Board labels from a canvas-generated atlas, merged into one mesh (one draw call).
import * as THREE from 'three';
import { BOARD_CENTER_X, ROWS } from '../../config.js';

const GLYPHS = [...ROWS, ...Array.from({ length: 10 }, (_, i) => String(i + 1))];
export const TITLES = ['YOUR FLEET', 'ENEMY WATERS'];

function draw(ctx, text, x, y, size, maxWidth) {
  ctx.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = 'rgba(4,22,36,0.75)';
  ctx.strokeText(text, x, y, maxWidth);
  ctx.fillStyle = '#f4f9fc';
  ctx.fillText(text, x, y, maxWidth);
}

function drawTitles(ctx, titles) {
  ctx.clearRect(0, 128, 1024, 64);
  titles.forEach((t, i) => draw(ctx, t, i * 512 + 256, 160 + 4, 46, 496));
}

function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  GLYPHS.forEach((g, i) => draw(ctx, g, (i % 16) * 64 + 32, Math.floor(i / 16) * 64 + 34, 44));
  drawTitles(ctx, TITLES);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createLabels() {
  const positions = [];
  const uvs = [];
  const indices = [];
  // Flat quad on the water plane: centre (x, z), size (w, d), atlas rect in px.
  const quad = (x, z, w, d, u0, v0, u1, v1) => {
    const base = positions.length / 3;
    const y = 0.34;
    positions.push(x - w / 2, y, z - d / 2, x + w / 2, y, z - d / 2, x - w / 2, y, z + d / 2, x + w / 2, y, z + d / 2);
    uvs.push(u0 / 1024, 1 - v0 / 256, u1 / 1024, 1 - v0 / 256, u0 / 1024, 1 - v1 / 256, u1 / 1024, 1 - v1 / 256);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  const glyph = (i, x, z, s) => {
    const u = (i % 16) * 64;
    const v = Math.floor(i / 16) * 64;
    quad(x, z, s, s, u, v, u + 64, v + 64);
  };
  for (const [side, title] of [['player', 0], ['enemy', 1]]) {
    const cx = BOARD_CENTER_X[side];
    for (let r = 0; r < 10; r++) glyph(r, cx - 5.5, -4.5 + r, 0.62);
    for (let c = 0; c < 10; c++) glyph(10 + c, cx - 4.5 + c, -5.5, 0.62);
    quad(cx, -6.45, 6.4, 0.8, title * 512, 128, title * 512 + 512, 192);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ map: buildAtlas(), transparent: true, depthWrite: false, opacity: 0,
    toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 5;
  return mesh;
}

/** Other words over the two boards: whose fleet each is, for somebody watching two others play. */
export function setTitles(labels, titles = TITLES) {
  const tex = labels.material.map;
  drawTitles(tex.image.getContext('2d'), titles.map((t) => t.toUpperCase()));
  tex.needsUpdate = true;
}
