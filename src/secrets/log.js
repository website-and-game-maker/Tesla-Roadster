// The Secrets log: a menu screen listing every world's three secrets, with hints once the
// player is a Secret Hunter, challenge status, a "Hunt here" button per world, and the jet
// trails. It registers itself with the UI (ui.addScreen) and adds its own main-menu entry.
import { SECRETS, TOTAL, TRAILS, CHALLENGES, HUNTER_STARS, HUNTER_FINDS, FIND_REWARD, CHALLENGE_REWARD, WORLD_REWARD } from './defs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.4 5.6L20 9.3l-4.2 3.9 1.2 5.8L12 16l-5 3 1.2-5.8L4 9.3l5.6-.7z"/><circle cx="12" cy="11.5" r="1.4"/></g></svg>';
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export function createLog(sys, game) {
  const ui = game.ui;
  const api = { available: false, refresh() {}, open() {} };
  if (!ui || typeof ui.addScreen !== 'function') return api; // fallback UI: secrets still work in races

  const tpl = document.createElement('template');
  tpl.innerHTML = `<section class="s-secrets">
    <div class="ui-head"><button class="ui-back" data-act="back" aria-label="Back"><span>‹</span> Back</button><h2>Secrets</h2><span class="sl-sub"></span></div>
    <div class="sl-wrap"><div class="sl-top"></div><div class="sl-grid"></div><div class="sl-info sl-trailbox"></div></div>
  </section>`;
  const el = tpl.content.firstElementChild;
  let showIntro = false;

  function render() {
    const hunter = sys.hunter, found = sys.foundCount, done = sys.doneCount;
    el.querySelector('.sl-sub').textContent = `${found} / ${TOTAL} found${hunter ? ` · ${done} / ${TOTAL} challenges` : ''}`;
    const top = el.querySelector('.sl-top');
    if (!hunter) {
      const stars = sys.stars;
      top.innerHTML = `<div class="sl-info"><b>You found something that is not on the map.</b>
        <p>Every world hides three secrets like it, floating just off the road. Jet-hop into anything that glints. Each one pays ${FIND_REWARD} cr.</p>
        <p style="margin-top:8px">Become a <b style="display:inline;font-size:inherit">Secret Hunter</b> to get hints, a radar and challenges: earn ${HUNTER_STARS} career stars (you have ${stars}) or find ${HUNTER_FINDS} secrets (you have ${found}).</p>
        <div class="sl-meter"><i style="width:${Math.round(Math.max(Math.min(1, stars / HUNTER_STARS), Math.min(1, found / HUNTER_FINDS)) * 100)}%"></i></div></div>`;
    } else {
      top.innerHTML = `<div class="sl-info hunter"><b>${showIntro ? 'You are now a Secret Hunter' : 'Secret Hunter'}</b>
        <p>Every world hides three secrets. Here is what to do:</p>
        <ol>
          <li><b style="display:inline;font-size:inherit">Pick a world below and press Hunt here.</b> It is free roam in Fly mode: no rivals, no clock.</li>
          <li><b style="display:inline;font-size:inherit">Follow the radar arrow</b> to a light beam, then jet-hop into the secret. The radar tells you how. (${FIND_REWARD} cr)</li>
          <li><b style="display:inline;font-size:inherit">Beat its challenge</b>, which starts as you touch it. Fail and you can retry on the spot. (${CHALLENGE_REWARD} cr, plus ${WORLD_REWARD} cr for a whole world)</li>
        </ol>
        <p style="margin-top:8px">The radar and beams also show during normal Fly races, so you can grab secrets on the way.</p></div>`;
    }
    el.querySelector('.sl-grid').innerHTML = game.worlds.filter((w) => SECRETS[w.id]).map((w) => {
      const list = SECRETS[w.id], f = list.filter((s) => sys.isFound(s.id)).length, d = list.filter((s) => sys.isDone(s.id)).length;
      const items = list.map((s) => {
        const isF = sys.isFound(s.id), isD = sys.isDone(s.id), ch = CHALLENGES[s.challenge];
        const line = isF ? esc(s.flavor) : hunter ? `Hint: ${esc(s.hint)}` : 'Not found yet.';
        const status = !hunter ? '' : isD ? `✓ ${esc(ch.name)} beaten` : isF ? `Challenge: ${esc(ch.name)}. Touch it again in Secret Hunt.` : `Challenge: ${esc(ch.name)}`;
        return `<div class="sl-item${isF ? ' found' : ''}${isD ? ' done' : ''}"><i>${isD ? '✓' : isF ? '◆' : '?'}</i><b>${isF ? esc(s.name) : '? ? ?'}</b><p>${line}</p>${status ? `<em>${status}</em>` : ''}</div>`;
      }).join('');
      const action = hunter
        ? `<button class="ui-secondary sl-go" data-hunt="${esc(w.id)}">${d === list.length ? 'Explore again' : 'Hunt here'} ›</button>`
        : '<div class="sl-lock">Secret Hunt opens when you become a Secret Hunter.</div>';
      return `<div class="sl-world${d === list.length ? ' complete' : ''}"><h3>${esc(w.name)}<span>${f}/${list.length} found${hunter ? ` · ${d}/${list.length} done` : ''}</span></h3>${items}${action}</div>`;
    }).join('');
    const cur = sys.state.trail;
    el.querySelector('.sl-trailbox').innerHTML = `<b>Jet trails</b><p>A coloured trail behind your car when you jet or boost. Find secrets to unlock them.</p>
      <div class="sl-trails">${TRAILS.map((t) => {
        const open = sys.trailUnlocked(t);
        const need = t.done ? `All ${TOTAL} found and beaten` : `${t.need} secrets`;
        return `<button class="ui-secondary${cur === t.id && open ? ' sel' : ''}" data-trail="${esc(t.id)}" ${open ? '' : 'disabled'}>${t.colors ? `<i style="--c:${hex(t.colors[0])}"></i>` : ''}${esc(t.name)}${open ? '' : ` <small>🔒 ${need}</small>`}</button>`;
      }).join('')}</div>`;
  }

  el.addEventListener('click', (e) => {
    const h = e.target.closest('[data-hunt]');
    if (h) {
      // Secrets need the jets, so a hunt is always in Fly mode whatever the Play screen is set to.
      ui.startRace({ mode: 'free', vehicleMode: 'flight', track: h.dataset.hunt });
      return;
    }
    const t = e.target.closest('[data-trail]');
    if (t && !t.disabled) { sys.setTrail(t.dataset.trail); sys.audio('click'); render(); el.querySelector(`[data-trail="${t.dataset.trail}"]`)?.focus(); }
  });
  ui.addScreen('secrets', el, () => { render(); showIntro = false; el.scrollTop = 0; });

  // main-menu entry, added once there is something to show
  let btn = null;
  function menuButton() {
    const nav = document.querySelector('.s-main .m-nav');
    if (!nav) return;
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'm-item sx-menu'; btn.dataset.go = 'secrets';
      const settings = nav.querySelector('[data-go="settings"]');
      nav.insertBefore(btn, settings || null);
    }
    btn.style.display = sys.visible ? '' : 'none';
    const s = sys.state, fresh = sys.hunter && !s.intro;
    btn.innerHTML = `<i>${ICON}</i><span><b>Secrets${fresh ? '<span class="sx-new">NEW</span>' : ''}</b><small>${sys.hunter ? `${sys.foundCount} of ${TOTAL} found · hints and challenges` : `${sys.foundCount} of ${TOTAL} found`}</small></span>`;
  }

  api.available = true;
  api.refresh = () => { menuButton(); if (ui.screen === 'secrets') render(); };
  api.open = (intro) => { showIntro = !!intro; menuButton(); ui.go('secrets'); };
  return api;
}
