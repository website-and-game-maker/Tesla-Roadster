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
import { Coach } from './coach.js';
import { Race } from './race.js';
import { AIDriver } from './ai.js';
import { dustFor } from './effects.js';
import { collideCars } from '../physics/vehicle.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const AIR_ENV = { grip: 0.55, rolling: 0 };
const FENCE_H = 16;      // the track's energy fence stops you up to this height: leaving takes a deliberate full burn
const STEP_UP = 0.5;     // off the track, ground rising more than this in one step is a wall (cliff, rock, building)
const DROP = 0.4;        // ...and ground falling away more than this means you are in the air
const TANK_BURN = 1.4;   // seconds of full burn per tank
const TANK_FILL = 2.6;   // seconds on the road to refill from empty
const RING_FUEL = 0.45;  // tank refill per ring
const RING_R = 4;        // ring radius: a reward you have to aim for, not a gate you are owed
const RING_KICK = 7;     // m/s shove forward for threading a ring
const RING_BONUS = 1.5;  // Ring Trial: seconds taken off the clock per ring
const IDLE = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
const fmtT = (t) => { if (t == null) return '--'; const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`; };

const TUTORIAL = [
  { id: 'drive', text: 'Hold W (or GO) to drive. Steer with A / D or ← / →.', key: 'W', touch: 'Hold GO, and drag on the left to steer.', done: (r) => r.player.v.speed > 22 },
  { id: 'jet', text: 'Fire the jets: hold Space to hop. A tap is a short hop, holding flies higher.', key: 'Space', touch: 'Hold JET to hop. A tap is a short hop.', done: (r) => r.tut.hops >= 2 },
  { id: 'ring', text: 'Jet through a glowing ring. Rings are a bonus: jet fuel and a burst of speed.', key: 'Space', touch: 'Hold JET as you reach the ring.', done: (r) => r.tut.rings >= 1 },
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
    this.penalty = 0; this.bonus = 0;
    this.tut = { step: 0, hops: 0, rings: 0, landings: 0, boostT: 0 };
    const wd = (game.worlds || []).find((w) => w.id === cfg.worldId);
    this.worldMode = wd && wd.modes && wd.modes.includes('hop') ? 'hop' : 'ground';
    this.skyWorld = !!(wd && wd.modes && !wd.modes.includes('ground')); // road in the sky: off the road means falling
  }

  build() {
    super.build();
    const g = this.game, w = this.world;
    // low-gravity worlds still float, but hops stay hops (real moon gravity gives 12 s hangs)
    this.g = Math.max(w.gravity || 9.81, 5.5);
    this.jetUp = this.g + Math.max(1.25 * this.g, 6); // net climb ~12 m/s² on Earth, floatier on the Moon
    this.groundAt = typeof w.getGroundHeight === 'function' ? (x, z) => w.getGroundHeight(x, z) : null;
    // The sampler's heights come from the ground, which drops away over gaps. Use the road
    // deck instead, so "fell below the road" and altitude work across a gap too.
    if (typeof w.getTrackInfo === 'function') {
      const tr = this.track, ti = {};
      for (let i = 0; i < tr.n; i++) {
        w.getTrackInfo(tr.px[i], tr.pz[i], -1, ti);
        if (Number.isFinite(ti.height)) tr.py[i] = ti.height;
      }
    }
    for (const c of this.cars) {
      c.jet = { fuel: 1, vy: 0, air: false, firing: false, airT: 0, flight: 0 };
      c.ringI = 0; c.prevD = c.info.dist;
    }
    this.buildRings();
    g.ui.hud.setMode && g.ui.hud.setMode('flight');
    if (this.kind === 'tutorial') this.showTutorial();
    this.coach = Coach.wanted(g, this) ? new Coach(this, 'hop') : null;
  }

  /** Metres along the road to the player's next ring. */
  ringAhead() {
    if (!this.rings.length) return Infinity;
    const L = this.track.length, r = this.rings[this.nextRingIndex(this.player.info.dist)];
    return (r.dist - this.player.info.dist + L) % L;
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
        const info = tr.locate(r.position.x, r.position.z, r.u != null ? Math.round(r.u * tr.n) % tr.n : -1, {});
        rings.push({ dist: info.dist, lat: info.lat, position: r.position.clone(), tx: info.tx, tz: info.tz, radius: this.kind === 'tutorial' ? 6 : Math.min(r.radius || RING_R, RING_R + 0.5) });
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
        const h = 6 + rnd() * 6;
        rings.push({ dist: d, lat, position: new THREE.Vector3(p.x, p.y + h, p.z), tx: Math.sin(p.yaw), tz: Math.cos(p.yaw), radius: this.kind === 'tutorial' ? 6 : RING_R }); // roomy while learning
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
    // "JET" chevrons painted on the road where you should fire for the next ring
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
    const x = cv.getContext('2d');
    x.strokeStyle = '#35e8ff'; x.lineWidth = 26; x.lineJoin = 'miter';
    for (let k = 0; k < 3; k++) { const y0 = 150 + k * 120; x.globalAlpha = 1 - k * 0.25; x.beginPath(); x.moveTo(36, y0); x.lineTo(128, y0 - 80); x.lineTo(220, y0); x.stroke(); }
    x.globalAlpha = 1; x.fillStyle = '#eaffff'; x.font = '900 86px system-ui, sans-serif'; x.textAlign = 'center'; x.fillText('JET', 128, 492);
    const mt = new THREE.CanvasTexture(cv); mt.anisotropy = 4;
    this.jetMarkMat = new THREE.MeshBasicMaterial({ map: mt, transparent: true, depthWrite: false, opacity: 1, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    // long, because you see it at a grazing angle from the driver's seat
    const mg = new THREE.PlaneGeometry(9, 30); mg.rotateX(-Math.PI / 2); mg.rotateY(Math.PI); // lies flat, chevrons point along +z
    this.jetMark = new THREE.Mesh(mg, this.jetMarkMat); this.jetMark.renderOrder = 2; this.jetMark.visible = false;
    // two light posts at the road edges make the take-off line readable from far away
    const postGeo = new THREE.CylinderGeometry(0.14, 0.14, 3.2, 8); postGeo.translate(0, 1.6, 0);
    const postMat = new THREE.MeshBasicMaterial({ color: 0x35e8ff, transparent: true, opacity: 0.9, fog: false });
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(postGeo, postMat); post.position.set(sx * (this.track.roadHalf + 0.4), 0, 0); this.jetMark.add(post); }
    this.scene.add(this.jetMark);
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
    if (this.jetMark && next !== this.nextRing) {
      const r = this.rings[next];
      // far enough back to climb to the ring at racing speed
      const d = r.dist - (42 + (r.position.y - this.track.pointAt(r.dist, 0, {}).y) * 2.2);
      const m = this.track.pointAt(d, 0, {});
      this.jetMark.visible = !this.gapAt(d);
      this.jetMark.position.set(m.x, (this.groundAt ? this.groundAt(m.x, m.z) : m.y) + 0.05, m.z);
      this.jetMark.rotation.y = m.yaw;
    }
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
      const hit = Math.hypot(dx, dy, dz) <= r.radius; // you have to actually thread it
      if (hit) {
        // the reward: jet fuel, Overdrive charge and a shove forward
        c.jet.fuel = Math.min(1, c.jet.fuel + RING_FUEL);
        v.boost = Math.min(v.stats.boostCap, v.boost + 0.2);
        const kick = Math.min(RING_KICK, Math.max(0, v.stats.vmax * 1.2 - v.speed));
        v.vx += Math.sin(v.yaw) * kick; v.vz += Math.cos(v.yaw) * kick;
      }
      if (this.onRing) this.onRing(c, i, hit); // test/telemetry hook
      if (c.isPlayer) this.playerRing(i, hit);
    }
  }

  playerRing(i, hit) {
    const p = this.player, g = this.game;
    if (this.coach) this.coach.event('ring', hit);
    p.ringDone = p.ringDone || new Set();
    if (hit) {
      if (p.ringDone.has(i)) return; // already counted this lap
      p.ringDone.add(i); p.hits++;
      p.combo = (p.comboT > 0 ? (p.combo || 0) : 0) + 1; p.comboT = 9;
      g.audio.ui('ring', p.combo);
      if (this.kind === 'ringtrial' && this.state === 'race') { this.bonus += RING_BONUS; this.raceTime = Math.max(p.lapStart, this.raceTime - RING_BONUS); }
      this.flash(p.combo >= 3 ? `RING COMBO ×${p.combo}` : this.kind === 'ringtrial' ? `RING · −${RING_BONUS}s` : 'RING · JETS + SPEED');
      this.ringFlash = { ring: this.rings[i], t: 0.5 };
      this.tut.rings++;
      this.vibrate(25);
    } else p.combo = 0; // rings are a bonus: missing one costs nothing and nobody nags you about it
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
        if (!c.ai) c.ai = new AIDriver(v, tr, { skill: 0.95, lane: 0, seed: 7, persona: 'neutral' });
        if (!c.isPlayer && this.kind === 'ringrace') this.aiPack(c);
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
      if (J.air) { env = AIR_ENV; c.offRoad = false; } // a little air control from the thrusters
      else env = this.surfaceEnv(c);
      v.step(dt, drive, env);
      tr.locate(v.x, v.z, J.air ? -1 : c.info.i, c.info);
      this.jetStep(c, racing && jet, dt);
      if (c.respawned) { c.respawned = false; continue; }
      this.fence(c, dt, racing);
      if (c.respawned) { c.respawned = false; continue; }
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

  /**
   * The track corridor. Rails and an energy fence above them keep cars in up to FENCE_H, on the
   * ground and in the air, so a hop that drifts wide slides along the fence instead of dumping
   * you in the scenery. Clear it with a full burn and you are off track for real: you drive on
   * the terrain (see terrainStep), the fence lets you back in from outside, and in a race you
   * have a few seconds before being put back.
   */
  fence(c, dt, racing) {
    const tr = this.track, v = c.v, J = c.jet;
    const lim = tr.wallHalf - 1.0, a = Math.abs(c.info.lat), alt = v.y - c.info.y;
    if (!c.outside) {
      if (a <= lim) return;
      if (alt >= FENCE_H) { if (a > lim + 1.5) { c.outside = true; c.outT = 0; } return; }
      const sgn = Math.sign(c.info.lat), nx = sgn * c.info.nx, nz = sgn * c.info.nz;
      if (J.air && alt > 1.2) {
        // the fence: push back and slide along it, no crash
        const depth = a - lim, vn = v.vx * nx + v.vz * nz;
        v.x -= nx * depth; v.z -= nz * depth;
        if (vn > 0) { v.vx -= 1.15 * vn * nx; v.vz -= 1.15 * vn * nz; if (c.isPlayer && vn > 1.5) this.fenceHit(c, nx, nz); }
      } else v.collideWall(nx, nz, a - lim);
      tr.locate(v.x, v.z, c.info.i, c.info);
      return;
    }
    // outside
    if (a < lim - 0.5) { c.outside = false; c.outT = 0; return; }
    if (!racing) return;
    c.outT += dt;
    // The player is never pulled back: getting home is their job (or one press of reset). AI that strays is tidied up.
    if (!c.isPlayer && c.outT > 2.5) this.respawn(c, '');
  }

  /** A short flash of the fence where the player touched it. */
  fenceHit(c, nx, nz) {
    if (!this.fenceFx) {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
      const x = cv.getContext('2d'), gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, 'rgba(120,240,255,.9)'); gr.addColorStop(0.5, 'rgba(53,232,255,.35)'); gr.addColorStop(1, 'rgba(53,232,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
      x.strokeStyle = 'rgba(200,250,255,.55)'; x.lineWidth = 2;
      for (let i = 0; i <= 128; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
      x.globalCompositeOperation = 'destination-in'; x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
      const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, opacity: 0 });
      this.fenceFx = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), mat);
      this.scene.add(this.fenceFx);
    }
    const v = c.v, f = this.fenceFx;
    f.position.set(v.x + nx * 1.2, v.y + 0.8, v.z + nz * 1.2);
    f.rotation.set(0, Math.atan2(nx, nz), 0);
    f.material.opacity = 1;
    if (this.fenceT > 0.25) return; // one message per brush
    this.fenceT = 1.2;
    this.flash('TRACK BARRIER'); this.game.audio.ui('back'); this.vibrate(25);
    this.shake = Math.min(1, this.shake + 0.15);
  }

  /**
   * Driving on open terrain outside the fence. Returns false if the move was blocked.
   * Without this the car was glued to whatever height the terrain had under it: it snapped up
   * cliffs and down drops, which is what made off-track driving look broken.
   */
  terrainStep(c, gr, dt) {
    const v = c.v, J = c.jet, rise = gr - v.y;
    if (rise > STEP_UP) {
      // too steep to climb: stop against it and bounce back a little
      const sp = v.speed;
      v.x -= v.vx * dt; v.z -= v.vz * dt;
      v.vx *= -0.25; v.vz *= -0.25; v.yawRate *= 0.5;
      if (c.isPlayer && sp > 6) { v.impact = Math.max(v.impact, sp * 0.4); }
      this.track.locate(v.x, v.z, -1, c.info);
      return false;
    }
    if (rise < -DROP) { J.air = true; J.airT = 0; J.vy = Math.min(J.vy, 0); return true; } // drove off an edge: fall, don't teleport
    // hills: climbing costs speed, descending gives it back
    const sp = v.speed;
    if (sp > 0.5) {
      const grade = clamp(rise / (sp * dt), -0.6, 0.6), dv = -this.g * grade * dt;
      const k = Math.max(0, (sp + dv) / sp);
      v.vx *= k; v.vz *= k;
    }
    v.y = gr;
    return true;
  }

  jetStep(c, wantJet, dt) {
    const v = c.v, J = c.jet, gr = this.groundUnder(c);
    J.firing = wantJet && J.fuel > 0;
    if (J.firing) {
      J.fuel = Math.max(0, J.fuel - dt / TANK_BURN);
      if (!J.air) {
        // take off relative to the road: on a climb the road rises under you, so the jets
        // start from its vertical speed (otherwise an uphill take-off lands again every step)
        const rise = Math.max(0, (c.info.slope || 0) * (v.vF || v.speed || 0));
        J.air = true; J.airT = 0; v.y = gr + 0.05; J.vy = Math.max(J.vy, 2.5 + rise);
        if (c.isPlayer) this.tut.hops++;
        this.groundBlast(c, 0.6);
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
      // just lifted off with the jets lit: bumpy ground can't snatch the car back down
      if (J.firing && J.airT < 0.25 && v.y <= gr + 0.05) { v.y = gr + 0.05; J.vy = Math.max(J.vy, 0); }
      else if (v.y <= gr) {
        const impact = -J.vy;
        v.y = gr; J.vy = 0; J.air = false;
        this.surfaceEnv(c); // what we landed on (sets v.surface, c.offRoad)
        if (impact > 4) this.groundBlast(c, Math.min(1, impact / 20));
        if (c.isPlayer) {
          this.tut.landings++;
          this.game.audio.land && this.game.audio.land(impact, v.surface);
          if (impact > 22) { v.vx *= 0.55; v.vz *= 0.55; this.shake = 1; this.flash('HARD LANDING'); this.game.audio.collision(impact); this.vibrate(90); }
          else if (impact > 7) { this.shake = Math.min(1, this.shake + impact * 0.03); this.vibrate(30); }
        } else if (impact > 22) { v.vx *= 0.55; v.vz *= 0.55; }
      } else if (v.y < c.info.y - 12 && (!c.outside || this.skyWorld)) {
        this.respawn(c, 'FELL! Respawning');
      }
    } else {
      if (c.outside) this.terrainStep(c, gr, dt); else v.y = gr;
      // jets refill anywhere on the ground, but slower off the road
      J.fuel = Math.min(1, J.fuel + dt / (TANK_FILL * (c.outside || c.offRoad ? 1.6 : 1)));
    }
    v.vy = J.vy;
    v.airborne = J.air; v.jetFiring = J.firing; // read by Race's audio and tyre effects
  }

  /** A ring of dust (or road grit) kicked out from under the car: take-offs and landings. */
  groundBlast(c, strength) {
    const q = (this.game.quality && this.game.quality.preset) || {}, d = this.dust;
    if (!d || (q.particles ?? 1) < 0.3) return;
    const v = c.v, dust = c.offRoad && dustFor(v.surface, this.world);
    const color = dust ? (this.dustColor ?? dust.color) : 0xc9c6c0, n = Math.round((6 + 14 * strength) * (q.particles ?? 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 6 * strength;
      d.emit(v.x + Math.sin(a) * 1.2, v.y + 0.2, v.z + Math.cos(a) * 1.2, Math.sin(a) * sp + v.vx * 0.3, 0.6 + Math.random() * 1.5, Math.cos(a) * sp + v.vz * 0.3,
        { color, size: 0.6 + Math.random() * 0.6, life: 0.7 + Math.random() * 0.6, gravity: 1.5, grow: 3 });
    }
  }

  /** AI: line up under the next ring as it gets close. Each ring gets its own small aiming error. */
  aiAimLane(c) {
    if (!this.rings.length) return null;
    const L = this.track.length, ri = this.nextRingIndex(c.info.dist), r = this.rings[ri];
    const ahead = (r.dist - c.info.dist + L) % L;
    const A = this.aiAim(c, ri);
    if (ahead > A.reach || A.skip) return null;
    // blend from the racing line onto the ring's line over the run-up
    const w = clamp((A.reach - ahead) / (A.reach * 0.55), 0, 1);
    const lineLat = c.ai.line ? c.ai.line.lat[Math.floor(((r.dist % L) + L) % L / this.track.ds) % this.track.n] : 0;
    return lineLat + (r.lat + A.lat - lineLat) * w;
  }

  /**
   * This car's plan for ring ri, made once per ring: whether it goes for it at all, and how
   * far off its aim is. Better skill and a ring-focused persona: tighter aim, fewer skips.
   */
  aiAim(c, ri) {
    const ai = c.ai;
    if (ai.ringPlan && ai.ringPlan.i === ri) return ai.ringPlan;
    const P = ai.persona || { rings: 0.85 }, r = ai.rand || Math.random;
    const err = clamp((1.03 - ai.skill) * 9 * (1.35 - P.rings), 0, 3.5);
    const ring = this.rings[ri], roadY = this.track.pointAt(ring.dist, 0, {}).y;
    const gapRing = this.gapAt(ring.dist), climb = ring.position.y - roadY;
    // Rings cost time in the air, so only some rivals chase the high ones: ring-focused personas
    // take them all, racers often stay on the road. Rings over gaps are never optional.
    const skip = !gapRing && r() < clamp((climb - 6) / 7, 0, 1) * (1 - P.rings) * 2.2;
    ai.ringPlan = { i: ri, lat: (r() - 0.5) * 2 * err, dy: (r() - 0.5) * 2 * err * 0.6, reach: 130 + 90 * P.rings, skip, climb, gap: gapRing };
    return ai.ringPlan;
  }

  /**
   * AI jets. Three reasons to fire:
   *  1. a gap in the road ahead (never optional),
   *  2. the next ring: fire so the arc passes through it,
   *  3. a hop over traffic it can't get around (bold personas ask for this).
   */
  aiJet(c) {
    const L = this.track.length, J = c.jet, v = c.v, ai = c.ai;
    const sp = Math.max(v.speed, 8), roadY = c.info.y, alt = v.y - roadY;
    // 1. gaps: be up before the edge and stay up until we're over road again
    const gapAhead = this.aiGapAhead(c.info.dist, sp * 0.9 + 12);
    if (gapAhead && J.fuel > 0 && !J.air) return true;
    if (J.air && J.fuel > 0) {
      // where would we come down without the jets? Fire only if that's in a gap: landing short
      // of one is better (refill, then hop it from the road) than burning the tank to stay up.
      const land = this.aiLanding(c);
      const over = this.gapAt(c.info.dist + land) || this.gapAt(c.info.dist + land - 4);
      if (over && (J.vy < 1 || alt < 2)) return true;
    }
    // 3. hop over a car that's in the way
    const L0 = this.rings.length ? (this.rings[this.nextRingIndex(c.info.dist)].dist - c.info.dist + L) % L : Infinity;
    // optional jets (rings that aren't over a gap, hops) must leave enough to clear the next gap
    const gapNext = this.aiGapAhead(c.info.dist, 2000);
    const spare = (cost) => !gapNext || J.fuel - cost + gapNext.off / (sp * TANK_FILL) >= 0.65;
    if (ai && ai.wantHop > 0 && J.fuel > 0.7 && !gapAhead && L0 > 220 && spare(0.3)) {
      if (!J.air) return true;
      if (J.airT < 0.35) return true;
    }
    // 2. rings
    if (!this.rings.length) return false;
    const ri = this.nextRingIndex(c.info.dist), r = this.rings[ri];
    const ahead = (r.dist - c.info.dist + L) % L;
    if (ahead > 140) return false;
    const plan = ai ? this.aiAim(c, ri) : null;
    if (plan && plan.skip) return false;
    const t = ahead / sp;
    const want = r.position.y - 0.6 + (plan ? plan.dy : 0); // car origin is at the wheels
    const h = want - v.y;
    const net = this.jetUp - this.g;
    if (!J.air) {
      if (h < 1.5) return false;
      // burn time to reach the height, then coast up to it: start when that fits the time left
      const tBurn = Math.sqrt((2 * h) / (net * (1 + net / this.g)));
      const tUp = tBurn * (1 + net / this.g);
      // fastest: leave late and burn all the way up (least time in the air, where drag bleeds
      // speed). Short on fuel: leave earlier, burn briefly and coast up to it.
      const tFull = Math.sqrt((2 * h) / net);
      const late = J.fuel > tFull * 1.1 / TANK_BURN + 0.05;
      if (!(plan && plan.gap) && !spare((late ? tFull : tBurn) * 1.1 / TANK_BURN)) return false;
      // a ring over a gap: only climb for it with fuel left to cross; otherwise just hop the gap low
      if (plan && plan.gap && J.fuel < (late ? tFull : tBurn) * 1.1 / TANK_BURN + 0.35) return false;
      return t <= (late ? tFull * 1.1 : tUp * 1.1) && J.fuel > Math.min(0.9, tBurn / TANK_BURN + 0.1);
    }
    // in the air: ballistic prediction to the ring (the glide only slows the fall). A ring still
    // far off isn't worth holding altitude for: land, refill, and jump for it properly.
    if (t > 1.6) return false;
    if (plan && plan.gap ? J.fuel < 0.4 : !spare(0.1)) return false; // the gap rule above keeps us up
    const pred = v.y + J.vy * t - 0.5 * this.g * t * t;
    return pred < want && J.fuel > 0;
  }

  /** Metres along the track until car c touches down if it doesn't fire (glide included). */
  aiLanding(c) {
    const J = c.jet, g = this.g, sp = Math.max(c.v.speed, 1);
    let y = c.v.y - c.info.y, vy = J.vy, d = 0;
    const dt = 0.05, damp = Math.exp(-dt * 0.6 * clamp(sp / 35, 0.2, 1));
    for (let i = 0; i < 200 && y > 0; i++) {
      vy -= g * dt; if (vy < 0) vy *= damp;
      y += vy * dt; d += sp * dt;
    }
    return d;
  }

  /** The next gap within `range` metres ahead of track distance d, with its length. */
  aiGapAhead(d, range) {
    if (!this.gapList) {
      // gaps don't move: scan the lap once
      const L = this.track.length, list = [];
      let start = null;
      for (let s = 0; s < L + 4; s += 4) {
        const g = this.gapAt(s);
        if (g && start == null) start = s;
        if (!g && start != null) { list.push({ at: start, len: s - start }); start = null; }
      }
      this.gapList = list;
    }
    const L = this.track.length;
    for (const g of this.gapList) {
      const off = (g.at - d + L) % L;
      if (off <= range) return { off, len: g.len };
    }
    return null;
  }

  /**
   * Pack racing: a gentle, continuous pull towards the player so the race stays a race, plus
   * the final-lap flag (rivals spend their saved Overdrive). Never more than ±5%.
   */
  aiPack(c) {
    const gap = c.progress - this.player.progress;
    c.ai.rubber = clamp(1 - gap / 3000, 0.95, 1.05);
    c.ai.finalLap = c.crossings >= this.cfg.laps;
  }

  /** Is the road missing at track distance d (a gap you have to jet over)? */
  gapAt(d) {
    const w = this.world;
    if (typeof w.getTrackInfo !== 'function') return false;
    const p = this.track.pointAt(d, 0, this._gp || (this._gp = {}));
    return !!w.getTrackInfo(p.x, p.z, -1, this._gi || (this._gi = {})).gap;
  }

  /** Back on the road, far enough before any gap to get a run-up. */
  resetCar(c, dist) {
    let d = dist ?? c.info.dist;
    for (let back = 0; back < 600; back += 5) {
      let clear = true;
      for (let a = -10; a <= 70 && clear; a += 5) if (this.gapAt(d - back + a)) clear = false;
      if (clear) { d -= back; break; }
    }
    const p = this.track.pointAt(d, 0);
    c.v.place(p.x, p.y, p.z, p.yaw);
    this.track.locate(p.x, p.z, -1, c.info);
  }

  respawn(c, msg, dist) {
    this.resetCar(c, dist);
    const J = c.jet; J.air = false; J.vy = 0; J.firing = false; J.fuel = Math.max(J.fuel, 0.6);
    c.outside = false; c.outT = 0;
    c.v.y = this.groundUnder(c);
    c.prevD = c.info.dist;
    c.respawned = true;
    if (c.isPlayer) { this.flash(msg); this.shake = 0.6; this.vibrate(100); }
  }

  /** Back on the road with the jets reset (R, ↺, or automatically). */
  recover(msg = 'BACK ON THE ROAD') {
    if (this.state !== 'race' || this.player.finished) return;
    this.respawn(this.player, msg);
    this.player.prevDist = this.player.info.dist;
    this.player.wrongT = 0; this.lostT = 0; this.stuckT = 0;
  }

  manualReset() { this.recover(); }

  canAutoReset() { return !this.player.jet.air; }

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
      this.game.profile.tutorialDone = true; this.game.profile.coached = true; Coach.learnFromTutorial(this.game.profile); this.game.save();
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
    // jets: the burn and its cues (ignite, low, empty, refill, full) come from the audio engine
    const PJ = p.jet;
    if (PJ && g.audio.updateJet) {
      g.audio.updateJet({ firing: PJ.firing, fuel: PJ.fuel, wanted: this.state === 'race' && !this.autopilot && !!(inp && inp.handbrake), airborne: PJ.air, speed: p.v.speed }, dt);
    }
    // exhaust: hot grey smoke streaming back from the thrusters while they burn
    const qp = (g.quality && g.quality.preset && g.quality.preset.particles) ?? 1;
    if (this.dust && qp >= 0.3) for (const c of this.cars) {
      if (c.out || !c.jet || !c.jet.firing || Math.random() > qp * 0.9) continue;
      const v = c.v, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), s = Math.random() < 0.5 ? 1 : -1;
      const x = v.x - fx * 2.1 - fz * 0.5 * s, z = v.z - fz * 2.1 + fx * 0.5 * s;
      this.dust.emit(x, v.y + 0.55, z, v.vx * 0.4 - fx * 6 + (Math.random() - 0.5), -2 - Math.random() * 2, v.vz * 0.4 - fz * 6 + (Math.random() - 0.5),
        { color: Math.random() < 0.3 ? 0x9fc6ff : 0x8c8c90, size: 0.45 + Math.random() * 0.3, life: 0.5 + Math.random() * 0.4, gravity: -1.5, grow: 4 });
    }
    for (const c of this.cars) {
      if (c.out || !c.jet) continue;
      const J = c.jet, v = c.v, o = c.model.object, m = c.model;
      J.flight += ((J.air ? 1 : 0) - J.flight) * Math.min(1, dt * 6);
      m.setFlight && m.setFlight(J.flight);
      m.setThrust && m.setThrust(J.firing ? 1 : J.air ? 0.15 : 0);
      if (J.air) {
        const sp = Math.max(v.speed, 5);
        o.rotation.set(clamp(-Math.atan2(J.vy, sp) * 0.7, -0.5, 0.5), v.yaw, clamp(-v.yawRate * 0.25, -0.5, 0.5), 'YXZ');
        c.tiltX = o.rotation.x; c.tiltZ = o.rotation.z;
      } else if (c.outside && this.groundAt) {
        // sit on the terrain: pitch and roll from the ground under the nose, tail and sides
        const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), G = this.groundAt;
        const pitch = -Math.atan2(G(v.x + fx * 1.4, v.z + fz * 1.4) - G(v.x - fx * 1.4, v.z - fz * 1.4), 2.8);
        const roll = Math.atan2(G(v.x - fz * 0.9, v.z + fx * 0.9) - G(v.x + fz * 0.9, v.z - fx * 0.9), 1.8);
        const k = Math.min(1, dt * 10);
        c.tiltX = (c.tiltX || 0) + (clamp(pitch, -0.6, 0.6) - (c.tiltX || 0)) * k;
        c.tiltZ = (c.tiltZ || 0) + (clamp(roll, -0.6, 0.6) - (c.tiltZ || 0)) * k;
        o.rotation.set(c.tiltX, v.yaw, c.tiltZ, 'YXZ');
      } else { c.tiltX = 0; c.tiltZ = 0; }
    }
    if (this.fenceT > 0) this.fenceT -= dt;
    if (this.fenceFx && this.fenceFx.material.opacity > 0) this.fenceFx.material.opacity = Math.max(0, this.fenceFx.material.opacity - dt * 2.2);
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
    if (!behind && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) return null; // on screen: the ring marker covers it
    let x = v.x, y = v.y; if (behind) { x = -x; y = -y; }
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  /** On-screen marker over the next ring: screen position (-1..1) and distance in metres. */
  nextRingMark() {
    const r = this.rings[this.nextRing ?? 0];
    if (!r || this.state === 'intro') return null;
    const v = this.player.v;
    const dist = Math.hypot(r.position.x - v.x, r.position.y - v.y, r.position.z - v.z);
    if (dist < 18) return null;
    const s = r.position.clone(); s.y += r.radius * 1.25;
    s.project(this.camera);
    if (s.z > 1 || Math.abs(s.x) > 1 || Math.abs(s.y) > 1) return null;
    return { x: s.x, y: s.y, dist: Math.round(dist) };
  }

  hudData() {
    const d = super.hudData(), p = this.player, J = p.jet, v = p.v;
    const total = this.rings.length, hit = p.ringDone ? p.ringDone.size : 0;
    let extra = d.extra;
    if (this.kind === 'tutorial' && this.tutText) extra = this.tutText;
    if (this.kind === 'ringtrial' && this.bonus) extra = `${extra}${extra ? ' · ' : ''}RING BONUS −${this.bonus.toFixed(1)}s`;
    let note = d.note;
    if (!note && J.air && J.fuel <= 0.01) note = 'GLIDING';
    else if (!note && !J.air && J.fuel < 0.25) note = 'JETS REFILLING';
    if (p.outside && this.state === 'race' && !note) note = 'OFF TRACK';
    return {
      ...d,
      mode: 'flight',
      airspeedKmh: d.speedKmh,
      altitude: Math.max(0, Math.round(v.y - this.groundUnder(p))),
      rings: { hit, total, next: Math.min(total, (this.nextRing ?? 0) + 1) },
      nextRingDir: this.nextRingDir(),
      nextRingMark: this.nextRingMark(),
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
      bestLap: p.bestLap, totalTime: p.finishTime, targets: this.targets, driftScore: 0, penalty: this.penalty, ringBonus: this.bonus,
      rings: p.hits || 0,
      dnf: !p.finished,
      table: order.map((c, i) => ({ pos: i + 1, name: c.name, me: c.isPlayer, time: c.finished ? fmtT(c.finishTime) : '+' + Math.max(1, Math.round((this.track.length * this.cfg.laps - c.progress) / Math.max(c.v.speed, 20))) + 's' })),
    });
  }

  dispose() {
    for (const r of this.rings || []) this.scene.remove(r.mesh, r.beam);
    if (this.jetMark) this.scene.remove(this.jetMark);
    if (this.fenceFx) this.scene.remove(this.fenceFx);
    super.dispose();
  }
}
