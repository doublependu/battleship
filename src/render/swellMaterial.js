// Inject the analytic swell into a built-in material so instanced props (buoys, debris) bob on the GPU.
import { SWELL_GLSL } from './ocean/swell.js';

/**
 * @param {import('three').Material} material
 * @param {object} uniforms must contain uTime + swell uniforms (shared with the ocean)
 * @param {number} follow 0..1 how much of the swell height to follow
 */
export function addSwell(material, uniforms, follow = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWaveA = uniforms.uWaveA;
    shader.uniforms.uWaveB = uniforms.uWaveB;
    shader.vertexShader = `uniform float uTime;\n${SWELL_GLSL}\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 swellXZ = instanceMatrix[3].xz;
      #else
        vec2 swellXZ = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
      #endif
      transformed.y += swellHeight(swellXZ, uTime) * ${follow.toFixed(2)};`,
    );
  };
  material.customProgramCacheKey = () => `swell${follow}`;
  return material;
}
