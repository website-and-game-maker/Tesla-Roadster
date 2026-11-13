// 3D showroom used behind the menus and in the garage: studio lighting, turntable,
// drag-to-orbit, reflective floor, and live paint/wheel swaps.
import { DEFAULT_PAINTS, DEFAULT_WHEELS } from './catalog.js';

// setPointerCapture can throw (e.g. pointer already released); capture is best-effort.
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* ignore */ } };

export function createShowroom(THREE, canvas, { buildCarModel, paints = DEFAULT_PAINTS, wheels = DEFAULT_WHEELS, getQuality } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, getQuality?.() === 'low' ? 1 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07080b);
  scene.fog = new THREE.Fog(0x07080b, 14, 34);

  // Studio environment for reflections: big soft light panels rendered into a PMREM.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x111216);
  const panel = (w, h, pos, intensity, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); envScene.add(m);
  };
  panel(20, 4, [0, 12, 0], 3);           // overhead strip
  panel(8, 6, [-14, 4, 4], 1.6);         // key softbox
  panel(8, 6, [14, 4, -4], 1.2, 0xcfe3ff);
  panel(30, 1.2, [0, 3, -16], 2.2, 0x9fc6ff); // cool rim strip
  panel(30, 1.2, [0, 3, 16], 1.0, 0xffe0c0);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;

  // Lights
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0a0a0c, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 9, 5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
  key.shadow.radius = 6; key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.SpotLight(0x6fb6ff, 60, 30, 0.6, 0.6);
  rim.position.set(-6, 4, -7); scene.add(rim);

  // Turntable + glossy floor
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.35, metalness: 0.6 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const table = new THREE.Group(); scene.add(table);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.08, 96),
    new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.25, metalness: 0.8 }));
  disc.position.y = 0.04; disc.receiveShadow = true; table.add(disc);
  // Fly mode: the car lifts off the turntable and hovers over a soft thrust glow.
  let hover = false, lift = 0;
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(120,200,255,1)'); gr.addColorStop(0.4, 'rgba(62,166,255,.45)'); gr.addColorStop(1, 'rgba(62,166,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.2),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.1;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.02, 8, 128),
    new THREE.MeshBasicMaterial({ color: 0x3ea6ff }));
  table.add(glow);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.085; table.add(ring);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const shots = {
    menu:   { dist: 9.5, h: 1.7, look: [1.6, 0.45, 0], spin: 0.12 },
    garage: { dist: 7.2, h: 1.4, look: [0, 0.5, 0], spin: 0.0 },
    detail: { dist: 4.6, h: 0.7, look: [0, 0.4, 0], spin: 0.0 },
  };
  // Orbit camera: yaw/pitch/distance follow targets. Each shot sets defaults; user input
  // (drag, pinch, wheel) overrides them until the next shot change.
  const PITCH_MIN = 0.03, PITCH_MAX = 1.05, DIST_MIN = 3.6, DIST_MAX = 14;
  const shotPitch = (sh) => Math.atan2(sh.h - sh.look[1], sh.dist);
  let shot = shots.menu, camYaw = 0.9, camYawVel = 0, camPitchVel = 0;
  let camPitch = shotPitch(shot), camDist = shot.dist;
  let tgtPitch = camPitch, tgtDist = camDist, userControlled = false, idleT = 0;
  const look = new THREE.Vector3(...shot.look), lookTarget = look.clone();

  // Car
  let car = null, carSpec = { paint: paints[0]?.id, wheels: wheels[0]?.id };
  const findPaint = (id) => paints.find((p) => p.id === id) || paints[0];
  const findWheel = (id) => wheels.find((w) => w.id === id) || wheels[0];

  // Car. buildCarModel may return a THREE.Object3D, or the car team's handle
  // { object, setPaint(id), setWheels(id), update(dt, speed, steer), dispose() }.
  let handle = null;
  const q3 = () => { const q = getQuality?.() || 'high'; return q === 'ultra' ? 'high' : q; };
  function makeCar() {
    if (car) { table.remove(car); handle?.dispose ? handle.dispose() : disposeTree(car); }
    const paint = findPaint(carSpec.paint), wheel = findWheel(carSpec.wheels);
    handle = null; car = null;
    if (buildCarModel) {
      try {
        const res = buildCarModel({ THREE, paint: paint.id, wheels: wheel.id, quality: q3(), showroom: true });
        if (res?.isObject3D) car = res;
        else if (res?.object?.isObject3D) { handle = res; car = res.object; }
      } catch (e) { console.warn('[ui] car model failed, using placeholder:', e); }
    }
    if (!car) car = buildPlaceholderRoadster(THREE, paint, wheel);
    car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    car.position.y = 0.08;
    table.add(car);
  }
  function applyPaint() {
    const paint = findPaint(carSpec.paint);
    if (handle?.setPaint) { handle.setPaint(paint.id); return; }
    if (car?.userData?.setPaint) { car.userData.setPaint(paint); return; }
    makeCar();
  }
  function applyWheels() {
    const w = findWheel(carSpec.wheels);
    if (handle?.setWheels) { handle.setWheels(w.id); return; }
    if (car?.userData?.setWheels) { car.userData.setWheels(w); return; }
    makeCar();
  }

  // Orbit with mouse or one finger, pinch or wheel to zoom, with inertia on release.
  const pointers = new Map();
  let pinchD = 0;
  const pinchDist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    capture(canvas, e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = true; userControlled = true; idleT = 0; camYawVel = 0; camPitchVel = 0;
    if (pointers.size === 2) pinchD = pinchDist();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      // Scale by viewport so a full-width drag is about one full turn on any screen size.
      const k = (Math.PI * 2) / Math.max(400, canvas.clientWidth || innerWidth);
      camYawVel = -dx * k; camPitchVel = dy * k;
      camYaw += camYawVel;
      tgtPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, tgtPitch + camPitchVel));
      camPitch = tgtPitch;
    } else if (pointers.size === 2) {
      const d = pinchDist();
      if (pinchD > 0) tgtDist = Math.max(DIST_MIN, Math.min(DIST_MAX, tgtDist * (pinchD / d)));
      pinchD = d;
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchD = 0;
    if (pointers.size === 0) dragging = false;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); userControlled = true; idleT = 0;
    tgtDist = Math.max(DIST_MIN, Math.min(DIST_MAX, tgtDist * Math.exp(e.deltaY * 0.0015)));
  }, { passive: false });

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // On narrow/portrait screens pull back so the whole car fits.
    camera.fov = camera.aspect < 1 ? 55 : 35;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  let running = false, raf = 0, t0 = performance.now();
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
    if (!dragging) {
      // Inertia: velocities decay smoothly after release.
      const decay = Math.pow(0.02, dt);
      camYawVel *= decay; camPitchVel *= decay;
      camYaw += camYawVel;
      tgtPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, tgtPitch + camPitchVel));
      idleT += dt;
      // Resume the slow showroom spin a few seconds after the user lets go.
      camYaw += shot.spin * dt * (userControlled ? Math.min(1, Math.max(0, idleT - 4)) : 1);
    }
    camPitch += (tgtPitch - camPitch) * Math.min(1, dt * 10);
    camDist += (tgtDist - camDist) * Math.min(1, dt * 8);
    lookTarget.set(...shot.look);
    // Center the car on narrow screens since menu panels stack below.
    // Portrait phones: centre the car and aim below it so it sits in the top half, above the menu.
    if (camera.aspect < 1) { lookTarget.x = 0; lookTarget.y -= 0.55; }
    look.lerp(lookTarget, Math.min(1, dt * 3));
    // Narrow portrait screens see less width, so pull back to keep the whole car in view.
    const d = camDist * (camera.aspect < 1 ? 1.45 : 1);
    const horiz = Math.cos(camPitch) * d;
    camera.position.set(look.x + Math.sin(camYaw) * horiz, look.y + Math.sin(camPitch) * d, look.z + Math.cos(camYaw) * horiz);
    camera.lookAt(look);
    ring.material.color.setHSL(0.58, 1, 0.55 + Math.sin(now / 600) * 0.08);
    lift += ((hover ? 1 : 0) - lift) * Math.min(1, dt * 2.2);
    if (car) {
      car.position.y = 0.08 + lift * (0.85 + Math.sin(now / 700) * 0.07);
      car.rotation.z = lift * Math.sin(now / 1300) * 0.025;
    }
    glow.material.opacity = lift * (0.75 + Math.sin(now / 180) * 0.08);
    if (handle?.update) handle.update(dt, 0, 0); else car?.userData?.update?.(dt);
    renderer.render(scene, camera);
  }

  makeCar();
  resize();

  return {
    scene, camera, renderer,
    get car() { return car; },
    /** true = fly mode (car hovers), false = drive mode (car sits on the turntable). */
    setHover(v) { hover = !!v; },
    setShot(name) {
      const next = shots[name] || shots.menu;
      if (next === shot) return;
      shot = next; userControlled = false; idleT = 0;
      tgtPitch = shotPitch(shot); tgtDist = shot.dist;
    },
    setCar({ paint, wheels: wh } = {}) {
      const pc = paint && paint !== carSpec.paint, wc = wh && wh !== carSpec.wheels;
      if (paint) carSpec.paint = paint; if (wh) carSpec.wheels = wh;
      if (pc) applyPaint(); if (wc) applyWheels();
    },
    setCatalog(p, w) { if (p) paints = p; if (w) wheels = w; makeCar(); },
    start() { if (running) return; running = true; canvas.style.display = ''; resize(); t0 = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); canvas.style.display = 'none'; },
    resize,
    dispose() { this.stop(); disposeTree(scene); renderer.dispose(); pmrem.dispose(); removeEventListener('resize', resize); },
  };
}

function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose?.());
  });
}

export function applyPaintToMaterial(mat, paint) {
  mat.color.set(paint.color);
  mat.metalness = paint.metalness ?? 0.6;
  mat.roughness = paint.roughness ?? 0.3;
  if ('clearcoat' in mat) { mat.clearcoat = paint.clearcoat ?? 1; mat.clearcoatRoughness = paint.clearcoatRoughness ?? 0.05; }
  if ('sheen' in mat && paint.sheen) { mat.sheen = paint.sheen; mat.sheenColor?.set(paint.sheenColor || paint.color); }
  if ('iridescence' in mat) mat.iridescence = paint.iridescence || 0;
  mat.needsUpdate = true;
}

// Stand-in Roadster silhouette used until the car team's model is wired in.
// Long low nose, cab-rearward canopy, short fastback tail: built from an extruded side profile.
export function buildPlaceholderRoadster(THREE, paint, wheel) {
  const g = new THREE.Group();
  const L = 4.2, W = 2.0;
  const paintMat = new THREE.MeshPhysicalMaterial({ color: paint.color });
  paintMat.userData.isPaint = true;
  applyPaintToMaterial(paintMat, paint);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, metalness: 0.2, roughness: 0.05, transmission: 0, clearcoat: 1, opacity: 0.92, transparent: true });
  const black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6, metalness: 0.2 });

  // Side profile (x = length, y = height), nose at +x.
  const s = new THREE.Shape();
  s.moveTo(-L / 2, 0.32);
  s.bezierCurveTo(-L / 2 - 0.06, 0.55, -L / 2 + 0.05, 0.78, -L / 2 + 0.35, 0.82); // tail
  s.lineTo(-0.2, 0.86);
  s.bezierCurveTo(0.6, 0.86, 1.2, 0.74, 1.7, 0.62);       // hood
  s.bezierCurveTo(2.0, 0.55, L / 2 + 0.02, 0.46, L / 2, 0.34); // nose
  s.bezierCurveTo(L / 2 - 0.05, 0.2, L / 2 - 0.2, 0.16, L / 2 - 0.35, 0.16);
  s.lineTo(-L / 2 + 0.3, 0.16);
  s.bezierCurveTo(-L / 2 + 0.1, 0.16, -L / 2, 0.2, -L / 2, 0.32);
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: W - 0.24, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 6, curveSegments: 24 });
  bodyGeo.translate(0, 0, -(W - 0.24) / 2);
  const body = new THREE.Mesh(bodyGeo, paintMat);
  g.add(body);

  // Canopy (tinted glass) sitting rearward of center
  const c = new THREE.Shape();
  c.moveTo(-1.35, 0.84);
  c.bezierCurveTo(-1.0, 1.22, -0.2, 1.26, 0.25, 1.18);
  c.bezierCurveTo(0.6, 1.1, 0.95, 0.92, 1.15, 0.8);
  c.lineTo(-1.35, 0.8);
  const canGeo = new THREE.ExtrudeGeometry(c, { depth: W - 0.62, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.1, bevelSegments: 6, curveSegments: 20 });
  canGeo.translate(0, 0, -(W - 0.62) / 2);
  g.add(new THREE.Mesh(canGeo, glass));

  // Lights
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfe8ff, emissiveIntensity: 2 });
  for (const z of [-0.68, 0.68]) {
    const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.32, 4, 8), headMat);
    h.rotation.set(0, z > 0 ? -0.5 : 0.5, Math.PI / 2 - 0.25);
    h.position.set(L / 2 - 0.22, 0.5, z); g.add(h);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, W - 0.3),
    new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1020, emissiveIntensity: 2.5 }));
  tail.position.set(-L / 2 - 0.1, 0.68, 0); g.add(tail);
  const diff = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, W - 0.5), black);
  diff.position.set(-L / 2 + 0.05, 0.2, 0); g.add(diff);

  // Wheels
  const wheelsGroup = new THREE.Group(); g.add(wheelsGroup);
  function buildWheels(spec) {
    wheelsGroup.clear();
    const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: spec.color ?? 0xb8bcc4, metalness: 0.95, roughness: spec.roughness ?? 0.25 });
    const spokes = spec.spokes ?? 10;
    for (const [x, z, r] of [[1.32, 1, 0.36], [1.32, -1, 0.36], [-1.28, 1, 0.38], [-1.28, -1, 0.38]]) {
      const wg = new THREE.Group();
      const t = new THREE.Mesh(new THREE.TorusGeometry(r - 0.07, 0.1, 16, 40), tire);
      wg.add(t);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.12, r - 0.12, 0.24, 32, 1, true), rimMat);
      barrel.rotation.x = Math.PI / 2; wg.add(barrel);
      for (let i = 0; i < spokes; i++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, r - 0.16, 0.04), rimMat);
        const a = (i / spokes) * Math.PI * 2 + (spec.twist ?? 0);
        sp.position.set(Math.sin(a) * (r - 0.16) / 2, Math.cos(a) * (r - 0.16) / 2, 0.1 * Math.sign(z));
        sp.rotation.z = -a + (spec.twist ?? 0); wg.add(sp);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), rimMat);
      hub.rotation.x = Math.PI / 2; hub.position.z = 0.11 * Math.sign(z); wg.add(hub);
      wg.position.set(x, r, z * (W / 2 - 0.08));
      wheelsGroup.add(wg);
    }
  }
  buildWheels(wheel);
  g.userData.setWheels = buildWheels;
  g.userData.setPaint = (p) => applyPaintToMaterial(paintMat, p);
  return g;
}
