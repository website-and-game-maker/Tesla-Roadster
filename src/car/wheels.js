// Wheels: tire (lathed profile + tread normal map), multi-style rim face,
// barrel, polished lip, brake disc and caliper. Geometry is cached per
// (size, style, quality) so many cars share it.

import * as THREE from 'three';

const cache = new Map();
const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

const RIM_R = 0.267; // 21-inch wheel

const LEVEL = {
  high: { around: 72, curve: 10, profile: 3 },
  medium: { around: 40, curve: 6, profile: 2 },
  low: { around: 18, curve: 2, profile: 1 },
};

/** Tire: rounded-rectangle section spun around the axle (X axis). */
function tireGeometry(R, W, q) {
  return cached(`tire${R}${W}${q}`, () => {
    const L = LEVEL[q];
    const pts = [];
    const hw = W / 2, cr = 0.035; // shoulder radius
    pts.push(new THREE.Vector2(RIM_R, -hw * 0.86));
    pts.push(new THREE.Vector2(R - cr * 1.6, -hw * 0.99)); // sidewall
    const corner = (cx, cy, a0, a1) => {
      const n = 2 + L.profile * 2;
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        pts.push(new THREE.Vector2(cx + Math.cos(a) * cr, cy + Math.sin(a) * cr));
      }
    };
    corner(R - cr, -hw + cr, -Math.PI / 2, 0);
    for (let i = 1; i < 2 + L.profile * 2; i++) pts.push(new THREE.Vector2(R, -hw + cr + (W - 2 * cr) * (i / (2 + L.profile * 2))));
    corner(R - cr, hw - cr, 0, Math.PI / 2);
    pts.push(new THREE.Vector2(R - cr * 1.6, hw * 0.99));
    pts.push(new THREE.Vector2(RIM_R, hw * 0.86));
    const g = new THREE.LatheGeometry(pts, L.around);
    // Lathe UVs: u wraps around the tire, v runs across the profile, which
    // matches the tread map (grooves along u, sipes across v).
    g.rotateZ(-Math.PI / 2); // lathe axis Y → X
    return g;
  });
}

/** Annular sector hole for a rim face (optionally swept for a turbine look). */
function sectorHole(r0, r1, a0, a1, skew, n) {
  const p = new THREE.Path();
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n) + skew;
    const v = [Math.cos(a) * r1, Math.sin(a) * r1];
    i === 0 ? p.moveTo(...v) : p.lineTo(...v);
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / n);
    p.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
  }
  p.closePath();
  return p;
}

const STYLES = {
  aero: { n: 5, r0: 0.128, r1: 0.214, gap: 0.42, skew: 0.38 },
  sport: { n: 10, r0: 0.082, r1: 0.226, gap: 0.6, skew: 0.0 },
  blade: { n: 14, r0: 0.09, r1: 0.226, gap: 0.5, skew: 0.5 },
};

/** Rim face: disc with spoke gaps, extruded + bevelled, facing +X. */
function rimFaceGeometry(style, q) {
  return cached(`face${style}${q}`, () => {
    const S = STYLES[style] || STYLES.sport;
    const L = LEVEL[q];
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 0.247, 0, Math.PI * 2, false);
    if (q !== 'low') {
      const step = (Math.PI * 2) / S.n;
      for (let i = 0; i < S.n; i++) {
        const c = i * step;
        shape.holes.push(sectorHole(S.r0, S.r1, c - step * S.gap / 2, c + step * S.gap / 2, S.skew, L.curve + 2));
      }
    }
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.018, bevelEnabled: q !== 'low', bevelThickness: 0.008, bevelSize: 0.006,
      bevelSegments: q === 'high' ? 3 : 1, curveSegments: L.curve * 4,
    });
    g.rotateY(Math.PI / 2); // extrude +Z → +X
    return g;
  });
}

function barrelGeometry(W, q) {
  return cached(`barrel${W}${q}`, () => {
    const g = new THREE.CylinderGeometry(0.255, 0.255, W * 0.88, LEVEL[q].around, 1, true);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

function discGeometry(q) {
  return cached(`disc${q}`, () => {
    const g = new THREE.CylinderGeometry(0.195, 0.195, 0.032, LEVEL[q].around);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

function caliperGeometry(q) {
  return cached(`caliper${q}`, () => {
    const g = new THREE.TorusGeometry(0.175, 0.03, 6, q === 'high' ? 12 : 6, 0.85);
    g.scale(1, 1, 1.5);
    g.rotateY(Math.PI / 2); // ring around the X axis
    return g;
  });
}

function lipGeometry(q) {
  return cached(`lip${q}`, () => {
    const g = new THREE.TorusGeometry(0.256, 0.0075, 6, LEVEL[q].around);
    g.rotateY(Math.PI / 2);
    return g;
  });
}

function capGeometry(q) {
  return cached(`cap${q}`, () => {
    const g = new THREE.CylinderGeometry(0.045, 0.05, 0.02, q === 'high' ? 24 : 10);
    g.rotateZ(-Math.PI / 2);
    return g;
  });
}

/**
 * One wheel. Hierarchy: pivot (steers around Y) → mount (faces outward)
 * → spin (rolls around X). Calipers sit on the mount so they don't spin.
 */
export function buildWheel(axle, side, wheelSpec, mats, q) {
  const { r: R, w: W } = axle;
  const pivot = new THREE.Group();
  pivot.position.set(axle.x * side, R, axle.z);
  const mount = new THREE.Group();
  if (side < 0) mount.rotation.y = Math.PI;
  pivot.add(mount);
  const spin = new THREE.Group();
  mount.add(spin);

  const tire = new THREE.Mesh(tireGeometry(R, W, q), mats.tire);
  spin.add(tire);
  if (q !== 'low') {
    spin.add(new THREE.Mesh(barrelGeometry(W, q), mats.barrel));
    const lip = new THREE.Mesh(lipGeometry(q), mats.chrome);
    lip.position.x = W / 2 - 0.022;
    spin.add(lip);
    const disc = new THREE.Mesh(discGeometry(q), mats.disc);
    disc.position.x = -0.03;
    spin.add(disc);
    const caliper = new THREE.Mesh(caliperGeometry(q), mats.caliper);
    caliper.position.x = 0.012;
    caliper.rotation.x = Math.PI * 0.55; // sits behind the axle, upper rear
    mount.add(caliper);
  }
  const face = new THREE.Group();
  face.name = 'rimFace';
  spin.add(face);
  setRimStyle({ face }, wheelSpec, mats, q, W);

  for (const o of [tire, ...spin.children]) { o.castShadow = true; }
  return { pivot, spin, face, sign: side, R, W, steer: axle.z > 0 };
}

/** Swaps the rim face to another style (finish comes from mats.rim). */
export function setRimStyle(wheel, wheelSpec, mats, q, W = wheel.W) {
  const face = wheel.face;
  face.clear();
  const m = new THREE.Mesh(rimFaceGeometry(wheelSpec.style, q), mats.rim);
  m.position.x = W / 2 - 0.05;
  m.castShadow = true;
  face.add(m);
  if (q !== 'low') {
    const cap = new THREE.Mesh(capGeometry(q), mats.gloss);
    cap.position.x = W / 2 - 0.02;
    face.add(cap);
  }
}
