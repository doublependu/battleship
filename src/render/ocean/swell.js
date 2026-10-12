// Analytic open-sea swell: a few summed directional sine waves. The same maths runs in GLSL (vertex
// displacement + normals) and here in JS, so ships bob on the CPU with no GPU readback.

const G = 6; // gravity in world units (1 unit = 1 cell), tuned for a calm look

function wave(dirDeg, wavelength, amplitude, phase) {
  const a = (dirDeg * Math.PI) / 180;
  const k = (2 * Math.PI) / wavelength;
  return { dx: Math.cos(a), dz: Math.sin(a), k, amplitude, omega: Math.sqrt(G * k), phase };
}

export const WAVES = [
  wave(18, 14, 0.06, 0.0),
  wave(-52, 9, 0.04, 1.7),
  wave(105, 5.5, 0.024, 4.1),
  wave(32, 3.3, 0.014, 2.6),
];

/** Uniform data for GLSL: vec4(dir.x, dir.z, k, amplitude) and vec2(omega, phase). */
export function swellUniforms() {
  return {
    uWaveA: { value: WAVES.map((w) => [w.dx, w.dz, w.k, w.amplitude]).flat() },
    uWaveB: { value: WAVES.map((w) => [w.omega, w.phase]).flat() },
  };
}

export function swellHeight(x, z, t) {
  let h = 0;
  for (const w of WAVES) h += w.amplitude * Math.sin(w.k * (w.dx * x + w.dz * z) - w.omega * t + w.phase);
  return h;
}

export const SWELL_GLSL = /* glsl */ `
uniform float uWaveA[${WAVES.length * 4}];
uniform float uWaveB[${WAVES.length * 2}];
float swellHeight(vec2 p, float t) {
  float h = 0.0;
  for (int i = 0; i < ${WAVES.length}; i++) {
    vec2 d = vec2(uWaveA[i * 4], uWaveA[i * 4 + 1]);
    h += uWaveA[i * 4 + 3] * sin(uWaveA[i * 4 + 2] * dot(d, p) - uWaveB[i * 2] * t + uWaveB[i * 2 + 1]);
  }
  return h;
}
// Gradient (dh/dx, dh/dz).
vec2 swellGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${WAVES.length}; i++) {
    vec2 d = vec2(uWaveA[i * 4], uWaveA[i * 4 + 1]);
    float k = uWaveA[i * 4 + 2];
    g += uWaveA[i * 4 + 3] * k * d * cos(k * dot(d, p) - uWaveB[i * 2] * t + uWaveB[i * 2 + 1]);
  }
  return g;
}
`;
