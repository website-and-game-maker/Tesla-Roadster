// Fallback worlds, used until the worlds team's src/worlds/index.js lands.
// Each track is a closed spline through randomly jittered points on a circle (seeded, so it
// is the same every time), checked so no two parts of the track come too close.
import * as THREE from 'three';

export const WORLDS = [
  { id: 'coast', name: 'Pacific Coast', description: 'Sun, sea air and fast sweepers along the cliffs.', unlock: 0, laps: 3, seed: 7, radius: 330, pts: 13, hills: 6,
    sky: [0x2f7fd0, 0xcfe6f4], sun: 0xfff1d6, sunPos: [0.5, 0.8, 0.3], ground: '#5f9a46', runoff: '#6fa752', fog: 0xcfe6f4, scenery: 'palms', water: true, mountains: 0x6f8f7a, night: false },
  { id: 'desert', name: 'Red Rock Canyon', description: 'Sunset desert with long straights and a nasty hairpin.', unlock: 8, laps: 3, seed: 21, radius: 380, pts: 12, hills: 10,
    sky: [0x2a3a6a, 0xf3a45a], sun: 0xffb070, sunPos: [-0.8, 0.25, 0.4], ground: '#c98f55', runoff: '#d6a066', fog: 0xe8a070, scenery: 'desert', water: false, mountains: 0x9a4a2c, night: false },
  { id: 'city', name: 'Neon City', description: 'Night street circuit lit by a million windows.', unlock: 17, laps: 3, seed: 33, radius: 300, pts: 14, hills: 3,
    sky: [0x03040c, 0x1a2140], sun: 0x8fa6ff, sunPos: [0.3, 0.6, -0.5], ground: '#202329', runoff: '#2b2e35', fog: 0x141a30, scenery: 'city', water: false, mountains: null, night: true },
  { id: 'alpine', name: 'Alpine Pass', description: 'Snow, pines and big elevation changes.', unlock: 28, laps: 3, seed: 48, radius: 360, pts: 13, hills: 18,
    sky: [0x5f8fd0, 0xe4edf5], sun: 0xffffff, sunPos: [0.3, 0.7, 0.6], ground: '#e9eef3', runoff: '#cfd8e0', fog: 0xe4edf5, scenery: 'pines', water: false, mountains: 0x7d8796, night: false },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeCurve(def) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng(def.seed * 101 + attempt);
    const pts = [];
    for (let i = 0; i < def.pts; i++) {
      const a = (i / def.pts) * Math.PI * 2 + (r() - 0.5) * 0.25;
      const rad = def.radius * (0.6 + r() * 0.55);
      const y = 0.15 + def.hills * (0.5 + 0.5 * Math.sin(a * 2 + def.seed));
      pts.push(new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad));
    }
    // Drive anticlockwise seen from above so that "increasing t" is forward.
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    if (validate(curve)) return curve;
  }
  return new THREE.CatmullRomCurve3([0, 1, 2, 3, 4, 5].map((i) => new THREE.Vector3(Math.cos(i) * def.radius, 0.15, Math.sin(i) * def.radius)), true);
}

function validate(curve) {
  const n = 300, pts = curve.getSpacedPoints(n), L = curve.getLength(), ds = L / n;
  // minimum distance between parts of the track that are far apart along it
  for (let i = 0; i < n; i += 2) for (let j = i + 20; j < n; j += 2) {
    const along = Math.min(j - i, n - (j - i)) * ds;
    if (along < 120) continue;
    if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 45) return false;
  }
  // tightest corner radius
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 3 + n) % n], b = pts[i], c = pts[(i + 3) % n];
    const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z);
    const k = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) / (3 * ds);
    if (k > 1 / 22) return false;
  }
  return true;
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  return t;
}

function noiseFill(ctx, w, h, base, amount, n = 4000) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.random();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${amount * Math.random()})` : `rgba(0,0,0,${amount * Math.random()})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

function ribbon(samples, lat0, lat1, yOff, vScale, mat, uv0 = 0, uv1 = 1) {
  const n = samples.length, pos = [], uv = [], idx = [];
  let d = 0;
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    if (i > 0) { const p = samples[i - 1]; d += Math.hypot(s.x - p.x, s.z - p.z); }
    pos.push(s.x + s.nx * lat0, s.y + yOff, s.z + s.nz * lat0, s.x + s.nx * lat1, s.y + yOff, s.z + s.nz * lat1);
    uv.push(uv0, d / vScale, uv1, d / vScale);
  }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}

function wall(samples, lat, height, mat, outward) {
  const n = samples.length, pos = [], uv = [], idx = [];
  let d = 0;
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    if (i > 0) { const p = samples[i - 1]; d += Math.hypot(s.x - p.x, s.z - p.z); }
    const x = s.x + s.nx * lat, z = s.z + s.nz * lat;
    pos.push(x, s.y - 1, z, x, s.y + height, z);
    uv.push(d / 8, 0, d / 8, 1);
  }
  for (let i = 0; i < n; i++) { const a = i * 2; if (outward) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
  return m;
}

function skyDome(def, radius) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(def.sky[0]) }, hor: { value: new THREE.Color(def.sky[1]) }, sunDir: { value: new THREE.Vector3(...def.sunPos).normalize() }, sunCol: { value: new THREE.Color(def.sun) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vDir;
      void main(){ float h = max(vDir.y, 0.0); vec3 c = mix(hor, top, pow(h, 0.55));
      float s = max(dot(normalize(vDir), sunDir), 0.0); c += sunCol * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25);
      if (vDir.y < 0.0) c = hor * 0.9; gl_FragColor = vec4(c, 1.0); }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
}

export function createWorld(id, { scene, quality = 'high' } = {}) {
  const def = WORLDS.find((w) => w.id === id) || WORLDS[0];
  const q = { low: 0.35, medium: 0.65, high: 1, ultra: 1.4 }[quality] || 1;
  const group = new THREE.Group(); scene.add(group);
  const curve = makeCurve(def);
  const ROAD = 7.5, WALL = 12;
  const L = curve.getLength(), n = Math.round(L / 3);
  const samples = curve.getSpacedPoints(n).slice(0, n).map((p, i, arr) => {
    const a = arr[(i - 1 + n) % n], b = arr[(i + 1) % n];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    return { x: p.x, y: p.y, z: p.z, nx: -tz, nz: tx };
  });

  // --- textures ---
  const asphalt = canvasTex(256, 512, (c, w, h) => {
    noiseFill(c, w, h, def.night ? '#2a2c31' : '#3a3c40', 0.12, 9000);
    c.fillStyle = '#e8e8e8'; c.fillRect(8, 0, 6, h); c.fillRect(w - 14, 0, 6, h);
    c.fillStyle = def.night ? '#f2c94c' : '#ececec'; c.fillRect(w / 2 - 3, 0, 6, h * 0.45);
  });
  const runoffTex = canvasTex(128, 128, (c, w, h) => noiseFill(c, w, h, def.runoff, 0.18, 2500));
  const curbTex = canvasTex(64, 64, (c, w, h) => { c.fillStyle = '#d01818'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2f2f2'; c.fillRect(0, 0, w, h / 2); });
  const wallTex = canvasTex(128, 64, (c, w, h) => {
    noiseFill(c, w, h, def.night ? '#4a4f5c' : '#c9c9c4', 0.1, 600);
    c.fillStyle = def.night ? '#18e0ff' : '#d01818'; c.fillRect(0, h * 0.62, w, h * 0.12);
    c.fillStyle = '#1a1a1a'; c.fillRect(0, h * 0.9, w, h * 0.1);
  });
  const groundTex = canvasTex(256, 256, (c, w, h) => noiseFill(c, w, h, def.ground, 0.15, 6000));
  groundTex.repeat.set(220, 220);

  const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: def.night ? 0.45 : 0.85, metalness: def.night ? 0.15 : 0, polygonOffset: true, polygonOffsetFactor: -2 });
  group.add(ribbon(samples, -ROAD, ROAD, 0.02, 14, roadMat));
  const runMat = new THREE.MeshStandardMaterial({ map: runoffTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
  group.add(ribbon(samples, ROAD, WALL + 0.5, 0.0, 6, runMat));
  group.add(ribbon(samples, -WALL - 0.5, -ROAD, 0.0, 6, runMat));
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3 });
  group.add(ribbon(samples, ROAD - 0.2, ROAD + 1.0, 0.035, 3, curbMat));
  group.add(ribbon(samples, -ROAD - 1.0, -ROAD + 0.2, 0.035, 3, curbMat));
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, side: THREE.DoubleSide });
  group.add(wall(samples, WALL, 1.1, wallMat, false));
  group.add(wall(samples, -WALL, 1.1, wallMat, true));
  // embankment skirts down to the ground
  const skirtMat = new THREE.MeshStandardMaterial({ map: groundTex.clone(), roughness: 1 });
  skirtMat.map.repeat.set(1, 1);
  for (const side of [1, -1]) {
    const pos = [], idx = [], uv = [];
    samples.concat([samples[0]]).forEach((s, i) => {
      const lat = side * (WALL + 0.5), lat2 = side * (WALL + 0.5 + s.y * 2.5 + 1);
      pos.push(s.x + s.nx * lat, s.y, s.z + s.nz * lat, s.x + s.nx * lat2, -0.05, s.z + s.nz * lat2);
      uv.push(i / 4, 0, i / 4, 1);
    });
    for (let i = 0; i < n; i++) { const a = i * 2; if (side > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, skirtMat); m.receiveShadow = true; group.add(m);
  }

  // ground + water
  const ground = new THREE.Mesh(new THREE.CircleGeometry(def.water ? def.radius * 1.6 : 4000, 64), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  if (def.water) {
    const water = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.MeshStandardMaterial({ color: 0x1b6fa8, roughness: 0.12, metalness: 0.3 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -0.6; group.add(water);
  }

  // start / finish gantry + line
  const s0 = samples[0];
  const checker = canvasTex(128, 32, (c, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { c.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; c.fillRect(x * 8, y * 8, 8, 8); } }, false);
  const yaw0 = Math.atan2(s0.nz, -s0.nx);
  const lineGeo = new THREE.PlaneGeometry(ROAD * 2, 2.5); lineGeo.rotateX(-Math.PI / 2);
  const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -4 }));
  line.position.set(s0.x, s0.y + 0.04, s0.z); line.rotation.y = yaw0;
  group.add(line);
  const gantry = new THREE.Group();
  const gm = new THREE.MeshStandardMaterial({ color: 0x22252a, metalness: 0.6, roughness: 0.4 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), gm); p.position.set(s * (WALL + 0.6), 4, 0); p.castShadow = true; gantry.add(p); }
  const bannerTex = canvasTex(1024, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#0b0e14'); g.addColorStop(0.5, '#1a2230'); g.addColorStop(1, '#0b0e14');
    c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = '#ff2a3d'; c.fillRect(0, h - 10, w, 10);
    c.font = 'bold 76px system-ui, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText('ROADSTER GRAND PRIX', w / 2, 88);
  }, false);
  const banner = new THREE.Mesh(new THREE.BoxGeometry((WALL + 1) * 2, 1.6, 0.4), [gm, gm, gm, gm, new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.4 }), new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.4 })]);
  banner.position.y = 7.6; banner.castShadow = true; gantry.add(banner);
  gantry.position.set(s0.x, s0.y, s0.z); gantry.rotation.y = yaw0;
  group.add(gantry);

  // --- scenery (instanced) ---
  const far = (x, z, minD) => {
    for (let i = 0; i < n; i += 3) { const s = samples[i]; if ((s.x - x) ** 2 + (s.z - z) ** 2 < minD * minD) return false; }
    return true;
  };
  const r = rng(def.seed * 7);
  const spots = [];
  const count = Math.round((def.scenery === 'city' ? 260 : 520) * q);
  for (let k = 0; k < count * 3 && spots.length < count; k++) {
    const s = samples[Math.floor(r() * n)];
    const side = r() < 0.5 ? -1 : 1;
    const lat = side * (WALL + 6 + r() * (def.scenery === 'city' ? 40 : 90));
    const x = s.x + s.nx * lat, z = s.z + s.nz * lat;
    if (def.water && Math.hypot(x, z) > def.radius * 1.55) continue;
    if (!far(x, z, WALL + 4)) continue;
    spots.push([x, z, r(), r()]);
  }
  const dummy = new THREE.Object3D();
  const inst = (geo, mat, list, fn) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => { fn(dummy, p); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
    m.castShadow = quality !== 'low'; m.receiveShadow = true; group.add(m); return m;
  };
  if (def.scenery === 'palms' || def.scenery === 'pines') {
    const pine = def.scenery === 'pines';
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, pine ? 3 : 7, 6); trunkGeo.translate(0, pine ? 1.5 : 3.5, 0);
    const leafGeo = pine ? new THREE.ConeGeometry(2.4, 7, 7) : new THREE.SphereGeometry(2.6, 7, 5);
    leafGeo.translate(0, pine ? 6 : 7.2, 0); if (!pine) leafGeo.scale(1, 0.45, 1);
    inst(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 }), spots, (d, p) => { d.position.set(p[0], 0, p[1]); d.scale.setScalar(0.8 + p[2] * 0.7); d.rotation.set(0, p[3] * 6, 0); });
    inst(leafGeo, new THREE.MeshStandardMaterial({ color: pine ? 0x2c4a32 : 0x3f7d33, roughness: 0.9, flatShading: true }), spots, (d, p) => { d.position.set(p[0], 0, p[1]); d.scale.setScalar(0.8 + p[2] * 0.7); d.rotation.set(0, p[3] * 6, 0); });
    if (pine) {
      const snow = new THREE.ConeGeometry(1.3, 2.4, 7); snow.translate(0, 8.4, 0);
      inst(snow, new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.8, flatShading: true }), spots, (d, p) => { d.position.set(p[0], 0, p[1]); d.scale.setScalar(0.8 + p[2] * 0.7); d.rotation.set(0, p[3] * 6, 0); });
    }
  } else if (def.scenery === 'desert') {
    const rock = new THREE.DodecahedronGeometry(1, 0);
    inst(rock, new THREE.MeshStandardMaterial({ color: 0xa65a35, roughness: 1, flatShading: true }), spots, (d, p) => {
      const big = p[2] > 0.85; d.position.set(p[0], big ? 4 : 0.5, p[1]);
      d.scale.set(big ? 14 + p[3] * 10 : 1 + p[3] * 2, big ? 10 + p[2] * 8 : 0.8 + p[2], big ? 12 : 1 + p[2] * 2); d.rotation.set(0, p[3] * 6, 0);
    });
    const cactus = new THREE.CylinderGeometry(0.3, 0.35, 4, 8); cactus.translate(0, 2, 0);
    inst(cactus, new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.9 }), spots.filter((p) => p[2] < 0.4), (d, p) => { d.position.set(p[0] + 3, 0, p[1]); d.scale.setScalar(0.7 + p[3]); });
  } else if (def.scenery === 'city') {
    const win = canvasTex(128, 256, (c, w, h) => {
      c.fillStyle = '#0d1018'; c.fillRect(0, 0, w, h);
      for (let y = 4; y < h; y += 10) for (let x = 4; x < w; x += 9) { if (Math.random() < 0.45) { c.fillStyle = ['#ffd38a', '#9fd8ff', '#ffffff', '#ff8fd0'][Math.floor(Math.random() * 4)]; c.globalAlpha = 0.4 + Math.random() * 0.6; c.fillRect(x, y, 5, 6); c.globalAlpha = 1; } }
    });
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    inst(box, new THREE.MeshStandardMaterial({ map: win, emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 1.1, roughness: 0.6, metalness: 0.3 }), spots, (d, p) => {
      d.position.set(p[0], 0, p[1]); d.scale.set(14 + p[3] * 16, 20 + Math.pow(p[2], 2) * 120, 14 + p[2] * 16); d.rotation.set(0, Math.round(p[3] * 4) * 0.4, 0);
    });
    // street lamps + light pools along the track
    const lamps = []; for (let i = 0; i < n; i += Math.round(14 / q)) lamps.push(samples[i]);
    const pole = new THREE.CylinderGeometry(0.1, 0.12, 8, 6); pole.translate(0, 4, 0);
    const side = (s, k) => [s.x + s.nx * (WALL + 1) * k, s.y, s.z + s.nz * (WALL + 1) * k];
    const both = lamps.flatMap((s, i) => [side(s, i % 2 ? 1 : -1)]);
    inst(pole, new THREE.MeshStandardMaterial({ color: 0x333840, metalness: 0.7, roughness: 0.4 }), both, (d, p) => { d.position.set(p[0], p[1], p[2]); d.scale.setScalar(1); d.rotation.set(0, 0, 0); });
    const bulb = new THREE.SphereGeometry(0.35, 8, 6); bulb.translate(0, 8, 0);
    inst(bulb, new THREE.MeshBasicMaterial({ color: 0xffe2b0 }), both, (d, p) => { d.position.set(p[0], p[1], p[2]); });
    const poolTex = canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,220,160,0.55)'); g.addColorStop(1, 'rgba(255,220,160,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }, false);
    const pool = new THREE.PlaneGeometry(18, 18); pool.rotateX(-Math.PI / 2);
    const pm = inst(pool, new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), lamps.map((s, i) => side(s, i % 2 ? 0.45 : -0.45)), (d, p) => { d.position.set(p[0], p[1] + 0.06, p[2]); });
    pm.castShadow = false; pm.receiveShadow = false;
  }

  // distant mountains ring
  if (def.mountains) {
    const mg = new THREE.ConeGeometry(1, 1, 6); mg.translate(0, 0.5, 0);
    const ring = []; for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2 + r() * 0.1; const d = def.radius * 2.6 + r() * 300; ring.push([Math.cos(a) * d, Math.sin(a) * d, r(), r()]); }
    const mm = inst(mg, new THREE.MeshStandardMaterial({ color: def.mountains, roughness: 1, flatShading: true }), ring, (d, p) => { d.position.set(p[0], -5, p[1]); d.scale.set(260 + p[2] * 200, 120 + p[3] * 180, 260 + p[3] * 200); d.rotation.set(0, p[2] * 3, 0); });
    mm.castShadow = false;
  }

  // sky + lights
  const sky = skyDome(def, 2400); group.add(sky);
  const hemi = new THREE.HemisphereLight(def.sky[1], def.night ? 0x101018 : 0x6b5a45, def.night ? 0.5 : 1.1);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(def.sun, def.night ? 0.7 : 2.6);
  const sunDir = new THREE.Vector3(...def.sunPos).normalize();
  sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -60; sun.shadow.camera.right = sun.shadow.camera.top = 60;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 400; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  group.add(sun); group.add(sun.target);
  scene.fog = new THREE.Fog(def.fog, 150, 1500);
  scene.background = new THREE.Color(def.sky[1]);

  // snow / dust particles near the camera
  let particles = null;
  if (def.scenery === 'pines' && q >= 0.65) {
    const N = Math.round(2500 * q), arr = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) arr[i] = (Math.random() - 0.5) * 120;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    particles = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.85, depthWrite: false }));
    particles.frustumCulled = false; group.add(particles);
  }

  const surfaces = { asphalt: { grip: 1, rolling: 0, name: 'asphalt' } };
  const roughName = def.scenery === 'pines' ? 'snow' : def.scenery === 'desert' ? 'sand' : def.scenery === 'city' ? 'asphalt' : 'grass';
  const rough = { grip: 0.72, rolling: 1, name: roughName };
  let t = 0;

  return {
    def, group, sun,
    trackCurve: curve,
    roadHalfWidth: ROAD, wallHalfWidth: WALL,
    gravity: 9.81,
    night: def.night,
    getGroundHeight: null, // physics uses the sampled centre-line height
    surfaceAt(lat) { return Math.abs(lat) <= ROAD + 0.8 ? surfaces.asphalt : rough; },
    update(dt, carPos, camera) {
      t += dt;
      if (carPos) {
        sun.position.set(carPos.x + sunDir.x * 150, carPos.y + sunDir.y * 150, carPos.z + sunDir.z * 150);
        sun.target.position.copy(carPos);
      }
      if (camera) sky.position.copy(camera.position);
      if (particles && camera) {
        particles.position.set(camera.position.x, camera.position.y, camera.position.z);
        const a = particles.geometry.attributes.position.array;
        for (let i = 1; i < a.length; i += 3) { a[i] -= dt * 3; if (a[i] < -60) a[i] += 120; }
        particles.geometry.attributes.position.needsUpdate = true;
      }
    },
    setShadowSize(size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } },
    dispose() {
      scene.remove(group);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
      scene.fog = null;
    },
  };
}
