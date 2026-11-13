// Helpers for writing world definitions.
import * as THREE from 'three';

// City-style circuits: straight edges joined by circular corners.
// corners: [[x, z, y?], ...] in driving order. The output starts in the
// middle of the edge corners[0] -> corners[1], heading towards corners[1].
export function roundedPolygon(corners, radius = 30, step = 60) {
  const n = corners.length;
  const P = corners.map(([x, z, y = 0]) => ({ x, z, y }));
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = P[k];
    const b = P[(k + 1) % n];
    const c = P[(k + 2) % n];
    // Straight from a to b (excluding the corner zones), starting at the midpoint for k = 0.
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const abl = Math.hypot(abx, abz);
    const ux = abx / abl;
    const uz = abz / abl;
    const t0 = k === 0 ? abl / 2 : radius;
    const t1 = abl - radius;
    const segs = Math.max(1, Math.round((t1 - t0) / step));
    for (let s = 0; s < segs; s++) {
      const t = t0 + ((t1 - t0) * s) / segs;
      out.push([a.x + ux * t, a.z + uz * t, a.y + (b.y - a.y) * (t / abl)]);
    }
    // Corner arc at b.
    const bcx = c.x - b.x;
    const bcz = c.z - b.z;
    const bcl = Math.hypot(bcx, bcz);
    const vx = bcx / bcl;
    const vz = bcz / bcl;
    const p0 = new THREE.Vector2(b.x - ux * radius, b.z - uz * radius);
    const p2 = new THREE.Vector2(b.x + vx * radius, b.z + vz * radius);
    // Quadratic Bezier through the corner: smooth enough for a 90° bend.
    for (let s = 0; s < 4; s++) {
      const t = s / 4;
      const x = (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * b.x + t * t * p2.x;
      const z = (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * b.z + t * t * p2.y;
      out.push([x, z, b.y]);
    }
  }
  // Finish the first edge up to (but not including) its midpoint.
  {
    const a = P[0];
    const b = P[1];
    const abl = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / abl;
    const uz = (b.z - a.z) / abl;
    const t0 = radius;
    const t1 = abl / 2;
    const segs = Math.max(1, Math.round((t1 - t0) / step));
    for (let s = 0; s < segs; s++) {
      const t = t0 + ((t1 - t0) * s) / segs;
      out.push([a.x + ux * t, a.z + uz * t, a.y + (b.y - a.y) * (t / abl)]);
    }
  }
  return out;
}

// Pick a colour from stops by a 0..1 value.
export function ramp(c, stops, t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [ta, ca] = stops[i];
    const [tb, cb] = stops[i + 1];
    if (t <= tb) {
      const k = (t - ta) / (tb - ta || 1);
      c.setHex(ca);
      const r = c.r; const g = c.g; const b = c.b;
      c.setHex(cb);
      c.setRGB(r + (c.r - r) * k, g + (c.g - g) * k, b + (c.b - b) * k);
      return c;
    }
  }
  return c.setHex(stops[stops.length - 1][1]);
}

export function mixHex(c, a, b, t) {
  c.setHex(a);
  const r = c.r; const g = c.g; const bl = c.b;
  c.setHex(b);
  t = Math.min(1, Math.max(0, t));
  return c.setRGB(r + (c.r - r) * t, g + (c.g - g) * t, bl + (c.b - bl) * t);
}

export function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts });
}

// Place a landmark object on the ground at (x, z).
export function plant(obj, ctx, x, z, yaw = 0, sink = 0) {
  obj.position.set(x, ctx.heightFn(x, z) - sink, z);
  obj.rotation.y = yaw;
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = ctx.quality.shadows;
      o.receiveShadow = true;
    }
  });
  return obj;
}

// Register an axis-aligned solid block standing on the ground at (x, z).
export function solid(ctx, x, z, hx, hz, height, y0) {
  const y = y0 ?? ctx.heightFn(x, z);
  ctx.collide(ctx.box(x - hx, y - 1, z - hz, x + hx, y + height, z + hz));
}
