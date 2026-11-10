// Roadster-inspired hypercar, fully procedural (no external model, no logos).
//
//   import { createRoadster, PAINTS, WHEELS } from './src/car/roadster.js';
//   const car = createRoadster({ paint: 'pearlWhite', wheels: 'aeroSilver', quality: 'high' });
//   scene.add(car.object);
//   // every frame:
//   car.update(dt, speedMetersPerSecond, steerRadians);
//
// Units are metres. Origin is on the ground, midway between the axles; +Z is
// forward, +Y up, the driver sits on +X. quality: 'high' | 'medium' | 'low' |
// 'auto' ('auto' builds all three into a THREE.LOD that switches by distance).
// car.body is the sprung body group (no wheels) for roll/pitch.
// Triangle counts (incl. wheels): high ≈ 73–88k by rim style, medium ≈ 35k, low ≈ 6k.

import * as THREE from 'three';
import {
  DIM, buildBodyGeometry, buildCabin, cabinLine, headlampGeometry, tailLightPath,
  shutLine, skinPatch, mirrorX, archPath, BODY_INFO, WELL_X,
} from './body.js';
import { buildWheel, setRimStyle } from './wheels.js';
import {
  PAINTS, WHEELS, CALIPERS, getPaint, getWheel, createMaterials, applyPaint, applyWheelFinish,
} from './materials.js';

export { PAINTS, WHEELS, CALIPERS, DIM };

const LEVELS = {
  high: { rings: 130, segs: 40, details: true, cabRings: 40, cabSegs: 16, tube: 8 },
  medium: { rings: 70, segs: 24, details: true, cabRings: 22, cabSegs: 10, tube: 5 },
  low: { rings: 34, segs: 13, details: false, cabRings: 10, cabSegs: 5, tube: 3 },
};
const LOD_DIST = { high: 0, medium: 16, low: 45 };
const LEAN_PIVOT_Y = 0.45; // roughly the centre of mass height

// Geometry for each quality level is identical for every car, so build once.
const geoCache = new Map();
function levelGeometry(q) {
  if (geoCache.has(q)) return geoCache.get(q);
  const L = LEVELS[q];
  const g = {};
  g.body = buildBodyGeometry({ rings: L.rings, segs: L.segs, details: L.details });
  const cab = buildCabin({ rings: L.cabRings, segs: L.cabSegs });
  g.glass = cab.glass;
  g.roof = cab.roof;
  const tube = (pts, r, seg = 40) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, L.tube, false);
  const both = (geo) => [geo, mirrorX(geo)];

  g.lamp = both(headlampGeometry(q === 'low' ? 6 : 18, q === 'low' ? 2 : 4));
  // Fender lips: a rolled edge around each arch opening.
  // Anything drawn with the paint needs colour (white = paint) and the arch
  // cut distance (positive = keep).
  const white = (geo) => {
    const n = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    geo.setAttribute('cut', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    return geo;
  };
  g.lips = [DIM.front, DIM.rear].flatMap((a) => both(white(tube(archPath(a), 0.02, q === 'low' ? 16 : 60))));
  g.tail = tube(tailLightPath(), 0.016, q === 'low' ? 24 : 80);

  // Arch liners hide the inside of the skin when you look into a wheel well.
  g.liners = [DIM.front, DIM.rear].map((a) => {
    const c = new THREE.CylinderGeometry(a.r + 0.04, a.r + 0.04, 0.4, q === 'low' ? 8 : 20, 1, true, 0, Math.PI);
    c.rotateZ(Math.PI / 2);
    return c;
  });
  // Inner wall of each well, so you can't see into the body through the arch.
  g.wellWalls = [DIM.front, DIM.rear].map((a) => {
    const R = a.r + 0.05;
    const sh = new THREE.Shape();
    sh.moveTo(-R, 0.08);
    sh.lineTo(R, 0.08);
    sh.lineTo(R, a.r);
    sh.absarc(0, a.r, R, 0, Math.PI, false);
    sh.closePath();
    return new THREE.ShapeGeometry(sh, q === 'low' ? 6 : 16).rotateY(Math.PI / 2);
  });

  if (q !== 'low') {
    // Window frame / targa edges.
    g.frames = both(tube(cabinLine(0.6, -1.0, 0.76, 30), 0.011, 50));
    // Spoiler: thin painted blade over the rear deck.
    const sp = skinPatch(-2.03, -1.83, q === 'high' ? 10 : 5, (t, v) => 1.0 + v * (Math.PI / 2 - 1.0), q === 'high' ? 10 : 5, 0.004);
    g.spoiler = both(white(sp));
    g.bezel = both(headlampGeometry(q === 'high' ? 18 : 8, 2, 0.012));
    // Mirrors.
    const cap = new THREE.SphereGeometry(0.075, q === 'high' ? 20 : 10, q === 'high' ? 12 : 6);
    cap.scale(1.35, 0.7, 0.8);
    g.mirror = white(cap);
    g.mirrorStalk = new THREE.BoxGeometry(0.11, 0.018, 0.04);
    // Interior.
    g.seatBase = new THREE.BoxGeometry(0.48, 0.12, 0.5);
    g.seatBack = new THREE.BoxGeometry(0.48, 0.5, 0.12);
    g.headrest = new THREE.BoxGeometry(0.26, 0.16, 0.1);
    g.dash = new THREE.BoxGeometry(1.24, 0.12, 0.3);
    g.wheel = new THREE.TorusGeometry(0.165, 0.017, 8, q === 'high' ? 32 : 16);
    g.screen = new THREE.BoxGeometry(0.34, 0.2, 0.015);
    g.fin = new THREE.BoxGeometry(0.012, 0.09, 0.32);
    if (q === 'high') {
      g.shut = [
        ...both(tube(shutLine(0.50, -0.5, 0.62), 0.0022, 24)),
        ...both(tube(shutLine(-0.45, -0.5, 0.75), 0.0022, 24)),
        ...both(tube(shutLine(1.62, 0.85, Math.PI / 2), 0.0022, 16)),
      ];
    }
  }
  g.shadow = new THREE.PlaneGeometry(2.5, 5.0).rotateX(-Math.PI / 2);
  geoCache.set(q, g);
  return g;
}

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  return m;
}

/** Builds one detail level of the car. */
function buildLevel(q, mats, wheelSpec) {
  const g = levelGeometry(q);
  // level → lean (pivot near the centre of mass) → root (all sprung parts).
  // Wheels hang off `level` directly so body roll/pitch doesn't move them.
  const level = new THREE.Group();
  level.name = `roadster-${q}`;
  const lean = new THREE.Group();
  lean.name = 'body';
  lean.position.y = LEAN_PIVOT_Y;
  const root = new THREE.Group();
  root.position.y = -LEAN_PIVOT_Y;
  lean.add(root);
  level.add(lean);

  root.add(mesh(g.body, mats.paint));
  const glass = mesh(g.glass, mats.glass, false);
  glass.renderOrder = 2;
  root.add(glass);
  root.add(mesh(g.roof, mats.gloss));
  g.lamp.forEach((l) => root.add(mesh(l, mats.headlight, false)));
  root.add(mesh(g.tail, mats.taillight, false));
  g.lips.forEach((l) => root.add(mesh(l, mats.paint)));

  [DIM.front, DIM.rear].forEach((a, i) => {
    for (const s of [1, -1]) {
      const l = mesh(g.liners[i], mats.well, false);
      l.position.set(a.x * s, a.r, a.z);
      root.add(l);
      const wall = mesh(g.wellWalls[i], mats.well, false);
      wall.position.set(WELL_X * s, 0, a.z);
      root.add(wall);
    }
  });

  // Reverse lights low on the tail.
  for (const s of [1, -1]) {
    const r = mesh(new THREE.BoxGeometry(0.14, 0.025, 0.01), mats.reverse, false);
    r.position.set(0.32 * s, 0.36, BODY_INFO.Z_MIN + 0.03);
    root.add(r);
  }

  let spoiler = null;
  if (q !== 'low') {
    g.frames.forEach((f) => root.add(mesh(f, mats.gloss)));
    g.bezel.forEach((b) => root.add(mesh(b, mats.bezel, false)));
    (g.shut || []).forEach((s) => root.add(mesh(s, mats.trim, false)));

    spoiler = new THREE.Group();
    spoiler.position.set(0, 0, -1.83); // hinge at the front edge of the blade
    g.spoiler.forEach((s) => {
      const m = mesh(s, mats.paint);
      m.position.z = 1.83;
      spoiler.add(m);
    });
    root.add(spoiler);

    for (const s of [1, -1]) {
      const cap = mesh(g.mirror, mats.paint);
      cap.position.set(0.9 * s, 0.9, 0.5);
      root.add(cap);
      const stalk = mesh(g.mirrorStalk, mats.gloss);
      stalk.position.set(0.8 * s, 0.86, 0.5);
      stalk.rotation.z = 0.35 * s;
      root.add(stalk);
    }

    // Diffuser fins.
    for (let i = -2; i <= 2; i++) {
      const f = mesh(g.fin, mats.trim);
      f.position.set(i * 0.22, 0.24, -2.0);
      root.add(f);
    }

    // Cockpit: two sport seats, dash, centre screen and steering wheel (LHD, +X).
    const floor = BODY_INFO.COCKPIT.floor;
    for (const s of [1, -1]) {
      const base = mesh(g.seatBase, mats.seat);
      base.position.set(0.34 * s, floor + 0.08, -0.25);
      const back = mesh(g.seatBack, mats.seat);
      back.position.set(0.34 * s, floor + 0.32, -0.52);
      back.rotation.x = -0.22;
      const head = mesh(g.headrest, mats.interior);
      head.position.set(0.34 * s, floor + 0.62, -0.58);
      head.rotation.x = -0.22;
      root.add(base, back, head);
    }
    const dash = mesh(g.dash, mats.interior);
    dash.position.set(0, 0.72, 0.42);
    const screen = mesh(g.screen, mats.gloss);
    screen.position.set(0, 0.84, 0.32);
    screen.rotation.x = -0.35;
    const wheel = mesh(g.wheel, mats.interior);
    wheel.position.set(0.34, 0.8, 0.2);
    wheel.rotation.x = -0.35;
    root.add(dash, screen, wheel);
  }

  const wheels = [];
  for (const axle of [DIM.front, DIM.rear]) {
    for (const side of [1, -1]) {
      const w = buildWheel(axle, side, wheelSpec, mats, q);
      level.add(w.pivot);
      wheels.push(w);
    }
  }
  return { root: level, lean, wheels, spoiler, q };
}

/**
 * Creates a car. Options:
 *   paint     PAINTS id            (default 'pearlWhite')
 *   wheels    WHEELS id            (default 'aeroSilver')
 *   caliper   'red'|'black'|'yellow'|'blue'
 *   quality   'high'|'medium'|'low'|'auto'
 *   headlightBeams  add real SpotLights (default: true on 'high' only)
 *   contactShadow   soft blob under the car (default true)
 */
export function createRoadster(opts = {}) {
  const quality = opts.quality || 'high';
  let paintId = getPaint(opts.paint).id;
  let wheelId = getWheel(opts.wheels).id;
  const matQ = quality === 'auto' ? 'high' : quality;
  const mats = createMaterials(matQ, paintId, wheelId, opts.caliper);

  const object = new THREE.Group();
  object.name = 'Roadster';
  const levels = [];
  const qs = quality === 'auto' ? ['high', 'medium', 'low'] : [quality];
  let lod = null;
  if (qs.length > 1) {
    lod = new THREE.LOD();
    object.add(lod);
  }
  for (const q of qs) {
    const lvl = buildLevel(q, mats, getWheel(wheelId));
    levels.push(lvl);
    if (lod) lod.addLevel(lvl.root, LOD_DIST[q]);
    else object.add(lvl.root);
  }

  if (opts.contactShadow !== false) {
    const blob = new THREE.Mesh(levelGeometry(qs[qs.length - 1]).shadow, mats.shadow);
    blob.position.y = 0.012;
    blob.renderOrder = -1;
    object.add(blob);
  }

  // Optional real headlight beams.
  const beams = [];
  if (opts.headlightBeams ?? quality === 'high') {
    for (const s of [1, -1]) {
      const l = new THREE.SpotLight(0xf2f6ff, 0, 70, 0.45, 0.5, 1.2);
      l.position.set(0.62 * s, 0.62, 2.0);
      l.target.position.set(0.9 * s, 0, 14);
      object.add(l, l.target);
      beams.push(l);
    }
  }

  const state = { steer: 0, spinF: 0, spinR: 0, brake: false, lights: false, reverse: false, spoiler: 0, spoilerTarget: null };

  function forWheels(fn) { for (const l of levels) for (const w of l.wheels) fn(w); }

  // Sprung body for roll/pitch. With one level it is the real group; with
  // 'auto' it is a proxy whose transform update() copies to every level.
  const body = levels.length === 1 ? levels[0].lean : new THREE.Object3D();
  body.position.y = LEAN_PIVOT_Y;

  const car = {
    object,
    /** Sprung body (no wheels), pivot ~centre of mass: lean it via rotation.x/z, bounce via position.y. */
    body,
    dimensions: DIM,
    get paint() { return paintId; },
    get wheels() { return wheelId; },
    /** Wheel contact points in car space (FL, FR, RL, RR) for physics. */
    wheelPositions: [DIM.front, DIM.rear].flatMap((a) => [1, -1].map((s) => new THREE.Vector3(a.x * s, 0, a.z))),
    wheelRadius: { front: DIM.front.r, rear: DIM.rear.r },

    setPaint(id) { paintId = getPaint(id).id; applyPaint(mats.paint, getPaint(id)); },
    setWheels(id) {
      const spec = getWheel(id);
      const prevStyle = getWheel(wheelId).style;
      wheelId = spec.id;
      applyWheelFinish(mats.rim, spec);
      if (spec.style !== prevStyle) {
        for (const l of levels) for (const w of l.wheels) setRimStyle(w, spec, mats, l.q);
      }
    },
    setCaliper(name) { mats.caliper.color.setHex(CALIPERS[name] ?? CALIPERS.red); },

    setSteer(rad) {
      state.steer = rad;
      forWheels((w) => { if (w.steer) w.pivot.rotation.y = rad; });
    },
    setWheelSpin(front, rear = front) {
      state.spinF = front; state.spinR = rear;
      forWheels((w) => { w.spin.rotation.x = (w.steer ? front : rear) * w.sign; });
    },
    setBrake(on) {
      state.brake = !!on;
      mats.taillight.emissiveIntensity = on ? 4 : 0.9;
    },
    setHeadlights(on) {
      state.lights = !!on;
      mats.headlight.emissiveIntensity = on ? 6 : 0.6;
      for (const b of beams) b.intensity = on ? 120 : 0;
    },
    setReverse(on) { state.reverse = !!on; mats.reverse.emissiveIntensity = on ? 3 : 0; },
    /** 0 = stowed, 1 = fully raised. Pass null to go back to automatic. */
    setSpoiler(v) { state.spoilerTarget = v; },
    /** Force a detail level when built with quality 'auto'. */
    setQuality(q) {
      if (!lod) return;
      lod.autoUpdate = q === 'auto';
      for (const l of levels) l.root.visible = q === 'auto' || l.q === q;
    },

    /** Per-frame animation: wheel roll, steering, active aero. */
    update(dt, speed = 0, steer = state.steer) {
      if (levels.length > 1) {
        for (const l of levels) { l.lean.position.copy(body.position); l.lean.quaternion.copy(body.quaternion); }
      }
      if (steer !== state.steer) car.setSteer(steer);
      const f = state.spinF + (speed / DIM.front.r) * dt;
      const r = state.spinR + (speed / DIM.rear.r) * dt;
      car.setWheelSpin(f % (Math.PI * 2), r % (Math.PI * 2));
      // Spoiler rises at speed and acts as an air brake under hard braking.
      const auto = speed > 22 || (state.brake && speed > 15) ? 1 : 0;
      const target = state.spoilerTarget ?? auto;
      state.spoiler += (target - state.spoiler) * Math.min(1, dt * 4);
      for (const l of levels) {
        if (!l.spoiler) continue;
        const air = state.brake && speed > 15 ? 1.6 : 1;
        l.spoiler.rotation.x = -0.12 * state.spoiler * air;
        l.spoiler.position.y = 0.045 * state.spoiler;
      }
    },

    /** Frees this car's materials. Shared geometry stays cached. */
    dispose() {
      object.removeFromParent();
      // Material.dispose() leaves textures alone, and those are shared/cached.
      for (const m of Object.values(mats)) m.dispose();
    },
  };
  car.setHeadlights(!!opts.headlights);
  car.setBrake(false);
  return car;
}
