import * as THREE from 'three';
import { fbm, mulberry32, smoothstep } from '../noise.js';
import { mixHex, std, roundedPolygon } from './util.js';
import { KINDS } from '../props.js';

// Sky world: a dusk skyline of glass towers. The course slaloms down the
// avenues between them, ducks under sky bridges and climbs over the crown
// of the tallest tower. Flight only.
const PATH = [
  [0, 0, 45], [0, 260, 32], [40, 480, 70], [220, 600, 120], [440, 580, 165],
  [600, 440, 120], [620, 220, 70], [520, 40, 28], [600, -160, 55], [760, -300, 110],
  [700, -500, 150], [480, -600, 115], [240, -540, 70], [100, -380, 34], [-20, -200, 30],
];

// Hop races: an elevated skyway between the towers, broken by gaps to jump.
const SKYWAY = roundedPolygon([
  [-80, -250, 38], [-80, 320, 46], [180, 460, 58], [560, 460, 66],
  [760, 240, 60], [760, -300, 50], [520, -480, 44], [160, -460, 38],
], 45, 60);

// Where along the course (0..1) the sky bridges cross over the rings.
const BRIDGES = [0.07, 0.36, 0.52, 0.86];

export default {
  id: 'spires',
  name: 'Skyline Spires',
  tagline: 'Slalom between glass towers at dusk',
  description: 'Thread the avenues of a city of glass, duck under sky bridges and skim the rooftops, or hop the gaps in the skyway.',
  location: 'Earth',
  modes: ['hop', 'flight'],
  elevated: true,
  laps: 3,
  goldSpeed: 36,
  gaps: [
    { at: 0.12, length: 22 },
    { at: 0.33, length: 26, ramp: { length: 24, height: 2.2 } },
    { at: 0.55, length: 20 },
    { at: 0.74, length: 30, ramp: { length: 26, height: 2.6 } },
    { at: 0.9, length: 18 },
  ],
  hopRings: [{ at: 0.22, height: 14, radius: 5 }, { at: 0.64, height: 12, radius: 5 }],
  seed: 8101,
  gravity: 9.81,
  music: 'synthwave',
  points: SKYWAY,
  flight: { points: PATH, ringRadius: 9, ceiling: 420, laps: 2, goldSpeed: 58, clearance: 3 },
  roadWidth: 16,
  runoff: 2.5,
  roadStyle: 'city',
  barrier: 'concrete',
  barrierColor: 0xd6d3cb,
  kerbs: false,
  atmosphere: 'earth',
  defaultTime: 19.3,
  sunAzimuth: 200,
  fogDensity: 0.0011,
  weathers: ['clear', 'cloudy', 'fog', 'rain'],
  defaultWeather: 'clear',
  ambientScale: 1.6,
  groundBounce: 0x3a3550,
  terrainRoughness: 0.7,
  terrain(noise, x, z) {
    const r = Math.hypot(x - 350, z);
    return fbm(noise, x * 0.004, z * 0.004, 2) * 0.6 + smoothstep(1500, 2600, r) * 180 * (0.5 + 0.5 * fbm(noise, x * 0.002, z * 0.002, 3));
  },
  terrainColor(c, x, z, h) {
    return mixHex(c, 0x56575a, 0x2f3a2e, (h - 1) / 40);
  },
  props: [
    { kind: 'lamp', along: 45, offset: 0, sides: [-1, 1] },
    { kind: 'oak', count: 200, near: 4, far: 30, scale: [0.6, 0.9] },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    const rand = mulberry32(ctx.def.seed);
    const tmp = {};
    const road = ctx.track;
    const track = ctx.flightTrack;
    // Is (x, z) within `m` metres of the skyway's barriers?
    const nearRoad = (x, z, m) => Math.abs(road.project(x, z, -1, tmp).lateral) < road.wallHalfWidth + m;

    // Sky bridges first, so towers can anchor them and lots can avoid them.
    const anchors = [];
    const glass = std(0x9fb8d0, { metalness: 0.7, roughness: 0.15, emissive: 0x6fd0ff, emissiveIntensity: 0 });
    ctx.glow(glass, 0.6);
    for (const u of BRIDGES) {
      const i = Math.floor(u * track.count);
      const cx = track.pos[i * 3];
      const cy = track.pos[i * 3 + 1];
      const cz = track.pos[i * 3 + 2];
      const rx = track.right[i * 3];
      const rz = track.right[i * 3 + 2];
      const yaw = Math.atan2(rx, rz);
      const bottom = cy + 9 + 9;
      // Skip a bridge that would cut across the skyway deck.
      let blocked = false;
      for (let k = 0; k < road.count; k += 2) {
        const dx = road.pos[k * 3] - cx;
        const dz = road.pos[k * 3 + 2] - cz;
        if (dx * dx + dz * dz < 40 * 40 && Math.abs(road.pos[k * 3 + 1] - bottom) < 14) blocked = true;
      }
      if (blocked) continue;
      const span = 64;
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(7, 5, span), glass);
      bridge.position.set(cx, bottom + 2.5, cz);
      bridge.rotation.y = yaw;
      g.add(bridge);
      // Collider: an axis-aligned box covering the rotated bridge.
      const ex = Math.abs(rx) * span / 2 + Math.abs(rz) * 3.5;
      const ez = Math.abs(rz) * span / 2 + Math.abs(rx) * 3.5;
      ctx.collide(ctx.box(cx - ex, bottom, cz - ez, cx + ex, bottom + 5, cz + ez));
      ctx.gate(cx, cy, cz);
      for (const s of [-1, 1]) {
        const ax = cx + rx * 44 * s;
        const az = cz + rz * 44 * s;
        if (!nearRoad(ax, az, 18)) anchors.push({ x: ax, z: az, h: bottom + 30 + rand() * 80, w: 26 });
      }
    }

    // Towers on a grid of lots, skipping lots that would block the course.
    const variants = [
      { w: 30, d: 30, h: 90, seed: 3 },
      { w: 36, d: 30, h: 160, seed: 4, tint: 0xc9d8ff },
      { w: 40, d: 40, h: 240, seed: 5, tint: 0xa8c4e8 },
      { w: 26, d: 26, h: 60, seed: 6, tint: 0xe8d6c4 },
    ];
    const lots = variants.map(() => []);
    const pitch = 62;
    const b = track.box;
    for (let x = b.min.x - 500; x <= b.max.x + 500; x += pitch) {
      for (let z = b.min.z - 500; z <= b.max.z + 500; z += pitch) {
        const jx = x + (rand() - 0.5) * 10;
        const jz = z + (rand() - 0.5) * 10;
        const p = track.project(jx, jz, -1, tmp);
        const lat = Math.abs(p.lateral);
        // Taller in the middle of town.
        const centre = 1 - smoothstep(200, 1100, Math.hypot(jx - 350, jz));
        let v = rand() < 0.15 + centre * 0.35 ? 2 : rand() < 0.4 + centre * 0.3 ? 1 : rand() < 0.5 ? 0 : 3;
        const half = Math.max(variants[v].w, variants[v].d) * 0.75;
        if (lat < half + 22) continue;
        if (nearRoad(jx, jz, half + 6)) continue;
        if (anchors.some((a) => Math.hypot(a.x - jx, a.z - jz) < a.w + half + 4)) continue;
        if (rand() < 0.08) continue; // the odd plaza
        lots[v].push([jx, jz, 0.85 + rand() * 0.4 * (0.5 + centre)]);
      }
    }
    for (const a of anchors) lots[1].push([a.x, a.z, a.h / variants[1].h]);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    variants.forEach((v, k) => {
      if (!lots[k].length) return;
      const [part] = KINDS.building(v);
      const inst = new THREE.InstancedMesh(part.geo, part.mat, lots[k].length);
      lots[k].forEach(([x, z, hs], n) => {
        // Width stays fixed so windows keep their size; height varies.
        s.set(1, hs, 1);
        p.set(x, 0, z);
        m.compose(p, q, s);
        inst.setMatrixAt(n, m);
        col.setRGB(1, 1, 1).multiplyScalar(0.8 + rand() * 0.4);
        inst.setColorAt(n, col);
        ctx.collide(ctx.box(x - v.w / 2, -1, z - v.d / 2, x + v.w / 2, v.h * hs, z + v.d / 2));
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.castShadow = ctx.quality.shadows;
      inst.receiveShadow = true;
      g.add(inst);
      ctx.glow(part.mat, 1.8);
    });

    // Aircraft warning lights blinking on the tallest roofs.
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(1.2, 8, 6), beaconMat, lots[2].length);
    lots[2].forEach(([x, z, hs], n) => {
      m.makeTranslation(x, variants[2].h * hs + 1.5, z);
      beacons.setMatrixAt(n, m);
    });
    g.add(beacons);
    ctx.onUpdate((dt, night, t) => { beacons.visible = Math.sin(t * 2.4) > 0.2; });
    return g;
  },
};
