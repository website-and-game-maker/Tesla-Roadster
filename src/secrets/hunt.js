// The in-race half of the secrets system: puts this world's three secrets next to the
// track, notices when the player's car touches one, runs the challenge that belongs to it,
// feeds the radar, and draws the jet trail.
//
// It only reads the race (player position, jet state, the track sampler) and adds its own
// objects to the scene, so it works with any HopRace without the race knowing about it.
import * as THREE from 'three';
import { SECRETS, CHALLENGES } from './defs.js';
import { buildProp } from './props.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Mirrors the jet tank in src/game/hopRace.js; only used to size challenges to what one burn can do.
const TANK_BURN = 1.4;
const TOUCH_R = 3.4;       // how close the car has to get to a secret
const SPARK_R = 3.4;
const SPARK_H = [1, 5, 1, 7, 1, 5];
const SPARK_LAT = [0, 0.45, -0.45, 0, 0.5, -0.3];

/** What one full tank does from a standing hop: highest point and time in the air. */
export function hopEnvelope(g, jetUp, speed = 35) {
  let y = 0.05, vy = 2.5, fuel = 1, t = 0, apex = 0;
  const dt = 1 / 120, glide = Math.exp(-dt * 0.6 * clamp(speed / 35, 0.2, 1));
  while (y > 0 && t < 30) {
    const firing = fuel > 0;
    if (firing) { fuel -= dt / TANK_BURN; vy += jetUp * dt; }
    vy -= g * dt;
    if (!firing && vy < 0) vy *= glide;
    y += vy * dt; t += dt; apex = Math.max(apex, y);
  }
  return { apex, air: t };
}

function segDist(ax, ay, az, bx, by, bz, px, py, pz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py, az + dz * t - pz);
}

let glintTex = null;
function glintTexture() {
  if (glintTex) return glintTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,240,190,.85)'); gr.addColorStop(1, 'rgba(255,220,120,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(31, 2, 2, 60); x.fillRect(2, 31, 60, 2);
  glintTex = new THREE.CanvasTexture(cv);
  return glintTex;
}

export class Hunt {
  constructor(sys, race) {
    this.sys = sys; this.race = race;
    this.worldId = race.cfg.worldId;
    this.huntMode = race.kind === 'freeflight' && !race.online; // no clock: challenges can run here
    this.items = [];
    this.ch = null;          // active challenge
    this.t = 0;
    this.last = null;
    this.group = new THREE.Group(); this.group.name = 'secrets';
    race.scene.add(this.group);
    const env = hopEnvelope(race.g || 9.81, race.jetUp || 22);
    this.apex = env.apex; this.airMax = env.air;
    for (const def of SECRETS[this.worldId] || []) this.items.push(this.place(def));
    this.buildTrail();
    this.refresh();
    if (this.huntMode) race.offTrackGrace = 600; // free roam: never hurry the player back
  }

  // ------------------------------------------------------------------ placement
  tierSpot(def) {
    const tr = this.race.track;
    if (def.tier === 'high') return { lat: def.side * tr.roadHalf * 0.3, h: clamp(this.apex * 0.58, 8, 16) };
    // 'wall' sits just outside the track fence, above the 9 m the fence stops, so it takes a real burn.
    if (def.tier === 'wall') return { lat: def.side * (tr.wallHalf + 2.5), h: clamp(this.apex * 0.42, 10.5, 12) };
    return { lat: def.side * (tr.roadHalf + 1.2), h: 4.6 };
  }

  /** Can a secret sit at track distance d? Not on the grid, over a gap, inside a ring or in rock. */
  spotOk(d, lat, h) {
    const r = this.race, tr = r.track, L = tr.length;
    if (d < 90 || d > L - 70) return false;
    if (r.gapAt) for (let a = -40; a <= 60; a += 10) if (r.gapAt(d + a)) return false;
    for (const ring of r.rings || []) { const o = Math.abs(ring.dist - d); if (Math.min(o, L - o) < 35) return false; }
    if (Math.abs(tr.curvatureAt(d)) > 0.012) return false;
    const p = tr.pointAt(d, lat, {});
    const ground = r.groundAt ? r.groundAt(p.x, p.z) : p.y;
    if (Number.isFinite(ground) && ground > p.y + h - 2.5) return false; // buried in a hillside
    // the centre line of another stretch of road must not pass close by (bridges, hairpins)
    const near = tr.locate(p.x, p.z, -1, {});
    const off = Math.abs(near.dist - d);
    return Math.min(off, L - off) < 30;
  }

  place(def) {
    const r = this.race, tr = r.track, L = tr.length;
    const { lat, h } = this.tierSpot(def);
    let d = def.at * L, ok = false;
    for (let k = 0; k < 80 && !ok; k++) { ok = this.spotOk(d, lat, h); if (!ok) d = (d + 9) % L; }
    if (!ok) d = def.at * L; // nowhere perfect: keep the authored spot rather than lose the secret
    const p = tr.pointAt(d, lat, {});
    const pos = new THREE.Vector3(p.x, p.y + h, p.z);
    const prop = buildProp({ ...def, world: this.worldId });
    const holder = new THREE.Group(); holder.position.copy(pos); holder.rotation.y = p.yaw + Math.PI;
    prop.object.scale.setScalar(1.25);
    const inner = new THREE.Group(); inner.add(prop.object); holder.add(inner);
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTexture(), color: 0xffe9a8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glint.scale.setScalar(2.2); holder.add(glint);
    const ground = Math.min(p.y, r.groundAt ? r.groundAt(p.x, p.z) : p.y);
    const beamH = h + 70 + (p.y - ground);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, beamH, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    beam.position.set(pos.x, ground + beamH / 2, pos.z);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: 0x4dff9a, transparent: true, opacity: 0.9 }));
    halo.rotation.x = Math.PI / 2; holder.add(halo);
    this.group.add(holder, beam);
    return { def, dist: d, lat, h, pos, prop, holder, glint, beam, halo, cool: 0 };
  }

  /** Show each secret the way its state calls for: hidden glint, hunter beam, challenge beacon, done. */
  refresh() {
    const s = this.sys;
    for (const it of this.items) {
      const found = s.isFound(it.def.id), done = s.isDone(it.def.id), hunter = s.hunter;
      it.found = found; it.done = done;
      it.todo = hunter && (!found || (this.huntMode && !done)); // worth pointing the radar at
      it.glint.visible = !found;
      it.halo.visible = done;
      it.beam.visible = it.todo;
      it.beam.material.color.setHex(found ? 0x35e8ff : 0xffd76a);
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const r = this.race, c = r.player, v = c.v, J = c.jet;
    if (!J) return;
    this.t += dt;
    const px = v.x, py = v.y + 0.6, pz = v.z;
    const a = this.last || { x: px, y: py, z: pz };
    const jumped = Math.hypot(px - a.x, pz - a.z) > 30; // respawn or reset: not a flight path
    const active = r.state === 'race' || (r.state === 'finished' && !this.huntMode);
    for (const it of this.items) {
      it.prop.update(this.t + it.dist);
      it.glint.material.opacity = 0.35 + 0.65 * Math.abs(Math.sin(this.t * 2.1 + it.dist));
      it.glint.material.rotation = this.t * 0.6;
      if (it.beam.visible) it.beam.material.opacity = 0.2 + 0.12 * Math.sin(this.t * 3 + it.dist);
      if (it.halo.visible) it.halo.rotation.z = this.t;
      if (it.cool > 0) it.cool -= dt;
      if (!active || jumped || it.cool > 0) continue;
      const d = segDist(a.x, a.y, a.z, px, py, pz, it.pos.x, it.pos.y, it.pos.z);
      if (d <= TOUCH_R) this.touch(it);
    }
    this.last = { x: px, y: py, z: pz };
    if (this.ch) this.updateChallenge(dt, a, jumped);
    this.updateTrail(dt);
    this.sys.overlay.radar(this.radar());
  }

  touch(it) {
    const s = this.sys;
    it.cool = 4;
    if (!it.found) {
      s.find(it.def, { challengeNext: this.huntMode && s.hunter });
      this.pulse(it);
      this.refresh();
      if (this.huntMode && s.hunter) this.startChallenge(it, 4.5);
    } else if (this.huntMode && s.hunter && !it.done && !this.ch) {
      this.pulse(it);
      this.startChallenge(it, 3);
    }
  }

  pulse(it) { it.pulseT = 0.6; this.race.vibrate && this.race.vibrate(40); }

  // ------------------------------------------------------------------ challenges
  challengeConfig(it) {
    const type = it.def.challenge, tr = this.race.track;
    if (type === 'skyhigh') return { height: Math.max(6, Math.round(this.apex * 0.8)), limit: 25 };
    if (type === 'glide') return { seconds: Math.round(this.airMax * 0.72 * 10) / 10, limit: 30 };
    if (type === 'bullseye') return { ahead: 230, radius: 5.5, limit: 28 };
    return { count: SPARK_H.length, first: 130, gap: 50, limit: Math.round((130 + SPARK_H.length * 50) / 20 + 10), roadHalf: tr.roadHalf };
  }

  startChallenge(it, ready = 3) {
    this.endChallengeVisuals();
    const type = CHALLENGES[it.def.challenge] ? it.def.challenge : 'sparks';
    const cfg = this.challengeConfig(it), tr = this.race.track;
    const ch = { it, type, cfg, ready, wait: 12, t: cfg.limit, got: 0, air: 0, best: 0, objs: [], state: 'ready' };
    if (type === 'sparks') {
      const geo = new THREE.OctahedronGeometry(0.7, 0);
      for (let i = 0; i < cfg.count; i++) {
        const p = tr.pointAt(it.dist + cfg.first + i * cfg.gap, SPARK_LAT[i] * cfg.roadHalf, {});
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: SPARK_H[i] > 2 ? 0xffc94d : 0x35e8ff, transparent: true, opacity: 0.95, fog: false }));
        m.position.set(p.x, p.y + SPARK_H[i] + 0.6, p.z);
        this.group.add(m); ch.objs.push({ mesh: m, got: false });
      }
    } else if (type === 'bullseye') {
      const p = tr.pointAt(it.dist + cfg.ahead, 0, {});
      const g = new THREE.Group(); g.position.set(p.x, p.y + 0.12, p.z);
      for (const [r0, r1, col, op] of [[cfg.radius - 0.5, cfg.radius, 0xffc94d, 0.95], [cfg.radius * 0.5 - 0.3, cfg.radius * 0.5, 0xffffff, 0.8], [0, 0.7, 0xff4d6d, 0.9]]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        ring.rotation.x = -Math.PI / 2; g.add(ring);
      }
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 40, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
      post.position.y = 20; g.add(post);
      this.group.add(g); ch.objs.push({ mesh: g });
      ch.target = { x: p.x, z: p.z, dist: (it.dist + cfg.ahead) % tr.length };
    }
    this.ch = ch;
    this.sys.audio('confirm');
    this.showChallenge();
  }

  endChallengeVisuals() {
    if (!this.ch) return;
    for (const o of this.ch.objs) { this.group.remove(o.mesh); o.mesh.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } }); }
    this.ch.objs = [];
  }

  onRoad() {
    const c = this.race.player, tr = this.race.track;
    return !c.jet.air && Math.abs(c.info.lat) <= tr.roadHalf + 1.5;
  }

  updateChallenge(dt, a, jumped) {
    const ch = this.ch, r = this.race, c = r.player, v = c.v, J = c.jet, cfg = ch.cfg;
    if (ch.state === 'ready') {
      ch.ready -= dt; ch.wait -= dt;
      // the clock only starts once the car is back on the road (some secrets drop you outside the fence)
      if (ch.ready <= 0 && (this.onRoad() || ch.wait <= 0)) { ch.state = 'run'; ch.air = 0; ch.wasAir = J.air; this.sys.audio('go'); }
      this.showChallenge(); return;
    }
    if (ch.state === 'failed' || ch.state === 'won') {
      ch.t -= dt;
      if (ch.state === 'failed' && this.sys.retryPressed()) { this.retry(); return; }
      if (ch.t <= 0) { this.endChallengeVisuals(); this.ch = null; this.sys.overlay.challenge(null); }
      return;
    }
    ch.t -= dt;
    let won = false;
    if (ch.type === 'sparks') {
      for (const o of ch.objs) {
        if (o.got) continue;
        o.mesh.rotation.y += dt * 3; o.mesh.rotation.x += dt * 1.3;
        const p = o.mesh.position;
        if (!jumped && segDist(a.x, a.y, a.z, v.x, v.y + 0.6, v.z, p.x, p.y, p.z) <= SPARK_R) {
          o.got = true; o.mesh.visible = false; ch.got++;
          this.sys.audio('ring', ch.got); r.vibrate && r.vibrate(20);
        }
      }
      won = ch.got >= cfg.count;
    } else if (ch.type === 'skyhigh') {
      const alt = Math.max(0, v.y - c.info.y);
      ch.best = Math.max(ch.best, alt); ch.got = Math.min(cfg.height, Math.round(alt));
      won = alt >= cfg.height;
    } else if (ch.type === 'glide') {
      ch.air = J.air ? ch.air + dt : 0;
      ch.best = Math.max(ch.best, ch.air); ch.got = ch.air;
      won = ch.air >= cfg.seconds;
    } else if (ch.type === 'bullseye') {
      const tg = ch.target, o = ch.objs[0];
      if (o) o.mesh.children[0].scale.setScalar(1 + Math.sin(this.t * 5) * 0.04);
      if (ch.wasAir && !J.air && !jumped) {
        const off = Math.hypot(v.x - tg.x, v.z - tg.z);
        if (off <= cfg.radius) won = true;
        else if (off < 60) r.flash(off < cfg.radius + 6 ? 'SO CLOSE' : 'MISSED THE CIRCLE');
      }
      const L = r.track.length, past = (c.info.dist - tg.dist + L) % L;
      if (!won && !J.air && past > 70 && past < L / 2) ch.t = Math.min(ch.t, 0); // drove past it
    }
    ch.wasAir = J.air;
    if (won) this.win();
    else if (ch.t <= 0) this.fail();
    else this.showChallenge();
  }

  win() {
    const ch = this.ch;
    ch.state = 'won'; ch.t = 4;
    this.endChallengeVisuals();
    this.sys.complete(ch.it.def);
    this.refresh();
    this.sys.overlay.challenge(null);
  }

  fail() {
    const ch = this.ch;
    ch.state = 'failed'; ch.t = 12;
    this.sys.audio('back');
    this.showChallenge();
  }

  /** Put the car back on the road a little before the secret and run the challenge again. */
  retry() {
    const ch = this.ch; if (!ch) return;
    const r = this.race, c = r.player, tr = r.track, it = ch.it;
    const p = tr.pointAt(it.dist - 110, 0, {});
    tr.locate(p.x, p.z, -1, c.info);
    r.resetCar(c); // the race's own reset keeps it clear of gaps
    const J = c.jet; J.air = false; J.vy = 0; J.firing = false; J.fuel = 1;
    c.v.y = r.groundUnder ? r.groundUnder(c) : c.info.y;
    c.prevD = c.info.dist; c.prevDist = c.info.dist;
    this.last = null; it.cool = 0.2;
    this.startChallenge(it, 2.5);
  }

  showChallenge() {
    const ch = this.ch; if (!ch) return;
    const C = CHALLENGES[ch.type], cfg = ch.cfg;
    let progress = '', frac = 0;
    if (ch.type === 'sparks') { progress = `${ch.got} / ${cfg.count} sparks`; frac = ch.got / cfg.count; }
    else if (ch.type === 'skyhigh') { progress = `${ch.got} / ${cfg.height} m`; frac = ch.got / cfg.height; }
    else if (ch.type === 'glide') { progress = `${ch.got.toFixed(1)} / ${cfg.seconds.toFixed(1)} s in the air`; frac = ch.got / cfg.seconds; }
    else progress = 'Land in the circle';
    this.sys.overlay.challenge({
      state: ch.state, name: C.name, secret: ch.it.def.name, goal: C.goal(cfg), progress, frac: clamp(frac, 0, 1),
      time: Math.max(0, ch.t), limit: cfg.limit,
      ready: ch.state === 'ready' ? (ch.ready > 0 ? Math.ceil(ch.ready) : 0) : null,
      offRoad: ch.state === 'ready' && ch.ready <= 0,
    });
  }

  // ------------------------------------------------------------------ radar
  radar() {
    const s = this.sys;
    if (!s.hunter || !this.items.length) return null;
    const r = this.race, c = r.player, v = c.v, L = r.track.length;
    const found = this.items.filter((i) => i.found).length, done = this.items.filter((i) => i.done).length;
    const counts = { found, done, total: this.items.length, hunt: this.huntMode };
    if (this.ch && this.ch.state !== 'won') return { ...counts, busy: true };
    let best = null, bestD = Infinity;
    for (const it of this.items) {
      if (!it.todo) continue;
      const ahead = (it.dist - c.info.dist + L) % L; // next one coming up along the lap
      if (ahead < bestD) { bestD = ahead; best = it; }
    }
    if (!best) return { ...counts, clear: true };
    const dx = best.pos.x - v.x, dz = best.pos.z - v.z;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    // angle from the car's nose, clockwise positive (to the right)
    const angle = Math.atan2(dx * fz - dz * fx, dx * fx + dz * fz);
    return {
      ...counts, dist: Math.hypot(dx, dz), ahead: bestD, angle, up: best.pos.y - (v.y + 0.6),
      known: best.found, name: best.found ? best.def.name : '', tier: best.def.tier, side: best.def.side,
    };
  }

  // ------------------------------------------------------------------ jet trail
  buildTrail() {
    const N = 120;
    this.trail = { N, i: 0, life: new Float32Array(N), vel: new Float32Array(N * 3), base: new Float32Array(N * 3), acc: 0 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.75, map: glintTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    pts.frustumCulled = false; pts.visible = false;
    this.trail.pts = pts; this.group.add(pts);
  }

  updateTrail(dt) {
    const T = this.trail, colors = this.sys.trailColors();
    if (!colors) { T.pts.visible = false; return; }
    T.pts.visible = true;
    const c = this.race.player, v = c.v, J = c.jet;
    const pos = T.pts.geometry.attributes.position, col = T.pts.geometry.attributes.color;
    const on = (J.air || v.boosting) && v.speed > 6;
    T.acc += on ? dt * 70 : 0;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), tmp = this._tc || (this._tc = new THREE.Color());
    while (T.acc >= 1) {
      T.acc -= 1;
      const i = T.i; T.i = (T.i + 1) % T.N;
      const side = (Math.random() - 0.5) * 1.5;
      pos.setXYZ(i, v.x - fx * 2.1 - fz * side, v.y + 0.45 + Math.random() * 0.25, v.z - fz * 2.1 + fx * side);
      T.vel[i * 3] = (Math.random() - 0.5) * 1.2; T.vel[i * 3 + 1] = 0.4 + Math.random() * 1.2; T.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      tmp.setHex(colors[(Math.random() * colors.length) | 0]);
      T.base[i * 3] = tmp.r; T.base[i * 3 + 1] = tmp.g; T.base[i * 3 + 2] = tmp.b;
      T.life[i] = 1;
    }
    for (let i = 0; i < T.N; i++) {
      if (T.life[i] <= 0) continue;
      T.life[i] = Math.max(0, T.life[i] - dt * 1.1);
      const k = T.life[i] * T.life[i];
      pos.setXYZ(i, pos.getX(i) + T.vel[i * 3] * dt, pos.getY(i) + T.vel[i * 3 + 1] * dt, pos.getZ(i) + T.vel[i * 3 + 2] * dt);
      col.setXYZ(i, T.base[i * 3] * k, T.base[i * 3 + 1] * k, T.base[i * 3 + 2] * k);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  }

  dispose() {
    this.endChallengeVisuals();
    for (const it of this.items) it.prop.dispose();
    this.group.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite) && o.material) { o.geometry && o.geometry.dispose(); o.material.dispose(); } });
    this.race.scene.remove(this.group);
    this.sys.overlay.radar(null); this.sys.overlay.challenge(null);
  }
}
