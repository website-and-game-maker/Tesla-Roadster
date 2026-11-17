import * as THREE from 'three';
import { fbm, ridged, smoothstep, mulberry32 } from '../noise.js';
import { ramp, std } from './util.js';

// Sky world: a basalt causeway looping across the lava lake inside a giant
// caldera at dusk. The deck is broken where lava flows burned through it, so
// the race is a string of thruster hops over glowing rivers of rock. The
// active cone in the middle throws up lava fountains and an ash plume.

const LAVA = 3;

// The causeway: a wobbly ring around the cone, rising and falling a little.
function makeRoad() {
  const pts = [];
  const n = 30;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 470 + Math.sin(a * 3 + 0.8) * 70 + Math.sin(a * 5 + 2) * 22;
    pts.push([Math.sin(a) * r, Math.cos(a) * r, 40 + Math.sin(a * 2 + 0.5) * 5]);
  }
  return pts;
}
const ROAD = makeRoad();

// Flight: higher, wider loop that crosses over the cone's shoulder twice.
function makePath() {
  const pts = [];
  const n = 26;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 520 + Math.sin(a * 2 + 0.3) * 200;
    const y = 66 + Math.sin(a * 4) * 22;
    pts.push([Math.sin(a) * r, Math.cos(a) * r, y]);
  }
  return pts;
}

const GAPS = [
  { at: 0.07, length: 20 },
  { at: 0.19, length: 26, ramp: { length: 24, height: 2.3 } },
  { at: 0.33, length: 22 },
  { at: 0.47, length: 30, ramp: { length: 28, height: 2.7 } },
  { at: 0.61, length: 18 },
  { at: 0.74, length: 28, ramp: { length: 26, height: 2.5 } },
  { at: 0.88, length: 24 },
];

const CONE_R = 300;
const CONE_H = 270;
const CONE_P = 1.7; // concave flanks: steep near the top, spreading at the foot

export default {
  id: 'volcano',
  name: 'Caldera Crossing',
  tagline: 'Hop the lava rivers across a live caldera',
  description: 'A basalt causeway loops across a lake of molten rock. Lava has burned through the deck in seven places: hop every break, while the cone in the middle throws fire into the dusk.',
  location: 'Earth',
  modes: ['hop', 'flight'],
  elevated: true,
  pillarSpacing: 30,
  deckColor: 0x3b3633,
  goldSpeed: 42,
  gaps: GAPS,
  hopRings: [{ at: 0.26, height: 13, radius: 5 }, { at: 0.54, height: 12, radius: 5 }, { at: 0.81, height: 14, radius: 5 }],
  seed: 9413,
  gravity: 9.81,
  laps: 2,
  music: 'epic',
  points: ROAD,
  flight: { points: makePath(), ringRadius: 9, ceiling: 460, laps: 2, goldSpeed: 66, clearance: 4, floor: LAVA + 2 },
  roadWidth: 16,
  runoff: 2.5,
  roadStyle: 'mountain',
  barrier: 'concrete',
  barrierColor: 0x4a4440,
  kerbs: false,
  atmosphere: 'earth',
  defaultTime: 19.1,
  sunAzimuth: 250,
  sunTilt: 40,
  fogDensity: 0.0009,
  weathers: ['clear', 'dust', 'fog', 'cloudy'],
  defaultWeather: 'clear',
  ambientScale: 1.35,
  groundBounce: 0xff5a1e,
  water: { level: LAVA, lava: true, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.7, opacity: 1, flow: 0.25, pulse: true },
  terrainRoughness: 1,
  terrain(noise, x, z) {
    const r = Math.hypot(x, z);
    // Lake bed under the lava, with crusted islets poking through.
    const bed = LAVA - 6 + fbm(noise, x * 0.01, z * 0.01, 3) * 4;
    const islets = smoothstep(0.32, 0.55, fbm(noise, x * 0.006 + 7, z * 0.006, 3)) * 7;
    // Central cone with a crater on top.
    const k = Math.max(0, 1 - r / CONE_R);
    // Gullies run down the flanks (noise in angle), lava-stained near the top.
    const ang = Math.atan2(z, x);
    const gully = (Math.sin(ang * 23 + fbm(noise, x * 0.01, z * 0.01, 2) * 3) * 0.5 + 0.5) * 9 * k * (1 - k);
    const cone = CONE_H * k ** CONE_P - smoothstep(0.88, 0.97, k) * 70 - gully + ridged(noise, x * 0.02, z * 0.02, 3) * 12 * k;
    // Caldera wall all round, ridged and high.
    const wall = smoothstep(900, 1350, r) * (210 + ridged(noise, x * 0.002, z * 0.002, 5) * 120);
    return Math.max(bed + islets, cone) + wall;
  },
  terrainColor(c, x, z, h, slope) {
    if (h < LAVA + 1.2) return c.setHex(0x2a1410); // crust at the shore
    if (h > 110 && Math.hypot(x, z) < CONE_R) return ramp(c, [[0, 0x2e2622], [0.7, 0x5a2a1c], [1, 0x8a3a1c]], (h - 110) / 100);
    if (slope > 0.5) return ramp(c, [[0, 0x2b2726], [1, 0x45403c]], slope);
    return ramp(c, [[0, 0x1f1c1b], [0.5, 0x34302d], [1, 0x5a4a40]], h / 260 + slope * 0.4);
  },
  props: [
    { kind: 'boulder', count: 260, near: 60, far: 900, scale: [2, 8], sink: 0.6, minY: LAVA + 1, options: { color: 0x2a2624 } },
    { kind: 'rock', count: 500, near: 200, far: 1100, scale: [2, 6], minY: 20, options: { color: 0x3a3330 } },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    const rand = mulberry32(ctx.def.seed);
    const road = ctx.track;
    const t = ctx.flightTrack;

    // The cone is terrain, but flight needs to know it is solid even where
    // the path skims its shoulder.
    for (let y = 20; y < CONE_H - 30; y += 30) {
      const rr = CONE_R * (1 - (y / CONE_H) ** (1 / CONE_P));
      ctx.collide(ctx.sphere(0, y, 0, rr * 0.9));
    }

    // Glowing crater lake and a lava light that lights the ash cloud from below.
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a });
    const crater = new THREE.Mesh(new THREE.CircleGeometry(CONE_R * 0.14, 24), glowMat);
    crater.rotation.x = -Math.PI / 2;
    crater.position.set(0, CONE_H - 66, 0);
    g.add(crater);
    const lavaLight = new THREE.PointLight(0xff5a1a, 1.2, 900, 0);
    lavaLight.position.set(0, CONE_H + 10, 0);
    g.add(lavaLight);

    // Ash plume: big dark sprites rising from the crater and drifting off.
    const plumeMat = new THREE.SpriteMaterial({ map: ctx.softDot, color: 0x3a3330, transparent: true, opacity: 0.5, depthWrite: false });
    const plume = [];
    const plumeN = ctx.quality.particles > 1000 ? 40 : 18;
    for (let n = 0; n < plumeN; n++) {
      const sp = new THREE.Sprite(plumeMat);
      sp.userData.life = rand();
      g.add(sp);
      plume.push(sp);
    }

    // Lava fountains: glowing blobs thrown up from the crater and from vents
    // in the lake beside the causeway. Each is a burst of points on arcs.
    const vents = [[0, CONE_H - 64, 0, 52, 22]];
    for (let k = 0; k < 6; k++) {
      // A vent beside the road, a safe distance off the deck.
      const u = (k + 0.5) / 6;
      const i = Math.floor(u * road.count);
      const side = k % 2 ? 1 : -1;
      const off = road.wallHalfWidth + 45 + rand() * 40;
      vents.push([
        road.pos[i * 3] + road.right[i * 3] * off * side,
        LAVA,
        road.pos[i * 3 + 2] + road.right[i * 3 + 2] * off * side,
        26 + rand() * 10,
        8,
      ]);
    }
    const per = ctx.quality.particles > 1000 ? 70 : 32;
    const total = vents.length * per;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const vel = new Float32Array(total * 3);
    const life = new Float32Array(total);
    const blobMat = new THREE.PointsMaterial({ color: 0xffa040, size: 3.2, map: ctx.softDot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const blobs = new THREE.Points(geo, blobMat);
    blobs.frustumCulled = false;
    g.add(blobs);
    const launch = (p) => {
      const v = vents[Math.floor(p / per)];
      const a = rand() * Math.PI * 2;
      const s = rand() * v[4] * 0.35;
      pos[p * 3] = v[0] + (rand() - 0.5) * 4;
      pos[p * 3 + 1] = v[1];
      pos[p * 3 + 2] = v[2] + (rand() - 0.5) * 4;
      vel[p * 3] = Math.cos(a) * s;
      vel[p * 3 + 1] = v[3] * (0.6 + rand() * 0.5);
      vel[p * 3 + 2] = Math.sin(a) * s;
      life[p] = 0;
    };
    for (let p = 0; p < total; p++) { launch(p); life[p] = -rand() * 4; }
    // Each vent erupts in pulses, so fountains come and go.
    const phase = vents.map(() => rand() * 10);

    // Vent mounds of black spatter so the fountains come out of something.
    const mound = std(0x231e1c, { flatShading: true, roughness: 1 });
    for (const v of vents.slice(1)) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(9, 7, 9), mound);
      m.position.set(v[0], LAVA + 2, v[2]);
      g.add(m);
      ctx.collide(ctx.sphere(v[0], LAVA + 1, v[2], 9));
    }

    // Embers drifting over the whole lake.
    const emberN = ctx.quality.particles > 1000 ? 600 : 220;
    const eg = new THREE.BufferGeometry();
    const ep = new Float32Array(emberN * 3);
    const b = road.box;
    for (let n = 0; n < emberN; n++) {
      ep[n * 3] = b.min.x - 200 + rand() * (b.max.x - b.min.x + 400);
      ep[n * 3 + 1] = LAVA + rand() * 90;
      ep[n * 3 + 2] = b.min.z - 200 + rand() * (b.max.z - b.min.z + 400);
    }
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    const embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xff7a2a, size: 0.7, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    embers.frustumCulled = false;
    g.add(embers);

    // Warning beacons at both lips of every break in the deck.
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff3a10, emissiveIntensity: 2 });
    const beaconGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.6, 8);
    const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, GAPS.length * 4);
    const m4 = new THREE.Matrix4();
    let bi = 0;
    for (const gp of GAPS) {
      for (const end of [-1, 1]) {
        const u = gp.at + (end * (gp.length / 2 + 2)) / road.length;
        const i = Math.floor((((u % 1) + 1) % 1) * road.count);
        for (const side of [-1, 1]) {
          const off = road.wallHalfWidth - 0.4;
          m4.makeTranslation(road.pos[i * 3] + road.right[i * 3] * off * side, road.pos[i * 3 + 1] + 1.6, road.pos[i * 3 + 2] + road.right[i * 3 + 2] * off * side);
          beacons.setMatrixAt(bi++, m4);
        }
      }
    }
    beacons.count = bi;
    g.add(beacons);

    // A few ring gates hang where the flight path crosses the cone's shoulder.
    for (const u of [0.25, 0.75]) {
      const i = Math.floor(u * t.count);
      ctx.gate(t.pos[i * 3], t.pos[i * 3 + 1], t.pos[i * 3 + 2]);
    }

    ctx.onUpdate((dt, night, time) => {
      // Fountains.
      for (let v = 0; v < vents.length; v++) {
        const on = Math.sin(time * 0.6 + phase[v]) > -0.2;
        for (let p = v * per; p < (v + 1) * per; p++) {
          life[p] += dt;
          if (life[p] < 0) { pos[p * 3 + 1] = -1000; continue; }
          vel[p * 3 + 1] -= 9.81 * dt;
          pos[p * 3] += vel[p * 3] * dt;
          pos[p * 3 + 1] += vel[p * 3 + 1] * dt;
          pos[p * 3 + 2] += vel[p * 3 + 2] * dt;
          if (pos[p * 3 + 1] < vents[v][1] - 1) {
            if (on) launch(p); else { life[p] = -0.5 - Math.random(); pos[p * 3 + 1] = -1000; }
          }
        }
      }
      geo.attributes.position.needsUpdate = true;
      // Plume.
      for (const sp of plume) {
        sp.userData.life += dt * 0.04;
        if (sp.userData.life > 1) sp.userData.life -= 1;
        const l = sp.userData.life;
        sp.position.set(l * 380, CONE_H - 20 + l * 420, -l * 120);
        const s = 60 + l * 300;
        sp.scale.set(s, s, 1);
        sp.material.opacity = 0.5;
      }
      // Embers rise and wrap.
      for (let n = 0; n < emberN; n++) {
        ep[n * 3 + 1] += dt * (1.5 + (n % 5) * 0.4);
        ep[n * 3] += dt * 1.2;
        if (ep[n * 3 + 1] > LAVA + 90) ep[n * 3 + 1] = LAVA + 1;
      }
      eg.attributes.position.needsUpdate = true;
      lavaLight.intensity = 1.1 + Math.sin(time * 3.1) * 0.15 + Math.sin(time * 7.3) * 0.1;
      beaconMat.emissiveIntensity = Math.sin(time * 5) > 0 ? 2.4 : 0.4;
    });
    return g;
  },
};
