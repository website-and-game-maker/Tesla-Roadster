/**
 * Lap-time leaderboards.
 *
 * Local board: always on, stored in localStorage, gives personal bests even
 * offline. Global board: Supabase (free tier) through its plain REST API, no
 * SDK. Turned on by filling config.supabase.url + anonKey. If the network
 * fails, reads fall back to local data and writes still save locally.
 */

const LOCAL_KEY = 'trr.leaderboard.v1';
const ID_KEY = 'trr.playerId';
const MAX_LOCAL_PER_TRACK = 50;
const MIN_LAP_MS = 5000;
const MAX_LAP_MS = 3600000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

function safeStorage(storage) {
  const mem = new Map();
  return {
    get(k) {
      try {
        const v = storage?.getItem(k);
        if (v != null) return v;
      } catch {
        /* private mode */
      }
      return mem.has(k) ? mem.get(k) : null;
    },
    set(k, v) {
      mem.set(k, v);
      try {
        storage?.setItem(k, v);
      } catch {
        /* quota / private mode */
      }
    },
  };
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const MODES = ['solo', 'online', 'flight'];
const modeOf = (m) => (MODES.includes(m) ? m : 'solo');

/** Flight time attack passes courseId; driving passes trackId. Both land in track_id. */
const normalize = (e) => ({ ...e, trackId: e.trackId ?? e.courseId });

export function validateEntry({ trackId, lapMs, name }) {
  if (!Number.isFinite(lapMs) || lapMs < MIN_LAP_MS || lapMs > MAX_LAP_MS) return 'bad lap time';
  if (!trackId || String(trackId).length > 40) return 'bad track';
  const n = String(name || '').trim();
  if (n.length < 1 || n.length > 16) return 'bad name';
  return null;
}

/** Keep each player's best lap only, sorted fastest first. */
export function bestPerPlayer(rows, limit) {
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.playerId);
    if (!cur || r.lapMs < cur.lapMs) best.set(r.playerId, r);
  }
  return [...best.values()].sort((a, b) => a.lapMs - b.lapMs).slice(0, limit);
}

class LocalLeaderboard {
  constructor(storage) {
    this.store = safeStorage(storage);
    this.isGlobal = false;
  }

  get playerId() {
    let id = this.store.get(ID_KEY);
    if (!id) {
      id = uuid();
      this.store.set(ID_KEY, id);
    }
    return id;
  }

  _all() {
    try {
      return JSON.parse(this.store.get(LOCAL_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  personalBest(trackId) {
    const mine = (this._all()[trackId] || []).filter((r) => r.playerId === this.playerId);
    return mine.length ? Math.min(...mine.map((r) => r.lapMs)) : null;
  }

  async submit(rawEntry) {
    const entry = normalize(rawEntry);
    const err = validateEntry(entry);
    if (err) throw new Error(err);
    const prev = this.personalBest(entry.trackId);
    const row = {
      name: String(entry.name).trim(),
      lapMs: Math.round(entry.lapMs),
      color: entry.color || '#c8102e',
      carId: entry.carId || 'roadster',
      mode: modeOf(entry.mode),
      playerId: this.playerId,
      createdAt: new Date().toISOString(),
    };
    const all = this._all();
    const list = (all[entry.trackId] || []).concat(row).sort((a, b) => a.lapMs - b.lapMs);
    all[entry.trackId] = list.slice(0, MAX_LOCAL_PER_TRACK);
    this.store.set(LOCAL_KEY, JSON.stringify(all));
    const rank = all[entry.trackId].indexOf(row) + 1 || null;
    return { rank, personalBest: prev == null || row.lapMs < prev };
  }

  async top(trackId, { limit = 20, period = 'all' } = {}) {
    let rows = this._all()[trackId] || [];
    if (period === 'week') {
      const since = Date.now() - WEEK_MS;
      rows = rows.filter((r) => Date.parse(r.createdAt) >= since);
    }
    return bestPerPlayer(rows, limit);
  }
}

class SupabaseLeaderboard {
  constructor({ url, anonKey }, local, fetchImpl) {
    this.base = url.replace(/\/+$/, '') + '/rest/v1';
    this.key = anonKey;
    this.local = local;
    this.fetch = fetchImpl;
    this.isGlobal = true;
  }

  get playerId() {
    return this.local.playerId;
  }

  personalBest(trackId) {
    return this.local.personalBest(trackId);
  }

  async _req(path, init = {}) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), 6000);
    try {
      const res = await this.fetch(this.base + path, {
        ...init,
        signal: ctrl?.signal,
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
      if (!res.ok) throw new Error(`leaderboard HTTP ${res.status}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async submit(rawEntry) {
    const entry = normalize(rawEntry);
    const result = await this.local.submit(entry); // validates + local PB
    try {
      await this._req('/lap_times', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          player_id: this.playerId,
          name: String(entry.name).trim(),
          track_id: String(entry.trackId),
          lap_ms: Math.round(entry.lapMs),
          color: entry.color || '#c8102e',
          car_id: entry.carId || 'roadster',
          mode: modeOf(entry.mode),
        }),
      });
      return { ...result, rank: null, uploaded: true };
    } catch (err) {
      console.warn('[leaderboard] upload failed, kept locally', err);
      return { ...result, uploaded: false };
    }
  }

  async top(trackId, { limit = 20, period = 'all' } = {}) {
    const sel = 'select=name,lap_ms,color,car_id,created_at,player_id';
    const t = encodeURIComponent(trackId);
    try {
      let rows;
      if (period === 'week') {
        const since = encodeURIComponent(new Date(Date.now() - WEEK_MS).toISOString());
        const res = await this._req(
          `/lap_times?${sel}&track_id=eq.${t}&created_at=gte.${since}&order=lap_ms.asc&limit=${limit * 5}`,
        );
        rows = await res.json();
      } else {
        const res = await this._req(`/best_laps?${sel}&track_id=eq.${t}&order=lap_ms.asc&limit=${limit}`);
        rows = await res.json();
      }
      return bestPerPlayer(
        rows.map((r) => ({
          name: r.name,
          lapMs: r.lap_ms,
          color: r.color,
          carId: r.car_id,
          createdAt: r.created_at,
          playerId: r.player_id,
        })),
        limit,
      );
    } catch (err) {
      console.warn('[leaderboard] global fetch failed, showing local', err);
      return this.local.top(trackId, { limit, period });
    }
  }
}

export function createLeaderboard(config, { storage = globalThis.localStorage, fetchImpl = globalThis.fetch } = {}) {
  const local = new LocalLeaderboard(storage);
  const sb = config?.supabase;
  if (sb?.url && sb?.anonKey && fetchImpl) return new SupabaseLeaderboard(sb, local, fetchImpl.bind?.(globalThis) || fetchImpl);
  return local;
}
