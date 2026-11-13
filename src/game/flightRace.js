// Flight session: the main game. Fly the Roadster through ring courses.
// Types: 'ringrace' (vs AI pilots), 'ringtrial' (solo, medal times), 'freeflight', 'tutorial'.
import * as THREE from 'three';
const _ra = new THREE.Vector3(), _rb = new THREE.Vector3();
import { Flyer, AIFlyer, flightStats } from '../physics/flight.js';
import { FlightCourse, courseFromGround, ringsFromCourse, crossesRing } from './flightCourse.js';

const STEP = 1 / 120;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const AI_NAMES = ['Nova', 'Volta', 'Kestrel', 'Ampère', 'Cobalt', 'Quill', 'Zephyr', 'Halo', 'Rook', 'Ion', 'Faraday', 'Vega'];
const fmtT = (t) => { if (t == null) return '--'; const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`; };

const TUTORIAL = [
  { id: 'thrust', text: 'Throttle up: hold W (or the thrust slider) to fly faster.', key: 'W', touch: 'Slide the thrust bar up', done: (r) => r.player.thrust > 0.85 },
  { id: 'turn', text: 'Bank to turn: A / D or ← / →. The car leans and swings round like a plane.', key: 'A D', touch: 'Push the stick left or right', done: (r) => r.tut.turnT > 1.2 },
  { id: 'pitch', text: 'Climb and dive: ↑ climbs, ↓ dives.', key: '↑ ↓', touch: 'Pull the stick down to climb, push up to dive', done: (r) => r.tut.pitchT > 1.2 },
  { id: 'ring', text: 'Fly through the glowing ring. Follow the arrow if you lose it.', key: '', touch: '', done: (r) => r.player.ringsHit >= 2 },
  { id: 'boost', text: 'Overdrive: hold Shift for a burst of speed. Rings recharge it.', key: 'Shift', touch: 'Hold BOOST', done: (r) => r.tut.boostT > 0.8 },
  { id: 'hover', text: 'Hover: hold Space to air-brake. The fans keep you up, even when you\'re slow.', key: 'Space', touch: 'Hold HOVER', done: (r) => r.tut.hoverT > 1 },
  { id: 'lap', text: 'Finish the lap through every ring. You\'re ready to race!', key: '', touch: '', done: (r) => r.player.finished },
];

export class FlightRace {
  constructor(game, cfg) {
    this.game = game; this.cfg = cfg;
    this.isFlight = true;
    this.scene = new THREE.Scene();
    this.scene.environment = game.envMap;
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.2, 4000);
    this.time = 0; this.raceTime = 0; this.state = 'intro'; this.stateT = 0;
    this.message = ''; this.note = ''; this.noteT = 0; this.penalty = 0;
    this.cars = []; this.acc = 0; this.shake = 0;
    this.tut = { step: 0, turnT: 0, pitchT: 0, boostT: 0, hoverT: 0 };
    this.camPos = new THREE.Vector3(); this.camUp = new THREE.Vector3(0, 1, 0);
  }

  build() {
    const g = this.game, P = g.profile, q = g.quality.preset, cfg = this.cfg;
    const w = this.world = g.mods.worlds.createWorld(cfg.worldId, { scene: this.scene, renderer: g.renderer, quality: q.id, weather: cfg.weather || 'clear', mode: 'flight' });
    w.setShadowSize && w.setShadowSize(q.shadowSize);
    this.groundAt = typeof w.getGroundHeight === 'function' ? (x, z) => w.getGroundHeight(x, z) : () => 0;
    const curve = w.flightCurve || courseFromGround(w.trackCurve, w.getGroundHeight ? this.groundAt : null, cfg.worldId.length);
    this.course = new FlightCourse(curve);
    let rings = w.rings && w.rings.length >= 4 ? w.rings.map((r) => ({ ...r, position: r.position.clone(), quaternion: r.quaternion.clone() })) : ringsFromCourse(this.course);
    for (const r of rings) if (r.s == null) r.s = this.course.locate(r.position).s;
    rings.sort((a, b) => a.s - b.s);
    this.rings = rings;
    this.colliders = w.colliders || [];
    this.ceiling = w.ceiling ?? 600;
    if (!w.sun) {
      const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.castShadow = true; this.scene.add(sun, sun.target);
      this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x404040, 1)); this.ownSun = sun;
    }
    if (this.scene.fog) { this.scene.fog.far = Math.max(this.scene.fog.far || 0, q.drawDist * 1.2); this.scene.fog.near = Math.max(this.scene.fog.near || 0, 120); }
    this.camera.far = q.drawDist * 2.2; this.camera.updateProjectionMatrix();

    // ring meshes
    const torus = new THREE.TorusGeometry(1, 0.06, 10, 48);
    this.ringMats = {
      next: new THREE.MeshBasicMaterial({ color: 0x35e8ff, transparent: true, opacity: 0.95, fog: false }),
      soon: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }),
      done: new THREE.MeshBasicMaterial({ color: 0x35e8ff, transparent: true, opacity: 0.08 }),
      finish: new THREE.MeshBasicMaterial({ color: 0xff2a3d, transparent: true, opacity: 0.95, fog: false }),
    };
    const discTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, 'rgba(53,232,255,0)'); gr.addColorStop(0.8, 'rgba(53,232,255,0.12)'); gr.addColorStop(1, 'rgba(53,232,255,0.35)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
    this.discMat = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const disc = new THREE.CircleGeometry(1, 40);
    for (const r of rings) {
      const m = new THREE.Mesh(torus, this.ringMats.soon);
      m.position.copy(r.position); m.quaternion.copy(r.quaternion); m.scale.setScalar(r.radius);
      const d = new THREE.Mesh(disc, this.discMat); d.visible = false; m.add(d);
      r.mesh = m; r.disc = d; this.scene.add(m);
    }

    // cars
    const nAI = cfg.type === 'ringrace' ? (cfg.opponents ?? 5) : 0;
    const paints = g.mods.car.PAINTS.map((p) => p.id).filter((id) => id !== P.car.paint);
    const wheels = g.mods.car.WHEELS.map((x) => x.id);
    const names = AI_NAMES.slice().sort(() => Math.random() - 0.5);
    const mk = (paint, wh, quality, isPlayer) => {
      const model = g.mods.car.createRoadster({ model: P.car.model || 'rocket', paint, wheels: wh, quality });
      model.object.traverse((o) => { if (o.isMesh) o.castShadow = q.shadows && (isPlayer || q.id !== 'low'); });
      if (!model.setThrust) this.addFallbackJets(model);
      this.scene.add(model.object);
      return model;
    };
    const ring0 = rings[0];
    const startS = ring0.s - 70;
    // player
    const fl = this.flyer = new Flyer(flightStats(P.upgrades));
    fl.gravity = (w.gravity || 9.81);
    fl.assist = P.settings.flightAssist !== false;
    const sp = this.course.at(startS - (nAI > 0 ? 25 : 0), {});
    fl.place(new THREE.Vector3(sp.x, sp.y, sp.z), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), sp.tan), 45);
    this.player = { isPlayer: true, name: P.name || 'You', model: mk(P.car.paint, P.car.wheels, q.carDetail, true), ringsHit: 0, nextRing: 0, lapStart: 0, lapTimes: [], bestLap: null, finished: false, finishTime: null, lastRing: -1, combo: 0, comboT: 0, courseI: -1, s: startS, thrust: fl.thrust };
    this.cars.push(this.player);
    // AI
    const aiStats = flightStats({ motor: cfg.aiUpgrade, inverter: cfg.aiUpgrade, tires: cfg.aiUpgrade, battery: cfg.aiUpgrade });
    for (let i = 0; i < nAI; i++) {
      const ai = new AIFlyer(this.course, { skill: cfg.skill || 0.9, seed: i + 1, stats: aiStats });
      ai.start(startS - 12 * Math.floor(i / 2) + (i % 2 ? 0 : -6), (i % 2 ? 1 : -1) * (4 + (i % 3) * 2), ((i % 3) - 1) * 3);
      ai.speed = 45;
      const car = { isPlayer: false, ai, name: names[i % names.length], model: mk(paints[i % paints.length], wheels[i % wheels.length], q.id === 'ultra' ? 'high' : 'low', false), color: (g.mods.car.PAINTS.find((x) => x.id === paints[i % paints.length]) || {}).color, sTotal: ai.s, finished: false, finishTime: null };
      this.cars.push(car);
    }
    // medal targets for trials: a perfect AI lap
    if (cfg.type === 'ringtrial') {
      const t = this.simulateLap(flightStats(P.upgrades));
      this.targets = [t * 1.06, t * 1.16, t * 1.3];
    }
    const pts = []; for (let i = 0; i < this.course.n; i += 4) pts.push({ x: this.course.p[i].x, z: this.course.p[i].z });
    g.ui.hud.setTrack && g.ui.hud.setTrack(pts, this.course.bounds);
    g.ui.hud.setMode && g.ui.hud.setMode('flight');
    if (cfg.type === 'tutorial') this.showTutorial();
    this.updateRingVisuals();
    this.syncModels(0);
    this.placeCamera(1, true);
  }

  addFallbackJets(model) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.ConeGeometry(0.16, 1.4, 12, 1, true); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -0.7);
    const jets = [];
    for (const x of [-0.5, 0.5]) { const j = new THREE.Mesh(geo, mat); j.position.set(x, 0.55, -2.1); model.object.add(j); jets.push(j); }
    model.setThrust = (t) => { for (const j of jets) { j.scale.set(1, 1, 0.2 + t * 1.6); } mat.opacity = 0.25 + 0.6 * t; };
    model.setBoost = (b) => { mat.color.setHex(b ? 0xffffff : 0x6fe3ff); };
  }

  simulateLap(stats) {
    const ai = new AIFlyer(this.course, { skill: 1, seed: 3, stats });
    ai.start(0, 0, 0); ai.speed = 60;
    let t = 0; const dt = 1 / 30;
    while (ai.laps < 1 && t < 600) { ai.update(dt); t += dt; }
    ai.laps = 0; t = 0;
    while (ai.laps < 1 && t < 600) { ai.update(dt); t += dt; }
    return t;
  }

  get laps() { return this.cfg.type === 'freeflight' ? Infinity : (this.cfg.type === 'tutorial' ? 1 : this.cfg.laps || 3); }

  update(dt) {
    this.time += dt; this.stateT += dt;
    const g = this.game;
    if (this.state === 'intro') {
      if (this.stateT > 2 || g.input.wasPressed('Space', 'Enter') || this.cfg.type === 'tutorial' || this.cfg.type === 'freeflight') { this.state = 'countdown'; this.stateT = 0; this.lastCount = 4; }
    } else if (this.state === 'countdown') {
      const quick = this.cfg.type === 'tutorial' || this.cfg.type === 'freeflight';
      const n = 3 - Math.floor(this.stateT);
      if (!quick && n !== this.lastCount && n > 0) { this.lastCount = n; this.message = String(n); g.audio.ui('countdown'); }
      if (quick || this.stateT >= 3) { this.state = 'race'; this.stateT = 0; this.message = quick ? '' : 'GO!'; if (!quick) g.audio.ui('go'); }
    } else if (this.state === 'race' && this.stateT > 1 && this.message === 'GO!') this.message = '';

    const racing = this.state === 'race' || this.state === 'finished';
    this.acc += Math.min(dt, 0.1);
    const inp = this.flightInput();
    while (this.acc >= STEP) { this.acc -= STEP; this.fixed(STEP, racing, inp); }
    this.post(dt, inp);
  }

  flightInput() {
    const s = this.game.inputState, f = this.game.flightInput || {};
    return {
      pitch: f.pitch ?? 0, turn: s.steer, yaw: f.yaw || 0,
      thrust: f.thrust ?? null, throttle: f.throttle ?? 0,
      brake: f.hover ? 1 : 0, boost: s.boost,
    };
  }

  fixed(dt, racing, inp) {
    const fl = this.flyer, p = this.player;
    if (racing) this.raceTime += dt;
    if (!racing) {
      // hold position on the grid, gently gliding
      const sp = this.course.at(p.s, {}); fl.vel.copy(sp.tan).multiplyScalar(0); fl.rates.set(0, 0, 0);
      fl.thrust = clamp(fl.thrust + (inp.throttle || 0) * dt, 0, 1);
    } else if (!fl.crashed) {
      const prev = fl.pos.clone();
      const ctrl = p.finished && this.cfg.type !== 'freeflight' ? this.autopilot() : inp;
      fl.step(dt, ctrl, { groundAt: this.groundAt, colliders: this.colliders, ceiling: this.ceiling });
      if (!fl.crashed && fl.assist && !fl.grounded) this.ringAssist(dt);
      if (!fl.crashed) this.checkRings(prev, fl.pos);
      if (fl.crashed) this.onCrash();
    }
    for (const c of this.cars) {
      if (c.isPlayer) continue;
      if (!racing) continue;
      c.ai.rubber = this.cfg.type === 'ringrace' ? clamp(1 + (this.progressOf(p) - this.progressOf(c)) * 0.004, 0.94, 1.06) : 1;
      const before = c.ai.s;
      c.ai.update(dt);
      let ds = c.ai.s - before; if (ds < -this.course.length / 2) ds += this.course.length;
      c.sTotal += ds;
      if (!c.finished && this.ringsOfAI(c) >= this.laps * this.rings.length + 1) { c.finished = true; c.finishTime = this.raceTime; }
    }
  }

  /** Assist: when lined up roughly with the next ring, gently pull the flight path through its centre. */
  ringAssist(dt) {
    const fl = this.flyer, r = this.rings[this.player.nextRing];
    if (!r) return;
    const d = _ra.copy(r.position).sub(fl.pos), dist = d.length();
    const speed = fl.vel.length();
    if (dist > 220 || dist < 2 || speed < 8) return;
    const v = _rb.copy(fl.vel).divideScalar(speed);
    const along = d.dot(v);
    if (along < dist * 0.7) return; // not heading for it
    const lat = d.addScaledVector(v, -along); // miss vector at closest approach
    const miss = lat.length();
    if (miss < 0.5) return;
    const tta = along / speed; // seconds until we reach it
    const need = miss / Math.max(tta, 0.25); // m/s of sideways velocity needed to fix the miss
    const pull = Math.min(need * 2.2, 14) * (1 - dist / 260); // capped, fades with distance
    fl.vel.addScaledVector(lat.divideScalar(miss), pull * dt).setLength(speed);
  }

  autopilot() {
    const fl = this.flyer, s = this.course.locate(fl.pos, this.player.courseI).s;
    const p = this.course.at(s + 60, {});
    const to = new THREE.Vector3(p.x, p.y, p.z).sub(fl.pos).normalize();
    const inv = fl.quat.clone().invert(); to.applyQuaternion(inv);
    return { pitch: clamp(to.y * 3, -1, 1), turn: clamp(-to.x * 3, -1, 1), thrust: 0.7, brake: 0, boost: false };
  }

  checkRings(a, b) {
    const p = this.player, n = this.rings.length;
    const r = this.rings[p.nextRing];
    if (crossesRing(r, a, b)) return this.passRing(false);
    // missed it? (flew well past without going through)
    const loc = this.course.locate(b, p.courseI); p.courseI = loc.i; p.s = loc.s;
    let ahead = loc.s - r.s; if (ahead < -this.course.length / 2) ahead += this.course.length; if (ahead > this.course.length / 2) ahead -= this.course.length;
    // missed = crossed the ring's plane outside the ring nearby, or got far past it along the course
    const nrm = r._n || new THREE.Vector3(0, 0, 1).applyQuaternion(r.quaternion);
    const da = a.clone().sub(r.position).dot(nrm), db = b.clone().sub(r.position).dot(nrm);
    const crossedPlane = da <= 0 && db > 0 && b.distanceTo(r.position) < 160;
    if (crossedPlane || (ahead > 260 && ahead < 600)) this.passRing(true);
    void n;
  }

  passRing(missed) {
    const p = this.player, n = this.rings.length, g = this.game;
    p.ringsHit++;
    const idx = p.nextRing;
    p.lastRing = idx;
    p.nextRing = (idx + 1) % n;
    if (missed) {
      if (this.cfg.type !== 'freeflight') { this.penalty += 2; this.raceTime += 2; }
      p.combo = 0; this.flash('MISSED +2s');
      g.audio.ui('back');
    } else {
      p.combo = p.comboT > 0 ? p.combo + 1 : 1; p.comboT = 4;
      this.flyer.boost = Math.min(this.flyer.stats.boostCap, this.flyer.boost + 0.08 + 0.02 * Math.min(p.combo, 10));
      g.audio.ui('ring', p.combo);
      if (p.combo >= 3) this.flash(`RING COMBO ×${p.combo}`);
      this.ringFlash = { ring: this.rings[idx], t: 0.5 };
    }
    if (idx === 0) {
      if (p.ringsHit > 1) {
        const lt = this.raceTime - p.lapStart;
        p.lapTimes.push(lt); if (!p.bestLap || lt < p.bestLap) p.bestLap = lt;
        this.onLap(lt);
      }
      p.lapStart = this.raceTime;
    }
    if (!p.finished && p.ringsHit >= this.laps * n + 1) this.finish();
    else if (idx === 0 && p.ringsHit === (this.laps - 1) * n + 1 && this.laps > 1 && this.laps < 99) this.flash('FINAL LAP');
    this.updateRingVisuals();
  }

  onLap(lt) {
    const P = this.game.profile, key = 'flight:' + this.cfg.worldId;
    if (this.cfg.type === 'ringtrial' || this.cfg.type === 'freeflight') {
      if (!P.best[key] || lt < P.best[key]) { P.best[key] = lt; this.game.save(); this.flash(`NEW BEST ${lt.toFixed(3)}s`); }
      else this.flash(`LAP ${lt.toFixed(3)}s`);
    }
    this.game.audio.ui('lap');
  }

  finish() {
    const p = this.player;
    p.finished = true; p.finishTime = this.raceTime;
    this.state = 'finished'; this.stateT = 0;
    this.message = this.cfg.type === 'tutorial' ? 'NICE FLYING!' : this.position() === 1 && this.cars.length > 1 ? 'VICTORY' : 'FINISH';
    this.game.audio.ui('lap');
    if (this.cfg.type === 'tutorial') { this.game.profile.tutorialDone = true; this.game.save(); }
  }

  onCrash() {
    const g = this.game;
    g.audio.collision(20); this.shake = 1; this.vibrate(120);
    this.flash(this.flyer.crashReason === 'ground' ? 'CRASHED: pull up earlier!' : 'CRASHED');
    this.player.combo = 0;
    this.respawnT = 1.2;
  }

  respawn() {
    const p = this.player, fl = this.flyer;
    const r = this.rings[(p.nextRing - 1 + this.rings.length) % this.rings.length];
    const s = p.ringsHit === 0 ? this.rings[0].s - 70 : r.s + 12;
    const sp = this.course.at(s, {});
    fl.place(new THREE.Vector3(sp.x, Math.max(sp.y, this.groundAt(sp.x, sp.z) + 12), sp.z), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), sp.tan), 45);
    fl.thrust = Math.max(fl.thrust, 0.7);
    p.courseI = -1;
  }

  ringsOfAI(c) {
    const L = this.course.length, n = this.rings.length;
    const full = Math.floor(c.sTotal / L), rem = c.sTotal - full * L;
    let k = 0; for (const r of this.rings) if (r.s <= rem) k++;
    return full * n + k;
  }

  progressOf(c) {
    const n = this.rings.length;
    if (c.isPlayer) {
      const r = this.rings[c.nextRing], prev = this.rings[(c.nextRing - 1 + n) % n];
      const seg = Math.max(10, r.position.distanceTo(prev.position));
      return c.ringsHit + clamp(1 - this.flyer.pos.distanceTo(r.position) / seg, 0, 0.99);
    }
    const k = this.ringsOfAI(c);
    const L = this.course.length, rem = ((c.sTotal % L) + L) % L;
    const next = this.rings[((k % n) + n) % n], prev = this.rings[(((k - 1) % n) + n) % n];
    let span = next.s - prev.s; if (span <= 0) span += L;
    let into = rem - prev.s; if (into < 0) into += L;
    return k + clamp(into / span, 0, 0.99);
  }

  order() {
    const fin = this.cars.filter((c) => c.finished).sort((a, b) => a.finishTime - b.finishTime);
    const run = this.cars.filter((c) => !c.finished).sort((a, b) => this.progressOf(b) - this.progressOf(a));
    return [...fin, ...run];
  }

  position(c = this.player) { return this.order().indexOf(c) + 1; }

  updateRingVisuals() {
    const p = this.player, n = this.rings.length;
    this.rings.forEach((r, i) => {
      const ahead = (i - p.nextRing + n) % n;
      const isFinish = i === 0 && p.ringsHit >= (this.laps - 1) * n + 1 && this.laps < 99;
      r.mesh.material = ahead === 0 ? (isFinish ? this.ringMats.finish : this.ringMats.next) : ahead < 4 ? this.ringMats.soon : this.ringMats.done;
      r.disc.visible = ahead === 0;
    });
  }

  showTutorial() {
    const st = TUTORIAL[this.tut.step]; if (!st) return;
    const touch = this.game.input.lastDevice === 'touch' || matchMedia('(pointer: coarse)').matches;
    const text = touch && st.touch ? st.touch : st.text;
    if (this.game.ui.tutorial && this.game.ui.tutorial.show) this.game.ui.tutorial.show({ id: st.id, text, keyHint: touch ? '' : st.key, step: this.tut.step + 1, total: TUTORIAL.length });
    this.tutText = text;
  }

  flash(t) { this.note = t; this.noteT = 2.2; }
  vibrate(ms) { if (this.game.profile.settings.vibration && navigator.vibrate && this.game.input.lastDevice === 'touch') navigator.vibrate(ms); }

  post(dt, inp) {
    const g = this.game, p = this.player, fl = this.flyer;
    if (this.noteT > 0) { this.noteT -= dt; if (this.noteT <= 0) this.note = ''; }
    if (p.comboT > 0) p.comboT -= dt;
    if (this.respawnT > 0) { this.respawnT -= dt; if (this.respawnT <= 0) this.respawn(); }
    if (g.input.wasPressed('KeyC', 'PadKeyC')) { this.camMode = ((this.camMode || 0) + 1) % 2; }
    if (g.input.wasPressed('KeyR', 'PadKeyR') && this.state === 'race' && !fl.crashed) { fl.crash('reset'); this.respawnT = 0.01; }
    p.thrust = fl.thrust;

    // tutorial progress
    if (this.cfg.type === 'tutorial' && this.state !== 'intro') {
      if (Math.abs(inp.turn) > 0.4) this.tut.turnT += dt;
      if (Math.abs(inp.pitch) > 0.4) this.tut.pitchT += dt;
      if (fl.boosting) this.tut.boostT += dt;
      if (fl.hovering) this.tut.hoverT += dt;
      const st = TUTORIAL[this.tut.step];
      if (st && st.done(this)) {
        g.ui.tutorial && g.ui.tutorial.done && g.ui.tutorial.done(st.id);
        g.audio.ui('confirm');
        this.tut.step++; this.showTutorial();
      }
    }

    this.syncModels(dt);
    if (this.ringFlash) { this.ringFlash.t -= dt; const m = this.ringFlash.ring.mesh; m.scale.setScalar(this.ringFlash.ring.radius * (1 + (0.5 - this.ringFlash.t) * 0.6)); if (this.ringFlash.t <= 0) { m.scale.setScalar(this.ringFlash.ring.radius); this.ringFlash = null; } }
    const pulse = 1 + Math.sin(this.time * 6) * 0.04;
    const nr = this.rings[p.nextRing]; if (!this.ringFlash || this.ringFlash.ring !== nr) nr.mesh.scale.setScalar(nr.radius * pulse);
    this.placeCamera(dt, false);
    this.world.update && this.world.update(dt, fl.pos, this.camera);
    if (this.ownSun) { this.ownSun.position.set(fl.pos.x + 60, fl.pos.y + 120, fl.pos.z + 40); this.ownSun.target.position.copy(fl.pos); }
    const alt = fl.pos.y - this.groundAt(fl.pos.x, fl.pos.z);
    if (g.audio.updateFlight) g.audio.updateFlight({ airspeed: fl.airspeed, thrust: fl.thrust, boost: fl.boosting, altitude: alt, gForce: fl.gForce }, dt);
    else g.audio.update({ speed: fl.airspeed * 0.7, throttle: fl.thrust, brake: fl.hovering ? 1 : 0, slip: 0, surface: 'asphalt', boost: fl.boosting }, dt);
    if (this.state === 'finished' && this.stateT > 3 && !this.ended) this.endRace();
  }

  syncModels(dt) {
    const fl = this.flyer, p = this.player;
    const o = p.model.object;
    o.position.copy(fl.pos); o.position.y -= 0.55;
    o.quaternion.copy(fl.quat);
    o.visible = !fl.crashed || this.respawnT < 0.9;
    const m = p.model;
    m.setFlight && m.setFlight(fl.flight);
    m.setThrust && m.setThrust(fl.crashed ? 0 : fl.thrust);
    m.setBoost && m.setBoost(fl.boosting);
    m.update && m.update(dt, fl.grounded ? fl.airspeed : 0, 0);
    for (const c of this.cars) {
      if (c.isPlayer) continue;
      const a = c.ai, mo = c.model;
      mo.object.position.copy(a.pos); mo.object.position.y -= 0.55; mo.object.quaternion.copy(a.quat);
      mo.setFlight && mo.setFlight(1); mo.setThrust && mo.setThrust(a.thrust); mo.setBoost && mo.setBoost(a.boosting);
      mo.update && mo.update(dt, 0, 0);
    }
  }

  placeCamera(dt, snap) {
    const fl = this.flyer, cam = this.camera;
    const f = fl.forward(new THREE.Vector3()), u = fl.up(new THREE.Vector3());
    const sp = fl.airspeed;
    if (this.state === 'intro') {
      const a = this.stateT * 0.5;
      cam.position.copy(fl.pos).add(new THREE.Vector3(Math.sin(a) * 12, 3 + this.stateT, Math.cos(a) * 12));
      cam.up.set(0, 1, 0); cam.lookAt(fl.pos); cam.fov = 55; cam.updateProjectionMatrix();
      return;
    }
    const far = this.camMode === 1;
    // follow the velocity a little so big turns show the car's attitude
    const vdir = sp > 5 ? fl.vel.clone().normalize() : f;
    const back = f.clone().multiplyScalar(0.65).addScaledVector(vdir, 0.35).normalize();
    const want = fl.pos.clone().addScaledVector(back, -(far ? 15 : 9.5) - sp * 0.02).addScaledVector(u, far ? 4 : 2.6).add(new THREE.Vector3(0, 1, 0));
    if (snap) this.camPos.copy(want); else this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
    const gy = this.groundAt(this.camPos.x, this.camPos.z) + 1.5;
    if (this.camPos.y < gy) this.camPos.y = gy;
    cam.position.copy(this.camPos);
    if (this.shake > 0) { const s = this.shake * 0.5; cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; this.shake = Math.max(0, this.shake - dt * 2); }
    this.camUp.lerp(new THREE.Vector3(0, 1, 0).lerp(u, 0.35), 1 - Math.exp(-dt * 4)).normalize();
    cam.up.copy(this.camUp);
    cam.lookAt(fl.pos.clone().addScaledVector(f, 18).addScaledVector(u, 1));
    const fov = 62 + clamp(sp / 120, 0, 1) * 16 + (fl.boosting ? 10 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix();
  }

  nextRingDir() {
    const r = this.rings[this.player.nextRing];
    const v = r.position.clone().project(this.camera);
    const behind = v.z > 1;
    if (!behind && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.85) return null;
    let x = v.x, y = v.y; if (behind) { x = -x; y = -y; }
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  hudData() {
    const p = this.player, fl = this.flyer, n = this.rings.length;
    const others = this.cars.filter((c) => !c.isPlayer).map((c) => ({ x: c.ai.pos.x, z: c.ai.pos.z, color: c.color != null ? '#' + c.color.toString(16).padStart(6, '0') : '#ffb020' }));
    const racing = this.state === 'race' || this.state === 'finished';
    const lap = Math.max(1, Math.floor(Math.max(0, p.ringsHit - 1) / n) + 1);
    let extra = '';
    if (this.targets) extra = `GOLD ${this.targets[0].toFixed(2)} · SILVER ${this.targets[1].toFixed(2)} · BRONZE ${this.targets[2].toFixed(2)}`;
    if (this.cfg.type === 'tutorial' && this.tutText) extra = this.tutText;
    return {
      mode: 'flight',
      speedKmh: fl.airspeed * 3.6, airspeedKmh: fl.airspeed * 3.6,
      altitude: Math.round(fl.pos.y - this.groundAt(fl.pos.x, fl.pos.z)),
      rings: { hit: (p.ringsHit === 0 ? 0 : ((p.ringsHit - 1) % n) + 1), total: n },
      nextRingDir: this.nextRingDir(),
      thrust: fl.thrust,
      lap: Math.min(lap, this.laps), lapCount: this.laps === Infinity ? 99 : this.laps,
      lapTime: racing ? (p.finished ? p.lapTimes[p.lapTimes.length - 1] : (p.ringsHit ? this.raceTime - p.lapStart : 0)) : 0,
      bestLap: p.bestLap || (this.cfg.type !== 'ringrace' ? this.game.profile.best['flight:' + this.cfg.worldId] : null),
      position: this.cars.length > 1 ? this.position() : 0, racers: this.cars.length,
      boost: fl.boost / fl.stats.boostCap, boosting: fl.boosting, battery: fl.boost / fl.stats.boostCap,
      message: this.message, note: this.note || (fl.hovering ? 'HOVER' : ''), extra,
      driftScore: 0, wrongWay: false,
      fps: this.game.quality.fps, qualityLabel: this.game.quality.preset.name,
      minimap: { player: { x: fl.pos.x, z: fl.pos.z }, others },
    };
  }

  endRace() {
    if (this.ended) return;
    this.ended = true;
    const p = this.player, order = this.order();
    this.game.onRaceEnd({
      type: this.cfg.type, position: order.indexOf(p) + 1, racers: this.cars.length,
      bestLap: p.bestLap, totalTime: p.finishTime, targets: this.targets, driftScore: 0, penalty: this.penalty,
      dnf: !p.finished,
      table: order.map((c, i) => ({ pos: i + 1, name: c.name, me: c.isPlayer, time: c.finished ? fmtT(c.finishTime) : '—' })),
    });
  }

  dispose() {
    for (const c of this.cars) { this.scene.remove(c.model.object); c.model.dispose && c.model.dispose(); }
    for (const r of this.rings) this.scene.remove(r.mesh);
    this.world.dispose && this.world.dispose();
  }
}
