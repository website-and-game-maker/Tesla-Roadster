import * as THREE from 'three';
import { mulberry32 } from '../noise.js';
import { std } from './util.js';

// The finale: a racing ring bolted around Starline Station, high above the
// storm bands of a gas giant. Spin gravity is a little over half of Earth's,
// so hops hang long; the ring's deck is open truss, broken by long gaps
// between modules. Off the deck is open space.

const DECK = 60;

function makeRoad() {
  const pts = [];
  const n = 32;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 540 + Math.sin(a * 3 + 0.5) * 70 + Math.sin(a * 2) * 40;
    pts.push([Math.sin(a) * r, Math.cos(a) * r, DECK + Math.sin(a * 2 + 1) * 16 + Math.sin(a * 5) * 4]);
  }
  return pts;
}
const ROAD = makeRoad();

const GAPS = [
  { at: 0.06, length: 26 },
  { at: 0.16, length: 34, ramp: { length: 26, height: 2.4 } },
  { at: 0.28, length: 24 },
  { at: 0.39, length: 38, ramp: { length: 30, height: 2.8 } },
  { at: 0.52, length: 28 },
  { at: 0.63, length: 36, ramp: { length: 28, height: 2.6 } },
  { at: 0.75, length: 26 },
  { at: 0.87, length: 40, ramp: { length: 30, height: 3 } },
];

const HUB_Y = DECK;
const TORUS_R = 280;

export default {
  id: 'orbit',
  name: 'Starline Station',
  tagline: 'Spin-gravity ring above a gas giant',
  description: 'The last circuit: a truss ring around a space station, over the storm bands of a giant planet. Spin gravity is light, hops float, and the gaps between modules are the longest anywhere.',
  location: 'Orbit',
  modes: ['hop', 'flight'],
  elevated: true,
  pillars: false,
  deckColor: 0xb9bec6,
  deckDepth: 1.2,
  goldSpeed: 43,
  gaps: GAPS,
  hopRings: [{ at: 0.22, height: 14, radius: 5 }, { at: 0.46, height: 15, radius: 5 }, { at: 0.69, height: 14, radius: 5 }, { at: 0.94, height: 16, radius: 5 }],
  seed: 4049,
  gravity: 5.5,
  laps: 2,
  music: 'space',
  points: ROAD,
  flight: { altitude: 40, swing: 60, waves: 3, weave: 10, weaveWaves: 3, ringRadius: 11, ceiling: 600, goldSpeed: 70, floor: -50 },
  roadWidth: 16,
  runoff: 2.5,
  roadStyle: 'race',
  barrier: 'concrete',
  barrierColor: 0xdfe3e8,
  kerbs: false,
  atmosphere: 'space',
  defaultTime: 11,
  sunAzimuth: 120,
  sunTilt: 28,
  sunSize: 0.01,
  fogDensity: 0.00008,
  weathers: ['clear'],
  defaultWeather: 'clear',
  ambientScale: 1.5,
  groundBounce: 0xc49a6a,
  terrainRoughness: 1,
  // Nothing below but the planet, far out of reach.
  terrain() { return -3000; },
  terrainColor(c) { return c.setHex(0x05060a); },
  props: [
    { kind: 'lamp', along: 50, offset: 0, sides: [-1, 1], options: { lightColor: 0x9fd8ff } },
  ],
  landmarks(ctx) {
    const g = new THREE.Group();
    const rand = mulberry32(ctx.def.seed);
    const road = ctx.track;

    g.add(planet(ctx));

    // ---- The station hub: a long spine, a spinning habitat ring and sails.
    const hull = std(0xe4e6ea, { metalness: 0.55, roughness: 0.35 });
    const dark = std(0x30343c, { metalness: 0.7, roughness: 0.4 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, emissive: 0xffe2b0, emissiveIntensity: 0, map: windowTexture(), emissiveMap: null });
    winMat.emissiveMap = winMat.map;
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 520, 24), hull);
    spine.position.y = HUB_Y + 40;
    g.add(spine);
    for (const y of [-180, -60, 120, 260]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(38, 38, 14, 24), dark);
      band.position.y = HUB_Y + y;
      g.add(band);
    }
    ctx.collide(ctx.box(-38, HUB_Y - 220, -38, 38, HUB_Y + 300, 38));

    const habitat = new THREE.Group();
    habitat.position.y = HUB_Y + 30;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(TORUS_R, 24, 16, 96), hull);
    ring.rotation.x = Math.PI / 2;
    const glass = new THREE.Mesh(new THREE.TorusGeometry(TORUS_R, 24.4, 8, 96, Math.PI * 2), winMat);
    glass.rotation.x = Math.PI / 2;
    glass.scale.set(1, 1, 0.35);
    habitat.add(ring, glass);
    for (let k = 0; k < 6; k++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, TORUS_R - 30, 10), dark);
      const a = (k / 6) * Math.PI * 2;
      spoke.rotation.z = Math.PI / 2;
      spoke.rotation.y = a;
      spoke.position.set(Math.cos(a) * (TORUS_R / 2 + 15), 0, -Math.sin(a) * (TORUS_R / 2 + 15));
      habitat.add(spoke);
    }
    g.add(habitat);
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      ctx.collide(ctx.sphere(Math.cos(a) * TORUS_R, HUB_Y + 30, Math.sin(a) * TORUS_R, 26));
    }

    // Solar sails on top of the spine.
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1b2a55, metalness: 0.6, roughness: 0.25, emissive: 0x0a1430, emissiveIntensity: 0.6 });
    for (let k = 0; k < 4; k++) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(150, 1, 46), panelMat);
      const a = (k / 4) * Math.PI * 2 + 0.4;
      wing.position.set(Math.cos(a) * 112, HUB_Y + 250, Math.sin(a) * 112);
      wing.rotation.y = -a;
      g.add(wing);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(150, 2, 2), dark);
      mast.position.copy(wing.position);
      mast.rotation.y = -a;
      g.add(mast);
    }

    // ---- Modules beside the ring, joined to the deck by struts.
    const modMat = std(0xd9dce2, { metalness: 0.45, roughness: 0.4 });
    const accent = std(0xd9472b, { metalness: 0.3, roughness: 0.5 });
    const gapU = GAPS.map((gp) => gp.at);
    for (let k = 0; k < 14; k++) {
      const u = (k + 0.5) / 14;
      if (gapU.some((gu) => Math.min(Math.abs(u - gu), 1 - Math.abs(u - gu)) * road.length < 50)) continue;
      const i = Math.floor(u * road.count);
      const side = k % 3 === 0 ? -1 : 1;
      const off = road.wallHalfWidth + 34 + rand() * 20;
      const x = road.pos[i * 3] + road.right[i * 3] * off * side;
      const z = road.pos[i * 3 + 2] + road.right[i * 3 + 2] * off * side;
      const y = road.pos[i * 3 + 1] - 6 + (rand() - 0.5) * 20;
      const heading = Math.atan2(road.fwd[i * 3], road.fwd[i * 3 + 2]);
      const mod = new THREE.Group();
      const len = 36 + rand() * 30;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, len, 18), modMat);
      body.rotation.x = Math.PI / 2;
      const strip = new THREE.Mesh(new THREE.CylinderGeometry(9.15, 9.15, len * 0.8, 18, 1, true, -0.5, 1), winMat);
      strip.rotation.x = Math.PI / 2;
      const capA = new THREE.Mesh(new THREE.SphereGeometry(9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), modMat);
      capA.rotation.x = Math.PI / 2;
      capA.position.z = len / 2;
      const capB = capA.clone();
      capB.rotation.x = -Math.PI / 2;
      capB.position.z = -len / 2;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 9.2, 3, 18), accent);
      stripe.rotation.x = Math.PI / 2;
      stripe.position.z = len * 0.3;
      mod.add(body, strip, capA, capB, stripe);
      mod.position.set(x, y, z);
      mod.rotation.y = heading;
      g.add(mod);
      ctx.collide(ctx.sphere(x, y, z, 10), ctx.sphere(x + Math.sin(heading) * len * 0.35, y, z + Math.cos(heading) * len * 0.35, 10), ctx.sphere(x - Math.sin(heading) * len * 0.35, y, z - Math.cos(heading) * len * 0.35, 10));
      // Strut from the module back under the deck.
      const sx = road.pos[i * 3] + road.right[i * 3] * (road.wallHalfWidth - 2) * side;
      const sz = road.pos[i * 3 + 2] + road.right[i * 3 + 2] * (road.wallHalfWidth - 2) * side;
      const sy = road.pos[i * 3 + 1] - 2.5;
      const dx = x - sx;
      const dy = y - sy;
      const dz = z - sz;
      const L = Math.hypot(dx, dy, dz);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, L), dark);
      strut.position.set((x + sx) / 2, (y + sy) / 2, (z + sz) / 2);
      strut.lookAt(x, y, z);
      g.add(strut);
    }

    // ---- Truss bracing under the whole deck.
    const brace = new THREE.BoxGeometry(0.5, 0.5, 9);
    const step = Math.max(1, Math.round(6 / road.spacing));
    const n = Math.ceil(road.count / step) * 2;
    const truss = new THREE.InstancedMesh(brace, dark, n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let ti = 0;
    for (let i = 0; i < road.count; i += step) {
      if (road.gap[i]) continue;
      const heading = Math.atan2(road.fwd[i * 3], road.fwd[i * 3 + 2]);
      for (const side of [-1, 1]) {
        const off = (road.wallHalfWidth - 1.5) * side;
        p.set(road.pos[i * 3] + road.right[i * 3] * off, road.pos[i * 3 + 1] - 4.2, road.pos[i * 3 + 2] + road.right[i * 3 + 2] * off);
        e.set(((i / step) % 2 ? 1 : -1) * 0.55, heading, 0, 'YXZ');
        q.setFromEuler(e);
        m4.compose(p, q, s);
        truss.setMatrixAt(ti++, m4);
      }
    }
    truss.count = ti;
    g.add(truss);

    // ---- Gap lights: green on the take-off lip, red on the landing side.
    const go = new THREE.MeshStandardMaterial({ color: 0x062010, emissive: 0x3cff7a, emissiveIntensity: 2.4 });
    const stop = new THREE.MeshStandardMaterial({ color: 0x200606, emissive: 0xff3c3c, emissiveIntensity: 2.4 });
    const light = new THREE.SphereGeometry(0.55, 10, 8);
    for (const gp of GAPS) {
      for (const [end, mat] of [[-1, go], [1, stop]]) {
        const u = gp.at + (end * (gp.length / 2 + 1.5)) / road.length;
        const i = Math.floor((((u % 1) + 1) % 1) * road.count);
        for (const side of [-1, 1]) {
          const off = road.wallHalfWidth - 0.3;
          const b = new THREE.Mesh(light, mat);
          b.position.set(road.pos[i * 3] + road.right[i * 3] * off * side, road.pos[i * 3 + 1] + 1.4, road.pos[i * 3 + 2] + road.right[i * 3 + 2] * off * side);
          g.add(b);
        }
      }
    }

    // Distant traffic: little craft orbiting the station on long loops.
    const craftGeo = new THREE.ConeGeometry(2, 9, 6);
    craftGeo.rotateX(Math.PI / 2);
    const craft = new THREE.InstancedMesh(craftGeo, std(0xf0f0f0, { metalness: 0.5, emissive: 0x88ccff, emissiveIntensity: 0.4 }), 12);
    craft.frustumCulled = false;
    g.add(craft);
    const paths = Array.from({ length: 12 }, () => [700 + rand() * 600, (rand() - 0.5) * 300 + 120, rand() * 6, 0.02 + rand() * 0.03, rand() < 0.5 ? -1 : 1]);

    ctx.glow(winMat, 1.6);
    ctx.onUpdate((dt, night, time) => {
      habitat.rotation.y += dt * 0.05;
      go.emissiveIntensity = 1.4 + Math.sin(time * 4) * 1.1;
      stop.emissiveIntensity = 1.4 - Math.sin(time * 4) * 1.1;
      paths.forEach(([r, y, ph, sp, dir], k) => {
        const a = ph + time * sp * dir;
        p.set(Math.cos(a) * r, HUB_Y + y + Math.sin(a * 2) * 30, Math.sin(a) * r);
        e.set(0, Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir), 0);
        q.setFromEuler(e);
        m4.compose(p, q, s);
        craft.setMatrixAt(k, m4);
      });
      craft.instanceMatrix.needsUpdate = true;
    });
    return g;
  },
};

// The gas giant: a cap of a sphere that follows the camera like the sky,
// so it always sits on the horizon below. Banded clouds and a few storms.
function planet(ctx) {
  const R = 2200;
  const dip = 0.16; // horizon this far below eye level (radians)
  const tex = planetTexture(ctx.def.seed);
  const mat = new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, depthTest: false, fog: false });
  const geo = new THREE.SphereGeometry(R, 96, 32, 0, Math.PI * 2, Math.PI / 2 + dip, Math.PI / 2 - dip);
  const cap = new THREE.Mesh(geo, mat);
  cap.renderOrder = -8;
  cap.frustumCulled = false;
  // Atmosphere limb: a thin additive glow just above the cloud tops.
  const limbTex = limbTexture();
  const limb = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.999, 96, 2, 0, Math.PI * 2, Math.PI / 2 + dip - 0.05, 0.05),
    new THREE.MeshBasicMaterial({ map: limbTex, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending }),
  );
  limb.renderOrder = -7;
  limb.frustumCulled = false;
  const grp = new THREE.Group();
  grp.add(cap, limb);
  cap.material.side = THREE.BackSide;
  // Draw distance changes with the quality tier, so size the shell to sit
  // just inside the far clip plane every frame.
  const follow = (renderer, scene, camera) => {
    grp.position.copy(camera.position);
    grp.scale.setScalar(((camera.far || 3000) * 0.85) / R);
    grp.updateMatrixWorld(true);
  };
  cap.onBeforeRender = follow;
  ctx.onUpdate((dt) => { cap.rotation.y += dt * 0.003; });
  return grp;
}

function planetTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  const rand = mulberry32(seed);
  const cols = ['#d9b98c', '#c08a5a', '#e8d6b4', '#a8683e', '#d7a46c', '#efe2c6', '#b77a4a', '#caa070'];
  // v = 0 is the horizon edge of the cap, v = 1 straight down.
  let y = 0;
  while (y < 256) {
    const h = 6 + rand() * 26 * (1 + y / 256);
    g.fillStyle = cols[Math.floor(rand() * cols.length)];
    g.fillRect(0, y, 1024, h + 1);
    y += h;
  }
  // Turbulent edges between bands.
  for (let k = 0; k < 2200; k++) {
    const x = rand() * 1024;
    const yy = rand() * 256;
    g.fillStyle = `rgba(${rand() < 0.5 ? '255,240,220' : '120,70,40'},${0.06 + rand() * 0.1})`;
    g.beginPath();
    g.ellipse(x, yy, 6 + rand() * 30, 1 + rand() * 3, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Storms.
  for (let k = 0; k < 5; k++) {
    const x = rand() * 1024;
    const yy = 30 + rand() * 200;
    const rx = 14 + rand() * 30;
    g.fillStyle = k === 0 ? 'rgba(190,80,50,0.85)' : 'rgba(250,240,225,0.7)';
    g.beginPath();
    g.ellipse(x, yy, rx, rx * 0.4, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Haze toward the horizon.
  const grad = g.createLinearGradient(0, 0, 0, 60);
  grad.addColorStop(0, 'rgba(200,210,235,0.75)');
  grad.addColorStop(1, 'rgba(200,210,235,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.userData.owned = true;
  return t;
}

function limbTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#000000');
  grad.addColorStop(0.8, '#3f78c8');
  grad.addColorStop(1, '#9cc8ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.owned = true;
  return t;
}

// Rows of lit windows for the habitat ring and modules.
function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 64);
  for (let x = 4; x < 256; x += 10) {
    for (const y of [14, 38]) {
      if (((x * 7 + y) % 11) < 3) continue;
      g.fillStyle = (x + y) % 3 ? '#ffe2b0' : '#bfe6ff';
      g.fillRect(x, y, 6, 10);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(24, 1);
  t.userData.owned = true;
  return t;
}
