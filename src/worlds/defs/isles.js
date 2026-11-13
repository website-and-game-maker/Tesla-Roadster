import * as THREE from 'three';
import { fbm, mulberry32, createNoise2D } from '../noise.js';
import { mixHex } from './util.js';
import { colliderDistance } from '../flight.js';

// Sky world: floating islands above a sea of clouds at golden hour. The
// course swoops between islands, under overhanging ones and through
// waterfalls. The cloud deck is the "ground". Flight only.
function makePath() {
  const pts = [];
  const n = 24;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 700 + Math.sin(a * 2 + 0.4) * 220;
    pts.push([
      Math.sin(a) * r,
      Math.cos(a) * r - 700,
      165 + Math.sin(a * 3) * 90 + Math.sin(a * 5 + 1) * 40,
    ]);
  }
  return pts;
}
const PATH = makePath();
const RING = 10;

export default {
  id: 'isles',
  name: 'Cloud Isles',
  tagline: 'Swoop between floating islands',
  description: 'Islands drift above a sea of cloud. Dive under their roots, cut between them and chase the sunset. Pure flight.',
  location: 'Earth',
  modes: ['flight'],
  noRoad: true,
  seed: 8307,
  gravity: 9.81,
  laps: 2,
  music: 'chill',
  points: PATH,
  flight: { points: PATH, ringRadius: RING, ceiling: 520, laps: 2, goldSpeed: 72, clearance: 4, floor: 8 },
  roadWidth: 30,
  runoff: 0,
  kerbs: false,
  atmosphere: 'earth',
  defaultTime: 17.9,
  sunAzimuth: 160,
  fogDensity: 0.0006,
  weathers: ['clear', 'cloudy', 'fog'],
  defaultWeather: 'clear',
  ambientScale: 1.2,
  groundBounce: 0xffe2c4,
  terrainRoughness: 1,
  terrain(noise, x, z) {
    // Billowing cloud tops.
    return fbm(noise, x * 0.004, z * 0.004, 4) * 7 + Math.abs(fbm(noise, x * 0.0012 + 3, z * 0.0012, 3)) * 14;
  },
  terrainColor(c, x, z, h) {
    return mixHex(c, 0xb9c6d8, 0xfbf7f2, (h + 4) / 16);
  },
  props: [],
  landmarks(ctx) {
    const g = new THREE.Group();
    const rand = mulberry32(ctx.def.seed);
    const t = ctx.track;
    const islands = []; // [x, yTop, z, r]

    // Islands along the course, alternating sides; every fifth hangs overhead.
    let k = 0;
    for (let d = 70; d < t.length - 40; d += 85 + rand() * 40, k++) {
      const i = Math.floor((d / t.length) * t.count);
      const cx = t.pos[i * 3];
      const cy = t.pos[i * 3 + 1];
      const cz = t.pos[i * 3 + 2];
      const r = 14 + rand() * 26;
      if (k % 5 === 4) {
        islands.push([cx, cy + RING + 16 + 1.8 * r, cz, r]);
        ctx.gate(cx, cy, cz);
      } else {
        const side = k % 2 ? 1 : -1;
        const lat = side * (r + RING + 14 + rand() * 30);
        islands.push([cx + t.right[i * 3] * lat, cy - 20 + rand() * 45, cz + t.right[i * 3 + 2] * lat, r]);
      }
    }
    // Scenery islands further out.
    const b = t.box;
    for (let n = 0; n < 110; n++) {
      const x = b.min.x - 600 + rand() * (b.max.x - b.min.x + 1200);
      const z = b.min.z - 600 + rand() * (b.max.z - b.min.z + 1200);
      islands.push([x, 60 + rand() * 320, z, 12 + rand() * 50]);
    }

    // Drop any island that would block the course, then register colliders.
    const keep = [];
    const p = new THREE.Vector3();
    for (const isl of islands) {
      const cs = islandColliders(ctx, isl);
      let ok = true;
      for (let s = 0; s < t.count && ok; s += 3) {
        const dx = t.pos[s * 3] - isl[0];
        const dz = t.pos[s * 3 + 2] - isl[2];
        if (dx * dx + dz * dz > (isl[3] + 60) ** 2) continue;
        p.set(t.pos[s * 3], t.pos[s * 3 + 1], t.pos[s * 3 + 2]);
        for (const c of cs) if (colliderDistance(c, p.x, p.y, p.z) < RING + 6) { ok = false; break; }
      }
      if (!ok) continue;
      keep.push(isl);
      ctx.collide(...cs);
    }

    // One merged island model, instanced.
    const geo = islandGeometry(ctx.def.seed);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    const inst = new THREE.InstancedMesh(geo, mat, keep.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    keep.forEach(([x, y, z, r], n) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      s.setScalar(r);
      m.compose(p.set(x, y, z), q, s);
      inst.setMatrixAt(n, m);
    });
    inst.castShadow = ctx.quality.shadows;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    g.add(inst);

    // Waterfalls pouring off a few islands into the clouds.
    const fallMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    const falls = [];
    keep.forEach(([x, y, z, r], n) => {
      if (n % 4 !== 1) return;
      const h = y;
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.18, h), fallMat);
      fall.position.set(x + r * 0.98, y - h / 2, z);
      fall.rotation.y = Math.PI / 2;
      g.add(fall);
      falls.push(fall);
    });

    // Big soft cloud puffs drifting at mid altitude.
    const puffMat = new THREE.SpriteMaterial({ map: ctx.softDot, color: 0xfff4ea, transparent: true, opacity: 0.55, depthWrite: false });
    const puffs = [];
    const count = ctx.quality.particles > 1000 ? 70 : 30;
    for (let n = 0; n < count; n++) {
      const sp = new THREE.Sprite(puffMat);
      sp.position.set(b.min.x - 500 + rand() * (b.max.x - b.min.x + 1000), 20 + rand() * 60, b.min.z - 500 + rand() * (b.max.z - b.min.z + 1000));
      const sc = 120 + rand() * 200;
      sp.scale.set(sc, sc * 0.45, 1);
      g.add(sp);
      puffs.push(sp);
    }
    ctx.onUpdate((dt) => {
      for (const sp of puffs) sp.position.x += dt * 2.5;
    });
    return g;
  },
};

// Spheres approximating an island of top radius r (unit model scaled by r).
function islandColliders(ctx, [x, y, z, r]) {
  return [
    ctx.sphere(x, y - 0.3 * r, z, 1.02 * r),
    ctx.sphere(x, y - 1.0 * r, z, 0.6 * r),
    ctx.sphere(x, y - 1.5 * r, z, 0.3 * r),
  ];
}

// Unit island: jagged rock cone hanging below, grass on top, a few trees.
function islandGeometry(seed) {
  const noise = createNoise2D(seed);
  const parts = [];
  const rockC = new THREE.Color(0x7d6a58);
  const grassC = new THREE.Color(0x6d9a45);
  const treeC = new THREE.Color(0x2f5a2a);
  const add = (geo, color, jitter = 0) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const v = 1 - jitter + noise(i * 0.37, 1.3) * jitter;
      c.copy(color).multiplyScalar(v);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  };
  const rock = new THREE.ConeGeometry(1, 1.8, 10, 4);
  rock.rotateX(Math.PI);
  rock.translate(0, -0.9 - 0.05, 0);
  const rp = rock.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const y = rp.getY(i);
    const z = rp.getZ(i);
    const k = 1 + noise(x * 2 + y, z * 2 - y) * 0.25;
    rp.setXYZ(i, x * k, y, z * k);
  }
  add(rock, rockC, 0.25);
  const top = new THREE.CylinderGeometry(1.02, 1, 0.1, 12);
  top.translate(0, -0.05, 0);
  add(top, grassC, 0.15);
  for (let k = 0; k < 5; k++) {
    const a = k * 2.4;
    const r = 0.25 + (k % 3) * 0.2;
    const tree = new THREE.ConeGeometry(0.09, 0.32, 6);
    tree.translate(Math.cos(a) * r, 0.16, Math.sin(a) * r);
    add(tree, treeC, 0.2);
  }
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
