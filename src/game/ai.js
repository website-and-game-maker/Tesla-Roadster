// AI driver: produces the same inputs a player would (steer/throttle/brake/boost), so AI cars
// obey the same physics as you. Nothing here moves a car directly.
//
//  - Racing line: once per track we relax the centre line into a minimum-curvature line
//    (wide on entry, clip the apex, wide on exit) inside the road edges. The line is what
//    the AI steers along and what it plans its corner speeds from.
//  - Speed: every bend has a max speed v = sqrt(grip / curvature). Looking ahead, if braking
//    can't get us down to that speed in time, brake now.
//  - Racecraft: pick a side and commit to an overtake, follow when there is no room, give
//    room to a car alongside, cover the inside when someone is close behind.
//  - Personality: each rival has a persona (how hard it brakes, how bold it passes, how it
//    spends Overdrive and jets) plus small per-corner mistakes that shrink with skill.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Racing personalities. Numbers are multipliers or 0..1 tendencies:
 *  pace       corner speed (grip use)        brake     how late it brakes (decel used)
 *  aggression how keen it is to pass / how close it follows
 *  defend     covering the inside from a car behind
 *  odSave     how much Overdrive it holds back for the final lap and fights
 *  jet        how happily it uses jet hops beyond rings (hop overtakes)
 *  rings      how carefully it lines up and times rings
 *  steady     consistency: lower = more variation corner to corner
 */
export const PERSONAS = [
  { id: 'charger',   label: 'Charger',   pace: 1.0,   brake: 1.08, aggression: 0.95, defend: 0.3, odSave: 0.1, jet: 0.6, rings: 0.75, steady: 0.75 },
  { id: 'tactician', label: 'Tactician', pace: 0.995, brake: 1.0,  aggression: 0.55, defend: 0.9, odSave: 0.9, jet: 0.4, rings: 0.9,  steady: 0.95 },
  { id: 'ace',       label: 'Ring Ace',  pace: 0.99,  brake: 0.98, aggression: 0.5,  defend: 0.5, odSave: 0.4, jet: 0.5, rings: 1.0,  steady: 0.95 },
  { id: 'daredevil', label: 'Daredevil', pace: 1.005, brake: 1.05, aggression: 0.8,  defend: 0.2, odSave: 0.0, jet: 1.0,  rings: 0.8,  steady: 0.7 },
  { id: 'steady',    label: 'Steady',    pace: 0.985, brake: 0.95, aggression: 0.35, defend: 0.6, odSave: 0.5, jet: 0.2, rings: 0.85, steady: 1.0 },
  { id: 'blocker',   label: 'Blocker',   pace: 0.99,  brake: 1.0,  aggression: 0.6,  defend: 1.0, odSave: 0.6, jet: 0.3, rings: 0.8,  steady: 0.9 },
];

/** No quirks: used for the player's autopilot and for time-attack medal times. */
export const NEUTRAL = { id: 'neutral', label: 'Neutral', pace: 1, brake: 1, aggression: 0.5, defend: 0, odSave: 0, jet: 0.3, rings: 1, steady: 1 };

/** A small deterministic random stream, so a rival's quirks are repeatable per seed. */
function rng(seed) {
  let s = (Math.abs(Math.floor(seed * 9973)) % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// ------------------------------------------------------------------ racing line
const LINES = new WeakMap();

/**
 * Minimum-curvature line for a track, as a lateral offset per sample plus that line's own
 * curvature. Elastic-band relaxation: each point is pulled towards the midpoint of its
 * neighbours (which straightens the path), then clamped inside the usable road.
 */
export function racingLine(tr) {
  let L = LINES.get(tr);
  if (L) return L;
  const n = tr.n, W = Math.max(0, tr.roadHalf - 1.9);
  const lat = new Float32Array(n), nx = new Float32Array(n), nz = new Float32Array(n);
  for (let i = 0; i < n; i++) { nx[i] = -tr.tz[i]; nz[i] = tr.tx[i]; }
  const X = (i) => tr.px[i] + nx[i] * lat[i], Z = (i) => tr.pz[i] + nz[i] * lat[i];
  const relax = (m, iters) => {
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) {
        const a = (i - m + n) % n, b = (i + m) % n;
        const mx = (X(a) + X(b)) / 2 - tr.px[i], mz = (Z(a) + Z(b)) / 2 - tr.pz[i];
        const want = clamp(mx * nx[i] + mz * nz[i], -W, W);
        lat[i] += (want - lat[i]) * 0.6;
      }
    }
  };
  // coarse to fine: long spans shape whole corners, short spans smooth the detail
  const ds = tr.ds;
  relax(Math.max(2, Math.round(40 / ds)), 40);
  relax(Math.max(2, Math.round(20 / ds)), 40);
  relax(Math.max(1, Math.round(8 / ds)), 30);
  // the line's own curvature (for speed planning), smoothed like the centre line's
  const head = new Float32Array(n), raw = new Float32Array(n), k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    head[i] = Math.atan2(X(b) - X(a), Z(b) - Z(a));
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n, b = (i + 2) % n;
    const len = Math.hypot(X(b) - X(a), Z(b) - Z(a)) || 4 * ds;
    raw[i] = wrapAngle(head[b] - head[a]) / len;
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -4; j <= 4; j++) s += raw[(i + j + n) % n];
    // never trust the line to be much straighter than the road: keeps speeds honest on tracks
    // whose narrow sections the relaxation can't fully use
    const kc = Math.abs(tr.k[i]), kl = Math.abs(s / 9);
    k[i] = Math.max(kl, kc * 0.55);
  }
  L = { lat, k, W };
  LINES.set(tr, L);
  return L;
}

const sampleAt = (tr, arr, d) => {
  const f = (((d % tr.length) + tr.length) % tr.length) / tr.ds;
  const i0 = Math.floor(f) % tr.n, i1 = (i0 + 1) % tr.n, t = f - Math.floor(f);
  return arr[i0] + (arr[i1] - arr[i0]) * t;
};

export class AIDriver {
  /**
   * @param opts.skill   0.7..1.05 overall ability (difficulty)
   * @param opts.lane    starting lateral offset (grid slot)
   * @param opts.seed    per-car seed: persona and quirks
   * @param opts.persona persona id, or a persona object; default picked from the seed
   */
  constructor(vehicle, track, { skill = 0.9, lane = 0, seed = 1, persona = null } = {}) {
    this.v = vehicle; this.track = track; this.skill = skill;
    this.seed = seed;
    this.rand = rng(seed + 0.137);
    this.persona = typeof persona === 'object' && persona ? persona
      : [...PERSONAS, NEUTRAL].find((p) => p.id === persona) || PERSONAS[(Math.abs(Math.round(seed)) - 1 + PERSONAS.length) % PERSONAS.length];
    this.line = racingLine(track);
    this.offset = lane;            // current deviation from the racing line (starts in the grid slot)
    this.lane = lane;              // kept for callers that read it
    this.t = seed * 3.7;
    this.input = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
    this.tmp = {};
    this.stuck = 0;
    this.rubber = 1;
    this.aimLane = null;           // set by the jet race: lateral position of the next ring
    this.finalLap = false;         // set by the race
    this.wantHop = 0;              // > 0: asks the jet race for a hop (overtake over traffic)
    this.pass = { side: 0, t: 0, target: null };
    this.defendT = 0;
    // per-corner mistakes: a fresh error each time we enter a new bend
    this.err = { brake: 1, line: 0, cornerId: -1 };
    this.boostHold = 0;
  }

  /** Mistake size: low skill and an inconsistent persona make bigger, more frequent errors. */
  get sloppiness() {
    return clamp((1.02 - this.skill) * 2.2, 0, 0.6) * (1.6 - this.persona.steady);
  }

  newCorner(id) {
    const s = this.sloppiness, r = this.rand;
    this.err.cornerId = id;
    // brake a bit early or late, and miss the apex by up to a metre or two
    this.err.brake = 1 + (r() - 0.5) * 0.5 * s;
    this.err.line = (r() - 0.5) * 6 * s;
  }

  update(dt, info, others) {
    const v = this.v, tr = this.track, inp = this.input, P = this.persona, line = this.line;
    this.t += dt;
    const speed = v.speed;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);

    // ---- which bend are we in? (for per-corner mistakes)
    const kHere = Math.abs(sampleAt(tr, line.k, info.dist + 20));
    if (kHere > 0.006) {
      const id = Math.floor((info.dist + 20) / 60);
      if (id !== this.err.cornerId) this.newCorner(id);
    } else if (this.err.cornerId !== -1 && kHere < 0.002) { this.err.cornerId = -1; this.err.line = 0; this.err.brake = 1; }

    // ---- traffic: who is ahead, alongside, behind
    let ahead = null, aheadD = Infinity, beside = 0, behind = null, behindD = Infinity;
    for (const o of others) {
      if (o === v) continue;
      if (Math.abs((o.y || 0) - (v.y || 0)) > 2.5) continue; // a car in the air is not in our way
      const dx = o.x - v.x, dz = o.z - v.z;
      const along = dx * fx + dz * fz, side = dx * -fz + dz * fx;
      if (Math.abs(side) > 9 || Math.abs(along) > 40) continue;
      if (along > 2.5 && Math.abs(side) < 3.4 && along < aheadD) { aheadD = along; ahead = { o, along, side }; }
      else if (Math.abs(along) <= 2.5 && Math.abs(side) < 4) beside += side > 0 ? -1 : 1; // push away from it
      else if (along < -2.5 && along > -20 && Math.abs(side) < 4 && -along < behindD) { behindD = -along; behind = { o, along, side }; }
    }

    // ---- where we want to be across the road
    const look = 8 + speed * 0.5;
    let base = sampleAt(tr, line.lat, info.dist + look) + this.err.line;
    // rings (jet race): drift onto the ring's line as it gets close; careful personas commit earlier
    if (this.aimLane != null) base = this.aimLane;

    let offGoal = 0;
    const closing = ahead ? Math.max(0, speed - (ahead.o.speed || 0)) : 0;
    if (this.pass.t > 0) this.pass.t -= dt;
    if (ahead && aheadD < 10 + 14 * P.aggression + closing * 1.5) {
      const theirLat = this.latOf(ahead.o, info);
      if (this.pass.t <= 0 || this.pass.target !== ahead.o) {
        // pick the side with more room; prefer the inside of the next bend
        const roomL = theirLat + tr.roadHalf, roomR = tr.roadHalf - theirLat;
        const kNext = sampleAt(tr, tr.k, info.dist + aheadD + 25);
        let side = roomR > roomL ? 1 : -1;
        if (Math.abs(kNext) > 0.004 && Math.max(roomL, roomR) > 5) {
          const inside = Math.sign(kNext);
          if ((inside > 0 ? roomR : roomL) > 4.2) side = inside;
        }
        this.pass = { side, t: 1.6 + 1.2 * this.rand(), target: ahead.o };
      }
      const room = this.pass.side > 0 ? tr.roadHalf - theirLat : theirLat + tr.roadHalf;
      if (room > 3.8) {
        const want = theirLat + this.pass.side * 3.6;
        offGoal = want - base;
      } else if (ahead.along < 14) {
        // boxed in. Bold drivers hop over in a jet race, the rest wait for a gap.
        this.blocked = (this.blocked || 0) + dt;
      }
    } else this.blocked = 0;
    // give room to a car alongside instead of leaning on it
    if (beside) offGoal += clamp(beside, -1, 1) * 1.6;
    // cover the inside when someone is right behind and closing
    if (!ahead && behind && P.defend > 0.4 && this.defendT < 3) {
      const kNext = sampleAt(tr, tr.k, info.dist + 40);
      if (Math.abs(kNext) > 0.004 && (behind.o.speed || 0) > speed - 1) {
        this.defendT += dt;
        const insideLat = Math.sign(kNext) * line.W * 0.55;
        offGoal += (insideLat - base) * 0.5 * P.defend;
      }
    } else if (!behind) this.defendT = Math.max(0, this.defendT - dt);

    let goal = clamp(base + offGoal, -tr.roadHalf + 1.5, tr.roadHalf - 1.5);
    // move the target smoothly (no twitchy lane snaps)
    const cur = base + this.offset;
    const next = cur + clamp(goal - cur, -dt * 4.5, dt * 4.5);
    this.offset = next - base;
    this.lane = next;

    // ---- steering: pure pursuit towards a point on our chosen path
    const p = tr.pointAt(info.dist + look, next, this.tmp);
    const dx = p.x - v.x, dz = p.z - v.z;
    const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    inp.steer = clamp(ang * 2.4, -1, 1);

    // ---- speed planning along the racing line
    const env = v.gravityScale || 1;
    const grip = v.stats.grip * 0.9 * this.skill * P.pace * env;
    const decel = 18 * this.skill * P.brake * this.err.brake;
    const horizon = speed * speed / (2 * decel) + 40;
    let target = v.stats.vmax * 1.1;
    for (let s = 5; s < horizon; s += 6) {
      const k = sampleAt(tr, line.k, info.dist + s);
      if (k < 1e-4) continue;
      const vAllowed = Math.sqrt(grip / k);
      const vNow = Math.sqrt(vAllowed * vAllowed + 2 * decel * 0.8 * s);
      if (vNow < target) target = vNow;
    }
    // stuck behind someone we can't pass: tuck in rather than ram them
    if (ahead && this.blocked > 0 && ahead.along < 8 + 6 * (1 - P.aggression)) target = Math.min(target, (ahead.o.speed || 0) + 0.5);
    target *= this.rubber;
    if (speed > target + 1.5) { inp.throttle = 0; inp.brake = clamp((speed - target) / 6, 0.2, 1); }
    else { inp.throttle = clamp((target - speed) / 4 + 0.35, 0, 1); inp.brake = 0; }

    // ---- Overdrive: spend it where it pays (long straight ahead, a car to pass), save some for the end
    const straight = this.straightAhead(info.dist, speed);
    const reserve = this.finalLap ? 0 : P.odSave * 0.6 * v.stats.boostCap;
    const attacking = ahead && aheadD < 25;
    const under = behind && behindD < 10;
    let boost = false;
    if (inp.throttle > 0.8 && speed > 20 && straight > speed * 2.2) {
      if (v.boost > reserve + 0.05 || ((attacking || under) && v.boost > 0.05)) boost = true;
    }
    if (boost) this.boostHold = 0.4;               // no flicker: once lit, hold briefly
    else if (this.boostHold > 0) { this.boostHold -= dt; boost = straight > speed * 1.2; }
    inp.boost = boost;
    inp.handbrake = false;

    // ---- jet race: ask for a hop over traffic we can't get around (bold personas only)
    if (this.wantHop > 0) this.wantHop -= dt;
    if (this.blocked > 0.5 + (1 - P.jet) * 2 && P.jet > 0.35 && straight > 60) { this.wantHop = 0.35; this.blocked = 0; }

    // recover if stuck against a wall
    if (speed < 3 && inp.throttle > 0.5) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    return inp;
  }

  /** Lateral position of another vehicle on the track, near our own track position. */
  latOf(o, info) {
    const dx = o.x - (this.v.x), dz = o.z - (this.v.z);
    return info.lat + dx * info.nx + dz * info.nz;
  }

  /** Metres of (nearly) straight racing line ahead, capped at a few seconds of driving. */
  straightAhead(dist, speed) {
    const tr = this.track, k = this.line.k, max = Math.max(60, speed * 5);
    for (let s = 0; s < max; s += 8) if (sampleAt(tr, k, dist + s) > 0.0035) return s;
    return max;
  }
}
