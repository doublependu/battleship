// Procedural sky rendered once into a small cube target (replaces upstream's cubemap JPGs).
import * as THREE from 'three';
import { createSkyDome } from '../../sky.js';

export function createSkyCube(renderer, shared, size = 128) {
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter });
  const scene = new THREE.Scene();
  scene.add(createSkyDome(shared));
  const cam = new THREE.CubeCamera(1, 2000, target);
  cam.update(renderer, scene);
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return target;
}
