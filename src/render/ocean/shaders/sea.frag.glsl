// Sea surface (Low / Medium / High): single pass. Swell + sim + detail normals, Fresnel (Schlick) blend of
// the procedural sky reflection and the water body colour, sun glitter, crest tint, foam, overlays, fog.
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uFogDensity;
uniform sampler2D uSim;
uniform vec4 uSimDomain;   // minX, minZ, sizeX, sizeZ
uniform float uSimOn;
#ifdef DETAIL
uniform sampler2D uDetail;
#endif
varying vec3 vWorld;

// Manual bilinear filtering: the sim targets use nearest filtering (upstream's iOS fix).
vec4 simSample(vec2 uv) {
  vec2 size = vec2(textureSize(uSim, 0));
  vec2 p = uv * size - 0.5;
  vec2 f = fract(p);
  ivec2 i = ivec2(floor(p));
  ivec2 mx = ivec2(size) - 1;
  vec4 a = texelFetch(uSim, clamp(i, ivec2(0), mx), 0);
  vec4 b = texelFetch(uSim, clamp(i + ivec2(1, 0), ivec2(0), mx), 0);
  vec4 c = texelFetch(uSim, clamp(i + ivec2(0, 1), ivec2(0), mx), 0);
  vec4 d = texelFetch(uSim, clamp(i + ivec2(1, 1), ivec2(0), mx), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 xz = vWorld.xz;
  float dist = length(cameraPosition - vWorld);
  vec2 g = swellGrad(xz, uTime);
  vec3 n = vec3(-g.x, 1.0, -g.y);

  vec4 sim = vec4(0.0);
  float simFade = 0.0;
  if (uSimOn > 0.5) {
    vec2 uv = (xz - uSimDomain.xy) / uSimDomain.zw;
    vec2 e = min(uv, 1.0 - uv);
    simFade = smoothstep(0.0, 0.08, min(e.x, e.y));
    if (simFade > 0.0) {
      sim = simSample(uv);
      n += vec3(sim.b, 0.0, sim.a) * 1.6 * simFade;
    }
  }
#ifdef DETAIL
  float detailFade = 1.0 - smoothstep(25.0, 110.0, dist);
  vec2 d1 = texture2D(uDetail, xz * 0.085 + uTime * vec2(0.011, 0.006)).xy * 2.0 - 1.0;
  vec2 d2 = texture2D(uDetail, xz * 0.23 + uTime * vec2(-0.008, 0.016)).xy * 2.0 - 1.0;
  n += vec3(d1.x + d2.x * 0.6, 0.0, d1.y + d2.y * 0.6) * 0.16 * detailFade;
#endif
  n = normalize(n);

  vec3 V = normalize(cameraPosition - vWorld);
  float NdV = max(dot(n, V), 0.0);
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
#ifdef DETAIL
  vec3 refl = skyColor(R, true, uTime);
#else
  vec3 refl = skyColor(R, false, uTime);
#endif

  float h = vWorld.y;
  float diffuse = 0.6 + 0.4 * max(dot(n, uSunDir), 0.0);
  vec3 body = mix(uDeep, uShallow, clamp(0.3 + h * 2.2, 0.0, 1.0)) * diffuse;
  float sss = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 2.0) * clamp(h * 6.0 + 0.3, 0.0, 1.0);
  body += uShallow * sss * 0.35;
  vec3 col = mix(body, refl, fresnel);

  vec3 H = normalize(uSunDir + V);
  float NdH = max(dot(n, H), 0.0);
  col += uSunColor * (pow(NdH, 700.0) * 7.0 + pow(NdH, 90.0) * 0.18);

  // foam from the interactive sim: fast-moving or raised water
  float foam = (smoothstep(0.006, 0.03, abs(sim.g)) + smoothstep(0.06, 0.16, sim.r)) * simFade;
  foam *= 0.5 + 0.5 * ovNoise(xz * 7.0 + uTime * 0.5);
  col = mix(col, vec3(0.92, 0.95, 0.97), clamp(foam, 0.0, 1.0) * 0.8);

  float alpha = 1.0;
  col = applyHulls(col, xz, uTime, alpha);
  col = applySlicks(col, xz, V, uTime);
  col = applyBoards(col, xz, uTime);

  float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
  col = mix(col, horizonColor(), clamp(fog, 0.0, 1.0));
  alpha = mix(alpha, 1.0, fog);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
