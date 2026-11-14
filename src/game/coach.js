// First-race coaching. Whatever mode a new player picks first, short prompts show up the
// moment they are needed (drive, hop the ring, missed a ring, wrong way) in the words of the
// device they are holding, then get out of the way. It runs until the player has seen the
// basics once (profile.coached), and the card's Skip button ends it for good.

const DEVICE_KEYS = {
  keyboard: { drive: 'W', steer: 'A D', jet: 'Space', brake: 'S', drift: 'Space', reset: 'R' },
  gamepad: { drive: 'RT', steer: 'Left stick', jet: 'A', brake: 'LT', drift: 'A', reset: 'Back' },
  touch: { drive: 'GO', steer: 'Drag left side', jet: 'JET', brake: 'BRAKE', drift: 'DRIFT', reset: '↺' },
};

// text(k, touch) builds the line from the device's key names.
const HOP_STEPS = [
  { id: 'drive', when: (r) => r.state === 'race',
    text: (k, t) => t ? 'Hold GO to drive. Drag on the left side of the screen to steer.' : `Hold ${k.drive} to drive. Steer with ${k.steer}.`,
    keys: (k) => `${k.drive} + ${k.steer}`,
    done: (r) => r.player.v.speed > 18 },
  { id: 'jet', when: (r) => r.ringAhead && r.ringAhead() < 170,
    text: (k, t) => t ? 'Ring ahead! Hold JET at the blue marks on the road to hop through it.' : `Ring ahead! Hold ${k.jet} at the blue marks on the road to fire the jets and hop through it.`,
    keys: (k) => k.jet,
    done: (r, c) => c.ring != null },
  { id: 'rings', when: () => true,
    text: (k, t, c) => c.ring
      ? 'Nice! Every ring refills your jets. String them together for a combo.'
      : 'Missed it? No need to turn back: the next ring counts. Fire where JET is painted on the road.',
    keys: () => '',
    done: (r, c) => c.stepT > 4.5 },
];

const GROUND_STEPS = [
  { id: 'drive', when: (r) => r.state === 'race',
    text: (k, t) => t ? 'Hold GO to drive. Drag on the left side of the screen to steer.' : `Hold ${k.drive} to drive. Steer with ${k.steer}.`,
    keys: (k) => `${k.drive} + ${k.steer}`,
    done: (r) => r.player.v.speed > 18 },
  { id: 'corner', when: (r) => r.cornerAhead && r.cornerAhead(),
    text: (k, t) => t ? 'Corner ahead: ease off GO or tap BRAKE. Hold DRIFT to slide through.' : `Corner ahead: brake with ${k.brake}, or hold ${k.drift} while steering to drift.`,
    keys: (k) => `${k.brake} / ${k.drift}`,
    done: (r, c) => c.stepT > 5 },
];

export class Coach {
  constructor(race, kind) {
    this.race = race;
    this.steps = kind === 'hop' ? HOP_STEPS : GROUND_STEPS;
    this.i = 0; this.shown = null; this.stepT = 0; this.ring = null;
    this.resetShown = false; this.finished = false; this.okT = 0;
  }

  get ui() { return this.race.game.ui.tutorial; }

  device() {
    const inp = this.race.game.input;
    if (inp.lastDevice === 'touch' || (inp.lastDevice !== 'gamepad' && matchMedia('(pointer: coarse)').matches)) return 'touch';
    return inp.lastDevice === 'gamepad' ? 'gamepad' : 'keyboard';
  }

  show(id, text, keys) {
    const touch = this.device() === 'touch';
    this.shown = id;
    if (this.ui && this.ui.show) this.ui.show({ id, text, keyHint: touch ? '' : keys, step: 0 });
  }

  /** Something happened in the race: 'ring' with hit true/false. */
  event(type, value) {
    if (type === 'ring' && this.ring == null) this.ring = !!value;
  }

  stop(skip = false) {
    if (this.finished) return;
    this.finished = true;
    const g = this.race.game;
    g.profile.coached = true; g.save();
    if (skip) return;
    if (this.ui && this.ui.done && this.shown) this.ui.done(this.shown);
  }

  update(dt) {
    if (this.finished) return;
    const r = this.race;
    if (r.state === 'finished' || r.player.finished) { this.stop(); return; }
    const dev = this.device(), k = DEVICE_KEYS[dev], touch = dev === 'touch';

    // Lost? This one can interrupt any step, and comes back if needed.
    const lost = r.state === 'race' && this.i > 0 && r.player.wrongT > 1.6;
    if (lost && this.shown !== 'reset') {
      this.show('reset', touch ? 'Turned around? Tap ↺ next to pause to jump back onto the road.' : `Turned around? Press ${k.reset} to jump back onto the road, facing the right way.`, k.reset);
      this.okT = 0; return;
    }
    if (this.shown === 'reset') {
      this.okT = r.player.wrongT === 0 ? this.okT + dt : 0;
      if (this.okT < 1) return;
      this.ui && this.ui.done && this.ui.done('reset');
      this.shown = null;
    }

    const st = this.steps[this.i];
    if (!st) { this.stop(); return; }
    if (this.shown !== st.id) {
      if (!st.when(r, this)) return;
      this.stepT = 0;
      this.show(st.id, st.text(k, touch, this), st.keys(k));
    }
    this.stepT += dt;
    if (st.done(r, this)) {
      this.ui && this.ui.done && this.ui.done(st.id);
      this.shown = null; this.i++;
      if (this.i >= this.steps.length) this.stop(true);
    }
  }
}
