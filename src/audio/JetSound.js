// Continuous sound of the Roadster's jet hops: a short, punchy rocket burn.
// Layers: a deep roar (filtered noise), a sub thump that follows the burn,
// a turbine whine that spools up while the button is held, and a crackle on
// top. As the tank runs low the burn starts to sputter, so you can hear the
// tank emptying without looking at the gauge. All synthesized.

import { clamp, smoothstep, noiseSource, biquad, gain, glide } from './util.js';

export class JetSound {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination
   * @param {AudioBuffer} noise shared white-noise buffer
   * @param {{simple?: boolean}} opts simple = fewer nodes for weak devices
   */
  constructor(ctx, destination, noise, { simple = false } = {}) {
    this.ctx = ctx;
    this.sources = [];
    this.out = gain(ctx, 1);
    this.out.connect(destination);
    const start = (n) => { n.start(); this.sources.push(n); return n; };
    const track = (n) => { this.sources.push(n); return n; };

    // The whole burn passes through one gate so sputter can chop all of it.
    this.burn = gain(ctx, 0);
    this.burn.connect(this.out);

    // Roar: wide noise with a low-pass that opens as the burn builds.
    this.roarFilter = biquad(ctx, 'lowpass', 400, 0.8);
    this.roarGain = gain(ctx, 0.9);
    track(noiseSource(ctx, noise)).connect(this.roarFilter).connect(this.roarGain).connect(this.burn);

    // Mid "tearing" band, the bit that makes it sound like a rocket and not wind.
    this.tearFilter = biquad(ctx, 'bandpass', 900, 1.4);
    this.tearGain = gain(ctx, 0.35);
    track(noiseSource(ctx, noise)).connect(this.tearFilter).connect(this.tearGain).connect(this.burn);

    // Sub: a low saw through a steep low-pass, felt more than heard.
    this.sub = start(ctx.createOscillator());
    this.sub.type = 'sawtooth';
    this.sub.frequency.value = 42;
    const subF = biquad(ctx, 'lowpass', 110, 1.2);
    this.subGain = gain(ctx, 0.45);
    this.sub.connect(subF).connect(this.subGain).connect(this.burn);

    if (!simple) {
      // Turbine whine: rises in pitch the longer you hold the button.
      this.whine = start(ctx.createOscillator());
      this.whine.type = 'sawtooth';
      this.whine.frequency.value = 600;
      this.whineFilter = biquad(ctx, 'bandpass', 1400, 6);
      this.whineGain = gain(ctx, 0);
      this.whine.connect(this.whineFilter).connect(this.whineGain).connect(this.out);

      // Crackle: bright noise chopped by a fast square wave.
      const band = biquad(ctx, 'bandpass', 2600, 0.9);
      const gate = gain(ctx, 0.5);
      this.chop = start(ctx.createOscillator());
      this.chop.type = 'square';
      this.chop.frequency.value = 27;
      const depth = gain(ctx, 0.5);
      this.chop.connect(depth).connect(gate.gain);
      this.crackleGain = gain(ctx, 0);
      track(noiseSource(ctx, noise)).connect(band).connect(gate).connect(this.crackleGain).connect(this.out);
    }

    // Engine state that lives in JS (spool builds while firing, decays after).
    this.spool = 0;
    this.level = 0;
  }

  /**
   * @param {{firing?:boolean, fuel?:number, airborne?:boolean, speed?:number}} s
   * @param {number} dt
   */
  update(s = {}, dt = 1 / 60) {
    const ctx = this.ctx;
    const firing = !!s.firing;
    const fuel = clamp(s.fuel == null ? 1 : s.fuel);
    const speed = Math.abs(s.speed || 0);

    // Spool: ~0.35 s to full while firing, ~0.5 s to die away after.
    this.spool = firing ? Math.min(1, this.spool + dt / 0.35) : Math.max(0, this.spool - dt / 0.5);
    // The burn itself has a fast attack and a short tail.
    const target = firing ? 1 : 0;
    this.level += (target - this.level) * Math.min(1, dt * (firing ? 30 : 7));

    // Sputter below 20% fuel: random dips each frame, deeper as the tank empties.
    let sputter = 1;
    if (firing && fuel < 0.2) {
      const depth = 1 - fuel / 0.2;          // 0 at 20% fuel, 1 when empty
      if (Math.random() < 0.25 + 0.45 * depth) sputter = 1 - depth * (0.55 + Math.random() * 0.4);
    }
    const lvl = this.level * sputter;
    this.burn.gain.setTargetAtTime(lvl * 0.55, ctx.currentTime, firing ? 0.012 : 0.06);

    // A full tank burns bright; a nearly empty one sounds thinner and lower.
    const health = 0.55 + 0.45 * smoothstep(0, 0.35, fuel);
    glide(this.roarFilter.frequency, 300 + 1700 * this.spool * health, ctx, 0.03);
    glide(this.tearFilter.frequency, 650 + 650 * this.spool * health + speed * 3, ctx, 0.05);
    glide(this.sub.frequency, 36 + 18 * this.spool, ctx, 0.05);

    if (this.whine) {
      glide(this.whine.frequency, (520 + 1300 * this.spool) * health, ctx, 0.04);
      glide(this.whineFilter.frequency, (900 + 1800 * this.spool) * health, ctx, 0.04);
      glide(this.whineGain.gain, this.spool * 0.05 * (firing ? 1 : 0.5), ctx, 0.06);
      glide(this.crackleGain.gain, lvl * 0.16, ctx, 0.03);
      glide(this.chop.frequency, 19 + 14 * this.spool + Math.random() * 6, ctx, 0.02);
    }
  }

  setLevel(v, tc = 0.3) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  dispose() {
    for (const s of this.sources) {
      try { s.stop(); } catch (e) { /* already stopped */ }
    }
    this.out.disconnect();
  }
}
