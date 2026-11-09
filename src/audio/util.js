// Small shared helpers for the audio system.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// Smooth 0..1 ramp between edge0 and edge1.
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz).
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Tiny deterministic RNG so generated melodies repeat like real songs.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2 seconds of white noise, shared by every noise-based sound.
export function makeNoiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Synthetic stereo reverb impulse: decaying noise, darker over time.
export function makeImpulse(ctx, seconds = 2.4, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.15 + 0.8 * t; // more low-pass as the tail goes on
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

// Looping noise source starting at a random offset (decorrelates layers).
export function noiseSource(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start(0, Math.random() * buffer.duration);
  return src;
}

export function biquad(ctx, type, frequency, Q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  return f;
}

export function gain(ctx, value = 0) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

// Glide a parameter toward a value; tc is the time constant in seconds.
export function glide(param, value, ctx, tc = 0.05) {
  param.setTargetAtTime(value, ctx.currentTime, tc);
}
