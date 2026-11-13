// Minimal synthesized audio, used until the audio team's src/audio/AudioEngine.js lands.
// Same API shape: unlock(), update(state, dt), collision(), ui(name), music.play(), setVolume().

export class AudioEngine {
  constructor() {
    this.ctx = null; this.vol = { master: 0.8, music: 0.6, sfx: 0.9, engine: 1, ui: 1 };
    this.music = { play() {}, stop() {}, setIntensity() {} };
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.out = c.createGain(); this.out.connect(c.destination); this.out.gain.value = this.vol.master;
    // motor whine: two detuned oscillators through a lowpass
    this.motorGain = c.createGain(); this.motorGain.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'sine';
    this.o1.connect(lp); this.o2.connect(lp); lp.connect(this.motorGain); this.motorGain.connect(this.out);
    this.o1.start(); this.o2.start();
    // noise for wind + tyres
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mk = (type, f, q) => {
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = 0; src.connect(fl); fl.connect(g); g.connect(this.out); src.start();
      return g;
    };
    this.wind = mk('lowpass', 600, 0.5);
    this.skid = mk('bandpass', 1400, 4);
    document.addEventListener('visibilitychange', () => { if (document.hidden) c.suspend(); else c.resume(); });
  }

  setVolume(ch, v) { this.vol[ch] = v; if (this.out) this.out.gain.value = this.vol.master; }
  mute(m) { if (this.out) this.out.gain.value = m ? 0 : this.vol.master; }

  update(s, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, sfx = this.vol.sfx;
    const sp = s.speed || 0;
    const f = 90 + sp * 11 + (s.boost ? 120 : 0);
    this.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.o2.frequency.setTargetAtTime(f * 2.02, t, 0.05);
    this.motorGain.gain.setTargetAtTime(sfx * this.vol.engine * (0.03 + 0.06 * (s.throttle || 0) + Math.min(sp / 80, 1) * 0.04), t, 0.08);
    this.wind.gain.setTargetAtTime(sfx * Math.min(sp / 70, 1) * 0.25, t, 0.1);
    this.skid.gain.setTargetAtTime(sfx * Math.min(1, (s.slip || 0)) * (sp > 6 ? 0.22 : 0), t, 0.05);
  }

  _blip(freq, dur, type = 'square', vol = 0.15, slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol * this.vol.sfx * this.vol.ui, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }

  collision(impulse) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 700;
    const g = c.createGain(); g.gain.setValueAtTime(Math.min(1, impulse / 15) * 0.8 * this.vol.sfx, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(fl); fl.connect(g); g.connect(this.out); src.start(t); src.stop(t + 0.4);
  }

  ui(name) {
    const map = { click: [660, 0.05], hover: [880, 0.03, 'sine', 0.05], confirm: [990, 0.12, 'triangle', 0.15, 400], back: [440, 0.08, 'triangle', 0.12, -150],
      countdown: [520, 0.18, 'sine', 0.25], go: [1040, 0.5, 'sine', 0.3], lap: [784, 0.25, 'triangle', 0.2, 200], ring: [1175, 0.18, 'sine', 0.22, 500], transform: [300, 0.4, 'sawtooth', 0.08, 500], unlock: [660, 0.4, 'triangle', 0.2, 660] };
    const m = map[name]; if (m) this._blip(...m);
  }
}

export function mountAudioSettings() {}
