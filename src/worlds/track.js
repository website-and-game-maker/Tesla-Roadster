// Track builder. A world describes its circuit as a closed loop of control
// points; this module turns that into:
//   - the centre-line curve (t = 0 is the start/finish line, increasing t is
//     the driving direction),
//   - evenly spaced samples (every ~2 m) with position, forward and right
//     vectors, used by physics, AI, minimap and progress,
//   - road, shoulder, kerb and barrier meshes,
//   - fast "where am I on the track" lookups.
import * as THREE from 'three';
import { roadTexture, roadRoughness, kerbTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const SAMPLE_SPACING = 2; // metres
const HASH_CELL = 24;     // metres per spatial-hash cell

export function buildTrackData(def) {
  const pts = def.points.map(([x, z, y = 0]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const length = curve.getLength();
  const count = Math.max(64, Math.round(length / SAMPLE_SPACING));
  const spacing = length / count;

  const pos = new Float32Array(count * 3);
  const fwd = new Float32Array(count * 3);
  const right = new Float32Array(count * 3);
  const curvature = new Float32Array(count);
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    curve.getPointAt(i / count, p);
    curve.getTangentAt(i / count, t);
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    fwd[i * 3] = t.x; fwd[i * 3 + 1] = t.y; fwd[i * 3 + 2] = t.z;
    // right = forward x up, flattened to the ground plane.
    const rl = Math.hypot(t.x, t.z) || 1;
    right[i * 3] = -t.z / rl; right[i * 3 + 1] = 0; right[i * 3 + 2] = t.x / rl;
  }
  // Gaps (open air to jump) and ramps (kickers) for hop races.
  // { at: 0..1 along the lap (gap centre / ramp lip), length: m, height: m }
  const gap = new Uint8Array(count);
  const length0 = length;
  for (const gp of def.gaps || []) {
    const c = gp.at * length0;
    for (let i = 0; i < count; i++) {
      let d = i * spacing - c;
      if (d > length0 / 2) d -= length0;
      if (d < -length0 / 2) d += length0;
      if (Math.abs(d) <= gp.length / 2) gap[i] = 1;
    }
  }
  // A gap can carry its own take-off ramp, ending right at the gap's edge.
  const ramps = [...(def.ramps || [])];
  for (const gp of def.gaps || []) {
    if (gp.ramp) ramps.push({ at: gp.at - (gp.length / 2 + spacing) / length0, ...gp.ramp });
  }
  for (const rp of ramps) {
    // The lip is at `at`, or right at the start of the gap the ramp leads into.
    const lip = rp.at * length0;
    for (let i = 0; i < count; i++) {
      let d = lip - i * spacing;
      if (d > length0 / 2) d -= length0;
      if (d < -length0 / 2) d += length0;
      if (d >= 0 && d <= rp.length) {
        const k = 1 - d / rp.length;
        pos[i * 3 + 1] += rp.height * k * k * (3 - 2 * k);
      }
    }
  }
  // Signed curvature (1/radius), positive when the road bends right.
  for (let i = 0; i < count; i++) {
    const a = (i - 2 + count) % count;
    const b = (i + 2) % count;
    const ha = Math.atan2(fwd[a * 3], fwd[a * 3 + 2]);
    const hb = Math.atan2(fwd[b * 3], fwd[b * 3 + 2]);
    let d = hb - ha;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    curvature[i] = -d / (4 * spacing);
  }

  // Spatial hash of samples for nearest-point queries.
  const hash = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(pos[i * 3] / HASH_CELL);
    const cz = Math.floor(pos[i * 3 + 2] / HASH_CELL);
    const k = key(cx, cz);
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(i);
  }

  const roadHalfWidth = def.roadWidth / 2;
  const wallHalfWidth = roadHalfWidth + (def.runoff ?? 4);

  // Bounding box of the circuit.
  const box = new THREE.Box3();
  for (let i = 0; i < count; i++) box.expandByPoint(p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));

  const data = {
    curve, length, count, spacing, pos, fwd, right, curvature,
    roadHalfWidth, wallHalfWidth, box,
    kerbs: new Uint8Array(count),
    gap,
  };

  // Kerbs where the corner is tight enough to matter.
  if (def.kerbs !== false) {
    for (let i = 0; i < count; i++) {
      if (Math.abs(curvature[i]) > 1 / 140) {
        for (let k = -6; k <= 6; k++) data.kerbs[(i + k + count) % count] = 1;
      }
    }
  }

  // Find the nearest sample index to (x, z). `hint` speeds up the common
  // case of a car that was near sample `hint` last frame.
  data.nearestIndex = (x, z, hint = -1) => {
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let k = -12; k <= 12; k++) {
        const i = (hint + k + count) % count;
        const dx = pos[i * 3] - x;
        const dz = pos[i * 3 + 2] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD < (wallHalfWidth + 6) ** 2) return best;
    }
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    for (let r = 1; r <= 3; r++) {
      for (let a = -r; a <= r; a++) {
        for (let b = -r; b <= r; b++) {
          const list = hash.get(key(cx + a, cz + b));
          if (!list) continue;
          for (const i of list) {
            const dx = pos[i * 3] - x;
            const dz = pos[i * 3 + 2] - z;
            const d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      // A ring of radius r is guaranteed to contain the nearest sample only
      // if that sample is closer than r cells.
      if (best >= 0 && Math.sqrt(bestD) <= r * HASH_CELL) return best;
    }
    // Far from the track: coarse scan of every 8th sample, then refine.
    for (let i = 0; i < count; i += 8) {
      const dx = pos[i * 3] - x;
      const dz = pos[i * 3 + 2] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    const c0 = best;
    for (let k = -8; k <= 8; k++) {
      const i = (c0 + k + count) % count;
      const dx = pos[i * 3] - x;
      const dz = pos[i * 3 + 2] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  // Project (x, z) onto the centre line.
  // Returns { index, distance (m along lap), progress (0..1), lateral (m, +right),
  //           height (road surface y), forward:[x,y,z], right:[x,y,z] }.
  data.project = (x, z, hint = -1, out = {}) => {
    const i = data.nearestIndex(x, z, hint);
    // Choose the segment (i-1,i) or (i,i+1) that contains the projection.
    const j = (i + 1) % count;
    const h = (i - 1 + count) % count;
    let a = i;
    let b = j;
    let s = segParam(pos, i, j, x, z);
    if (s < 0) { a = h; b = i; s = segParam(pos, h, i, x, z); }
    s = Math.min(1, Math.max(0, s));
    const px = pos[a * 3] + (pos[b * 3] - pos[a * 3]) * s;
    const py = pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * s;
    const pz = pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * s;
    const rx = right[a * 3] + (right[b * 3] - right[a * 3]) * s;
    const rz = right[a * 3 + 2] + (right[b * 3 + 2] - right[a * 3 + 2]) * s;
    const rl = Math.hypot(rx, rz) || 1;
    out.index = i;
    let dist = (a + s) * spacing;
    if (dist >= length) dist -= length;
    out.distance = dist;
    out.progress = dist / length;
    out.lateral = ((x - px) * rx + (z - pz) * rz) / rl;
    out.height = py;
    out.forward = [fwd[a * 3], fwd[a * 3 + 1], fwd[a * 3 + 2]];
    out.right = [rx / rl, 0, rz / rl];
    out.curvature = curvature[i];
    out.kerb = data.kerbs[i] === 1;
    out.gap = gap[i] === 1;
    return out;
  };

  return data;
}

function segParam(pos, a, b, x, z) {
  const ax = pos[a * 3];
  const az = pos[a * 3 + 2];
  const dx = pos[b * 3] - ax;
  const dz = pos[b * 3 + 2] - az;
  const l2 = dx * dx + dz * dz || 1;
  return ((x - ax) * dx + (z - az) * dz) / l2;
}

// Builds a ribbon that follows the track at a fixed lateral band.
// profile: array of [lateralOffset, heightOffset] across the ribbon, from the
// centre outward on the right side (mirrored on the left when side = -1).
// heightFn(i, lateral) can override the height (used for terrain skirts).
function ribbon(data, profile, side, { vScale = 1, uMode = 'profile', heightFn, closed = true, keepGaps = false } = {}) {
  const { count, pos, right, spacing } = data;
  const n = profile.length;
  const rows = count + 1;
  const position = new Float32Array(rows * n * 3);
  const uv = new Float32Array(rows * n * 2);
  for (let r = 0; r < rows; r++) {
    const i = r % count;
    const cx = pos[i * 3];
    const cy = pos[i * 3 + 1];
    const cz = pos[i * 3 + 2];
    const rx = right[i * 3] * side;
    const rz = right[i * 3 + 2] * side;
    for (let k = 0; k < n; k++) {
      const [lat, hgt] = profile[k];
      const o = (r * n + k) * 3;
      position[o] = cx + rx * lat;
      position[o + 2] = cz + rz * lat;
      position[o + 1] = heightFn ? heightFn(i, lat * side, position[o], position[o + 2], cy + hgt, k) : cy + hgt;
      const uvo = (r * n + k) * 2;
      uv[uvo] = uMode === 'profile' ? k / (n - 1) : lat;
      uv[uvo + 1] = (r * spacing) / vScale;
    }
  }
  const index = [];
  for (let r = 0; r < rows - 1; r++) {
    // Nothing is built across a gap.
    if (!keepGaps && data.gap && (data.gap[r % count] || data.gap[(r + 1) % count])) continue;
    for (let k = 0; k < n - 1; k++) {
      const a = r * n + k;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      if (side > 0) index.push(a, b, c, b, d, c);
      else index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// Merge two non-indexed-compatible geometries (same attributes) into one.
function merge(geos) {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const position = new Float32Array(vCount * 3);
  const normal = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const index = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    position.set(g.attributes.position.array, vo * 3);
    normal.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const idx = g.index.array;
    for (let k = 0; k < idx.length; k++) index[io + k] = idx[k] + vo;
    vo += g.attributes.position.count;
    io += idx.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

const BARRIERS = {
  // Concrete jersey barrier.
  concrete: { profile: [[0, -0.05], [0.06, 0.28], [0.18, 0.82], [0.42, 0.82], [0.54, 0.28], [0.62, -0.05]], color: 0xb9b6ae, roughness: 0.9 },
  // Steel guard rail face plus a posts pass.
  guardrail: { profile: [[0, 0.42], [-0.04, 0.55], [0, 0.66], [-0.04, 0.78], [0.02, 0.8], [0.04, 0.42]], color: 0xc9ced3, roughness: 0.35, metalness: 0.85, posts: true },
  // Packed regolith berm with marker poles (Mars / Moon).
  berm: { profile: [[0, -0.1], [0.7, 0.55], [1.5, 0.85], [2.6, 0.5], [3.6, -0.2]], color: 0x9a5235, roughness: 1, poles: true },
  // Low wall with a tyre bundle look, used at the salt flats.
  tyres: { profile: [[0, -0.05], [0.02, 0.9], [0.9, 0.9], [0.92, -0.05]], color: 0x1b1b1d, roughness: 0.95 },
};

export function buildTrackMeshes(data, def, world, quality) {
  const group = new THREE.Group();
  group.name = 'track';
  const { roadHalfWidth: rhw, wallHalfWidth: whw } = data;
  const style = def.roadStyle || 'highway';
  const size = quality.textureSize;

  // Road surface.
  const roadMap = roadTexture(style, size, quality.anisotropy);
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadMap,
    roughnessMap: style === 'dirt' || style === 'regolith' || style === 'lunar' ? null : roadRoughness(size >> 1, quality.anisotropy),
    roughness: 0.92,
    metalness: 0,
    color: 0xffffff,
  });
  roadMat.userData.baseRoughness = 0.92;
  const roadProfile = [[-rhw, 0], [-rhw * 0.5, 0.015], [0, 0.03], [rhw * 0.5, 0.015], [rhw, 0]];
  // Profile across the whole road (side = +1, offsets go from left edge to right edge).
  const roadGeo = ribbon(data, roadProfile, 1, { vScale: def.roadWidth * 0.9 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  road.name = 'road';
  group.add(road);

  if (def.elevated) {
    group.add(buildDeck(data, def, world, quality));
  } else {
    // Shoulder (road edge -> wall) and an embankment skirt down/up to terrain.
    const shoulderColor = new THREE.Color(def.shoulderColor ?? 0x6d6a5f);
    const shoulderMat = new THREE.MeshStandardMaterial({
      color: shoulderColor,
      map: world.detailMap,
      roughness: 1,
    });
    const skirt = def.skirtWidth ?? 14;
    const shoulderProfile = [[rhw, -0.02], [whw + 1.0, -0.02], [whw + 1 + skirt * 0.35, 0], [whw + 1 + skirt, 0]];
    const skirtHeight = (i, lat, x, z, yRoad, k) => {
      if (k < 2) return yRoad;
      const terrainY = world.terrainHeight(x, z);
      return k === 2 ? yRoad + (terrainY - yRoad) * 0.35 : terrainY;
    };
    const shoulderGeo = merge([
      ribbon(data, shoulderProfile, 1, { vScale: 6, uMode: 'lat', heightFn: skirtHeight }),
      ribbon(data, shoulderProfile, -1, { vScale: 6, uMode: 'lat', heightFn: skirtHeight }),
    ]);
    // World-space UVs keep the detail texture scale consistent.
    const sp = shoulderGeo.attributes.position;
    const suv = shoulderGeo.attributes.uv;
    for (let k = 0; k < sp.count; k++) suv.setXY(k, sp.getX(k) / 6, sp.getZ(k) / 6);
    const shoulder = new THREE.Mesh(shoulderGeo, shoulderMat);
    shoulder.receiveShadow = true;
    shoulder.name = 'shoulder';
    group.add(shoulder);

}

  // Kerbs: raised red/white strips on corners.
  if (def.kerbs !== false) {
    const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(def.kerbColors), roughness: 0.6 });
    const kerbGeos = [];
    const segs = kerbRuns(data);
    for (const [s0, s1] of segs) {
      for (const side of [-1, 1]) {
        kerbGeos.push(partialRibbon(data, s0, s1, side, [[rhw - 0.25, 0.005], [rhw + 0.4, 0.06], [rhw + 1.1, 0.02]]));
      }
    }
    if (kerbGeos.length) {
      const kerbs = new THREE.Mesh(merge(kerbGeos), kerbMat);
      kerbs.receiveShadow = true;
      kerbs.name = 'kerbs';
      group.add(kerbs);
    }
  }

  // Barriers at wallHalfWidth on both sides.
  const bdef = BARRIERS[def.barrier || 'concrete'];
  const barrierMat = new THREE.MeshStandardMaterial({
    color: def.barrierColor ?? bdef.color,
    roughness: bdef.roughness,
    metalness: bdef.metalness || 0,
    map: world.detailMap,
    side: THREE.DoubleSide,
  });
  const bprof = bdef.profile.map(([l, h]) => [whw + l, h]);
  const barrierGeo = merge([
    ribbon(data, bprof, 1, { vScale: 4 }),
    ribbon(data, bprof, -1, { vScale: 4 }),
  ]);
  const barriers = new THREE.Mesh(barrierGeo, barrierMat);
  barriers.castShadow = quality.shadows;
  barriers.receiveShadow = true;
  barriers.name = 'barriers';
  group.add(barriers);

  if (bdef.posts || bdef.poles) {
    const every = bdef.posts ? 4 : 20;
    const geo = bdef.posts
      ? new THREE.BoxGeometry(0.12, 0.9, 0.12)
      : new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6);
    const mat = bdef.posts
      ? new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.7, roughness: 0.45 })
      : new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff5a1f, emissiveIntensity: 0.25, roughness: 0.6 });
    const step = Math.max(1, Math.round(every / data.spacing));
    const n = Math.ceil(data.count / step) * 2;
    const inst = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    let c = 0;
    const off = bdef.posts ? whw + 0.1 : whw + 1.5;
    const yOff = bdef.posts ? 0.45 : 1.4;
    for (let i = 0; i < data.count; i += step) {
      if (data.gap[i]) continue;
      for (const side of [-1, 1]) {
        const x = data.pos[i * 3] + data.right[i * 3] * off * side;
        const z = data.pos[i * 3 + 2] + data.right[i * 3 + 2] * off * side;
        m.makeTranslation(x, data.pos[i * 3 + 1] + yOff, z);
        inst.setMatrixAt(c++, m);
      }
    }
    inst.count = c;
    inst.castShadow = quality.shadows;
    inst.name = 'barrier-posts';
    group.add(inst);
  }

  // Start / finish: chequered line and a gantry.
  group.add(buildStartLine(data, def, quality));
  return group;
}

// Elevated roads (skyways, viaducts, bridges between islands): a concrete
// deck under the road and pillars down to the ground. Gaps stay open.
function buildDeck(data, def, world, quality) {
  const g = new THREE.Group();
  g.name = 'deck';
  const W = data.wallHalfWidth + 0.7;
  const depth = def.deckDepth ?? 1.6;
  const mat = new THREE.MeshStandardMaterial({ color: def.deckColor ?? 0x9b9a96, roughness: 0.9, map: world.detailMap, side: THREE.DoubleSide });
  const deckGeo = merge([
    ribbon(data, [[-W, -depth], [-W, -0.02], [W, -0.02], [W, -depth], [-W, -depth]], 1, { vScale: 6 }),
  ]);
  const deck = new THREE.Mesh(deckGeo, mat);
  deck.receiveShadow = true;
  deck.castShadow = quality.shadows;
  g.add(deck);
  if (def.pillars !== false) {
    const every = Math.max(1, Math.round((def.pillarSpacing ?? 40) / data.spacing));
    const spots = [];
    for (let i = 0; i < data.count; i += every) {
      // Pillars stand clear of gaps so the deck ends look supported.
      let near = false;
      for (let k = -3; k <= 3; k++) if (data.gap[(i + k + data.count) % data.count]) near = true;
      if (near) continue;
      const x = data.pos[i * 3];
      const z = data.pos[i * 3 + 2];
      const top = data.pos[i * 3 + 1] - depth;
      const bottom = world.terrainHeight(x, z) - 2;
      if (top - bottom < 3) continue;
      spots.push([x, top, z, bottom]);
    }
    const geo = new THREE.CylinderGeometry(1, 1, 1, 10);
    geo.translate(0, -0.5, 0);
    const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
    const m = new THREE.Matrix4();
    const r = Math.min(3, data.roadHalfWidth * 0.3);
    spots.forEach(([x, top, z, bottom], k) => {
      m.makeScale(r, top - bottom, r).setPosition(x, top, z);
      inst.setMatrixAt(k, m);
    });
    inst.count = spots.length;
    inst.castShadow = quality.shadows;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    g.add(inst);
  }
  return g;
}

function kerbRuns(data) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= data.count; i++) {
    const on = i < data.count && data.kerbs[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) { runs.push([start, i]); start = -1; }
  }
  return runs;
}

function partialRibbon(data, s0, s1, side, profile) {
  const n = profile.length;
  const rows = s1 - s0 + 1;
  const position = new Float32Array(rows * n * 3);
  const uv = new Float32Array(rows * n * 2);
  for (let r = 0; r < rows; r++) {
    const i = (s0 + r) % data.count;
    for (let k = 0; k < n; k++) {
      const [lat, h] = profile[k];
      const o = (r * n + k) * 3;
      position[o] = data.pos[i * 3] + data.right[i * 3] * lat * side;
      position[o + 1] = data.pos[i * 3 + 1] + h;
      position[o + 2] = data.pos[i * 3 + 2] + data.right[i * 3 + 2] * lat * side;
      uv[(r * n + k) * 2] = k / (n - 1);
      uv[(r * n + k) * 2 + 1] = (r * data.spacing) / 2;
    }
  }
  const index = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < n - 1; k++) {
      const a = r * n + k;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      if (side > 0) index.push(a, b, c, b, d, c);
      else index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function buildStartLine(data, def, quality) {
  const g = new THREE.Group();
  g.name = 'start-finish';
  const { roadHalfWidth: rhw, wallHalfWidth: whw } = data;
  const x = data.pos[0];
  const y = data.pos[1];
  const z = data.pos[2];
  const heading = Math.atan2(data.fwd[0], data.fwd[2]);

  const tex = checkerTexture();
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(rhw / 4, 1);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(rhw * 2, 1.6),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.045;
  line.receiveShadow = true;

  const frame = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: def.gantryColor ?? 0x24262b, metalness: 0.6, roughness: 0.4 });
  const pillarGeo = new THREE.BoxGeometry(0.7, 7.2, 0.7);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, metal);
    p.position.set(s * (whw + 0.8), 3.6, 0);
    p.castShadow = quality.shadows;
    frame.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry((whw + 0.8) * 2 + 0.7, 1.8, 0.8), metal);
  beam.position.y = 6.6;
  beam.castShadow = quality.shadows;
  frame.add(beam);
  const signMat = new THREE.MeshStandardMaterial({
    map: signTextureLocal(def.gantryText || 'START  /  FINISH'),
    emissive: 0xffffff,
    emissiveMap: signTextureLocal(def.gantryText || 'START  /  FINISH'),
    emissiveIntensity: 0.6,
  });
  for (const s of [-1, 1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(whw * 1.2, 1.4), signMat);
    sign.position.set(0, 6.6, s * 0.42);
    if (s < 0) sign.rotation.y = Math.PI;
    frame.add(sign);
  }
  g.add(line, frame);
  g.position.set(x, y, z);
  g.rotation.y = heading;
  return g;
}

function signTextureLocal(text) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d0e10';
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = '#e31937';
  ctx.fillRect(0, 116, 1024, 12);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Checkpoints spread evenly around the lap (index 0 is the start line).
export function buildCheckpoints(data, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = Math.floor((k / n) * data.count);
    out.push({
      index: k,
      sample: i,
      distance: i * data.spacing,
      position: new THREE.Vector3(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]),
      forward: new THREE.Vector3(data.fwd[i * 3], data.fwd[i * 3 + 1], data.fwd[i * 3 + 2]),
      heading: Math.atan2(data.fwd[i * 3], data.fwd[i * 3 + 2]),
      width: data.wallHalfWidth * 2,
    });
  }
  return out;
}

// Staggered two-wide starting grid behind the line.
export function buildGrid(data, slots = 8) {
  const out = [];
  for (let k = 0; k < slots; k++) {
    const back = 10 + k * 7;
    const i = (data.count - Math.round(back / data.spacing) + data.count) % data.count;
    const side = k % 2 === 0 ? -1 : 1;
    const lat = side * data.roadHalfWidth * 0.42;
    out.push({
      slot: k,
      position: new THREE.Vector3(
        data.pos[i * 3] + data.right[i * 3] * lat,
        data.pos[i * 3 + 1],
        data.pos[i * 3 + 2] + data.right[i * 3 + 2] * lat,
      ),
      heading: Math.atan2(data.fwd[i * 3], data.fwd[i * 3 + 2]),
    });
  }
  return out;
}

export { UP };
