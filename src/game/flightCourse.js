// Flight course: a closed 3D centre line through the sky plus rings to fly through.
// Comes from the worlds module (world.flightCurve / world.rings) or is generated from the
// ground track (lifted into the air with climbs and dives) when a world has no flight data.
import * as THREE from 'three';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class FlightCourse {
  constructor(curve) {
    this.curve = curve;
    this.length = curve.getLength();
    const n = this.n = Math.max(300, Math.round(this.length / 3));
    this.ds = this.length / n;
    const pts = curve.getSpacedPoints(n);
    this.p = pts.slice(0, n);
    this.tan = []; this.k = new Float32Array(n); this.turn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.p[(i - 1 + n) % n], b = this.p[(i + 1) % n];
      this.tan.push(b.clone().sub(a).normalize());
    }
    for (let i = 0; i < n; i++) {
      const a = this.tan[(i - 3 + n) % n], b = this.tan[(i + 3) % n];
      this.k[i] = a.angleTo(b) / (6 * this.ds);
      const ha = Math.atan2(a.x, a.z), hb = Math.atan2(b.x, b.z);
      this.turn[i] = wrap(hb - ha) / (6 * this.ds);
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const q of this.p) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z); }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  idx(s) { return Math.floor((((s % this.length) + this.length) % this.length) / this.ds) % this.n; }
  curvatureAt(s) { return this.k[this.idx(s)]; }
  signedTurnAt(s) { return this.turn[this.idx(s)]; }

  /** Point, tangent and side/up vectors at distance s. */
  at(s, out = {}) {
    const f = (((s % this.length) + this.length) % this.length) / this.ds;
    const i0 = Math.floor(f) % this.n, i1 = (i0 + 1) % this.n, t = f - Math.floor(f);
    const a = this.p[i0], b = this.p[i1];
    out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
    out.tan = (out.tan || new THREE.Vector3()).copy(this.tan[i0]).lerp(this.tan[i1], t).normalize();
    out.nrm = (out.nrm || new THREE.Vector3()).crossVectors(out.tan, new THREE.Vector3(0, 1, 0)).normalize(); // right
    out.bin = (out.bin || new THREE.Vector3()).crossVectors(out.nrm, out.tan).normalize(); // up
    out.i = i0;
    return out;
  }

  /** Nearest course distance to a point (local search around `hint` when given). */
  locate(pos, hint = -1) {
    let best = 0, bd = Infinity;
    const scan = (i) => { const d = this.p[i].distanceToSquared(pos); if (d < bd) { bd = d; best = i; } };
    if (hint >= 0) for (let j = -40; j <= 40; j++) scan((hint + j + this.n) % this.n);
    if (hint < 0 || bd > 120 * 120) for (let i = 0; i < this.n; i++) scan(i);
    return { i: best, s: best * this.ds, dist: Math.sqrt(bd) };
  }
}

/** Lift a ground track into the sky: gentle climbs and dives, staying above the ground. */
export function courseFromGround(trackCurve, groundAt, seed = 1) {
  const L = trackCurve.getLength();
  const n = Math.max(12, Math.round(L / 220));
  const pts = trackCurve.getSpacedPoints(n).slice(0, n).map((p, i) => {
    const a = (i / n) * Math.PI * 2;
    const h = 38 + 22 * Math.sin(a * 3 + seed) + 12 * Math.sin(a * 5 + seed * 2);
    const g = groundAt ? groundAt(p.x, p.z) : p.y;
    return new THREE.Vector3(p.x, Math.max(g + 14, (p.y || 0) + h), p.z);
  });
  const rough = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  if (!groundAt) return rough;
  // second pass: sample densely and keep every part of the path well above the terrain
  const m = Math.max(40, Math.round(rough.getLength() / 45));
  const dense = rough.getSpacedPoints(m).slice(0, m);
  const clear = dense.map((p) => {
    let g = -Infinity;
    for (let dx = -30; dx <= 30; dx += 15) for (let dz = -30; dz <= 30; dz += 15) g = Math.max(g, groundAt(p.x + dx, p.z + dz));
    return g + 16;
  });
  for (let pass = 0; pass < 2; pass++) dense.forEach((p, i) => { // smooth the minimums so climbs are gentle
    const need = Math.max(clear[i], clear[(i + 1) % m] - 8, clear[(i - 1 + m) % m] - 8);
    if (p.y < need) p.y = need;
  });
  return new THREE.CatmullRomCurve3(dense, true, 'centripetal');
}

/** Rings along the course every `spacing` metres, facing the direction of travel. */
export function ringsFromCourse(course, spacing = 200, radius = 14) {
  const rings = [];
  const count = Math.max(8, Math.round(course.length / spacing));
  const tmp = {};
  for (let i = 0; i < count; i++) {
    const s = (i / count) * course.length + 40;
    const p = course.at(s, tmp);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.tan);
    rings.push({ position: new THREE.Vector3(p.x, p.y, p.z), quaternion: q, radius, s });
  }
  return rings;
}

/** Did the segment a->b pass through the ring's disc? */
export function crossesRing(ring, a, b, slack = 1.25) {
  const n = ring._n || (ring._n = new THREE.Vector3(0, 0, 1).applyQuaternion(ring.quaternion));
  const da = a.clone().sub(ring.position).dot(n), db = b.clone().sub(ring.position).dot(n);
  if (da > 0 || db < 0) return false; // must go from behind to in front
  const t = da / (da - db || 1e-6);
  const hit = a.clone().lerp(b, t);
  return hit.distanceTo(ring.position) <= ring.radius * slack;
}
