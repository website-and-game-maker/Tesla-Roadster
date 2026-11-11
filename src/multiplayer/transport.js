/**
 * Transports create "peers" with the PeerJS shape:
 *   peer.id, peer.on('open'|'connection'|'error'|'disconnected'), peer.connect(id), peer.destroy()
 *   conn.peer, conn.open, conn.on('open'|'data'|'close'|'error'), conn.send(obj), conn.close()
 *
 * PeerTransport uses real WebRTC through PeerJS and its free public broker
 * (only used to exchange connection offers; race traffic goes directly
 * between players). LoopbackTransport is an in-memory network used by tests
 * and by the offline demo.
 */
import { Emitter } from './emitter.js';

let peerCtorPromise = null;

async function loadPeerCtor(moduleUrl) {
  if (globalThis.Peer) return globalThis.Peer;
  if (!peerCtorPromise) {
    peerCtorPromise = import(/* @vite-ignore */ moduleUrl)
      .then((m) => m.Peer || m.default)
      .catch((err) => {
        peerCtorPromise = null;
        throw new MultiplayerError('offline', 'Could not load networking library. Are you online?', err);
      });
  }
  return peerCtorPromise;
}

export class MultiplayerError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

export class PeerTransport {
  constructor(config) {
    this.config = config;
  }

  /** Resolves once the peer is registered with the broker. id is optional. */
  async createPeer(id) {
    const Peer = await loadPeerCtor(this.config.peerjsModuleUrl);
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id, this.config.peer) : new Peer(this.config.peer);
      const timer = setTimeout(() => {
        peer.destroy();
        reject(new MultiplayerError('timeout', 'Matchmaking server did not respond.'));
      }, this.config.connectTimeoutMs);
      peer.once('open', () => {
        clearTimeout(timer);
        resolve(peer);
      });
      peer.once('error', (err) => {
        clearTimeout(timer);
        peer.destroy();
        reject(new MultiplayerError(err.type || 'peer-error', err.message, err));
      });
    });
  }

  /** Opens a data connection; resolves when open, rejects on failure/timeout. */
  connect(peer, remoteId) {
    return new Promise((resolve, reject) => {
      const conn = peer.connect(remoteId, { reliable: true, serialization: 'json' });
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.off?.('error', onPeerError);
        fn(arg);
      };
      const onPeerError = (err) => {
        // PeerJS reports "no such host" as a peer-level error.
        if (err.type === 'peer-unavailable' && String(err.message).includes(remoteId)) {
          done(reject, new MultiplayerError('not-found', 'Room not found.', err));
        }
      };
      const timer = setTimeout(
        () => done(reject, new MultiplayerError('timeout', 'Could not reach that room.')),
        this.config.connectTimeoutMs,
      );
      peer.on('error', onPeerError);
      conn.once('open', () => done(resolve, conn));
      conn.once('error', (err) => done(reject, new MultiplayerError('connect-failed', err.message, err)));
      conn.once('close', () => done(reject, new MultiplayerError('connect-failed', 'Connection closed.')));
    });
  }
}

/* ---------------------------------------------------------------- loopback */

class LoopConn extends Emitter {
  constructor(net, localId, remoteId, latencyMs) {
    super();
    this.net = net;
    this.localId = localId;
    this.peer = remoteId;
    this.latencyMs = latencyMs;
    this.open = false;
    this.other = null;
  }

  once(ev, fn) {
    return super.once(ev, fn);
  }

  send(data) {
    if (!this.open) return;
    // Structured clone mimics serialization so tests catch shared-reference bugs.
    const copy = JSON.parse(JSON.stringify(data));
    const other = this.other;
    setTimeout(() => other.open && other.emit('data', copy), this.latencyMs());
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.other.open = false;
    setTimeout(() => {
      this.emit('close');
      this.other.emit('close');
    }, 0);
  }
}

class LoopPeer extends Emitter {
  constructor(net, id) {
    super();
    this.net = net;
    this.id = id;
    this.conns = new Set();
    this.destroyed = false;
  }

  connect(remoteId) {
    const conn = new LoopConn(this.net, this.id, remoteId, this.net.latency);
    setTimeout(() => {
      const remote = this.net.peers.get(remoteId);
      if (!remote || remote.destroyed) {
        this.emit('error', { type: 'peer-unavailable', message: `Could not connect to peer ${remoteId}` });
        return;
      }
      const back = new LoopConn(this.net, remoteId, this.id, this.net.latency);
      conn.other = back;
      back.other = conn;
      conn.open = back.open = true;
      this.conns.add(conn);
      remote.conns.add(back);
      remote.emit('connection', back);
      setTimeout(() => {
        back.emit('open');
        conn.emit('open');
      }, this.net.latency());
    }, this.net.latency());
    return conn;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.net.peers.delete(this.id);
    for (const c of this.conns) c.close();
  }

  disconnect() {}
}

export class LoopbackNetwork {
  constructor({ latencyMs = 5, jitterMs = 0 } = {}) {
    this.peers = new Map();
    this.latency = () => latencyMs + Math.random() * jitterMs;
    this._n = 0;
  }
}

export class LoopbackTransport {
  constructor(network, config) {
    this.net = network;
    this.config = config;
  }

  async createPeer(id) {
    const finalId = id || `anon-${++this.net._n}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.net.peers.has(finalId)) {
      throw new MultiplayerError('unavailable-id', `ID "${finalId}" is taken`);
    }
    const peer = new LoopPeer(this.net, finalId);
    this.net.peers.set(finalId, peer);
    return peer;
  }

  connect(peer, remoteId) {
    return new Promise((resolve, reject) => {
      const conn = peer.connect(remoteId);
      const off = peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          off();
          reject(new MultiplayerError('not-found', 'Room not found.'));
        }
      });
      conn.once('open', () => {
        off();
        resolve(conn);
      });
    });
  }
}
