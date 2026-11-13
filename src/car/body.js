// Procedural Roadster body.
//
// The whole car skin is described by one function, bodyPoint(z, θ):
//   z  runs along the car (rear -2.165 m → nose +2.15 m, +Z is forward)
//   θ  walks around a cross-section from the bottom centre (-π/2) up the
//      right-hand side to the top centre (+π/2).
// Each cross-section is a superellipse whose width, height, "shoulder" line
// and boxiness come from smooth keyframe curves. Lofting those sections gives
// a seamless, curvy body; wheel arches, the cockpit tub, intakes and trim are
// carved afterwards by nudging vertices and painting vertex colours.

import * as THREE from 'three';
import { curve, clamp, lerp, smoothstep, spow } from './curves.js';

// A shape is described by a spec of keyframe curves; createShape() turns it
// into the functions and geometry builders below. CLASSIC is the original
// Roadster; other models (see rocket.js) supply their own spec.

const DIM_CLASSIC = {
  length: 4.32,
  width: 2.0,
  height: 1.17,
  wheelbase: 2.53,
  front: { z: 1.27, x: 0.80, r: 0.352, w: 0.245 }, // 245/35 R21
  rear: { z: -1.26, x: 0.80, r: 0.364, w: 0.300 }, // 305/30 R21-ish
};

export const CLASSIC = {
  DIM: DIM_CLASSIC,
  zRear: -2.10, zFront: 2.10, zMin: -2.165, zMax: 2.15,
  top: [[-2.10, 0.72], [-2.0, 0.82], [-1.75, 0.86], [-1.26, 0.86], [-0.95, 0.85],
    [-0.6, 0.80], [0.0, 0.78], [0.5, 0.79], [0.9, 0.80], [1.27, 0.79], [1.6, 0.72], [1.85, 0.63],
    [2.0, 0.53], [2.10, 0.42]],
  bottom: [[-2.10, 0.28], [-1.9, 0.17], [-1.6, 0.13], [1.6, 0.13], [1.95, 0.17], [2.10, 0.24]],
  half: [[-2.10, 0.80], [-2.0, 0.90], [-1.8, 0.96], [-1.26, 1.00], [-0.8, 0.96],
    [-0.3, 0.925], [0.3, 0.925], [0.8, 0.95], [1.27, 0.975], [1.7, 0.93], [1.95, 0.85], [2.10, 0.70]],
  shoulder: [[-2.1, 0.5], [-1.26, 0.58], [0, 0.55], [1.27, 0.58], [2.1, 0.5]],
  nUpper: [[-2.1, 4], [-1.26, 4.5], [0, 3.5], [1.27, 4.5], [2.1, 3]],
  nLower: 5,
  // Raised, muscular fenders over each axle (adds height off-centre).
  bulge: [[-2.1, 0], [-1.95, 0.03], [-1.26, 0.075], [-0.55, 0], [0.55, 0],
    [1.27, 0.08], [1.9, 0.03], [2.1, 0]],
  // The rounded nose and tail: sections shrink toward their centre past the ends.
  capFront: [[2.10, 1], [2.12, 0.92], [2.135, 0.7], [2.145, 0.35], [2.15, 0]],
  capRear: [[-2.165, 0], [-2.16, 0.4], [-2.15, 0.75], [-2.13, 0.93], [-2.10, 1]],
  cockpit: { z0: -0.66, z1: 0.46, halfW: 0.64, floor: 0.42 },
  cabTop: [[-1.18, 0], [-0.95, 0.10], [-0.6, 0.27], [-0.3, 0.33], [-0.05, 0.32],
    [0.2, 0.25], [0.5, 0.11], [0.78, 0]],
  cabHalf: [[-1.18, 0.56], [-0.6, 0.69], [0.2, 0.70], [0.78, 0.66]],
  cabN: 3.2,
  roof: [-0.62, 0.02],         // targa panel z range, or null
  frame: [0.6, -1.0, 0.76],    // window frame line: u, z0, z1
  headlamp: { z0: 1.70, z1: 2.07, th0: 0.32, th1: 1.0, hw: 0.055 },
  tail: { y: 0.655, zSide: -1.93 },
  spoiler: [-2.03, -1.83],
  shut: [[0.50, -0.5, 0.62], [-0.45, -0.5, 0.75], [1.62, 0.85, Math.PI / 2]],
  fins: true,
  /** Extra surface detail: returns [x offset, colour] for a skin vertex. */
  decorate(z, th, c) {
    let dx = 0;
    // Side air scoop behind the door.
    const scoop = smoothstep(-0.80, -0.74, z) * smoothstep(-0.48, -0.56, z)
      * smoothstep(-0.18, -0.08, th) * smoothstep(0.42, 0.3, th);
    if (scoop > 0) { dx -= 0.03 * scoop; c = Math.min(c, lerp(C_PAINT, C_TRIM, scoop)); }
    // Carbon side skirt between the wheels.
    const skirt = smoothstep(-0.95, -0.6, th) * smoothstep(-0.48, -0.58, th)
      * smoothstep(-0.86, -0.8, z) * smoothstep(0.86, 0.8, z);
    c = Math.min(c, lerp(C_PAINT, C_TRIM, skirt));
    // Front intake and rear diffuser.
    const intake = smoothstep(1.95, 2.0, z) * smoothstep(-0.75, -0.65, th) * smoothstep(0.1, 0.0, th);
    c = Math.min(c, lerp(C_PAINT, C_TRIM, intake));
    const diff = smoothstep(-1.93, -1.99, z) * smoothstep(-0.05, -0.15, th);
    c = Math.min(c, lerp(C_PAINT, C_TRIM, diff));
    return [dx, c];
  },
};

export const C_PAINT = 1, C_TRIM = 0.035, C_INNER = 0.012;
export const WELL_X = 0.62;

/** Mirrors a right-side geometry to the left, keeping faces outward. */
export function mirrorX(g) {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const idx = m.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  m.index.needsUpdate = true;
  m.computeVertexNormals();
  return m;
}

/** Builds the shape functions and geometry builders for one body spec. */
export function createShape(S) {
  const DIM = S.DIM;
  const Z_REAR = S.zRear, Z_FRONT = S.zFront, Z_MIN = S.zMin, Z_MAX = S.zMax;
  const top = curve(S.top), bottom = curve(S.bottom), half = curve(S.half);
  const shoulder = curve(S.shoulder), nUpper = curve(S.nUpper), bulge = curve(S.bulge);
  const N_LOWER = S.nLower;
  const capFront = curve(S.capFront), capRear = curve(S.capRear);
  const endScale = (z) => (z > Z_FRONT ? capFront(z) : z < Z_REAR ? capRear(z) : 1);

  /** Undeformed skin point on the right side (x ≥ 0). Returns [x, y, cy]. */
  function bodyPoint(z, th) {
    const zc = clamp(z, Z_REAR, Z_FRONT);
    const w = half(zc), y0 = bottom(zc), y1 = top(zc);
    const cy = y0 + (y1 - y0) * shoulder(zc);
    const c = Math.max(0, Math.cos(th)), s = Math.sin(th);
    let x, y;
    if (s >= 0) {
      const p = 2 / nUpper(zc);
      x = w * Math.pow(c, p);
      y = cy + (y1 - cy) * spow(s, p);
      const xf = x / w;
      y += bulge(zc) * Math.exp(-(((xf - 0.82) / 0.2) ** 2)) * smoothstep(0.15, 0.7, s);
    } else {
      const p = 2 / N_LOWER;
      x = w * Math.pow(c, p);
      y = cy + (cy - y0) * spow(s, p);
    }
    const sc = endScale(z);
    return [x * sc, cy + (y - cy) * sc, cy];
  }

  /** Outward unit normal (in the section plane) at (z, θ), right side. */
  function sectionNormal(z, th) {
    const e = 1e-3;
    const a = bodyPoint(z, th - e), b = bodyPoint(z, th + e);
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [ty / l, -tx / l];
  }

  /** Skin point pushed `off` metres outward. */
  function surf(z, th, off = 0) {
    const p = bodyPoint(z, th);
    const n = sectionNormal(z, th);
    return new THREE.Vector3(p[0] + n[0] * off, p[1] + n[1] * off, z);
  }

  // Highest skin height at a given x (used to seat the glasshouse on the body).
  function bodyTopAt(z, x) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i <= 120; i++) {
      const th = (i / 120) * (Math.PI / 2);
      const p = bodyPoint(z, th);
      const d = Math.abs(p[0] - x);
      if (d < bestD) { bestD = d; best = p[1]; }
    }
    return best;
  }

  // --------------------------------------------------------------- stations
  function stations(n, capDensity) {
    const zs = [];
    // Dense rings across the end caps (they curve fast).
    const rear = [0, 0.05, 0.12, 0.23, 0.38, 0.57, 0.77].map((t) => lerp(Z_MIN, Z_REAR, t));
    const front = [0.2, 0.43, 0.6, 0.74, 0.88, 1].map((t) => lerp(Z_FRONT, Z_MAX, t));
    const pick = (arr) => (capDensity ? arr : arr.filter((_, i) => i % 2 === 0 || i === arr.length - 1));
    zs.push(...pick(rear));
    for (let i = 0; i <= n; i++) {
      // Slight easing so the curvy ends get more rings than the flat middle.
      const t = i / n;
      const e = t - Math.sin(t * Math.PI * 2) * 0.06;
      zs.push(lerp(Z_REAR, Z_FRONT, e));
    }
    zs.push(...pick(front));
    if (!capDensity) zs.unshift(Z_MIN);
    return [...new Set(zs.map((z) => +z.toFixed(5)))].sort((a, b) => a - b);
  }

  /**
   * θ samples spaced evenly by arc length around a section (blended with
   * uniform θ), so the near-vertical sides get as many vertices as the curves.
   */
  function evenThetas(z, segs) {
    const N = 240;
    const th = [], len = [0];
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const t = -Math.PI / 2 + (i / N) * Math.PI;
      const p = bodyPoint(z, t);
      th.push(t);
      if (prev) len.push(len[len.length - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
      prev = p;
    }
    const total = len[N] || 1;
    const out = [];
    let k = 0;
    for (let j = 0; j <= segs; j++) {
      const target = (j / segs) * total;
      while (k < N - 1 && len[k + 1] < target) k++;
      const f = (target - len[k]) / ((len[k + 1] - len[k]) || 1);
      const byLength = lerp(th[k], th[k + 1], clamp(f, 0, 1));
      out.push(lerp(byLength, -Math.PI / 2 + (j / segs) * Math.PI, 0.25));
    }
    return out;
  }

  // ---------------------------------------------------------- the body mesh
  const COCKPIT = S.cockpit;

  /**
   * Builds the painted shell. Vertex colours mark which parts take the paint
   * (white) and which are gloss-black trim, intakes, wheel wells and cockpit.
   */
  function buildBodyGeometry({ rings = 130, segs = 40, details = true } = {}) {
    const zs = stations(rings, details);
    const ring = 2 * segs;
    const pos = new Float32Array(zs.length * ring * 3);
    const col = new Float32Array(zs.length * ring * 3);
    const axles = [DIM.front, DIM.rear].map((a) => ({ z: a.z, y: a.r, R: a.r + 0.045 }));
    const cuts = new Float32Array(zs.length * ring);

    let k = 0;
    for (const zRing of zs) {
      const thetas = evenThetas(zRing, segs);
      for (let j = 0; j < ring; j++) {
        let z = zRing;
        const jj = j <= segs ? j : ring - j; // mirror index for the left side
        const th = thetas[jj];
        const side = j <= segs ? 1 : -1;
        let [x, y] = bodyPoint(z, th);
        const s = Math.sin(th);
        let c = C_PAINT;

        // Wheel arches: pull the side skin in to form a dark wheel well, and
        // roll a small lip just outside the opening.
        // Wheel arches are cut in the fragment shader: store a signed distance
        // to the opening (negative = inside). Linear interpolation of a smooth
        // distance across triangles traces a clean circle at any mesh density.
        let cut = 1;
        for (const a of axles) {
          const dz = z - a.z, dy = y - a.y;
          const dd = dy < 0 ? Math.abs(dz) : Math.hypot(dz, dy);
          cut = Math.min(cut, Math.max(dd - a.R, WELL_X - x));
        }
        cuts[k] = cut;

        // Open cockpit tub that the glass canopy sits over.
        if (s > 0.3) {
          const tz = smoothstep(COCKPIT.z0, COCKPIT.z0 + 0.1, z) * smoothstep(COCKPIT.z1, COCKPIT.z1 - 0.1, z);
          const tx = smoothstep(COCKPIT.halfW, COCKPIT.halfW - 0.05, x);
          const t = tz * tx;
          if (t > 0) {
            y = lerp(y, COCKPIT.floor, t);
            if (t > 0.15) c = Math.min(c, lerp(C_PAINT, C_INNER, Math.min(1, t * 1.6)));
          }
        }

        if (details && S.decorate) {
          const [dx, c2] = S.decorate(z, th, c);
          x += dx; c = c2;
        }
        // Underside is always dark.
        c = Math.min(c, lerp(C_PAINT, C_INNER, smoothstep(-1.05, -1.25, th)));

        pos[k * 3] = x * side; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = c;
        k++;
      }
    }

    const idx = [];
    for (let i = 0; i < zs.length - 1; i++) {
      for (let j = 0; j < ring; j++) {
        const a = i * ring + j, b = i * ring + ((j + 1) % ring);
        const c2 = (i + 1) * ring + j, d = (i + 1) * ring + ((j + 1) % ring);
        idx.push(a, b, c2, b, d, c2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('cut', new THREE.BufferAttribute(cuts, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // --------------------------------------------------------------- glasshouse
  const cabTop = curve(S.cabTop), cabHalf = curve(S.cabHalf);
  const CAB_N = S.cabN;
  const CAB_Z0 = S.cabTop[0][0], CAB_Z1 = S.cabTop[S.cabTop.length - 1][0];

  function cabinPoint(z, th, base, off = 0) {
    const w = cabHalf(z) + off * 0.6;
    const h = cabTop(z) + off;
    const c = Math.max(0, Math.cos(th)), s = Math.max(0, Math.sin(th));
    const p = 2 / CAB_N;
    return [w * Math.pow(c, p), base + h * Math.pow(s, p)];
  }

  /**
   * Generic loft over (z, θ) for the canopy. uFrom..1 of each half, joined over
   * the top so one call makes a symmetric strip.
   */
  function loftCabin(z0, z1, nz, u0, nu, off) {
    const zs = [];
    for (let i = 0; i <= nz; i++) zs.push(lerp(z0, z1, i / nz));
    const bases = zs.map((z) => bodyTopAt(z, cabHalf(z)) - 0.025);
    const row = 2 * nu + 1;
    const pos = [];
    for (let i = 0; i < zs.length; i++) {
      for (let j = 0; j < row; j++) {
        const side = j <= nu ? 1 : -1;
        const jj = j <= nu ? j : row - 1 - j;
        const u = lerp(u0, 1, jj / nu);
        const [x, y] = cabinPoint(zs[i], u * Math.PI / 2, bases[i], off);
        pos.push(x * side, y, zs[i]);
      }
    }
    const idx = [];
    for (let i = 0; i < zs.length - 1; i++) {
      for (let j = 0; j < row - 1; j++) {
        const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
        // Right half climbs (+y), left half descends; both wind outward.
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function buildCabin({ rings = 40, segs = 16 } = {}) {
    const glass = loftCabin(CAB_Z0, CAB_Z1, rings, 0, segs, 0);
    // Targa roof panel (gloss black) floats just above the glass.
    const roof = S.roof && loftCabin(S.roof[0], S.roof[1], Math.max(6, rings >> 2), 0.6, Math.max(4, segs >> 1), 0.006);
    return { glass, roof };
  }

  /** Points tracing the canopy surface at a fixed u, for window frames. */
  function cabinLine(u, z0, z1, n = 24, off = 0.004) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const z = lerp(z0, z1, i / n);
      const base = bodyTopAt(z, cabHalf(z)) - 0.025;
      const [x, y] = cabinPoint(z, u * Math.PI / 2, base, off);
      pts.push(new THREE.Vector3(x, y, z));
    }
    return pts;
  }

  // ------------------------------------------------------------- surface trim
  /**
   * Patch of skin between θa(z) and θb(z) for z in [z0, z1], lifted `off`
   * metres. Right side only; mirror with mirrorX().
   */
  function skinPatch(z0, z1, nz, thetaFn, nv, off) {
    const pos = [];
    for (let i = 0; i <= nz; i++) {
      const t = i / nz;
      const z = lerp(z0, z1, t);
      for (let j = 0; j <= nv; j++) {
        const th = thetaFn(t, j / nv);
        const p = surf(z, th, off);
        pos.push(p.x, p.y, p.z);
      }
    }
    const idx = [];
    const row = nv + 1;
    for (let i = 0; i < nz; i++) {
      for (let j = 0; j < nv; j++) {
        const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** Headlamp lens: a swept sliver on the front corner. */
  function headlampGeometry(nz = 16, nv = 4, grow = 0) {
    const H = S.headlamp;
    return skinPatch(H.z0, H.z1, nz, (t, v) => {
      const c = lerp(H.th0, H.th1, t);
      const hw = (H.hw + grow) * Math.sin(Math.PI * clamp(t * 1.15 + 0.02, 0, 1)) + grow * 0.5;
      return c + (v * 2 - 1) * hw;
    }, nv, 0.003 + grow * 0.02);
  }

  /** Wraparound tail-light bar path: across the tail, then onto the haunches. */
  function tailLightPath(yT = S.tail.y, n = 24) {
    // Invert the rear cap scale → z (sampled).
    const zFor = (sc) => {
      let best = Z_REAR, bd = Infinity;
      for (let i = 0; i <= 200; i++) {
        const z = lerp(Z_MIN, Z_REAR, i / 200);
        const d = Math.abs(endScale(z) - sc);
        if (d < bd) { bd = d; best = z; }
      }
      return best;
    };
    const right = [];
    // Wrap onto the side first (front to back), then across the rear face.
    for (let i = 0; i <= 6; i++) {
      const z = lerp(S.tail.zSide, Z_REAR, i / 6);
      // Find θ on this section at height yT.
      let th = 0;
      for (let k = 0; k <= 200; k++) { th = (k / 200) * (Math.PI / 2); if (bodyPoint(z, th)[1] >= yT) break; }
      const p = surf(z, th, -0.004);
      right.push(p);
    }
    const zr = Z_REAR + 0.0001;
    for (let i = 1; i <= n; i++) {
      const th = lerp(0.35, Math.PI / 2, i / n);
      const [x, y, cy] = bodyPoint(zr, th);
      if (y - cy < 1e-3) continue;
      const sc = clamp((yT - cy) / (y - cy), 0, 1);
      const z = zFor(sc);
      const p = bodyPoint(z, th);
      if (sc > 0.985) continue;
      right.push(new THREE.Vector3(p[0], p[1], z - 0.004));
    }
    const left = right.slice().reverse().map((p) => new THREE.Vector3(-p.x, p.y, p.z));
    const pts = [...right, ...left.slice(1)];
    return pts;
  }

  /** Shut line (door / bonnet gap) on the skin at fixed z, θ0..θ1. */
  function shutLine(z, th0, th1, n = 20, off = 0.0015) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(surf(z, lerp(th0, th1, i / n), off));
    return pts;
  }

  /**
   * Path tracing a wheel-arch opening on the right side skin: up the front
   * edge, over the arch and down the rear edge. Used for the fender lip.
   */
  function archPath(axle, n = 28) {
    const R = axle.r + 0.045;
    const pts = [];
    const xAt = (z, y) => {
      let best = null, bd = Infinity;
      for (let k = 0; k <= 160; k++) {
        const th = -0.9 + (k / 160) * 1.8;
        const p = bodyPoint(z, th);
        const d = Math.abs(p[1] - y);
        if (d < bd) { bd = d; best = p[0]; }
      }
      return best;
    };
    const yLow = 0.2;
    const add = (z, y) => pts.push(new THREE.Vector3(xAt(z, y) + 0.004, y, z));
    for (let i = 0; i < 3; i++) add(axle.z + R, lerp(yLow, axle.r, i / 3));
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI;
      add(axle.z + Math.cos(a) * R, axle.r + Math.sin(a) * R);
    }
    for (let i = 1; i <= 3; i++) add(axle.z - R, lerp(axle.r, yLow, i / 3));
    return pts;
  }

  return {
    spec: S, DIM, COCKPIT, Z_MIN, Z_MAX, bodyPoint, bodyTopAt, surf, buildBodyGeometry, buildCabin,
    cabinLine, skinPatch, headlampGeometry, tailLightPath, shutLine, archPath,
  };
}

export const classicShape = createShape(CLASSIC);
