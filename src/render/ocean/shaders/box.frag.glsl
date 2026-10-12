// Ship volume displacement, adapted from threejs-water BoxDisplacement.frag (moveCube)
// (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su). See THIRD_PARTY_NOTICES.md.
// Changes: world units, all visible hulls in one pass, and the box's own half height.
precision highp float;
#define MAX_BOXES 10
uniform sampler2D tInput;
uniform vec4 uDomain;
uniform vec3 uOld[MAX_BOXES];
uniform vec3 uNew[MAX_BOXES];
uniform vec3 uHalf[MAX_BOXES];
uniform int uCount;
uniform float uScale;
varying vec2 coord;

float volumeInBox(vec3 point, vec3 center, vec3 halfSize) {
  vec3 d = abs(point - center) - vec3(halfSize.x, 0.0, halfSize.z);
  float sd = length(max(d.xz, 0.0)) + min(max(d.x, d.z), 0.0);
  float t = max(sd, 0.0) / max(halfSize.x, halfSize.z) * 4.0;
  float dy = halfSize.y * exp(-pow(t * 1.5, 6.0));
  float ymin = min(0.0, center.y - dy);
  float ymax = min(max(0.0, center.y + dy), ymin + 2.0 * dy);
  return ymax - ymin;
}

void main() {
  vec4 info = texture2D(tInput, coord);
  vec3 p = vec3(uDomain.x + coord.x * uDomain.z, 0.0, uDomain.y + coord.y * uDomain.w);
  for (int i = 0; i < MAX_BOXES; i++) {
    if (i >= uCount) break;
    info.r += (volumeInBox(p, uOld[i], uHalf[i]) - volumeInBox(p, uNew[i], uHalf[i])) * uScale;
  }
  gl_FragColor = info;
}
