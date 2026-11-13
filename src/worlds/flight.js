// Flight courses: a closed 3D path through the air, rings along it, and the
// solid things the car can fly into (colliders).
//
// Paths are either written by hand (sky worlds) or generated from a ground
// world's road: the course follows the road at a varying height and weave,
// with "keys" that force dives (under arches, along streets) or climbs.
// A fix-up pass then lifts any part of the path that would clip the terrain
// or a solid prop, so every ring is always reachable.
import * as THREE from 'three';
import { clamp } from './noise.js';

const Z = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------- colliders

// Uniform grid over colliders for fast "what is near me" queries.
export function buildColliderIndex(colliders, cell = 48) {
  const grid = new Map();
  const key = (i, j) => i * 92821 + j;
  colliders.forEach((c, n) => {
    const [x0, z0, x1, z1] = c.type === 'box'
      ? [c.min.x, c.min.z, c.max.x, c.max.z]
      : [c.center.x - c.radius, c.center.z - c.radius, c.center.x + c.radius, c.center.z + c.radius];
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) {
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(n);
      }
    }
  });
  const seen = new Uint32Array(colliders.length);
  let stamp = 0;
  return {
    list: colliders,
    // Colliders whose footprint comes within r metres of (x, z).
    query(x, z, r = 0, out = []) {
      out.length = 0;
      stamp++;
      for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) {
        for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) {
          const l = grid.get(key(i, j));
          if (!l) continue;
          for (const n of l) {
            if (seen[n] === stamp) continue;
            seen[n] = stamp;
            out.push(colliders[n]);
          }
        }
      }
      return out;
    },
  };
}

// Distance from point p to a collider's surface (negative inside).
export function colliderDistance(c, x, y, z) {
  if (c.type === 'sphere') {
    return Math.hypot(x - c.center.x, y - c.center.y, z - c.center.z) - c.radius;
  }
  const dx = Math.max(c.min.x - x, 0, x - c.max.x);
  const dy = Math.max(c.min.y - y, 0, y - c.max.y);
  const dz = Math.max(c.min.z - z, 0, z - c.max.z);
  const out = Math.hypot(dx, dy, dz);
  if (out > 0) return out;
  // Inside: negative distance to the nearest face.
  return -Math.min(x - c.min.x, c.max.x - x, y - c.min.y, c.max.y - y, z - c.min.z, c.max.z - z);
}

// ---------------------------------------------------------------- path

function keyWeight(u, key) {
  let d = Math.abs(u - key.u);
  d = Math.min(d, 1 - d);
  return Math.exp(-((d / (key.width ?? 0.03)) ** 2));
}

// Control points [x, z, y] from a ground world's road.
function pathFromTrack(track, f) {
  const n = Math.max(24, Math.round(track.length / (f.step ?? 45)));
  const base = f.altitude ?? 30;
  const amp = f.swing ?? 20;
  const waves = f.waves ?? 3;
  const weave = f.weave ?? track.roadHalfWidth * 0.6;
  const weaveN = f.weaveWaves ?? 5;
  const pts = [];
  for (let k = 0; k < n; k++) {
    const u = k / n;
    const i = Math.floor(u * track.count) % track.count;
    let alt = base + amp * 0.5 * (1 - Math.cos(Math.PI * 2 * waves * u)) + (f.dive ?? 0) * Math.sin(Math.PI * 2 * (waves * 2 + 1) * u) ** 8 * -1;
    let lat = weave * Math.sin(Math.PI * 2 * weaveN * u);
    for (const key of f.keys || []) {
      const w = keyWeight(u, key);
      if (key.alt !== undefined) alt = alt * (1 - w) + key.alt * w;
      if (key.lat !== undefined) lat = lat * (1 - w) + key.lat * w;
    }
    // Ease into the start: take off from the start line.
    const takeoff = Math.min(1, u * n / 2);
    alt = (f.startAlt ?? 6) + (alt - (f.startAlt ?? 6)) * takeoff;
    pts.push([
      track.pos[i * 3] + track.right[i * 3] * lat,
      track.pos[i * 3 + 2] + track.right[i * 3 + 2] * lat,
      track.pos[i * 3 + 1] + alt,
      u,
    ]);
  }
  return pts;
}

// ---------------------------------------------------------------- course

export function buildFlightCourse(def, { track, groundAt, colliderIndex, gates = [] }) {
  const f = def.flight || {};
  const R = f.ringRadius ?? 9;
  const ceiling = f.ceiling ?? 450;
  const clearance = f.clearance ?? 4; // metres between ring edge and anything solid
  const generated = !f.points;
  const raw = generated ? pathFromTrack(track, f) : f.points.map(([x, z, y], k, a) => [x, z, y, k / a.length]);
  const ringR = (u) => {
    let r = R;
    for (const key of f.keys || []) if (key.radius && keyWeight(u, key) > 0.5) r = key.radius;
    return r;
  };
  const tmp = [];

  // How far up must a point at (x, y, z) move so a ring of radius r fits?
  function lift(x, y, z, r) {
    let need = 0;
    // Ground, checked under the whole ring footprint.
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      need = Math.max(need, groundAt(x + ox, z + oz) + r + clearance - y);
    }
    for (const c of colliderIndex.query(x, z, r + clearance + 2, tmp)) {
      const d = colliderDistance(c, x, y + need, z);
      if (d < r + clearance) {
        const top = c.type === 'box' ? c.max.y : c.center.y + c.radius;
        need = Math.max(need, top + r + clearance - y);
      }
    }
    return need;
  }

  const pts = raw.map(([x, z, y]) => new THREE.Vector3(x, y, z));
  const us = raw.map((p) => p[3]);
  // Pass 1: lift control points.
  pts.forEach((p, k) => { p.y += lift(p.x, p.y, p.z, ringR(us[k])); });
  let curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  // Pass 2: the spline bulges between control points, so check it densely
  // and lift the nearest control point wherever it dips into something.
  for (let iter = 0; iter < 5; iter++) {
    const L = curve.getLength();
    const steps = Math.ceil(L / 4);
    let fixed = 0;
    const p = new THREE.Vector3();
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      curve.getPointAt(t, p);
      const need = lift(p.x, p.y, p.z, ringR(t) * 0.8);
      if (need > 0.05) {
        // Raise the two control points around this spot.
        const ct = curve.getUtoTmapping(t) * pts.length;
        const a = Math.floor(ct) % pts.length;
        const b = (a + 1) % pts.length;
        pts[a].y += need + 0.5;
        pts[b].y += need + 0.5;
        fixed++;
      }
    }
    curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    if (!fixed) break;
  }
  for (const p of pts) p.y = Math.min(p.y, ceiling - R - 10);
  curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const length = curve.getLength();

  // Gates: landmarks (arches, bridges, overhanging islands) ask for a ring
  // at the point of the course nearest to them.
  const gateDist = [];
  if (gates.length) {
    const n = Math.ceil(length / 2);
    const q = new THREE.Vector3();
    for (const gt of gates) {
      let best = Infinity;
      let bd = 0;
      for (let s = 0; s < n; s++) {
        curve.getPointAt(s / n, q);
        const dd = (q.x - gt.x) ** 2 + (q.z - gt.z) ** 2 + (gt.y === undefined ? 0 : (q.y - gt.y) ** 2);
        if (dd < best) { best = dd; bd = (s / n) * length; }
      }
      if (bd > 30 && bd < length - 30) gateDist.push({ d: bd, r: gt.radius });
    }
    gateDist.sort((a, b) => a.d - b.d);
  }

  // Rings: closer together where the path twists, further apart on straights.
  const rings = [];
  const tan = new THREE.Vector3();
  const tan2 = new THREE.Vector3();
  let d = f.firstRing ?? 60;
  let gi = 0;
  while (d < length - 50 || gi < gateDist.length) {
    // A gate comes first if it is before (or close after) the next regular ring.
    let forcedR = null;
    if (gi < gateDist.length && gateDist[gi].d < d + 30) {
      d = gateDist[gi].d;
      forcedR = gateDist[gi++].r ?? null;
    } else if (d >= length - 50) break;
    const t = d / length;
    const pos = curve.getPointAt(t);
    curve.getTangentAt(t, tan);
    curve.getTangentAt(Math.min(1, (d + 100) / length), tan2);
    const twist = tan.angleTo(tan2);
    const r = forcedR ?? ringR(t);
    rings.push({
      index: rings.length,
      position: pos,
      quaternion: new THREE.Quaternion().setFromUnitVectors(Z, tan.clone()),
      normal: tan.clone(),
      radius: r,
      t,
      distance: d,
    });
    d += 140 - 60 * clamp(twist / 1.1, 0, 1);
    // Keep regular rings from crowding a gate just ahead.
    if (gi < gateDist.length && gateDist[gi].d - d < 30 && gateDist[gi].d > d) d = gateDist[gi].d;
  }

  const start = curve.getPointAt(0);
  curve.getTangentAt(0, tan);
  const spawn = { position: start.clone().addScaledVector(tan, -25), heading: Math.atan2(tan.x, tan.z), pitch: Math.asin(clamp(tan.y, -1, 1)) };
  spawn.position.y = Math.max(spawn.position.y, groundAt(spawn.position.x, spawn.position.z) + 3);

  return { curve, length, rings, ceiling, spawn, laps: f.laps ?? 2, goldSpeed: f.goldSpeed ?? 70 };
}

// ---------------------------------------------------------------- visuals

export const RING_COLORS = {
  idle: new THREE.Color(0x3fd3ff),
  next: new THREE.Color(0xffc21a),
  passed: new THREE.Color(0x24303a),
  start: new THREE.Color(0xff2a4a),
};

export function buildRingObject(course, quality) {
  const seg = quality.textureSize >= 1024 ? 64 : 32;
  const geo = new THREE.TorusGeometry(1, 0.075, 10, seg);
  // Unlit and not tone-mapped so the ring colours stay vivid in any light.
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const n = course.rings.length;
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = 'rings';
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const s = new THREE.Vector3();
  const states = new Array(n).fill('idle');
  const write = (i, pulse = 1) => {
    const r = course.rings[i];
    s.setScalar(r.radius * pulse);
    m.compose(r.position, r.quaternion, s);
    mesh.setMatrixAt(i, m);
  };
  for (let i = 0; i < n; i++) {
    write(i);
    mesh.setColorAt(i, i === 0 ? RING_COLORS.start : RING_COLORS.idle);
  }
  let next = -1;
  return {
    mesh,
    states,
    setState(i, state) {
      if (i < 0 || i >= n || states[i] === state) return;
      states[i] = state;
      mesh.setColorAt(i, RING_COLORS[state] || RING_COLORS.idle);
      mesh.instanceColor.needsUpdate = true;
      if (state !== 'next') { write(i); mesh.instanceMatrix.needsUpdate = true; }
    },
    // Mark rings before i passed, i next, the rest idle.
    setNext(i) {
      next = i;
      for (let k = 0; k < n; k++) this.setState(k, k < i ? 'passed' : k === i ? 'next' : 'idle');
    },
    reset() { this.setNext(0); },
    update(t) {
      if (next < 0 || next >= n) return;
      write(next, 1 + Math.sin(t * 6) * 0.06);
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// Did a car moving from a to b pass through ring r this frame?
export function crossedRing(r, a, b) {
  const da = (a.x - r.position.x) * r.normal.x + (a.y - r.position.y) * r.normal.y + (a.z - r.position.z) * r.normal.z;
  const db = (b.x - r.position.x) * r.normal.x + (b.y - r.position.y) * r.normal.y + (b.z - r.position.z) * r.normal.z;
  if (da > 0 || db < 0) return false;
  const k = da / (da - db);
  const x = a.x + (b.x - a.x) * k - r.position.x;
  const y = a.y + (b.y - a.y) * k - r.position.y;
  const z = a.z + (b.z - a.z) * k - r.position.z;
  return x * x + y * y + z * z <= r.radius * r.radius;
}
