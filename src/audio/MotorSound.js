// Continuous car sound: electric motor whine, inverter hum, tire roll,
// tire squeal/skid, wind, boost thrusters and the low-speed pedestrian
// warning tone (AVAS). Everything is synthesized, nothing is sampled.

import { clamp, smoothstep, noiseSource, biquad, gain, glide } from './util.js';

// How each surface changes rolling noise and skids.
// rollHz: filter centre, roll: loudness, squeal: tire squeal amount,
// grit: loose-material crunch, gritHz: crunch brightness, skidHz: centre of
// the skid noise, rumble: low body shake through the suspension,
// bumpM: spacing of the bumps in metres (the shake's rate is speed / bumpM).
export const SURFACES = {
  asphalt: { rollHz: 320, roll: 0.55, squeal: 1.0, grit: 0.0, gritHz: 2500, skidHz: 1900, rumble: 0.0, bumpM: 3 },
  kerb:    { rollHz: 380, roll: 0.7, squeal: 0.8, grit: 0.0, gritHz: 2500, skidHz: 1700, rumble: 1.0, bumpM: 0.9 },
  dirt:    { rollHz: 900, roll: 1.0, squeal: 0.1, grit: 0.6, gritHz: 1800, skidHz: 900, rumble: 0.45, bumpM: 1.6 },
  gravel:  { rollHz: 1300, roll: 1.0, squeal: 0.0, grit: 1.0, gritHz: 3200, skidHz: 1500, rumble: 0.55, bumpM: 0.7 },
  grass:   { rollHz: 600, roll: 0.75, squeal: 0.0, grit: 0.35, gritHz: 1400, skidHz: 700, rumble: 0.35, bumpM: 2.2 },
  mud:     { rollHz: 380, roll: 0.9, squeal: 0.0, grit: 0.25, gritHz: 700, skidHz: 500, rumble: 0.5, bumpM: 2.5 },
  snow:    { rollHz: 450, roll: 0.6, squeal: 0.0, grit: 0.6, gritHz: 2000, skidHz: 1300, rumble: 0.2, bumpM: 2 },
  sand:    { rollHz: 1200, roll: 0.9, squeal: 0.0, grit: 1.0, gritHz: 4200, skidHz: 1100, rumble: 0.3, bumpM: 2.8 },
  ice:     { rollHz: 260, roll: 0.35, squeal: 0.0, grit: 0.0, gritHz: 2500, skidHz: 2600, rumble: 0.05, bumpM: 4 },
};
// Names the worlds or physics may use, mapped onto the table above.
const ALIASES = { road: 'asphalt', tarmac: 'asphalt', concrete: 'asphalt', track: 'asphalt', curb: 'kerb', rumble: 'kerb', shoulder: 'dirt', runoff: 'dirt', offroad: 'dirt', earth: 'dirt', rock: 'gravel', stone: 'gravel', lawn: 'grass', turf: 'grass', beach: 'sand', desert: 'sand', regolith: 'sand' };
/** Turn any surface name into one of the SURFACES keys. */
export function surfaceKey(name) {
  const n = String(name || 'asphalt').toLowerCase();
  return SURFACES[n] ? n : (ALIASES[n] || 'asphalt');
}

// Motor "orders": the whine is a stack of tones at multiples of motor speed.
// mul = multiple of the base frequency, g = loudness, regen = extra loudness
// when braking (regen braking sounds a bit different from accelerating).
const ORDERS_FULL = [
  { mul: 1, type: 'sine', g: 0.55, regen: 0.4 },
  { mul: 2, type: 'triangle', g: 0.22, regen: 0.2 },
  { mul: 3, type: 'sine', g: 0.12, regen: 0.35 },
  { mul: 6.5, type: 'sine', g: 0.04, regen: 0.08 }, // inverter switching tone
];
const ORDERS_SIMPLE = ORDERS_FULL.slice(0, 2);

export class MotorSound {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination
   * @param {AudioBuffer} noise shared white-noise buffer
   * @param {{simple?: boolean}} opts simple = fewer nodes (remote cars, low quality)
   */
  constructor(ctx, destination, noise, { simple = false } = {}) {
    this.ctx = ctx;
    this.simple = simple;
    this.sources = [];
    this.out = gain(ctx, 1);
    this.out.connect(destination);

    // --- Motor whine -------------------------------------------------------
    this.whineFilter = biquad(ctx, 'lowpass', 3000, 0.7);
    this.whineGain = gain(ctx);
    this.whineFilter.connect(this.whineGain).connect(this.out);

    // A slow, tiny pitch wobble keeps the whine from sounding like a test tone.
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 5.3;
    const wobbleDepth = gain(ctx, 6); // cents
    wobble.connect(wobbleDepth);
    wobble.start();
    this.sources.push(wobble);

    this.orders = (simple ? ORDERS_SIMPLE : ORDERS_FULL).map((o) => {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      osc.frequency.value = 40 * o.mul;
      wobbleDepth.connect(osc.detune);
      const g = gain(ctx);
      osc.connect(g).connect(this.whineFilter);
      osc.start();
      this.sources.push(osc);
      return { ...o, osc, node: g };
    });

    // --- Gear/inverter hum (low, buzzy body under the whine) ---------------
    if (!simple) {
      this.hum = ctx.createOscillator();
      this.hum.type = 'sawtooth';
      this.humFilter = biquad(ctx, 'lowpass', 260, 1.5);
      this.humGain = gain(ctx);
      this.hum.connect(this.humFilter).connect(this.humGain).connect(this.out);
      this.hum.start();
      this.sources.push(this.hum);
    }

    // --- Tire roll ----------------------------------------------------------
    const rollSrc = noiseSource(ctx, noise);
    this.rollFilter = biquad(ctx, 'bandpass', 320, 0.8);
    this.rollGain = gain(ctx);
    rollSrc.connect(this.rollFilter).connect(this.rollGain).connect(this.out);
    this.sources.push(rollSrc);

    // Gravel crunch for loose surfaces: noise chopped by a fast random-ish LFO.
    if (!simple) {
      const gritSrc = noiseSource(ctx, noise);
      this.gritFilter = biquad(ctx, 'bandpass', 2500, 1.2);
      this.gritChop = gain(ctx, 0);
      this.gritGain = gain(ctx);
      const chop = ctx.createOscillator();
      chop.type = 'square';
      chop.frequency.value = 23;
      const chopDepth = gain(ctx, 0.5);
      chop.connect(chopDepth).connect(this.gritChop.gain);
      this.gritChop.gain.value = 0.5;
      gritSrc.connect(this.gritFilter).connect(this.gritChop).connect(this.gritGain).connect(this.out);
      chop.start();
      this.chop = chop;
      this.sources.push(gritSrc, chop);

      // Body rumble: low noise shaken at the rate the tires hit bumps
      // (kerb stripes, ruts, stones), so a rumble strip goes brrrrt.
      const rumbleSrc = noiseSource(ctx, noise);
      this.rumbleFilter = biquad(ctx, 'lowpass', 140, 1.1);
      this.rumbleAm = gain(ctx, 0.5);
      this.bump = ctx.createOscillator();
      this.bump.type = 'triangle';
      this.bump.frequency.value = 10;
      this.bumpDepth = gain(ctx, 0.5);
      this.bump.connect(this.bumpDepth).connect(this.rumbleAm.gain);
      this.rumbleGain = gain(ctx);
      rumbleSrc.connect(this.rumbleFilter).connect(this.rumbleAm).connect(this.rumbleGain).connect(this.out);
      this.bump.start();
      this.sources.push(rumbleSrc, this.bump);
    }

    // --- Skid: squeal tone + scrubbing noise --------------------------------
    const skidSrc = noiseSource(ctx, noise);
    this.skidFilter = biquad(ctx, 'bandpass', 1900, 3);
    this.skidNoiseGain = gain(ctx);
    skidSrc.connect(this.skidFilter).connect(this.skidNoiseGain).connect(this.out);
    this.sources.push(skidSrc);

    this.squeal = ctx.createOscillator();
    this.squeal.type = 'sawtooth';
    this.squeal.frequency.value = 820;
    const squealFilter = biquad(ctx, 'bandpass', 1000, 9);
    this.squealGain = gain(ctx);
    // Irregular vibrato: two detuned LFOs summed sound less mechanical.
    for (const [rate, depth] of [[7.1, 35], [11.7, 22]]) {
      const l = ctx.createOscillator();
      l.frequency.value = rate;
      const d = gain(ctx, depth);
      l.connect(d).connect(this.squeal.frequency);
      l.start();
      this.sources.push(l);
    }
    this.squeal.connect(squealFilter).connect(this.squealGain).connect(this.out);
    this.squeal.start();
    this.sources.push(this.squeal);

    // --- Wind ----------------------------------------------------------------
    if (!simple) {
      const windSrc = noiseSource(ctx, noise);
      this.windFilter = biquad(ctx, 'bandpass', 500, 0.6);
      this.windGain = gain(ctx);
      // Slow gusting so wind at speed feels alive.
      const gust = ctx.createOscillator();
      gust.frequency.value = 0.31;
      const gustDepth = gain(ctx, 120);
      gust.connect(gustDepth).connect(this.windFilter.frequency);
      gust.start();
      windSrc.connect(this.windFilter).connect(this.windGain).connect(this.out);
      this.sources.push(windSrc, gust);

      // --- Boost thrusters (cold-gas rocket package) -------------------------
      const boostSrc = noiseSource(ctx, noise);
      this.boostFilter = biquad(ctx, 'bandpass', 700, 0.5);
      this.boostGain = gain(ctx);
      const rumble = ctx.createOscillator();
      rumble.type = 'sawtooth';
      rumble.frequency.value = 48;
      const rumbleFilter = biquad(ctx, 'lowpass', 140, 1);
      const rumbleGain = gain(ctx, 0.5);
      rumble.connect(rumbleFilter).connect(rumbleGain).connect(this.boostGain);
      boostSrc.connect(this.boostFilter).connect(this.boostGain).connect(this.out);
      rumble.start();
      this.sources.push(boostSrc, rumble);

      // --- AVAS: soft two-tone pedestrian warning at low speed ---------------
      this.avasGain = gain(ctx);
      const avasFilter = biquad(ctx, 'lowpass', 900, 0.7);
      avasFilter.connect(this.avasGain).connect(this.out);
      this.avas = [0, 7, 12].map((semi) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 196 * Math.pow(2, semi / 12);
        o.connect(avasFilter);
        o.start();
        this.sources.push(o);
        return { o, semi };
      });
    }

    this.state = { speed: 0, throttle: 0, brake: 0, slip: 0, surface: 'asphalt', boost: false, airborne: false };
  }

  /**
   * @param {{speed?:number, throttle?:number, brake?:number, slip?:number,
   *          surface?:string, boost?:boolean, airborne?:boolean}} s
   *   airborne: wheels off the ground, so tire roll, crunch and skids go quiet
   */
  update(s = {}) {
    const ctx = this.ctx;
    const st = Object.assign(this.state, s);
    const v = Math.abs(st.speed || 0); // m/s
    const throttle = clamp(st.throttle || 0);
    const brake = clamp(st.brake || 0);
    const surf = SURFACES[surfaceKey(st.surface)];
    const tc = 0.04;
    const ground = st.airborne ? 0 : 1; // tires only make noise when touching something

    // Motor speed: single-speed gearbox, so pitch tracks road speed directly.
    // ~35 Hz at a crawl, ~1 kHz near top speed (~110 m/s).
    const baseHz = 35 + v * 8.6;
    const regen = brake > 0.05 && v > 1 ? brake : 0;
    const load = Math.max(throttle, regen * 0.7);
    const moving = smoothstep(0.2, 4, v);
    const whine = moving * (0.18 + 0.82 * load) * (0.7 + 0.3 * smoothstep(0, 60, v));

    for (const o of this.orders) {
      glide(o.osc.frequency, baseHz * o.mul, ctx, 0.03);
      glide(o.node.gain, o.g + regen * o.regen, ctx, tc);
    }
    glide(this.whineGain.gain, whine * 0.32, ctx, tc);
    glide(this.whineFilter.frequency, 1400 + load * 5200 + v * 20, ctx, tc);

    if (this.hum) {
      glide(this.hum.frequency, 22 + v * 2.1, ctx, 0.03);
      glide(this.humGain.gain, moving * (0.05 + 0.22 * load), ctx, tc);
    }

    // Tire roll grows with speed and depends on the surface.
    const roll = smoothstep(0, 35, v) * surf.roll * ground;
    glide(this.rollFilter.frequency, surf.rollHz + v * 9, ctx, 0.1);
    glide(this.rollGain.gain, roll * 0.22, ctx, 0.08);
    if (this.gritGain) {
      glide(this.gritGain.gain, smoothstep(0.5, 25, v) * surf.grit * 0.16 * ground, ctx, 0.08);
      glide(this.gritFilter.frequency, surf.gritHz + v * 12, ctx, 0.1);
      glide(this.chop.frequency, 12 + v * 1.4, ctx, 0.1);
    }
    if (this.rumbleGain) {
      // Bumps per second = speed / spacing; capped so it stays a rumble, not a tone.
      glide(this.bump.frequency, clamp(v / surf.bumpM, 2, 70), ctx, 0.05);
      glide(this.rumbleFilter.frequency, 90 + v * 1.5, ctx, 0.1);
      glide(this.rumbleGain.gain, smoothstep(1, 18, v) * surf.rumble * 0.5 * ground, ctx, 0.05);
    }

    // Skids: slip 0..1 is how hard the tires are sliding.
    const skid = smoothstep(0.12, 0.75, st.slip || 0) * smoothstep(1, 6, v) * ground;
    glide(this.squealGain.gain, skid * surf.squeal * 0.18, ctx, 0.03);
    glide(this.squeal.frequency, 760 + v * 2.5 + (st.slip || 0) * 180, ctx, 0.05);
    glide(this.skidNoiseGain.gain, skid * (0.12 + surf.grit * 0.35), ctx, 0.03);
    glide(this.skidFilter.frequency, surf.skidHz, ctx, 0.1);

    if (this.windGain) {
      // Aerodynamic noise rises roughly with the square of speed.
      const w = clamp((v / 75) ** 2);
      glide(this.windGain.gain, w * 0.45, ctx, 0.15);
      glide(this.windFilter.Q, 0.6 + w * 0.4, ctx, 0.2);
      this.windFilter.frequency.setTargetAtTime(350 + v * 22, ctx.currentTime, 0.2);

      const b = st.boost ? 1 : 0;
      this.boostGain.gain.setTargetAtTime(b * 0.5, ctx.currentTime, b ? 0.04 : 0.25);
      glide(this.boostFilter.frequency, 500 + v * 6, ctx, 0.1);

      // AVAS only plays while creeping, like a real EV in a car park.
      const avas = v > 0.3 && v < 9 ? 0.05 * (1 - v / 9) : 0;
      glide(this.avasGain.gain, avas, ctx, 0.2);
      const bend = Math.pow(2, (v * 0.6) / 12); // gently rises with speed
      for (const a of this.avas) glide(a.o.frequency, 196 * Math.pow(2, a.semi / 12) * bend, ctx, 0.1);
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
