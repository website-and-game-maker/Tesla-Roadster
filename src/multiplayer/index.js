/**
 * Public entry point for online play.
 *
 *   import { Multiplayer } from './multiplayer/index.js';
 *   const mp = new Multiplayer({ name: 'Ada', color: '#e31937' });
 *   const code = await mp.hostRoom({ trackId: 'coast', laps: 3 }); // or joinRoom(code) / quickMatch()
 *   mp.on('countdown', ({ startAt }) => game.startRaceAt(startAt));
 *   // each frame:
 *   mp.sendState({ pos, quat, vel, speed, steer, lap, progress, fx });
 *   for (const car of mp.getRemoteCars()) drawGhost(car);
 *
 * Works with no backend of our own: PeerJS's free public broker introduces
 * players, then all race traffic flows browser-to-browser over WebRTC.
 */
import { Emitter } from './emitter.js';
import { resolveConfig } from './config.js';
import { PeerTransport, MultiplayerError } from './transport.js';
import { RaceSession } from './session.js';
import { createLeaderboard } from './leaderboard.js';
import { createAccount } from './account.js';
import { MP_CONFIG } from './config.js';
import { makeRoomCode, normalizeRoomCode, isValidRoomCode, roomPeerId, quickPeerId, FX } from './protocol.js';

export { FX, MultiplayerError, normalizeRoomCode, isValidRoomCode };
export { createAccount, AccountError } from './account.js';

/**
 * Free accounts + cloud saves (Supabase). Local-only when config.supabase is blank:
 * auth.enabled === false, cloud.loadProfile() -> null, cloud.saveProfile() -> { saved: false }.
 */
const account = createAccount(MP_CONFIG);
export const auth = account.auth;
export const cloud = account.cloud;
if (typeof addEventListener === 'function') addEventListener('pagehide', () => cloud.flush());

const FORWARDED = [
  'lobby',
  'phase',
  'countdown',
  'race-start',
  'positions',
  'lap',
  'grace',
  'results',
  'chat',
  'player-joined',
  'player-left',
  'ping',
];

export class Multiplayer extends Emitter {
  /**
   * @param {object} profile   { name, color, carId }
   * @param {object} [options] { config: overrides, transport, storage, fetchImpl }
   */
  constructor(profile = {}, options = {}) {
    super();
    this.cfg = resolveConfig(options.config);
    this.transport = options.transport || new PeerTransport(this.cfg);
    this.leaderboard = createLeaderboard(this.cfg, options);
    this.profile = { name: 'Driver', color: '#e31937', carId: 'roadster', ...profile };
    this.session = null;
    this._busy = false;
    this._unsub = [];
  }

  get online() {
    return !!this.session && !this.session.closed;
  }

  get isHost() {
    return !!this.session?.isHost;
  }

  get room() {
    return this.session?.room || null;
  }

  setProfile(patch) {
    Object.assign(this.profile, patch);
    if (this.online && this.room?.phase === 'lobby') this.session.setCar(patch);
  }

  /* ------------------------------------------------------------ rooms */

  /** Create a private room. Resolves with the 5-letter code to share. */
  async hostRoom(settings = {}) {
    return this._guard(async () => {
      this._status('Creating room…');
      // Collisions on a 31^5 (28M) code space are rare, but retry anyway.
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = makeRoomCode();
        const s = this._newSession();
        try {
          await s.host(roomPeerId(this.cfg, code), { code, settings });
          this._adopt(s);
          return code;
        } catch (err) {
          s.leave();
          if (err.code !== 'unavailable-id') throw err;
        }
      }
      throw new MultiplayerError('unavailable-id', 'Could not create a room. Try again.');
    });
  }

  /** Join a friend's room by code. */
  async joinRoom(rawCode) {
    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) throw new MultiplayerError('bad-code', 'Room codes are 5 letters/numbers.');
    return this._guard(async () => {
      this._status(`Joining ${code}…`);
      const s = this._newSession();
      try {
        await s.join(roomPeerId(this.cfg, code));
      } catch (err) {
        s.leave();
        throw err;
      }
      this._adopt(s);
      return code;
    });
  }

  /**
   * Quick match without a matchmaking server: lobbies live at well-known
   * peer ids (slot 1..N). Try to join the first open one; if none exist,
   * host the first free slot. A lone host keeps checking lower slots and
   * moves there if a lobby appears, so simultaneous searchers merge.
   */
  async quickMatch() {
    return this._guard(async () => {
      this._status('Searching for a race…');
      const slots = this.cfg.quickMatchSlots;
      for (let slot = 1; slot <= slots; slot++) {
        const s = this._newSession();
        try {
          await s.join(quickPeerId(this.cfg, slot), { quick: true });
          this._adopt(s);
          return { slot, hosting: false };
        } catch (err) {
          s.leave();
          if (err.code === 'offline') throw err;
          // not-found / full / in-progress / timeout: try the next slot
        }
      }
      this._status('No open races. Starting a lobby…');
      for (let slot = 1; slot <= slots; slot++) {
        const s = this._newSession();
        try {
          await s.host(quickPeerId(this.cfg, slot), { code: `Q${slot}`, quick: true, settings: this._quickSettings });
          this._adopt(s);
          this._watchForMerge(slot);
          return { slot, hosting: true };
        } catch (err) {
          s.leave();
          if (err.code !== 'unavailable-id') throw err;
        }
      }
      throw new MultiplayerError('busy', 'All quick-match lobbies are busy. Try a private room.');
    });
  }

  /** Default track/laps used when this player hosts a quick-match lobby. */
  setQuickMatchSettings(settings) {
    this._quickSettings = settings;
  }

  leave() {
    this._clearMerge();
    const s = this.session;
    this.session = null;
    for (const off of this._unsub) off();
    this._unsub = [];
    s?.leave();
    this.emit('left');
  }

  /* ------------------------------------------------------------ per-frame */

  sendState(state) {
    this.session?.sendState(state);
  }

  getRemoteCars() {
    return this.session ? this.session.getRemoteCars() : [];
  }

  /** ms since green light on the shared clock (negative in countdown). */
  raceTime() {
    return this.session?.raceTime() ?? null;
  }

  reportLap(lap, lapMs) {
    this.session?.reportLap(lap, lapMs);
    if (this.room) {
      this.leaderboard
        .submit({ trackId: this.room.settings.trackId, lapMs, name: this.profile.name, color: this.profile.color, carId: this.profile.carId, mode: 'online' })
        .catch(() => {});
    }
  }

  reportFinish(totalMs, bestLapMs) {
    this.session?.reportFinish(totalMs, bestLapMs);
  }

  /* ------------------------------------------------------------ internals */

  _newSession() {
    return new RaceSession({
      config: this.cfg,
      transport: this.transport,
      profile: { ...this.profile, playerId: this.leaderboard.playerId },
    });
  }

  _adopt(s) {
    this.leave();
    this.session = s;
    for (const ev of FORWARDED) this._unsub.push(s.on(ev, (...a) => this.emit(ev, ...a)));
    this._unsub.push(
      s.on('disconnected', (info) => {
        this.session = null;
        this._clearMerge();
        this.emit('disconnected', info);
      }),
    );
    this._unsub.push(s.on('error', (err) => this.emit('error', err)));
    this._status('');
    this.emit('joined', { room: s.room, isHost: s.isHost });
    this.emit('lobby', s.room);
  }

  _watchForMerge(mySlot) {
    if (mySlot <= 1) return;
    this._clearMerge();
    this._mergeTimer = setInterval(async () => {
      const s = this.session;
      if (!s?.isHost || s.room.phase !== 'lobby' || s.room.players.length > 1 || this._merging) {
        if (s && s.room.players.length > 1) this._clearMerge();
        return;
      }
      this._merging = true;
      try {
        for (let slot = 1; slot < mySlot; slot++) {
          const info = await s.probe(quickPeerId(this.cfg, slot));
          if (info && info.phase === 'lobby' && info.players < info.max && this.session === s && s.room.players.length === 1) {
            const next = this._newSession();
            try {
              await next.join(quickPeerId(this.cfg, slot), { quick: true });
              this._adopt(next);
              return;
            } catch {
              next.leave();
            }
          }
        }
      } finally {
        this._merging = false;
      }
    }, 8000);
  }

  _clearMerge() {
    clearInterval(this._mergeTimer);
    this._mergeTimer = null;
  }

  async _guard(fn) {
    if (this._busy) throw new MultiplayerError('busy', 'Already connecting…');
    this._busy = true;
    try {
      return await fn();
    } catch (err) {
      this._status('');
      this.emit('error', err);
      throw err;
    } finally {
      this._busy = false;
    }
  }

  _status(text) {
    this.emit('status', text);
  }
}

export { RemoteCars } from './remote-cars.js';
export { LobbyUI, readRoomFromUrl } from './lobby-ui.js';
