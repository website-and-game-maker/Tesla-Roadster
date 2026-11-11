// Run: node --test tests/multiplayer/
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync } from '../../src/multiplayer/clock.js';
import { SnapshotBuffer, hermite, slerp } from '../../src/multiplayer/interpolation.js';
import { computeOrder, makeRoomCode, isValidRoomCode, normalizeRoomCode, packState, cleanName } from '../../src/multiplayer/protocol.js';
import { LoopbackNetwork, LoopbackTransport } from '../../src/multiplayer/transport.js';
import { Multiplayer } from '../../src/multiplayer/index.js';
import { createLeaderboard, bestPerPlayer } from '../../src/multiplayer/leaderboard.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout waiting for condition');
    await wait(10);
  }
};

const fastCfg = {
  connectTimeoutMs: 500,
  countdownMs: 300,
  finishGraceMs: 400,
  quickMatchAutoStartMs: 300,
  quickMatchSlots: 3,
  interpolationDelayMs: 50,
};

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

function makePlayers(n, net = new LoopbackNetwork({ latencyMs: 3, jitterMs: 4 })) {
  return Array.from({ length: n }, (_, i) =>
    new Multiplayer(
      { name: `P${i}`, color: '#11223' + i },
      { config: fastCfg, transport: new LoopbackTransport(net, fastCfg), storage: memStorage(), fetchImpl: null },
    ),
  );
}

const carState = (x, lap = 0, progress = 0) => ({
  pos: [x, 0, 0],
  quat: [0, 0, 0, 1],
  vel: [10, 0, 0],
  speed: 10,
  steer: 0,
  lap,
  progress,
});

/* ---------------------------------------------------------------- units */

test('clock sync recovers a fixed offset despite jittery round trips', () => {
  const c = new ClockSync();
  const offset = 5000;
  let t = 0;
  for (let i = 0; i < 12; i++) {
    const up = 10 + (i % 3) * 30;
    const down = 10;
    const t0 = t;
    const th = t0 + up + offset;
    const t1 = t0 + up + down;
    c.addSample(t0, th, t1);
    t += 1000;
  }
  assert.ok(c.synced);
  assert.ok(Math.abs(c.offset - offset) < 1, `offset ${c.offset}`);
});

test('hermite hits both endpoints and matches straight-line motion', () => {
  const p = hermite([0, 0, 0], [10, 0, 0], [1, 0, 0], [10, 0, 0], 0.1, 0.5);
  assert.ok(Math.abs(p[0] - 0.5) < 1e-9);
  assert.deepEqual(hermite([0, 0, 0], [1, 0, 0], [5, 0, 0], [1, 0, 0], 1, 1), [5, 0, 0]);
});

test('slerp stays unit-length and takes the short path', () => {
  const q = slerp([0, 0, 0, 1], [0, 0, 0, -1], 0.5);
  assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9);
  assert.ok(Math.abs(q[3]) > 0.999);
});

test('snapshot buffer interpolates, reorders and caps extrapolation', () => {
  const b = new SnapshotBuffer({ maxExtrapolationMs: 100 });
  b.push({ t: 100, p: [1, 0, 0], q: [0, 0, 0, 1], v: [10, 0, 0] });
  b.push({ t: 0, p: [0, 0, 0], q: [0, 0, 0, 1], v: [10, 0, 0] });
  b.push({ t: 100, p: [9, 9, 9], q: [0, 0, 0, 1], v: [0, 0, 0] }); // duplicate dropped
  assert.equal(b.snaps.length, 2);
  assert.ok(Math.abs(b.sample(50).p[0] - 0.5) < 1e-9);
  const ex = b.sample(1000);
  assert.ok(Math.abs(ex.p[0] - 2) < 1e-9, 'extrapolates only 100ms');
  assert.equal(ex.stale, true);
});

test('race order: finishers by time, then laps, then progress, DNF last', () => {
  const order = computeOrder([
    { id: 'a', lap: 2, progress: 0.5 },
    { id: 'b', lap: 2, progress: 0.9 },
    { id: 'c', lap: 3, progress: 0, finishMs: 9000 },
    { id: 'd', lap: 3, progress: 0, finishMs: 8000 },
    { id: 'e', dnf: true },
    { id: 'f', lap: 1, progress: 0.99 },
  ]);
  assert.deepEqual(order, ['d', 'c', 'b', 'a', 'f', 'e']);
});

test('room codes and sanitising', () => {
  for (let i = 0; i < 200; i++) assert.ok(isValidRoomCode(makeRoomCode()));
  assert.equal(normalizeRoomCode(' ab-c d2 '), 'ABCD2');
  assert.equal(isValidRoomCode('ABCD0'), false);
  assert.equal(cleanName('<script>very long name here'), 'scriptvery long');
  assert.equal(cleanName('   '), 'Driver');
  const w = packState({ pos: [1.23456, 2, 3], quat: [0, 0.123456789, 0, 1], speed: 1 }, 1234.6);
  assert.deepEqual(w.p, [1.23, 2, 3]);
  assert.equal(w.t, 1235);
});

/* ---------------------------------------------------------------- rooms */

test('private room: host + 2 guests see each other move, race, get results', async () => {
  const [host, g1, g2] = makePlayers(3);
  const code = await host.hostRoom({ trackId: 'coast', laps: 2 });
  assert.ok(isValidRoomCode(code));
  await g1.joinRoom(code.toLowerCase());
  await g2.joinRoom(code);
  await until(() => host.room.players.length === 3 && g2.room?.players.length === 3);
  await until(() => g1.session.clock.synced && g2.session.clock.synced);

  // Guests ready up, host starts.
  g1.session.setReady(true);
  g2.session.setReady(true);
  await until(() => host.room.players.filter((p) => p.ready).length === 2);

  const countdowns = [];
  for (const p of [host, g1, g2]) p.on('countdown', (c) => countdowns.push(c.startAt));
  host.session.startRace();
  await until(() => countdowns.length === 3);
  assert.equal(new Set(countdowns).size, 1, 'everyone got the same start time');

  // Drive: each player streams states for a bit.
  const players = [host, g1, g2];
  for (let i = 0; i < 15; i++) {
    players.forEach((p, k) => p.sendState(carState(i + k * 100, 1, k * 0.1)));
    await wait(55);
  }
  const seen = g1.getRemoteCars();
  assert.equal(seen.length, 2, 'guest sees host and other guest');
  const hostCar = seen.find((c) => c.id === host.session.selfId);
  assert.ok(hostCar.p[0] > 5 && hostCar.p[0] < 16, `host car x=${hostCar.p[0]}`);
  assert.equal(host.getRemoteCars().length, 2);

  await until(() => host.room.phase === 'racing');
  await until(() => g1.session.order.length === 3);
  assert.equal(g1.session.order[0], g2.session.selfId, 'highest progress leads');

  const results = [];
  g1.on('results', (r) => results.push(r));
  g2.reportLap(1, 30000);
  g2.reportFinish(60000, 29000);
  g1.reportFinish(61000, 30500);
  // host never finishes -> DNF after grace
  await until(() => results.length === 1, 2000);
  const r = results[0];
  assert.deepEqual(r.map((x) => x.name), ['P2', 'P1', 'P0']);
  assert.equal(r[2].dnf, true);
  assert.equal(r[0].bestLapMs, 29000);

  host.session.returnToLobby();
  await until(() => g1.room.phase === 'lobby');
  [host, g1, g2].forEach((p) => p.leave());
});

test('guests are told when the host leaves; joining a missing room fails cleanly', async () => {
  const [host, guest, other] = makePlayers(3);
  const code = await host.hostRoom();
  await guest.joinRoom(code);
  let reason = null;
  guest.on('disconnected', (d) => (reason = d.reason));
  host.leave();
  await until(() => reason !== null);
  assert.equal(guest.online, false);

  await assert.rejects(other.joinRoom('ZZZZZ'), (e) => e.code === 'not-found' || e.code === 'timeout');
  await assert.rejects(other.joinRoom('bad'), (e) => e.code === 'bad-code');
});

test('room enforces max players', async () => {
  const net = new LoopbackNetwork();
  const ps = makePlayers(10, net);
  const code = await ps[0].hostRoom();
  for (let i = 1; i < 8; i++) await ps[i].joinRoom(code);
  await assert.rejects(ps[8].joinRoom(code), (e) => e.code === 'full');
  ps.forEach((p) => p.leave());
});

test('quick match: first player hosts, second joins, race auto-starts', async () => {
  const [a, b] = makePlayers(2);
  const ra = await a.quickMatch();
  assert.equal(ra.hosting, true);
  assert.equal(ra.slot, 1);
  const rb = await b.quickMatch();
  assert.equal(rb.hosting, false);
  let started = 0;
  a.on('countdown', () => started++);
  b.on('countdown', () => started++);
  await until(() => started === 2, 3000);
  a.leave();
  b.leave();
});

test('quick match: full / in-progress lobby sends you to the next slot', async () => {
  const [a, b, c] = makePlayers(3);
  await a.quickMatch();
  await b.quickMatch();
  await until(() => a.room.phase !== 'lobby', 3000); // auto-started race
  const rc = await c.quickMatch();
  assert.equal(rc.slot, 2);
  assert.equal(rc.hosting, true);
  [a, b, c].forEach((p) => p.leave());
});

/* ---------------------------------------------------------------- leaderboard */

test('local leaderboard keeps best lap per player and validates input', async () => {
  const lb = createLeaderboard({ supabase: {} }, { storage: memStorage(), fetchImpl: null });
  assert.equal(lb.isGlobal, false);
  assert.equal((await lb.submit({ trackId: 't', lapMs: 70000, name: 'Ada' })).personalBest, true);
  assert.equal((await lb.submit({ trackId: 't', lapMs: 75000, name: 'Ada' })).personalBest, false);
  assert.equal(lb.personalBest('t'), 70000);
  assert.equal((await lb.top('t')).length, 1);
  await assert.rejects(lb.submit({ trackId: 't', lapMs: 10, name: 'Ada' }));
  await assert.rejects(lb.submit({ trackId: 't', lapMs: 70000, name: '' }));
  assert.deepEqual(
    bestPerPlayer([{ playerId: 1, lapMs: 5 }, { playerId: 1, lapMs: 3 }, { playerId: 2, lapMs: 4 }], 10).map((r) => r.lapMs),
    [3, 4],
  );
});

test('leaderboard survives a storage that throws', async () => {
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const lb = createLeaderboard({}, { storage: bad, fetchImpl: null });
  await lb.submit({ trackId: 't', lapMs: 60000, name: 'X' });
  assert.equal(lb.personalBest('t'), 60000);
});

test('supabase leaderboard: correct REST calls, falls back to local offline', async () => {
  const calls = [];
  let online = true;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (!online) throw new Error('offline');
    return { ok: true, json: async () => [{ name: 'Z', lap_ms: 50000, color: '#ffffff', car_id: 'roadster', created_at: 'x', player_id: 'p' }] };
  };
  const lb = createLeaderboard({ supabase: { url: 'https://x.supabase.co/', anonKey: 'anon' } }, { storage: memStorage(), fetchImpl });
  assert.equal(lb.isGlobal, true);
  const res = await lb.submit({ trackId: 'coast', lapMs: 61234, name: 'Ada', mode: 'online' });
  assert.equal(res.uploaded, true);
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/lap_times');
  assert.equal(calls[0].init.headers.apikey, 'anon');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer anon');
  assert.equal(JSON.parse(calls[0].init.body).lap_ms, 61234);

  const top = await lb.top('coast');
  assert.match(calls[1].url, /\/best_laps\?.*track_id=eq\.coast/);
  assert.equal(top[0].name, 'Z');

  await lb.top('coast', { period: 'week' });
  assert.match(calls[2].url, /\/lap_times\?.*created_at=gte\./);

  online = false;
  const local = await lb.top('coast');
  assert.equal(local[0].name, 'Ada');
  assert.equal((await lb.submit({ trackId: 'coast', lapMs: 60000, name: 'Ada' })).uploaded, false);
});
