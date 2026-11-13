// Game shell: renderer, adaptive quality, showroom (menu background / garage), race
// lifecycle, progression and saves. Team modules are wired in through registry.js.
import * as THREE from 'three';
import { RoomEnvironment } from '../../vendor/RoomEnvironment.js';
import { loadProfile, saveProfile, resetProfile } from '../core/save.js';
import { Input } from '../core/input.js';
import { QualityManager } from '../core/quality.js';
import { carStats } from '../physics/vehicle.js';
import { loadModules } from './registry.js';
import { buildCareer, buildFlightCareer, totalStars, starsFor, EVENT_TYPES, UPGRADE_COST, MAX_UPGRADE } from './career.js';
import { Race } from './race.js';
import { FlightRace } from './flightRace.js';
import { attachMultiplayer } from '../multiplayer/game-bridge.js';
import { attachAccounts } from './accounts.js';

const fmt = (t) => { if (t == null) return '--'; const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`; };
const costOf = (list, id) => { const i = list.findIndex((x) => x.id === id); const it = list[i]; return it && it.cost != null ? it.cost : (i < 3 ? 0 : 400 * i); };

export class Game {
  async boot(canvasParent, setLoading) {
    setLoading('Starting engine…', 0.1);
    this.profile = loadProfile();
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 1.5, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasParent.appendChild(r.domElement);
    this.quality = new QualityManager(r, this.profile.settings.quality);
    this.quality.apply();
    this.quality.onChange((p) => this.applyPreset(p));
    addEventListener('resize', () => this.onResize());

    const pm = new THREE.PMREMGenerator(r);
    this.envMap = pm.fromScene(new RoomEnvironment(r), 0.04).texture;

    setLoading('Loading garage…', 0.4);
    this.mods = await loadModules();
    this.input = new Input();
    this.audio = new this.mods.audio.AudioEngine();
    this.applyAudioSettings();
    const unlock = () => { try { this.audio.unlock(); } catch (e) { /* ignore */ } };
    addEventListener('pointerdown', unlock, { once: false }); addEventListener('keydown', unlock);

    this.worlds = this.mods.worlds.WORLDS;
    const groundWorlds = this.worlds.filter((w) => !w.modes || w.modes.includes('ground'));
    const flightWorlds = this.worlds.filter((w) => !w.modes || w.modes.includes('flight'));
    this.career = [...buildFlightCareer(flightWorlds), ...buildCareer(groundWorlds).map((e) => ({ ...e, id: e.id, vehicleMode: 'ground' }))];

    setLoading('Building menus…', 0.7);
    this.buildUI();
    this.buildShowroom();
    if (this.mods.multiplayer) {
      try { this.online = attachMultiplayer(this, THREE); } catch (e) { console.error('[game] multiplayer failed to start', e); }
    }
    attachAccounts(this).catch((e) => console.error('[game] accounts failed to start', e));
    this.applyPreset(this.quality.preset);
    this.inputState = this.input.state;
    this.state = 'menu';
    this.last = performance.now();
    this.ui.showMenu();
    this.audio.music && this.audio.music.play && this.audio.music.play('menu');
    setLoading('', 1);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'race') this.pause(); });
    r.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- UI glue
  buildUI() {
    const car = this.mods.car;
    const opts = {
      root: document.body, THREE,
      settings: this.profile.settings,
      tracks: this.worlds.map((w) => ({ id: w.id, name: w.name, desc: w.description, description: w.description, unlock: w.unlock ?? w.unlockStars ?? 0, modes: w.modes })),
      modes: [
        { id: 'career', name: 'Career', icon: '★', desc: 'Win events, earn credits and stars, unlock new tracks.' },
        { id: 'quick', name: 'Quick Race', icon: '⚑', desc: 'Jump straight into a race against AI pilots.' },
        { id: 'timetrial', name: 'Time Trial', icon: '⏱', desc: 'Race the clock and beat your best lap.' },
        { id: 'multiplayer', name: 'Multiplayer', icon: '◎', desc: 'Race other pilots online with a room code.' },
      ],
      paints: car.PAINTS.map((p) => ({ ...p, cost: costOf(car.PAINTS, p.id), price: costOf(car.PAINTS, p.id) })),
      wheels: car.WHEELS.map((w) => ({ ...w, cost: costOf(car.WHEELS, w.id), price: costOf(car.WHEELS, w.id) })),
      buildCarModel: car.createRoadster,
      skipTitle: false,
      upgradeCosts: Object.fromEntries(['motor', 'inverter', 'tires', 'battery'].map((k) => [k, UPGRADE_COST.slice(1)])),
      statsFor: (up) => carStats(up),
      qualityInfo: () => this.quality.describe(),
    };
    let ui;
    this.teamUI = !this.mods.uiIsFallback;
    try {
      if (this.teamUI) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('../ui/ui.css', import.meta.url).href; document.head.appendChild(l);
      }
      ui = this.mods.ui.createUI(opts);
    } catch (e) {
      console.error('[game] UI module failed, using fallback', e);
      this.teamUI = false;
      ui = this.mods.fallback.ui.createUI(opts);
    }
    this.ui = ui;
    ui.on('sfx', (n) => this.audio.ui(n));
    if (this.teamUI) { ui.builtinSounds = false; ui.on('ui-sound', (t) => this.audio.ui(t)); }
    ui.on('start', (cfg) => this.startRace(cfg));
    ui.on('pause', () => this.pause(true));
    ui.on('resume', () => this.resume(true));
    ui.on('restart', () => this.restart());
    ui.on('quit', () => this.quitToMenu());
    ui.on('settings', (s) => {
      const t = this.profile.settings;
      Object.assign(t, s);
      // team UI names -> profile names
      if (s.masterVol != null) t.master = s.masterVol;
      if (s.musicVol != null) t.music = s.musicVol;
      if (s.sfxVol != null) t.sfx = s.sfxVol;
      if (s.steerSensitivity != null) t.steerSens = s.steerSensitivity;
      this.applySettings(); this.save();
    });
    ui.on('purchase', (p) => this.purchase(p));
    ui.on('equip', (p) => this.equip(p));
    ui.on('preview', (p) => this.preview(p));
    ui.on('reset', () => { this.profile = resetProfile(); this.save(); this.pushProfile(); this.showroomCar.setPaint(this.profile.car.paint); this.ui.toast('Progress reset'); });
    ui.on('tutorial', (t) => {
      if (t && (t.action === 'skip' || t.action === 'complete')) { this.profile.tutorialDone = true; this.save(); }
      if (t && t.action === 'skip' && this.race && this.lastCfg && this.lastCfg.mode === 'tutorial') this.race.skipTutorial && this.race.skipTutorial();
    });
    ui.on('screen', (s) => { this.showroomView = s === 'garage' ? 'garage' : 'menu'; });
    if (ui.input && this.input.setExternal) {
      this.input.setExternal(() => (typeof ui.input.read === 'function' ? ui.input.read(1 / 60) : ui.input));
    }
    this.pushProfile();
  }

  pushProfile() {
    const P = this.profile, stars = totalStars(P);
    const events = this.career.map((e) => ({ ...e, locked: stars < e.unlockStars, stars: P.stars[e.id] || 0 }));
    this.ui.setProfile && this.ui.setProfile({ ...P, stars, starsByEvent: P.stars, totalStars: stars, careerEvents: events.map((e) => ({ ...e, track: e.world, unlock: e.locked ? `${e.unlockStars}★` : '' })), unlocked: this.worlds.filter((w) => stars >= (w.unlock ?? 0)).map((w) => w.id) });
  }

  save() { saveProfile(this.profile); }

  applySettings() {
    const s = this.profile.settings;
    if (s.quality !== this.quality.mode) this.quality.setMode(s.quality);
    this.applyAudioSettings();
    // The team UI's touch controls own tilt steering (and its on-screen switch). Reading
    // the sensor here as well would add the tilt twice and make steering twice as sharp.
    if (this.teamUI) { this.input.enableTilt(false); return; }
    this.input.enableTilt(!!s.tiltSteer).then((ok) => { if (!ok && s.tiltSteer) { s.tiltSteer = false; this.ui.toast('Tilt steering not available'); } });
  }

  applyAudioSettings() {
    const s = this.profile.settings, a = this.audio;
    if (!a || !a.setVolume) return;
    a.setVolume('master', s.master); a.setVolume('music', s.music); a.setVolume('sfx', s.sfx);
  }

  applyPreset(p) {
    this.renderer.shadowMap.enabled = p.shadows;
    const scenes = [this.showroom && this.showroom.scene, this.race && this.race.scene].filter(Boolean);
    for (const sc of scenes) sc.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    if (this.race) {
      this.race.world.setShadowSize && this.race.world.setShadowSize(p.shadowSize);
      this.race.camera.far = p.drawDist * 1.6; this.race.camera.updateProjectionMatrix();
    }
    if (this.audio && this.audio.setQuality) this.audio.setQuality(p.id === 'low' ? 'low' : 'high');
  }

  onResize() {
    this.quality.apply();
    const a = innerWidth / innerHeight;
    for (const cam of [this.showroom && this.showroom.camera, this.race && this.race.camera]) if (cam) { cam.aspect = a; cam.updateProjectionMatrix(); }
  }

  // ---------------------------------------------------------------- showroom
  buildShowroom() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07080c);
    scene.environment = this.envMap;
    scene.fog = new THREE.Fog(0x07080c, 12, 40);
    const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.25, metalness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.28, 96), new THREE.MeshBasicMaterial({ color: 0xff2a3d }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.06, 96), new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.35, metalness: 0.7 }));
    disc.position.y = 0.03; disc.receiveShadow = true; scene.add(disc);
    const key = new THREE.SpotLight(0xffffff, 160, 30, 0.6, 0.6, 1.5); key.position.set(4, 8, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key);
    const rim = new THREE.SpotLight(0x5fd0ff, 150, 30, 0.7, 0.8, 1.5); rim.position.set(-6, 4, -5); scene.add(rim);
    const warm = new THREE.SpotLight(0xff5060, 90, 30, 0.7, 0.8, 1.5); warm.position.set(6, 3, -6); scene.add(warm);
    scene.add(new THREE.HemisphereLight(0x8090a0, 0x101010, 0.4));
    // light bars in the background
    for (let i = 0; i < 9; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6, 0.08), new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xff2a3d : 0x9fdfff }));
      const a = Math.PI + (i - 4) * 0.22; bar.position.set(Math.sin(a) * 14, 3, Math.cos(a) * 14); scene.add(bar);
    }
    const P = this.profile;
    const car = this.mods.car.createRoadster({ model: P.car.model || 'rocket', paint: P.car.paint, wheels: P.car.wheels, quality: this.quality.preset.carDetail });
    car.object.position.y = 0.06;
    car.object.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(car.object);
    this.showroomCar = car;
    this.showroom = { scene, camera, t: 0, disc, ring };
    this.showroomView = 'menu';
    this.onResize();
  }

  rebuildShowroomCar() {
    const P = this.profile, sc = this.showroom.scene, old = this.showroomCar;
    const car = this.mods.car.createRoadster({ model: P.car.model || 'rocket', paint: P.car.paint, wheels: P.car.wheels, quality: this.quality.preset.carDetail });
    car.object.position.y = 0.06; car.object.rotation.y = old.object.rotation.y;
    car.object.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    sc.remove(old.object); old.dispose && old.dispose();
    sc.add(car.object); this.showroomCar = car;
    this.save();
  }

  updateShowroom(dt) {
    const s = this.showroom; s.t += dt;
    const car = this.showroomCar;
    car.object.rotation.y += dt * 0.25;
    car.update && car.update(dt, 0, Math.sin(s.t * 0.5) * 0.15);
    const garage = this.showroomView === 'garage';
    const narrow = innerWidth < innerHeight;
    const target = garage
      ? new THREE.Vector3(narrow ? 0 : -1.2 * 0 + 2.6, narrow ? 3.6 : 1.7, narrow ? 7.5 : 6.2)
      : new THREE.Vector3(Math.sin(s.t * 0.08) * 1.5 + 4.5, 1.5, 6.5);
    s.camera.position.lerp(target, 1 - Math.exp(-dt * 2));
    const look = garage ? new THREE.Vector3(narrow ? 0 : 1.6, narrow ? -0.6 : 0.6, 0) : new THREE.Vector3(-1.4, 0.6, 0);
    s.camera.lookAt(look);
  }

  preview(p) {
    const car = this.showroomCar;
    car.setPaint(p && p.paint ? p.paint : this.profile.car.paint);
  }

  equip(e) {
    const P = this.profile;
    if (!e.kind) { // team UI sends the whole car: { paint, wheels, model }
      if (e.model && e.model !== P.car.model) { P.car.model = e.model; this.rebuildShowroomCar(); }
      if (e.paint && e.paint !== P.car.paint) this.equip({ kind: 'paint', id: e.paint });
      if (e.wheels && e.wheels !== P.car.wheels) this.equip({ kind: 'wheel', id: e.wheels });
      return;
    }
    const { kind, id } = e;
    if (kind === 'paint') { P.car.paint = id; this.showroomCar.setPaint(id); }
    if (kind === 'wheel') { P.car.wheels = id; this.showroomCar.setWheels(id); }
    this.save(); this.pushProfile();
  }

  purchase({ kind, id, price }) {
    const P = this.profile, car = this.mods.car;
    let cost = 0;
    if (kind === 'upgrade') {
      const lv = P.upgrades[id] || 0; if (lv >= MAX_UPGRADE) return;
      cost = price ?? UPGRADE_COST[lv + 1];
    } else cost = costOf(kind === 'paint' ? car.PAINTS : car.WHEELS, id);
    if (P.credits < cost) { this.ui.toast(`Need ${cost - P.credits} more credits`); this.audio.ui('back'); return; }
    P.credits -= cost;
    if (kind === 'upgrade') P.upgrades[id] = (P.upgrades[id] || 0) + 1;
    else { P.owned[kind === 'paint' ? 'paints' : 'wheels'].push(id); this.equip({ kind, id }); }
    this.audio.ui('unlock');
    this.ui.toast(kind === 'upgrade' ? `${id[0].toUpperCase() + id.slice(1)} upgraded to level ${P.upgrades[id]}` : 'Unlocked!');
    this.save(); this.pushProfile();
  }

  // ---------------------------------------------------------------- races
  startRace(sel) {
    let cfg;
    const P = this.profile;
    const avgUp = Math.round((P.upgrades.motor + P.upgrades.inverter + P.upgrades.tires + P.upgrades.battery) / 4);
    const vm = sel.vehicleMode || (sel.mode === 'tutorial' ? 'flight' : P.settings.vehicleMode) || 'flight';
    const flight = vm === 'flight';
    const d = typeof sel.difficulty === 'string' ? ({ easy: 0, normal: 1, hard: 2 }[sel.difficulty] ?? 1) : (sel.difficulty ?? 1);
    if (sel.mode === 'career') {
      const ev = this.career.find((e) => e.id === sel.eventId);
      if (!ev) return;
      const wd = this.worlds.find((w) => w.id === ev.world) || {};
      cfg = { mode: 'career', flight: ev.vehicleMode === 'flight', weather: wd.defaultWeather || 'clear', type: ev.type, worldId: ev.world, laps: ev.laps, opponents: ev.opponents, skill: ev.skill, aiUpgrade: ev.aiUpgrade, event: ev };
    } else if (sel.mode === 'tutorial') {
      cfg = { mode: 'tutorial', flight: true, type: 'tutorial', worldId: (this.worlds.find((w) => w.id === 'coast') || this.worlds[0]).id, laps: 1, opponents: 0, skill: 1, aiUpgrade: 0 };
    } else if (flight && (sel.mode === 'free' || sel.mode === 'freeflight')) {
      cfg = { mode: 'freeflight', flight: true, type: 'freeflight', worldId: sel.track || this.worlds[0].id, laps: 99, opponents: 0, skill: 1, aiUpgrade: 0 };
    } else if (flight && sel.mode === 'timetrial') {
      cfg = { mode: 'timetrial', flight: true, type: 'ringtrial', worldId: sel.track || this.worlds[0].id, laps: 3, opponents: 0, skill: 1, aiUpgrade: 0 };
    } else if (flight && sel.mode !== 'multiplayer') {
      cfg = { mode: 'quick', flight: true, type: 'ringrace', worldId: sel.track || this.worlds[0].id, laps: sel.laps || 3, opponents: sel.opponents ?? 5,
        skill: [0.76, 0.86, 0.95][d] || 0.86, aiUpgrade: Math.min(4, Math.max(0, avgUp + d - 1)) };
    } else if (sel.mode === 'timetrial') {
      cfg = { mode: 'timetrial', type: 'free', worldId: sel.track, laps: 99, opponents: 0, skill: 1, aiUpgrade: 0 };
    } else {
      cfg = { mode: 'quick', type: 'race', worldId: sel.track || this.worlds[0].id, laps: sel.laps || 3, opponents: sel.opponents ?? 5,
        skill: [0.82, 0.92, 1.0][d] || 0.92, aiUpgrade: Math.min(4, Math.max(0, avgUp + d - 1)) };
    }
    const wd = this.worlds.find((w) => w.id === cfg.worldId);
    if (!wd) cfg.worldId = this.worlds[0].id;
    if (!cfg.flight && wd && wd.modes && !wd.modes.includes('ground')) cfg.worldId = (this.worlds.find((w) => !w.modes || w.modes.includes('ground')) || this.worlds[0]).id;
    this.lastCfg = cfg;
    this.launch(cfg);
  }

  launch(cfg) {
    this.state = 'loading';
    if (this.race) { this.race.dispose(); this.race = null; }
    if (this.ui.setLoading) this.ui.setLoading(0.3, 'Loading track…'); else this.ui.toast && this.ui.toast('Loading track…');
    const go = () => {
      try {
        const race = cfg.flight ? new FlightRace(this, cfg) : new Race(this, cfg);
        race.build();
        this.race = race;
        this.state = 'race';
        this.ui.setLoading && this.ui.setLoading(1);
        this.audio.setCarActive && this.audio.setCarActive(true);
        this.audio.music && this.audio.music.play && this.audio.music.play('race');
        this.showHUD();
        this.onResize();
      } catch (e) {
        console.error(e);
        this.ui.toast('Could not load that track: ' + e.message);
        this.ui.setLoading && this.ui.setLoading(1);
        this.state = 'menu'; this.ui.showMenu();
      }
    };
    requestAnimationFrame(() => setTimeout(go, 30));
  }

  showHUD() {
    if (this.ui.enterRace) this.ui.enterRace();
    else if (this.ui.showHUD) this.ui.showHUD();
    else this.ui.show('hud');
  }

  pause(fromUI = false) {
    if (this.state !== 'race') return;
    this.state = 'paused';
    this.audio.update && this.audio.update({ speed: 0, throttle: 0, brake: 0, slip: 0, surface: 'asphalt', boost: false }, 0.016);
    if (!fromUI) this.ui.showPause();
  }

  resume(fromUI = false) {
    if (this.state !== 'paused') return;
    this.state = 'race'; this.last = performance.now();
    if (!fromUI) { if (this.ui.resume) this.ui.resume(); else this.showHUD(); }
  }

  restart() {
    if (this.lastCfg && this.lastCfg.mode === 'multiplayer') { this.online && this.online.backToLobby(); return; }
    if (this.lastCfg) this.launch(this.lastCfg);
  }

  quitToMenu(leaveRoom = true) {
    if (this.race) { this.race.dispose(); this.race = null; }
    if (leaveRoom && this.lastCfg && this.lastCfg.mode === 'multiplayer' && this.online) this.online.leave();
    this.state = 'menu';
    this.audio.setCarActive && this.audio.setCarActive(false);
    this.audio.update && this.audio.update({ speed: 0, throttle: 0, brake: 0, slip: 0, surface: 'asphalt', boost: false }, 0.016);
    this.audio.music && this.audio.music.play && this.audio.music.play('menu');
    this.pushProfile();
    this.ui.showMenu();
  }

  onRaceEnd(res) {
    const P = this.profile, cfg = this.lastCfg;
    P.stats.races++; if (res.position === 1 && res.racers > 1) P.stats.wins++;
    let credits = 0, stars = null, title = '', headline = '';
    const lines = [];
    if (cfg.mode === 'career') {
      const ev = cfg.event;
      stars = starsFor(ev, res);
      const prev = P.stars[ev.id] || 0;
      credits = Math.round(ev.reward * (0.25 + 0.75 * stars / 3) * (stars > prev ? 1 : 0.4));
      if (stars > prev) P.stars[ev.id] = stars;
      title = `${ev.worldName} · ${EVENT_TYPES[ev.type].name}`;
      headline = stars > 0 ? (res.position === 1 || ev.type === 'timeattack' || ev.type === 'drift' ? 'Victory' : 'Podium') : 'Try again';
      // newly unlocked worlds
      const before = totalStars({ stars: { ...P.stars, [ev.id]: prev } }), after = totalStars(P);
      const newly = this.worlds.filter((w) => (w.unlock ?? 0) > before && (w.unlock ?? 0) <= after);
      if (newly.length) lines.push(['Unlocked', newly.map((w) => w.name).join(', ')]);
    } else {
      credits = res.racers > 1 ? Math.max(0, (res.racers - res.position + 1) * 50 * Math.min(cfg.laps, 5)) : 0;
      title = cfg.mode === 'quick' ? 'Quick Race' : cfg.mode === 'multiplayer' ? 'Online Race' : 'Time Trial';
      headline = res.racers > 1 ? (res.position === 1 ? 'Victory' : `P${res.position}`) : 'Session over';
    }
    if (res.type === 'race' || res.type === 'elim') lines.unshift(['Position', `${res.position} / ${res.racers}`]);
    if (res.bestLap) lines.push(['Best lap', fmt(res.bestLap)]);
    if (res.totalTime) lines.push(['Total time', fmt(res.totalTime)]);
    if (res.type === 'timeattack') lines.push(['Targets', res.targets.map((t) => t.toFixed(2)).join(' / ')]);
    if (res.type === 'drift') { lines.push(['Drift score', res.driftScore.toLocaleString()]); lines.push(['Targets', res.targets.map((t) => t.toLocaleString()).join(' / ')]); }
    P.stats.drift = Math.max(P.stats.drift, res.driftScore || 0);
    P.credits += credits;
    this.save(); this.pushProfile();
    this.state = 'results';
    this.audio.music && this.audio.music.play && this.audio.music.play('results');
    const out = { ...res, title, headline, stars, lines, credits, table: res.racers > 1 ? res.table : null };
    if (this.teamUI) Object.assign(out, { kicker: title, title: headline, time: res.totalTime, mode: cfg.mode, extra: lines.filter((l) => !['Position', 'Best lap', 'Total time', 'Drift score'].includes(l[0])) });
    this.ui.showResults(out);
  }

  // ---------------------------------------------------------------- loop
  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.quality.frame(dt, this.state === 'race');
    this.inputState = this.input.poll(dt, this.profile.settings.steerSens);
    this.flightInput = this.input.pollFlight(dt, !!this.profile.settings.invertPitch);
    if (!this.teamUI && this.input.wasPressed('Escape', 'KeyP', 'PadEscape')) {
      if (this.state === 'race') this.pause(); else if (this.state === 'paused') this.resume();
    }
    if ((this.state === 'race' || this.state === 'results') && this.race) {
      if (this.state === 'race') this.race.update(dt);
      else this.race.update(dt * 0.25);
      if (this.race) {
        if (this.state === 'race' || !this.teamUI) this.ui.hud.update(this.race.hudData(), dt);
        this.renderer.render(this.race.scene, this.race.camera);
      }
    } else if (this.state === 'paused' && this.race) {
      this.renderer.render(this.race.scene, this.race.camera);
    } else if (this.state === 'loading') {
      // keep the last frame while the next track builds
    } else if (!(this.teamUI && this.ui.showroom)) {
      this.updateShowroom(dt);
      this.renderer.render(this.showroom.scene, this.showroom.camera);
    }
    // the team UI draws its own showroom; hide the game canvas while in menus
    this.renderer.domElement.style.visibility = this.teamUI && this.ui.showroom && !this.race ? 'hidden' : '';
    this.input.endFrame();
  }
}
