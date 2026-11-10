// Fallback Roadster-inspired car, used until the car team's src/car/roadster.js lands.
// Same API as the car team's createRoadster(). Body is a loft: a rounded cross-section
// swept along the car's length, with width/height keyed per station, and wheel arches
// carved by pulling side vertices inward around each wheel.
import * as THREE from 'three';

export const PAINTS = [
  { id: 'pearlWhite', name: 'Pearl White', color: 0xf1f1ee, metalness: 0.2, roughness: 0.25, cost: 0 },
  { id: 'ultraRed', name: 'Ultra Red', color: 0x9e0c14, metalness: 0.45, roughness: 0.28, cost: 0 },
  { id: 'solidBlack', name: 'Solid Black', color: 0x0a0a0c, metalness: 0.3, roughness: 0.3, cost: 0 },
  { id: 'quicksilver', name: 'Quicksilver', color: 0x9da3a8, metalness: 0.9, roughness: 0.22, cost: 600 },
  { id: 'deepBlue', name: 'Deep Blue', color: 0x123a8c, metalness: 0.6, roughness: 0.28, cost: 600 },
  { id: 'stealthGrey', name: 'Stealth Grey', color: 0x3b3f45, metalness: 0.5, roughness: 0.32, cost: 900 },
  { id: 'voltLime', name: 'Volt Lime', color: 0x8fd62a, metalness: 0.4, roughness: 0.3, cost: 1500 },
  { id: 'sunsetOrange', name: 'Sunset Orange', color: 0xff5a10, metalness: 0.45, roughness: 0.3, cost: 1500 },
  { id: 'ionCyan', name: 'Ion Cyan', color: 0x16c2e0, metalness: 0.5, roughness: 0.25, cost: 2000 },
  { id: 'matteCarbon', name: 'Matte Carbon', color: 0x1b1b1b, metalness: 0.2, roughness: 0.75, cost: 3000 },
  { id: 'liquidGold', name: 'Liquid Gold', color: 0xc9a227, metalness: 1, roughness: 0.18, cost: 6000 },
  { id: 'mirrorChrome', name: 'Mirror Chrome', color: 0xe0e0e0, metalness: 1, roughness: 0.04, cost: 9000 },
];
export const WHEELS = [
  { id: 'aero', name: 'Aero Disc', cost: 0 },
  { id: 'turbine', name: 'Turbine', cost: 800 },
  { id: 'spoke', name: 'Split Spoke', cost: 1200 },
  { id: 'mesh', name: 'Forged Mesh', cost: 2000 },
];

const L = 4.25;
// z, half width, bottom, top
const BODY = [
  [-2.12, 0.78, 0.33, 0.66], [-2.08, 0.9, 0.24, 0.8], [-1.9, 0.97, 0.2, 0.88], [-1.4, 1.0, 0.18, 0.92],
  [-0.8, 0.97, 0.18, 0.9], [-0.2, 0.93, 0.18, 0.86], [0.4, 0.94, 0.18, 0.84], [1.0, 0.98, 0.19, 0.78],
  [1.5, 0.97, 0.2, 0.7], [1.9, 0.89, 0.22, 0.6], [2.06, 0.74, 0.26, 0.5], [2.13, 0.5, 0.32, 0.42],
];
const CABIN = [
  [-1.15, 0.58, 0.7, 0.86], [-0.9, 0.66, 0.7, 1.05], [-0.45, 0.7, 0.7, 1.15], [0.0, 0.72, 0.7, 1.16],
  [0.3, 0.74, 0.7, 1.09], [0.62, 0.76, 0.7, 0.9], [0.76, 0.76, 0.7, 0.8],
];
const WHEEL_R = 0.355, AXLE_F = 1.33, AXLE_R = -1.3, TRACK = 0.84;

function interp(keys, z, col) {
  if (z <= keys[0][0]) return keys[0][col];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (z <= b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      const s = t * t * (3 - 2 * t);
      return a[col] + (b[col] - a[col]) * s;
    }
  }
  return keys[keys.length - 1][col];
}

function loft(keys, stations, segs, opts = {}) {
  const z0 = keys[0][0], z1 = keys[keys.length - 1][0];
  const pos = [], col = [], idx = [];
  for (let s = 0; s <= stations; s++) {
    const z = z0 + (z1 - z0) * (s / stations);
    const w = interp(keys, z, 1), yb = interp(keys, z, 2), yt = interp(keys, z, 3);
    const yc = (yb + yt) / 2, hh = (yt - yb) / 2;
    for (let j = 0; j < segs; j++) {
      const u = (j / segs) * Math.PI * 2;
      const cu = Math.cos(u), su = Math.sin(u);
      const n = su > 0 ? (opts.topN || 2.6) : (opts.botN || 4);
      let x = w * Math.sign(cu) * Math.pow(Math.abs(cu), 2 / n);
      let y = yc + hh * Math.sign(su) * Math.pow(Math.abs(su), 2 / n);
      if (su > 0) x *= 1 - (opts.tumble || 0.12) * su * su;
      if (opts.hoodDip && su > 0) y -= opts.hoodDip(z) * Math.pow(1 - Math.abs(cu), 2) * su;
      let c = 1;
      if (opts.arches) {
        for (const az of [AXLE_F, AXLE_R]) {
          const d = Math.hypot(z - az, y - WHEEL_R);
          if (Math.abs(x) > 0.6 && d < 0.44) { x = Math.sign(x) * 0.6; c = 0.04; }
          else if (Math.abs(x) > 0.6 && d < 0.5) x *= 1.015;
        }
      }
      pos.push(x, y, z); col.push(c, c, c);
    }
  }
  for (let s = 0; s < stations; s++) {
    for (let j = 0; j < segs; j++) {
      const a = s * segs + j, b = s * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
      idx.push(a, c, b, b, c, d);
    }
  }
  // end caps
  for (const [s, flip] of [[0, true], [stations, false]]) {
    const center = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < segs; j++) { cx += pos[(s * segs + j) * 3]; cy += pos[(s * segs + j) * 3 + 1]; cz += pos[(s * segs + j) * 3 + 2]; }
    pos.push(cx / segs, cy / segs, cz / segs); col.push(1, 1, 1);
    for (let j = 0; j < segs; j++) {
      const a = s * segs + j, b = s * segs + ((j + 1) % segs);
      if (flip) idx.push(center, a, b); else idx.push(center, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const shared = {};
function mats() {
  if (shared.ready) return shared;
  shared.glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.9, clearcoat: 1 });
  shared.black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6, metalness: 0.2 });
  shared.tyre = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  shared.rim = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.95 });
  shared.rimDark = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.8 });
  shared.disc = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.5, metalness: 0.8 });
  shared.caliper = new THREE.MeshStandardMaterial({ color: 0xc0101a, roughness: 0.4 });
  shared.interior = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.8 });
  shared.ready = true;
  return shared;
}

function buildWheel(style, detail) {
  const m = mats();
  const seg = detail === 'low' ? 16 : 32;
  const g = new THREE.Group();
  const prof = [[0.25, -0.12], [0.33, -0.128], [0.35, -0.11], [WHEEL_R, -0.06], [WHEEL_R, 0.06], [0.35, 0.11], [0.33, 0.128], [0.25, 0.12]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, seg), m.tyre);
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.22, seg, 1, true), m.rimDark);
  barrel.rotation.z = Math.PI / 2; g.add(barrel);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, seg), m.disc);
  disc.rotation.z = Math.PI / 2; disc.position.x = -0.02; g.add(disc);
  const face = new THREE.Group(); face.position.x = 0.1; g.add(face);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 16), m.rim);
  hub.rotation.z = Math.PI / 2; face.add(hub);
  const spoke = (len, w, ang, tilt = 0, mat = m.rim) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, len, w), mat);
    s.position.set(0, Math.cos(ang) * (0.06 + len / 2), Math.sin(ang) * (0.06 + len / 2));
    s.rotation.x = -ang + tilt; face.add(s);
  };
  if (style === 'aero') {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.02, seg), m.rim);
    d.rotation.z = Math.PI / 2; face.add(d);
    for (let i = 0; i < 5; i++) spoke(0.12, 0.05, (i / 5) * Math.PI * 2, 0, m.rimDark);
  } else if (style === 'turbine') {
    for (let i = 0; i < 10; i++) spoke(0.18, 0.045, (i / 10) * Math.PI * 2, 0.35);
  } else if (style === 'spoke') {
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; spoke(0.18, 0.035, a - 0.12); spoke(0.18, 0.035, a + 0.12); }
  } else {
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; spoke(0.18, 0.02, a, 0.4); spoke(0.18, 0.02, a, -0.4); }
  }
  return g;
}

export function createRoadster({ paint = 'ultraRed', wheels = 'aero', quality = 'high' } = {}) {
  const m = mats();
  const detail = quality;
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body); // body leans; wheels stay planted
  const pdef = PAINTS.find((p) => p.id === paint) || PAINTS[1];
  const paintMat = quality === 'low'
    ? new THREE.MeshStandardMaterial({ color: pdef.color, metalness: pdef.metalness, roughness: pdef.roughness, vertexColors: true })
    : new THREE.MeshPhysicalMaterial({ color: pdef.color, metalness: pdef.metalness, roughness: pdef.roughness, clearcoat: 1, clearcoatRoughness: 0.06, vertexColors: true });
  const st = quality === 'low' ? 60 : quality === 'medium' ? 100 : 140;
  const sg = quality === 'low' ? 28 : 48;
  const shell = new THREE.Mesh(loft(BODY, st, sg, { arches: true, hoodDip: (z) => (z > 0.5 ? 0.05 : 0) }), paintMat);
  shell.castShadow = true; body.add(shell);
  const cabin = new THREE.Mesh(loft(CABIN, 30, sg, { topN: 2.2, tumble: 0.25 }), m.glass);
  cabin.castShadow = true; body.add(cabin);

  // seats + wheel visible through the glass
  for (const sx of [-0.36, 0.36]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.1), m.interior);
    seat.position.set(sx, 0.86, -0.5); seat.rotation.x = -0.25; body.add(seat);
  }
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 20), m.interior);
  sw.position.set(0.36, 0.9, 0.25); sw.rotation.x = 0.5; body.add(sw);

  // lights
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdde8ff, emissiveIntensity: 1.2, roughness: 0.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 0.8 });
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), headMat);
    h.scale.set(0.15, 0.028, 0.07); h.position.set(sx * 0.62, 0.6, 1.9); h.rotation.y = sx * 0.5; h.rotation.z = sx * -0.15;
    body.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.05), tailMat);
    t.position.set(sx * 0.6, 0.76, -2.08); t.rotation.y = sx * -0.35; body.add(t);
    const mirror = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), paintMat);
    mirror.scale.set(0.1, 0.06, 0.1); mirror.position.set(sx * 0.86, 0.95, 0.5); body.add(mirror);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.025, 0.04), tailMat);
  bar.position.set(0, 0.79, -2.11); body.add(bar);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.14), m.black);
  splitter.position.set(0, 0.25, 2.02); body.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.16), m.black);
  diffuser.position.set(0, 0.3, -2.02); body.add(diffuser);

  // contact shadow blob (helps when real shadows are off)
  const cs = document.createElement('canvas'); cs.width = cs.height = 64;
  const cx = cs.getContext('2d'); const gr = cx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cs), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02; root.add(blob);

  // wheels: pivot (steer) -> spin
  const wheelPositions = [
    new THREE.Vector3(TRACK, WHEEL_R, AXLE_F), new THREE.Vector3(-TRACK, WHEEL_R, AXLE_F),
    new THREE.Vector3(TRACK, WHEEL_R, AXLE_R), new THREE.Vector3(-TRACK, WHEEL_R, AXLE_R),
  ];
  const pivots = [], spins = [];
  let wheelStyle = wheels;
  const calipers = [];
  function buildWheels() {
    for (const p of pivots) root.remove(p);
    pivots.length = 0; spins.length = 0;
    wheelPositions.forEach((wp, i) => {
      const pivot = new THREE.Group(); pivot.position.copy(wp);
      const spin = new THREE.Group(); pivot.add(spin);
      const w = buildWheel(wheelStyle, detail);
      w.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      if (wp.x < 0) w.scale.x = -1;
      spin.add(w);
      const cal = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.1), m.caliper);
      cal.position.set(Math.sign(wp.x) * 0.02, 0.12, -0.12);
      pivot.add(cal); calipers.push(cal);
      root.add(pivot); pivots.push(pivot); spins.push(spin);
    });
  }
  buildWheels();

  let spinAngle = 0;
  const car = {
    object: root, body, wheelPositions, paint: pdef.id, wheels: wheelStyle,
    setPaint(id) {
      const p = PAINTS.find((q) => q.id === id); if (!p) return;
      paintMat.color.setHex(p.color); paintMat.metalness = p.metalness; paintMat.roughness = p.roughness;
      car.paint = id;
    },
    setWheels(id) { wheelStyle = id; car.wheels = id; buildWheels(); },
    setBrake(on) { tailMat.emissiveIntensity = on ? 3 : 0.8; },
    setHeadlights(on) { headMat.emissiveIntensity = on ? 3 : 1.2; },
    setReverse() {},
    update(dt, speed, steer) {
      spinAngle += (speed / WHEEL_R) * dt;
      for (const s of spins) s.rotation.x = spinAngle;
      pivots[0].rotation.y = pivots[1].rotation.y = -steer;
    },
    dispose() {
      root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
      paintMat.dispose();
    },
  };
  return car;
}
