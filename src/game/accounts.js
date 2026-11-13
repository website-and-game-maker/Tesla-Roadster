// Account glue: UI 'auth' events -> Supabase auth (src/multiplayer/account.js), and cloud saves.
// Free tier only. With no Supabase keys configured, the game stays fully playable on local saves
// and the sign-in screen explains that online accounts are not switched on for this copy.
import { mergeProfile } from '../core/save.js';

const progressOf = (p) => {
  if (!p || typeof p !== 'object') return -1;
  const stars = Object.values(p.stars || {}).reduce((a, b) => a + (b | 0), 0);
  const ups = Object.values(p.upgrades || {}).reduce((a, b) => a + (b | 0), 0);
  return stars * 1000 + ups * 300 + (p.owned ? Object.keys(p.owned).length : 0) * 50 + Math.min(999, (p.credits | 0) / 100);
};

export async function attachAccounts(game) {
  let mod;
  try { mod = await import('../multiplayer/index.js'); } catch (e) { console.warn('[accounts] unavailable', e); return null; }
  const { auth, cloud } = mod;
  const ui = game.ui;
  const show = (extra = {}) => {
    const u = auth.user;
    ui.setAccount && ui.setAccount({ signedIn: !!u, email: u?.email || '', name: u?.email ? u.email.split('@')[0] : (u ? 'Guest' : ''), guest: !!u?.isAnonymous, error: '', pending: false, ...extra });
  };

  // after sign-in: keep whichever save has more progress, then sync both ways
  async function sync() {
    const remote = await cloud.loadProfile();
    if (remote && progressOf(remote) > progressOf(game.profile)) {
      game.profile = mergeProfile(remote);
      game.save(); game.pushProfile(); game.applySettings && game.applySettings();
      game.rebuildShowroomCar && game.rebuildShowroomCar();
      ui.toast && ui.toast('Cloud save loaded');
    } else {
      cloud.saveProfile(game.profile);
    }
  }

  ui.on('auth', async ({ action, email, password } = {}) => {
    if (!auth.enabled && action !== 'signout') {
      show({ error: action === 'guest' ? '' : 'Online accounts are not switched on for this copy of the game yet. Your progress is saved on this device.' });
      return;
    }
    try {
      if (action === 'signin') await auth.signIn(email, password);
      else if (action === 'signup') {
        const r = auth.user && auth.user.isAnonymous ? { user: await auth.upgrade(email, password) } : await auth.signUp(email, password);
        if (r.needsConfirmation) { show({ error: 'Check your inbox to confirm your email, then sign in.' }); return; }
      } else if (action === 'guest') await auth.signInAsGuest();
      else if (action === 'signout') { await cloud.flush(); await auth.signOut(); show(); return; }
      show();
      ui.toast && ui.toast(action === 'guest' ? 'Playing as guest: saves sync to this account' : 'Signed in');
      await sync();
    } catch (e) {
      show({ error: e?.message || 'Something went wrong. Try again.' });
    }
  });

  // every local save also goes to the cloud when signed in (the account module coalesces uploads)
  const save = game.save.bind(game);
  game.save = () => { save(); if (cloud.enabled) cloud.saveProfile(game.profile); };

  show();
  if (auth.user) sync().catch(() => {});
  return { auth, cloud };
}
