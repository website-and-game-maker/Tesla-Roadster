/**
 * Snapshot interpolation for remote cars.
 *
 * Each remote car sends ~20 snapshots/s: position, orientation, velocity,
 * all stamped in host time. We render it slightly in the past
 * (interpolationDelayMs) so there are almost always two snapshots around the
 * render time. Between them we use a cubic Hermite curve that also matches
 * both velocities, which keeps fast cornering smooth instead of the
 * "polygon" look plain lerp gives at 200+ km/h. If packets stop arriving we
 * extrapolate along the last velocity for a short, capped time.
 */

/** Hermite curve between p0 and p1 with tangents v0, v1 over dt seconds. */
export function hermite(p0, v0, p1, v1, dt, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = h00 * p0[i] + h10 * dt * v0[i] + h01 * p1[i] + h11 * dt * v1[i];
  }
  return out;
}

/** Spherical lerp between unit quaternions [x, y, z, w]. */
export function slerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  // Take the short way round.
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0;
  let k1;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    k0 = Math.sin((1 - t) * theta) / sin;
    k1 = Math.sin(t * theta) / sin;
  }
  const q = [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return q.map((c) => c / len);
}

const lerp = (a, b, t) => a + (b - a) * t;

export class SnapshotBuffer {
  constructor({ maxSnapshots = 40, maxExtrapolationMs = 250 } = {}) {
    this.maxSnapshots = maxSnapshots;
    this.maxExtrapolationMs = maxExtrapolationMs;
    this.snaps = [];
  }

  /** snap = { t, p:[3], q:[4], v:[3], ...extra } with t in host ms. */
  push(snap) {
    const s = this.snaps;
    // Drop duplicates / out-of-order arrivals older than what we have.
    if (s.length && snap.t <= s[s.length - 1].t) {
      if (snap.t === s[s.length - 1].t) return;
      let i = s.length - 1;
      while (i > 0 && s[i - 1].t > snap.t) i--;
      if (s[i - 1]?.t === snap.t) return;
      s.splice(i, 0, snap);
    } else {
      s.push(snap);
    }
    if (s.length > this.maxSnapshots) s.splice(0, s.length - this.maxSnapshots);
  }

  get latest() {
    return this.snaps[this.snaps.length - 1] || null;
  }

  /** Returns the interpolated state at host time `t`, or null if empty. */
  sample(t) {
    const s = this.snaps;
    if (!s.length) return null;

    if (t <= s[0].t) return { ...s[0], extrapolated: false };

    const last = s[s.length - 1];
    if (t >= last.t) {
      const dtMs = Math.min(t - last.t, this.maxExtrapolationMs);
      const dt = dtMs / 1000;
      return {
        ...last,
        p: [last.p[0] + last.v[0] * dt, last.p[1] + last.v[1] * dt, last.p[2] + last.v[2] * dt],
        extrapolated: dtMs > 0,
        stale: t - last.t > this.maxExtrapolationMs,
      };
    }

    // Binary search for the bracketing pair.
    let lo = 0;
    let hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = s[lo];
    const b = s[hi];
    const span = b.t - a.t;
    const u = span > 0 ? (t - a.t) / span : 0;
    const dt = span / 1000;
    return {
      ...b,
      t,
      p: hermite(a.p, a.v, b.p, b.v, dt, u),
      q: slerp(a.q, b.q, u),
      v: [lerp(a.v[0], b.v[0], u), lerp(a.v[1], b.v[1], u), lerp(a.v[2], b.v[2], u)],
      speed: lerp(a.speed ?? 0, b.speed ?? 0, u),
      steer: lerp(a.steer ?? 0, b.steer ?? 0, u),
      extrapolated: false,
    };
  }

  /** Forget snapshots older than t (keeps one before t for interpolation). */
  prune(t) {
    const s = this.snaps;
    let i = 0;
    while (i < s.length - 2 && s[i + 1].t < t) i++;
    if (i) s.splice(0, i);
  }
}
