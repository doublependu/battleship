// Game overlays drawn directly in the water so they ride the waves. Shared by the sea shader
// (Low/Medium/High) and the Ultra surface shader.
// Boards: player centred at x = -6.5, enemy at x = +6.5, both z = 0, 10 x 10 cells; row = floor(z + 5).
#define MAX_HULLS 10
#define MAX_SLICKS 10
uniform float uBoardAlpha;
uniform sampler2D uCells;      // 20 x 10, R = state * 64 (1 miss, 2 hit, 3 sunk); x < 10 player, >= 10 enemy
uniform vec4 uAim;             // world x, z of aimed cell centre, active, valid
uniform vec4 uPlace;           // placement preview rect: minX, minZ, maxX, maxZ
uniform float uPlaceState;     // 0 off, 1 valid, 2 invalid
uniform vec4 uHulls[MAX_HULLS];      // visible hulls: centre x, z, half extents x, z
uniform float uHullSink[MAX_HULLS];  // 0 afloat .. 1 fully under
uniform int uHullCount;
uniform vec4 uSlicks[MAX_SLICKS];    // x, z, radius, strength
uniform int uSlickCount;

float ovHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
float ovNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ovHash(i), ovHash(i + vec2(1, 0)), f.x), mix(ovHash(i + vec2(0, 1)), ovHash(i + vec2(1, 1)), f.x), f.y);
}

float sdBox2(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Hull contact: dark patch under hulls, foam where hulls meet the water; alpha for see-through (High).
vec3 applyHulls(vec3 col, vec2 xz, float t, inout float alpha) {
  for (int i = 0; i < MAX_HULLS; i++) {
    if (i >= uHullCount) break;
    vec4 h = uHulls[i];
    float sd = sdBox2(xz - h.xy, h.zw - 0.12) - 0.12;
    float sink = uHullSink[i];
    float contact = (1.0 - smoothstep(-0.05, 0.35, sd)) * (1.0 - sink * 0.6);
    col *= 1.0 - 0.32 * contact;
    float n = ovNoise(xz * 9.0 + vec2(t * 0.9, -t * 0.6));
    float foam = smoothstep(0.16, 0.0, abs(sd - 0.04)) * (0.45 + 0.55 * n) * (1.0 - sink);
    foam += smoothstep(0.6, 0.0, abs(sd - 0.1)) * sink * (1.0 - sink) * 3.0 * n;
    col = mix(col, vec3(0.93, 0.96, 0.98), clamp(foam, 0.0, 1.0) * 0.55);
#ifdef SEE_THROUGH
    alpha = min(alpha, mix(0.62, 1.0, smoothstep(-0.02, 0.3, sd)));
#endif
  }
  return col;
}

// Oil slicks where ships sank: dark, calm, with a thin-film sheen.
vec3 applySlicks(vec3 col, vec2 xz, vec3 V, float t) {
  for (int i = 0; i < MAX_SLICKS; i++) {
    if (i >= uSlickCount) break;
    vec4 s = uSlicks[i];
    vec2 d = xz - s.xy;
    float wobble = ovNoise(xz * 1.3 + float(i) * 7.0 + t * 0.03) * 0.6;
    float m = (1.0 - smoothstep(s.z * 0.5, s.z, length(d) + wobble)) * s.w;
    float film = ovNoise(xz * 2.7 - t * 0.05) * 6.0 + V.y * 4.0;
    vec3 sheen = 0.5 + 0.5 * cos(film + vec3(0.0, 2.1, 4.2));
    float streak = smoothstep(0.55, 0.9, ovNoise(xz * 4.0 + float(i) * 3.0));
    col = mix(col, col * 0.42 + sheen * 0.025 * streak, m * 0.7);
  }
  return col;
}

// fw = fwidth(xz), computed by the caller in uniform control flow (derivatives are undefined in branches).
vec3 applyBoard(vec3 col, vec2 xz, vec2 fw, vec2 centre, float side, float t) {
  vec2 local = xz - centre + 5.0;
  if (local.x < -0.6 || local.y < -0.6 || local.x > 10.6 || local.y > 10.6) return col;
  vec2 inBox = smoothstep(-fw, fw, local) * smoothstep(-fw, fw, 10.0 - local);
  float inside = inBox.x * inBox.y;
  float a = uBoardAlpha;
  // slight tint so the board area reads as a zone
  vec3 tint = side < 0.5 ? vec3(0.55, 0.8, 1.0) : vec3(1.0, 0.72, 0.62);
  col = mix(col, col * 0.88 + tint * 0.07, inside * a);
  // grid lines (anti-aliased with fwidth) and a thicker border
  vec2 f = abs(local - floor(local + 0.5));
  vec2 lw = fw * 0.6;
  vec2 l = 1.0 - smoothstep(lw, lw + fw * 1.2, f);
  float lines = max(l.x, l.y) * inside;
  float border = sdBox2(local - 5.0, vec2(5.0));
  float edge = 1.0 - smoothstep(fw.x * 1.5, fw.x * 3.5, abs(border));
  col = mix(col, vec3(1.0), clamp(lines * 0.26 + edge * 0.6, 0.0, 1.0) * a);

  if (inside > 0.0) {
    ivec2 cell = ivec2(clamp(floor(local), 0.0, 9.0));
    float state = texelFetch(uCells, ivec2(cell.x + int(side) * 10, cell.y), 0).r * 255.0 / 64.0;
    vec2 cp = fract(local) - 0.5;
    float r = length(cp);
    if (state > 0.5 && state < 1.5) {          // miss: pale ring
      float ring = 1.0 - smoothstep(0.02, 0.05, abs(r - 0.3));
      col = mix(col, vec3(0.9, 0.95, 1.0), ring * 0.55 * a);
      col = mix(col, col * 1.15 + 0.04, (1.0 - smoothstep(0.3, 0.45, r)) * 0.25 * a);
    } else if (state > 1.5) {                  // hit / sunk: red glow
      float glow = 1.0 - smoothstep(0.1, 0.5, r);
      vec3 red = state > 2.5 ? vec3(0.45, 0.08, 0.05) : vec3(1.0, 0.25, 0.1);
      col = mix(col, red, glow * 0.55 * a);
    }
  }

  // aim highlight
  if (uAim.z > 0.5) {
    vec2 d = abs(xz - uAim.xy);
    float m = max(d.x, d.y);
    if (m < 0.62) {
      float pulse = 0.65 + 0.35 * sin(t * 6.0);
      vec3 c = uAim.w > 0.5 ? vec3(1.0, 0.82, 0.25) : vec3(0.55, 0.55, 0.6);
      float fill = (1.0 - smoothstep(0.46, 0.5, m)) * 0.28;
      float outline = 1.0 - smoothstep(0.03, 0.07, abs(m - 0.47));
      col = mix(col, c, (fill + outline * pulse) * a);
    }
  }
  return col;
}

vec3 applyBoards(vec3 col, vec2 xz, float t) {
  vec2 fw = max(fwidth(xz), vec2(1e-4));
  if (uBoardAlpha <= 0.001) return col;
  col = applyBoard(col, xz, fw, vec2(-6.5, 0.0), 0.0, t);
  col = applyBoard(col, xz, fw, vec2(6.5, 0.0), 1.0, t);
  if (uPlaceState > 0.5) {
    vec2 c = (uPlace.xy + uPlace.zw) * 0.5;
    vec2 hsz = (uPlace.zw - uPlace.xy) * 0.5;
    float sd = sdBox2(xz - c, hsz);
    vec3 pc = uPlaceState < 1.5 ? vec3(0.3, 1.0, 0.45) : vec3(1.0, 0.25, 0.2);
    float fill = (1.0 - smoothstep(-fw.x, fw.x, sd)) * 0.35;
    float outline = 1.0 - smoothstep(fw.x, fw.x * 3.0, abs(sd));
    col = mix(col, pc, clamp(fill + outline * 0.6, 0.0, 1.0) * uBoardAlpha);
  }
  return col;
}
