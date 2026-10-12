// Drop (splash/explosion impulse), adapted from threejs-water WaterRipple.frag
// (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su). See THIRD_PARTY_NOTICES.md. Works in world units.
precision highp float;
const float PI = 3.141592653589793;
uniform sampler2D tInput;
uniform vec4 uDomain;     // minX, minZ, sizeX, sizeZ
uniform vec2 uCenter;     // world xz
uniform float uRadius;    // world units
uniform float uStrength;
varying vec2 coord;

void main() {
  vec4 info = texture2D(tInput, coord);
  vec2 p = uDomain.xy + coord * uDomain.zw;
  float drop = max(0.0, 1.0 - length(p - uCenter) / uRadius);
  drop = 0.5 - cos(drop * PI) * 0.5;
  info.r += drop * uStrength;
  gl_FragColor = info;
}
