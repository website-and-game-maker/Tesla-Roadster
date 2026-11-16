// Secrets (easter eggs). One call wires the whole feature into the game:
//
//   attachSecrets(game)
//
// How it plays:
//   1. Every world hides three small objects just off the racing line. Nothing mentions
//      them: a player who jet-hops into one gets a "SECRET FOUND" banner, credits, and a
//      Secrets entry in the main menu.
//   2. After HUNTER_STARS career stars (or HUNTER_FINDS finds) the player becomes a Secret
//      Hunter. From then on secrets are a goal: the log gives a hint for each one, light
//      beams mark them, a radar points at the nearest, and "Secret Hunt" (free roam, no
//      clock) can be started on any world from the log.
//   3. In Secret Hunt each secret runs a challenge when touched (sparks, altitude, glide,
//      precision landing). Beating challenges pays credits; totals unlock jet trails.
//
// State lives in profile.secrets, so it follows saves, cloud sync and "reset progress".
import { totalStars } from '../game/career.js';
import { SECRETS, ALL_SECRETS, TOTAL, TRAILS, CHALLENGES, FIND_REWARD, CHALLENGE_REWARD, WORLD_REWARD, HUNTER_STARS, HUNTER_FINDS } from './defs.js';
import { Hunt } from './hunt.js';
import { createOverlay } from './overlay.js';
import { createLog } from './log.js';

export function attachSecrets(game) {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = new URL('./secrets.css', import.meta.url).href;
  document.head.appendChild(link);

  // The profile object is replaced on reset and on cloud load, so always go through game.profile.
  const st = () => {
    const P = game.profile;
    if (!P.secrets || typeof P.secrets !== 'object') P.secrets = {};
    const s = P.secrets;
    s.found ||= {}; s.done ||= {}; s.trail ||= ''; s.hunter = !!s.hunter; s.intro = !!s.intro; s.trailsSeen ||= 0;
    return s;
  };
  const valid = (map) => ALL_SECRETS.filter((x) => map[x.id]).length;
  let retryFlag = false, padY = false, hunt = null, cur = null, last = performance.now();

  const device = () => game.input.lastDevice || 'keyboard';
  const sys = {
    get state() { return st(); },
    get hunter() { return st().hunter; },
    get foundCount() { return valid(st().found); },
    get doneCount() { return valid(st().done); },
    get stars() { return totalStars(game.profile); },
    isFound: (id) => !!st().found[id],
    isDone: (id) => !!st().done[id],
    /** The menu entry appears with the first find, or when the player becomes a hunter. */
    get visible() { return st().hunter || valid(st().found) > 0; },
    audio(name, arg) { try { game.audio.ui(name, arg); } catch (e) { /* no sound */ } },
    trailUnlocked(t) { return !t.id || (sys.foundCount >= t.need && (!t.done || sys.doneCount >= TOTAL)); },
    trailColors() { const t = TRAILS.find((x) => x.id === st().trail); return t && t.id && sys.trailUnlocked(t) ? t.colors : null; },
    setTrail(id) { st().trail = id; game.save(); },
    retryPressed() {
      const pad = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((p) => p && p.connected);
      const y = !!(pad && pad.buttons[3] && pad.buttons[3].pressed), edge = y && !padY; padY = y;
      const hit = retryFlag || edge || game.input.wasPressed('KeyT');
      retryFlag = false;
      return hit;
    },

    find(def, { challengeNext = false } = {}) {
      const s = st(); if (s.found[def.id]) return;
      const first = valid(s.found) === 0;
      s.found[def.id] = 1;
      game.profile.credits += FIND_REWARD;
      const n = valid(s.found);
      sys.audio('unlock');
      const foot = [`+${FIND_REWARD} cr`];
      if (first) foot.push('Secrets added to the main menu');
      else if (challengeNext) foot.push('Challenge coming up');
      else if (s.hunter) foot.push('Its challenge waits in Secret Hunt');
      overlay.banner({ kicker: `Secret found · ${n} of ${TOTAL}`, title: def.name, text: def.flavor, foot: foot.join(' · '), secs: challengeNext ? 4 : 5.5 });
      after();
    },

    complete(def) {
      const s = st(); if (s.done[def.id]) return;
      s.done[def.id] = 1;
      game.profile.credits += CHALLENGE_REWARD;
      sys.audio('unlock');
      overlay.banner({ tone: 'done', kicker: 'Challenge complete', title: CHALLENGES[def.challenge].name, text: def.name, foot: `+${CHALLENGE_REWARD} cr`, secs: 4 });
      const world = Object.keys(SECRETS).find((w) => SECRETS[w].some((x) => x.id === def.id));
      if (world && SECRETS[world].every((x) => s.done[x.id])) {
        game.profile.credits += WORLD_REWARD;
        const w = game.worlds.find((x) => x.id === world);
        overlay.banner({ tone: 'done', kicker: 'World complete', title: w ? w.name : world, text: 'All three secrets found and every challenge beaten here.', foot: `+${WORLD_REWARD} cr`, secs: 5 });
      }
      after();
    },
  };

  /** After anything changes: hunter status, new trails, save, menus. */
  function after() {
    const s = st();
    if (!s.hunter && (sys.stars >= HUNTER_STARS || valid(s.found) >= HUNTER_FINDS)) {
      s.hunter = true;
      if (game.state === 'race' && hunt) {
        overlay.banner({ tone: 'hunter', kicker: 'Secret Hunter unlocked', title: 'Your radar is on', text: 'An arrow now points to the nearest secret in every world, and light beams mark them.', foot: 'Hints and challenges: Secrets in the main menu', secs: 7 });
        sys.audio('unlock');
      }
      if (hunt) hunt.refresh();
    }
    const open = TRAILS.filter((t) => t.id && sys.trailUnlocked(t));
    if (open.length > s.trailsSeen) {
      const t = open[open.length - 1];
      s.trailsSeen = open.length; s.trail = t.id; // put the new trail on straight away
      if (game.state === 'race' && hunt) overlay.banner({ tone: 'hunter', kicker: 'Jet trail unlocked', title: `${t.name} trail`, text: 'It is on your car now. Change it any time in the Secrets log.', secs: 5 });
      else game.ui.toast && game.ui.toast(`Jet trail unlocked: ${t.name}`);
    }
    game.save();
    log.refresh();
  }

  const overlay = createOverlay({
    jetLabel: () => ({ touch: 'JET', gamepad: 'A' }[device()] || 'Space'),
    retryLabel: () => ({ touch: 'Tap Try again', gamepad: 'Press Y' }[device()] || 'Press T'),
    onRetry: () => { retryFlag = true; },
  });
  sys.overlay = overlay;
  const log = createLog(sys, game);

  // Run just before each game frame: input edges are still fresh and the race has settled.
  const frame = game.frame.bind(game);
  game.frame = () => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    try { tick(dt); } catch (e) { console.error('[secrets]', e); hunt = null; }
    frame();
  };
  function tick(dt) {
    const race = game.race || null;
    if (race !== cur) {
      if (hunt) { try { hunt.dispose(); } catch (e) { /* scene already gone */ } }
      hunt = null; cur = race; overlay.clear();
      // Fly mode only (jets are how you reach them), and not in the tutorial lap.
      if (race && race.isFlight && race.kind !== 'tutorial' && race.player && race.player.jet) hunt = new Hunt(sys, race);
      sys.hunt = hunt;
    }
    const on = !!hunt && game.state === 'race';
    overlay.setActive(on);
    if (on) { hunt.update(dt); overlay.update(dt); }
  }

  // Stars are earned at the end of races: that is where a player usually becomes a hunter.
  const push = game.pushProfile.bind(game);
  game.pushProfile = () => { push(); const was = st().hunter; after(); if (!was && st().hunter) log.refresh(); };
  // First time back at the menu as a hunter: open the log once, so the new goal is explained.
  const showMenu = game.ui.showMenu.bind(game.ui);
  game.ui.showMenu = (...a) => {
    showMenu(...a);
    const s = st();
    if (s.hunter && !s.intro && log.available && game.ui.screen === 'main') { s.intro = true; game.save(); log.open(true); }
  };

  game.secrets = sys;
  after();
  return sys;
}

export { SECRETS, TRAILS, TOTAL };
