// Fly mode: a road race where the Roadster fires its thrusters in short bursts.
//
// The car drives on the road with the normal car physics (Race). Holding the jet button
// (Space / JET / gamepad A) fires the thrusters from a small tank: about 1.4 s of burn
// lifts the car up to ~30 m, a quick tap is a short hop. When the tank runs dry the wings
// glide the car down; the tank refills only while the wheels are on the road.
// Sky rings hang above the road at spots you need a hop to reach. They refill the jets,
// in a Ring Trial missing one costs 2 seconds. High enough above the barriers, the car can
// cut corners - but the tank is small, and falling off the course means a reset.
import * as THREE from 'three';
import { Race } from './race.js';
import { AIDriver } from './ai.js';
import { collideCars } from '../physics/vehicle.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TANK_BURN = 1.4;   // seconds of full burn per tank
const TANK_FILL = 2.6;   // seconds on the road to refill from empty
const RING_FUEL = 0.45;  // tank refill per ring
const IDLE = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
const fmtT = (t) => { if (t == null) return '--'; const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`; };

const TUTORIAL = [
  { id: 'drive', text: 'Hold W (or GO) to drive. Steer with A / D or ← / →.', key: 'W', touch: 'Hold GO, and drag on the left to steer.', done: (r) => r.player.v.speed > 22 },
  { id: 'jet', text: 'Fire the jets: hold Space to hop. A tap is a short hop, holding flies higher.', key: 'Space', touch: 'Hold JET to hop. A tap is a short hop.', done: (r) => r.tut.hops >= 2 },
  { id: 'ring', text: 'Jet through a glowing ring. Rings refill your tank. Follow the arrow if you lose it.', key: 'Space', touch: 'Hold JET as you reach the ring.', done: (r) => r.tut.rings >= 1 },
  { id: 'glide', text: 'The tank is small. When it runs dry the wings glide you down. It refills on the road.', key: 'A D', touch: 'Steer while you glide.', done: (r) => r.tut.landings >= 3 },
  { id: 'boost', text: 'Overdrive: hold Shift on the road for a burst of speed.', key: 'Shift', touch: 'Hold ⚡ on the road.', done: (r) => r.tut.boostT > 0.8 },
  { id: 'lap', text: 'Finish the lap. You\'re ready to race!', key: '', touch: '', done: (r) => r.player.finished },
];

export class HopRace extends Race {
  /**
   * cfg.type: 'ringrace' (race rivals; rings refill jets), 'ringtrial' (solo, every ring counts,
   * misses +2 s), 'tutorial', 'freeflight' (free roam).
   */
  constructor(game, cfg) {
    const kind = cfg.type;
    const base = kind === 'ringtrial' ? 'timeattack' : 'race';
    const laps = kind === 'freeflight' ? 99 : kind === 'tutorial' ? 1 : cfg.laps;
    super(game, { ...cfg, type: base, laps, opponents: kind === 'ringrace' ? cfg.opponents : 0 });
    this.kind = kind;
    this.isFlight = true;
    this.penalty = 0;
    this.tut = { step: 0, hops: 0, rings: 0, landings: 0, boostT: 0 };
    const wd = (game.worlds || []).find((w) => w.id === cfg.worldId);
    this.worldMode = wd && wd.modes && wd.modes.includes('hop') ? 'hop' : 'ground';
  }

  build() {
    super.build();
    const g = this.game, w = this.world;
    this.g = w.gravity || 9.81;
    this.jetUp = this.g + Math.max(1.25 * this.g, 6); // net climb ~12 m/s² on Earth, floatier on the Moon
    this.groundAt = typeof w.getGroundHeight === 'function' ? (x, z) => w.getGroundHeight(x, z) : null;
    for (const c of this.cars) {
      c.jet = { fuel: 1, vy: 0, air: false, firing: false, airT: 0, flight: 0 };
      c.ringI = 0; c.prevD = c.info.dist;
    }
    this.buildRings();
    g.ui.hud.setMode && g.ui.hud.setMode('flight');
    if (this.kind === 'tutorial') this.showTutorial();
  }

  groundUnder(c) {
    return this.groundAt ? this.groundAt(c.v.x, c.v.z) : c.info.y;
  }

  // ------------------------------------------------------------------ rings
  buildRings() {
    const tr = this.track, w = this.world, L = tr.length;
    let rings = [];
    if (Array.isArray(w.hopRings) && w.hopRings.length) {
      for (const r of w.hopRings) {
        const info = tr.locate(r.position.x, r.position.z, -1, {});
        rings.push({ dist: info.dist, lat: info.lat, position: r.position.clone(), tx: info.tx, tz: info.tz, radius: r.radius || 5 });
      }
    } else {
      // above straighter stretches, every ~300 m, 4.5-10 m over the road
      let seed = (this.cfg.worldId || 'x').split('').reduce((a, ch) => a + ch.charCodeAt(0), 7);
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const count = Math.max(6, Math.round(L / 300));
      for (let k = 0; k < count; k++) {
        let best = null, bestK = Infinity;
        const d0 = ((k + 0.5) / count) * L;
        for (let s = -60; s <= 60; s += 6) { // pick the straightest spot nearby
          let kk = 0;
          for (let j = -30; j <= 30; j += 10) kk += Math.abs(tr.curvatureAt(d0 + s + j));
          if (kk < bestK) { bestK = kk; best = d0 + s; }
        }
        const d = ((best % L) + L) % L;
        // place by track distance, not a nearest-point search: tracks that pass near themselves
        // (bridges, hairpins) would otherwise pin the ring to the wrong stretch
        const lat = (rnd() - 0.5) * tr.roadHalf * 0.6;
        const p = tr.pointAt(d, lat, {});
        const h = 4.5 + rnd() * 5.5;
        rings.push({ dist: d, lat, position: new THREE.Vector3(p.x, p.y + h, p.z), tx: Math.sin(p.yaw), tz: Math.cos(p.yaw), radius: 5 });
      }
    }
    rings.sort((a, b) => a.dist - b.dist);
    // keep rings off the start line
    rings = rings.filter((r) => r.dist > 60 && r.dist < L - 40);
    this.rings = rings;

    const torus = new THREE.TorusGeometry(1, 0.075, 10, 48);
    this.ringMats = {
      next: new THREE.MeshBasicMaterial({ color: 0x35e8ff, transparent: true, opacity: 0.95, fog: false }),
      idle: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
      done: new THREE.MeshBasicMaterial({ color: 0x35e8ff, transparent: true, opacity: 0.12 }),
    };
    const discTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'); const gr = x.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, 'rgba(53,232,255,0)'); gr.addColorStop(0.8, 'rgba(53,232,255,0.14)'); gr.addColorStop(1, 'rgba(53,232,255,0.4)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(cv); })();
    this.discMat = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const disc = new THREE.CircleGeometry(1, 40);
    // a faint beam down to the road so you can judge where to take off
    const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x35e8ff, transparent: true, opacity: 0.35 });
    for (const r of rings) {
      const m = new THREE.Mesh(torus, this.ringMats.idle);
      m.position.copy(r.position);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(r.tx, 0, r.tz));
      m.scale.setScalar(r.radius);
      const d = new THREE.Mesh(disc, this.discMat); d.visible = false; m.add(d);
      const groundY = this.groundAt ? this.groundAt(r.position.x, r.position.z) : r.position.y - 8;
      const beam = new THREE.Mesh(beamGeo, beamMat);
      const hgt = Math.max(0.5, r.position.y - r.radius - groundY);
      beam.scale.set(1, hgt, 1); beam.position.set(r.position.x, groundY + hgt / 2, r.position.z);
      r.mesh = m; r.disc = d; r.beam = beam;
      this.scene.add(m, beam);
    }
    this.player.hits = 0;
    this.updateRingVisuals();
  }

  nextRingIndex(dist) {
    const rs = this.rings;
    for (let i = 0; i < rs.length; i++) if (rs[i].dist > dist + 1) return i;
    return 0;
  }

  updateRingVisuals() {
    const p = this.player, n = this.rings.length;
    const next = this.nextRingIndex(p.info.dist);
    this.rings.forEach((r, i) => {
      const isNext = i === next;
      r.mesh.material = isNext ? this.ringMats.next : (p.ringDone && p.ringDone.has(i) ? this.ringMats.done : this.ringMats.idle);
      r.disc.visible = isNext;
    });
    this.nextRing = next;
    void n;
  }

  /** Did car c go through (or past) a ring this step? */
  checkRings(c) {
    const L = this.track.length, d0 = c.prevD, d1 = c.info.dist;
    const moved = (d1 - d0 + L) % L;
    if (moved > 80 || moved === 0) return; // reset/teleport or standing still
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const off = (r.dist - d0 + L) % L;
      if (off > moved) continue;
      const v = c.v;
      const dx = v.x - r.position.x, dy = (v.y + 0.6) - r.position.y, dz = v.z - r.position.z;
      const hit = Math.hypot(dx, dy, dz) <= r.radius * 1.15;
      if (hit) {
        c.jet.fuel = Math.min(1, c.jet.fuel + RING_FUEL);
        v.boost = Math.min(v.stats.boostCap, v.boost + 0.12);
      }
      if (c.isPlayer) this.playerRing(i, hit);
    }
  }

  playerRing(i, hit) {
    const p = this.player, g = this.game;
    p.ringDone = p.ringDone || new Set();
    if (hit) {
      p.ringDone.add(i); p.hits++;
      p.combo = (p.comboT > 0 ? (p.combo || 0) : 0) + 1; p.comboT = 9;
      g.audio.ui('ring', p.combo);
      this.flash(p.combo >= 3 ? `RING COMBO ×${p.combo}` : 'JETS REFILLED');
      this.ringFlash = { ring: this.rings[i], t: 0.5 };
      this.tut.rings++;
      this.vibrate(25);
    } else {
      p.combo = 0;
      if (this.kind === 'ringtrial' && this.state === 'race') { this.penalty += 2; this.raceTime += 2; this.flash('MISSED +2s'); g.audio.ui('back'); }
    }
  }

  // ------------------------------------------------------------------ physics
  fixed(dt, racing, inp) {
    const tr = this.track;
    if (racing) this.raceTime += dt;
    const live = this.cars.filter((o) => !o.out);
    const others = live.map((o) => o.v);
    for (const c of this.cars) {
      if (c.out) continue;
      const v = c.v, J = c.jet;
      let ci = IDLE, jet = false;
      if (!racing) ci = IDLE;
      else if (c.isPlayer && !c.finished && !this.autopilot) { // autopilot: test hook, AI drives the player
        ci = inp; jet = !!inp.handbrake;
        if (this.game.profile.settings.assist && Math.abs(inp.steer) < 0.05 && !J.air) v.yawRate *= 0.985;
      } else {
        if (!c.ai) c.ai = new AIDriver(v, tr, { skill: 0.95, lane: 0, seed: 7 });
        if (!c.isPlayer) {
          const gap = c.progress - this.player.progress;
          c.ai.rubber = this.kind === 'ringrace' ? (gap > 150 ? 0.94 : gap < -150 ? 1.06 : 1) : 1;
        }
        c.ai.aimLane = this.aiAimLane(c);
        ci = c.ai.update(dt, c.info, others);
        if (c.ai.stuck > 3) { this.resetCar(c); c.ai.stuck = 0; }
        jet = this.aiJet(c);
      }
      c.prevD = c.info.dist;
      // wheels only drive on the ground; in the air you can still steer a little
      const drive = J.air
        ? { steer: ci.steer, throttle: 0, brake: 0, handbrake: false, boost: false }
        : { steer: ci.steer, throttle: ci.throttle, brake: ci.brake, handbrake: false, boost: ci.boost };
      let env;
      if (J.air) env = { grip: 0.55, rolling: 0 }; // a little air control from the thrusters
      else {
        const surf = this.world.getSurface ? this.world.getSurface(v.x, v.z) : null;
        env = surf || { grip: Math.abs(c.info.lat) <= tr.roadHalf + 0.8 ? 1 : 0.72, rolling: Math.abs(c.info.lat) <= tr.roadHalf + 0.8 ? 0 : 1 };
        v.surface = (surf && surf.type) || 'asphalt';
      }
      v.step(dt, drive, env);
      tr.locate(v.x, v.z, J.air ? -1 : c.info.i, c.info);
      this.jetStep(c, racing && jet, dt);
      if (c.respawned) { c.respawned = false; continue; }
      // barriers only matter near the road surface: high enough, you fly over them
      const lim = tr.wallHalf - 1.0;
      const alt = v.y - c.info.y;
      if (Math.abs(c.info.lat) > lim && alt < 2.2) {
        if (!J.air && Math.abs(c.info.lat) > lim + 8) this.respawn(c, 'OFF COURSE');
        else {
          const s = Math.sign(c.info.lat);
          v.collideWall(s * c.info.nx, s * c.info.nz, Math.abs(c.info.lat) - lim);
          tr.locate(v.x, v.z, c.info.i, c.info);
        }
      }
      if (racing) { this.laps(c); this.checkRings(c); }
    }
    // car-to-car: only when at about the same height
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i].v, b = live[j].v;
      if (Math.abs(a.x - b.x) > 5 || Math.abs(a.z - b.z) > 5 || Math.abs(a.y - b.y) > 1.6) continue;
      const hit = collideCars(a, b);
      if (hit > 2 && (live[i].isPlayer || live[j].isPlayer)) { this.game.audio.collision(hit); this.shake = Math.min(1, this.shake + hit * 0.05); this.vibrate(30); }
    }
    const pv = this.player.v;
    if (pv.impact > 3) { this.game.audio.collision(pv.impact); this.shake = Math.min(1, this.shake + pv.impact * 0.04); this.vibrate(Math.min(80, pv.impact * 6)); }
    for (const c of this.cars) c.v.impact = 0;
    if (pv.boosting) this.tut.boostT += dt;
  }

  jetStep(c, wantJet, dt) {
    const v = c.v, J = c.jet, gr = this.groundUnder(c);
    J.firing = wantJet && J.fuel > 0;
    if (J.firing) {
      J.fuel = Math.max(0, J.fuel - dt / TANK_BURN);
      if (!J.air) {
        J.air = true; J.airT = 0; v.y = gr + 0.05; J.vy = Math.max(J.vy, 2.5);
        if (c.isPlayer) { this.tut.hops++; this.game.audio.ui('transform'); }
      }
      J.vy += this.jetUp * dt;
      // the rear thrusters also push forward a little
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      if (v.vF < v.stats.vmax * 1.15) { v.vx += fx * 5 * dt; v.vz += fz * 5 * dt; }
    }
    if (J.air) {
      J.vy -= this.g * dt;
      // wings: a long, shallow glide when coming down at speed
      if (!J.firing && J.vy < 0) J.vy *= Math.exp(-dt * 0.6 * clamp(v.speed / 35, 0.2, 1));
      v.y += J.vy * dt; J.airT += dt;
      if (v.y <= gr) {
        const impact = -J.vy;
        v.y = gr; J.vy = 0; J.air = false;
        if (c.isPlayer) {
          this.tut.landings++;
          if (impact > 22) { v.vx *= 0.55; v.vz *= 0.55; this.shake = 1; this.flash('HARD LANDING'); this.game.audio.collision(impact); this.vibrate(90); }
          else if (impact > 7) { this.shake = Math.min(1, this.shake + impact * 0.03); this.vibrate(30); }
        } else if (impact > 22) { v.vx *= 0.55; v.vz *= 0.55; }
      } else if (v.y < c.info.y - 12) {
        this.respawn(c, 'FELL! Respawning');
      }
    } else {
      v.y = gr;
      J.fuel = Math.min(1, J.fuel + dt / TANK_FILL);
    }
    v.vy = J.vy;
  }

  /** AI: line up under the next ring once it is close (lower skill = looser line). */
  aiAimLane(c) {
    if (!this.rings.length) return null;
    const L = this.track.length, r = this.rings[this.nextRingIndex(c.info.dist)];
    const ahead = (r.dist - c.info.dist + L) % L;
    if (ahead > 220) return null;
    return r.lat + (1 - Math.min(1, c.ai.skill)) * 6 * Math.sin(r.dist + c.v.stats.accel);
  }

  /** AI: fire the jets so the arc passes through the next ring. */
  aiJet(c) {
    if (!this.rings.length) return false;
    const L = this.track.length, J = c.jet, v = c.v;
    const r = this.rings[this.nextRingIndex(c.info.dist)];
    const ahead = (r.dist - c.info.dist + L) % L;
    if (ahead > 120) return false;
    const sp = Math.max(v.speed, 8), t = ahead / sp;
    const want = r.position.y - 0.6; // car origin is at the wheels
    const h = want - v.y;
    if (!J.air) {
      if (h < 1.5) return false;
      const net = this.jetUp - this.g;
      const tNeed = Math.sqrt((2 * h) / net) * 1.35; // burn time that reaches the height, with margin
      return t <= tNeed && J.fuel > 0.25;
    }
    const pred = v.y + J.vy * t - 0.5 * this.g * t * t;
    return pred < want && J.fuel > 0;
  }

  respawn(c, msg) {
    this.resetCar(c);
    const J = c.jet; J.air = false; J.vy = 0; J.firing = false; J.fuel = Math.max(J.fuel, 0.6);
    c.v.y = this.groundUnder(c);
    c.prevD = c.info.dist;
    c.respawned = true;
    if (c.isPlayer) { this.flash(msg); this.shake = 0.6; this.vibrate(100); }
  }

  laps(c) {
    // the tutorial lap only ends once the steps before it are done
    if (this.kind === 'tutorial' && c.isPlayer && this.tut.step < TUTORIAL.length - 1) this.cfg.laps = Math.max(1, c.crossings);
    else if (this.kind === 'tutorial' && c.isPlayer && this.cfg.laps < c.crossings) this.cfg.laps = c.crossings;
    super.laps(c);
    if (c.isPlayer && c.crossings >= 2 && c.lapMark !== c.crossings) { c.lapMark = c.crossings; c.ringDone = new Set(); this.updateRingVisuals(); }
  }

  finishCar(c) {
    super.finishCar(c);
    if (c.isPlayer && this.kind === 'tutorial') {
      this.message = 'NICE FLYING!';
      this.game.profile.tutorialDone = true; this.game.save();
      const t = this.game.ui.tutorial; t && t.complete && t.complete();
    }
  }

  // ------------------------------------------------------------------ tutorial
  showTutorial() {
    const st = TUTORIAL[this.tut.step]; if (!st) return;
    const touch = this.game.input.lastDevice === 'touch' || matchMedia('(pointer: coarse)').matches;
    const text = touch && st.touch ? st.touch : st.text;
    const t = this.game.ui.tutorial;
    if (t && t.show) t.show({ id: st.id, text, keyHint: touch ? '' : st.key, step: this.tut.step + 1, total: TUTORIAL.length });
    this.tutText = text;
  }

  skipTutorial() {
    this.tut.step = TUTORIAL.length; this.tutText = '';
    this.kind = 'freeflight'; this.cfg.laps = 99;
    this.flash('FREE ROAM');
  }

  // ------------------------------------------------------------------ visuals
  postUpdate(dt, inp) {
    const g = this.game, p = this.player;
    for (const c of this.cars) {
      if (c.jet && c.jet.air) { c.v.slip = 0; c.v.drifting = false; }
      if (c.jet && c.jet.firing) c.v.boosting = true; // jet roar + camera kick
    }
    if (p.comboT > 0) p.comboT -= dt;
    super.postUpdate(dt, inp);
    for (const c of this.cars) {
      if (c.out || !c.jet) continue;
      const J = c.jet, v = c.v, o = c.model.object, m = c.model;
      J.flight += ((J.air ? 1 : 0) - J.flight) * Math.min(1, dt * 6);
      m.setFlight && m.setFlight(J.flight);
      m.setThrust && m.setThrust(J.firing ? 1 : J.air ? 0.15 : 0);
      if (J.air) {
        const sp = Math.max(v.speed, 5);
        o.rotation.set(clamp(-Math.atan2(J.vy, sp) * 0.7, -0.5, 0.5), v.yaw, clamp(-v.yawRate * 0.25, -0.5, 0.5), 'YXZ');
      }
    }
    if (this.ringFlash) {
      this.ringFlash.t -= dt; const r = this.ringFlash.ring;
      r.mesh.scale.setScalar(r.radius * (1 + (0.5 - this.ringFlash.t) * 0.6));
      if (this.ringFlash.t <= 0) { r.mesh.scale.setScalar(r.radius); this.ringFlash = null; }
    }
    const next = this.nextRingIndex(p.info.dist);
    if (next !== this.nextRing) this.updateRingVisuals();
    const nr = this.rings[next];
    if (nr && (!this.ringFlash || this.ringFlash.ring !== nr)) nr.mesh.scale.setScalar(nr.radius * (1 + Math.sin(this.time * 6) * 0.05));

    // tutorial progress
    if (this.kind === 'tutorial' && this.state !== 'intro') {
      const st = TUTORIAL[this.tut.step];
      if (st && st.done(this)) {
        const t = g.ui.tutorial; t && t.done && t.done(st.id);
        g.audio.ui('confirm');
        this.tut.step++; this.showTutorial();
      }
    }
    if (this.kind === 'freeflight' && this.state === 'race' && this.message !== 'GO!') this.message = '';
  }

  placeCamera(dt, snap) {
    super.placeCamera(dt, snap);
    const J = this.player.jet;
    if (J && J.air && this.state !== 'intro' && this.camMode !== 2) {
      // pull back a touch in the air so the landing spot stays in view
      const v = this.player.v, cam = this.camera;
      cam.position.y += Math.min(3, (v.y - this.player.info.y) * 0.08);
      cam.lookAt(v.x + Math.sin(v.yaw) * 6, v.y + 0.4, v.z + Math.cos(v.yaw) * 6);
    }
  }

  nextRingDir() {
    const r = this.rings[this.nextRing ?? 0];
    if (!r) return null;
    const v = r.position.clone().project(this.camera);
    const behind = v.z > 1;
    if (!behind && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.85) return null;
    let x = v.x, y = v.y; if (behind) { x = -x; y = -y; }
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  hudData() {
    const d = super.hudData(), p = this.player, J = p.jet, v = p.v;
    const total = this.rings.length, hit = p.ringDone ? p.ringDone.size : 0;
    let extra = d.extra;
    if (this.kind === 'tutorial' && this.tutText) extra = this.tutText;
    if (this.kind === 'ringtrial' && this.penalty) extra = `${extra}${extra ? ' · ' : ''}PENALTY +${this.penalty}s`;
    let note = d.note;
    if (!note && J.air && J.fuel <= 0.01) note = 'GLIDING';
    else if (!note && !J.air && J.fuel < 0.25) note = 'JETS REFILLING';
    return {
      ...d,
      mode: 'flight',
      airspeedKmh: d.speedKmh,
      altitude: Math.max(0, Math.round(v.y - this.groundUnder(p))),
      rings: { hit, total },
      nextRingDir: this.nextRingDir(),
      thrust: J.fuel, jets: J.fuel, jetFiring: J.firing, airborne: J.air,
      lapCount: this.kind === 'freeflight' ? 99 : d.lapCount,
      extra, note,
      driftScore: 0, driftChain: 0,
    };
  }

  endRace() {
    if (this.ended) return;
    if (this.online) { super.endRace(); return; }
    this.ended = true;
    const p = this.player, order = this.order();
    this.game.onRaceEnd({
      type: this.kind, position: order.indexOf(p) + 1, racers: this.cars.length,
      bestLap: p.bestLap, totalTime: p.finishTime, targets: this.targets, driftScore: 0, penalty: this.penalty,
      rings: p.hits || 0,
      dnf: !p.finished,
      table: order.map((c, i) => ({ pos: i + 1, name: c.name, me: c.isPlayer, time: c.finished ? fmtT(c.finishTime) : '+' + Math.max(1, Math.round((this.track.length * this.cfg.laps - c.progress) / Math.max(c.v.speed, 20))) + 's' })),
    });
  }

  dispose() {
    for (const r of this.rings || []) this.scene.remove(r.mesh, r.beam);
    super.dispose();
  }
}
