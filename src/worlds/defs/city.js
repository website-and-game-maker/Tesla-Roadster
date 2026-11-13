import * as THREE from 'three';
import { fbm, smoothstep } from '../noise.js';
import { roundedPolygon, mixHex, std, plant, solid } from './util.js';

// World 3: a downtown street circuit at night. Tight 90-degree corners,
// wet asphalt reflecting neon, glass towers lit window by window.
export default {
  id: 'city',
  name: 'Neon Downtown',
  tagline: 'Night street circuit between glass towers',
  description: 'Concrete walls, right-angle corners and neon everywhere. Precision beats bravery here, especially in the rain.',
  location: 'Earth',
  seed: 3301,
  gravity: 9.81,
  laps: 3,
  goldSpeed: 33,
  music: 'synthwave',
  points: roundedPolygon([
    [0, -200, 0], [0, 400, 2], [-200, 400, 4], [-200, 700, 8], [200, 700, 9],
    [200, 550, 7], [450, 550, 5], [450, 150, 2], [250, 150, 1], [250, -200, 0],
  ], 32, 50),
  flight: { altitude: 30, swing: 50, waves: 5, weave: 5, weaveWaves: 7, ceiling: 380, goldSpeed: 60, keys: [{ u: 0.25, alt: 7, width: 0.025 }, { u: 0.62, alt: 7, width: 0.025 }] },
  roadWidth: 15,
  runoff: 2.5,
  roadStyle: 'city',
  barrier: 'concrete',
  barrierColor: 0xd6d3cb,
  kerbColors: ['#e8e8e8', '#2b2b2b'],
  shoulderColor: 0x8f8d88,
  atmosphere: 'earth',
  defaultTime: 22.5,
  sunAzimuth: 120,
  fogDensity: 0.0016,
  weathers: ['clear', 'rain', 'fog', 'storm'],
  defaultWeather: 'rain',
  ambientScale: 3.2,
  groundBounce: 0x3a3550,
  terrainBlend: 20,
  terrainRoughness: 0.75,
  terrain(noise, x, z) {
    // Mostly flat city ground that rises gently into hills far away.
    const r = Math.hypot(x - 125, z - 250);
    return fbm(noise, x * 0.004, z * 0.004, 2) * 1.5 + smoothstep(900, 2000, r) * 160 * (0.5 + 0.5 * fbm(noise, x * 0.002, z * 0.002, 3));
  },
  terrainColor(c, x, z, h) {
    // Pavement/plaza grey near the city, darker hills beyond.
    return mixHex(c, 0x6c6b68, 0x2f3a2e, (h - 2) / 40);
  },
  props: [
    { kind: 'lamp', along: 30, offset: 0.6, sides: [-1, 1], skipNearStart: true },
    { kind: 'neon', along: 90, offset: 4, sides: [1], skipNearStart: true, options: { palette: [0xff2f92, 0x2ff3ff, 0xb14bff, 0xffd23f, 0x39ff88] } },
    { kind: 'building', count: 160, near: 22, far: 230, footprint: 19, scale: [0.9, 1.15], maxY: 6, options: { w: 26, h: 62, d: 26, seed: 3 } },
    { kind: 'building', count: 110, near: 26, far: 400, footprint: 24, scale: [0.9, 1.1], maxY: 8, options: { w: 34, h: 120, d: 30, seed: 4, tint: 0xc9d8ff } },
    { kind: 'building', count: 50, near: 60, far: 600, footprint: 30, scale: [0.9, 1.1], maxY: 10, options: { w: 40, h: 210, d: 40, seed: 5, tint: 0xa8c4e8 } },
    { kind: 'building', count: 240, near: 16, far: 160, footprint: 13, scale: [0.8, 1.2], maxY: 6, options: { w: 18, h: 26, d: 18, seed: 6, tint: 0xe8d6c4 } },
    { kind: 'oak', count: 120, near: 6, far: 60, scale: [0.6, 0.9], maxY: 6 },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    // A spire tower in the middle of the circuit, beacon on top.
    const spire = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(10, 18, 260, 8), std(0x9fb2c8, { metalness: 0.8, roughness: 0.2 }));
    body.position.y = 130;
    const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2, 60, 6), std(0xcccccc, { metalness: 0.9 }));
    needle.position.y = 290;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 3 }));
    beacon.position.y = 321;
    spire.add(body, needle, beacon);
    g.add(plant(spire, ctx, 125, 300));
    solid(ctx, 125, 300, 18, 18, 324);
    ctx.onUpdate((dt, night, t) => {
      beacon.visible = Math.sin(t * 3) > 0;
    });
    // A billboard over the back straight.
    const bb = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshStandardMaterial({ map: ctx.sign('ELECTRIC NIGHTS', '#14082a', '#ffffff', '#ff2f92'), emissive: 0xffffff, emissiveMap: ctx.sign('ELECTRIC NIGHTS', '#14082a', '#ffffff', '#ff2f92'), emissiveIntensity: 1.2 }));
    panel.position.y = 24;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(1, 20, 1), std(0x333333));
    legs.position.y = 9;
    bb.add(panel, legs);
    g.add(plant(bb, ctx, 300, 600, Math.PI));
    solid(ctx, 300, 600, 20, 1, 30);
    return g;
  },
};
