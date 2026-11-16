// First-race coach: teaches the controls inside whatever race the player picked first.
//
// One short card at a time, shown at the moment that control is useful (a ring is coming up,
// a sharp corner is ahead, the car is stuck), worded for the device in the player's hands.
// A card goes away as soon as the player does the thing. Anything the player already does
// without being told is ticked off silently and never shown. Progress is kept in
// profile.coach, so the coach fades out for good once every control has been used.
//
// The coach never changes the race: no pausing, no slow motion, no input blocking.

const OK = 'ok';
const NBSP = ' ';

/**
 * text / keys per device. keys: groups split by " / " (shown as "or"), keys in a group by a space.
 * touchBtn: the on-screen control to pulse on phones.
 */
const COPY = {
  drive: {
    keyboard: ['Hold W or ↑ to drive.', 'W / ↑'],
    gamepad: ['Hold RT to drive.', 'RT'],
    touch: ['Hold GO to drive.'], touchBtn: 'throttle',
  },
  steer: {
    keyboard: ['Steer with A and D, or the arrow keys.', 'A D / ← →'],
    gamepad: ['Steer with the left stick.', `Left${NBSP}stick`],
    touch: ['Drag left or right on the left side of the screen to steer.'], touchBtn: 'steer',
    tilt: ['Tilt your device left or right to steer.'],
  },
  jet: {
    keyboard: ['Hold Space to fire the jets and hop. Tap for a small hop, hold to go higher.', 'Space'],
    gamepad: ['Hold A to fire the jets and hop. Tap for a small hop, hold to go higher.', 'A'],
    touch: ['Hold JET to hop. Tap for a small hop, hold to go higher.'], touchBtn: 'handbrake',
  },
  ring: {
    keyboard: ['Bonus ring ahead! Hold Space at the blue JET marks on the road to hop through it.', 'Space'],
    gamepad: ['Bonus ring ahead! Hold A at the blue JET marks on the road to hop through it.', 'A'],
    touch: ['Bonus ring ahead! Hold JET at the blue marks on the road to hop through it.'], touchBtn: 'handbrake',
  },
  gap: {
    keyboard: ['The road ends ahead! Hold Space to jet across the gap.', 'Space'],
    gamepad: ['The road ends ahead! Hold A to jet across the gap.', 'A'],
    touch: ['The road ends ahead! Hold JET to fly across the gap.'], touchBtn: 'handbrake',
  },
  refill: { all: ['Nice! Rings are a bonus: each one refills your jets. The JETS bar also refills by itself while you drive on the road.'] },
  empty: { all: ['Jets empty. They refill by themselves while your wheels are on the road, and every ring tops them up.'] },
  missed: { all: ['Missed that ring? No problem. Rings are only a bonus, so keep racing and never turn back for one.'] },
  offroad: { all: ['Grass, dirt and gravel slow you down. Get back on the road to go fast.'] },
  brake: {
    keyboard: ['Sharp corner ahead. Hold S or ↓ to brake.', 'S / ↓'],
    gamepad: ['Sharp corner ahead. Hold LT to brake.', 'LT'],
    touch: ['Sharp corner ahead. Hold BRAKE to slow down.'], touchBtn: 'brake',
  },
  drift: {
    keyboard: ['Hold Space while turning to drift round the corner.', 'Space'],
    gamepad: ['Hold A while turning to drift round the corner.', 'A'],
    touch: ['Hold DRIFT while turning to slide round the corner.'], touchBtn: 'handbrake',
  },
  boost: {
    keyboard: ['Boost is charged. Hold Shift while driving for a burst of speed.', 'Shift'],
    gamepad: ['Boost is charged. Hold X while driving for a burst of speed.', 'X'],
    touch: ['Boost is charged. Hold ⚡ while driving for a burst of speed.'], touchBtn: 'boost',
  },
  reset: {
    keyboard: ['Stuck or facing the wrong way? Press R to jump back onto the road.', 'R'],
    gamepad: ['Stuck or facing the wrong way? Press Back to jump back onto the road.', 'Back'],
    touch: ['Stuck or facing the wrong way? Tap ↺ at the top to jump back onto the road.'], touchBtn: 'reset',
  },
  outro: {
    keyboard: ['That\'s every control. Press Esc any time to see them again.'],
    gamepad: ['That\'s every control. Press Start any time to see them again.'],
    touch: ['That\'s every control. Tap ❚❚ any time to see them again.'],
  },
};

/**
 * Lessons, in the order they are offered when several are ready at once.
 *  when(s)   the moment the card is useful
 *  done(s)   the player did it (also checked while the card is hidden: silent tick)
 *  gone(s)   the moment has passed, hide the card and offer it again later
 *  urgent    may replace a card that is not urgent
 *  info      nothing to do: shows for `secs` and is then learned
 *  max       how many times it may be offered before the coach stops insisting
 */
const LESSONS = [
  { id: 'reset', urgent: true, max: 3, secs: 9,
    when: (s) => s.stuckT > 2.5 || s.wrongT > 1.2,
    done: (s) => s.resetPressed,
    gone: (s) => s.movingT > 1.2 && s.wrongT === 0 },
  { id: 'gap', hop: true, urgent: true, max: 3, secs: 5, shownOnly: true,
    when: (s) => s.ground && s.gapAhead,
    done: (s, c) => c.shownHops != null && s.hops > c.shownHops,
    gone: (s) => !s.gapAhead && s.ground },
  { id: 'ring', hop: true, urgent: true, max: 5, secs: 8,
    when: (s) => s.ground && s.ringAhead > 25 && s.ringAhead < Math.max(110, s.speed * 3.6),
    done: (s) => s.rings >= 1,
    gone: (s, c) => s.ringIndex !== c.shownRing },
  // good-to-know cards, right after the thing they explain just happened
  { id: 'refill', hop: true, info: true, secs: 5.5, when: (s) => s.rings >= 1 },
  { id: 'empty', hop: true, info: true, secs: 5.5, when: (s) => s.fuel < 0.06 },
  { id: 'missed', hop: true, info: true, secs: 5.5, when: (s) => s.misses >= 1 && s.rings < 3 },
  { id: 'offroad', info: true, secs: 5, when: (s) => s.offT > 1.2 },
  { id: 'drive', max: 4, intro: true,
    when: () => true,
    done: (s) => s.racing && s.speed > 9 && s.throttleT > 0.6 },
  { id: 'steer', max: 4,
    when: (s) => s.racing && s.speed > 6,
    done: (s) => s.steerT > 0.45 },
  { id: 'brake', urgent: true, max: 4, secs: 5,
    when: (s) => s.ground && s.cornerAhead,
    done: (s) => s.brakeT > 0.25,
    gone: (s) => !s.cornerAhead },
  { id: 'jet', hop: true, max: 4, secs: 12,
    when: (s) => s.ground && s.speed > 10 && s.fuel > 0.6 && s.straight && s.raceT > 4,
    done: (s) => s.hops >= 1 },
  { id: 'drift', hop: false, max: 3, secs: 5,
    when: (s) => s.inCorner && s.speed > 16 && s.raceT > 12,
    done: (s) => s.driftT > 0.3,
    gone: (s) => !s.inCorner },
  { id: 'boost', max: 3, secs: 8,
    when: (s) => s.ground && s.boost > 0.4 && s.straight && s.speed > 14 && s.raceT > 16,
    done: (s) => s.boostT > 0.4,
    gone: (s) => s.boost < 0.08 },
];
const OUTRO = { id: 'outro', info: true, secs: 5 };
/** The lessons that make up "knows how to play"; the rest are tips. */
const CORE = { hop: ['drive', 'steer', 'brake', 'jet'], ground: ['drive', 'steer', 'brake'] };

const lessonsFor = (hop) => LESSONS.filter((l) => l.hop == null || l.hop === hop);
const finished = (store, l) => store[l.id] === OK || (+store[l.id] || 0) >= (l.max || 1);

export class Coach {
  /** Is there anything left to teach this player in this kind of race? */
  static wanted(game, race) {
    const st = game.profile.coach || {};
    if (st.off || race.online || race.kind === 'tutorial' || race.cfg.mode === 'tutorial') return false;
    const ui = game.ui;
    if (!ui || !ui.tutorial || !ui.tutorial.show) return false;
    return lessonsFor(!!race.isFlight).some((l) => !finished(st, l));
  }

  /** The tutorial run teaches these, so the coach need not repeat them. */
  static learnFromTutorial(profile) {
    profile.coach = Object.assign(profile.coach || {}, { drive: OK, steer: OK, jet: OK, ring: OK, refill: OK, boost: OK });
  }

  constructor(race, kind) {
    this.race = race; this.game = race.game;
    this.hop = kind ? kind === 'hop' : !!race.isFlight;
    this.store = this.game.profile.coach || (this.game.profile.coach = {});
    this.lessons = lessonsFor(this.hop);
    this.cur = null;        // lesson on screen
    this.curT = 0;          // seconds it has been up
    this.gapT = 0.5;        // pause before the next card
    this.shown = 0;         // cards shown this race
    this.device = '';
    this.scanT = 0;
    this.misses = 0;
    this.s = { stuckT: 0, movingT: 0, wrongT: 0, throttleT: 0, steerT: 0, brakeT: 0, driftT: 0, boostT: 0, raceT: 0,
      cornerAhead: false, inCorner: false, straight: true, gapAhead: false, ringAhead: Infinity, ringIndex: -1 };
  }

  // ------------------------------------------------------------------ device
  currentDevice() {
    const ui = this.game.ui;
    let d = ui.device || this.game.input.lastDevice;
    if (!d || (d === 'keyboard' && !ui.device && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)) d = 'touch';
    if (d === 'touch' && ui.touch && ui.touch.tiltActive) d = 'tilt';
    return d;
  }

  copyFor(l) {
    const c = COPY[l.id]; if (!c) return null;
    const dev = this.device === 'tilt' ? 'touch' : this.device;
    if (c.all) return { text: c.all[0], keys: '', btn: null };
    if (this.device === 'tilt' && c.tilt) return { text: c.tilt[0], keys: '', btn: null };
    const row = c[dev] || c.keyboard, btn = dev === 'touch' ? c.touchBtn || null : null;
    return { text: row[0], keys: dev === 'touch' ? '' : (row[1] || ''), btn };
  }

  // ------------------------------------------------------------------ what the player is doing
  sense(dt, inp) {
    const r = this.race, p = r.player, v = p.v, s = this.s, tr = r.track;
    const racing = r.state === 'race' && !p.finished;
    s.racing = racing;
    s.speed = v.speed;
    s.ground = !(p.jet && p.jet.air);
    s.fuel = p.jet ? p.jet.fuel : 0;
    s.boost = v.boost / v.stats.boostCap;
    s.offT = r.offT || 0;
    s.hops = r.tut ? r.tut.hops : 0;
    s.rings = r.tut ? r.tut.rings : 0;
    s.misses = this.misses;
    s.resetPressed = this.game.input.wasPressed('KeyR', 'PadKeyR') || !!this.resetFlag;
    this.resetFlag = false;
    if (!racing) { s.stuckT = 0; s.wrongT = 0; return; }
    s.raceT += dt;
    const auto = !!r.autopilot; // test hook: the AI drives, so the player's inputs say nothing
    if (!auto) {
      if (inp.throttle > 0.3) s.throttleT += dt;
      if (Math.abs(inp.steer) > 0.12 && v.speed > 4) s.steerT += dt;
      if (inp.brake > 0.3 && v.speed > 3) s.brakeT += dt;
      if (!this.hop && inp.handbrake && Math.abs(inp.steer) > 0.2 && v.speed > 10) s.driftT += dt;
      if (v.boosting && inp.boost) s.boostT += dt;
    }
    // stuck = racing for a while but hardly moving, on the ground
    if (s.raceT > 4 && v.speed < 2.5 && s.ground) s.stuckT += dt; else s.stuckT = 0;
    if (v.speed > 8) s.movingT += dt; else s.movingT = 0;
    s.wrongT = p.wrongT > 0 ? p.wrongT : 0;

    // look down the road a few times a second
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.2;
    const d = p.info.dist, sp = v.speed;
    const grip = v.stats.grip * 0.88 * (v.gravityScale || 1);
    let corner = false, kNear = 0, kFar = 0;
    for (let a = 0; a <= Math.max(60, sp * 2.6); a += 6) {
      const k = Math.abs(tr.curvatureAt(d + a));
      if (a <= 18) kNear = Math.max(kNear, k);
      if (a <= 110) kFar = Math.max(kFar, k);
      // a bend the car cannot take at this speed, and close enough that braking has to start
      if (a >= 12 && k > 1e-4 && Math.sqrt(grip / k) < sp * 0.82) corner = true;
    }
    s.cornerAhead = corner && sp > 18;
    s.inCorner = kNear > 0.012;
    s.straight = kFar < 0.006;
    if (this.hop && r.rings && r.rings.length) {
      const i = r.nextRingIndex(d), ring = r.rings[i], L = tr.length;
      s.ringIndex = i; s.ringAhead = (ring.dist - d + L) % L;
    }
    s.gapAhead = false;
    if (this.hop && r.worldMode === 'hop' && typeof r.gapAt === 'function') {
      for (let a = 10; a <= Math.max(50, sp * 2.2); a += 8) if (r.gapAt(d + a)) { s.gapAhead = true; break; }
    }
  }

  // ------------------------------------------------------------------ cards
  show(l) {
    const c = this.copyFor(l); if (!c) return;
    const ui = this.game.ui;
    this.cur = l; this.curT = 0; this.curCopy = c;
    this.shownHops = this.s.hops; this.shownRing = this.s.ringIndex;
    ui.tutorial.show({ id: 'coach-' + l.id, text: c.text, keyHint: c.keys, label: l.info ? 'GOOD TO KNOW' : 'HOW TO PLAY', skipLabel: 'Hide tips', coach: true });
    ui.touch && ui.touch.highlight && ui.touch.highlight(c.btn);
  }

  hide(l, did) {
    const ui = this.game.ui, t = ui.tutorial;
    if (did && t.done) { t.done('coach-' + l.id); if (!l.info) this.game.audio.ui('confirm'); }
    else t.hide && t.hide();
    ui.touch && ui.touch.highlight && ui.touch.highlight(null);
    this.cur = null; this.gapT = did ? 1.5 : 0.8;
  }

  learn(l) {
    if (this.store[l.id] === OK) return;
    this.store[l.id] = OK; this.game.save();
  }

  /** Something happened in the race: 'ring' with hit true/false, or 'reset' (the ↺ button). */
  event(type, value) {
    if (type === 'ring' && !value) this.misses++;
    if (type === 'reset') this.resetFlag = true;
  }

  /** stop(true): "Hide tips" on the card, stop coaching for good. */
  stop(skip = false) {
    if (skip) { this.store.off = 1; this.game.profile.coached = true; this.game.save(); }
    if (this.cur) this.hide(this.cur, false);
    this.over = true;
  }

  update(dt) {
    if (this.over) return;
    const r = this.race, s = this.s, inp = r.playerInput;
    this.sense(dt, inp);
    const dev = this.currentDevice();
    const devChanged = dev !== this.device; this.device = dev;

    // silent ticks: the player already does it, so never show the card
    for (const l of this.lessons) {
      if (l === this.cur || l.info || l.shownOnly || !l.done || this.store[l.id] === OK) continue;
      if (l.done(s, this)) this.learn(l);
    }

    const cur = this.cur;
    if (cur) {
      this.curT += dt;
      if (devChanged) this.show(cur); // picked up a controller mid-card: say it in that device's words
      if (cur.info) {
        if (this.curT > cur.secs) { this.learn(cur); this.hide(cur, false); }
      } else if (cur.done(s, this)) {
        this.learn(cur); this.hide(cur, true);
      } else if ((cur.gone && this.curT > 1.2 && cur.gone(s, this)) || (cur.secs && this.curT > cur.secs && s.racing)) {
        this.hide(cur, false);
        if (cur.id === 'ring' && s.rings < 1) this.misses = Math.max(this.misses, 1);
      }
      if (this.cur && !this.cur.urgent && !this.cur.info) { // something more pressing came up
        const u = this.pick(true);
        if (u) { this.hide(this.cur, false); this.gapT = 0; this.offer(u); }
      }
      return;
    }
    if (r.state === 'finished' || r.player.finished) return;
    this.gapT -= dt;
    if (this.gapT > 0) return;
    const next = this.pick(false);
    if (next) { this.offer(next); return; }
    // every core control used, and we did some teaching this race: say so once
    if (CORE[this.hop ? 'hop' : 'ground'].every((id) => this.store[id] === OK)) {
      if (!this.game.profile.coached) { this.game.profile.coached = true; this.game.save(); }
      if (this.shown >= 2 && !this.store.outro) {
        this.store.outro = OK; this.game.save();
        this.show(OUTRO); this.shown++;
      }
    }
  }

  offer(l) {
    if (!l.info) { this.store[l.id] = (+this.store[l.id] || 0) + 1; this.game.save(); }
    this.shown++;
    this.show(l);
  }

  pick(urgentOnly) {
    const s = this.s;
    for (const l of this.lessons) {
      if (urgentOnly && !l.urgent) continue;
      if (finished(this.store, l)) continue;
      if (!l.intro && !s.racing) continue;
      if (l.when(s, this)) return l;
    }
    return null;
  }

  dispose() {
    const ui = this.game.ui;
    if (this.cur && ui.tutorial && ui.tutorial.hide) ui.tutorial.hide();
    ui.touch && ui.touch.highlight && ui.touch.highlight(null);
    this.cur = null; this.over = true;
  }
}
