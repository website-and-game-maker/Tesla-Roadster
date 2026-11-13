// Run: node --test tests/multiplayer/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount } from '../../src/multiplayer/account.js';
import { packState, unpackState } from '../../src/multiplayer/protocol.js';
import { createLeaderboard } from '../../src/multiplayer/leaderboard.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const CFG = { supabase: { url: 'https://proj.supabase.co/', anonKey: 'anon-key' } };
const session = (id, extra = {}) => ({
  access_token: 'tok-' + id,
  refresh_token: 'ref-' + id,
  expires_in: 3600,
  user: { id, email: extra.email || null, is_anonymous: !!extra.anon },
});
const reply = (status, body) => ({ ok: status < 400, status, text: async () => (body == null ? '' : JSON.stringify(body)) });

/** Minimal fake of the Supabase auth + profiles endpoints. */
function fakeSupabase() {
  const calls = [];
  const profiles = new Map();
  const users = new Map(); // email -> { id, password }
  let n = 0;
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://proj.supabase.co', '');
    const body = init.body ? JSON.parse(init.body) : null;
    const auth = init.headers?.Authorization;
    calls.push({ path, method: init.method || 'GET', body, auth, headers: init.headers });
    if (path === '/auth/v1/signup') {
      if (!body.email) return reply(200, session('guest-' + ++n, { anon: true }));
      if (users.has(body.email)) return reply(422, { error_code: 'user_already_exists', msg: 'exists' });
      const id = 'user-' + ++n;
      users.set(body.email, { id, password: body.password });
      return reply(200, session(id, { email: body.email }));
    }
    if (path === '/auth/v1/token?grant_type=password') {
      const u = users.get(body.email);
      if (!u || u.password !== body.password) return reply(400, { error_code: 'invalid_credentials', msg: 'bad' });
      return reply(200, session(u.id, { email: body.email }));
    }
    if (path === '/auth/v1/user' && init.method === 'PUT') {
      const id = auth.replace('Bearer tok-', '');
      users.set(body.email, { id, password: body.password });
      return reply(200, { id, email: body.email, is_anonymous: false });
    }
    if (path === '/auth/v1/logout') return reply(204, null);
    if (path.startsWith('/rest/v1/profiles?on_conflict=id')) {
      const uid = auth.replace('Bearer tok-', '');
      if (body.id !== uid) return reply(403, { message: 'RLS' });
      profiles.set(uid, body.data);
      return reply(201, null);
    }
    if (path.startsWith('/rest/v1/profiles?id=eq.')) {
      const uid = auth.replace('Bearer tok-', '');
      const id = decodeURIComponent(path.match(/id=eq\.([^&]+)/)[1]);
      return reply(200, id === uid && profiles.has(id) ? [{ data: profiles.get(id), updated_at: 'now' }] : []);
    }
    return reply(404, { message: 'no route ' + path });
  };
  return { fetchImpl, calls, profiles };
}

test('without Supabase keys everything is local-only and never throws on save/load', async () => {
  const { auth, cloud } = createAccount({ supabase: {} }, { storage: memStorage(), fetchImpl: async () => assert.fail('no network') });
  assert.equal(auth.enabled, false);
  assert.equal(auth.user, null);
  let seen;
  auth.onChange((u) => (seen = u));
  assert.equal(seen, null);
  assert.equal(await cloud.loadProfile(), null);
  assert.deepEqual(await cloud.saveProfile({ a: 1 }), { saved: false, reason: 'not-configured' });
  await assert.rejects(auth.signIn('a@b.co', 'secret1'), (e) => e.code === 'not-configured');
});

test('sign up, save, sign out, sign back in and load the same save', async () => {
  const sb = fakeSupabase();
  const storage = memStorage();
  const { auth, cloud } = createAccount(CFG, { storage, fetchImpl: sb.fetchImpl });
  const changes = [];
  auth.onChange((u) => changes.push(u?.email || null));

  const r = await auth.signUp('ada@example.com', 'hunter22');
  assert.equal(r.needsConfirmation, false);
  assert.equal(auth.user.email, 'ada@example.com');
  assert.equal(sb.calls[0].headers.apikey, 'anon-key');

  // Rapid saves coalesce into one upload holding the latest data.
  const p1 = cloud.saveProfile({ credits: 1 });
  const p2 = cloud.saveProfile({ credits: 2 });
  assert.deepEqual(await Promise.all([p1, p2]), [{ saved: true }, { saved: true }]);
  const uploads = sb.calls.filter((c) => c.path.startsWith('/rest/v1/profiles?on_conflict'));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.match(uploads[0].auth, /^Bearer tok-user-/);

  await auth.signOut();
  assert.equal(auth.user, null);
  assert.equal(await cloud.loadProfile(), null);

  await auth.signIn('ada@example.com', 'hunter22');
  assert.deepEqual(await cloud.loadProfile(), { credits: 2 });
  assert.deepEqual(changes, [null, 'ada@example.com', null, 'ada@example.com']);

  // Session survives a reload.
  const again = createAccount(CFG, { storage, fetchImpl: sb.fetchImpl });
  assert.equal(again.auth.user.email, 'ada@example.com');
});

test('friendly errors and input checks', async () => {
  const sb = fakeSupabase();
  const { auth } = createAccount(CFG, { storage: memStorage(), fetchImpl: sb.fetchImpl });
  await assert.rejects(auth.signIn('nobody@example.com', 'whatever'), (e) => e.message === 'Wrong email or password.');
  await auth.signUp('x@example.com', 'secret1');
  await auth.signOut();
  await assert.rejects(auth.signUp('x@example.com', 'secret1'), /already has an account/);
  await assert.rejects(auth.signUp('not-an-email', 'secret1'), (e) => e.code === 'email_address_invalid');
  await assert.rejects(auth.signUp('y@example.com', '123'), (e) => e.code === 'weak_password');
  const offline = createAccount(CFG, { storage: memStorage(), fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(offline.auth.signIn('a@b.co', 'secret1'), (e) => e.code === 'offline');
});

test('guest account keeps its save after upgrading to email', async () => {
  const sb = fakeSupabase();
  const { auth, cloud } = createAccount(CFG, { storage: memStorage(), fetchImpl: sb.fetchImpl });
  const guest = await auth.signInAsGuest();
  assert.equal(guest.isAnonymous, true);
  await cloud.saveProfile({ stars: 5 });
  const up = await auth.upgrade('kid@example.com', 'secret1');
  assert.equal(up.id, guest.id);
  assert.equal(up.isAnonymous, false);
  assert.deepEqual(await cloud.loadProfile(), { stars: 5 });
});

test('expired session refreshes before a cloud call', async () => {
  const sb = fakeSupabase();
  const storage = memStorage();
  storage.setItem(
    'trr.auth.session.v1',
    JSON.stringify({ access_token: 'old', refresh_token: 'r1', expires_at: Date.now() - 1000, user: { id: 'u9' } }),
  );
  const fetchImpl = async (url, init) => {
    if (url.endsWith('grant_type=refresh_token')) return reply(200, session('u9'));
    return sb.fetchImpl(url, init);
  };
  const { cloud } = createAccount(CFG, { storage, fetchImpl });
  assert.equal(await cloud.loadProfile(), null);
  assert.ok(sb.calls.some((c) => c.auth === 'Bearer tok-u9'), 'used refreshed token');
});

test('flight state round-trips through the wire format', () => {
  const w = packState(
    { mode: 'flight', pos: [1, 120.5, 3], quat: [0.1, 0.2, 0.3, 0.927], vel: [0, 5, 60], speed: 61, thrust: 0.756, ringIndex: 7, lap: 1, progress: 0.4 },
    1000,
  );
  const s = unpackState(w);
  assert.equal(s.mode, 'flight');
  assert.equal(s.thrust, 0.76);
  assert.equal(s.ringIndex, 7);
  assert.deepEqual(s.p, [1, 120.5, 3]);
  assert.equal(unpackState(packState({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }, 0)).mode, 'drive');
});

test('flight time attack leaderboard is per course id', async () => {
  const lb = createLeaderboard({}, { storage: memStorage(), fetchImpl: null });
  await lb.submit({ courseId: 'canyon-rings', lapMs: 42000, name: 'Ada', mode: 'flight' });
  await lb.submit({ courseId: 'orbit-rings', lapMs: 90000, name: 'Ada', mode: 'flight' });
  assert.equal((await lb.top('canyon-rings'))[0].lapMs, 42000);
  assert.equal((await lb.top('canyon-rings'))[0].mode, 'flight');
  assert.equal(lb.personalBest('orbit-rings'), 90000);
});
