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

  /** UI and game-event sounds. */
  ui(name) {
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
      default:
        break;
    }
  }
}
