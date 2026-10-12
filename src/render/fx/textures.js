// Procedural particle texture (soft noisy puff), generated at startup. No image downloads.
import * as THREE from 'three';

export function createPuffTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 9 }, () => [rand() * 0.6 + 0.2, rand() * 0.6 + 0.2, rand() * 0.18 + 0.12]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      let a = Math.max(0, 1 - r) ** 1.6;
      let lumps = 0;
      for (const [bx, by, br] of blobs) lumps += Math.max(0, 1 - Math.hypot(u - bx, v - by) / br);
      a *= 0.55 + 0.45 * Math.min(1, lumps);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
