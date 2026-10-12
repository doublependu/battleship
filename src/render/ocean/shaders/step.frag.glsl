// Wave-equation step, adapted from threejs-water WaveSimulation.frag
// (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su). See THIRD_PARTY_NOTICES.md.
// Changes: coefficient from a fixed world wave speed, time-based damping, and an absorbing sponge layer
// instead of reflective pool walls, so ripples never bounce off the domain edge.
precision highp float;
uniform sampler2D tInput;
uniform vec2 delta;       // 1 / texture size
uniform float uCoef;      // (c * dt / dx)^2, <= 0.5 for stability
uniform float uDamping;   // velocity damping per step
uniform float uSponge;    // sponge width in texels
varying vec2 coord;

void main() {
  vec4 info = texture2D(tInput, coord);
  vec2 dx = vec2(delta.x, 0.0);
  vec2 dz = vec2(0.0, delta.y);
  float laplacian = texture2D(tInput, coord + dx).r + texture2D(tInput, coord - dx).r
                  + texture2D(tInput, coord + dz).r + texture2D(tInput, coord - dz).r - 4.0 * info.r;
  info.g += uCoef * laplacian;

  vec2 edgeTexels = min(coord, 1.0 - coord) / delta;
  float s = clamp(min(edgeTexels.x, edgeTexels.y) / uSponge, 0.0, 1.0);
  info.g *= uDamping * mix(0.82, 1.0, s * s);
  info.r += info.g;
  info.r *= mix(0.9, 1.0, s);
  gl_FragColor = info;
}
