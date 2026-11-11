// Samples any closed centre-line curve into evenly spaced points so the game can answer
// "where along the lap is this car, and how far from the centre line?" quickly.
// Used for lap progress, race positions, wall collisions, AI driving lines and the minimap.

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class TrackSampler {
  constructor(curve, { roadHalfWidth = 7, wallHalfWidth = 11 } = {}, getGroundHeight = null) {
    this.length = curve.getLength();
    const n = Math.max(240, Math.round(this.length / 2));
    this.n = n;
    this.ds = this.length / n;
    this.roadHalf = roadHalfWidth;
    this.wallHalf = wallHalfWidth;
    const pts = curve.getSpacedPoints(n);
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.k = new Float32Array(n); this.heading = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = pts[i].x; this.pz[i] = pts[i].z;
      this.py[i] = getGroundHeight ? getGroundHeight(pts[i].x, pts[i].z) : pts[i].y;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      this.heading[i] = Math.atan2(dx, dz);
    }
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n;
      raw[i] = wrapAngle(this.heading[b] - this.heading[a]) / (4 * this.ds);
    }
    for (let i = 0; i < n; i++) { // smooth curvature over ~16 m
      let s = 0;
      for (let j = -4; j <= 4; j++) s += raw[(i + j + n) % n];
      this.k[i] = s / 9;
    }
    // bounds for minimap
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  idx(i) { return ((i % this.n) + this.n) % this.n; }

  /** Nearest point on the centre line. `hint` = previous index for a fast local search. */
  locate(x, z, hint = -1, out = {}) {
    const n = this.n;
    let best = -1, bestD = Infinity;
    if (hint >= 0) {
      for (let j = -30; j <= 30; j++) {
        const i = this.idx(hint + j);
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD > (this.wallHalf * 2.5) ** 2) best = -1;
    }
    if (best < 0) {
      bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    // refine on the segment best -> best+1 (or best-1 -> best)
    let i0 = best, i1 = this.idx(best + 1);
    let sx = this.px[i1] - this.px[i0], sz = this.pz[i1] - this.pz[i0];
    let t = ((x - this.px[i0]) * sx + (z - this.pz[i0]) * sz) / (sx * sx + sz * sz || 1);
    if (t < 0) {
      i1 = i0; i0 = this.idx(best - 1);
      sx = this.px[i1] - this.px[i0]; sz = this.pz[i1] - this.pz[i0];
      t = ((x - this.px[i0]) * sx + (z - this.pz[i0]) * sz) / (sx * sx + sz * sz || 1);
    }
    t = Math.max(0, Math.min(1, t));
    const cx = this.px[i0] + sx * t, cz = this.pz[i0] + sz * t;
    const l = Math.hypot(sx, sz) || 1;
    const tx = sx / l, tz = sz / l;
    const nx = -tz, nz = tx; // right-hand side of the driving direction
    out.i = best;
    out.dist = (i0 + t) * this.ds;
    out.lat = (x - cx) * nx + (z - cz) * nz;
    out.nx = nx; out.nz = nz; out.tx = tx; out.tz = tz;
    out.y = this.py[i0] + (this.py[i1] - this.py[i0]) * t;
    out.slope = (this.py[i1] - this.py[i0]) / (l || 1);
    return out;
  }

  /** Point on the centre line at distance d (wraps), plus lateral offset. */
  pointAt(d, lat = 0, out = {}) {
    const f = (((d % this.length) + this.length) % this.length) / this.ds;
    const i0 = Math.floor(f) % this.n, i1 = (i0 + 1) % this.n, t = f - Math.floor(f);
    const tx = this.tx[i0] + (this.tx[i1] - this.tx[i0]) * t;
    const tz = this.tz[i0] + (this.tz[i1] - this.tz[i0]) * t;
    const l = Math.hypot(tx, tz) || 1;
    out.x = this.px[i0] + (this.px[i1] - this.px[i0]) * t + (-tz / l) * lat;
    out.z = this.pz[i0] + (this.pz[i1] - this.pz[i0]) * t + (tx / l) * lat;
    out.y = this.py[i0] + (this.py[i1] - this.py[i0]) * t;
    out.yaw = Math.atan2(tx, tz);
    out.i = i0;
    return out;
  }

  curvatureAt(d) {
    const i = Math.floor((((d % this.length) + this.length) % this.length) / this.ds) % this.n;
    return this.k[i];
  }
}
