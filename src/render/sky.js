// Procedural sky: gradient + sun + soft clouds. Shared by the sky dome, water reflections and fog, so they
// always agree. No textures are downloaded.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.42, 0.55, -0.72).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.94, 0.84);

export function skyUniforms() {
  return {
    uSunDir: { value: SUN_DIR },
    uZenith: { value: new THREE.Color(0x2f6fb1) },
    uHorizon: { value: new THREE.Color(0xc8dbe6) },
    uSunColor: { value: SUN_COLOR },
  };
}

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;

float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), f.x), mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1, 1)), f.x), f.y);
}

vec3 horizonColor() { return uHorizon; }

// clouds: 0 = none, 1 = full. Pass false for cheap lookups.
vec3 skyColor(vec3 dir, bool clouds, float t) {
  float y = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(y, 0.5));
  float s = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(s, 6.0) * 0.18 + pow(s, 48.0) * 0.35);
  if (clouds && dir.y > 0.02) {
    vec2 uv = dir.xz / (dir.y + 0.12) * 1.6 + vec2(t * 0.006, t * 0.002);
    float n = skyNoise(uv) * 0.55 + skyNoise(uv * 2.3) * 0.3 + skyNoise(uv * 5.1) * 0.15;
    float c = smoothstep(0.52, 0.8, n) * smoothstep(0.02, 0.25, dir.y);
    col = mix(col, vec3(1.0, 0.99, 0.97) * (0.85 + 0.25 * s), c * 0.75);
  }
  col += uSunColor * smoothstep(0.99955, 0.9998, s) * 6.0;
  return col;
}
`;

/** Large sky dome drawn behind everything. */
export function createSkyDome(sharedUniforms) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...sharedUniforms },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir), true, uTime), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), material);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (r, s, camera) => mesh.position.copy(camera.position);
  return mesh;
}
