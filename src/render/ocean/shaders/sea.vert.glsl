// Sea surface vertex shader: analytic swell (+ sim height on Ultra), faded far away where the grid is coarse.
uniform float uTime;
#ifdef SIM_GEOMETRY
uniform sampler2D uSim;
uniform vec4 uSimDomain;
#endif
varying vec3 vWorld;

void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float far = 1.0 - smoothstep(45.0, 140.0, length(wp.xz));
  wp.y += swellHeight(wp.xz, uTime) * far;
#ifdef SIM_GEOMETRY
  vec2 uv = (wp.xz - uSimDomain.xy) / uSimDomain.zw;
  if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
    vec2 e = min(uv, 1.0 - uv);
    wp.y += textureLod(uSim, uv, 0.0).r * smoothstep(0.0, 0.06, min(e.x, e.y));
  }
#endif
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
