import * as THREE from 'three';
import { fbm, smoothstep } from '../noise.js';
import { mixHex, std, plant } from './util.js';

// World 5: a coastal rocket launch complex. Fast flowing loop around the
// pad; at the end of the season the rocket lifts off and opens the way to
// Mars. A nod to the real Roadster that was launched into space in 2018.
export default {
  id: 'launch',
  name: 'Launch Complex 39',
  tagline: 'Race around a rocket on the pad',
  description: 'Flat, fast and humid. Palm-lined causeways, lagoons and a rocket waiting on the pad. Win here to earn a ride to Mars.',
  location: 'Earth',
  seed: 5503,
  gravity: 9.81,
  laps: 3,
  goldSpeed: 47,
  unlock: 39, // total stars needed (matches the career's 4 events x 3 stars per world)
  music: 'epic',
  points: [
    [0, 0, 2], [40, 300, 2], [150, 520, 3], [380, 620, 3], [640, 560, 3], [760, 360, 3],
    [700, 120, 2], [520, 20, 2], [480, -180, 2], [620, -380, 3], [480, -560, 3],
    [200, -560, 2], [40, -380, 2], [-20, -200, 2],
  ],
  roadWidth: 16,
  runoff: 5,
  roadStyle: 'race',
  barrier: 'concrete',
  barrierColor: 0xe6e3dc,
  kerbColors: ['#1d4fd8', '#f2f2f2'],
  shoulderColor: 0x7b8a58,
  atmosphere: 'earth',
  defaultTime: 7.2,
  sunAzimuth: -20,
  fogDensity: 0.0011,
  weathers: ['clear', 'cloudy', 'rain', 'storm', 'fog'],
  defaultWeather: 'clear',
  water: { level: 0, color: 0x23585e },
  terrainBlend: 35,
  terrain(noise, x, z) {
    const land = 1.6 + fbm(noise, x * 0.004, z * 0.004, 4) * 2.2;
    // Lagoons cut into the land, and the Atlantic lies to the east.
    const lagoon = smoothstep(0.15, 0.4, fbm(noise, x * 0.0025 + 7, z * 0.0025, 3)) * 5;
    const ocean = smoothstep(1050, 1200, x + fbm(noise, z * 0.002, 1, 3) * 120) * 14;
    return land - lagoon - ocean;
  },
  terrainColor(c, x, z, h) {
    if (h < 0.6) return c.setHex(0xb9ad8a);
    return mixHex(c, 0x6f8a45, 0x52683a, (h - 0.6) / 4);
  },
  props: [
    { kind: 'palm', count: 520, near: 5, far: 500, scale: [0.8, 1.3], minY: 0.8 },
    { kind: 'shrub', count: 900, near: 4, far: 600, scale: [0.6, 1.6], minY: 0.6 },
    { kind: 'lamp', along: 60, offset: 1, sides: [-1], skipNearStart: true, options: { lightColor: 0xffe2b0 } },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    // Launch pad: tower, rocket, flame trench, lightning masts.
    const pad = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(70, 6, 70), std(0xb8b4aa));
    deck.position.y = 3;
    pad.add(deck);
    const steel = std(0x8d3a2a, { metalness: 0.5, roughness: 0.6 });
    const tower = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 90, 0.8), steel);
      leg.position.set((k % 2) * 8 - 4, 51, Math.floor(k / 2) * 8 - 4);
      tower.add(leg);
    }
    for (let y = 10; y < 96; y += 6) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 9), steel);
      ring.position.y = y;
      tower.add(ring);
    }
    tower.position.set(-14, 0, 0);
    pad.add(tower);
    // The rocket: white body, black interstage, two-stage stack.
    const rocket = new THREE.Group();
    const white = std(0xf4f4f2, { roughness: 0.35, metalness: 0.2 });
    const black = std(0x1b1b1d, { roughness: 0.5 });
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 48, 24), white);
    s1.position.y = 30;
    const inter = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 5, 24), black);
    inter.position.y = 56.5;
    const s2 = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 14, 24), white);
    s2.position.y = 66;
    const fairing = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 4.6, 14, 24), white);
    fairing.position.y = 80;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 4, 24), black);
    legs.position.y = 8;
    rocket.add(s1, inter, s2, fairing, legs);
    pad.add(rocket);
    for (const [mx, mz] of [[30, 30], [-30, -30], [30, -30]]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 110, 6), std(0x9a9a9a, { metalness: 0.7 }));
      mast.position.set(mx, 55, mz);
      pad.add(mast);
    }
    g.add(plant(pad, ctx, 330, 270));
    // Vehicle assembly building on the horizon.
    const vab = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(160, 160, 130), std(0xd9d6cf));
    box.position.y = 80;
    const flagPanel = new THREE.Mesh(new THREE.BoxGeometry(2, 60, 40), std(0x2d4a8a));
    flagPanel.position.set(81, 100, -30);
    vab.add(box, flagPanel);
    g.add(plant(vab, ctx, -700, 200, 0.2));
    // Pad lights at night.
    const padGlow = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d0, emissiveIntensity: 0 });
    for (let k = 0; k < 6; k++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.3), padGlow);
      l.position.set(330 + Math.cos(k) * 38, ctx.heightFn(330, 270) + 14 + k * 9, 270 + Math.sin(k) * 38);
      g.add(l);
    }
    ctx.glow(padGlow, 6);
    ctx.onUpdate((dt, night, t) => {
      // Venting oxygen: a gentle bob of the rocket during the countdown cycle.
      rocket.position.y = Math.sin(t * 0.5) * 0.02;
    });
    return g;
  },
};
