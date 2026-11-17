import * as THREE from 'three';
import { fbm, ridged, smoothstep, mulberry32 } from '../noise.js';
import { ramp, std } from './util.js';

// Sky world: a rainforest gorge in the morning mist. A high stone-and-timber
// bridge road follows the river through the canopy, broken where old spans
// have fallen in; waterfalls pour off the gorge walls beside it and an
// overgrown stepped temple watches from the ridge.

const FLOOR = 8;
const RIVER = FLOOR + 2;

// A long, winding gorge: an oval loop with a pinch, so it doubles back.
function makeRoad() {
  const pts = [];
  const n = 30;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 560 + Math.sin(a * 2 + 0.2) * 150 + Math.sin(a * 5 + 1.3) * 40;
    const y = 52 + Math.sin(a * 3 + 0.4) * 7;
    pts.push([Math.sin(a) * r * 1.15, Math.cos(a) * r, y]);
  }
  return pts;
}
const ROAD = makeRoad();

// Flight skims the river under the bridge, then climbs out over the canopy.
function makePath() {
  return ROAD.map(([x0, z0], k) => {
    let x = x0;
    let z = z0;
    const u = k / ROAD.length;
    // Fly beside the bridge piers, not into them: 20 m to the right of the deck.
    const [ax, az] = ROAD[(k + ROAD.length - 1) % ROAD.length];
    const [bx, bz] = ROAD[(k + 1) % ROAD.length];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    x += (-(bz - az) / l) * 20;
    z += ((bx - ax) / l) * 20;
    let y = 24 + Math.sin(u * Math.PI * 6) * 8;
    for (const pop of [0.2, 0.62]) {
      const d = Math.min(Math.abs(u - pop), 1 - Math.abs(u - pop));
      y += 110 * Math.exp(-((d / 0.05) ** 2));
    }
    return [x, z, y];
  });
}

const GAPS = [
  { at: 0.05, length: 18 },
  { at: 0.17, length: 26, ramp: { length: 24, height: 2.4 } },
  { at: 0.3, length: 22 },
  { at: 0.44, length: 30, ramp: { length: 28, height: 2.8 } },
  { at: 0.58, length: 20 },
  { at: 0.71, length: 28, ramp: { length: 26, height: 2.6 } },
  { at: 0.85, length: 22 },
];

export default {
  id: 'jungle',
  name: 'Emerald Falls',
  tagline: 'Bridge road through a rainforest gorge',
  description: 'A high bridge road threads a misty river gorge past roaring waterfalls and a temple lost in the trees. Seven spans have fallen: hop them, then fly the river under the bridge.',
  location: 'Earth',
  modes: ['hop', 'flight'],
  elevated: true,
  terrainUsesTrack: true,
  pillarSpacing: 36,
  deckColor: 0x7b6f5c,
  goldSpeed: 41,
  gaps: GAPS,
  hopRings: [{ at: 0.235, height: 13, radius: 5 }, { at: 0.51, height: 12, radius: 5 }, { at: 0.78, height: 14, radius: 5 }],
  seed: 5521,
  gravity: 9.81,
  laps: 2,
  music: 'chill',
  points: ROAD,
  flight: { points: makePath(), ringRadius: 9, ceiling: 420, laps: 2, goldSpeed: 62, clearance: 3, floor: RIVER + 2 },
  roadWidth: 16,
  runoff: 2.5,
  roadStyle: 'mountain',
  barrier: 'concrete',
  barrierColor: 0x8f8470,
  kerbs: false,
  atmosphere: 'earth',
  defaultTime: 9.2,
  sunAzimuth: 110,
  sunTilt: 45,
  fogDensity: 0.0012,
  weathers: ['clear', 'fog', 'rain', 'storm', 'cloudy'],
  defaultWeather: 'clear',
  ambientScale: 1.2,
  groundBounce: 0x4a6a32,
  water: { level: RIVER, color: 0x2e5a48, roughness: 0.1, flow: 3 },
  terrain(noise, x, z, p) {
    const d = Math.abs(p.lateral);
    // Gorge: a flat river bed, then steep mossy walls up to the jungle plateau.
    const half = 62 + fbm(noise, x * 0.005, z * 0.005, 3) * 16;
    const k = smoothstep(half, half + 70, d) ** 1.3;
    const floor = FLOOR + fbm(noise, x * 0.02, z * 0.02, 2) * 1.5;
    const plateau = 95 + fbm(noise, x * 0.003, z * 0.003, 4) * 35;
    const hills = ridged(noise, x * 0.0018, z * 0.0018, 4) * 110 * smoothstep(250, 900, d);
    return floor + (plateau - floor) * k + hills;
  },
  terrainColor(c, x, z, h, slope) {
    if (h < RIVER + 1.5) return c.setHex(0x8a7a5a); // sand bars
    // Wet rock ledges showing through the moss on the gorge walls.
    const ledge = Math.sin(h * 0.45 + Math.sin(x * 0.03 + z * 0.02) * 1.5) * 0.5 + 0.5;
    if (slope > 0.45) return ramp(c, [[0, 0x2e4a24], [0.55, 0x3a4a34], [1, 0x6a6a58]], ledge * 0.8 + (slope - 0.45) * 0.5);
    if (slope > 0.25) return ramp(c, [[0, 0x24461c], [1, 0x355c26]], ledge);
    // Canopy floor: deep, uneven greens.
    const patch = Math.sin(x * 0.021 + Math.sin(z * 0.017) * 2) * Math.sin(z * 0.025 - x * 0.007) * 0.5 + 0.5;
    return ramp(c, [[0, 0x1d3f17], [0.5, 0x29541f], [1, 0x3b6c2a]], patch * 0.7 + h / 400);
  },
  props: [
    // Dense band of canopy on the gorge walls beside the bridge...
    { kind: 'oak', count: 2000, near: 30, far: 170, scale: [1.3, 2.4], minY: RIVER + 4, maxSlope: 3.5, options: {} },
    { kind: 'palm', count: 900, near: 26, far: 150, scale: [1, 1.7], minY: RIVER + 3, maxSlope: 3 },
    // ...and thinner forest out across the plateau.
    { kind: 'palm', count: 600, near: 150, far: 700, scale: [0.9, 1.6], minY: RIVER + 4, maxSlope: 0.9 },
    { kind: 'oak', count: 2200, near: 160, far: 900, scale: [1.2, 2.2], minY: RIVER + 6, maxSlope: 1.1, options: {} },
    { kind: 'shrub', count: 1200, near: 22, far: 500, scale: [1.2, 2.6], minY: RIVER + 2, maxSlope: 1.2 },
    { kind: 'boulder', count: 160, near: -10, far: 40, scale: [1.5, 4], sink: 0.5, maxY: RIVER + 3, options: { color: 0x5e6656 } },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    const rand = mulberry32(ctx.def.seed);
    const road = ctx.track;
    const tmp = {};

    // Waterfalls: white ribbons from the rim down to the river, with spray.
    const fallTex = fallTexture();
    const fallMat = new THREE.MeshBasicMaterial({ map: fallTex, color: 0xf2fbff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const sprayMat = new THREE.SpriteMaterial({ map: ctx.softDot, color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    const falls = [];
    for (let k = 0; k < 9; k++) {
      const u = (k + 0.3 + rand() * 0.4) / 9;
      const i = Math.floor(u * road.count);
      const side = k % 2 ? 1 : -1;
      // Find where the gorge wall reaches the plateau on that side.
      let off = 40;
      while (off < 160 && ctx.heightFn(road.pos[i * 3] + road.right[i * 3] * off * side, road.pos[i * 3 + 2] + road.right[i * 3 + 2] * off * side) < 80) off += 4;
      const rx = road.right[i * 3] * side;
      const rz = road.right[i * 3 + 2] * side;
      const px = road.pos[i * 3];
      const pz = road.pos[i * 3 + 2];
      const top = ctx.heightFn(px + rx * off, pz + rz * off);
      const h = top - RIVER;
      if (h < 30) continue;
      // Where the wall meets the river.
      let foot = 20;
      while (foot < off && ctx.heightFn(px + rx * foot, pz + rz * foot) < RIVER + 1) foot += 2;
      const w = 10 + rand() * 10;
      // A sheet that follows the wall face from the lip down to the river,
      // lifted a little off the rock so it never sinks into it.
      const tx = -rz;
      const tz = rx;
      const rows = 10;
      const verts = [];
      const uvs = [];
      const idx = [];
      for (let r = 0; r <= rows; r++) {
        const d = off + (foot - off) * (r / rows);
        const y = r === rows ? RIVER : ctx.heightFn(px + rx * d, pz + rz * d) + 1.5;
        for (const sd of [-1, 1]) {
          verts.push(px + rx * (d - 2.5) + tx * sd * w / 2, y, pz + rz * (d - 2.5) + tz * sd * w / 2);
          uvs.push(sd < 0 ? 0 : 1, 1 - r / rows);
        }
        if (r < rows) idx.push(r * 2, r * 2 + 2, r * 2 + 1, r * 2 + 1, r * 2 + 2, r * 2 + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      const fall = new THREE.Mesh(geo, fallMat);
      fall.position.set(px + rx * foot, 0, pz + rz * foot);
      geo.translate(-fall.position.x, 0, -fall.position.z);
      g.add(fall);
      falls.push(fall);
      for (let s = 0; s < 4; s++) {
        const sp = new THREE.Sprite(sprayMat);
        sp.position.set(fall.position.x - rx * 6 + (rand() - 0.5) * w, RIVER + 3 + rand() * 6, fall.position.z - rz * 6 + (rand() - 0.5) * w);
        const sc = 18 + rand() * 18;
        sp.scale.set(sc, sc * 0.6, 1);
        g.add(sp);
      }
    }

    // Overgrown stepped temple on the plateau, beside the course.
    const stone = std(0x8a8a74, { flatShading: true, roughness: 1 });
    const moss = std(0x4c6a34, { flatShading: true, roughness: 1 });
    const templeSpots = [];
    for (const u of [0.38, 0.9]) {
      const i = Math.floor(u * road.count);
      for (const side of [1, -1]) {
        const off = 180;
        const x = road.pos[i * 3] + road.right[i * 3] * off * side;
        const z = road.pos[i * 3 + 2] + road.right[i * 3 + 2] * off * side;
        if (Math.abs(road.project(x, z, -1, tmp).lateral) < 150) continue;
        templeSpots.push([x, z]);
        break;
      }
    }
    for (const [x, z] of templeSpots) {
      const t = new THREE.Group();
      const base = ctx.heightFn(x, z) - 2;
      const tiers = 6;
      for (let s = 0; s < tiers; s++) {
        const w = 52 - s * 7.5;
        const tier = new THREE.Mesh(new THREE.BoxGeometry(w, 6, w), s % 2 ? moss : stone);
        tier.position.y = base + 3 + s * 6;
        t.add(tier);
      }
      // Stair up the front and a shrine on top.
      const stair = new THREE.Mesh(new THREE.BoxGeometry(8, tiers * 6, 18), stone);
      stair.position.set(0, base + tiers * 3, 26 - 9);
      stair.rotation.x = -0.75;
      t.add(stair);
      const shrine = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 10), stone);
      shrine.position.y = base + tiers * 6 + 4;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(8, 5, 4), moss);
      cap.rotation.y = Math.PI / 4;
      cap.position.y = base + tiers * 6 + 10.5;
      t.add(shrine, cap);
      t.position.set(x, 0, z);
      t.rotation.y = rand() * Math.PI;
      g.add(t);
      ctx.collide(ctx.box(x - 26, base, z - 26, x + 26, base + tiers * 6 + 13, z + 26));
    }

    // Vines hanging from the bridge deck between pillars.
    const vineMat = std(0x3d6a2a, { roughness: 1 });
    const vineGeo = new THREE.CylinderGeometry(0.08, 0.05, 1, 4);
    vineGeo.translate(0, -0.5, 0);
    const count = ctx.quality.particles > 1000 ? 500 : 220;
    const vines = new THREE.InstancedMesh(vineGeo, vineMat, count);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    let vi = 0;
    for (let n = 0; n < count; n++) {
      const i = Math.floor(rand() * road.count);
      if (road.gap[i]) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const off = road.wallHalfWidth + 0.5;
      p.set(road.pos[i * 3] + road.right[i * 3] * off * side, road.pos[i * 3 + 1] - 0.4, road.pos[i * 3 + 2] + road.right[i * 3 + 2] * off * side);
      sc.set(1, 3 + rand() * 12, 1);
      m4.compose(p, q, sc);
      vines.setMatrixAt(vi++, m4);
    }
    vines.count = vi;
    g.add(vines);

    // Mist hanging in the gorge.
    const mistMat = new THREE.SpriteMaterial({ map: ctx.softDot, color: 0xeef6f0, transparent: true, opacity: 0.28, depthWrite: false });
    const mist = [];
    const mistN = ctx.quality.particles > 1000 ? 60 : 26;
    for (let n = 0; n < mistN; n++) {
      const i = Math.floor(rand() * road.count);
      const sp = new THREE.Sprite(mistMat);
      sp.position.set(road.pos[i * 3] + (rand() - 0.5) * 60, RIVER + 8 + rand() * 20, road.pos[i * 3 + 2] + (rand() - 0.5) * 60);
      const s = 70 + rand() * 90;
      sp.scale.set(s, s * 0.35, 1);
      g.add(sp);
      mist.push(sp);
    }

    // Parrots? Too small to see at speed. Instead, flocks of white birds
    // circle above the canopy.
    const birdGeo = new THREE.BufferGeometry();
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1.2, 0, 0, 0, 0, 0.5, 1.2, 0, 0], 3));
    const birdMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f0, side: THREE.DoubleSide });
    const birds = new THREE.InstancedMesh(birdGeo, birdMat, 40);
    birds.frustumCulled = false;
    g.add(birds);
    const flocks = [0.15, 0.55, 0.8].map((u) => {
      const i = Math.floor(u * road.count);
      return [road.pos[i * 3] + road.right[i * 3] * 120, 130, road.pos[i * 3 + 2] + road.right[i * 3 + 2] * 120];
    });

    ctx.onUpdate((dt, night, time) => {
      fallTex.offset.y = (fallTex.offset.y + dt * 1.6) % 1;
      for (let n = 0; n < mist.length; n++) mist[n].position.x += Math.sin(time * 0.1 + n) * dt * 1.5;
      for (let b = 0; b < 40; b++) {
        const f = flocks[b % flocks.length];
        const a = time * 0.25 + b * 0.7;
        const r = 30 + (b % 7) * 6;
        p.set(f[0] + Math.cos(a) * r, f[1] + Math.sin(a * 1.7 + b) * 6, f[2] + Math.sin(a) * r);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
        const flap = 0.3 + Math.abs(Math.sin(time * 9 + b));
        sc.set(1.4, 1, flap);
        m4.compose(p, q, sc);
        birds.setMatrixAt(b, m4);
      }
      birds.instanceMatrix.needsUpdate = true;
    });
    return g;
  },
};

// Streaky white water that scrolls down the sheet.
function fallTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 0, 64, 256);
  for (let k = 0; k < 140; k++) {
    const x = (k * 37) % 64;
    const y = (k * 91) % 256;
    g.fillStyle = `rgba(255,255,255,${0.3 + ((k * 13) % 7) / 10})`;
    g.fillRect(x, y, 2 + (k % 3), 30 + (k % 5) * 12);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  t.userData.owned = true;
  return t;
}
