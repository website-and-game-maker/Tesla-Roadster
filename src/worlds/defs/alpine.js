import * as THREE from 'three';
import { fbm, ridged, smoothstep } from '../noise.js';
import { ramp, std, plant } from './util.js';

// World 4: a mountain pass. Hairpin switchbacks climb 110 m to a summit
// road with views over glaciers, then a fast descent back to the valley.
export default {
  id: 'alpine',
  name: 'Glacier Pass',
  tagline: 'Hairpins up a snowy mountain pass',
  description: 'Three switchbacks to the summit and a flat-out descent. Snow and ice make the grip drop when the weather turns.',
  location: 'Earth',
  seed: 4409,
  gravity: 9.81,
  laps: 2,
  goldSpeed: 30,
  unlock: 27, // total stars needed (matches the career's 4 events x 3 stars per world)
  music: 'epic',
  points: [
    [0, 0, 0], [0, 150, 8], [0, 290, 19], [15, 365, 24], [60, 398, 27], [105, 365, 30],
    [120, 290, 34], [120, 180, 41], [120, 100, 45], [135, 30, 48], [180, -2, 50], [225, 30, 52],
    [240, 100, 56], [240, 250, 65], [252, 400, 76], [310, 520, 90], [420, 610, 104], [410, 720, 110],
    [270, 785, 106], [80, 765, 96], [-80, 700, 84], [-200, 580, 70], [-240, 420, 56], [-230, 250, 40],
    [-200, 80, 24], [-170, -80, 12], [-90, -175, 4], [0, -130, 0],
  ],
  roadWidth: 14,
  runoff: 3,
  roadStyle: 'mountain',
  barrier: 'guardrail',
  kerbColors: ['#d0262b', '#f2f2f2'],
  shoulderColor: 0x8a877d,
  atmosphere: 'earth',
  defaultTime: 10.5,
  sunAzimuth: 60,
  sunTilt: 45,
  fogDensity: 0.0007,
  weathers: ['clear', 'cloudy', 'snow', 'fog'],
  defaultWeather: 'clear',
  terrainBlend: 40,
  skirtWidth: 18,
  terrain(noise, x, z) {
    const valley = 10 + fbm(noise, x * 0.003, z * 0.003, 4) * 25;
    // Mountains rise steeply away from the pass area.
    const cx = x - 100;
    const cz = z - 300;
    const r = Math.hypot(cx, cz);
    const peaks = ridged(noise, x * 0.0019 + 3, z * 0.0019, 6) * 900 * smoothstep(380, 1500, r);
    const slopes = smoothstep(200, 700, r) * 140 * (0.6 + 0.4 * fbm(noise, x * 0.004, z * 0.004, 3));
    // Overall the land tilts up to the north like the road does.
    return valley + peaks + slopes + z * 0.08;
  },
  terrainColor(c, x, z, h, slope) {
    const snowLine = 150 + Math.sin(x * 0.01) * 20;
    if (h > snowLine && slope < 0.55) return ramp(c, [[0, 0xdfe6ee], [1, 0xf7f9fc]], (h - snowLine) / 300);
    if (slope > 0.5) return ramp(c, [[0, 0x6f6c68], [1, 0x4c4a48]], slope);
    return ramp(c, [[0, 0x5b6b3b], [0.6, 0x4a5a33], [1, 0x7b7b6a]], h / snowLine + slope);
  },
  props: [
    { kind: 'pine', count: 1300, near: 6, far: 700, scale: [0.8, 1.6], maxY: 150, maxSlope: 0.7, options: {} },
    { kind: 'pine', count: 300, near: 10, far: 900, scale: [0.8, 1.4], minY: 150, maxY: 240, maxSlope: 0.6, options: { snow: true } },
    { kind: 'boulder', count: 260, near: 5, far: 800, scale: [1, 5], sink: 0.4, options: { color: 0x7a7670 } },
    { kind: 'ice', count: 40, near: 300, far: 1400, scale: [10, 26], minY: 220, sink: 2 },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    // Summit hut with a flag at the top of the pass.
    const hut = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 8), std(0x7a5636));
    walls.position.y = 2.5;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 7.5, 4, 4, 1), std(0xe6edf3));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.15, 1, 0.75);
    roof.position.y = 7;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 10, 6), std(0xdddddd, { metalness: 0.7 }));
    pole.position.set(9, 5, 0);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6, 8, 1), std(0xd8262b, { side: THREE.DoubleSide }));
    flag.position.set(10.3, 9.1, 0);
    hut.add(walls, roof, pole, flag);
    g.add(plant(hut, ctx, 470, 700, -0.6));
    const base = flag.geometry.attributes.position.array.slice();
    ctx.onUpdate((dt, night, t) => {
      const p = flag.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3];
        p.setZ(i, Math.sin(t * 6 + x * 2.2) * 0.18 * (x + 1.3));
      }
      p.needsUpdate = true;
    });
    // Rock tunnel portal look: a stone arch over the road near the summit.
    const i = Math.floor(ctx.track.count * 0.62);
    const x = ctx.track.pos[i * 3];
    const y = ctx.track.pos[i * 3 + 1];
    const z = ctx.track.pos[i * 3 + 2];
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(ctx.track.wallHalfWidth + 2, 2.2, 6, 16, Math.PI),
      std(0x6a6560, { flatShading: true }),
    );
    arch.position.set(x, y, z);
    arch.rotation.y = Math.atan2(ctx.track.fwd[i * 3], ctx.track.fwd[i * 3 + 2]);
    arch.castShadow = ctx.quality.shadows;
    g.add(arch);
    return g;
  },
};
