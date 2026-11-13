/**
 * Free player accounts and cloud saves on Supabase (free tier), via its
 * plain REST endpoints, so there is no SDK to download.
 *
 *   auth.signUp(email, pw) / auth.signIn(email, pw) / auth.signInAsGuest()
 *   auth.upgrade(email, pw)   turn a guest into a full account, keeping its saves
 *   auth.signOut()
 *   auth.user                 { id, email, isAnonymous } | null
 *   auth.onChange(cb)         cb(user) now and on every change; returns unsubscribe
 *   cloud.loadProfile()       -> saved JSON | null
 *   cloud.saveProfile(json)   -> { saved, reason? }  (coalesced: at most one upload per 3 s)
 *
 * With no Supabase URL/key configured everything still works: auth.enabled is
 * false, sign-in calls reject with a friendly message, and cloud calls are
 * no-ops, so the game keeps using its local save.
 */

const SESSION_KEY = 'trr.auth.session.v1';
const SAVE_MIN_INTERVAL_MS = 3000;
const MAX_SAVE_BYTES = 900 * 1024; // the database rejects rows over 1 MB

export class AccountError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function safeStore(storage) {
  return {
    get(k) {
      try {
        return JSON.parse(storage?.getItem(k) || 'null');
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) storage?.removeItem(k);
        else storage?.setItem(k, JSON.stringify(v));
      } catch {
        /* private mode: session lasts until reload */
      }
    },
  };
}

/** Turn GoTrue / PostgREST error bodies into one readable sentence. */
function friendly(status, body) {
  const raw = body?.error_description || body?.msg || body?.message || body?.error || '';
  const code = body?.error_code || body?.code || String(status);
  const map = {
    invalid_credentials: 'Wrong email or password.',
    user_already_exists: 'That email already has an account. Sign in instead.',
    email_address_invalid: 'That email address looks invalid.',
    weak_password: 'Password is too weak. Use at least 6 characters.',
    over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
    over_email_send_rate_limit: 'Too many emails sent. Wait a minute and try again.',
    email_not_confirmed: 'Check your inbox and confirm your email first.',
    anonymous_provider_disabled: 'Guest accounts are turned off for this game.',
  };
  return new AccountError(code, map[code] || raw || `Server error (${status}).`);
}

export function createAccount(config, { storage = globalThis.localStorage, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const sb = config?.supabase || {};
  const enabled = !!(sb.url && sb.anonKey && fetchImpl);
  const base = enabled ? sb.url.replace(/\/+$/, '') : '';
  const store = safeStore(storage);
  const fetchFn = fetchImpl && fetchImpl.bind ? fetchImpl.bind(globalThis) : fetchImpl;
  const listeners = new Set();

  let session = enabled ? store.get(SESSION_KEY) : null;
  let refreshTimer = null;
  let refreshing = null;

  const toUser = (s) =>
    s?.user ? { id: s.user.id, email: s.user.email || null, isAnonymous: !!s.user.is_anonymous } : null;

  function notify() {
    const u = toUser(session);
    for (const cb of [...listeners]) {
      try {
        cb(u);
      } catch (err) {
        console.error('[account] onChange handler threw', err);
      }
    }
  }

  async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), 10000);
    let res;
    try {
      res = await fetchFn(base + path, {
        method,
        signal: ctrl?.signal,
        headers: {
          apikey: sb.anonKey,
          Authorization: `Bearer ${token || sb.anonKey}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new AccountError('offline', 'Could not reach the server. Check your connection.');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw friendly(res.status, json);
    return json;
  }

  function setSession(s) {
    if (s && s.access_token) {
      session = {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: s.expires_at ? s.expires_at * 1000 : now() + (s.expires_in || 3600) * 1000,
        user: s.user,
      };
    } else {
      session = null;
    }
    store.set(SESSION_KEY, session);
    scheduleRefresh();
    notify();
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!session) return;
    const wait = Math.max(5000, session.expires_at - now() - 60000);
    refreshTimer = setTimeout(() => refresh().catch(() => {}), Math.min(wait, 2 ** 31 - 1));
    refreshTimer?.unref?.(); // don't keep Node (tests) alive; no-op in browsers
  }

  async function refresh() {
    if (!session?.refresh_token) return null;
    if (!refreshing) {
      refreshing = request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: session.refresh_token },
      })
        .then((s) => {
          setSession(s);
          return session;
        })
        .catch((err) => {
          // A revoked/expired refresh token means the login is gone; offline keeps it for later.
          if (err.code !== 'offline') setSession(null);
          throw err;
        })
        .finally(() => (refreshing = null));
    }
    return refreshing;
  }

  async function accessToken() {
    if (!session) return null;
    if (session.expires_at - now() < 30000) await refresh();
    return session?.access_token || null;
  }

  function requireEnabled() {
    if (!enabled) throw new AccountError('not-configured', 'Online accounts are not set up for this copy of the game.');
  }

  function checkCreds(email, password) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw new AccountError('email_address_invalid', 'That email address looks invalid.');
    if (String(password || '').length < 6) throw new AccountError('weak_password', 'Password needs at least 6 characters.');
  }

  const auth = {
    get enabled() {
      return enabled;
    },
    get user() {
      return toUser(session);
    },

    onChange(cb) {
      listeners.add(cb);
      try {
        cb(toUser(session));
      } catch (err) {
        console.error('[account] onChange handler threw', err);
      }
      return () => listeners.delete(cb);
    },

    /** Resolves { user, needsConfirmation }. needsConfirmation: the project requires email confirmation. */
    async signUp(email, password) {
      requireEnabled();
      checkCreds(email, password);
      const res = await request('/auth/v1/signup', { method: 'POST', body: { email: email.trim(), password } });
      if (res?.access_token) {
        setSession(res);
        return { user: auth.user, needsConfirmation: false };
      }
      return { user: null, needsConfirmation: true };
    },

    async signIn(email, password) {
      requireEnabled();
      checkCreds(email, password);
      setSession(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password } }));
      return auth.user;
    },

    /** Guest account: no email needed, saves still sync. Needs "Anonymous sign-ins" on in Supabase. */
    async signInAsGuest() {
      requireEnabled();
      if (session) return auth.user;
      setSession(await request('/auth/v1/signup', { method: 'POST', body: { data: {} } }));
      return auth.user;
    },

    /** Attach an email + password to the current guest account (keeps the same user id and saves). */
    async upgrade(email, password) {
      requireEnabled();
      checkCreds(email, password);
      const token = await accessToken();
      if (!token) throw new AccountError('not-signed-in', 'Sign in as a guest first.');
      const user = await request('/auth/v1/user', { method: 'PUT', token, body: { email: email.trim(), password } });
      if (session && user?.id) {
        session.user = user;
        store.set(SESSION_KEY, session);
        notify();
      }
      return auth.user;
    },

    async signOut() {
      const token = session?.access_token;
      setSession(null);
      if (enabled && token) await request('/auth/v1/logout', { method: 'POST', token }).catch(() => {});
    },
  };

  /* ------------------------------------------------------------- cloud */

  let pending = null; // latest JSON waiting to upload
  let pendingWaiters = [];
  let lastUpload = 0;
  let uploadTimer = null;

  async function upload() {
    uploadTimer = null;
    const data = pending;
    const waiters = pendingWaiters;
    pending = null;
    pendingWaiters = [];
    lastUpload = now();
    let result;
    try {
      const token = await accessToken();
      const user = auth.user;
      if (!token || !user) result = { saved: false, reason: 'signed-out' };
      else {
        await request('/rest/v1/profiles?on_conflict=id', {
          method: 'POST',
          token,
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: { id: user.id, data },
        });
        cloud.lastSavedAt = new Date(now()).toISOString();
        result = { saved: true };
      }
    } catch (err) {
      result = { saved: false, reason: err.code || 'error', message: err.message };
    }
    waiters.forEach((w) => w(result));
  }

  const cloud = {
    lastSavedAt: null,
    lastLoadedAt: null,

    get enabled() {
      return enabled && !!session;
    },

    /** The player's saved JSON from the cloud, or null (signed out / nothing saved / offline). */
    async loadProfile() {
      if (!enabled || !session) return null;
      try {
        const token = await accessToken();
        const user = auth.user;
        if (!token || !user) return null;
        const rows = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=data,updated_at`, { token });
        const row = rows?.[0];
        cloud.lastLoadedAt = row?.updated_at || null;
        return row ? row.data : null;
      } catch (err) {
        console.warn('[cloud] load failed; staying on the local save', err);
        return null;
      }
    },

    /** Queue the JSON save for upload. Rapid calls coalesce into one request. */
    saveProfile(json) {
      if (!enabled || !session) return Promise.resolve({ saved: false, reason: enabled ? 'signed-out' : 'not-configured' });
      let size = 0;
      try {
        size = new TextEncoder().encode(JSON.stringify(json)).length;
      } catch {
        return Promise.resolve({ saved: false, reason: 'not-json' });
      }
      if (size > MAX_SAVE_BYTES) return Promise.resolve({ saved: false, reason: 'too-large' });
      pending = json;
      const p = new Promise((resolve) => pendingWaiters.push(resolve));
      if (!uploadTimer) uploadTimer = setTimeout(upload, Math.max(0, lastUpload + SAVE_MIN_INTERVAL_MS - now()));
      return p;
    },

    /** Upload any queued save right away (e.g. on page hide). */
    flush() {
      if (uploadTimer) {
        clearTimeout(uploadTimer);
        return upload();
      }
      return Promise.resolve();
    },
  };

  if (session) {
    scheduleRefresh();
    if (session.expires_at - now() < 60000) refresh().catch(() => {});
  }

  return { auth, cloud };
}
