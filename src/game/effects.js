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
