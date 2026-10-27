// Ultra "real water" surface, adapted from threejs-water WaterAbove.frag
// (MIT, (c) 2011 Evan Wallace, (c) 2026 Yong Su). See THIRD_PARTY_NOTICES.md.
// Kept: parallax refinement of the sim lookup, normal reconstruction, reflect/refract rays, Fresnel blend,
// ray-traced refraction against the floor + axis-aligned object boxes (slab test), and projected object
// textures sampled at the ray hit points.
// Changed: the pool becomes a shallow sandy seabed that fades into deep water, hulls are ship boxes,
// reflections use a planar mirror pass (it also catches fire and smoke) with a ray-traced sky fallback,
// colour-dependent absorption along the underwater path, and the game overlays are drawn on top.
#define MAX_BOXES 12
const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uFogDensity;
uniform sampler2D uSim;
uniform vec4 uSimDomain;
uniform float uSimOn;
uniform sampler2D uDetail;
uniform sampler2D uCaustics;
uniform sampler2D uReflection;
uniform sampler2D uRefraction;
uniform samplerCube uSkyCube;
uniform mat4 uViewProj;
uniform mat4 uReflectionVP;
uniform vec3 uBoxMin[MAX_BOXES];
uniform vec3 uBoxMax[MAX_BOXES];
uniform int uBoxCount;
uniform float uSeabedY;
varying vec3 vWorld;

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

vec2 intersectBox(vec3 origin, vec3 ray, vec3 bmin, vec3 bmax) {
  vec3 tMin = (bmin - origin) / ray;
  vec3 tMax = (bmax - origin) / ray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  return vec2(max(max(t1.x, t1.y), t1.z), min(min(t2.x, t2.y), t2.z));
}

vec2 projectUV(mat4 m, vec3 p) {
  vec4 c = m * vec4(p, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}

// Shallow sandy shelf under the boards, fading into deep water beyond.
float shelfMask(vec2 xz) {
  return (1.0 - smoothstep(13.0, 17.5, abs(xz.x))) * (1.0 - smoothstep(5.8, 9.0, abs(xz.y)));
}

vec3 seabedColor(vec3 p) {
  vec2 q = p.xz;
  float ripples = sin(q.x * 3.1 + sin(q.y * 1.3) * 1.7) * 0.5 + 0.5;
  float n = ovNoise(q * 1.7) * 0.6 + ovNoise(q * 5.3) * 0.4;
  vec3 sand = mix(vec3(0.58, 0.5, 0.34), vec3(0.72, 0.64, 0.45), n) * (0.9 + 0.1 * ripples);
  float rock = smoothstep(0.8, 0.86, ovNoise(q * 1.6 + 13.0) * 0.75 + ovNoise(q * 4.1) * 0.25);
  sand = mix(sand, vec3(0.32, 0.31, 0.26) * (0.7 + 0.6 * ovNoise(q * 9.0)), rock * 0.85);
  float weed = smoothstep(0.78, 0.9, ovNoise(q * 0.7 - 5.0)) * (0.5 + 0.5 * ovNoise(q * 6.0));
  sand = mix(sand, vec3(0.18, 0.26, 0.14), weed * 0.5);
  vec2 cuv = (q - uSimDomain.xy) / uSimDomain.zw;
  float caustic = 1.0;
  if (cuv.x > 0.0 && cuv.y > 0.0 && cuv.x < 1.0 && cuv.y < 1.0) {
    vec2 e = min(cuv, 1.0 - cuv);
    caustic = mix(1.0, textureLod(uCaustics, cuv, 0.0).r * 2.0, smoothstep(0.0, 0.1, min(e.x, e.y)));
  }
  float light = 0.3 + 0.95 * pow(caustic, 1.35) * max(uSunDir.y, 0.2);
  return sand * light;
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
    simFade = smoothstep(0.0, 0.06, min(e.x, e.y));
    if (simFade > 0.0) {
      sim = simSample(uv);
      // upstream's parallax refinement: step along the slope towards the true surface sample
      for (int i = 0; i < 5; i++) {
        uv = clamp(uv + sim.ba * 0.0035, 0.0, 1.0);
        sim = simSample(uv);
      }
      n += vec3(sim.b, 0.0, sim.a) * 1.6 * simFade;
    }
  }
  float detailFade = 1.0 - smoothstep(25.0, 110.0, dist);
  vec2 d1 = texture2D(uDetail, xz * 0.085 + uTime * vec2(0.011, 0.006)).xy * 2.0 - 1.0;
  vec2 d2 = texture2D(uDetail, xz * 0.23 + uTime * vec2(-0.008, 0.016)).xy * 2.0 - 1.0;
  n += vec3(d1.x + d2.x * 0.6, 0.0, d1.y + d2.y * 0.6) * 0.12 * detailFade;
  n = normalize(n);

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 incoming = -V;
  float NdV = max(dot(n, V), 0.0);
  vec3 reflected = reflect(incoming, n);
  reflected.y = abs(reflected.y);
  vec3 refracted = refract(incoming, n, IOR_AIR / IOR_WATER);
  float fresnel = mix(0.05, 1.0, pow(1.0 - NdV, 4.0));

  // ---- refraction: hull boxes first, then the seabed
  float tFloor = (uSeabedY - vWorld.y) / min(refracted.y, -1e-3);
  vec3 floorP = vWorld + refracted * tFloor;
  float shelf = shelfMask(floorP.xz);
  vec3 refr = seabedColor(floorP);
  float path = tFloor;
  float nearest = tFloor;
  for (int i = 0; i < MAX_BOXES; i++) {
    if (i >= uBoxCount) break;
    vec2 t = intersectBox(vWorld, refracted, uBoxMin[i], uBoxMax[i]);
    if (t.x < t.y && t.y > 0.0 && t.x < nearest) {
      vec3 hitP = vWorld + refracted * max(t.x, 0.0);
      vec4 obj = textureLod(uRefraction, projectUV(uViewProj, hitP), 0.0);
      // step into the box until we find the hull in the projected texture
      if (obj.a < 0.5) {
        hitP = vWorld + refracted * mix(max(t.x, 0.0), t.y, 0.5);
        obj = textureLod(uRefraction, projectUV(uViewProj, hitP), 0.0);
      }
      if (obj.a > 0.5) {
        refr = obj.rgb;
        nearest = max(t.x, 0.0);
        path = nearest;
        shelf = 1.0;
      }
    }
  }
  // colour-dependent absorption + in-scattering along the underwater path
  vec3 transmit = exp(-vec3(0.5, 0.15, 0.1) * path);
  vec3 scatter = uShallow * (0.55 + 0.45 * max(uSunDir.y, 0.0));
  refr = refr * transmit + scatter * (1.0 - transmit);
  vec3 deep = uDeep * (0.6 + 0.4 * max(dot(n, uSunDir), 0.0));
  refr = mix(deep, refr, shelf);

  // ---- reflection: planar mirror pass (ships, fire, smoke) over the ray-traced sky
  vec3 refl = textureCube(uSkyCube, reflected).rgb;
  vec2 ruv = projectUV(uReflectionVP, vec3(xz.x, 0.0, xz.y)) + n.xz * 0.045;
  vec4 mirror = texture2D(uReflection, clamp(ruv, 0.001, 0.999));
  // Additive fire adds up its alpha past 1 in the half-float target: unclamped, the mix would overshoot the sky
  // into colours of its own (yellow and purple fringes around an explosion).
  refl = mix(refl, mirror.rgb, clamp(mirror.a, 0.0, 1.0));

  vec3 col = mix(refr, refl, fresnel);
  vec3 H = normalize(uSunDir + V);
  float NdH = max(dot(n, H), 0.0);
  col += uSunColor * (pow(NdH, 700.0) * 7.0 + pow(NdH, 90.0) * 0.15);

  float foam = (smoothstep(0.006, 0.03, abs(sim.g)) + smoothstep(0.06, 0.16, sim.r)) * simFade;
  foam *= 0.5 + 0.5 * ovNoise(xz * 7.0 + uTime * 0.5);
  col = mix(col, vec3(0.92, 0.95, 0.97), clamp(foam, 0.0, 1.0) * 0.8);

  float alpha = 1.0;
  col = applyHulls(col, xz, uTime, alpha);
  col = applySlicks(col, xz, V, uTime);
  col = applyBoards(col, xz, uTime);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
  col = mix(col, horizonColor(), clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
