// Entry point for all game audio. Pure Web Audio, no files to download.
//
//   import { AudioEngine } from './src/audio/AudioEngine.js';
//   const audio = new AudioEngine();
//   audio.unlock();                       // on first click/tap/key
//   audio.update({ speed, throttle, brake, slip, surface, boost }, dt); // every frame
//   audio.collision(impulse);  audio.ui('click');
//   audio.music.play('race');  audio.music.setIntensity(0.8);
//   audio.setVolume('music', 0.5);

import { MotorSound } from './MotorSound.js';
import { FlightSound } from './FlightSound.js';
import { Sfx } from './Sfx.js';
import { MusicPlayer } from './Music.js';
import { clamp, makeNoiseBuffer, makeImpulse, gain } from './util.js';

export { mountAudioSettings } from './settingsUI.js';

const BUSES = ['master', 'music', 'sfx', 'engine', 'ui'];
const DEFAULTS = { master: 0.8, music: 0.6, sfx: 0.9, engine: 0.85, ui: 0.7, muted: false };

// Stands in when Web Audio is missing so callers never need null checks.
const NOOP_MUSIC = { play() {}, stop() {}, setIntensity() {}, setQuality() {} };

// Records music calls made before the first gesture, then replays them.
class PendingMusic {
  constructor() { this.song = null; this.intensity = null; this.quality = null; }
  play(name = 'menu') { this.song = name; }
  stop() { this.song = null; }
  setIntensity(x) { this.intensity = x; }
  setQuality(q) { this.quality = q; }
  replay(m) {
    if (this.intensity != null) { m.setIntensity(this.intensity); m.intensity = m.targetIntensity; }
    if (this.song) m.play(this.song);
  }
}

export class AudioEngine {
  /**
   * @param {{context?: BaseAudioContext, storageKey?: string, quality?: 'high'|'low'}} opts
   *   context: inject an OfflineAudioContext for tests/rendering.
   */
  constructor({ context, storageKey = 'roadster.audio.v1', quality = 'high' } = {}) {
    this.storageKey = storageKey;
    this.settings = { ...DEFAULTS, ...this._load() };
    this.listeners = new Set();
    this.music = NOOP_MUSIC;
    this.remotes = new Set();
    this.quality = quality;
    this.carActive = true;

    this.AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    this.enabled = !!(context || this.AC);
    this.ready = false;
    if (!this.enabled) return;

    // Before the first user gesture there is no audio graph at all (browsers
    // refuse to start audio then). Calls made early are remembered.
    this.music = new PendingMusic();
    if (context) this._init(context);

    if (typeof document !== 'undefined' && !context) {
      // Pause audio when the tab/app is hidden (saves battery on phones).
      document.addEventListener('visibilitychange', () => {
        if (!this.ready) return;
        if (document.hidden) this.ctx.suspend && this.ctx.suspend();
        else this.ctx.resume();
      });
      // Unlock on the first gesture even if the game forgets to.
      const once = () => {
        this.unlock();
        for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, once, true);
      };
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, once, true);
    }
  }

  _init(context) {
    const quality = this.quality;
    const ctx = (this.ctx = context || new this.AC({ latencyHint: 'interactive' }));

    // Mix: buses -> master -> gentle compressor/limiter -> speakers.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.2;
    this.limiter.connect(ctx.destination);

    this.buses = {};
    this.buses.master = gain(ctx, 0);
    this.buses.master.connect(this.limiter);
    for (const b of BUSES.slice(1)) {
      this.buses[b] = gain(ctx, 0);
      this.buses[b].connect(this.buses.master);
    }
    // Ducking stage so crashes and countdowns cut through the music.
    this.musicDuck = gain(ctx, 1);
    this.musicDuck.connect(this.buses.music);

    this.noise = makeNoiseBuffer(ctx);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    const sfxVerb = gain(ctx, 0.5);
    this.reverb.connect(sfxVerb).connect(this.buses.ui);

    this.motor = new MotorSound(ctx, this.buses.engine, this.noise, { simple: quality === 'low' });
    this.motor.setLevel(this.carActive ? 1 : 0, 0.01);
    this.sfx = new Sfx(ctx, { sfx: this.buses.sfx, ui: this.buses.ui, reverb: this.reverb }, this.noise);
    const musicVerb = ctx.createConvolver();
    musicVerb.buffer = makeImpulse(ctx, 3.2, 2.5);
    const pending = this.music;
    this.music = new MusicPlayer(ctx, this.musicDuck, this.noise, musicVerb);
    this.music.setQuality(quality);
    pending.replay(this.music);

    this.ready = true;
    this._applyVolumes(true);
  }

  /** Call from a user gesture. Safe to call many times. */
  unlock() {
    if (!this.enabled) return Promise.resolve();
    if (!this.ready) this._init();
    const ctx = this.ctx;
    // iOS Safari: playing a silent buffer inside the gesture fully unlocks output.
    try {
      const b = ctx.createBufferSource();
      b.buffer = ctx.createBuffer(1, 1, 22050);
      b.connect(ctx.destination);
      b.start(0);
    } catch (e) { /* ignore */ }
    return ctx.resume ? ctx.resume().catch(() => {}) : Promise.resolve();
  }

  get running() {
    return this.ready && this.ctx.state === 'running';
  }

  /**
   * Per-frame update for the player's car.
   * @param {{speed?:number, throttle?:number, brake?:number, slip?:number,
   *          surface?:'asphalt'|'dirt'|'grass'|'snow'|'sand', boost?:boolean}} state
   * @param {number} dt seconds since last frame
   */
  update(state, dt = 1 / 60) {
    if (!this.ready) return;
    this._setMode('drive');
    this.motor.update(state);
    this.sfx.tickScrape(dt);
  }

  /**
   * Per-frame update while flying. Calling it switches from road sounds to
   * flight sounds (calling update() again switches back), with a crossfade.
   * @param {{airspeed?:number, thrust?:number, boost?:boolean, altitude?:number, gForce?:number}} state
   *   airspeed m/s, thrust 0..1, altitude metres, gForce in g (1 = level)
   */
  updateFlight(state, dt = 1 / 60) {
    if (!this.ready) return;
    if (!this.flight) {
      this.flight = new FlightSound(this.ctx, this.buses.engine, this.noise, { simple: this.quality === 'low' });
    }
    this._setMode('flight');
    this.flight.update(state);
    this.sfx.tickScrape(dt);
  }

  _setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this._applyCarLevels(0.25);
  }

  _applyCarLevels(tc) {
    const on = this.carActive;
    this.motor.setLevel(on && this.mode !== 'flight' ? 1 : 0, tc);
    if (this.flight) this.flight.setLevel(on && this.mode === 'flight' ? 1 : 0, tc);
  }

  /** Fade the player car's sounds in/out (e.g. off in menus, on in races). */
  setCarActive(on) {
    this.carActive = on;
    if (!this.ready) return;
    this._applyCarLevels(0.25);
  }

  /** impulse ~ change in speed in m/s. Returns 0..1 strength (0 if ignored). */
  collision(impulse) {
    if (!this.ready) return 0;
    const s = this.sfx.collision(impulse);
    if (s > 0.3) this.duckMusic(0.35 + 0.4 * s, 0.6 + s);
    return s;
  }

  scrape(level) { if (this.ready) this.sfx.scrape(level); }
  horn(on) { if (this.ready) this.sfx.horn(on); }

  /**
   * 'click'|'hover'|'confirm'|'back'|'error'|'countdown'|'go'|'checkpoint'|'lap'|'coin'|'combo'|'unlock'|'whoosh'
   * Flight: 'ring' (pass the combo count as arg), 'nearMiss', 'transform', 'stall'.
   */
  ui(name, arg) {
    if (!this.ready) return;
    if (name === 'countdown' || name === 'go' || name === 'transform') this.duckMusic(0.5, 0.5);
    this.sfx.ui(name, arg);
  }

  duckMusic(amount = 0.5, seconds = 0.8) {
    if (!this.ready) return;
    const g = this.musicDuck.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - clamp(amount), t, 0.02);
    g.setTargetAtTime(1, t + seconds * 0.4, seconds * 0.3);
  }

  // ---- Volume settings ---------------------------------------------------

  /** bus: 'master'|'music'|'sfx'|'engine'|'ui', value 0..1. Saved automatically. */
  setVolume(bus, value) {
    if (!(bus in DEFAULTS) || bus === 'muted') return;
    this.settings[bus] = clamp(+value);
    this._applyVolumes();
    this._save();
  }

  getVolume(bus) {
    return this.settings[bus];
  }

  mute(on = true) {
    this.settings.muted = !!on;
    this._applyVolumes();
    this._save();
  }

  get muted() {
    return this.settings.muted;
  }

  resetVolumes() {
    Object.assign(this.settings, DEFAULTS);
    this._applyVolumes();
    this._save();
  }

  /** Listen for settings changes (used by the settings UI). Returns unsubscribe. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 'low' trims reverb and voices for weak devices. */
  setQuality(q) {
    this.quality = q;
    this.music.setQuality(q);
  }

  _applyVolumes(instant) {
    for (const fn of this.listeners) fn(this.settings);
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const b of BUSES) {
      // Squared curve: sliders feel even to the ear instead of all-or-nothing.
      let v = this.settings[b] ** 2;
      if (b === 'master' && this.settings.muted) v = 0;
      const p = this.buses[b].gain;
      if (instant) p.setValueAtTime(v, t);
      else p.setTargetAtTime(v, t, 0.03);
    }
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey)) || {};
    } catch (e) {
      return {};
    }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
    } catch (e) { /* private mode etc. */ }
  }

  // ---- 3D sound for other cars (multiplayer, AI) -------------------------

  /** Set where the camera/listener is. pos/forward/up are {x,y,z}. */
  setListener(pos, forward = { x: 0, y: 0, z: -1 }, up = { x: 0, y: 1, z: 0 }) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setValueAtTime(forward.x, t);
      l.forwardY.setValueAtTime(forward.y, t);
      l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(up.x, t);
      l.upY.setValueAtTime(up.y, t);
      l.upZ.setValueAtTime(up.z, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /**
   * A positional car sound for another player or AI car.
   * Returns { update(state), setPosition({x,y,z}), dispose() }.
   */
  createRemoteCar() {
    if (!this.ready) return { update() {}, setPosition() {}, dispose() {} };
    const ctx = this.ctx;
    const panner = ctx.createPanner();
    panner.panningModel = this.quality === 'low' ? 'equalpower' : 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 6;
    panner.maxDistance = 500;
    panner.rolloffFactor = 1.2;
    panner.connect(this.buses.engine);
    const motor = new MotorSound(ctx, panner, this.noise, { simple: true });
    const remote = {
      update: (s) => motor.update(s),
      setPosition: (p) => {
        if (panner.positionX) {
          const t = ctx.currentTime;
          panner.positionX.setTargetAtTime(p.x, t, 0.03);
          panner.positionY.setTargetAtTime(p.y, t, 0.03);
          panner.positionZ.setTargetAtTime(p.z, t, 0.03);
        } else panner.setPosition(p.x, p.y, p.z);
      },
      dispose: () => {
        motor.dispose();
        panner.disconnect();
        this.remotes.delete(remote);
      },
    };
    this.remotes.add(remote);
    return remote;
  }
}

export default AudioEngine;
