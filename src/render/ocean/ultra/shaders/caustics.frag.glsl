// Caustics intensity = flat-water area / refracted area, adapted from threejs-water Caustics.frag
// (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su). See THIRD_PARTY_NOTICES.md.
// Changes: additive accumulation, and analytic soft hull shadows (ray from the seabed point towards the light
// against the visible hull footprints, like upstream's analytic object shadows).
precision highp float;
#define MAX_HULLS 10
const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;
uniform vec3 uSunDir;
uniform vec4 uHulls[MAX_HULLS];     // visible hulls: centre x, z, half extents x, z
uniform float uHullSink[MAX_HULLS];
uniform int uHullCount;
varying vec3 oldPos;
varying vec3 newPos;

float sdBox2(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Soft hull shadows: follow the refracted light ray from the seabed point up to the waterline and test it
// against the hull footprints (rounded, blurred with depth like a real penumbra).
float shadowAt(vec3 p) {
  vec3 toLight = -refract(-uSunDir, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
  vec2 q = p.xz + toLight.xz * ((-0.15 - p.y) / toLight.y);
  float s = 1.0;
  for (int i = 0; i < MAX_HULLS; i++) {
    if (i >= uHullCount) break;
    float sd = sdBox2(q - uHulls[i].xy, uHulls[i].zw - 0.1) - 0.1;
    s *= 1.0 - 0.6 * (1.0 - smoothstep(-0.25, 0.35, sd)) * (1.0 - uHullSink[i]);
  }
  return s;
}

void main() {
  float oldArea = length(dFdx(oldPos)) * length(dFdy(oldPos));
  float newArea = length(dFdx(newPos)) * length(dFdy(newPos));
  float c = oldArea / max(newArea, 1e-6);
  gl_FragColor = vec4(min(c, 6.0) * 0.5 * shadowAt(newPos), 0.0, 0.0, 1.0);
}
