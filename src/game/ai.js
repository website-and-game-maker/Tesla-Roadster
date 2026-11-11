// AI driver: produces the same inputs a player would (steer/throttle/brake), so AI cars obey
// the same physics. Two parts:
//  - Steering: aim at a point further ahead the faster we go (pure pursuit), offset into
//    the AI's preferred lane, nudged sideways to get around cars in front.
//  - Speed: look ahead along the track; every bend has a max speed v = sqrt(grip / curvature).
//    If braking at 80% of max decel can't get us down to that speed in time, brake now.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class AIDriver {
  constructor(vehicle, track, { skill = 0.9, lane = 0, seed = 1 } = {}) {
    this.v = vehicle; this.track = track; this.skill = skill;
    this.lane = lane; this.laneTarget = lane; this.seed = seed;
    this.t = seed * 3.7;
    this.input = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
    this.tmp = {};
    this.stuck = 0;
    this.rubber = 1;
  }

  update(dt, info, others) {
    const v = this.v, tr = this.track, inp = this.input;
    this.t += dt;
    const speed = v.speed;
    // wander lane slowly for natural lines
    if (Math.sin(this.t * 0.31 + this.seed) > 0.995) this.laneTarget = (Math.random() * 2 - 1) * tr.roadHalf * 0.55;
    // inside line in corners
    const kAhead = tr.curvatureAt(info.dist + 25 + speed * 0.8);
    let laneGoal = this.laneTarget + clamp(kAhead * 900, -1, 1) * tr.roadHalf * 0.45;

    // avoid the car directly ahead
    for (const o of others) {
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const ahead = dx * fx + dz * fz;
      const side = dx * -fz + dz * fx;
      if (ahead > 0 && ahead < 18 && Math.abs(side) < 2.6) {
        laneGoal += side > 0 ? -3.2 : 3.2;
      }
    }
    laneGoal = clamp(laneGoal, -tr.roadHalf + 1.6, tr.roadHalf - 1.6);
    this.lane += clamp(laneGoal - this.lane, -dt * 3, dt * 3);

    // steering towards a look-ahead point
    const look = 9 + speed * 0.55;
    const p = tr.pointAt(info.dist + look, this.lane, this.tmp);
    const dx = p.x - v.x, dz = p.z - v.z;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    inp.steer = clamp(ang * 2.4, -1, 1);

    // speed planning
    const grip = v.stats.grip * 0.88 * this.skill * (v.gravityScale || 1);
    const decel = 18 * this.skill;
    const horizon = speed * speed / (2 * decel) + 40;
    let target = v.stats.vmax * 1.1;
    for (let s = 5; s < horizon; s += 6) {
      const k = Math.abs(tr.curvatureAt(info.dist + s));
      if (k < 1e-4) continue;
      const vAllowed = Math.sqrt(grip / k);
      const vNow = Math.sqrt(vAllowed * vAllowed + 2 * decel * 0.8 * s);
      if (vNow < target) target = vNow;
    }
    target *= this.rubber;
    if (speed > target + 1.5) { inp.throttle = 0; inp.brake = clamp((speed - target) / 6, 0.2, 1); }
    else { inp.throttle = clamp((target - speed) / 4 + 0.35, 0, 1); inp.brake = 0; }
    inp.boost = v.boost > v.stats.boostCap * 0.6 && Math.abs(kAhead) < 0.002 && speed > 30 && Math.random() < 0.6;
    inp.handbrake = false;

    // recover if stuck against a wall
    if (speed < 3 && inp.throttle > 0.5) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    return inp;
  }
}
