import * as THREE from 'three';
import { fbm, ridged, smoothstep } from '../noise.js';
import { ramp, std, plant } from './util.js';

// World 1: a clifftop coastal road at golden hour. The starter world:
// wide, flowing, forgiving, and gorgeous at sunset.
export default {
  id: 'coast',
  name: 'Cypress Coast',
  tagline: 'Clifftop highway above the Pacific',
  description: 'Sweeping bends along sea cliffs, cypress groves and a lighthouse on the point. Learn the car here.',
  location: 'Earth',
  seed: 1201,
  gravity: 9.81,
  laps: 3,
  goldSpeed: 41, // average m/s needed for a gold medal
  unlock: 0, // total stars needed
  music: 'chill',
  points: [
    [0, 0, 40], [0, 200, 42], [-40, 380, 45], [-160, 500, 50], [-320, 540, 48],
    [-430, 470, 44], [-470, 320, 38], [-430, 160, 30], [-490, 0, 26], [-525, -180, 30],
    [-430, -340, 36], [-260, -390, 40], [-120, -310, 42], [-50, -160, 41],
  ],
  roadWidth: 15,
  runoff: 4,
  roadStyle: 'highway',
  barrier: 'guardrail',
  kerbColors: ['#c7262b', '#f2f2f2'],
  shoulderColor: 0x7d7a62,
  atmosphere: 'earth',
  defaultTime: 18.3,
  sunAzimuth: 200, // sun sets over the ocean (west)
  fogDensity: 0.0009,
  weathers: ['clear', 'cloudy', 'fog', 'rain', 'storm'],
  defaultWeather: 'clear',
  water: { level: 0, color: 0x1f4f6b },
  terrainBlend: 50,
  terrain(noise, x, z) {
    const hills = 34 + fbm(noise, x * 0.0022, z * 0.0022, 5) * 40 + ridged(noise, x * 0.004 + 9, z * 0.004, 4) * 30;
    // Coastline wanders; west of it the land falls away in cliffs to the sea.
    const coast = -640 + fbm(noise, z * 0.003, 3.3, 3) * 90;
    const cliff = smoothstep(coast + 40, coast - 40, x);
    const seabed = -25 + fbm(noise, x * 0.01, z * 0.01, 2) * 6;
    // Inland, hills rise into a ridge for a backdrop.
    const inland = smoothstep(150, 900, x) * 120 * (0.6 + 0.4 * fbm(noise, x * 0.003, z * 0.003 + 5, 3));
    return hills * (1 - cliff) + seabed * cliff + inland;
  },
  terrainColor(c, x, z, h, slope) {
    if (h < 2) return c.setHex(0xc2b28c); // sand at the waterline
    if (slope > 0.45) return ramp(c, [[0, 0x7f7466], [1, 0x5e554c]], slope); // cliff rock
    return ramp(c, [[0, 0x8c8a52], [0.4, 0x6f7a3e], [0.8, 0x52633a], [1, 0x8a8560]], h / 120 + slope * 0.6);
  },
  props: [
    { kind: 'cypress', count: 520, near: 8, far: 420, scale: [0.8, 1.4], minY: 6, maxSlope: 0.5 },
    { kind: 'oak', count: 260, near: 14, far: 700, scale: [0.8, 1.3], minY: 8, maxSlope: 0.4 },
    { kind: 'shrub', count: 900, near: 4, far: 300, scale: [0.6, 1.8], minY: 3 },
    { kind: 'boulder', count: 180, near: 6, far: 500, scale: [1, 4], sink: 0.3, options: { color: 0x7a7066 } },
    { kind: 'rock', count: 160, near: 30, far: 900, scale: [3, 9], maxY: 6, sink: 0.4, options: { color: 0x5f5850 } },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    // Lighthouse on the headland west of the track.
    const lh = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 22, 16), std(0xf3f1ea));
    tower.position.y = 11;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.75, 4, 16), std(0xb3262d));
    band.position.y = 12;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.6, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c4, emissiveIntensity: 0 }));
    lamp.position.y = 23.3;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 12), std(0x2a2b2e, { metalness: 0.6 }));
    cap.position.y = 25.8;
    const house = new THREE.Mesh(new THREE.BoxGeometry(8, 4.5, 6), std(0xe9e4da));
    house.position.set(6, 2.25, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.4, 4), std(0x6e3328));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(6, 5.6, 0);
    lh.add(tower, band, lamp, cap, house, roof);
    g.add(plant(lh, ctx, -600, 260));
    ctx.glow(lamp.material, 5);
    // Rotating beam.
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(6, 120, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff3c8, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.geometry.translate(0, -60, 0);
    beam.rotation.z = Math.PI / 2;
    const pivot = new THREE.Group();
    pivot.position.set(0, 23.3, 0);
    pivot.add(beam);
    lh.add(pivot);
    ctx.onUpdate((dt, night) => {
      pivot.rotation.y += dt * 0.9;
      beam.visible = night > 0.3;
    });
    return g;
  },
};
