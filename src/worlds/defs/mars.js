import * as THREE from 'three';
import { fbm, ridged, smoothstep } from '../noise.js';
import { ramp, std, plant, solid } from './util.js';

// World 6: Mars. Low gravity (3.71 m/s²), loose regolith, a canyon rally
// stage past a crewed habitat. Crests send the car floating.
export default {
  id: 'mars',
  name: 'Red Planet Rally',
  tagline: 'Canyon rally stage on Mars',
  description: 'A third of Earth gravity, loose red dust and a sky the colour of butterscotch. Big crests mean big air.',
  location: 'Mars',
  seed: 6607,
  gravity: 3.71,
  laps: 3,
  goldSpeed: 34,
  music: 'space',
  points: [
    [0, 0, 0], [0, 250, 9], [-80, 480, 22], [-260, 600, 31], [-480, 560, 25],
    [-600, 380, 13], [-560, 160, 9], [-640, -60, 19], [-560, -300, 31], [-340, -420, 21],
    [-120, -380, 10], [40, -220, 4],
  ],
  flight: { altitude: 20, swing: 32, waves: 4, weave: 6, ceiling: 450, goldSpeed: 62 },
  roadWidth: 16,
  runoff: 5,
  roadStyle: 'regolith',
  barrier: 'berm',
  kerbs: false,
  shoulderColor: 0x9a5434,
  atmosphere: 'mars',
  defaultTime: 13,
  sunAzimuth: 70,
  sunSize: 0.008, // the Sun looks smaller from Mars
  fogDensity: 0.0011,
  weathers: ['clear', 'dust'],
  defaultWeather: 'clear',
  groundBounce: 0x8a4a2a,
  terrainBlend: 50,
  surfaces: {
    road: { grip: 0.82, rolling: 0.03 },
    shoulder: { grip: 0.6, rolling: 0.07 },
  },
  terrain(noise, x, z) {
    const base = 12 + fbm(noise, x * 0.003, z * 0.003, 5) * 30;
    // Canyon walls: tall mesas a few hundred metres out.
    const mesas = smoothstep(0.1, 0.25, fbm(noise, x * 0.0016 + 4, z * 0.0016, 3)) * 160;
    const dunes = ridged(noise, x * 0.01, z * 0.004, 3) * 4;
    const r = Math.hypot(x + 300, z - 80);
    const rim = smoothstep(700, 1300, r) * 260 * (0.6 + 0.4 * fbm(noise, x * 0.002, z * 0.002, 4));
    return base + mesas + dunes + rim;
  },
  terrainColor(c, x, z, h, slope) {
    if (slope > 0.5) return ramp(c, [[0, 0x7a3c24], [1, 0x52281a]], slope);
    return ramp(c, [[0, 0xb0603a], [0.5, 0x9c5133], [1, 0x7c3f28]], h / 200 + slope * 0.4);
  },
  props: [
    { kind: 'rock', count: 900, near: 4, far: 700, scale: [0.4, 2.2], sink: 0.2, options: { color: 0x6e3622 } },
    { kind: 'boulder', count: 220, near: 8, far: 900, scale: [2, 9], sink: 0.5, options: { color: 0x7a3e26 } },
    { kind: 'crater', count: 60, near: 30, far: 900, scale: [1, 4], sink: 0.2, maxSlope: 0.2, options: { color: 0x8a4a2e } },
    { kind: 'solarPanel', count: 40, near: 20, far: 120, scale: [1, 1], maxSlope: 0.15, filter: (x, z) => Math.hypot(x - 90, z - 60) < 140 },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    // Habitat cluster near the start: domes linked by tunnels.
    const hab = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.3, metalness: 0.4, emissive: 0x9fd2ff, emissiveIntensity: 0 });
    const sizes = [[0, 0, 12], [30, 10, 8], [-6, 30, 9], [26, -24, 7]];
    for (const [x, z, r] of sizes) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), shell);
      d.position.set(x, 0, z);
      hab.add(d);
    }
    for (const [x, z] of [[15, 5], [-3, 15], [13, -12]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 18, 10), std(0xbfc4c8, { metalness: 0.5 }));
      t.rotation.z = Math.PI / 2;
      t.rotation.y = Math.atan2(z, x);
      t.position.set(x, 1.4, z);
      hab.add(t);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 20, 6), std(0xcccccc, { metalness: 0.8 }));
    mast.position.set(-14, 10, -10);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), std(0xeeeeee, { side: THREE.DoubleSide }));
    dish.position.set(-14, 20, -10);
    dish.rotation.x = -0.9;
    hab.add(mast, dish);
    g.add(plant(hab, ctx, 90, 60));
    for (const [x, z, r] of sizes) {
      const y = ctx.heightFn(90 + x, 60 + z);
      ctx.collide(ctx.sphere(90 + x, y, 60 + z, r));
    }
    solid(ctx, 76, 50, 3.5, 3.5, 23);
    ctx.glow(shell, 0.35);
    // A landed starship-style rocket: tall steel cylinder.
    const ship = new THREE.Group();
    const steel = std(0xc9ccd0, { metalness: 0.9, roughness: 0.25 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 40, 24), steel);
    body.position.y = 24;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(4.5, 10, 24), steel);
    nose.position.y = 49;
    ship.add(body, nose);
    for (let k = 0; k < 3; k++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6, 0.8), steel);
      leg.position.set(Math.cos(k * 2.1) * 4.5, 2.5, Math.sin(k * 2.1) * 4.5);
      leg.rotation.z = Math.cos(k * 2.1) * 0.3;
      leg.rotation.x = -Math.sin(k * 2.1) * 0.3;
      ship.add(leg);
    }
    g.add(plant(ship, ctx, 160, -60));
    solid(ctx, 160, -60, 5.5, 5.5, 54);
    // Dust devil: a slowly travelling column of swirling particles.
    const n = ctx.quality.particles > 1000 ? 600 : 200;
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const devil = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc98b5a, size: 1.4, map: ctx.softDot, transparent: true, opacity: 0.35, depthWrite: false }));
    devil.frustumCulled = false;
    g.add(devil);
    ctx.onUpdate((dt, night, t) => {
      const cx = -300 + Math.sin(t * 0.03) * 250;
      const cz = 100 + Math.cos(t * 0.021) * 300;
      const base = ctx.heightFn(cx, cz);
      for (let i = 0; i < n; i++) {
        const h = (i / n) * 90;
        const a = t * 2.5 + i * 0.7;
        const r = 2 + h * 0.18;
        pos[i * 3] = cx + Math.cos(a) * r;
        pos[i * 3 + 1] = base + h;
        pos[i * 3 + 2] = cz + Math.sin(a) * r;
      }
      geo.attributes.position.needsUpdate = true;
    });
    return g;
  },
};
