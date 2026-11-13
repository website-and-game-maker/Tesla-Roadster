// Continuous flight sound: ducted-fan thrusters, afterburner, wind rush,
// high-altitude whistle and airframe strain under g-force. All synthesized.

import { clamp, smoothstep, noiseSource, biquad, gain, glide } from './util.js';

export class FlightSound {
  constructor(ctx, destination, noise, { simple = false } = {}) {
    this.ctx = ctx;
    this.sources = [];
    this.out = gain(ctx, 0);
    this.out.connect(destination);
    const start = (n) => { n.start(); this.sources.push(n); return n; };
    const track = (n) => { this.sources.push(n); return n; }; // already started

    // --- Ducted fans --------------------------------------------------------
    // Body: noise shaped by a resonant band that opens with thrust.
    this.fanFilter = biquad(ctx, 'bandpass', 500, 0.9);
    this.fanNoiseGain = gain(ctx);
    track(noiseSource(ctx, noise)).connect(this.fanFilter).connect(this.fanNoiseGain).connect(this.out);
    // Blade-pass tone: the "whirr" whose pitch is fan speed. Two slightly
    // detuned fans beat against each other, like a real multi-fan craft.
    this.bladeFilter = biquad(ctx, 'lowpass', 1800, 1);
    this.bladeGain = gain(ctx);
    this.bladeFilter.connect(this.bladeGain).connect(this.out);
    this.blades = (simple ? [0] : [0, 7]).map((cents) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = cents;
      o.connect(this.bladeFilter);
      start(o);
      return o;
    });
    // Turbine whine riding on top (2x the fan's shaft order).
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = gain(ctx);
    this.whine.connect(this.whineGain).connect(this.out);
    start(this.whine);

    // --- Afterburner ----------------------------------------------------------
    this.burnGain = gain(ctx);
    const burnLow = biquad(ctx, 'lowpass', 260, 0.7);
    track(noiseSource(ctx, noise)).connect(burnLow).connect(this.burnGain);
    // Crackle: noise gated by a fast square LFO with random-ish rate.
    if (!simple) {
      const crackleBand = biquad(ctx, 'bandpass', 1400, 0.8);
      const gate = gain(ctx, 0.5);
      const chop = start(ctx.createOscillator());
      chop.type = 'square';
      chop.frequency.value = 31;
      const chopDepth = gain(ctx, 0.5);
      chop.connect(chopDepth).connect(gate.gain);
      const crackleGain = gain(ctx, 0.5);
      track(noiseSource(ctx, noise)).connect(crackleBand).connect(gate).connect(crackleGain).connect(this.burnGain);
      this.chop = chop;
    }
    const roar = start(ctx.createOscillator());
    roar.type = 'sawtooth';
    roar.frequency.value = 38;
    const roarF = biquad(ctx, 'lowpass', 120, 1);
    const roarG = gain(ctx, 0.6);
    roar.connect(roarF).connect(roarG).connect(this.burnGain);
    this.burnGain.connect(this.out);

    // --- Wind rush + altitude whistle ----------------------------------------
    this.windFilter = biquad(ctx, 'bandpass', 600, 0.5);
    this.windGain = gain(ctx);
    const gust = start(ctx.createOscillator());
    gust.frequency.value = 0.23;
    const gustDepth = gain(ctx, 180);
    gust.connect(gustDepth).connect(this.windFilter.frequency);
    track(noiseSource(ctx, noise)).connect(this.windFilter).connect(this.windGain).connect(this.out);

    if (!simple) {
      // Thin, cold whistle that grows with altitude.
      this.whistleFilter = biquad(ctx, 'bandpass', 2600, 18);
      this.whistleGain = gain(ctx);
      const drift = start(ctx.createOscillator());
      drift.frequency.value = 0.17;
      const driftDepth = gain(ctx, 220);
      drift.connect(driftDepth).connect(this.whistleFilter.frequency);
      track(noiseSource(ctx, noise)).connect(this.whistleFilter).connect(this.whistleGain).connect(this.out);

      // --- G-force strain: low groan + airframe creak -----------------------
      this.strainGain = gain(ctx);
      const groan = start(ctx.createOscillator());
      groan.type = 'triangle';
      groan.frequency.value = 55;
      const wob = start(ctx.createOscillator());
      wob.frequency.value = 3.1;
      const wobD = gain(ctx, 6);
      wob.connect(wobD).connect(groan.frequency);
      const creakF = biquad(ctx, 'bandpass', 420, 6);
      track(noiseSource(ctx, noise)).connect(creakF).connect(this.strainGain);
      groan.connect(this.strainGain);
      this.groan = groan;
      this.strainGain.connect(this.out);
    }
  }

  /**
   * @param {{airspeed?:number, thrust?:number, boost?:boolean, altitude?:number, gForce?:number}} s
   * airspeed m/s, thrust 0..1, altitude metres, gForce in g (1 = level flight)
   */
  update(s = {}) {
    const ctx = this.ctx;
    const v = Math.max(0, s.airspeed || 0);
    const thrust = clamp(s.thrust || 0);
    const boost = s.boost ? 1 : 0;
    const alt = Math.max(0, s.altitude || 0);
    const g = Math.abs(s.gForce == null ? 1 : s.gForce);

    // Fan spool: never fully silent while airborne (idle ~ 0.25).
    const spool = 0.25 + 0.75 * thrust + 0.2 * boost;
    const bladeHz = 70 + spool * 230; // blade-pass fundamental
    for (const o of this.blades) glide(o.frequency, bladeHz, ctx, 0.12);
    glide(this.bladeFilter.frequency, 900 + spool * 2600, ctx, 0.1);
    glide(this.bladeGain.gain, 0.035 + 0.06 * spool, ctx, 0.1);
    glide(this.whine.frequency, bladeHz * 7.5, ctx, 0.12);
    glide(this.whineGain.gain, 0.012 + 0.03 * spool, ctx, 0.1);
    glide(this.fanFilter.frequency, 300 + spool * 900, ctx, 0.1);
    glide(this.fanNoiseGain.gain, 0.12 + 0.35 * spool, ctx, 0.08);

    this.burnGain.gain.setTargetAtTime(boost * 0.55, ctx.currentTime, boost ? 0.05 : 0.3);
    if (this.chop) glide(this.chop.frequency, 22 + Math.random() * 25, ctx, 0.05);

    // Wind: roughly speed squared, brightening as it rises.
    const w = clamp((v / 110) ** 2);
    glide(this.windGain.gain, 0.04 + w * 0.5, ctx, 0.15);
    this.windFilter.frequency.setTargetAtTime(380 + v * 14, ctx.currentTime, 0.2);

    if (this.whistleGain) {
      const a = smoothstep(150, 1500, alt);
      glide(this.whistleGain.gain, a * (0.03 + 0.06 * smoothstep(20, 90, v)), ctx, 0.4);
      const st = smoothstep(2.2, 6, g);
      glide(this.strainGain.gain, st * 0.2, ctx, 0.08);
      glide(this.groan.frequency, 50 + st * 30, ctx, 0.1);
    }
  }

  setLevel(v, tc = 0.3) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  dispose() {
    for (const s of this.sources) { try { s.stop(); } catch (e) { /* stopped */ } }
    this.out.disconnect();
  }
}
