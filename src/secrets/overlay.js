// In-race overlay for secrets: the "secret found" banner, the hunter radar and the
// challenge card. Plain DOM, styled by secrets.css, living inside the UI root so it shares
// the menu theme and the phone layout switches (.is-touch).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createOverlay({ jetLabel, retryLabel, onRetry }) {
  const host = document.querySelector('.ui-root') || document.body;
  const el = document.createElement('div');
  el.className = 'sx-root';
  el.innerHTML = `
    <div class="sx-radar" aria-live="off"><i class="sx-arrow"></i><div><b class="sx-r1"></b><span class="sx-r2"></span><em class="sx-r3"></em></div></div>
    <div class="sx-banner" role="status"><span class="sx-k"></span><b class="sx-t"></b><p class="sx-x"></p><em class="sx-f"></em></div>
    <div class="sx-ch" role="status">
      <span class="sx-k"></span><b class="sx-t"></b><p class="sx-x"></p>
      <div class="sx-row"><span class="sx-p"></span><span class="sx-time"></span></div>
      <div class="sx-bar"><i></i></div>
      <button class="sx-retry" type="button"></button>
    </div>`;
  host.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const radarEl = $('.sx-radar'), banEl = $('.sx-banner'), chEl = $('.sx-ch');
  const retryBtn = $('.sx-retry');
  retryBtn.addEventListener('click', (e) => { e.preventDefault(); onRetry(); });
  let banT = 0, queue = [], lastRadar = '', lastCh = '';

  function showBanner(b) {
    banEl.className = `sx-banner on ${b.tone || ''}`;
    banEl.querySelector('.sx-k').textContent = b.kicker || '';
    banEl.querySelector('.sx-t').textContent = b.title || '';
    banEl.querySelector('.sx-x').textContent = b.text || '';
    banEl.querySelector('.sx-f').textContent = b.foot || '';
    banT = b.secs || 5;
  }

  return {
    el,
    /** Show only while actually racing (not paused, not in menus). */
    setActive(on) { el.classList.toggle('on', !!on); },
    banner(b) { if (banT > 0) queue.push(b); else showBanner(b); },
    update(dt) {
      if (banT > 0) {
        banT -= dt;
        if (banT <= 0) { banEl.classList.remove('on'); if (queue.length) setTimeout(() => { if (banT <= 0 && queue.length) showBanner(queue.shift()); }, 350); }
      }
    },
    clear() { banT = 0; queue = []; banEl.classList.remove('on'); chEl.classList.remove('on'); radarEl.classList.remove('on'); lastRadar = lastCh = ''; },

    radar(d) {
      if (!d || d.busy || (d.clear && !d.hunt)) { if (lastRadar) { radarEl.classList.remove('on'); lastRadar = ''; } return; }
      let l1, l2 = '', l3 = '', rot = null;
      if (d.clear) { l1 = 'ALL SECRETS DONE HERE'; l2 = 'Pause and pick another world in the Secrets log.'; }
      else {
        const m = Math.round(d.dist / 5) * 5;
        l1 = `${d.known ? 'CHALLENGE' : 'SECRET'} · ${m} m`;
        const side = d.side < 0 ? 'left' : 'right', jet = jetLabel();
        if (d.dist < 260) {
          l2 = d.tier === 'high' ? `High above the road. Hold ${jet} for a long burn.`
            : d.tier === 'wall' ? `Past the ${side} fence. Hold ${jet} and steer ${side} over it.`
              : `Just off the ${side} edge. Tap ${jet} as you pass.`;
        } else l2 = d.known ? d.name : 'Follow the arrow and look for the light beam.';
        rot = d.angle;
      }
      if (d.hunt) l3 = `Found ${d.found}/${d.total} · Challenges ${d.done}/${d.total}`;
      const key = `${l1}|${l2}|${l3}`;
      if (key !== lastRadar) {
        $('.sx-r1').textContent = l1; $('.sx-r2').textContent = l2; $('.sx-r3').textContent = l3;
        radarEl.classList.add('on'); radarEl.classList.toggle('noarrow', rot == null); radarEl.classList.toggle('known', !!d.known);
        lastRadar = key;
      }
      if (rot != null) $('.sx-arrow').style.transform = `rotate(${rot.toFixed(2)}rad)`;
    },

    challenge(c) {
      if (!c) { if (lastCh) { chEl.classList.remove('on'); lastCh = ''; } return; }
      let kicker = `CHALLENGE · ${c.secret}`, text = c.goal, time = `${Math.ceil(c.time)} s`, retry = false;
      if (c.state === 'ready') time = c.offRoad ? 'Get back on the road to start' : `Starts in ${c.ready}`;
      else if (c.state === 'failed') { kicker = 'OUT OF TIME'; text = `No penalty. ${retryLabel()} to go again from just before the secret.`; time = ''; retry = true; }
      const key = `${c.state}|${kicker}|${text}|${c.progress}|${time}`;
      if (key !== lastCh) {
        chEl.className = `sx-ch on ${c.state}`;
        chEl.querySelector('.sx-k').textContent = kicker;
        chEl.querySelector('.sx-t').textContent = c.name;
        chEl.querySelector('.sx-x').textContent = text;
        chEl.querySelector('.sx-p').textContent = c.state === 'failed' ? '' : c.progress;
        chEl.querySelector('.sx-time').textContent = time;
        retryBtn.textContent = 'Try again';
        retryBtn.style.display = retry ? '' : 'none';
        lastCh = key;
      }
      chEl.querySelector('.sx-bar i').style.width = `${c.state === 'run' ? Math.round((c.time / c.limit) * 100) : c.state === 'ready' ? 100 : 0}%`;
    },
    html: esc,
  };
}
