// Caustics (differential-area method), adapted from threejs-water Caustics.vert
// (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su). See THIRD_PARTY_NOTICES.md.
// Changes: open sea instead of a pool. Each grid vertex refracts the sun through the swell + sim surface
// and lands on a flat seabed at uSeabedY; the target texture is in seabed world xz over the sim domain.
const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;
uniform float uTime;
uniform sampler2D uSim;
uniform vec4 uSimDomain;
uniform float uSimOn;
uniform float uSeabedY;
uniform sampler2D uDetail;
varying vec3 oldPos;
varying vec3 newPos;

vec3 toFloor(vec3 origin, vec3 ray) {
  return origin + ray * ((uSeabedY - origin.y) / ray.y);
}

void main() {
  vec2 xz = uSimDomain.xy + (position.xy * 0.5 + 0.5) * uSimDomain.zw;
  vec2 g = swellGrad(xz, uTime);
  vec3 n = vec3(-g.x, 1.0, -g.y);
  float h = swellHeight(xz, uTime);
  if (uSimOn > 0.5) {
    vec4 info = textureLod(uSim, position.xy * 0.5 + 0.5, 0.0);
    n += vec3(info.b, 0.0, info.a) * 0.8;
    h += info.r;
  }
  // the same fine detail waves the surface shows; they do most of the focusing at this depth
  // Rotated layers at different scales break up the texture's directionality into a cellular network.
  const mat2 R1 = mat2(0.5, -0.866, 0.866, 0.5);
  const mat2 R2 = mat2(-0.5, -0.866, 0.866, -0.5);
  vec2 d1 = textureLod(uDetail, xz * 0.21 + uTime * vec2(0.03, 0.017), 0.0).xy * 2.0 - 1.0;
  vec2 d2 = R1 * (textureLod(uDetail, R1 * xz * 0.27 + uTime * vec2(-0.02, 0.035), 0.0).xy * 2.0 - 1.0);
  vec2 d3 = R2 * (textureLod(uDetail, R2 * xz * 0.37 + uTime * vec2(0.025, -0.03), 0.0).xy * 2.0 - 1.0);
  vec2 d = d1 + d2 + d3 * 0.8;
  n += vec3(d.x, 0.0, d.y) * 0.075;
  n = normalize(n);
  vec3 flatLight = refract(-uSunDir, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
  vec3 ray = refract(-uSunDir, n, IOR_AIR / IOR_WATER);
  oldPos = toFloor(vec3(xz.x, 0.0, xz.y), flatLight);
  newPos = toFloor(vec3(xz.x, h, xz.y), ray);
  // Store in seabed coordinates so lookups use the seabed point's own xz.
  vec2 uv = (newPos.xz - uSimDomain.xy) / uSimDomain.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
