// One-shot sounds: collisions, wall scrapes, horn, and UI/menu sounds.

import { clamp, mtof, biquad, gain, noiseSource } from './util.js';

export class Sfx {
  constructor(ctx, { sfx, ui, reverb }, noise) {
    this.ctx = ctx;
    this.sfxOut = sfx;
    this.uiOut = ui;
    this.reverb = reverb;
    this.noise = noise;
    this.lastHit = 0;

    // Sustained wall scrape, driven by scrape(level) every frame.
    const src = noiseSource(ctx, noise);
    this.scrapeFilter = biquad(ctx, 'bandpass', 2400, 2.5);
    this.scrapeGain = gain(ctx);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 17;
    const lfoDepth = gain(ctx, 600);
    lfo.connect(lfoDepth).connect(this.scrapeFilter.frequency);
    lfo.start();
    src.connect(this.scrapeFilter).connect(this.scrapeGain).connect(sfx);
    this.scrapeLevel = 0;

    // Two-tone horn, gated on and off.
    this.hornGain = gain(ctx);
    const hornFilter = biquad(ctx, 'lowpass', 1800, 1);
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hornFilter);
      o.start();
    }
    hornFilter.connect(this.hornGain).connect(sfx);
  }

  // Short noise burst through a filter.
  _noise(t, { type = 'bandpass', freq = 1000, Q = 1, level = 0.5, attack = 0.002, decay = 0.2, out }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = biquad(ctx, type, freq, Q);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(out || this.sfxOut);
    src.start(t, Math.random() * (this.noise.duration - 1));
    src.stop(t + attack + decay + 0.05);
    return g;
  }

  // Simple enveloped tone, optionally gliding to another pitch.
  _tone(t, { freq, to, type = 'sine', level = 0.3, attack = 0.005, decay = 0.15, out, verb = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(out || this.sfxOut);
    if (verb && this.reverb) {
      const s = gain(ctx, verb);
      g.connect(s).connect(this.reverb);
    }
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  /**
   * Crash sound. impulse is roughly the change in speed in m/s
   * (1-3 = tap, 8 = solid hit, 20+ = big crash).
   */
  collision(impulse = 5) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const s = clamp(impulse / 20);
    if (s < 0.03) return 0;
    // Avoid machine-gun repeats when physics reports many contacts.
    if (t - this.lastHit < 0.07 && s < 0.6) return 0;
    this.lastHit = t;

    // Body thump: a falling sine, heavier for bigger hits.
    this._tone(t, { freq: 140 - 40 * s, to: 38, level: 0.35 + 0.6 * s, decay: 0.18 + 0.35 * s });
    // Crunch: bright noise for the panels.
    this._noise(t, { freq: 1200 + 1800 * s, Q: 0.8, level: 0.15 + 0.5 * s, decay: 0.08 + 0.3 * s });
    // Plastic/carbon crackle a hair later.
    this._noise(t + 0.012, { type: 'highpass', freq: 3500, level: 0.1 + 0.25 * s, decay: 0.05 + 0.12 * s });
    // Big hits: metallic ring from a few inharmonic partials + glass sprinkle.
    if (s > 0.45) {
      const base = 380 + Math.random() * 120;
      for (const r of [1, 2.76, 5.4]) {
        this._tone(t, { freq: base * r, type: 'sine', level: 0.06 * s, decay: 0.6 + 0.4 * s, verb: 0.3 });
      }
      for (let i = 0; i < 6; i++) {
        this._noise(t + 0.03 + Math.random() * 0.25, {
          type: 'highpass', freq: 6000, level: 0.05 * s, decay: 0.03 + Math.random() * 0.05,
        });
      }
    }
    return s;
  }

  // Call each frame while sliding along a wall (0..1); it fades by itself.
  scrape(level = 0) {
    this.scrapeLevel = Math.max(this.scrapeLevel, clamp(level));
  }

  tickScrape(dt) {
    const l = this.scrapeLevel;
    this.scrapeGain.gain.setTargetAtTime(l * 0.35, this.ctx.currentTime, 0.04);
    this.scrapeLevel = Math.max(0, l - dt * 6);
  }

  horn(on) {
    this.hornGain.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, on ? 0.01 : 0.04);
  }

  /** UI and game-event sounds. `arg` is the combo count for 'ring'. */
  ui(name, arg) {
    const t = this.ctx.currentTime + 0.005;
    const out = this.uiOut;
    const note = (m, dt, o = {}) =>
      this._tone(t + dt, { freq: mtof(m), type: 'triangle', level: 0.22, decay: 0.18, out, verb: 0.15, ...o });

    switch (name) {
      case 'hover':
        this._tone(t, { freq: 2200, type: 'sine', level: 0.05, decay: 0.03, out });
        break;
      case 'click':
        this._tone(t, { freq: 1500, to: 900, type: 'sine', level: 0.16, decay: 0.05, out });
        this._noise(t, { type: 'highpass', freq: 5000, level: 0.05, decay: 0.015, out });
        break;
      case 'confirm':
        note(76, 0); note(83, 0.07, { decay: 0.3 });
        break;
      case 'back':
        note(79, 0, { level: 0.16 }); note(72, 0.07, { level: 0.16, decay: 0.2 });
        break;
      case 'error':
        this._tone(t, { freq: 160, type: 'square', level: 0.07, decay: 0.12, out });
        this._tone(t + 0.13, { freq: 140, type: 'square', level: 0.07, decay: 0.18, out });
        break;
      case 'countdown':
        this._tone(t, { freq: 660, type: 'square', level: 0.09, attack: 0.003, decay: 0.28, out, verb: 0.2 });
        this._tone(t, { freq: 660, type: 'sine', level: 0.2, decay: 0.3, out });
        break;
      case 'go':
        for (const m of [76, 81, 88]) {
          this._tone(t, { freq: mtof(m), type: 'square', level: 0.06, decay: 0.7, out, verb: 0.3 });
        }
        this._tone(t, { freq: 1320, type: 'sine', level: 0.22, decay: 0.75, out });
        break;
      case 'checkpoint':
        note(84, 0, { type: 'sine', level: 0.2 }); note(91, 0.06, { type: 'sine', level: 0.2, decay: 0.3 });
        break;
      case 'lap':
        [72, 76, 79, 84].forEach((m, i) => note(m, i * 0.08, { decay: i === 3 ? 0.6 : 0.2 }));
        break;
      case 'coin':
        note(88, 0, { type: 'square', level: 0.07, decay: 0.06 });
        note(95, 0.06, { type: 'square', level: 0.07, decay: 0.3 });
        break;
      case 'combo':
        note(79, 0, { type: 'sine', level: 0.15, decay: 0.08 });
        note(86, 0.04, { type: 'sine', level: 0.15, decay: 0.2 });
        break;
      case 'unlock':
        [72, 79, 84, 88, 91, 96].forEach((m, i) => note(m, i * 0.055, { type: 'sine', level: 0.16, decay: 0.5, verb: 0.4 }));
        this._noise(t, { type: 'highpass', freq: 7000, level: 0.04, attack: 0.15, decay: 0.6, out });
        break;
      case 'whoosh':
        this._noise(t, { freq: 900, Q: 0.7, level: 0.25, attack: 0.08, decay: 0.3, out });
        break;
      case 'ring': this._ring(t, arg); break;
      case 'nearMiss': this._nearMiss(t); break;
      case 'transform': this._transform(t); break;
      case 'stall': this._stall(t); break;
      case 'jetIgnite': this._jetIgnite(t); break;
      case 'jetCut': this._jetCut(t); break;
      case 'jetLow': this._jetLow(t); break;
      case 'jetEmpty': this._jetEmpty(t); break;
      case 'jetDry': this._jetDry(t); break;
      case 'jetRefill': this._jetRefill(t, arg); break;
      case 'jetFull': this._jetFull(t); break;
      default:
        break;
    }
  }

  // Ring pass: a bell whose pitch climbs a pentatonic ladder with the combo,
  // so a long streak plays an ascending melody.
  _ring(t, combo = 1) {
    const ladder = [0, 2, 4, 7, 9];
    const n = Math.max(0, Math.min(14, (combo | 0) - 1));
    const midi = 76 + Math.floor(n / 5) * 12 + ladder[n % 5];
    const out = this.uiOut;
    const f = mtof(midi);
    this._tone(t, { freq: f, type: 'sine', level: 0.2, decay: 0.9, out, verb: 0.45 });
    this._tone(t, { freq: f * 2.76, type: 'sine', level: 0.05, decay: 0.35, out, verb: 0.3 }); // bell overtone
    this._tone(t + 0.045, { freq: f * 1.5, type: 'triangle', level: 0.07, decay: 0.5, out, verb: 0.4 });
    if (combo >= 5) {
      // Streak sparkle on top.
      this._tone(t + 0.09, { freq: f * 2, type: 'sine', level: 0.06, decay: 0.6, out, verb: 0.5 });
      this._noise(t, { type: 'highpass', freq: 8000, level: 0.03, attack: 0.02, decay: 0.4, out });
    }
  }

  // Near miss: a fast doppler whoosh that sweeps across the stereo field.
  _nearMiss(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = biquad(ctx, 'bandpass', 2400, 1.6);
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(380, t + 0.45);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    let node = src.connect(f).connect(g);
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      const side = Math.random() < 0.5 ? -1 : 1;
      pan.pan.setValueAtTime(-0.8 * side, t);
      pan.pan.linearRampToValueAtTime(0.8 * side, t + 0.45);
      node = node.connect(pan);
    }
    node.connect(this.sfxOut);
    src.start(t, Math.random() * (this.noise.duration - 1));
    src.stop(t + 0.6);
    this._tone(t + 0.08, { freq: 300, to: 150, type: 'sawtooth', level: 0.05, decay: 0.3 });
  }

  // Road-to-flight transform: servos spin up, panels lock with clunks,
  // fans ignite with a rising whoosh and a bright power-up chord.
  _transform(t) {
    const ctx = this.ctx;
    // Servo whir.
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(820, t + 0.75);
    const bp = biquad(ctx, 'bandpass', 1200, 3);
    const vib = ctx.createOscillator();
    vib.frequency.value = 38;
    const vibG = gain(ctx, 25);
    vib.connect(vibG).connect(o.frequency);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.08);
    g.gain.setValueAtTime(0.09, t + 0.65);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    o.connect(bp).connect(g).connect(this.sfxOut);
    o.start(t); vib.start(t); o.stop(t + 0.9); vib.stop(t + 0.9);
    // Mechanical clunks as panels lock.
    for (const dt of [0.12, 0.42, 0.78]) {
      this._tone(t + dt, { freq: 120, to: 55, level: 0.3, decay: 0.12 });
      this._noise(t + dt, { freq: 2200, Q: 1.5, level: 0.12, decay: 0.05 });
    }
    // Fan ignition whoosh.
    this._noise(t + 0.6, { type: 'lowpass', freq: 900, level: 0.3, attack: 0.35, decay: 0.5 });
    // Power-up chord.
    for (const m of [69, 76, 81]) {
      this._tone(t + 0.85, { freq: mtof(m), type: 'triangle', level: 0.07, decay: 0.8, out: this.uiOut, verb: 0.35 });
    }
  }

  // Stall warning: two urgent beeps, never more than one pattern at a time.
  _stall(t) {
    if (t - (this.lastStall || 0) < 0.6) return;
    this.lastStall = t;
    for (const dt of [0, 0.16]) {
      this._tone(t + dt, { freq: 1040, type: 'square', level: 0.08, attack: 0.004, decay: 0.1, out: this.uiOut });
      this._tone(t + dt, { freq: 1040, type: 'sine', level: 0.14, attack: 0.004, decay: 0.1, out: this.uiOut });
    }
  }

  // ---- Jet hops ------------------------------------------------------------

  // Ignition: an igniter tick, a deep "fwoomp" and a burst of flame noise that
  // opens up as it lights. Short, because hops are short.
  _jetIgnite(t) {
    if (t - (this.lastIgnite || 0) < 0.12) return;
    this.lastIgnite = t;
    const ctx = this.ctx;
    this._noise(t, { type: 'highpass', freq: 6000, level: 0.08, decay: 0.012 });
    this._tone(t + 0.01, { freq: 95, to: 38, type: 'sine', level: 0.5, attack: 0.008, decay: 0.32 });
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = biquad(ctx, 'lowpass', 250, 1.2);
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.09);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.4);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(f).connect(g).connect(this.sfxOut);
    src.start(t, Math.random() * (this.noise.duration - 1));
    src.stop(t + 0.5);
  }

  // Letting go: a soft puff as the flame chokes off.
  _jetCut(t) {
    if (t - (this.lastCut || 0) < 0.1) return;
    this.lastCut = t;
    this._noise(t, { type: 'lowpass', freq: 700, Q: 0.7, level: 0.12, attack: 0.004, decay: 0.16 });
  }

  // Tank under a quarter while burning: one short double blip, easy to ignore
  // but enough to know you should save the rest.
  _jetLow(t) {
    if (t - (this.lastLow || 0) < 1.2) return;
    this.lastLow = t;
    const out = this.uiOut;
    this._tone(t, { freq: 1320, type: 'sine', level: 0.09, attack: 0.003, decay: 0.07, out });
    this._tone(t + 0.1, { freq: 1320, type: 'sine', level: 0.09, attack: 0.003, decay: 0.07, out });
  }

  // Running dry mid-burn: the flame coughs a few times and dies, then a low
  // falling two-note "empty" cue.
  _jetEmpty(t) {
    if (t - (this.lastEmpty || 0) < 0.8) return;
    this.lastEmpty = t;
    [0, 0.07, 0.17, 0.3].forEach((dt, i) => {
      const k = 1 - i * 0.22;
      this._noise(t + dt, { type: 'lowpass', freq: 900 * k + 200, Q: 1, level: 0.3 * k, attack: 0.004, decay: 0.06 });
      this._tone(t + dt, { freq: 70, to: 40, level: 0.25 * k, attack: 0.004, decay: 0.08 });
    });
    const out = this.uiOut;
    this._tone(t + 0.32, { freq: mtof(67), type: 'triangle', level: 0.14, decay: 0.16, out });
    this._tone(t + 0.48, { freq: mtof(60), type: 'triangle', level: 0.14, decay: 0.28, out });
  }

  // Pressing JET with an empty tank: a dry click and a little hiss, nothing more.
  _jetDry(t) {
    if (t - (this.lastDry || 0) < 0.35) return;
    this.lastDry = t;
    this._tone(t, { freq: 1900, to: 1100, type: 'square', level: 0.05, attack: 0.001, decay: 0.025 });
    this._noise(t + 0.02, { type: 'highpass', freq: 3000, level: 0.06, attack: 0.01, decay: 0.12 });
  }

  // Fuel added (a ring): a rising charge sweep on top of the ring chime.
  // amount 0..1 is how much went in; more fuel sweeps higher.
  _jetRefill(t, amount = 0.45) {
    const ctx = this.ctx;
    const a = clamp(amount, 0.1, 1);
    const top = 900 + 1400 * a;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(280, t);
    o.frequency.exponentialRampToValueAtTime(top, t + 0.28);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g).connect(this.uiOut);
    o.start(t); o.stop(t + 0.36);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = biquad(ctx, 'bandpass', 600, 2);
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(top * 3, t + 0.28);
    const ng = gain(ctx, 0);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.08, t + 0.08);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    src.connect(f).connect(ng).connect(this.uiOut);
    src.start(t, Math.random() * (this.noise.duration - 1));
    src.stop(t + 0.35);
  }

  // Tank back to full: a quiet two-note "ready".
  _jetFull(t) {
    if (t - (this.lastFull || 0) < 1.5) return;
    this.lastFull = t;
    const out = this.uiOut;
    this._tone(t, { freq: mtof(84), type: 'sine', level: 0.08, decay: 0.12, out, verb: 0.2 });
    this._tone(t + 0.08, { freq: mtof(91), type: 'sine', level: 0.08, decay: 0.3, out, verb: 0.3 });
  }

  // ---- Landings and surfaces -------------------------------------------------

  /**
   * Touching down after a hop. impact = downward speed in m/s (3 soft, 10 firm,
   * 22+ hard). surface is a SURFACES key. Returns 0..1 strength.
   */
  land(impact, surf, key = 'asphalt') {
    const t = this.ctx.currentTime + 0.005;
    const s = clamp((impact - 1) / 22);
    if (s <= 0.01) return 0;
    if (t - (this.lastLand || 0) < 0.15) return 0;
    this.lastLand = t;
    // Suspension bottoming out: a falling thump and a short metal clunk.
    this._tone(t, { freq: 105 - 30 * s, to: 36, level: 0.25 + 0.55 * s, attack: 0.004, decay: 0.14 + 0.3 * s });
    this._noise(t, { freq: 1600, Q: 1.4, level: 0.05 + 0.14 * s, decay: 0.04 + 0.06 * s });
    if (s > 0.35) this._tone(t + 0.035, { freq: 82, to: 44, level: 0.2 * s, decay: 0.12 }); // rebound
    // What the tires land on.
    if (key === 'asphalt' || key === 'kerb') {
      // Tire chirp: spinning tires meet the road.
      this._noise(t + 0.01, { freq: surf.skidHz, Q: 4, level: 0.06 + 0.16 * s, attack: 0.003, decay: 0.07 + 0.08 * s });
      this._tone(t + 0.01, { freq: 900, to: 760, type: 'sawtooth', level: 0.015 + 0.03 * s, decay: 0.08 });
      if (key === 'kerb') this._tone(t + 0.06, { freq: 90, to: 50, level: 0.2 * s + 0.08, decay: 0.08 });
    } else if (key === 'ice') {
      this._noise(t, { type: 'highpass', freq: 4500, level: 0.04 + 0.08 * s, decay: 0.05 });
    } else {
      this.surfaceHit(surf, 0.3 + 0.7 * s);
    }
    return s;
  }

  /**
   * A burst of the surface's own material: stones and dirt kicked up when
   * landing on it or driving onto it. amount 0..1.
   */
  surfaceHit(surf, amount = 0.5) {
    const t = this.ctx.currentTime + 0.005;
    const a = clamp(amount);
    const grains = Math.round(3 + 9 * a * surf.grit);
    // Soft body: the tires sinking in (grass, mud, snow, sand).
    this._noise(t, { type: 'lowpass', freq: 380 + surf.rollHz * 0.4, Q: 0.7, level: 0.08 + 0.18 * a, attack: 0.01, decay: 0.12 + 0.12 * a });
    // Grit: many tiny clicks spread over a fraction of a second.
    for (let i = 0; i < grains; i++) {
      const dt = Math.random() * (0.08 + 0.18 * a);
      this._noise(t + dt, {
        freq: surf.gritHz * (0.7 + Math.random() * 0.8), Q: 3, level: (0.02 + 0.06 * a) * (0.5 + Math.random()),
        attack: 0.001, decay: 0.012 + Math.random() * 0.03,
      });
    }
  }
}
