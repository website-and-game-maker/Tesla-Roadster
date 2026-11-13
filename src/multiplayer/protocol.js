/**
 * Wire protocol. Every message is a small JSON object with a `k` (kind).
 * The host is authoritative for the room (who's in it, race phase, start
 * time, positions, results). Car physics stay on each player's own device;
 * the host only relays car states.
 *
 * client -> host: hello, probe, ping, st, ready, car, lap, fin, chat
 * host -> client: welcome, reject, probe-ok, pong, lobby, ss, go, pos, lapev, res, chat
 */

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

export function makeRoomCode(len = 5, rand = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
  return s;
}

export function normalizeRoomCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function isValidRoomCode(code) {
  return new RegExp(`^[${ROOM_CODE_ALPHABET}]{5}$`).test(code);
}

export const roomPeerId = (cfg, code) => `${cfg.idPrefix}room-${code}`;
export const quickPeerId = (cfg, slot) => `${cfg.idPrefix}qm-${slot}`;

/** Round to keep packets small; 1 cm / 0.0001 quat precision is plenty. */
const r = (x, f) => Math.round(x * f) / f;

/** Pack the game's car state for the wire. */
export function packState(s, hostTime) {
  return {
    t: Math.round(hostTime),
    p: s.pos.map((x) => r(x, 100)),
    q: s.quat.map((x) => r(x, 10000)),
    v: (s.vel || [0, 0, 0]).map((x) => r(x, 100)),
    s: r(s.speed || 0, 100),
    st: r(s.steer || 0, 1000),
    lap: s.lap | 0,
    pr: r(s.progress || 0, 100000),
    // Optional visual extras the renderer may use (brake lights, drift smoke, boost).
    fx: s.fx | 0,
  };
}

/** Unpack a wire state into the snapshot shape SnapshotBuffer expects. */
export function unpackState(w) {
  return {
    t: w.t,
    p: w.p,
    q: w.q,
    v: w.v,
    speed: w.s,
    steer: w.st,
    lap: w.lap,
    progress: w.pr,
    fx: w.fx,
  };
}

/** Visual flag bits for `fx`. */
export const FX = { BRAKE: 1, DRIFT: 2, BOOST: 4, HEADLIGHTS: 8, HORN: 16 };

const NAME_COLORS = ['Teal', 'Amber', 'Coral', 'Indigo', 'Lime', 'Ruby', 'Silver', 'Sky', 'Mint', 'Plum', 'Gold', 'Ocean'];
const NAME_ANIMALS = ['Otter', 'Falcon', 'Panda', 'Fox', 'Koala', 'Gecko', 'Puffin', 'Lynx', 'Dolphin', 'Badger', 'Heron', 'Comet'];
/** A made-up driver name from fixed word lists, the same for the same seed. */
export function madeUpName(seed) {
  let h = 2166136261;
  for (const ch of String(seed || Math.random())) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${NAME_COLORS[h % NAME_COLORS.length]} ${NAME_ANIMALS[(h >>> 8) % NAME_ANIMALS.length]}`;
}

const NAME_MAX = 16;
export function cleanName(name) {
  const n = String(name || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return n || 'Driver';
}

export function cleanColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#c8102e';
}

export function cleanChat(text) {
  return String(text || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 80);
}

/**
 * Race order: finishers by finish time, then by laps completed, then by
 * progress along the current lap. DNFs last.
 */
export function computeOrder(players) {
  return [...players]
    .sort((a, b) => {
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      const af = a.finishMs != null;
      const bf = b.finishMs != null;
      if (af && bf) return a.finishMs - b.finishMs;
      if (af !== bf) return af ? -1 : 1;
      if ((b.lap | 0) !== (a.lap | 0)) return (b.lap | 0) - (a.lap | 0);
      return (b.progress || 0) - (a.progress || 0);
    })
    .map((p) => p.id);
}
