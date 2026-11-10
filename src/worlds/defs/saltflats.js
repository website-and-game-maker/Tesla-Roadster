import * as THREE from 'three';
import { fbm, ridged, smoothstep } from '../noise.js';
import { mixHex, std, plant } from './util.js';

// World 2: a dry lake bed built for top speed. Huge straights, mountains on
// the horizon, heat shimmer and the odd dust storm.
export default {
  id: 'saltflats',
  name: 'Salt Flats Speedway',
  tagline: 'Two-kilometre straights on a dry lake',
  description: 'The flattest place on Earth. Long straights to max out the Roadster, fast sweepers to test your nerve.',
  location: 'Earth',
  seed: 2207,
  gravity: 9.81,
  laps: 2,
  goldSpeed: 62,
  unlock: { stars: 1 },
  music: 'drive',
  points: [
    [0, 0, 0], [0, 450, 0], [0, 900, 0], [60, 1300, 0], [260, 1500, 0], [560, 1520, 0],
    [780, 1350, 0], [820, 1000, 0], [700, 700, 0], [760, 400, 0], [820, 0, 0],
    [760, -400, 0], [560, -560, 0], [260, -560, 0], [60, -400, 0],
  ],
  roadWidth: 18,
  runoff: 6,
  roadStyle: 'race',
  barrier: 'tyres',
  kerbColors: ['#1d4fd8', '#f2f2f2'],
  shoulderColor: 0xd9d3c4,
  atmosphere: 'earth',
  defaultTime: 15.5,
  sunAzimuth: 30,
  fogDensity: 0.00045,
  weathers: ['clear', 'cloudy', 'dust', 'storm'],
  defaultWeather: 'clear',
  terrainBlend: 30,
  terrainRoughness: 0.85,
  terrain(noise, x, z) {
    const cx = x - 410;
    const cz = z - 480;
    const r = Math.hypot(cx, cz);
    const flat = fbm(noise, x * 0.01, z * 0.01, 3) * 0.25;
    // Mountain ring a couple of kilometres out.
    const ring = smoothstep(1300, 2200, r + fbm(noise, x * 0.002, z * 0.002, 3) * 300);
    const mountains = ridged(noise, x * 0.0016, z * 0.0016, 5) * 420 + fbm(noise, x * 0.004, z * 0.004, 4) * 60;
    return flat + ring * mountains;
  },
  terrainColor(c, x, z, h) {
    if (h < 3) return mixHex(c, 0xe9e3d6, 0xd3c9b5, (h + 0.25) * 1.8 + Math.sin(x * 0.02) * 0.05);
    return mixHex(c, 0xb48a62, 0x7d5b45, h / 350);
  },
  props: [
    { kind: 'rock', count: 120, near: 900, scale: [6, 20], minY: 4, sink: 0.4, options: { color: 0x8b6a52 } },
    { kind: 'shrub', count: 300, near: 1000, scale: [0.6, 1.4], minY: 2, options: {} },
    { kind: 'windTurbine', count: 16, near: 1200, far: 1700, scale: [1, 1.2], minY: 0, maxSlope: 0.25 },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    // Timing tower and grandstand by the start straight.
    const stand = new THREE.Group();
    const seats = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 120), std(0x9aa0a8, { metalness: 0.4 }));
    seats.position.set(0, 4, 0);
    seats.rotation.z = -0.35;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 124), std(0xe8e8e8));
    roof.position.set(-2, 11, 0);
    stand.add(seats, roof);
    for (let k = -2; k <= 2; k++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 11, 0.5), std(0x6b6f75, { metalness: 0.6 }));
      post.position.set(-8, 5.5, k * 28);
      stand.add(post);
    }
    g.add(plant(stand, ctx, -40, 200));
    const tower = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(5, 30, 5), std(0x24262b, { metalness: 0.5 }));
    shaft.position.y = 15;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 7), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb02e, emissiveIntensity: 0.6 }));
    board.position.set(-3, 24, 0);
    tower.add(shaft, board);
    g.add(plant(tower, ctx, -38, 360));
    // A giant white factory on the horizon, the kind that builds cars.
    const fac = new THREE.Group();
    const hall = new THREE.Mesh(new THREE.BoxGeometry(900, 40, 260), std(0xf4f4f2, { roughness: 0.5 }));
    hall.position.y = 20;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(902, 4, 262), std(0xc8202f));
    stripe.position.y = 34;
    fac.add(hall, stripe);
    g.add(plant(fac, ctx, 1400, -250, 0.4));
    return g;
  },
};
