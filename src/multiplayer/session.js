/**
 * RaceSession: one online room, seen from one player.
 *
 * Topology is a star: the host's browser accepts a WebRTC data channel from
 * each guest and relays car states between them. The host is also a normal
 * racer. Guests never talk to each other directly, which keeps NAT traversal
 * to N-1 connections instead of N*(N-1)/2.
 */
import { Emitter } from './emitter.js';
import { ClockSync } from './clock.js';
import { SnapshotBuffer } from './interpolation.js';
import { MultiplayerError } from './transport.js';
import {
  packState,
  unpackState,
  computeOrder,
  cleanName,
  cleanColor,
  cleanChat,
} from './protocol.js';

const defaultNow = () => (globalThis.performance ? performance.now() : Date.now());

export class RaceSession extends Emitter {
  /**
   * @param {object} o
   * @param {object} o.config      resolved MP config
   * @param {object} o.transport   PeerTransport | LoopbackTransport
   * @param {object} o.profile     { name, color, carId, playerId }
   * @param {Function} [o.now]     clock (ms), injectable for tests
   */
  constructor({ config, transport, profile, now = defaultNow }) {
    super();
    this.cfg = config;
    this.transport = transport;
    this.profile = {
      name: cleanName(profile.name),
      color: cleanColor(profile.color),
      carId: String(profile.carId || 'roadster').slice(0, 24),
      playerId: String(profile.playerId || '').slice(0, 40),
    };
    this.now = now;

    this.peer = null;
    this.isHost = false;
    this.selfId = null;
    this.hostConn = null;
    this.conns = new Map(); // host only: peerId -> conn
    this.clock = new ClockSync();
    this.buffers = new Map(); // peerId -> SnapshotBuffer
    this.room = null; // { code, quick, settings, phase, players[], startAt, autoStartAt }
    this.order = [];
    this.results = null;
    this.closed = false;
    this._timers = [];
    this._lastSent = -Infinity;
    this._selfState = null; // host: our own latest packed state
    this._dirty = new Set(); // host: ids whose state changed since last relay
    this._latest = new Map(); // host: id -> latest packed state
  }

  /* ============================================================ setup */

  /** Become host under a fixed peer id. */
  async host(peerId, { code, quick = false, settings = {} }) {
    this.peer = await this.transport.createPeer(peerId);
    this.isHost = true;
    this.selfId = this.peer.id;
    this.room = {
      code,
      quick,
      hostId: this.selfId,
      settings: { trackId: 'default', laps: 3, ...settings },
      phase: 'lobby',
      startAt: null,
      autoStartAt: null,
      players: [this._makePlayer(this.selfId, this.profile, true)],
    };
    this.peer.on('connection', (conn) => this._onGuestConnection(conn));
    this.peer.on('disconnected', () => this.peer && !this.peer.destroyed && this.peer.reconnect?.());
    this.peer.on('error', (err) => this.emit('error', err));
    this._every(1000 / this.cfg.relayHz, () => this._relay());
    this._every(250, () => this._hostTick());
    this._broadcastLobby();
    return this;
  }

  /** Join a host by peer id. Resolves after the host accepts us. */
  async join(hostPeerId, { quick = false } = {}) {
    this.peer = await this.transport.createPeer();
    this.selfId = this.peer.id;
    this.peer.on('error', (err) => this.emit('error', err));
    let conn;
    try {
      conn = await this.transport.connect(this.peer, hostPeerId);
    } catch (err) {
      this._destroyPeer();
      throw err;
    }
    this.hostConn = conn;

    const accepted = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new MultiplayerError('timeout', 'Host did not answer.')),
        this.cfg.connectTimeoutMs,
      );
      this._pendingJoin = {
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
    });

    conn.on('data', (msg) => this._onHostMessage(msg));
    conn.on('close', () => this._onHostLost('Host left the room.'));
    conn.on('error', () => this._onHostLost('Connection to host failed.'));
    conn.send({ k: 'hello', v: this.cfg.protocolVersion, quick, ...this.profile });

    try {
      await accepted;
    } catch (err) {
      this.leave();
      throw err;
    }
    // Quick burst of pings so the clock is synced before the race starts.
    for (let i = 0; i < 5; i++) this._later(i * 120, () => this._ping());
    this._every(this.cfg.pingIntervalMs, () => this._ping());
    return this;
  }

  /** Ask a host about its room without joining (used by quick match). */
  async probe(hostPeerId) {
    const peer = this.peer || (await this.transport.createPeer());
    const ownPeer = !this.peer;
    try {
      const conn = await this.transport.connect(peer, hostPeerId);
      return await new Promise((resolve) => {
        const timer = setTimeout(() => (conn.close(), resolve(null)), this.cfg.connectTimeoutMs);
        conn.on('data', (m) => {
          if (m.k === 'probe-ok') {
            clearTimeout(timer);
            conn.close();
            resolve(m);
          }
        });
        conn.send({ k: 'probe', v: this.cfg.protocolVersion });
      });
    } catch {
      return null;
    } finally {
      if (ownPeer) peer.destroy();
    }
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    this._destroyPeer();
    this.emit('closed');
  }

  _destroyPeer() {
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
  }

  /* ============================================================ game API */

  /** Current time on the host's clock. */
  hostNow() {
    return this.isHost ? this.now() : this.clock.toHost(this.now());
  }

  /** ms since the race started (negative during countdown, null if no race). */
  raceTime() {
    if (!this.room?.startAt) return null;
    return this.hostNow() - this.room.startAt;
  }

  get phase() {
    return this.room?.phase || 'offline';
  }

  get ping() {
    return this.isHost ? 0 : Math.round(this.clock.rtt);
  }

  /** Call every frame (or at least at stateSendHz) with the local car. */
  sendState(state, force = false) {
    if (this.closed || !this.room) return;
    const t = this.now();
    if (!force && t - this._lastSent < 1000 / this.cfg.stateSendHz - 1) return;
    if (!this.isHost && !this.clock.synced) return;
    this._lastSent = t;
    const packed = packState(state, this.hostNow());
    if (this.isHost) {
      this._storeState(this.selfId, packed);
    } else {
      this._sendHost({ k: 'st', ...packed });
    }
  }

  /** Interpolated remote cars, ready to render. */
  getRemoteCars() {
    if (!this.room) return [];
    const renderT = this.hostNow() - this.cfg.interpolationDelayMs;
    const out = [];
    for (const p of this.room.players) {
      if (p.id === this.selfId) continue;
      const buf = this.buffers.get(p.id);
      const snap = buf?.sample(renderT);
      if (!snap) continue;
      buf.prune(renderT - 1000);
      out.push({
        id: p.id,
        name: p.name,
        color: p.color,
        carId: p.carId,
        position: this.order.indexOf(p.id) + 1 || null,
        finished: p.finishMs != null,
        ...snap,
      });
    }
    return out;
  }

  setReady(ready = true) {
    if (this.isHost) this._setReady(this.selfId, ready);
    else this._sendHost({ k: 'ready', on: !!ready });
  }

  /** Change car or paint while in the lobby. */
  setCar({ color, carId } = {}) {
    if (color) this.profile.color = cleanColor(color);
    if (carId) this.profile.carId = String(carId).slice(0, 24);
    if (this.isHost) this._updatePlayer(this.selfId, { color: this.profile.color, carId: this.profile.carId });
    else this._sendHost({ k: 'car', color: this.profile.color, carId: this.profile.carId });
  }

  reportLap(lap, lapMs) {
    if (this.isHost) this._onLap(this.selfId, lap, lapMs);
    else this._sendHost({ k: 'lap', lap, ms: Math.round(lapMs) });
  }

  reportFinish(totalMs, bestLapMs) {
    if (this.isHost) this._onFinish(this.selfId, totalMs, bestLapMs);
    else this._sendHost({ k: 'fin', ms: Math.round(totalMs), best: Math.round(bestLapMs || 0) });
  }

  chat(text) {
    const t = cleanChat(text);
    if (!t) return;
    if (this.isHost) this._onChat(this.selfId, t);
    else this._sendHost({ k: 'chat', text: t });
  }

  /* ----- host-only controls */

  updateSettings(settings) {
    this._requireHost();
    if (this.room.phase !== 'lobby') return;
    const s = { ...this.room.settings };
    if (settings.trackId) s.trackId = String(settings.trackId).slice(0, 40);
    if (settings.laps) s.laps = Math.max(1, Math.min(20, settings.laps | 0));
    if ('collisions' in settings) s.collisions = !!settings.collisions;
    this.room.settings = s;
    this._broadcastLobby();
  }

  startRace() {
    this._requireHost();
    if (this.room.phase !== 'lobby' && this.room.phase !== 'results') return;
    const startAt = this.now() + this.cfg.countdownMs;
    for (const p of this.room.players) {
      Object.assign(p, {
        lap: 0,
        progress: 0,
        finishMs: null,
        bestLapMs: null,
        dnf: false,
        ready: false,
        spectator: false,
      });
    }
    this._finishDeadline = null;
    this.results = null;
    this.room.phase = 'countdown';
    this.room.startAt = startAt;
    this.room.autoStartAt = null;
    this._broadcast({ k: 'go', startAt, settings: this.room.settings });
    this._broadcastLobby();
    this._onGo(startAt);
  }

  returnToLobby() {
    this._requireHost();
    this.room.phase = 'lobby';
    this.room.startAt = null;
    for (const p of this.room.players) p.ready = false;
    this._broadcastLobby();
  }

  kick(peerId) {
    this._requireHost();
    const conn = this.conns.get(peerId);
    if (!conn) return;
    conn.send({ k: 'reject', reason: 'kicked' });
    setTimeout(() => conn.close(), 100);
  }

  /* ============================================================ host side */

  _onGuestConnection(conn) {
    let joined = false;
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (!joined) {
        if (msg.k === 'probe') {
          conn.send({
            k: 'probe-ok',
            players: this.room.players.length,
            max: this.cfg.maxPlayers,
            phase: this.room.phase,
            quick: this.room.quick,
          });
          return;
        }
        if (msg.k !== 'hello') return;
        const reason = this._admit(msg);
        if (reason) {
          conn.send({ k: 'reject', reason });
          setTimeout(() => conn.close(), 200);
          return;
        }
        joined = true;
        this.conns.set(conn.peer, conn);
        const player = this._makePlayer(conn.peer, msg, false);
        if (this.room.phase !== 'lobby') player.spectator = true;
        this.room.players.push(player);
        conn.send({ k: 'welcome', id: conn.peer, hostId: this.selfId });
        this._broadcastLobby();
        this.emit('player-joined', player);
        if (this.room.quick && this._racers().length >= 2 && !this.room.autoStartAt) {
          this.room.autoStartAt = this.now() + this.cfg.quickMatchAutoStartMs;
          this._broadcastLobby();
        }
        return;
      }
      this._onGuestMessage(conn.peer, msg, conn);
    });
    conn.on('close', () => {
      if (joined) this._removePlayer(conn.peer);
    });
    conn.on('error', () => {
      if (joined) this._removePlayer(conn.peer);
    });
  }

  _admit(hello) {
    if (hello.v !== this.cfg.protocolVersion) return 'version';
    if (this.room.players.length >= this.cfg.maxPlayers) return 'full';
    if (this.room.quick && this.room.phase !== 'lobby') return 'in-progress';
    return null;
  }

  _onGuestMessage(id, msg, conn) {
    switch (msg.k) {
      case 'ping':
        conn.send({ k: 'pong', t0: msg.t0, th: this.now() });
        break;
      case 'st':
        if (Array.isArray(msg.p) && Array.isArray(msg.q)) {
          const { k, ...packed } = msg;
          this._storeState(id, packed);
        }
        break;
      case 'ready':
        this._setReady(id, !!msg.on);
        break;
      case 'car':
        this._updatePlayer(id, { color: cleanColor(msg.color), carId: String(msg.carId || '').slice(0, 24) });
        break;
      case 'lap':
        this._onLap(id, msg.lap | 0, +msg.ms);
        break;
      case 'fin':
        this._onFinish(id, +msg.ms, +msg.best);
        break;
      case 'chat':
        this._onChat(id, cleanChat(msg.text));
        break;
      default:
        break;
    }
  }

  _makePlayer(id, p, isHost) {
    return {
      id,
      name: cleanName(p.name),
      color: cleanColor(p.color),
      carId: String(p.carId || 'roadster').slice(0, 24),
      playerId: String(p.playerId || '').slice(0, 40),
      isHost,
      ready: false,
      spectator: false,
      lap: 0,
      progress: 0,
      finishMs: null,
      bestLapMs: null,
      dnf: false,
    };
  }

  _player(id) {
    return this.room.players.find((p) => p.id === id);
  }

  _racers() {
    return this.room.players.filter((p) => !p.spectator);
  }

  _updatePlayer(id, patch) {
    const p = this._player(id);
    if (!p || this.room.phase !== 'lobby') return;
    Object.assign(p, patch);
    this._broadcastLobby();
  }

  _setReady(id, ready) {
    const p = this._player(id);
    if (!p || this.room.phase !== 'lobby') return;
    p.ready = ready;
    this._broadcastLobby();
  }

  _removePlayer(id) {
    this.conns.delete(id);
    this.buffers.delete(id);
    this._latest.delete(id);
    const idx = this.room.players.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const [p] = this.room.players.splice(idx, 1);
    this._broadcastLobby();
    this.emit('player-left', p);
    if (this.room.quick && this._racers().length < 2) this.room.autoStartAt = null;
  }

  _storeState(id, packed) {
    const p = this._player(id);
    if (!p) return;
    p.lap = packed.lap;
    p.progress = packed.pr;
    this._latest.set(id, packed);
    this._dirty.add(id);
    if (id !== this.selfId) this._bufferFor(id).push(unpackState(packed));
  }

  /** Send every guest the states that changed since last tick (except their own). */
  _relay() {
    if (!this._dirty.size) return;
    const cars = {};
    for (const id of this._dirty) cars[id] = this._latest.get(id);
    this._dirty.clear();
    for (const [id, conn] of this.conns) {
      const mine = cars[id];
      if (mine) delete cars[id];
      if (Object.keys(cars).length) conn.send({ k: 'ss', cars });
      if (mine) cars[id] = mine;
    }
  }

  _hostTick() {
    const room = this.room;
    const t = this.now();

    if (room.phase === 'lobby') {
      const racers = this._racers();
      const allReady = racers.length >= 2 && racers.every((p) => p.ready);
      if (allReady && room.quick) this.startRace();
      else if (room.autoStartAt && t >= room.autoStartAt) this.startRace();
      return;
    }

    if (room.phase === 'countdown' && t >= room.startAt) {
      room.phase = 'racing';
      this._broadcastLobby();
    }

    if (room.phase === 'racing') {
      const order = computeOrder(this._racers());
      if (order.join() !== this.order.join()) {
        this.order = order;
        this._broadcast({ k: 'pos', order });
        this.emit('positions', order);
      }
      const racers = this._racers();
      const done = racers.every((p) => p.finishMs != null || p.dnf);
      if (done || (this._finishDeadline && t >= this._finishDeadline)) this._endRace();
    }
  }

  _onLap(id, lap, ms) {
    const p = this._player(id);
    if (!p || !Number.isFinite(ms) || ms <= 0) return;
    if (!p.bestLapMs || ms < p.bestLapMs) p.bestLapMs = ms;
    const ev = { k: 'lapev', id, name: p.name, lap, ms };
    this._broadcast(ev);
    this.emit('lap', ev);
  }

  _onFinish(id, ms, best) {
    const p = this._player(id);
    if (!p || p.finishMs != null || this.room.phase !== 'racing') return;
    if (!Number.isFinite(ms) || ms <= 0) return;
    p.finishMs = ms;
    if (best > 0 && (!p.bestLapMs || best < p.bestLapMs)) p.bestLapMs = best;
    if (!this._finishDeadline) {
      this._finishDeadline = this.now() + this.cfg.finishGraceMs;
      this._broadcast({ k: 'grace', until: this._finishDeadline });
      this.emit('grace', { until: this._finishDeadline });
    }
    this._hostTick();
  }

  _endRace() {
    if (this.room.phase === 'results') return;
    for (const p of this._racers()) if (p.finishMs == null) p.dnf = true;
    const order = computeOrder(this._racers());
    const results = order.map((id, i) => {
      const p = this._player(id);
      return {
        place: i + 1,
        id,
        name: p.name,
        color: p.color,
        playerId: p.playerId,
        totalMs: p.finishMs,
        bestLapMs: p.bestLapMs,
        dnf: p.dnf,
      };
    });
    this.room.phase = 'results';
    this.results = results;
    for (const p of this.room.players) p.spectator = false;
    this._broadcast({ k: 'res', results });
    this._broadcastLobby();
    this.emit('results', results);
    // Quick match rooms cycle back to the lobby on their own.
    if (this.room.quick) this._later(12000, () => this.room.phase === 'results' && this.returnToLobby());
  }

  _onChat(id, text) {
    const p = this._player(id);
    if (!p || !text) return;
    const msg = { k: 'chat', id, name: p.name, text };
    this._broadcast(msg);
    this.emit('chat', msg);
  }

  _broadcast(msg) {
    for (const conn of this.conns.values()) conn.send(msg);
  }

  _broadcastLobby() {
    const room = this._publicRoom();
    this._broadcast({ k: 'lobby', room });
    this.emit('lobby', room);
  }

  _publicRoom() {
    return JSON.parse(JSON.stringify(this.room));
  }

  _requireHost() {
    if (!this.isHost) throw new MultiplayerError('not-host', 'Only the host can do that.');
  }

  /* ============================================================ guest side */

  _onHostMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.k) {
      case 'welcome':
        this.selfId = msg.id;
        this._pendingJoin?.resolve();
        this._pendingJoin = null;
        break;
      case 'reject': {
        const text = {
          full: 'That room is full.',
          version: 'That room is running a different game version. Refresh to update.',
          'in-progress': 'That race already started.',
          kicked: 'You were removed from the room.',
        }[msg.reason] || 'Could not join.';
        const err = new MultiplayerError(msg.reason, text);
        if (this._pendingJoin) {
          this._pendingJoin.reject(err);
          this._pendingJoin = null;
        } else {
          this._onHostLost(text);
        }
        break;
      }
      case 'pong':
        this.clock.addSample(msg.t0, msg.th, this.now());
        this.emit('ping', this.ping);
        break;
      case 'lobby': {
        const prevPhase = this.room?.phase;
        this.room = msg.room;
        for (const id of [...this.buffers.keys()]) {
          if (!this.room.players.some((p) => p.id === id)) this.buffers.delete(id);
        }
        this.emit('lobby', this.room);
        if (prevPhase !== this.room.phase) this.emit('phase', this.room.phase);
        break;
      }
      case 'ss':
        for (const [id, packed] of Object.entries(msg.cars || {})) {
          if (id === this.selfId || !packed) continue;
          this._bufferFor(id).push(unpackState(packed));
          const p = this.room?.players.find((x) => x.id === id);
          if (p) {
            p.lap = packed.lap;
            p.progress = packed.pr;
          }
        }
        break;
      case 'go':
        this.results = null;
        if (this.room) {
          this.room.startAt = msg.startAt;
          this.room.settings = msg.settings;
        }
        this._onGo(msg.startAt);
        break;
      case 'pos':
        this.order = msg.order;
        this.emit('positions', msg.order);
        break;
      case 'lapev':
        this.emit('lap', msg);
        break;
      case 'grace':
        this.emit('grace', { until: msg.until });
        break;
      case 'res':
        this.results = msg.results;
        this.emit('results', msg.results);
        break;
      case 'chat':
        this.emit('chat', msg);
        break;
      default:
        break;
    }
  }

  _onGo(startAt) {
    this.order = [];
    for (const b of this.buffers.values()) b.snaps.length = 0;
    this.emit('countdown', { startAt, startsInMs: startAt - this.hostNow(), settings: this.room.settings });
    this._later(Math.max(0, startAt - this.hostNow()), () => this.emit('race-start'));
  }

  _ping() {
    this._sendHost({ k: 'ping', t0: this.now() });
  }

  _sendHost(msg) {
    if (this.hostConn?.open) this.hostConn.send(msg);
  }

  _onHostLost(reason) {
    if (this.closed) return;
    this._pendingJoin?.reject(new MultiplayerError('disconnected', reason));
    this._pendingJoin = null;
    this.emit('disconnected', { reason });
    this.leave();
  }

  /* ============================================================ utils */

  _bufferFor(id) {
    let b = this.buffers.get(id);
    if (!b) {
      b = new SnapshotBuffer({ maxExtrapolationMs: this.cfg.maxExtrapolationMs });
      this.buffers.set(id, b);
    }
    return b;
  }

  _every(ms, fn) {
    this._timers.push(setInterval(fn, ms));
  }

  _later(ms, fn) {
    const t = setTimeout(() => !this.closed && fn(), ms);
    this._timers.push(t);
  }
}
