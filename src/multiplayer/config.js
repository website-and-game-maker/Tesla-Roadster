// Multiplayer configuration. Everything here is safe to ship in a public
// static site: the Supabase "anon" key is designed to be public and is
// protected by the row-level-security rules in supabase/schema.sql.

export const MP_CONFIG = {
  // Bump when the wire protocol changes; peers with a different version are rejected.
  protocolVersion: 1,

  // Prefix for every PeerJS id we create, so we never collide with other apps
  // sharing the free PeerJS cloud broker.
  idPrefix: 'tesla-roadster-v1-',

  maxPlayers: 8,

  // Network rates.
  stateSendHz: 20, // client -> host car state
  relayHz: 20, // host -> clients batched states
  pingIntervalMs: 1000,

  // Remote cars are drawn this far in the past so we always have two
  // snapshots to blend between. ~2 send intervals + jitter margin.
  interpolationDelayMs: 100,
  maxExtrapolationMs: 250,

  countdownMs: 4000,
  // After the first car finishes, everyone else gets this long.
  finishGraceMs: 30000,
  // Quick-match lobbies start automatically after this long with 2+ players.
  quickMatchAutoStartMs: 20000,
  quickMatchSlots: 6,

  connectTimeoutMs: 8000,

  // PeerJS options. Default = free public PeerJS cloud broker (no account).
  // To self-host: { host: 'your-peer-server', port: 443, path: '/', secure: true }.
  peer: {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        // Add a TURN server here for players behind strict/symmetric NATs
        // (some mobile carriers, corporate wifi). See docs/MULTIPLAYER.md.
      ],
    },
  },

  // URL used to lazy-load PeerJS when it is not already on window.Peer.
  peerjsModuleUrl: 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm',

  // Global leaderboard (optional). Leave blank to use local-only leaderboards.
  supabase: {
    url: '', // e.g. 'https://abcdefgh.supabase.co'
    anonKey: '',
  },
};

/** Merge user overrides into the default config (shallow per top-level key). */
export function resolveConfig(overrides = {}) {
  const out = { ...MP_CONFIG };
  for (const [k, v] of Object.entries(overrides)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...MP_CONFIG[k], ...v } : v;
  }
  return out;
}
