import * as THREE from 'three';
import { fbm, ridged } from '../noise.js';
import { ramp, std, plant } from './util.js';

// World 7: the Moon. 1.62 m/s² gravity, black sky, Earth hanging over the
// horizon. The finale: every crest is a long, floaty jump.
export default {
  id: 'moon',
  name: 'Tranquility Ring',
  tagline: 'Low-gravity loop on the Moon',
  description: 'One sixth of Earth gravity and no air. Hang time is measured in seconds. Earth watches from the sky.',
  location: 'Moon',
  seed: 7717,
  gravity: 1.62,
  laps: 3,
  goldSpeed: 32,
  unlock: { stars: 15 },
  music: 'space',
  points: [
    [0, 0, 0], [60, 260, 12], [220, 440, 26], [460, 480, 20], [640, 360, 6],
    [660, 120, 14], [560, -80, 28], [600, -300, 18], [440, -480, 6], [180, -460, 16],
    [20, -300, 8], [-30, -140, 2],
  ],
  roadWidth: 16,
  runoff: 5,
  roadStyle: 'dirt',
  barrier: 'berm',
  barrierColor: 0x8d8a85,
  kerbs: false,
  shoulderColor: 0x8a8782,
  atmosphere: 'space',
  defaultTime: 10,
  sunAzimuth: 140,
  sunTilt: 20,
  sunSize: 0.012,
  fogDensity: 0.00012,
  weathers: ['clear'],
  defaultWeather: 'clear',
  ambientScale: 1.3,
  groundBounce: 0x6d6b68,
  skyBody: { kind: 'earth', fixed: [-0.4, 0.35, -0.85] },
  terrainBlend: 45,
  surfaces: {
    road: { grip: 0.78, rolling: 0.025 },
    shoulder: { grip: 0.55, rolling: 0.06 },
  },
  terrain(noise, x, z) {
    const base = 8 + fbm(noise, x * 0.0025, z * 0.0025, 5) * 26;
    const highlands = ridged(noise, x * 0.0012 + 2, z * 0.0012, 5) * 320 * Math.min(1, Math.max(0, (Math.hypot(x - 320, z) - 650) / 700));
    // Craters: a few big bowls with raised rims.
    let crater = 0;
    for (const [cx, cz, r] of [[320, 0, 150], [-350, 300, 220], [900, -500, 260], [300, 800, 180]]) {
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d < 1.6) crater += d < 1 ? (d * d - 1) * r * 0.18 : Math.exp(-((d - 1) * 4) ** 2) * r * 0.08;
    }
    return base + highlands + crater;
  },
  terrainColor(c, x, z, h, slope) {
    return ramp(c, [[0, 0x6f6d69], [0.5, 0x8c8a85], [1, 0xa8a59f]], 0.4 + h / 400 + slope * 0.3);
  },
  props: [
    { kind: 'rock', count: 1000, near: 4, far: 700, scale: [0.3, 1.8], sink: 0.2, options: { color: 0x77746f } },
    { kind: 'boulder', count: 200, near: 8, far: 900, scale: [2, 8], sink: 0.5, options: { color: 0x8a8782 } },
    { kind: 'crater', count: 140, near: 20, far: 900, scale: [0.5, 3], sink: 0.2, maxSlope: 0.2, options: { color: 0x7a7874 } },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    // Lunar base: modules, a lander and a flag.
    const base = new THREE.Group();
    const mod = std(0xe9e9e6, { metalness: 0.3, roughness: 0.4, emissive: 0xfff2d8, emissiveIntensity: 0 });
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 14, 16), mod);
      m.rotation.z = Math.PI / 2;
      m.rotation.y = k * 0.8;
      m.position.set(Math.cos(k * 0.8) * 12, 4, Math.sin(k * 0.8) * 12);
      base.add(m);
    }
    const lander = new THREE.Group();
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 2.4, 8), std(0xc8a24a, { metalness: 0.8, roughness: 0.3 }));
    stage.position.y = 2.2;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 2.6), std(0xd2d2d0));
    cabin.position.y = 4.6;
    lander.add(stage, cabin);
    for (let k = 0; k < 4; k++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 6), std(0xaaaaaa));
      leg.position.set(Math.cos(k * Math.PI / 2 + 0.78) * 3.2, 1.2, Math.sin(k * Math.PI / 2 + 0.78) * 3.2);
      leg.rotation.set(Math.sin(k * Math.PI / 2 + 0.78) * 0.4, 0, -Math.cos(k * Math.PI / 2 + 0.78) * 0.4);
      lander.add(leg);
    }
    lander.position.set(-30, 0, 18);
    base.add(lander);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), std(0xdddddd));
    pole.position.set(-22, 1.5, 6);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), std(0xffffff, { side: THREE.DoubleSide, map: ctx.sign('ROADSTER', '#ffffff', '#111111', '#e31937') }));
    flag.position.set(-21.2, 2.5, 6);
    base.add(pole, flag);
    g.add(plant(base, ctx, -90, 120));
    ctx.glow(mod, 0.5);
    return g;
  },
};
