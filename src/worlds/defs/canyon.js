import * as THREE from 'three';
import { fbm, ridged, smoothstep, mulberry32 } from '../noise.js';
import { ramp, std } from './util.js';

// Sky world: a river canyon carved into a red-rock plateau. The course
// hugs the river between sheer terraced walls, threads natural stone
// arches, and twice bursts out over the rim before diving back in.
// Flight only.

// A winding loop: a wobbly circle, so the canyon snakes around.
function makePath() {
  const pts = [];
  const n = 26;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 820 + Math.sin(a * 3 + 0.6) * 170 + Math.sin(a * 7) * 45;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r - 820;
    // Low between the walls, two bursts over the rim.
    let y = 34 + Math.sin(a * 5) * 12;
    for (const pop of [0.3, 0.72]) {
      const d = Math.abs(k / n - pop);
      y += 205 * Math.exp(-((d / 0.045) ** 2));
    }
    pts.push([x, z, y]);
  }
  return pts;
}
const PATH = makePath();
const FLOOR = 4;
const RIM = 170;

// Arches across the canyon at these points of the course (0..1).
const ARCHES = [0.12, 0.47, 0.6, 0.88];

export default {
  id: 'canyon',
  name: 'Red Rock Run',
  tagline: 'Low-level canyon run under stone arches',
  description: 'Skim a desert river between 170 m walls, slip under natural arches and pop out over the rim. Pure flight.',
  location: 'Earth',
  modes: ['flight'],
  noRoad: true,
  terrainUsesTrack: true,
  seed: 8203,
  gravity: 9.81,
  laps: 2,
  music: 'epic',
  points: PATH,
  flight: { points: PATH, ringRadius: 9, ceiling: 480, laps: 2, goldSpeed: 66, clearance: 3 },
  roadWidth: 30,
  runoff: 0,
  kerbs: false,
  atmosphere: 'earth',
  defaultTime: 16.8,
  sunAzimuth: 40,
  sunTilt: 50,
  fogDensity: 0.0005,
  weathers: ['clear', 'cloudy', 'dust', 'storm'],
  defaultWeather: 'clear',
  water: { level: FLOOR + 1.2, color: 0x3d6b62 },
  groundBounce: 0x9a5a3a,
  terrain(noise, x, z, p) {
    const d = Math.abs(p.lateral);
    // Canyon width wobbles; walls step down in sandstone terraces.
    const half = 38 + fbm(noise, x * 0.004, z * 0.004, 3) * 14;
    let k = smoothstep(half, half + 95, d);
    const steps = 6;
    const terr = Math.floor(k * steps) / steps;
    k = terr + (k * steps - Math.floor(k * steps)) ** 4 / steps;
    const floor = FLOOR + fbm(noise, x * 0.02, z * 0.02, 2) * 1.5;
    const rim = RIM + fbm(noise, x * 0.002, z * 0.002, 4) * 30;
    // Mesas and buttes on the plateau.
    const buttes = smoothstep(0.25, 0.4, fbm(noise, x * 0.003 + 5, z * 0.003, 3)) * 90 * smoothstep(250, 400, d);
    const ridges = ridged(noise, x * 0.0015, z * 0.0015, 4) * 60 * smoothstep(600, 1400, d);
    return floor + (rim - floor) * k + buttes + ridges;
  },
  terrainColor(c, x, z, h, slope) {
    // Sandstone bands by height, darker varnish on cliffs.
    const band = Math.sin(h * 0.32) * 0.5 + 0.5;
    if (h < FLOOR + 3) return c.setHex(0xb59a72);
    if (slope > 0.45) return ramp(c, [[0, 0xa04a2a], [0.5, 0xb85e36], [1, 0x7e3a22]], band * 0.6 + slope * 0.4);
    return ramp(c, [[0, 0xc78a5a], [0.5, 0xb87048], [1, 0xa86a44]], band);
  },
  props: [
    { kind: 'boulder', count: 220, near: -14, far: 60, scale: [2, 6], sink: 0.6, maxY: 40, options: { color: 0x8a4a2e } },
    { kind: 'shrub', count: 600, near: 200, far: 900, scale: [0.6, 1.4], minY: 150, options: {} },
    { kind: 'cactus', count: 160, near: 200, far: 800, scale: [0.9, 1.3], minY: 150 },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    const rock = std(0xa8522e, { flatShading: true, roughness: 1 });
    const t = ctx.track;
    const rand = mulberry32(ctx.def.seed);
    for (const u of ARCHES) {
      const i = Math.floor(u * t.count);
      const x = t.pos[i * 3];
      const y = t.pos[i * 3 + 1];
      const z = t.pos[i * 3 + 2];
      const heading = Math.atan2(t.fwd[i * 3], t.fwd[i * 3 + 2]);
      // Arch spans the canyon with its underside well above the ring.
      const tube = 7 + rand() * 3;
      const radius = y - FLOOR + 9 + 9 + tube;
      const geo = new THREE.TorusGeometry(radius, tube, 7, 28, Math.PI);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const n = Math.sin(pos.getX(k) * 0.3 + pos.getY(k) * 0.2) * 1.4;
        pos.setZ(k, pos.getZ(k) * 1.6 + n);
      }
      geo.computeVertexNormals();
      const arch = new THREE.Mesh(geo, rock);
      arch.position.set(x, FLOOR, z);
      arch.rotation.y = heading;
      arch.castShadow = ctx.quality.shadows;
      g.add(arch);
      ctx.gate(x, y, z);
      for (let a = 0; a <= Math.PI + 1e-6; a += Math.PI / 24) {
        const lx = Math.cos(a) * radius;
        const ly = Math.sin(a) * radius;
        // Three rows, because the arch is stretched 1.6x along the course.
        for (const f of [-0.8, 0, 0.8]) {
          const fx = Math.sin(heading) * f * tube;
          const fz = Math.cos(heading) * f * tube;
          ctx.collide(ctx.sphere(x + Math.cos(heading) * lx + fx, FLOOR + ly, z - Math.sin(heading) * lx + fz, tube));
        }
      }
    }
    return g;
  },
};
