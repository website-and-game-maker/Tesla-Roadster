// Arcade-realistic electric car physics (top-down "bicycle" model + track constraints).
//
// The car is a point with a heading (yaw). Each step:
//   1. Steering turns the heading at the rate a real car would (speed * tan(steer) / wheelbase),
//      capped by how much sideways grip the tyres have.
//   2. Velocity stays in world space, so after the heading turns some of the velocity is now
//      "sideways" relative to the car. The tyres scrub that sideways speed off: fast on grip,
//      slowly when the handbrake is up -> that difference is what makes drifts.
//   3. Motor force follows an EV curve: full torque from 0, then constant power (force ~ 1/v),
//      against aerodynamic drag (~v^2). Top speed is where they balance.
//   4. Braking (and lifting off) regenerates "Overdrive" charge; Overdrive spends it for a boost.
//
// Forward of yaw is (sin yaw, cos yaw) in x/z, matching three.js rotation.y.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WHEELBASE = 2.45;

export function carStats(up = {}, mult = 1) {
  const m = up.motor || 0, i = up.inverter || 0, t = up.tires || 0, b = up.battery || 0;
  return {
    accel: (11 + 1.4 * m) * mult,        // m/s^2 launch (0-100 km/h ~2.5s at base)
    vmax: (72 + 6 * i) * mult,           // m/s top speed (~260 km/h base)
    grip: (16 + 1.6 * t),                // m/s^2 lateral grip
    boostCap: 1 + 0.3 * b,               // Overdrive capacity (seconds-ish)
    regen: 1 + 0.25 * b,
  };
}

export class Vehicle {
  constructor(stats) {
    this.stats = stats;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yawRate = 0; this.steer = 0;
    this.boost = stats.boostCap * 0.5; this.boosting = false;
    this.drifting = false; this.slip = 0; this.vF = 0; this.vL = 0;
    this.surface = 'asphalt'; this.grounded = true;
    this.throttle = 0; this.brake = 0; this.handbrake = false;
    this.accelLong = 0; this.accelLat = 0;  // for body lean / camera
    this.impact = 0;                         // last wall impact speed
    this.gravityScale = 1;
    this.driftTime = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }

  place(x, y, z, yaw) {
    this.x = x; this.y = y; this.z = z; this.yaw = yaw;
    this.vx = this.vz = this.vy = 0; this.yawRate = 0; this.steer = 0; this.drifting = false;
  }

  /**
   * @param dt seconds
   * @param inp {steer -1..1 (+right), throttle 0..1, brake 0..1, handbrake, boost}
   * @param env {grip, rolling} surface multipliers
   */
  step(dt, inp, env) {
    const S = this.stats;
    let fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * rx + this.vz * rz;
    const spd = Math.hypot(vF, vL);
    const gripMul = env ? env.grip : 1;
    const rolling = env ? env.rolling : 0;
    const gscale = this.gravityScale;

    // --- boost ---
    this.boosting = !!inp.boost && this.boost > 0.02 && inp.throttle > 0.1;
    if (this.boosting) this.boost = Math.max(0, this.boost - dt * 0.55);

    // --- steering ---
    const speedFrac = clamp(Math.abs(vF) / S.vmax, 0, 1);
    const maxSteer = 0.62 - 0.5 * Math.pow(speedFrac, 0.6); // less lock at speed
    const target = clamp(inp.steer, -1, 1) * maxSteer;
    this.steer += clamp(target - this.steer, -dt * 5, dt * 5);

    // --- drift state ---
    const slipAngle = Math.atan2(vL, Math.max(Math.abs(vF), 1));
    if (inp.handbrake && spd > 12 && Math.abs(inp.steer) > 0.2) this.drifting = true;
    if (this.drifting && (spd < 8 || (!inp.handbrake && Math.abs(slipAngle) < 0.08))) this.drifting = false;
    this.driftTime = this.drifting ? this.driftTime + dt : 0;

    const grip = S.grip * gripMul * gscale;
    let desiredYaw = -vF * Math.tan(this.steer) / WHEELBASE;
    let yawLimit = (grip * 1.15) / Math.max(Math.abs(vF), 4);
    if (this.drifting) { yawLimit *= 1.9; desiredYaw *= 1.35; }
    desiredYaw = clamp(desiredYaw, -yawLimit, yawLimit);
    this.yawRate += (desiredYaw - this.yawRate) * Math.min(1, dt * (this.drifting ? 4.5 : 9));
    this.yaw += this.yawRate * dt;

    // re-project velocity on the new heading
    fx = Math.sin(this.yaw); fz = Math.cos(this.yaw); rx = -fz; rz = fx;
    vF = this.vx * fx + this.vz * fz;
    vL = this.vx * rx + this.vz * rz;

    // --- longitudinal ---
    const vmax = S.vmax * (this.boosting ? 1.22 : 1);
    const dragK = (0.5 * S.accel) / (S.vmax * S.vmax); // balances 50% torque at vmax
    let a = 0;
    const throttle = clamp(inp.throttle, 0, 1);
    const brake = clamp(inp.brake, 0, 1);
    if (throttle > 0 && vF > -1) {
      const powerLimit = Math.min(1, (S.vmax * 0.5) / Math.max(vF, 1));
      a += throttle * S.accel * powerLimit * (this.boosting ? 1.7 : 1) * Math.min(1, gscale * 1.4);
      if (vF > vmax) a = Math.min(a, 0);
    }
    if (throttle > 0 && vF <= -1) a += 16 * throttle; // stop reversing
    if (brake > 0) {
      if (vF > 1) { a -= brake * 24 * Math.min(1, gscale * 1.2); this.boost = Math.min(S.boostCap, this.boost + dt * 0.12 * S.regen * brake); }
      else if (throttle < 0.1) a -= brake * 9; // reverse
    }
    if (throttle === 0 && brake === 0 && vF > 1) { a -= 1.6; this.boost = Math.min(S.boostCap, this.boost + dt * 0.04 * S.regen); }
    if (inp.handbrake) a -= Math.sign(vF) * 4;
    a -= dragK * vF * Math.abs(vF);
    a -= Math.sign(vF) * (0.25 + rolling * (2 + Math.abs(vF) * 0.12));
    if (vF < -14) a = Math.max(a, 0);
    const oldVF = vF;
    vF += a * dt;
    if (throttle === 0 && Math.sign(vF) !== Math.sign(oldVF) && brake === 0) vF = 0;

    // --- lateral grip ---
    const latGrip = this.drifting ? grip * 0.42 : grip * 1.5;
    const dvL = Math.min(Math.abs(vL), latGrip * dt);
    vL -= Math.sign(vL) * dvL;
    this.slip = clamp(Math.abs(vL) / 8, 0, 1);

    // drifting tops up Overdrive
    if (this.drifting && spd > 15) this.boost = Math.min(S.boostCap, this.boost + dt * 0.18 * S.regen);

    this.accelLong = (vF - oldVF) / dt;
    this.accelLat = vF * this.yawRate;
    this.vF = vF; this.vL = vL;
    this.vx = fx * vF + rx * vL;
    this.vz = fz * vF + rz * vL;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.throttle = throttle; this.brake = brake; this.handbrake = !!inp.handbrake;
  }

  /** Push the car back inside a wall. n = outward unit normal (nx, nz), depth = penetration. */
  collideWall(nx, nz, depth) {
    this.x -= nx * depth; this.z -= nz * depth;
    const vn = this.vx * nx + this.vz * nz;
    if (vn > 0) {
      this.vx -= 1.35 * vn * nx; this.vz -= 1.35 * vn * nz;
      const scrub = Math.max(0.55, 1 - vn * 0.03);
      this.vx *= scrub; this.vz *= scrub;
      // knock the nose straight, but never stop it turning away from the wall (or you stay pinned)
      const away = this.yawRate * (Math.cos(this.yaw) * nx - Math.sin(this.yaw) * nz) < 0;
      if (!away) this.yawRate *= 0.5;
      this.impact = Math.max(this.impact, vn);
      this.drifting = false;
    }
  }
}

/** Resolve car-to-car contact using two circles per car (front and rear). */
export function collideCars(a, b) {
  const R = 1.0, OFF = 1.05;
  let hit = 0;
  for (const sa of [-OFF, OFF]) {
    for (const sb of [-OFF, OFF]) {
      const ax = a.x + Math.sin(a.yaw) * sa, az = a.z + Math.cos(a.yaw) * sa;
      const bx = b.x + Math.sin(b.yaw) * sb, bz = b.z + Math.cos(b.yaw) * sb;
      let dx = bx - ax, dz = bz - az;
      const d = Math.hypot(dx, dz);
      if (d >= 2 * R || d < 1e-4) continue;
      dx /= d; dz /= d;
      const pen = (2 * R - d) / 2;
      a.x -= dx * pen; a.z -= dz * pen; b.x += dx * pen; b.z += dz * pen;
      const rel = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz;
      if (rel < 0) {
        const j = -(1 + 0.3) * rel / 2;
        a.vx -= j * dx; a.vz -= j * dz; b.vx += j * dx; b.vz += j * dz;
        hit = Math.max(hit, -rel);
      }
    }
  }
  return hit;
}
