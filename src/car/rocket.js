// "Rocket" model: a flying hypercar built on the same lofted-body system as
// the classic Roadster, plus flight hardware. Original procedural design.
//
//   • Lower, wider body with a long bubble canopy (no roof panel).
//   • Twin ducted rear thrusters with glowing nozzles and plasma flames.
//   • Four underbody lift vents that fire downward in flight.
//   • Rear winglets that flip out from the deck, front canards that swing
//     out from the flanks.
//   • Wheels tilt flat and tuck up in flight, showing glowing hover rings.

import * as THREE from 'three';
import { createShape, mirrorX, C_PAINT, C_TRIM } from './body.js';
import { lerp, smoothstep } from './curves.js';

const DIM_ROCKET = {
  length: 4.47,
  width: 2.08,
  height: 1.09,
  wheelbase: 2.53,
  // Same wheel layout as the classic car so physics doesn't change per model.
  front: { z: 1.27, x: 0.80, r: 0.352, w: 0.245 },
  rear: { z: -1.26, x: 0.80, r: 0.364, w: 0.300 },
};

export const ROCKET = {
  DIM: DIM_ROCKET,
  zRear: -2.20, zFront: 2.20, zMin: -2.25, zMax: 2.235,
  top: [[-2.20, 0.70], [-2.05, 0.78], [-1.7, 0.82], [-1.26, 0.83], [-0.9, 0.81], [-0.5, 0.75],
    [0.0, 0.73], [0.5, 0.74], [0.9, 0.75], [1.27, 0.74], [1.6, 0.66], [1.9, 0.54], [2.08, 0.43], [2.20, 0.33]],
  bottom: [[-2.20, 0.30], [-2.0, 0.18], [-1.7, 0.13], [1.6, 0.13], [2.0, 0.16], [2.20, 0.2]],
  half: [[-2.20, 0.86], [-2.05, 0.96], [-1.7, 1.02], [-1.26, 1.04], [-0.8, 0.98], [-0.3, 0.93],
    [0.3, 0.93], [0.8, 0.95], [1.27, 0.975], [1.7, 0.92], [2.0, 0.78], [2.20, 0.55]],
  shoulder: [[-2.2, 0.55], [-1.26, 0.6], [0, 0.55], [1.27, 0.6], [2.2, 0.45]],
  nUpper: [[-2.2, 5], [-1.26, 5], [0, 3.6], [1.27, 4.5], [2.2, 2.6]],
  nLower: 5,
  bulge: [[-2.2, 0], [-2.05, 0.04], [-1.26, 0.095], [-0.55, 0], [0.55, 0], [1.27, 0.08], [1.95, 0.02], [2.2, 0]],
  capFront: [[2.20, 1], [2.215, 0.9], [2.226, 0.65], [2.232, 0.3], [2.235, 0]],
  capRear: [[-2.25, 0], [-2.245, 0.45], [-2.235, 0.8], [-2.22, 0.95], [-2.20, 1]],
  cockpit: { z0: -0.8, z1: 0.55, halfW: 0.6, floor: 0.4 },
  cabTop: [[-1.38, 0], [-1.05, 0.12], [-0.65, 0.27], [-0.3, 0.32], [0.0, 0.31],
    [0.3, 0.24], [0.62, 0.12], [0.95, 0]],
  cabHalf: [[-1.38, 0.48], [-0.6, 0.66], [0.2, 0.68], [0.95, 0.58]],
  cabN: 2.6,
  roof: null,
  frame: [0.62, -1.2, 0.92],
  headlamp: { z0: 1.80, z1: 2.17, th0: 0.4, th1: 1.12, hw: 0.034 },
  tail: { y: 0.66, zSide: -2.02 },
  spoiler: null,
  shut: [[0.62, -0.5, 0.55], [-0.6, -0.5, 0.7]],
  fins: false,
  decorate(z, th, c) {
    let dx = 0;
    // Long blade intake feeding the thrusters, behind the door.
    const blade = smoothstep(-1.0, -0.92, z) * smoothstep(-0.5, -0.6, z)
      * smoothstep(-0.25, -0.14, th) * smoothstep(0.3, 0.18, th);
    if (blade > 0) { dx -= 0.035 * blade; c = Math.min(c, lerp(C_PAINT, C_TRIM, blade)); }
    const skirt = smoothstep(-0.95, -0.6, th) * smoothstep(-0.46, -0.56, th)
      * smoothstep(-0.86, -0.8, z) * smoothstep(0.86, 0.8, z);
    c = Math.min(c, lerp(C_PAINT, C_TRIM, skirt));
    const intake = smoothstep(2.04, 2.1, z) * smoothstep(-0.8, -0.7, th) * smoothstep(0.05, -0.05, th);
    c = Math.min(c, lerp(C_PAINT, C_TRIM, intake));
    // Dark thruster bay across the tail.
    const bay = smoothstep(-2.0, -2.08, z) * smoothstep(-0.4, -0.3, th) * smoothstep(0.42, 0.32, th);
    c = Math.min(c, lerp(C_PAINT, C_TRIM, bay));
    return [dx, c];
  },
};

export const rocketShape = createShape(ROCKET);

const THRUSTERS = [1, -1].map((s) => ({ x: 0.5 * s, y: 0.47, z: -2.1, r: 0.15 }));
const VENTS = [[0.42, 0.85], [-0.42, 0.85], [0.42, -0.72], [-0.42, -0.72]];

/** Flat winglet (span along +X, chord along Z), thickness hanging below. */
function wingGeometry(span, rootLE, rootTE, tipLE, tipTE, q) {
  const sh = new THREE.Shape();
  sh.moveTo(0, rootLE);
  sh.lineTo(span * 0.92, tipLE);
  sh.quadraticCurveTo(span, (tipLE + tipTE) / 2, span * 0.94, tipTE);
  sh.lineTo(0, rootTE);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: 0.012, bevelEnabled: q !== 'low', bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1,
    curveSegments: q === 'high' ? 6 : 2,
  });
  g.rotateX(Math.PI / 2); // shape Y → world Z, thickness → -Y
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('cut', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  return g;
}

/** Plasma flame: an open cone from z=0 (base) to z=-1 (tip). */
function flameGeometry(r, seg) {
  const g = new THREE.ConeGeometry(r, 1, seg, 1, true);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.5);
  return g;
}

const cache = new Map();
/** Shared geometry for the rocket's flight hardware at one quality level. */
export function rocketGeometry(q) {
  if (cache.has(q)) return cache.get(q);
  const seg = q === 'high' ? 32 : q === 'medium' ? 18 : 10;
  const sh = rocketShape;
  const g = {};
  g.housing = new THREE.CylinderGeometry(0.17, 0.185, 0.36, seg, 1, true).rotateX(Math.PI / 2);
  g.housingBack = new THREE.CircleGeometry(0.17, seg).rotateY(Math.PI); // closes the duct inside
  g.nozzleLip = new THREE.TorusGeometry(0.165, 0.014, 6, seg);
  g.glowDisc = new THREE.CircleGeometry(0.15, seg).rotateY(Math.PI);
  g.spike = new THREE.ConeGeometry(0.05, 0.14, Math.max(8, seg >> 1)).rotateX(-Math.PI / 2);
  g.flameOuter = flameGeometry(0.13, seg);
  g.flameCore = flameGeometry(0.07, Math.max(8, seg >> 1));
  g.vent = new THREE.BoxGeometry(0.34, 0.012, 0.15);
  g.ventFlame = flameGeometry(0.09, Math.max(8, seg >> 1)).rotateX(-Math.PI / 2); // points down
  if (q !== 'low') {
    g.vanes = [];
    for (let i = 0; i < 6; i++) {
      const v = new THREE.BoxGeometry(0.008, 0.29, 0.05);
      v.rotateZ((i / 6) * Math.PI);
      g.vanes.push(v);
    }
  }
  // Rear winglets hinge on the haunch top; canards on the front flanks.
  g.wing = wingGeometry(0.52, -1.92, -1.36, -1.86, -1.66, q);
  g.canard = wingGeometry(0.26, 1.58, 1.88, 1.6, 1.72, q);
  const wingZ = -1.64;
  g.wingHinge = new THREE.Vector3(0.84, sh.bodyTopAt(wingZ, 0.84) + 0.004, 0);
  const cz = 1.73;
  const side = sh.bodyPoint(cz, 0.05);
  g.canardHinge = new THREE.Vector3(side[0] + 0.006, side[1], 0);
  g.tipLight = new THREE.BoxGeometry(0.02, 0.016, 0.18);
  g.hoverRing = new THREE.TorusGeometry(0.3, 0.016, 6, seg).rotateY(Math.PI / 2);
  g.wheelJet = flameGeometry(0.27, seg).rotateX(-Math.PI / 2); // points down
  cache.set(q, g);
  return g;
}

function m(geo, mat, shadow = false) {
  const o = new THREE.Mesh(geo, mat);
  o.castShadow = shadow;
  return o;
}

/**
 * Adds the flight hardware to a level's sprung root. Returns handles that
 * the car animates (wings, flames, lights).
 */
export function addRocketParts(root, q, mats, wheels) {
  const g = rocketGeometry(q);
  const out = { wings: [], canards: [], flames: [], ventFlames: [], lights: [], rings: [], wheelJets: [] };

  for (const t of THRUSTERS) {
    const grp = new THREE.Group();
    grp.position.set(t.x, t.y, t.z);
    grp.add(m(g.housing, mats.gloss, true));
    const back = m(g.housingBack, mats.trim);
    back.position.z = 0.16;
    grp.add(back);
    const lip = m(g.nozzleLip, mats.chrome);
    lip.position.z = -0.18;
    grp.add(lip);
    const disc = m(g.glowDisc, mats.thrusterGlow);
    disc.position.z = -0.1;
    grp.add(disc);
    const spike = m(g.spike, mats.disc);
    spike.position.z = -0.15;
    grp.add(spike);
    (g.vanes || []).forEach((v) => { const o = m(v, mats.trim); o.position.z = -0.06; grp.add(o); });
    const outer = m(g.flameOuter, mats.flameOuter);
    const core = m(g.flameCore, mats.flameCore);
    outer.position.z = core.position.z = -0.16;
    outer.renderOrder = core.renderOrder = 5;
    grp.add(outer, core);
    out.flames.push({ outer, core });
    if (q === 'high') {
      const l = new THREE.PointLight(0x5cc8ff, 0, 6, 2);
      l.position.z = -0.5;
      grp.add(l);
      out.lights.push(l);
    }
    root.add(grp);
  }

  for (const [x, z] of VENTS) {
    const v = m(g.vent, mats.thrusterGlow);
    v.position.set(x, 0.128, z);
    root.add(v);
    const f = m(g.ventFlame, mats.flameOuter);
    f.position.set(x, 0.12, z);
    f.scale.set(1.6, 0, 1); // x widens the jet to match the slot
    f.renderOrder = 5;
    f.visible = false;
    root.add(f);
    out.ventFlames.push(f);
  }

  // Winglets: one hinge group per side; the left is a mirrored copy.
  for (const s of [1, -1]) {
    const hinge = new THREE.Group();
    hinge.position.set(g.wingHinge.x * s, g.wingHinge.y, 0);
    hinge.scale.x = s;
    const wing = m(g.wing, mats.paint, true);
    const tip = m(g.tipLight, mats.thrusterGlow);
    tip.position.set(0.47, -0.006, -1.76);
    hinge.add(wing, tip);
    root.add(hinge);
    out.wings.push(hinge);

    const ch = new THREE.Group();
    ch.position.set(g.canardHinge.x * s, g.canardHinge.y, 0);
    ch.scale.x = s;
    ch.add(m(g.canard, mats.paint, true));
    root.add(ch);
    out.canards.push(ch);
  }

  // Hover rings on each wheel face (on the non-spinning mount).
  for (const w of wheels) {
    const ring = m(g.hoverRing, mats.thrusterGlow);
    ring.position.x = w.W / 2 + 0.008;
    w.pivot.children[0].add(ring);
    out.rings.push(ring);
    // Downward hover jet under each tucked wheel (on the unsprung level).
    const jet = m(g.wheelJet, mats.flameOuter);
    jet.position.set(w.base.x - Math.sign(w.base.x) * 0.06, w.base.y + 0.16 - 0.17, w.base.z);
    jet.renderOrder = 5;
    jet.visible = false;
    w.pivot.parent.add(jet);
    out.wheelJets.push(jet);
  }
  return out;
}

// Stowed, both fold down into the body so the road car stays clean; they
// swing out through the side as flight comes on.
const WING_STOWED = -Math.PI / 2 - 0.2, WING_OUT = 0.14;
const CANARD_STOWED = Math.PI, CANARD_OUT = 0.05;

/**
 * Applies flight (0 road → 1 air), thrust and boost to one level's parts
 * and wheels. `t` is time in seconds, for flame flicker.
 */
export function animateRocket(parts, wheels, flight, thrust, boost, t) {
  // Wings flip out first; canards follow a little later.
  const fw = smoothstep(0, 0.7, flight), fc = smoothstep(0.2, 0.9, flight);
  for (const w of parts.wings) { w.rotation.z = lerp(WING_STOWED, WING_OUT, fw); w.visible = fw > 0.001; }
  for (const c of parts.canards) { c.rotation.z = lerp(CANARD_STOWED, CANARD_OUT, fc); c.visible = fc > 0.001; }

  // Wheels: tilt flat (outer face down) and tuck up/in.
  const fwheel = smoothstep(0.1, 1, flight);
  for (const w of wheels) {
    const s = w.pivot.position.x > 0 ? 1 : -1;
    w.pivot.rotation.z = -s * fwheel * Math.PI / 2;
    w.pivot.position.set(w.base.x - s * 0.06 * fwheel, w.base.y + 0.16 * fwheel, w.base.z);
  }

  const fl = 1 + 0.07 * Math.sin(t * 53) + 0.05 * Math.sin(t * 31 + 1);
  const len = (0.25 + thrust * 1.3 + (boost ? 1.4 : 0)) * fl;
  const vis = thrust > 0.02 || boost;
  for (const f of parts.flames) {
    f.outer.visible = f.core.visible = vis;
    f.outer.scale.set(1 + (boost ? 0.25 : 0), 1 + (boost ? 0.25 : 0), len);
    f.core.scale.set(1, 1, len * 0.6);
  }
  const lift = flight * (0.3 + thrust * 0.7);
  for (const v of parts.ventFlames) {
    v.visible = lift > 0.02;
    v.scale.y = 0.15 + lift * 0.55 * fl;
  }
  for (const j of parts.wheelJets) {
    j.visible = fwheel > 0.3;
    j.scale.y = (0.12 + lift * 0.4) * fl;
  }
  for (const l of parts.lights) l.intensity = (thrust * 6 + (boost ? 10 : 0)) * fl;
  for (const r of parts.rings) r.visible = flight > 0.05;
}
