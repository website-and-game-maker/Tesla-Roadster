// Original, fully synthesized soundtrack. A step sequencer schedules notes a
// little ahead of time on the audio clock, so timing stays tight even when the
// game's frame rate dips. Each song has layers (pad, bass, drums, arp, lead)
// that fade in as "intensity" rises, so the music reacts to the race.

import { clamp, smoothstep, mtof, mulberry32, biquad, gain } from './util.js';

const CHORDS = {
  m: [0, 3, 7], M: [0, 4, 7], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11],
  sus2: [0, 2, 7], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14],
};
const PENTA_MINOR = [0, 3, 5, 7, 10];
const PENTA_MAJOR = [0, 2, 4, 7, 9];

// Songs. root = MIDI note of the key centre; progressions are [semitones above
// root, chord quality]; each section is played `repeat` times before moving on.
export const SONGS = {
  // Garage / main menu: slow, wide, nocturnal.
  menu: {
    bpm: 88, root: 45, scale: PENTA_MINOR, barsPerChord: 2, style: 'chill', seed: 11,
    sections: [
      { prog: [[0, 'm9'], [8, 'M7'], [3, 'M7'], [10, 'add9']], repeat: 1 },
      { prog: [[5, 'm7'], [8, 'M7'], [0, 'm9'], [7, 'sus2']], repeat: 1 },
    ],
  },
  // Racing: driving synthwave.
  race: {
    bpm: 124, root: 40, scale: PENTA_MINOR, barsPerChord: 1, style: 'drive', seed: 42,
    sections: [
      { prog: [[0, 'm'], [8, 'M'], [10, 'M'], [5, 'm']], repeat: 2 },
      { prog: [[8, 'M7'], [10, 'M'], [0, 'm7'], [7, 'sus2']], repeat: 2 },
      { prog: [[0, 'm'], [3, 'M'], [10, 'M'], [8, 'M7']], repeat: 2 },
    ],
  },
  // Flight: soaring and anthemic. Major key, half-time drums, big open chords.
  flight: {
    bpm: 112, root: 50, scale: PENTA_MAJOR, barsPerChord: 1, style: 'soar', seed: 2027,
    sections: [
      { prog: [[5, 'add9'], [0, 'M'], [7, 'sus2'], [9, 'm7']], repeat: 2 },
      { prog: [[0, 'add9'], [7, 'M'], [9, 'm7'], [5, 'M7']], repeat: 2 },
      { prog: [[9, 'm7'], [5, 'add9'], [0, 'M'], [7, 'sus2']], repeat: 2 },
    ],
  },
  // Results / podium: brighter, major key.
  results: {
    bpm: 100, root: 41, scale: PENTA_MAJOR, barsPerChord: 1, style: 'bright', seed: 7,
    sections: [
      { prog: [[0, 'M7'], [9, 'm7'], [5, 'M7'], [7, 'sus2']], repeat: 2 },
    ],
  },
};

// Drum and bass patterns per style (16 steps per bar).
const STYLE = {
  chill: {
    kick: [0, 10], snare: [], hat: [4, 12], openHat: [], bass: [[0, 6], [8, 8]],
    arpEvery: 2, swing: 0.08,
  },
  drive: {
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], openHat: [14],
    bass: [[0, 2, 0], [2, 2, 0], [4, 2, 12], [6, 2, 0], [8, 2, 0], [10, 2, 12], [12, 2, 0], [14, 2, 7]],
    arpEvery: 1, swing: 0,
  },
  soar: {
    kick: [0, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], openHat: [6, 14],
    bass: [[0, 6, 0], [6, 2, 12], [8, 6, 0], [14, 2, 7]],
    arpEvery: 2, swing: 0,
  },
  bright: {
    kick: [0, 7, 8], snare: [4, 12], hat: [2, 6, 10, 14], openHat: [],
    bass: [[0, 3, 0], [3, 3, 0], [6, 2, 7], [8, 3, 0], [11, 3, 0], [14, 2, 12]],
    arpEvery: 2, swing: 0.12,
  },
};

export class MusicPlayer {
  constructor(ctx, destination, noise, reverb) {
    this.ctx = ctx;
    this.noise = noise;
    this.song = null;
    this.name = null;
    this.playing = false;
    this.intensity = 0.5;
    this.targetIntensity = 0.5;
    this.quality = 'high';

    // fade -> destination; layers -> mix -> fade
    this.fade = gain(ctx, 0);
    this.fade.connect(destination);
    this.mix = gain(ctx, 1.4);
    this.mix.connect(this.fade);

    this.reverbSend = gain(ctx, 0.35);
    if (reverb) {
      this.reverbSend.connect(reverb);
      reverb.connect(this.fade);
    }

    // Tempo-synced echo for arps and lead.
    this.delay = ctx.createDelay(2);
    this.delayFb = gain(ctx, 0.32);
    this.delayOut = gain(ctx, 0.3);
    const delayTone = biquad(ctx, 'lowpass', 2600, 0.5);
    this.delay.connect(delayTone).connect(this.delayFb).connect(this.delay);
    delayTone.connect(this.delayOut).connect(this.mix);

    this.layers = {};
    for (const name of ['pad', 'bass', 'kick', 'perc', 'arp', 'lead']) {
      const g = gain(ctx, 0);
      g.connect(this.mix);
      this.layers[name] = g;
    }
    this.layers.arp.connect(this.delay);
    this.layers.lead.connect(this.delay);

    this.timer = null;
  }

  /** Start a song by name ('menu' | 'race' | 'flight' | 'results'), crossfading. */
  play(name = 'menu') {
    const song = SONGS[name];
    if (!song) return;
    if (this.playing && this.name === name) return;
    const ctx = this.ctx;
    const start = () => {
      this.name = name;
      this.song = song;
      this.step = 0;
      this.nextTime = ctx.currentTime + 0.08;
      this.phraseCache = new Map();
      this.delay.delayTime.value = (60 / song.bpm) * 0.75; // dotted eighth
      this.fade.gain.cancelScheduledValues(ctx.currentTime);
      this.fade.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
      this._applyLayers(true);
    };
    if (this.playing && this.song) {
      this.fade.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      this.song = null; // pause scheduling during fade-out
      clearTimeout(this._swap);
      this._swap = setTimeout(start, 900);
    } else {
      start();
    }
    this.playing = true;
    this._ensureTimer();
  }

  stop(fadeSeconds = 1) {
    this.playing = false;
    clearTimeout(this._swap);
    this.fade.gain.setTargetAtTime(0, this.ctx.currentTime, Math.max(0.01, fadeSeconds / 3));
    setTimeout(() => { if (!this.playing) { this.song = null; this.name = null; } }, fadeSeconds * 1000);
  }

  /** 0 = calm (pads only) ... 1 = everything. Smoothly followed. */
  setIntensity(x) {
    this.targetIntensity = clamp(x);
  }

  setQuality(q) {
    this.quality = q;
    this.reverbSend.gain.value = q === 'low' ? 0 : 0.35;
  }

  _ensureTimer() {
    if (this.timer || typeof setInterval === 'undefined') return;
    this.timer = setInterval(() => this.scheduleUntil(this.ctx.currentTime + 0.15), 25);
  }

  _layerTargets(i) {
    const style = this.song ? this.song.style : 'drive';
    const chill = style === 'chill';
    return {
      pad: 0.55 - 0.15 * smoothstep(0.6, 1, i),
      bass: smoothstep(0.05, 0.3, i) * 0.9,
      kick: smoothstep(0.25, 0.45, i) * (chill ? 0.6 : 1),
      perc: smoothstep(0.45, 0.65, i) * (chill ? 0.55 : 0.9),
      arp: smoothstep(0.35, 0.6, i) * 0.55,
      lead: smoothstep(0.7, 0.9, i) * 0.5,
    };
  }

  _applyLayers(instant) {
    const targets = this._layerTargets(this.intensity);
    this.levels = targets;
    for (const k in targets) {
      const p = this.layers[k].gain;
      if (instant) p.setValueAtTime(targets[k], this.ctx.currentTime);
      else p.setTargetAtTime(targets[k], this.ctx.currentTime, 0.5);
    }
  }

  /** Schedule all notes up to time `until` (public so it can be rendered offline). */
  scheduleUntil(until) {
    if (!this.song) return;
    const ctx = this.ctx;
    // Ease intensity toward its target so layers swell rather than pop.
    this.intensity += (this.targetIntensity - this.intensity) * 0.08;
    this._applyLayers(false);

    // After the tab was hidden, the clock may have jumped: don't play a backlog.
    if (this.nextTime < ctx.currentTime - 0.05) this.nextTime = ctx.currentTime + 0.05;

    const song = this.song;
    const style = STYLE[song.style];
    const sixteenth = 60 / song.bpm / 4;
    while (this.nextTime < until) {
      const swing = this.step % 2 === 1 ? style.swing * sixteenth * 2 : 0;
      this._playStep(this.step, this.nextTime + swing, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  // Which section, chord and position a step falls on.
  _position(step) {
    const song = this.song;
    const bar = Math.floor(step / 16);
    let total = 0;
    for (const sec of song.sections) total += sec.prog.length * song.barsPerChord * sec.repeat;
    let b = bar % total;
    let sIdx = 0;
    for (; sIdx < song.sections.length; sIdx++) {
      const len = song.sections[sIdx].prog.length * song.barsPerChord * song.sections[sIdx].repeat;
      if (b < len) break;
      b -= len;
    }
    const sec = song.sections[sIdx];
    const chordBar = Math.floor(b / song.barsPerChord) % sec.prog.length;
    const [rootOff, quality] = sec.prog[chordBar];
    return {
      bar, sIdx, barInSection: b, s16: step % 16,
      chordRoot: song.root + rootOff, chord: CHORDS[quality],
      chordStart: b % song.barsPerChord === 0 && step % 16 === 0,
      chordBars: song.barsPerChord,
    };
  }

  _playStep(step, t, sixteenth) {
    const song = this.song;
    const style = STYLE[song.style];
    const pos = this._position(step);
    const L = this.levels;
    const on = (k) => L[k] > 0.02;
    const s = pos.s16;

    // Crash + section marker when a new section starts in an energetic state.
    if (pos.barInSection === 0 && s === 0 && step > 0 && L.perc > 0.3) this._crash(t);

    if (pos.chordStart && on('pad')) {
      const notes = pos.chord.map((iv) => pos.chordRoot + 12 + iv);
      this._pad(t, notes, sixteenth * 16 * pos.chordBars);
    }
    if (on('bass')) {
      for (const [st, len, off] of style.bass) {
        if (st === s) this._bass(t, pos.chordRoot - 12 + (off || 0), sixteenth * len * 0.95);
      }
    }
    if (on('kick') && style.kick.includes(s)) this._kick(t);
    if (on('perc')) {
      if (style.snare.includes(s)) this._snare(t);
      if (style.hat.includes(s)) this._hat(t, style.openHat.includes(s));
      else if (song.style === 'drive' && this.intensity > 0.8) this._hat(t, false, 0.35);
    }
    if (on('arp') && s % style.arpEvery === 0) {
      // Up-down pattern across two octaves of the current chord.
      const tones = [];
      for (const o of [0, 12]) for (const iv of pos.chord) tones.push(pos.chordRoot + 24 + o + iv);
      const cycle = tones.concat(tones.slice(1, -1).reverse());
      const idx = (step / style.arpEvery) % cycle.length;
      this._arp(t, cycle[Math.floor(idx)], sixteenth * style.arpEvery * 0.9);
    }
    if (on('lead')) {
      const phrase = this._phrase(step, pos);
      const n = phrase.get(step % 32);
      if (n) this._lead(t, n.midi, n.len * sixteenth);
    }
  }

  // Two-bar melodies. Seeds repeat in an A A' B A shape so the tune is
  // memorable instead of random noodling.
  _phrase(step, pos) {
    const phraseIdx = Math.floor(step / 32);
    const shape = [0, 1, 2, 0][phraseIdx % 4];
    const key = `${pos.sIdx}:${shape}:${pos.chordRoot}`;
    if (this.phraseCache.has(key)) return this.phraseCache.get(key);
    const rng = mulberry32(this.song.seed * 1000 + pos.sIdx * 31 + shape * 7);
    const scale = this.song.scale;
    const base = this.song.root + 24;
    const notes = new Map();
    let deg = Math.floor(rng() * scale.length);
    let s = 0;
    while (s < 32) {
      const strong = s % 4 === 0;
      if (rng() < (strong ? 0.85 : 0.45) || s === 0) {
        const len = [2, 2, 3, 4, 6][Math.floor(rng() * 5)];
        deg += Math.round((rng() - 0.5) * 4);
        deg = clamp(deg, -2, scale.length * 2 - 1);
        const oct = Math.floor(deg / scale.length);
        const iv = scale[((deg % scale.length) + scale.length) % scale.length];
        let midi = base + oct * 12 + iv;
        // On strong beats, snap to the nearest chord tone for consonance.
        if (strong) {
          let best = midi, bestD = 99;
          for (const o of [-12, 0, 12]) for (const c of pos.chord) {
            const cand = pos.chordRoot + 24 + o + c;
            const d = Math.abs(cand - midi);
            if (d < bestD) { bestD = d; best = cand; }
          }
          midi = best;
        }
        notes.set(s, { midi, len: Math.min(len, 32 - s) });
        s += len;
      } else {
        s += 1;
      }
    }
    this.phraseCache.set(key, notes);
    return notes;
  }

  // ---- Instruments -------------------------------------------------------

  _env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return t + attack + hold + release + 0.05;
  }

  _pad(t, notes, dur) {
    const ctx = this.ctx;
    const f = biquad(ctx, 'lowpass', 900, 0.6);
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1600, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(900, t + dur);
    const g = gain(ctx, 0);
    const end = this._env(g, t, 0.07, Math.min(0.8, dur * 0.3), dur * 0.55, 1.2);
    f.connect(g);
    g.connect(this.layers.pad);
    const send = gain(ctx, 1);
    g.connect(send).connect(this.reverbSend);
    const detunes = this.quality === 'low' ? [0] : [-9, 8];
    for (const n of notes) {
      for (const d of detunes) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = d;
        o.connect(f);
        o.start(t);
        o.stop(end);
      }
    }
  }

  _bass(t, midi, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(midi);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = mtof(midi - 12);
    const f = biquad(ctx, 'lowpass', 300, 4);
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(260, t + Math.min(0.25, dur));
    const g = gain(ctx, 0);
    const subG = gain(ctx, 0.6);
    const end = this._env(g, t, 0.28, 0.006, dur * 0.7, 0.08);
    o.connect(f).connect(g);
    sub.connect(subG).connect(g);
    g.connect(this.layers.bass);
    o.start(t); sub.start(t);
    o.stop(end); sub.stop(end);
  }

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = gain(ctx, 0);
    const end = this._env(g, t, 0.9, 0.002, 0.02, 0.32);
    o.connect(g).connect(this.layers.kick);
    o.start(t);
    o.stop(end);
    // Duck the pad and bass a touch on each kick (sidechain pump).
    for (const k of ['pad', 'bass']) {
      const p = this.layers[k].gain;
      const lvl = this.levels[k];
      p.setTargetAtTime(lvl * 0.55, t, 0.005);
      p.setTargetAtTime(lvl, t + 0.06, 0.09);
    }
  }

  _noiseHit(t, type, freq, level, decay, out, Q = 0.8) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = biquad(ctx, type, freq, Q);
    const g = gain(ctx, 0);
    const end = this._env(g, t, level, 0.001, 0.0, decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * (this.noise.duration - 1));
    src.stop(end);
    return g;
  }

  _snare(t) {
    const g = this._noiseHit(t, 'highpass', 1400, 0.32, 0.17, this.layers.perc);
    const s = gain(this.ctx, 0.5);
    g.connect(s).connect(this.reverbSend);
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = gain(ctx, 0);
    const end = this._env(og, t, 0.25, 0.001, 0, 0.09);
    o.connect(og).connect(this.layers.perc);
    o.start(t); o.stop(end);
  }

  _hat(t, open, level = 1) {
    this._noiseHit(t, 'highpass', 7500, 0.13 * level, open ? 0.2 : 0.035, this.layers.perc, 0.7);
  }

  _crash(t) {
    const g = this._noiseHit(t, 'highpass', 4500, 0.12, 1.6, this.layers.perc, 0.5);
    const s = gain(this.ctx, 0.6);
    g.connect(s).connect(this.reverbSend);
  }

  _arp(t, midi, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(midi);
    const f = biquad(ctx, 'lowpass', 2200, 2);
    f.frequency.setValueAtTime(3800, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = gain(ctx, 0);
    const end = this._env(g, t, 0.06, 0.003, 0, Math.max(0.08, dur));
    o.connect(f).connect(g).connect(this.layers.arp);
    o.start(t); o.stop(end);
  }

  _lead(t, midi, dur) {
    const ctx = this.ctx;
    const f = biquad(ctx, 'lowpass', 2400, 1.2);
    const g = gain(ctx, 0);
    const end = this._env(g, t, 0.09, 0.02, Math.max(0, dur - 0.08), 0.25);
    f.connect(g).connect(this.layers.lead);
    const s = gain(ctx, 0.6);
    g.connect(s).connect(this.reverbSend);
    // Delayed vibrato, like a player leaning into a held note.
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibG = gain(ctx, 0);
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.linearRampToValueAtTime(14, t + Math.min(0.4, dur));
    vib.connect(vibG);
    vib.start(t); vib.stop(end);
    for (const d of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(midi);
      o.detune.value = d;
      vibG.connect(o.detune);
      o.connect(f);
      o.start(t); o.stop(end);
    }
  }

  dispose() {
    clearInterval(this.timer);
    clearTimeout(this._swap);
    this.timer = null;
    this.fade.disconnect();
  }
}
