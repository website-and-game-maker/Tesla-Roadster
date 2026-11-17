import * as THREE from 'three';
import { fbm, ridged, smoothstep, mulberry32 } from '../noise.js';
import { ramp, std, plant, solid } from './util.js';

// World: a snow road around the head of a northern fjord at night, under
// the aurora. Mountains drop straight into black water; the loop runs down
// one shore, round the head of the fjord and back over a causeway at the
// mouth. Packed snow means less grip, and three kickers launch you high.

const ROAD = [
  [235, -700, 10], [262, -380, 22], [240, -60, 32], [270, 260, 30], [236, 560, 24],
  [150, 830, 20], [-20, 930, 24], [-190, 840, 30], [-262, 560, 36], [-238, 240, 34],
  [-268, -80, 28], [-236, -420, 18], [-170, -760, 9], [-30, -930, 6], [140, -890, 7],
];

export default {
  id: 'fjord',
  name: 'Aurora Fjord',
  tagline: 'Night run on packed snow under the northern lights',
  description: 'A snow road around the head of a deep fjord, with icebergs in black water and the aurora rippling overhead. Grip is low and the kickers are big: brake early, hop late.',
  location: 'Earth',
  seed: 6621,
  gravity: 9.81,
  laps: 2,
  goldSpeed: 37,
  music: 'chill',
  points: ROAD,
  ramps: [
    { at: 0.14, length: 26, height: 2.4 },
    { at: 0.45, length: 28, height: 2.8 },
    { at: 0.8, length: 26, height: 2.5 },
  ],
  hopRings: [
    { at: 0.155, height: 11, radius: 5 },
    { at: 0.465, height: 12, radius: 5 },
    { at: 0.815, height: 11, radius: 5 },
    { at: 0.63, lat: 3, height: 9, radius: 4.5 },
  ],
  flight: { altitude: 34, swing: 50, waves: 3, weave: 6, weaveWaves: 4, ringRadius: 10, ceiling: 520, goldSpeed: 64, keys: [{ u: 0.93, alt: 12, width: 0.03 }] },
  roadWidth: 15,
  runoff: 4,
  roadStyle: 'mountain',
  barrier: 'guardrail',
  kerbColors: ['#c7262b', '#f2f2f2'],
  shoulderColor: 0xe6edf3,
  atmosphere: 'earth',
  defaultTime: 22.6,
  sunAzimuth: 330,
  sunTilt: 22,
  fogDensity: 0.0006,
  weathers: ['clear', 'snow', 'fog', 'cloudy'],
  defaultWeather: 'clear',
  ambientScale: 1.7,
  groundBounce: 0xbcd4e8,
  water: { level: 0, color: 0x0d2230, roughness: 0.04 },
  terrainBlend: 50,
  surfaces: {
    road: { grip: 0.86, rolling: 0.014 },
    kerb: { grip: 0.8, rolling: 0.018 },
    shoulder: { grip: 0.6, rolling: 0.06 },
  },
  terrain(noise, x, z) {
    // The fjord: a deep channel along z that ends in a valley head to the north
    // and opens to the sea in the south.
    const ax = Math.abs(x + fbm(noise, z * 0.002, 1.7, 3) * 60);
    const head = smoothstep(820, 1250, z);
    const mouth = smoothstep(-950, -1500, z);
    const floor = -35 + head * 70;
    const peaks = 340 + ridged(noise, x * 0.0016, z * 0.0016, 5) * 300;
    const wallStart = 120 + mouth * 400;
    let h = floor + (peaks - floor) * smoothstep(wallStart, wallStart + 520, ax) ** 1.25;
    h += fbm(noise, x * 0.008, z * 0.008, 3) * 10;
    // The valley at the head climbs into the mountains too.
    h += head * smoothstep(0, 700, z - 1000) * 260;
    return h;
  },
  terrainColor(c, x, z, h, slope) {
    if (h < 1) return c.setHex(0x3a4650); // dark shingle
    // Steep faces shed their snow: streaky blue-grey rock, snow only in the
    // gullies (the stripes come from height, so they run down the slope).
    const streak = Math.sin(x * 0.05 + z * 0.031 + Math.sin(h * 0.08) * 2) * 0.5 + 0.5;
    if (slope > 0.36) return ramp(c, [[0, 0x56616c], [0.6, 0x3d4650], [1, 0x9eacb9]], streak * 0.7 + (slope - 0.36));
    if (slope > 0.2) return ramp(c, [[0, 0xb7c4d1], [1, 0x6a7783]], (slope - 0.2) * 6 * (0.6 + streak * 0.4));
    return ramp(c, [[0, 0xc6d2de], [1, 0xe4ebf2]], h / 300);
  },
  props: [
    { kind: 'pine', count: 1300, near: 8, far: 180, scale: [0.8, 1.6], minY: 3, maxY: 220, maxSlope: 0.9, options: { snow: true } },
    { kind: 'pine', count: 700, near: 180, far: 700, scale: [0.8, 1.5], minY: 3, maxY: 260, maxSlope: 0.6, options: { snow: true } },
    { kind: 'boulder', count: 160, near: 12, far: 260, scale: [2, 6], minY: 2, sink: 0.6, options: { color: 0x4f5862 } },
    { kind: 'rock', count: 220, near: 6, far: 400, scale: [0.6, 2.2], minY: 1, sink: 0.3, options: { color: 0x5a636b } },
    { kind: 'lamp', along: 70, offset: 1.5, sides: [1], options: { lightColor: 0xffd9a0 } },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    const rand = mulberry32(ctx.def.seed);

    // Aurora: tall translucent curtains that ripple slowly across the north sky.
    const tex = auroraTexture();
    const curtains = [];
    const mats = [];
    for (let k = 0; k < 4; k++) {
      const segs = 72;
      const width = 2600 + k * 500;
      const geo = new THREE.PlaneGeometry(width, 420 + k * 60, segs, 1);
      const base = Float32Array.from(geo.attributes.position.array);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: k % 2 ? 0x7dffc4 : 0x9cffb0, transparent: true, opacity: 0.0,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(-400 + k * 260, 520 + k * 90, 1500 + k * 420);
      mesh.rotation.y = 0.2 - k * 0.15;
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      g.add(mesh);
      curtains.push({ mesh, base, phase: rand() * 10, speed: 0.06 + rand() * 0.05 });
      mats.push(mat);
    }

    // Icebergs and floes in the channel.
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xd6ecf7, roughness: 0.2, metalness: 0.05, flatShading: true, emissive: 0x16304a, emissiveIntensity: 0.4 });
    const tmp = {};
    let placed = 0;
    for (let n = 0; n < 160 && placed < 46; n++) {
      const x = (rand() - 0.5) * 300;
      const z = -1400 + rand() * 2200;
      const p = ctx.track.project(x, z, -1, tmp);
      const r = 3 + rand() ** 2 * 18;
      if (Math.abs(p.lateral) < ctx.track.wallHalfWidth + r + 25) continue;
      if (ctx.heightFn(x, z) > -6) continue;
      const geo = new THREE.IcosahedronGeometry(r, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        pos.setY(i, y > 0 ? y * (0.4 + rand() * 0.5) : y * 1.6);
        pos.setX(i, pos.getX(i) * (0.85 + rand() * 0.3));
      }
      geo.computeVertexNormals();
      const berg = new THREE.Mesh(geo, iceMat);
      berg.position.set(x, -r * 0.15, z);
      berg.rotation.y = rand() * 6;
      g.add(berg);
      ctx.collide(ctx.sphere(x, 0, z, r));
      placed++;
    }

    // A fishing village of red cabins on the west shore near the causeway.
    const red = std(0x9c2a22, { roughness: 0.85 });
    const roof = std(0x2a2a2c, { roughness: 0.9 });
    const win = new THREE.MeshStandardMaterial({ color: 0x221a10, emissive: 0xffc070, emissiveIntensity: 0 });
    const village = [[-330, -560], [-350, -610], [-310, -650], [-372, -520], [-395, -585], [-345, -700]];
    for (const [x, z] of village) {
      const p = ctx.track.project(x, z, -1, tmp);
      if (Math.abs(p.lateral) < ctx.track.wallHalfWidth + 10) continue;
      const cab = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 5), red);
      body.position.y = 2;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.4, 2.6, 4, 1), roof);
      top.rotation.y = Math.PI / 4;
      top.scale.set(1.2, 1, 0.85);
      top.position.y = 5.3;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), win);
      w.position.set(0, 2.3, 2.51);
      cab.add(body, top, w);
      g.add(plant(cab, ctx, x, z, rand() * 0.6 - 0.3, 0.3));
      solid(ctx, x, z, 4, 4, 7);
    }
    ctx.glow(win, 3);

    // A waterfall spilling off the east wall into the fjord.
    const fallMat = new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    for (const [x, z] of [[470, 120], [-480, 380]]) {
      const top = ctx.heightFn(x, z);
      if (top < 40) continue;
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(10, top), fallMat);
      fall.position.set(x - Math.sign(x) * 30, top / 2, z);
      fall.rotation.y = Math.PI / 2;
      g.add(fall);
    }

    ctx.onUpdate((dt, night, time) => {
      const vis = Math.max(0, night - 0.2) / 0.8;
      for (let k = 0; k < curtains.length; k++) {
        const c = curtains[k];
        const pos = c.mesh.geometry.attributes.position;
        const a = pos.array;
        const tt = time * c.speed + c.phase;
        for (let i = 0; i < pos.count; i++) {
          const x = c.base[i * 3];
          // Fold the curtain into slow travelling waves along its length.
          a[i * 3 + 2] = c.base[i * 3 + 2] + Math.sin(x * 0.0035 + tt * 2.2) * 160 + Math.sin(x * 0.009 - tt * 3.1) * 50;
        }
        pos.needsUpdate = true;
        mats[k].opacity = vis * (0.55 + 0.3 * Math.sin(time * 0.21 + k * 1.7));
      }
    });
    return g;
  },
};

// Vertical gradient: bright green hem at the bottom fading through teal to
// violet at the top, with fine vertical rays.
function auroraTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(120,255,170,0)');
  grad.addColorStop(0.06, 'rgba(140,255,180,0.95)');
  grad.addColorStop(0.35, 'rgba(60,220,170,0.55)');
  grad.addColorStop(0.7, 'rgba(120,90,220,0.25)');
  grad.addColorStop(1, 'rgba(160,80,220,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  // Rays.
  g.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < 256; x += 2) {
    const a = 0.15 + 0.6 * Math.abs(Math.sin(x * 0.37) * Math.sin(x * 0.11 + 1));
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.fillRect(x, 0, 2, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  t.userData.owned = true;
  return t;
}
