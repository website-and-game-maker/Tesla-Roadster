// Persistent profile (credits, progression, garage, settings, best laps, ghosts).
// localStorage can be unavailable (private mode, blocked storage): everything is wrapped
// so the game still runs, it just won't remember progress.

const KEY = 'roadster-ev-profile-v1';

export function defaultProfile() {
  return {
    name: 'Driver',
    credits: 1000,
    stars: {},            // eventId -> 0..3
    best: {},             // trackId -> best lap seconds
    ghosts: {},           // trackId -> packed ghost samples
    owned: { paints: ['pearlWhite', 'ultraRed', 'solidBlack'], wheels: ['aero'] },
    car: { model: 'rocket', paint: 'ultraRed', wheels: 'aero' },
    tutorialDone: false,
    coached: false,       // first-race coaching prompts have been seen
    upgrades: { motor: 0, inverter: 0, tires: 0, battery: 0 },
    settings: {
      quality: 'auto', showFps: false, units: 'kmh', camera: 0,
      master: 0.8, music: 0.6, sfx: 0.9, steerSens: 1, tiltSteer: false,
      autoThrottle: false, vibration: true, assist: true,
      vehicleMode: 'flight', flightAssist: true, invertPitch: false,
    },
    stats: { races: 0, wins: 0, km: 0, drift: 0 },
  };
}

function merge(base, data) {
  if (!data || typeof data !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in data)) continue;
    const b = base[k], d = data[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && d && typeof d === 'object' && !Array.isArray(d)) {
      base[k] = Object.keys(b).length ? merge(b, d) : d; // empty objects are free-form maps
    } else if (typeof d === typeof b || b === null) {
      base[k] = d;
    }
  }
  return base;
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(defaultProfile(), JSON.parse(raw));
  } catch (e) { /* storage unavailable */ }
  return defaultProfile();
}

let pending = null;
export function saveProfile(p) {
  clearTimeout(pending);
  pending = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }, 150);
}

export function resetProfile() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  return defaultProfile();
}

/** A profile from elsewhere (e.g. a cloud save), filled out with current defaults. */
export function mergeProfile(data) { return merge(defaultProfile(), JSON.parse(JSON.stringify(data || {}))); }
