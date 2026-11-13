// Flight model for the flying Roadster: arcade-realistic, tuned for fun.
//
// How it works, per step:
//  1. Stick inputs set target rotation rates (pitch, roll, a little yaw). Rates ease toward
//     their targets so the car has weight. With assist on, letting go of the stick rolls the
//     car back to level and gently levels the nose.
//  2. Banking turns the car around the world's vertical axis (like a plane's coordinated
//     turn): turn rate grows with sin(bank) and with airspeed.
//  3. Forces: thrust along the nose, drag ~ v^2 (top speed is where they balance), gravity,
//     and lift that grows with airspeed^2 until it fully carries the car at cruise speed.
//     Below that the VTOL fans (hover button) can hold it up.
//  4. "Velocity follows the nose": the part of velocity that is not along the nose is bled
//     off quickly (faster at speed). That is what makes it feel controllable, not floaty.
//  5. Ground contact: gentle touchdowns land and the car rolls on its wheels; hard hits or
//     flying into scenery count as a crash.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const UP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _hr = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _p = new THREE.Vector3();

export function flightStats(up = {}, mult = 1) {
  const m = up.motor || 0, i = up.inverter || 0, t = up.tires || 0, b = up.battery || 0;
  return {
    thrust: (26 + 2.2 * m) * mult,      // m/s^2 at full thrust
    vmax: (78 + 6 * i) * mult,          // m/s cruise top speed (~280 km/h base, more on boost)
    agility: 1 + 0.08 * t,              // rotation rate multiplier
    boostCap: 1 + 0.3 * b,
    regen: 1 + 0.25 * b,
  };
}

export class Flyer {
  constructor(stats) {
    this.stats = stats;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.rates = new THREE.Vector3(); // x pitch (+nose up), y yaw (+right), z roll (+right)
    this.thrust = 0.65;               // persistent throttle level
    this.boost = stats.boostCap * 0.6; this.boosting = false;
    this.hovering = false; this.grounded = false;
    this.crashed = false; this.crashReason = '';
    this.gravity = 9.81;
    this.assist = true;
    this.bank = 0; this.pitchAngle = 0; this.airspeed = 0; this.gForce = 1;
    this.flight = 1; // 0 = road form, 1 = flight form (for the car model's transform)
  }

  place(pos, quatOrYaw, speed = 0) {
    this.pos.copy(pos);
    if (typeof quatOrYaw === 'number') this.quat.setFromAxisAngle(UP, quatOrYaw); else this.quat.copy(quatOrYaw);
    _f.set(0, 0, 1).applyQuaternion(this.quat);
    this.vel.copy(_f).multiplyScalar(speed);
    this.rates.set(0, 0, 0);
    this.crashed = false;
    this.safeT = 1.5; // brief grace period after (re)spawning
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }

  /**
   * inp: { pitch -1..1 (+ = nose up), turn -1..1 (+ = right), yaw, thrust 0..1 | null, throttle -1..1, brake 0..1, boost }
   * env: { groundAt(x,z) -> height, colliders, ceiling }
   */
  step(dt, inp, env) {
    if (this.crashed) return;
    if (this.safeT > 0) this.safeT -= dt;
    const S = this.stats, g = this.gravity;
    const f = _f.set(0, 0, 1).applyQuaternion(this.quat);
    const u = _u.set(0, 1, 0).applyQuaternion(this.quat);
    // horizon-right and attitude angles
    _hr.crossVectors(f, UP); const hl = _hr.length();
    if (hl > 1e-3) _hr.divideScalar(hl); else _hr.set(1, 0, 0);
    this.bank = Math.asin(clamp(u.dot(_hr), -1, 1));
    if (u.y < 0) this.bank = Math.sign(this.bank || 1) * Math.PI - this.bank; // upside down
    this.pitchAngle = Math.asin(clamp(f.y, -1, 1));

    // --- throttle ---
    if (inp.thrust != null) this.thrust = clamp(inp.thrust, 0, 1);
    else this.thrust = clamp(this.thrust + (inp.throttle || 0) * dt * 0.9, 0, 1);
    this.boosting = !!inp.boost && this.boost > 0.02 && !this.grounded;
    if (this.boosting) this.boost = Math.max(0, this.boost - dt * 0.5);
    else this.boost = Math.min(S.boostCap, this.boost + dt * 0.03 * S.regen);
    const brake = clamp(inp.brake || 0, 0, 1);
    this.hovering = brake > 0.1;

    // --- rotation ---
    const ag = S.agility;
    const speed = this.vel.length();
    const ctrl = clamp(0.35 + speed / 40, 0.35, 1); // less authority when slow
    let tPitch = clamp(inp.pitch || 0, -1, 1) * 1.5 * ag * ctrl;
    let tRoll = clamp(inp.turn || 0, -1, 1) * 2.6 * ag;
    let tYaw = clamp(inp.yaw || 0, -1, 1) * 0.7 * ag + clamp(inp.turn || 0, -1, 1) * 0.35 * ag;
    if (this.assist) {
      const maxBank = 1.3;
      // stick sets the bank angle (centre = wings level), so the car can never roll past ~75 degrees
      const want = clamp(inp.turn || 0, -1, 1) * maxBank;
      tRoll = clamp((want - this.bank) * 4, -2.6 * ag, 2.6 * ag);
      if (Math.abs(inp.pitch || 0) < 0.05) tPitch = -this.pitchAngle * 0.5 * ctrl;
    }
    const k = Math.min(1, dt * 7);
    this.rates.x += (tPitch - this.rates.x) * k;
    this.rates.y += (tYaw - this.rates.y) * k;
    this.rates.z += (tRoll - this.rates.z) * k;
    if (this.grounded) { this.rates.z = -this.bank * 6; this.rates.x = Math.max(this.rates.x, -this.pitchAngle * 6); }
    _e.set(-this.rates.x * dt, -this.rates.y * dt, this.rates.z * dt, 'XYZ');
    this.quat.multiply(_q.setFromEuler(_e));
    // coordinated turn from bank
    const turnRate = -Math.sin(this.bank) * 1.6 * clamp(speed / 30, 0.2, 1.1) * (this.grounded ? 0 : 1);
    this.quat.premultiply(_q.setFromAxisAngle(UP, turnRate * dt));
    if (this.grounded) this.quat.premultiply(_q.setFromAxisAngle(UP, -(inp.turn || 0) * 1.2 * clamp(speed / 15, 0, 1) * dt));
    this.quat.normalize();

    // --- forces ---
    f.set(0, 0, 1).applyQuaternion(this.quat);
    const vF = this.vel.dot(f);
    const T = S.thrust * this.thrust * (this.boosting ? 1.8 : 1);
    const dragK = (S.thrust * 0.8) / (S.vmax * S.vmax);
    const acc = _v.copy(f).multiplyScalar(T);
    acc.addScaledVector(this.vel, -dragK * speed * (this.boosting ? 0.7 : 1));
    if (this.hovering) acc.addScaledVector(this.vel, -1.6 * brake);
    const liftFrac = clamp((Math.max(vF, 0) / 30) ** 2, 0, 1);
    const hover = this.hovering ? (1 - liftFrac) * 1.05 : 0;
    acc.y += -g + g * (liftFrac + hover);
    // velocity follows the nose
    // rotate velocity toward the nose, keeping most of its magnitude (never adding energy)
    const grip = 1 - Math.exp(-dt * (3 + speed / 20));
    if (speed > 0.5 && this.vel.dot(f) > 0) {
      _p.copy(this.vel).divideScalar(speed);
      const mis = 1 - _p.dot(f);                 // 0 when aligned
      _p.lerp(f, grip).normalize();
      this.vel.copy(_p).multiplyScalar(speed * (1 - mis * grip * 0.6));
    } else {
      const along = this.vel.dot(f);
      _p.copy(this.vel).addScaledVector(f, -along);
      this.vel.addScaledVector(_p, -grip);
    }

    const before = this.vel.clone();
    this.vel.addScaledVector(acc, dt);
    if (this.grounded) { this.vel.multiplyScalar(1 - dt * (0.25 + brake * 2.5)); }
    this.gForce = before.sub(this.vel).length() / dt / 9.81;
    this.pos.addScaledVector(this.vel, dt);
    this.airspeed = this.vel.length();

    // --- world contact ---
    const ground = env.groundAt ? env.groundAt(this.pos.x, this.pos.z) : 0;
    const clearance = 0.55;
    if (this.pos.y < ground + clearance) {
      const vy = -this.vel.y;
      const noseDown = this.pitchAngle < -0.45;
      if (this.safeT <= 0 && (vy > 14 || (noseDown && speed > 30) || Math.abs(this.bank) > 0.9)) {
        this.crash('ground');
      } else {
        this.pos.y = ground + clearance;
        if (this.vel.y < 0) this.vel.y = 0;
        this.grounded = true;
      }
    } else if (this.pos.y > ground + clearance + 0.3) this.grounded = false;
    if (this.grounded && this.pitchAngle > 0.08 && vF > 22) this.grounded = false; // take off
    if (env.ceiling != null && this.pos.y > env.ceiling) { this.pos.y = env.ceiling; this.vel.y = Math.min(this.vel.y, 0); }
    if (env.colliders) {
      for (const c of env.colliders) {
        if (this.safeT > 0) break;
        if (c.type === 'sphere') {
          if (this.pos.distanceToSquared(c.center) < (c.radius + 1.1) ** 2) { this.crash('scenery'); break; }
        } else if (this.pos.x > c.min.x - 1.1 && this.pos.x < c.max.x + 1.1 && this.pos.y > c.min.y - 0.8 && this.pos.y < c.max.y + 0.8 && this.pos.z > c.min.z - 1.1 && this.pos.z < c.max.z + 1.1) {
          this.crash('scenery'); break;
        }
      }
    }
    // the car morphs to road form near the ground at low speed
    const wantFlight = this.grounded && speed < 25 ? 0 : 1;
    this.flight += clamp(wantFlight - this.flight, -dt * 1.5, dt * 1.5);
  }

  crash(reason) { this.crashed = true; this.crashReason = reason; this.vel.multiplyScalar(0.2); }
}

/**
 * AI pilot: flies the course centre line with its own lane offset, slowing for tight
 * bends (max speed through a bend: v = sqrt(maxAccel / curvature)). Kinematic, so it never
 * crashes, but its pace comes from the same limits a player has.
 */
export class AIFlyer {
  constructor(course, { skill = 0.9, seed = 1, stats }) {
    this.course = course; this.skill = skill; this.seed = seed; this.stats = stats;
    this.s = 0; this.speed = 0; this.t = seed * 13.1;
    this.ox = 0; this.oy = 0;
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.vel = new THREE.Vector3();
    this.bank = 0; this.thrust = 0.8; this.boosting = false; this.laps = 0; this.rubber = 1;
    this.tmp = {};
  }

  start(s, ox, oy) { this.s = s; this.ox = ox; this.oy = oy; this.place(); }

  place() {
    const c = this.course, p = c.at(this.s, this.tmp);
    this.pos.set(p.x, p.y, p.z).addScaledVector(p.nrm, this.ox).addScaledVector(p.bin, this.oy);
    return p;
  }

  update(dt) {
    const c = this.course;
    this.t += dt;
    const vmax = this.stats.vmax * 1.05 * this.skill * this.rubber;
    const aMax = 34 * this.skill;
    let target = vmax;
    const horizon = this.speed * this.speed / (2 * 20) + 60;
    for (let d = 10; d < horizon; d += 12) {
      const k = c.curvatureAt(this.s + d);
      if (k < 1e-4) continue;
      const v = Math.sqrt(aMax / k);
      target = Math.min(target, Math.sqrt(v * v + 2 * 20 * 0.8 * d));
    }
    const a = target > this.speed ? this.stats.thrust * 0.8 : -22;
    this.speed = clamp(this.speed + a * dt, 0, vmax);
    this.boosting = target > this.speed + 15 && Math.sin(this.t * 0.4 + this.seed) > 0.6;
    this.thrust = a > 0 ? 0.9 : 0.3;
    const prev = this.pos.clone();
    this.s += this.speed * dt;
    if (this.s >= c.length) { this.s -= c.length; this.laps++; }
    // drifting lane offsets so the pack spreads out
    this.ox += (Math.sin(this.t * 0.23 + this.seed) * 5 - this.ox) * dt * 0.5;
    this.oy += (Math.cos(this.t * 0.17 + this.seed * 2) * 3 - this.oy) * dt * 0.5;
    const p = this.place();
    this.vel.copy(this.pos).sub(prev).divideScalar(Math.max(dt, 1e-4));
    // orientation: face along the tangent, bank into the turn
    const k = c.signedTurnAt(this.s + 20);
    this.bank += (clamp(-k * this.speed * this.speed / 9.81 * 0.06, -1.1, 1.1) - this.bank) * Math.min(1, dt * 3);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), p.tan.clone().negate(), UP);
    this.quat.setFromRotationMatrix(m);
    this.quat.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.bank));
  }
}
