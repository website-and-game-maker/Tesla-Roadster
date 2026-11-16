// Visual feedback: tyre skid marks (ring buffer of quads, one draw call) and tyre smoke
// (a pool of soft particles in one Points draw call).
import * as THREE from 'three';

export class SkidMarks {
  constructor(scene, max = 1500) {
    this.max = max; this.i = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) { const a = q * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], q * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.03,0.03,0.03, vA * 0.55); }',
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.last = new Map();
  }

  /** key identifies a wheel; call every frame with sliding true/false. */
  add(key, x, y, z, rx, rz, strength, sliding) {
    const prev = this.last.get(key);
    if (!sliding) { this.last.delete(key); return; }
    if (prev && (x - prev[0]) ** 2 + (z - prev[2]) ** 2 > 0.25) {
      const w = 0.13, q = this.i % this.max, p = this.pos, a = q * 12;
      p.set([prev[0] - prev[3] * w, prev[1], prev[2] - prev[4] * w, prev[0] + prev[3] * w, prev[1], prev[2] + prev[4] * w,
        x - rx * w, y, z - rz * w, x + rx * w, y, z + rz * w], a);
      this.alpha.fill(Math.min(1, strength), q * 4, q * 4 + 4);
      this.i++;
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.attributes.alpha.needsUpdate = true;
      this.last.set(key, [x, y + 0.0, z, rx, rz]);
    } else if (!prev) this.last.set(key, [x, y, z, rx, rz]);
  }

  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh); }
}

export class Smoke {
  constructor(scene, max = 300, color = 0xdddddd) {
    this.max = max; this.n = 0; this.i = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { color: { value: new THREE.Color(color) }, scale: { value: innerHeight / 2 } },
      vertexShader: `attribute float life; attribute float size; varying float vL; uniform float scale;
        void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (1.0 + (1.0-life)*3.0) * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; varying float vL; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); if(d>0.5) discard;
        gl_FragColor = vec4(color, (1.0-d*2.0) * vL * 0.35); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
  }

  emit(x, y, z, vx, vz, amount) {
    const i = this.i++ % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y + 0.3; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx * 0.2 + (Math.random() - 0.5) * 2; this.v[i * 3 + 1] = 0.6 + Math.random(); this.v[i * 3 + 2] = vz * 0.2 + (Math.random() - 0.5) * 2;
    this.life[i] = Math.min(1, amount); this.size[i] = 1.2 + Math.random();
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt * 0.7);
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true; a.life.needsUpdate = true; a.size.needsUpdate = true;
  }

  dispose() { this.points.geometry.dispose(); this.mat.dispose(); this.points.parent?.remove(this.points); }
}

// What each ground surface throws up: colour, how much, and how heavy the bits are.
const DUST = {
  dirt:   { color: 0x8a6a48, amount: 1.0, heavy: 0.5 },
  gravel: { color: 0x9b968e, amount: 0.9, heavy: 1.0 },
  grass:  { color: 0x5d7a36, amount: 0.6, heavy: 0.35 },
  mud:    { color: 0x4d3b2a, amount: 0.9, heavy: 0.9 },
  sand:   { color: 0xd9b98c, amount: 1.2, heavy: 0.25 },
  snow:   { color: 0xf1f5fa, amount: 1.1, heavy: 0.15 },
};
const DUST_ALIAS = { shoulder: 'dirt', runoff: 'dirt', offroad: 'dirt', earth: 'dirt', rock: 'gravel', stone: 'gravel', lawn: 'grass', turf: 'grass', beach: 'sand', desert: 'sand', regolith: 'sand' };

/** Dust settings for a surface name, or null for hard surfaces (road, kerb, ice). */
export function dustFor(surface, world) {
  const n = String(surface || '').toLowerCase();
  const key = DUST[n] ? n : DUST_ALIAS[n];
  if (!key) return null;
  const d = DUST[key];
  // run-off in a desert or on the Moon is sand-coloured, not brown dirt
  const scenery = world && world.def && world.def.scenery;
  if ((n === 'shoulder' || key === 'dirt') && (scenery === 'desert' || scenery === 'moon')) return { ...DUST.sand, color: scenery === 'moon' ? 0xb4b2ad : DUST.sand.color };
  return d;
}

/**
 * General particles with their own colour, size, gravity and life: road dust
 * and stones, jet exhaust smoke and the ground blast of a take-off or landing.
 * One Points draw call per instance; pass additive for glowing embers.
 */
export class Particles {
  constructor(scene, max = 600, { additive = false, opacity = 0.5 } = {}) {
    this.max = max; this.i = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.c = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.rate = new Float32Array(max); this.size = new Float32Array(max);
    this.grav = new Float32Array(max); this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('grow', new THREE.BufferAttribute(this.grow, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: innerHeight / 2 }, opacity: { value: opacity } },
      vertexShader: `attribute float life; attribute float size; attribute float grow; attribute vec3 color; varying float vL; varying vec3 vC; uniform float scale;
        void main(){ vL = life; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (1.0 + (1.0-life)*grow) * scale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float opacity; varying float vL; varying vec3 vC; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); if(d>0.5 || vL<=0.0) discard;
        gl_FragColor = vec4(vC, (1.0-d*2.0) * min(1.0, vL*1.6) * opacity); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
    this.tmp = new THREE.Color();
    this.alive = 0;
  }

  /** o: { color, size, life (seconds), gravity (m/s²), grow (size multiplier at end) } */
  emit(x, y, z, vx, vy, vz, o = {}) {
    const i = this.i++ % this.max, k = i * 3;
    this.p[k] = x; this.p[k + 1] = y; this.p[k + 2] = z;
    this.v[k] = vx; this.v[k + 1] = vy; this.v[k + 2] = vz;
    this.tmp.setHex(o.color ?? 0xdddddd);
    this.c[k] = this.tmp.r; this.c[k + 1] = this.tmp.g; this.c[k + 2] = this.tmp.b;
    this.life[i] = 1; this.rate[i] = 1 / (o.life || 1);
    this.size[i] = o.size || 0.6; this.grav[i] = o.gravity || 0; this.grow[i] = o.grow ?? 2;
    this.alive = this.max;
  }

  update(dt) {
    if (!this.alive) return;
    let n = 0;
    const drag = Math.exp(-dt * 1.6);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      n++;
      const k = i * 3;
      this.life[i] = Math.max(0, this.life[i] - dt * this.rate[i]);
      this.v[k] *= drag; this.v[k + 2] *= drag; this.v[k + 1] = this.v[k + 1] * drag - this.grav[i] * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
    }
    this.alive = n;
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true; a.life.needsUpdate = true; a.size.needsUpdate = true; a.color.needsUpdate = true; a.grow.needsUpdate = true;
  }

  dispose() { this.points.geometry.dispose(); this.mat.dispose(); this.points.parent?.remove(this.points); }
}
