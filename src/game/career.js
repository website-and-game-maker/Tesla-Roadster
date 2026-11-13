// Career structure, generated from whatever worlds are installed so new tracks slot in.
// Each world has four events. Stars (0-3 per event) unlock later worlds; credits buy
// paints, wheels and performance upgrades in the garage.

export const EVENT_TYPES = {
  race:       { name: 'Race',        desc: 'Beat the field. 1st = 3 stars, 2nd = 2, 3rd = 1.' },
  timeattack: { name: 'Time Attack', desc: 'Set a lap time. Beat the gold, silver or bronze target.' },
  drift:      { name: 'Drift Trial', desc: 'Score drift points in 2 laps. Chain drifts for a multiplier.' },
  elim:       { name: 'Elimination', desc: 'Last place is knocked out at the end of every lap.' },
  ringrace:   { name: 'Sky Race',    desc: 'Race rival flyers through every ring. Missed rings cost 2 seconds.' },
  ringtrial:  { name: 'Ring Trial',  desc: 'Solo run through the rings against gold, silver and bronze times.' },
};

export const UPGRADE_INFO = {
  motor:    { name: 'Motor',    desc: 'More torque: harder launches and acceleration.' },
  inverter: { name: 'Inverter', desc: 'More power at speed: higher top speed.' },
  tires:    { name: 'Tyres',    desc: 'Stickier compound: more cornering grip.' },
  battery:  { name: 'Battery',  desc: 'Bigger Overdrive tank and faster regen.' },
};
export const UPGRADE_COST = [0, 900, 2200, 4200, 7500];
export const MAX_UPGRADE = 4;

const PATTERN = [
  ['race', 'timeattack', 'drift', 'race'],
  ['race', 'elim', 'timeattack', 'drift'],
  ['elim', 'race', 'drift', 'timeattack'],
  ['race', 'timeattack', 'elim', 'race'],
];

export function buildCareer(worlds) {
  const events = [];
  worlds.forEach((w, wi) => {
    const types = PATTERN[wi % PATTERN.length];
    types.forEach((type, k) => {
      const tier = wi * 4 + k;               // 0.. difficulty ramp
      const last = wi === worlds.length - 1 && k === 3;
      events.push({
        id: `${w.id}-${k}`,
        world: w.id,
        worldName: w.name,
        type,
        name: last ? 'Grand Final' : `${EVENT_TYPES[type].name}`,
        laps: type === 'race' ? (last ? 4 : 2 + (k > 1 ? 1 : 0)) : type === 'elim' ? 4 : type === 'drift' ? 2 : 3,
        opponents: type === 'race' ? (last ? 7 : 3 + Math.min(4, wi + (k > 1 ? 1 : 0))) : type === 'elim' ? 4 : 0,
        skill: Math.min(1.04, 0.8 + tier * 0.016 + (last ? 0.05 : 0)),
        aiUpgrade: Math.min(3, Math.floor(tier / 4)),
        reward: 400 + tier * 120,
        unlockStars: wi === 0 ? 0 : Math.round(wi * 7 * (1 + wi * 0.1)),
      });
    });
  });
  return events;
}

const FPATTERN = [['ringrace', 'ringtrial', 'ringrace'], ['ringtrial', 'ringrace', 'ringrace']];

/** Flight career: the main campaign. Ids are prefixed so ground and flight saves never collide. */
export function buildFlightCareer(worlds) {
  const events = [];
  worlds.forEach((w, wi) => {
    FPATTERN[wi % 2].forEach((type, k) => {
      const tier = wi * 3 + k;
      const last = wi === worlds.length - 1 && k === 2;
      events.push({
        id: `f-${w.id}-${k}`, vehicleMode: 'flight', world: w.id, worldName: w.name, type,
        name: last ? 'Sky Grand Final' : EVENT_TYPES[type].name,
        laps: type === 'ringtrial' ? 2 : (last ? 3 : 2),
        opponents: type === 'ringrace' ? Math.min(7, 3 + wi) : 0,
        skill: Math.min(1.03, 0.82 + tier * 0.02 + (last ? 0.04 : 0)),
        aiUpgrade: Math.min(3, Math.floor(tier / 4)),
        reward: 500 + tier * 150,
        unlockStars: wi === 0 ? 0 : Math.round(wi * 5.5 * (1 + wi * 0.1)),
      });
    });
  });
  return events;
}

export function totalStars(profile) {
  return Object.values(profile.stars).reduce((a, b) => a + b, 0);
}

/** Stars earned from a finished event result. */
export function starsFor(event, result) {
  if (!result || result.dnf) return 0;
  switch (event.type) {
    case 'race': case 'ringrace': return result.position <= 3 ? 4 - result.position : 0;
    case 'elim': return result.position === 1 ? 3 : result.survivedLaps >= 2 ? 2 : result.survivedLaps >= 1 ? 1 : 0;
    case 'timeattack': case 'ringtrial': {
      const t = result.bestLap, g = result.targets;
      return t <= g[0] ? 3 : t <= g[1] ? 2 : t <= g[2] ? 1 : 0;
    }
    case 'drift': {
      const s = result.driftScore, g = result.targets;
      return s >= g[0] ? 3 : s >= g[1] ? 2 : s >= g[2] ? 1 : 0;
    }
    default: return 0;
  }
}
