// Roadster-inspired hypercars, fully procedural (no external model, no logos).
// Two models: 'rocket' (default, flying) and 'classic'.
//
//   import { createRoadster, PAINTS, WHEELS, MODELS } from './src/car/roadster.js';
//   const car = createRoadster({ model: 'rocket', paint: 'pearlWhite', wheels: 'aeroSilver', quality: 'high' });
//   scene.add(car.object);
//   // every frame:
//   car.update(dt, speedMetersPerSecond, steerRadians);
//
// Units are metres. Origin is on the ground, midway between the axles; +Z is
// forward, +Y up, the driver sits on +X. quality: 'high' | 'medium' | 'low' |
// 'auto' ('auto' builds all three into a THREE.LOD that switches by distance).
// car.body is the sprung body group (no wheels) for roll/pitch.
// Flight (rocket model; harmless no-ops on classic):
//   car.setFlight(0..1)  0 = road, 1 = flight (wings out, wheels tilt flat)
//   car.setThrust(0..1)  nozzle glow and flame length
//   car.setBoost(bool)   extra afterburn
// Triangle counts (incl. wheels): high ≈ 75–92k by rim style, medium ≈ 36–38k, low ≈ 6–7k.

import * as THREE from 'three';
import { classicShape, mirrorX, WELL_X } from './body.js';
import { rocketShape, addRocketParts, animateRocket } from './rocket.js';
import { buildWheel, setRimStyle } from './wheels.js';
import {
  PAINTS, WHEELS, CALIPERS, getPaint, getWheel, createMaterials, applyPaint, applyWheelFinish,
} from './materials.js';

export const MODELS = [
  { id: 'rocket', name: 'Rocket Roadster', flight: true },
  { id: 'classic', name: 'Classic Roadster', flight: false },
];
const SHAPES = { rocket: rocketShape, classic: classicShape };
const DIM = classicShape.DIM; // both models share the wheel layout
export { PAINTS, WHEELS, CALIPERS, DIM };

const LEVELS = {
  high: { rings: 130, segs: 40, details: true, cabRings: 40, cabSegs: 16, tube: 8 },
  medium: { rings: 70, segs: 24, details: true, cabRings: 22, cabSegs: 10, tube: 5 },
  low: { rings: 46, segs: 16, details: true, cabRings: 12, cabSegs: 6, tube: 3 },
};
const LOD_DIST = { high: 0, medium: 16, low: 45 };
const lerp = (a, b, t) => a + (b - a) * t;
const LEAN_PIVOT_Y = 0.45; // roughly the centre of mass height

// Geometry for each quality level is identical for every car, so build once.
const geoCache = new Map();
function levelGeometry(model, q) {
  const key = `${model}:${q}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const shape = SHAPES[model];
  const {
    buildBodyGeometry, buildCabin, cabinLine, headlampGeometry, tailLightPath, shutLine, skinPatch, archPath, spec,
  } = shape;
  const DIM = shape.DIM;
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
    // Starts above the body's underside so it never shows below the sills.
    sh.moveTo(-R, 0.17);
    sh.lineTo(R, 0.17);
    sh.lineTo(R, a.r);
    sh.absarc(0, a.r, R, 0, Math.PI, false);
    sh.closePath();
    return new THREE.ShapeGeometry(sh, q === 'low' ? 6 : 16).rotateY(Math.PI / 2);
  });

  {
    const lo = q === 'low';
    // Window frame / targa edges.
    g.frames = both(tube(cabinLine(spec.frame[0], spec.frame[1], spec.frame[2], lo ? 12 : 30), 0.011, lo ? 16 : 50));
    // Spoiler: thin painted blade over the rear deck.
    if (spec.spoiler) {
      const sp = skinPatch(spec.spoiler[0], spec.spoiler[1], q === 'high' ? 10 : 5, (t, v) => 1.0 + v * (Math.PI / 2 - 1.0), q === 'high' ? 10 : 5, 0.004);
      g.spoiler = both(white(sp));
    }
    g.bezel = both(headlampGeometry(q === 'high' ? 18 : lo ? 6 : 8, 2, 0.012));
    // Camera pods instead of mirrors: slim aero teardrops on thin stalks.
    const cap = new THREE.CapsuleGeometry(0.03, 0.11, 3, q === 'high' ? 12 : 6);
    cap.rotateZ(Math.PI / 2).scale(1, 0.85, 1.25);
    g.mirror = white(cap);
    g.mirrorStalk = new THREE.BoxGeometry(0.12, 0.012, 0.035);
    g.camLens = new THREE.CircleGeometry(0.014, 10).rotateY(Math.PI);
    // Speedster fairings / dorsal spine on the rear deck.
    const fair = new THREE.SphereGeometry(1, q === 'high' ? 24 : 10, q === 'high' ? 14 : 6, 0, Math.PI * 2, 0, Math.PI / 2);
    g.fairing = white(fair);
    // Interior.
    g.seatBase = new THREE.BoxGeometry(0.48, 0.12, 0.5);
    // Rounded shell backrest with an integrated headrest.
    g.seatBack = new THREE.CapsuleGeometry(0.2, 0.26, 4, q === 'high' ? 14 : 8).scale(1.15, 1, 0.3);
    g.headrest = new THREE.CapsuleGeometry(0.1, 0.04, 3, q === 'high' ? 12 : 6).scale(1.2, 1, 0.5);
    g.dash = new THREE.BoxGeometry(1.24, 0.12, 0.3);
    g.wheel = spec.yoke
      ? new THREE.TorusGeometry(0.15, 0.019, 8, q === 'high' ? 24 : 10, Math.PI * 1.15)
      : new THREE.TorusGeometry(0.165, 0.017, 8, q === 'high' ? 32 : 16);
    g.console = new THREE.BoxGeometry(0.2, 0.16, 0.75);
    g.screen = new THREE.BoxGeometry(0.34, 0.2, 0.015);
    g.fin = new THREE.BoxGeometry(0.012, 0.09, 0.32);
    if (q === 'high') {
      g.shut = spec.shut.flatMap(([z, a, b]) => both(tube(shutLine(z, a, b), 0.0022, 24)));
    }
  }
  g.shadow = new THREE.PlaneGeometry(2.5, 5.0).rotateX(-Math.PI / 2);
  geoCache.set(key, g);
  return g;
}

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow;
  return m;
}

/** Builds one detail level of the car. */
function buildLevel(model, q, mats, wheelSpec) {
  const g = levelGeometry(model, q);
  const shape = SHAPES[model];
  const DIM = shape.DIM;
  // level → lean (pivot near the centre of mass) → root (all sprung parts).
  // Wheels hang off `level` directly so body roll/pitch doesn't move them.
  const level = new THREE.Group();
  level.name = `roadster-${model}-${q}`;
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
  if (g.roof) root.add(mesh(g.roof, mats.gloss));
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
    r.position.set(0.32 * s, model === 'rocket' ? 0.3 : 0.36, shape.Z_MIN + 0.03);
    root.add(r);
  }

  let spoiler = null;
  {
    g.frames.forEach((f) => root.add(mesh(f, mats.gloss)));
    g.bezel.forEach((b) => root.add(mesh(b, mats.bezel, false)));
    (g.shut || []).forEach((s) => root.add(mesh(s, mats.trim, false)));

    if (g.spoiler) {
      const hz = shape.spec.spoiler[1];
      spoiler = new THREE.Group();
      spoiler.position.set(0, 0, hz); // hinge at the front edge of the blade
      g.spoiler.forEach((s) => {
        const m = mesh(s, mats.paint);
        m.position.z = -hz;
        spoiler.add(m);
      });
      root.add(spoiler);
    }

    const mp = shape.spec.mirror || [0.86, 0.9, 0.5];
    for (const s of [1, -1]) {
      const cap = mesh(g.mirror, mats.paint);
      cap.position.set(mp[0] * s, mp[1], mp[2]);
      root.add(cap);
      const lens = mesh(g.camLens, mats.gloss, false);
      lens.position.set(mp[0] * s + 0.03 * s, mp[1], mp[2] - 0.075);
      root.add(lens);
      const stalk = mesh(g.mirrorStalk, mats.gloss);
      stalk.position.set((mp[0] - 0.09) * s, mp[1] - 0.03, mp[2] + 0.01);
      stalk.rotation.z = 0.35 * s;
      root.add(stalk);
    }
    for (const f of shape.spec.fairings || []) {
      const m = mesh(g.fairing, mats.paint);
      m.position.set(f.x, shape.bodyTopAt(f.z, Math.abs(f.x)) - 0.03, f.z);
      m.scale.set(f.w, f.h, f.l);
      root.add(m);
    }

    // Diffuser fins.
    for (let i = -2; i <= (shape.spec.fins ? 2 : -3); i++) {
      const f = mesh(g.fin, mats.trim);
      f.position.set(i * 0.22, 0.24, -2.0);
      root.add(f);
    }

    // Cockpit: two sport seats, dash, centre screen and steering wheel (LHD, +X).
    const floor = shape.COCKPIT.floor;
    for (const s of [1, -1]) {
      const base = mesh(g.seatBase, mats.seat);
      base.position.set(0.34 * s, floor + 0.08, -0.25);
      const back = mesh(g.seatBack, mats.seat);
      back.position.set(0.34 * s, floor + 0.3, -0.5);
      back.rotation.x = -0.22;
      const head = mesh(g.headrest, mats.interior);
      head.position.set(0.34 * s, floor + 0.54, -0.56);
      head.rotation.x = -0.22;
      root.add(base, back, head);
    }
    const cons = mesh(g.console, mats.carbon);
    cons.position.set(0, floor + 0.08, 0.0);
    root.add(cons);
    const dash = mesh(g.dash, mats.interior);
    dash.position.set(0, 0.72, 0.42);
    const screen = mesh(g.screen, mats.gloss);
    screen.position.set(0, 0.84, 0.32);
    screen.rotation.x = -0.35;
    const wheel = mesh(g.wheel, mats.interior);
    wheel.position.set(0.34, 0.8, 0.2);
    wheel.rotation.x = -0.35;
    if (shape.spec.yoke) wheel.rotation.z = Math.PI * 1.075 + Math.PI; // open at the top
    root.add(dash, screen, wheel);
  }

  const wheels = [];
  for (const axle of [DIM.front, DIM.rear]) {
    for (const side of [1, -1]) {
      const w = buildWheel(axle, side, wheelSpec, mats, q);
      w.base = w.pivot.position.clone();
      level.add(w.pivot);
      wheels.push(w);
    }
  }
  const rocket = model === 'rocket' ? addRocketParts(root, q, mats, wheels) : null;
  return { root: level, lean, wheels, spoiler, rocket, q };
}

/**
 * Creates a car. Options:
 *   model     'rocket' | 'classic'  (default 'rocket')
 *   paint     PAINTS id            (default 'pearlWhite')
 *   wheels    WHEELS id            (default 'aeroSilver')
 *   caliper   'red'|'black'|'yellow'|'blue'
 *   quality   'high'|'medium'|'low'|'auto'
 *   headlightBeams  add real SpotLights (default: true on 'high' only)
 *   contactShadow   soft blob under the car (default true)
 */
export function createRoadster(opts = {}) {
  const quality = opts.quality || 'high';
  const model = SHAPES[opts.model] ? opts.model : 'rocket';
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
    const lvl = buildLevel(model, q, mats, getWheel(wheelId));
    levels.push(lvl);
    if (lod) lod.addLevel(lvl.root, LOD_DIST[q]);
    else object.add(lvl.root);
  }

  if (opts.contactShadow !== false) {
    const blob = new THREE.Mesh(levelGeometry(model, qs[qs.length - 1]).shadow, mats.shadow);
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

  const state = {
    steer: 0, spinF: 0, spinR: 0, brake: false, lights: false, reverse: false, spoiler: 0, spoilerTarget: null,
    flight: 0, thrust: 0, boost: false, time: 0,
  };

  function forWheels(fn) { for (const l of levels) for (const w of l.wheels) fn(w); }

  // Sprung body for roll/pitch. With one level it is the real group; with
  // 'auto' it is a proxy whose transform update() copies to every level.
  const body = levels.length === 1 ? levels[0].lean : new THREE.Object3D();
  body.position.y = LEAN_PIVOT_Y;

  const car = {
    object,
    model,
    /** Sprung body (no wheels), pivot ~centre of mass: lean it via rotation.x/z, bounce via position.y. */
    body,
    dimensions: SHAPES[model].DIM,
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
    /** 0 = road, 1 = flight. Animates wings, canards and wheel tilt (rocket). */
    setFlight(v) { state.flight = Math.min(1, Math.max(0, +v || 0)); car.refreshFlight(); },
    /** 0..1: nozzle glow and flame length. */
    setThrust(v) { state.thrust = Math.min(1, Math.max(0, +v || 0)); car.refreshFlight(); },
    /** Extra afterburn on top of thrust. */
    setBoost(on) {
      state.boost = !!on;
      mats.flameOuter.color.setHex(on ? 0xc070ff : 0x3a9cff);
      car.refreshFlight();
    },
    get flight() { return state.flight; },
    refreshFlight() {
      const glow = 0.4 + state.thrust * 5 + (state.boost ? 6 : 0);
      mats.thrusterGlow.emissiveIntensity = glow;
      mats.flameOuter.opacity = Math.min(1, 0.25 + state.thrust * 0.45 + (state.boost ? 0.3 : 0));
      mats.flameCore.opacity = Math.min(1, 0.4 + state.thrust * 0.5);
      for (const l of levels) {
        if (l.rocket) animateRocket(l.rocket, l.wheels, state.flight, state.thrust, state.boost, state.time);
      }
    },
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
      state.time += dt;
      // On the road the wheels roll with speed; tilted for flight they spin
      // like turbines with thrust.
      const fl = state.flight;
      const turbine = (6 + 40 * state.thrust + (state.boost ? 30 : 0)) * dt;
      const f = state.spinF + lerp((speed / DIM.front.r) * dt, turbine, fl);
      const r = state.spinR + lerp((speed / DIM.rear.r) * dt, turbine, fl);
      car.setWheelSpin(f % (Math.PI * 2), r % (Math.PI * 2));
      // Spoiler rises at speed and acts as an air brake under hard braking.
      if (model === 'rocket') car.refreshFlight();
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
      for (const l of levels) if (l.rocket) for (const p of l.rocket.lights) p.dispose();
    },
  };
  car.setHeadlights(!!opts.headlights);
  car.setBrake(false);
  car.setBoost(false);
  return car;
}
