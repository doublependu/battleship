// Surface normals from the heightfield, adapted from threejs-water WaterNormal.frag
// (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su). See THIRD_PARTY_NOTICES.md.
// Stores the normal's x/z in BA, like upstream; uses central differences in world units.
precision highp float;
uniform sampler2D tInput;
uniform vec2 delta;
uniform vec2 uTexelWorld;   // world size of one texel (x, z)
varying vec2 coord;

void main() {
  vec4 info = texture2D(tInput, coord);
  float hx = texture2D(tInput, coord + vec2(delta.x, 0.0)).r - texture2D(tInput, coord - vec2(delta.x, 0.0)).r;
  float hz = texture2D(tInput, coord + vec2(0.0, delta.y)).r - texture2D(tInput, coord - vec2(0.0, delta.y)).r;
  vec3 n = normalize(vec3(-hx / (2.0 * uTexelWorld.x), 1.0, -hz / (2.0 * uTexelWorld.y)));
  info.ba = n.xz;
  gl_FragColor = info;
}
