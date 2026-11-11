// One race session: world, cars, AI, rules for each mode, camera and HUD data.
import * as THREE from 'three';
import { Vehicle, carStats, collideCars } from '../physics/vehicle.js';
import { TrackSampler } from './trackSampler.js';
import { AIDriver } from './ai.js';
import { SkidMarks, Smoke } from './effects.js';

const STEP = 1 / 120;
const AI_NAMES = ['Nova', 'Volta', 'Kestrel', 'Ampère', 'Cobalt', 'Quill', 'Zephyr', 'Halo', 'Rook', 'Tesla-Coil', 'Ion', 'Faraday'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Race {
  /**
   * cfg: { mode: 'career'|'quick'|'timetrial'|'multiplayer', type: 'race'|'timeattack'|'drift'|'elim'|'free',
   *        worldId, laps, opponents, skill, aiUpgrade, event }
   */
  constructor(game, cfg) {
    this.game = game; this.cfg = cfg;
    this.scene = new THREE.Scene();
    this.scene.environment = game.envMap;
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
    this.cars = [];
    this.time = 0; this.raceTime = 0;
    this.state = 'intro'; this.stateT = 0;
    this.message = ''; this.note = ''; this.noteT = 0;
    this.camMode = game.profile.settings.camera || 0;
    this.shake = 0;
    this.drift = { score: 0, chain: 0, chainT: 0, mult: 1, idle: 0 };
    this.eliminated = [];
    this.tmp = {};
    this.acc = 0;
    this.online = cfg.online || null; // multiplayer controller (src/multiplayer/online-race.js)
  }

  build() {
    const g = this.game, P = g.profile, q = g.quality.preset;
    this.world = g.mods.worlds.createWorld(this.cfg.worldId, { scene: this.scene, renderer: g.renderer, quality: q.id, timeOfDay: undefined, weather: this.cfg.weather || 'clear' });
    const w = this.world;
    if (w.setShadowSize) w.setShadowSize(q.shadowSize);
    this.track = new TrackSampler(w.trackCurve, { roadHalfWidth: w.roadHalfWidth || 7, wallHalfWidth: w.wallHalfWidth || 11 },
      typeof w.getGroundHeight === 'function' ? (x, z) => w.getGroundHeight(x, z) : null);
    const gScale = clamp(0.72 + 0.28 * ((w.gravity || 9.81) / 9.81), 0.72, 1.1); // low gravity = floatier, but still drivable
    this.night = !!(w.night || (w.def && w.def.night));
    if (!w.sun) {
      const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.castShadow = true; this.scene.add(sun, sun.target);
      this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x404040, 1)); this.ownSun = sun;
    }

    // --- cars ---
    const nAI = this.cfg.opponents || 0;
    const total = nAI + 1;
    const playerSlot = this.cfg.type === 'race' || this.cfg.type === 'elim' ? Math.min(total - 1, Math.floor(total / 2)) : 0;
    const paints = g.mods.car.PAINTS.map((p) => p.id).filter((id) => id !== P.car.paint);
    const wheels = g.mods.car.WHEELS.map((x) => x.id);
    const names = AI_NAMES.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < total; i++) {
      const isPlayer = i === playerSlot;
      const stats = isPlayer ? carStats(P.upgrades) : carStats({ motor: this.cfg.aiUpgrade, inverter: this.cfg.aiUpgrade, tires: this.cfg.aiUpgrade, battery: this.cfg.aiUpgrade }, 0.97 + 0.03 * this.cfg.skill);
      const v = new Vehicle(stats); v.gravityScale = gScale;
      const paint = isPlayer ? P.car.paint : paints[i % paints.length];
      const model = g.mods.car.createRoadster({ paint, wheels: isPlayer ? P.car.wheels : wheels[i % wheels.length], quality: isPlayer ? q.carDetail : (q.id === 'ultra' ? 'high' : q.id === 'high' ? 'medium' : 'low') });
      model.object.traverse((o) => { if (o.isMesh) { o.castShadow = q.shadows && (isPlayer || q.id !== 'low'); } });
      this.scene.add(model.object);
      const row = Math.floor(i / 2), side = i % 2 ? 1 : -1;
      const p = this.track.pointAt(this.track.length - 10 - row * 9, side * 3.2);
      v.place(p.x, p.y, p.z, p.yaw);
      const car = {
        v, model, isPlayer, name: isPlayer ? (P.name || 'You') : names[i % names.length],
        color: (g.mods.car.PAINTS.find((x) => x.id === paint) || {}).color,
        info: this.track.locate(p.x, p.z), crossings: 0, prevDist: 0, progress: 0,
        lapStart: 0, lapTimes: [], bestLap: null, finished: false, finishTime: null, out: false,
        wrongT: 0, ai: null,
      };
      car.prevDist = car.info.dist;
      if (!isPlayer) car.ai = new AIDriver(v, this.track, { skill: this.cfg.skill, lane: side * 3.2, seed: i + 1 });
      this.cars.push(car);
      if (isPlayer) this.player = car;
    }

    // headlights on the player at night
    if (this.night && q.id !== 'low') {
      const spot = new THREE.SpotLight(0xffffff, 120, 90, 0.5, 0.5, 1.2);
      spot.position.set(0, 0.8, 1.8); spot.target.position.set(0, 0, 30);
      this.player.model.object.add(spot, spot.target);
    }
    for (const c of this.cars) c.model.setHeadlights && c.model.setHeadlights(this.night);

    // effects
    this.skids = new SkidMarks(this.scene, Math.round(1200 * q.particles) + 200);
    this.smoke = new Smoke(this.scene, Math.round(300 * q.particles) + 40, this.world.def && this.world.def.scenery === 'desert' ? 0xd8b48a : 0xe6e6e6);

    // ghost (time trial)
    this.ghostRec = [];
    if (this.cfg.type === 'free') {
      const data = P.ghosts[this.cfg.worldId];
      if (data && data.length > 10) {
        this.ghost = { data, model: g.mods.car.createRoadster({ paint: P.car.paint, wheels: P.car.wheels, quality: 'low' }) };
        this.ghost.model.object.traverse((o) => { if (o.isMesh && o.material) { const src = o.material; o.material = src.clone(); o.material.onBeforeCompile = src.onBeforeCompile; o.material.customProgramCacheKey = src.customProgramCacheKey; o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; o.castShadow = false; } });
        this.ghost.model.object.visible = false;
        this.scene.add(this.ghost.model.object);
      }
    }

    // time attack / drift targets
    if (this.cfg.type === 'timeattack') {
      const t = this.simulateLap(this.player.v.stats);
      this.targets = [t * 1.03, t * 1.1, t * 1.2];
    } else if (this.cfg.type === 'drift') {
      const L = this.track.length * this.cfg.laps;
      this.targets = [Math.round(L * 3.2 / 100) * 100, Math.round(L * 1.9 / 100) * 100, Math.round(L * 0.9 / 100) * 100];
    }

    // minimap
    const pts = []; for (let i = 0; i < this.track.n; i += 4) pts.push({ x: this.track.px[i], z: this.track.pz[i] });
    g.ui.hud.setTrack && g.ui.hud.setTrack(pts, this.track.bounds);

    this.camera.far = q.drawDist * 1.6;
    if (this.scene.fog) { this.scene.fog.far = Math.min(this.scene.fog.far || q.drawDist, q.drawDist); this.scene.fog.near = Math.min(this.scene.fog.near, q.drawDist * 0.2); }
    this.camera.updateProjectionMatrix();
    if (this.online) this.online.onBuild(this);
    this.placeCamera(1, true);
  }

  /** Lap time of an AI driving the player's car well: basis for time-attack medals. */
  simulateLap(stats) {
    const v = new Vehicle(stats), tr = this.track;
    const p = tr.pointAt(0, 0); v.place(p.x, p.y, p.z, p.yaw);
    const ai = new AIDriver(v, tr, { skill: 1, lane: 0, seed: 99 });
    const info = {}; tr.locate(v.x, v.z, -1, info);
    let prev = info.dist, crossings = 0, t = 0, lapStart = 0, laps = [];
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 400 && laps.length < 1; i++) {
      const inp = ai.update(dt, info, []); inp.boost = false;
      v.step(dt, inp, { grip: 1, rolling: 0 });
      tr.locate(v.x, v.z, info.i, info);
      const lim = tr.wallHalf - 1;
      if (Math.abs(info.lat) > lim) v.collideWall(Math.sign(info.lat) * info.nx, Math.sign(info.lat) * info.nz, Math.abs(info.lat) - lim);
      t += dt;
      if (prev > tr.length * 0.75 && info.dist < tr.length * 0.25) { crossings++; if (crossings === 1) lapStart = t; }
      if (prev < tr.length * 0.25 && info.dist > tr.length * 0.75 && crossings === 0 && t > 5) crossings = 0;
      if (crossings === 2) { laps.push(t - lapStart); }
      prev = info.dist;
    }
    return laps[0] || tr.length / 40;
  }

  get playerInput() { return this.game.inputState; }

  update(dt) {
    this.time += dt; this.stateT += dt;
    const inp = this.playerInput;
    if (this.online) {
      this.online.preUpdate(this);
      if (this.state === 'race' && this.stateT > 1 && this.message === 'GO!') this.message = '';
    } else if (this.state === 'intro') {
      if (this.stateT > 2.2 || inp.throttle > 0 || this.game.input.wasPressed('Space', 'Enter')) { this.state = 'countdown'; this.stateT = 0; this.lastCount = 4; }
    } else if (this.state === 'countdown') {
      const n = 3 - Math.floor(this.stateT);
      if (n !== this.lastCount && n > 0) { this.lastCount = n; this.message = String(n); this.game.audio.ui('countdown'); }
      if (this.stateT >= 3) { this.state = 'race'; this.stateT = 0; this.message = 'GO!'; this.game.audio.ui('go'); this.game.audio.music && this.game.audio.music.play && this.game.audio.music.play('race'); }
    } else if (this.state === 'race' && this.stateT > 1 && this.message === 'GO!') this.message = '';

    const racing = this.state === 'race' || this.state === 'finished';
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.fixed(STEP, racing, inp);
    }
    this.postUpdate(dt, inp);
  }

  fixed(dt, racing, inp) {
    const tr = this.track;
    if (racing) this.raceTime += dt;
    for (const c of this.cars) {
      if (c.out) continue;
      const v = c.v;
      let ci;
      if (!racing) ci = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
      else if (c.isPlayer && !c.finished) {
        ci = inp;
        if (this.game.profile.settings.assist && Math.abs(inp.steer) < 0.05 && !inp.handbrake) {
          // gentle straight-line assist: damp yaw wobble when not steering
          v.yawRate *= 0.985;
        }
      } else {
        if (!c.ai) c.ai = new AIDriver(v, tr, { skill: 0.95, lane: 0, seed: 7 }); // player autopilot after finish
        if (c.ai && !c.isPlayer) {
          const gap = c.progress - this.player.progress;
          c.ai.rubber = this.cfg.type === 'race' || this.cfg.type === 'elim' ? (gap > 150 ? 0.94 : gap < -150 ? 1.06 : 1) : 1;
        }
        ci = c.ai.update(dt, c.info, this.cars.filter((o) => !o.out).map((o) => o.v));
        if (c.ai.stuck > 3) { this.resetCar(c); c.ai.stuck = 0; }
      }
      const surf = this.world.surfaceAt ? this.world.surfaceAt(c.info.lat) : (this.world.getSurface ? this.world.getSurface(v.x, v.z) : null);
      v.surface = (surf && surf.name) || (Math.abs(c.info.lat) <= tr.roadHalf ? 'asphalt' : 'grass');
      v.step(dt, ci, surf || { grip: Math.abs(c.info.lat) <= tr.roadHalf + 0.8 ? 1 : 0.72, rolling: Math.abs(c.info.lat) <= tr.roadHalf + 0.8 ? 0 : 1 });
      tr.locate(v.x, v.z, c.info.i, c.info);
      const lim = tr.wallHalf - 1.0;
      if (Math.abs(c.info.lat) > lim) {
        const s = Math.sign(c.info.lat);
        v.collideWall(s * c.info.nx, s * c.info.nz, Math.abs(c.info.lat) - lim);
        tr.locate(v.x, v.z, c.info.i, c.info);
      }
      v.y = typeof this.world.getGroundHeight === 'function' ? this.world.getGroundHeight(v.x, v.z) : c.info.y;
      if (racing) this.laps(c);
    }
    // car-to-car
    const act = this.cars.filter((c) => !c.out);
    for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
      const a = act[i].v, b = act[j].v;
      if (Math.abs(a.x - b.x) > 5 || Math.abs(a.z - b.z) > 5) continue;
      const hit = collideCars(a, b);
      if (hit > 2 && (act[i].isPlayer || act[j].isPlayer)) { this.game.audio.collision(hit); this.shake = Math.min(1, this.shake + hit * 0.05); this.vibrate(30); }
    }
    // drift scoring (player)
    const pv = this.player.v;
    const slipA = Math.abs(Math.atan2(pv.vL, Math.max(Math.abs(pv.vF), 1)));
    const D = this.drift;
    if (racing && !this.player.finished && slipA > 0.16 && pv.speed > 12 && Math.abs(this.player.info.lat) < tr.roadHalf + 1) {
      D.chainT += dt; D.idle = 0;
      D.mult = 1 + Math.min(4, D.chainT / 1.5);
      D.chain += pv.speed * Math.min(slipA, 0.8) * 12 * D.mult * dt;
    } else if (D.chain > 0) {
      D.idle += dt;
      if (D.idle > 0.6) { D.score += D.chain; if (D.chain > 1500) this.flash(`DRIFT +${Math.round(D.chain)}`); D.chain = 0; D.chainT = 0; D.mult = 1; }
    }
    if (pv.impact > 3) {
      this.game.audio.collision(pv.impact); this.shake = Math.min(1, this.shake + pv.impact * 0.04); this.vibrate(Math.min(80, pv.impact * 6));
      if (D.chain > 0) { D.chain = 0; D.chainT = 0; D.mult = 1; if (this.cfg.type === 'drift') this.flash('CHAIN LOST'); }
    }
    for (const c of this.cars) c.v.impact = 0;

    // ghost recording (every 3rd step = 40 Hz)
    if (this.cfg.type === 'free' && racing && this.player.crossings >= 1 && (this._gs = (this._gs || 0) + 1) % 3 === 0) {
      this.ghostRec.push([+(this.raceTime - this.player.lapStart).toFixed(3), +pv.x.toFixed(2), +pv.y.toFixed(2), +pv.z.toFixed(2), +pv.yaw.toFixed(3), +this.player.info.dist.toFixed(1)]);
    }
  }

  laps(c) {
    const L = this.track.length, d = c.info.dist;
    if (c.prevDist > L * 0.75 && d < L * 0.25) {
      c.crossings++;
      if (c.crossings >= 2) {
        const lt = this.raceTime - c.lapStart;
        c.lapTimes.push(lt);
        if (!c.bestLap || lt < c.bestLap) c.bestLap = lt;
        if (c.isPlayer) this.onPlayerLap(lt);
      }
      c.lapStart = this.raceTime;
      if (this.cfg.type !== 'free' && c.crossings === this.cfg.laps + 1 && !c.finished) this.finishCar(c);
      else if (c.isPlayer && this.cfg.type !== 'free' && c.crossings === this.cfg.laps && this.cfg.laps > 1) this.flash('FINAL LAP');
      if (this.cfg.type === 'elim' && c.crossings >= 2) this.checkElimination(c);
    } else if (c.prevDist < L * 0.25 && d > L * 0.75) {
      c.crossings--; // reversed over the line
    }
    c.prevDist = d;
    c.progress = (c.crossings - 1) * L + d;
  }

  onPlayerLap(lt) {
    const P = this.game.profile, wid = this.cfg.worldId;
    this.game.audio.ui('lap');
    if (this.online) this.online.onLap(lt, this.player.lapTimes.length);
    if (this.cfg.type === 'free') {
      const isBest = !P.best[wid] || lt < P.best[wid];
      if (isBest) {
        P.best[wid] = lt; P.ghosts[wid] = this.ghostRec; this.game.save();
        this.flash(`NEW BEST ${lt.toFixed(3)}s`);
        this.game.profile.credits += 150; this.game.save();
        if (this.ghost) this.ghost.data = this.ghostRec;
        else if (this.ghostRec.length > 10) {
          this.ghost = { data: this.ghostRec, model: this.game.mods.car.createRoadster({ paint: P.car.paint, wheels: P.car.wheels, quality: 'low' }) };
          this.ghost.model.object.traverse((o) => { if (o.isMesh && o.material) { const src = o.material; o.material = src.clone(); o.material.onBeforeCompile = src.onBeforeCompile; o.material.customProgramCacheKey = src.customProgramCacheKey; o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; o.castShadow = false; } });
          this.scene.add(this.ghost.model.object);
        }
      } else this.flash(`LAP ${lt.toFixed(3)}s`);
      this.ghostRec = [];
    } else if (this.cfg.type === 'timeattack') {
      const tg = this.targets;
      const medal = lt <= tg[0] ? 'GOLD' : lt <= tg[1] ? 'SILVER' : lt <= tg[2] ? 'BRONZE' : '';
      this.flash(`${lt.toFixed(3)}s ${medal}`);
    }
  }

  checkElimination(leaderCar) {
    // when the leader starts lap k, the last car still running is knocked out
    const leaderLaps = Math.max(...this.cars.filter((c) => !c.out).map((c) => c.crossings));
    if (leaderCar.crossings !== leaderLaps) return;
    const done = this.eliminated.length;
    if (leaderLaps - 1 <= done) return;
    const active = this.cars.filter((c) => !c.out && !c.finished);
    if (active.length <= 1) return;
    const last = active.reduce((a, b) => (a.progress < b.progress ? a : b));
    last.out = true; this.eliminated.push(last);
    last.model.object.visible = false;
    if (last.isPlayer) { this.flash('ELIMINATED'); this.endRace(); }
    else this.flash(`${last.name.toUpperCase()} ELIMINATED`);
    const left = this.cars.filter((c) => !c.out);
    if (left.length === 1 && left[0].isPlayer) { this.finishCar(this.player); }
  }

  finishCar(c) {
    c.finished = true; c.finishTime = this.raceTime;
    if (c.isPlayer) {
      this.game.audio.ui('lap');
      this.message = !this.online && this.position(c) === 1 ? 'VICTORY' : 'FINISH';
      if (this.online) this.online.onFinish(this);
      this.state = 'finished'; this.stateT = 0;
      this.drift.score += this.drift.chain; this.drift.chain = 0;
    }
  }

  position(car) {
    const order = this.order();
    return order.indexOf(car) + 1;
  }

  order() {
    const fin = this.cars.filter((c) => c.finished && !c.out).sort((a, b) => a.finishTime - b.finishTime);
    const run = this.cars.filter((c) => !c.finished && !c.out).sort((a, b) => b.progress - a.progress);
    const out = this.eliminated.slice().reverse();
    return [...fin, ...run, ...out];
  }

  resetCar(c) {
    const p = this.track.pointAt(c.info.dist, 0);
    c.v.place(p.x, p.y, p.z, p.yaw);
    this.track.locate(p.x, p.z, c.info.i, c.info);
  }

  flash(text) { this.note = text; this.noteT = 2.2; }
  vibrate(ms) { if (this.game.profile.settings.vibration && navigator.vibrate && this.game.input.lastDevice === 'touch') navigator.vibrate(ms); }

  postUpdate(dt, inp) {
    const g = this.game;
    if (this.noteT > 0) { this.noteT -= dt; if (this.noteT <= 0) this.note = ''; }
    if (g.input.wasPressed('KeyC', 'PadKeyC')) { this.camMode = (this.camMode + 1) % 3; g.profile.settings.camera = this.camMode; g.save(); }
    if (g.input.wasPressed('KeyR', 'PadKeyR') && this.state === 'race') this.resetCar(this.player);

    // wrong way
    const pv = this.player.v, pi = this.player.info;
    if (pv.vx * pi.tx + pv.vz * pi.tz < -4) this.player.wrongT += dt; else this.player.wrongT = 0;

    // visuals
    const q = g.quality.preset;
    for (const c of this.cars) {
      if (c.out) continue;
      const v = c.v, o = c.model.object;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const slopeAlong = c.info.slope * (fx * c.info.tx + fz * c.info.tz);
      o.position.set(v.x, v.y, v.z);
      o.rotation.set(-Math.atan(slopeAlong), v.yaw, 0, 'YXZ');
      const body = c.model.body;
      if (body) {
        body.rotation.z += (clamp(-v.accelLat * 0.006, -0.06, 0.06) - body.rotation.z) * Math.min(1, dt * 8);
        body.rotation.x += (clamp(-v.accelLong * 0.004, -0.04, 0.04) - body.rotation.x) * Math.min(1, dt * 6);
      }
      c.model.update(dt, v.vF, -v.steer); // car API: +rad steers left
      c.model.setBrake && c.model.setBrake(v.brake > 0.1 && v.vF > 0.5);
      c.model.setReverse && c.model.setReverse(v.vF < -0.5);
      // tyre effects
      const sliding = (v.slip > 0.35 || (v.drifting && v.speed > 8) || (v.brake > 0.8 && v.speed > 20)) && Math.abs(c.info.lat) < this.track.roadHalf + 1;
      const rx = -fz, rz = fx;
      for (const [k, side] of [[0, 1], [1, -1]]) {
        const wx = v.x - fx * 1.3 + rx * 0.84 * side, wz = v.z - fz * 1.3 + rz * 0.84 * side;
        this.skids.add(c.name + k, wx, v.y + 0.03, wz, rx, rz, v.slip + 0.3, sliding);
        if (sliding && q.particles > 0.3 && Math.random() < q.particles * 0.9) this.smoke.emit(wx, v.y, wz, v.vx, v.vz, 0.4 + v.slip * 0.6);
      }
    }
    this.smoke.update(dt);

    // ghost playback
    if (this.ghost && this.player.crossings >= 1) {
      const t = this.raceTime - this.player.lapStart, d = this.ghost.data;
      let lo = 0, hi = d.length - 1;
      while (lo < hi - 1) { const m = (lo + hi) >> 1; if (d[m][0] < t) lo = m; else hi = m; }
      const a = d[lo], b = d[hi], f = clamp((t - a[0]) / ((b[0] - a[0]) || 1), 0, 1);
      const o = this.ghost.model.object;
      o.visible = t < d[d.length - 1][0];
      o.position.set(a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f);
      o.rotation.set(0, a[4] + Math.atan2(Math.sin(b[4] - a[4]), Math.cos(b[4] - a[4])) * f, 0);
      // delta: time the ghost took to reach the player's current distance
      const pd = this.player.info.dist;
      let k = 0; while (k < d.length - 1 && d[k][5] < pd && d[k][5] >= d[0][5] - 1) k++;
      this.ghostDelta = pd > 20 && k > 0 && k < d.length - 1 ? t - d[k][0] : null;
    }

    // world + camera
    this.placeCamera(dt, false);
    this.world.update && this.world.update(dt, this.player.model.object.position, this.camera);
    if (this.ownSun) { const p = this.player.model.object.position; this.ownSun.position.set(p.x + 60, p.y + 120, p.z + 40); this.ownSun.target.position.copy(p); }

    // audio
    g.audio.update({ speed: pv.speed, throttle: pv.throttle, brake: pv.brake, slip: pv.drifting ? 1 : pv.slip, surface: pv.surface, boost: pv.boosting }, dt);
    g.audio.music && g.audio.music.setIntensity && g.audio.music.setIntensity(clamp(pv.speed / 70, 0, 1));

    // end of race flow
    if (this.state === 'finished' && this.stateT > 3.5 && !this.ended && !this.online) this.endRace();
    if (this.online) this.online.postUpdate(this);
    if (this.cfg.type === 'free' && this.state === 'race') this.message = this.message === 'GO!' ? 'GO!' : '';
  }

  placeCamera(dt, snap) {
    const v = this.player.v, cam = this.camera;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const sp = v.speed;
    let pos, look;
    if (this.state === 'intro') {
      const a = v.yaw + Math.PI * 0.75 - this.stateT * 0.6;
      pos = new THREE.Vector3(v.x + Math.sin(a) * 9, v.y + 2.2 + this.stateT * 0.3, v.z + Math.cos(a) * 9);
      look = new THREE.Vector3(v.x, v.y + 0.8, v.z);
      cam.position.copy(pos); cam.lookAt(look); cam.fov = 55; cam.updateProjectionMatrix();
      return;
    }
    // velocity direction blends in so drifts show the car sideways
    const fwd = sp > 3 && v.vF > 2;
    const vdx = fwd ? v.vx / sp : fx, vdz = fwd ? v.vz / sp : fz;
    let dx = fx * 0.6 + vdx * 0.4, dz = fz * 0.6 + vdz * 0.4;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    if (this.camMode === 2) {
      pos = new THREE.Vector3(v.x + fx * 0.3, v.y + 1.12, v.z + fz * 0.3);
      look = new THREE.Vector3(v.x + fx * 20, v.y + 0.9, v.z + fz * 20);
      cam.position.copy(pos);
    } else {
      const dist = (this.camMode === 1 ? 9.5 : 6.4) + sp * 0.02, h = this.camMode === 1 ? 3.6 : 2.15;
      pos = new THREE.Vector3(v.x - dx * dist, v.y + h, v.z - dz * dist);
      look = new THREE.Vector3(v.x + fx * 4, v.y + 0.9, v.z + fz * 4);
      if (snap) cam.position.copy(pos);
      else cam.position.lerp(pos, 1 - Math.exp(-dt * 9));
      if (cam.position.y < v.y + 0.8) cam.position.y = v.y + 0.8;
    }
    if (this.shake > 0) {
      const s = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.lookAt(look);
    const fov = 60 + clamp(sp / 90, 0, 1) * 14 + (v.boosting ? 8 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
  }

  hudData() {
    const p = this.player, v = p.v;
    const d = this.drift;
    const type = this.cfg.type;
    const others = this.cars.filter((c) => !c.isPlayer && !c.out).map((c) => ({ x: c.v.x, z: c.v.z, color: c.color != null ? '#' + c.color.toString(16).padStart(6, '0') : '#ffb020' }));
    if (this.ghost && this.ghost.model.object.visible) others.push({ x: this.ghost.model.object.position.x, z: this.ghost.model.object.position.z, color: 'rgba(120,220,255,.8)' });
    const lapTime = this.state === 'race' || this.state === 'finished' ? (p.finished ? p.lapTimes[p.lapTimes.length - 1] : this.raceTime - p.lapStart) : 0;
    let extra = '';
    if (type === 'timeattack') extra = `GOLD ${this.targets[0].toFixed(2)} · SILVER ${this.targets[1].toFixed(2)} · BRONZE ${this.targets[2].toFixed(2)}`;
    if (type === 'drift') extra = `TARGETS ${this.targets.map((t) => t.toLocaleString()).join(' / ')}`;
    let position = this.cars.length > 1 ? this.position(p) : 0, racers = this.cars.length - this.eliminated.length;
    if (this.online) {
      const o = this.online.hud(this);
      position = o.position; racers = o.racers; others.push(...o.others); extra = o.extra;
    }
    return {
      speedKmh: Math.abs(v.vF) * 3.6,
      lap: p.crossings, lapCount: type === 'free' ? 99 : this.cfg.laps,
      lapTime, bestLap: type === 'free' ? (this.game.profile.best[this.cfg.worldId] || p.bestLap) : (p.bestLap || null),
      extra,
      position, racers,
      boost: v.boost / v.stats.boostCap, boosting: v.boosting, battery: v.boost / v.stats.boostCap,
      message: this.message, note: this.note,
      driftScore: type === 'drift' || d.score > 0 || d.chain > 0 ? d.score : 0, driftChain: d.chain, driftMult: d.mult,
      wrongWay: p.wrongT > 1.2,
      ghostDelta: this.ghostDelta,
      fps: this.game.quality.fps, qualityLabel: this.game.quality.preset.name,
      minimap: { player: { x: v.x, z: v.z, rot: v.yaw }, others },
    };
  }

  endRace() {
    if (this.ended) return;
    this.ended = true;
    const p = this.player, order = this.order();
    if (this.online) { this.game.onRaceEnd(this.online.result(this)); return; }
    const result = {
      type: this.cfg.type, position: order.indexOf(p) + 1, racers: this.cars.length,
      bestLap: p.bestLap, totalTime: p.finishTime, driftScore: Math.round(this.drift.score),
      targets: this.targets, survivedLaps: this.eliminated.includes(p) ? this.eliminated.indexOf(p) : this.eliminated.length,
      dnf: !p.finished && !(this.cfg.type === 'elim'),
      table: order.map((c, i) => ({ pos: i + 1, name: c.name, me: c.isPlayer, time: c.finished ? fmtT(c.finishTime) : c.out ? 'OUT' : '+' + Math.max(1, Math.round((this.track.length * this.cfg.laps - c.progress) / Math.max(c.v.speed, 20))) + 's' })),
    };
    this.game.onRaceEnd(result);
  }

  dispose() {
    for (const c of this.cars) { this.scene.remove(c.model.object); c.model.dispose && c.model.dispose(); }
    if (this.ghost) { this.ghost.model.dispose && this.ghost.model.dispose(); }
    this.skids.dispose(); this.smoke.dispose();
    this.world.dispose && this.world.dispose();
    if (this.online) this.online.dispose();
  }
}

function fmtT(t) {
  if (t == null) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
