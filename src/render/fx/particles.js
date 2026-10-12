// GPU particle pool: instanced billboards. Motion (drag + gravity), size and colour curves are evaluated in
// the vertex shader from the game clock, so the CPU only writes a ring-buffer slot when a particle spawns.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aTime;   // spawn time, lifetime, drag, gravity scale
attribute vec4 aSize;   // start size, end size, spin, rotation
attribute vec4 aC0;     // start colour + alpha
attribute vec4 aC1;     // end colour + alpha
uniform float uTime;
varying vec4 vColor;
varying vec2 vUv;
varying float vShade;

void main() {
  float age = uTime - aTime.x;
  float t = age / aTime.y;
  if (age < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = max(aTime.z, 1e-3);
  float e = exp(-k * age);
  vec3 g = vec3(0.0, -9.0 * aTime.w, 0.0);
  vec3 p = aPos + aVel * (1.0 - e) / k + g * (age / k - (1.0 - e) / (k * k));
  float size = mix(aSize.x, aSize.y, 1.0 - (1.0 - t) * (1.0 - t));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float rot = aSize.w + aSize.z * age;
  float c = cos(rot);
  float s = sin(rot);
  vec2 corner = mat2(c, s, -s, c) * position.xy;
  mv.xy += corner * size;
  vShade = corner.y + 0.5;
  gl_Position = projectionMatrix * mv;
  vColor = mix(aC0, aC1, t);
  vColor.a *= smoothstep(0.0, 0.06, t);
  vUv = position.xy + 0.5;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
varying vec2 vUv;
varying float vShade;
void main() {
  float a = texture2D(uMap, vUv).a * vColor.a;
  if (a < 0.004) discard;
#ifdef ADDITIVE
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
#else
  // cheap self-shadowing: smoke and spray are lit from above
  gl_FragColor = vec4(vColor.rgb * mix(0.62, 1.18, clamp(vShade, 0.0, 1.0)), a);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class ParticlePool {
  constructor(capacity, { additive, map, timeUniform }) {
    this.capacity = capacity;
    this.head = 0;
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const attr = (name, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.a = { aPos: attr('aPos', 3), aVel: attr('aVel', 3), aTime: attr('aTime', 4), aSize: attr('aSize', 4),
      aC0: attr('aC0', 4), aC1: attr('aC1', 4) };
    // park all slots as long expired
    for (let i = 0; i < capacity; i++) this.a.aTime.array.set([-1e6, 1], i * 4);
    geo.instanceCount = capacity;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: timeUniform, uMap: { value: map } },
      defines: additive ? { ADDITIVE: '' } : {},
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 11;
    this.mesh.layers.enable(2); // reflected by the Ultra mirror pass
  }

  /**
   * Spawn one particle. o: {pos, vel, time, life, drag, gravity, size0, size1, spin, rot, c0:[r,g,b,a], c1}
   */
  spawn(o) {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const { aPos, aVel, aTime, aSize, aC0, aC1 } = this.a;
    aPos.array.set([o.pos.x, o.pos.y, o.pos.z], i * 3);
    aVel.array.set([o.vel?.x ?? 0, o.vel?.y ?? 0, o.vel?.z ?? 0], i * 3);
    aTime.array.set([o.time, o.life, o.drag ?? 1, o.gravity ?? 0], i * 4);
    aSize.array.set([o.size0, o.size1 ?? o.size0, o.spin ?? 0, o.rot ?? Math.random() * 6.28], i * 4);
    aC0.array.set(o.c0, i * 4);
    aC1.array.set(o.c1 ?? o.c0, i * 4);
    this.dirtyMin = Math.min(this.dirtyMin, i);
    this.dirtyMax = Math.max(this.dirtyMax, i);
  }

  /** Upload the slots written this frame. */
  flush() {
    if (this.dirtyMax < 0) return;
    for (const a of Object.values(this.a)) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirtyMin * a.itemSize, (this.dirtyMax - this.dirtyMin + 1) * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
