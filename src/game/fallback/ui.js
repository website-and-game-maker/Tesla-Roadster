// Fallback menus + HUD + touch controls, used until the UI team's src/ui/index.js lands.
// Implements the agreed contract: createUI(opts) -> { on, settings, hud, input, show*, toast, setProfile }.
import { EVENT_TYPES, UPGRADE_INFO, UPGRADE_COST, MAX_UPGRADE } from '../career.js';

const css = new URL('./ui.css', import.meta.url).href;
const fmt = (t) => {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export function createUI(opts) {
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = css; document.head.appendChild(link);
  const root = document.createElement('div'); root.id = 'ui'; (opts.root || document.body).appendChild(root);
  const handlers = {};
  const emit = (ev, data) => (handlers[ev] || []).forEach((f) => f(data));
  const sfx = (n) => emit('sfx', n);
  let profile = null;
  const settings = Object.assign({}, opts.settings || {});
  const screens = {};
  const mk = (id) => { const d = document.createElement('div'); d.className = 'screen'; d.id = 's-' + id; root.appendChild(d); screens[id] = d; return d; };
  ['main', 'career', 'quick', 'garage', 'settings', 'help', 'pause', 'results', 'multiplayer'].forEach(mk);
  let current = null;
  function show(id, data) {
    for (const k in screens) screens[k].classList.toggle('on', k === id);
    hudEl.classList.toggle('on', id === 'hud');
    touchEl.classList.toggle('on', id === 'hud' && isTouch());
    current = id;
    if (render[id]) render[id](data);
    emit('screen', id);
  }
  const back = (to = 'main') => `<button class="btn small" data-go="${to}">‹ Back</button>`;
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) { sfx('back'); show(b.dataset.go); }
  });
  const wallet = () => profile ? `<div class="wallet"><b>${profile.credits.toLocaleString()} CR</b> &nbsp;·&nbsp; ${profile.totalStars}★</div>` : '';

  const render = {
    main() {
      const d = screens.main;
      d.innerHTML = `<div class="topbar"><span></span>${wallet()}</div><div class="menu-left">
        <h1>ROADSTER<br><span>RUSH</span></h1><div class="sub">Electric Grand Prix</div>
        <button class="btn primary" data-a="career">Career</button>
        <button class="btn" data-a="quick">Quick Race</button>
        <button class="btn" data-a="timetrial">Time Trial</button>
        <button class="btn" data-a="multiplayer">Multiplayer</button>
        <button class="btn" data-a="garage">Garage</button>
        <button class="btn" data-a="settings">Settings</button>
        <button class="btn" data-a="help">How to play</button></div>`;
      d.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
        sfx('confirm');
        const a = b.dataset.a;
        if (a === 'timetrial') show('quick', { mode: 'timetrial' });
        else if (a === 'quick') show('quick', { mode: 'quick' });
        else show(a);
      });
    },
    career() {
      const d = screens.career;
      let html = `<div class="topbar">${back()}${wallet()}</div><h2>Career</h2>`;
      let lastWorld = null;
      for (const ev of profile.careerEvents) {
        if (ev.world !== lastWorld) {
          if (lastWorld) html += '</div>';
          html += `<div class="world-h">${ev.worldName}${ev.locked ? ` · 🔒 ${ev.unlockStars}★ needed` : ''}</div><div class="grid">`;
          lastWorld = ev.world;
        }
        html += `<div class="card ${ev.locked ? 'locked' : ''}" data-ev="${ev.id}"><div class="t">${ev.name}</div>
          <div class="d">${EVENT_TYPES[ev.type].desc}<br>${ev.laps} laps${ev.opponents ? ` · ${ev.opponents} rivals` : ''} · ${ev.reward} CR</div>
          <div class="stars">${starStr(ev.stars || 0)}</div></div>`;
      }
      d.innerHTML = html + '</div>';
      d.querySelectorAll('[data-ev]').forEach((c) => c.onclick = () => {
        const ev = profile.careerEvents.find((e) => e.id === c.dataset.ev);
        if (ev.locked) { sfx('back'); toast(`Earn ${ev.unlockStars}★ to unlock ${ev.worldName}`); return; }
        sfx('confirm'); emit('start', { mode: 'career', eventId: ev.id });
      });
    },
    quick(data = {}) {
      const mode = data.mode || 'quick';
      const d = screens.quick;
      const st = { track: opts.tracks[0].id, laps: 3, opponents: 5, difficulty: 1 };
      const unlocked = (t) => !profile || profile.totalStars >= (t.unlock || 0) || mode === 'timetrial' && false;
      const draw = () => {
        d.innerHTML = `<div class="topbar">${back()}${wallet()}</div><h2>${mode === 'timetrial' ? 'Time Trial' : 'Quick Race'}</h2>
        <div class="grid">${opts.tracks.map((t) => `<div class="card ${st.track === t.id ? 'sel' : ''} ${unlocked(t) ? '' : 'locked'}" data-t="${t.id}"><div class="t">${t.name}</div><div class="d">${t.description || ''}${unlocked(t) ? '' : `<br>🔒 ${t.unlock}★ needed`}</div>
        ${profile && profile.best[t.id] ? `<div class="d">Best lap ${fmt(profile.best[t.id])}</div>` : ''}</div>`).join('')}</div>
        <div class="panel" style="margin-top:14px;max-width:520px">
          ${mode === 'quick' ? `
          <div class="row"><label>Laps</label><div class="seg" data-k="laps">${[1, 2, 3, 5, 8].map((v) => `<button class="${st.laps === v ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div></div>
          <div class="row"><label>Rivals</label><div class="seg" data-k="opponents">${[1, 3, 5, 7].map((v) => `<button class="${st.opponents === v ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div></div>
          <div class="row"><label>Difficulty</label><div class="seg" data-k="difficulty">${[['Easy', 0], ['Pro', 1], ['Legend', 2]].map(([n, v]) => `<button class="${st.difficulty === v ? 'on' : ''}" data-v="${v}">${n}</button>`).join('')}</div></div>`
          : `<div class="d" style="color:var(--dim)">Race your own ghost. Your best lap on each track is saved and replayed.</div>`}
          <button class="btn primary" data-start>Start</button></div>`;
        d.querySelectorAll('[data-t]').forEach((c) => c.onclick = () => { const t = opts.tracks.find((x) => x.id === c.dataset.t); if (!unlocked(t)) { toast(`Earn ${t.unlock}★ in Career to unlock`); return; } st.track = c.dataset.t; sfx('click'); draw(); });
        d.querySelectorAll('.seg').forEach((s) => s.querySelectorAll('button').forEach((b) => b.onclick = () => { st[s.dataset.k] = +b.dataset.v; sfx('click'); draw(); }));
        d.querySelector('[data-start]').onclick = () => { sfx('confirm'); emit('start', { mode, track: st.track, laps: mode === 'timetrial' ? 99 : st.laps, opponents: mode === 'timetrial' ? 0 : st.opponents, difficulty: st.difficulty }); };
      };
      draw();
    },
    garage() {
      const d = screens.garage;
      const p = profile;
      const draw = () => {
        const owned = (k, id) => p.owned[k].includes(id);
        const stats = opts.statsFor ? opts.statsFor(p.upgrades) : null;
        d.innerHTML = `<div class="topbar">${back()}${wallet()}</div>
        <div class="garage panel">
          <h2>Garage</h2>
          <label>Paint</label><div>${opts.paints.map((c) => `<span class="swatch ${p.car.paint === c.id ? 'sel' : ''}" title="${c.name}${owned('paints', c.id) ? '' : ' · ' + c.cost + ' CR'}" data-p="${c.id}" style="background:${hex(c.color)}">${owned('paints', c.id) ? '' : '<span class="lock">' + (c.cost >= 1000 ? (c.cost / 1000) + 'K' : c.cost) + '</span>'}</span>`).join('')}</div>
          <div class="d" style="color:var(--dim);margin:4px 0 12px">${(opts.paints.find((c) => c.id === p.car.paint) || {}).name || ''}</div>
          <label>Wheels</label><div>${opts.wheels.map((w) => `<button class="btn small ${p.car.wheels === w.id ? 'primary' : ''}" data-w="${w.id}">${w.name}${owned('wheels', w.id) ? '' : ' · ' + w.cost}</button>`).join('')}</div>
          <h2 style="margin-top:18px">Performance</h2>
          ${Object.entries(UPGRADE_INFO).map(([k, info]) => {
            const lv = p.upgrades[k], next = UPGRADE_COST[lv + 1];
            return `<div class="row"><div style="flex:1"><label>${info.name} · Lv ${lv}/${MAX_UPGRADE}</label><div class="bar"><i style="width:${(lv / MAX_UPGRADE) * 100}%"></i></div></div>
              <button class="btn small" data-u="${k}" ${lv >= MAX_UPGRADE ? 'disabled' : ''}>${lv >= MAX_UPGRADE ? 'MAX' : next + ' CR'}</button></div>`;
          }).join('')}
          ${stats ? `<div class="d" style="color:var(--dim);font-size:12px;margin-top:8px">0-100 km/h ≈ ${(27.8 / stats.accel).toFixed(1)}s · Top ${Math.round(stats.vmax * 3.6)} km/h · Grip ${(stats.grip / 9.81).toFixed(2)} g · Overdrive ${stats.boostCap.toFixed(1)}</div>` : ''}
        </div>`;
        d.querySelectorAll('[data-p]').forEach((s) => {
          s.onmouseenter = () => emit('preview', { paint: s.dataset.p });
          s.onclick = () => { if (owned('paints', s.dataset.p)) { emit('equip', { kind: 'paint', id: s.dataset.p }); sfx('click'); } else emit('purchase', { kind: 'paint', id: s.dataset.p }); };
        });
        d.querySelector('.garage').onmouseleave = () => emit('preview', {});
        d.querySelectorAll('[data-w]').forEach((s) => s.onclick = () => { if (owned('wheels', s.dataset.w)) { emit('equip', { kind: 'wheel', id: s.dataset.w }); sfx('click'); } else emit('purchase', { kind: 'wheel', id: s.dataset.w }); });
        d.querySelectorAll('[data-u]').forEach((s) => s.onclick = () => emit('purchase', { kind: 'upgrade', id: s.dataset.u }));
      };
      render._garage = draw;
      draw();
    },
    settings(data = {}) {
      const d = screens.settings;
      const from = data.from || 'main';
      const s = settings;
      const seg = (k, opts2) => `<div class="seg" data-k="${k}">${opts2.map(([n, v]) => `<button class="${s[k] === v ? 'on' : ''}" data-v='${JSON.stringify(v)}'>${n}</button>`).join('')}</div>`;
      const slider = (k) => `<input type="range" min="0" max="1" step="0.05" value="${s[k]}" data-r="${k}">`;
      d.innerHTML = `<div class="topbar">${back(from)}${from === 'main' ? wallet() : ''}</div><div class="panel" style="max-width:620px"><h2>Settings</h2>
        <div class="row"><label>Graphics</label>${seg('quality', [['Auto', 'auto'], ['Low', 'low'], ['Med', 'medium'], ['High', 'high'], ['Ultra', 'ultra']])}</div>
        <div class="d" style="color:var(--dim);font-size:12px" id="qdesc">${opts.qualityInfo ? opts.qualityInfo() : ''}</div>
        <div class="row"><label>Speed units</label>${seg('units', [['km/h', 'kmh'], ['mph', 'mph']])}</div>
        <div class="row"><label>Camera</label>${seg('camera', [['Chase', 0], ['Far', 1], ['Hood', 2]])}</div>
        <div class="row"><label>Show FPS</label>${seg('showFps', [['Off', false], ['On', true]])}</div>
        <div class="row"><label>Steering assist</label>${seg('assist', [['Off', false], ['On', true]])}</div>
        <div class="row"><label>Tilt steering</label>${seg('tiltSteer', [['Off', false], ['On', true]])}</div>
        <div class="row"><label>Auto-accelerate (touch)</label>${seg('autoThrottle', [['Off', false], ['On', true]])}</div>
        <div class="row"><label>Steering sensitivity</label><input type="range" min="0.5" max="1.6" step="0.05" value="${s.steerSens}" data-r="steerSens"></div>
        <div class="row"><label>Master volume</label>${slider('master')}</div>
        <div class="row"><label>Music</label>${slider('music')}</div>
        <div class="row"><label>Effects</label>${slider('sfx')}</div>
        ${from === 'main' ? '<button class="btn small" data-reset style="margin-top:14px">Reset progress</button>' : ''}
      </div>`;
      d.querySelectorAll('.seg').forEach((sg) => sg.querySelectorAll('button').forEach((b) => b.onclick = () => { s[sg.dataset.k] = JSON.parse(b.dataset.v); sfx('click'); emit('settings', s); render.settings(data); }));
      d.querySelectorAll('[data-r]').forEach((r) => r.oninput = () => { s[r.dataset.r] = +r.value; emit('settings', s); });
      const rs = d.querySelector('[data-reset]');
      if (rs) rs.onclick = () => { if (confirm('Erase all progress, credits and unlocks?')) emit('reset'); };
    },
    help() {
      screens.help.innerHTML = `<div class="topbar">${back()}</div><div class="panel" style="max-width:640px"><h2>How to play</h2>
      <p><b>Drive:</b> W/↑ accelerate · S/↓ brake & reverse · A/D or ←/→ steer</p>
      <p><b>Drift:</b> hold Space while turning. Drifting and braking recharge <b style="color:var(--acc2)">Overdrive</b>.</p>
      <p><b>Overdrive:</b> Shift (or N) for a burst of electric power.</p>
      <p><b>Camera:</b> C · <b>Reset to track:</b> R · <b>Pause:</b> Esc/P</p>
      <p><b>Gamepad:</b> RT/LT throttle & brake, stick steer, A drift, X/B Overdrive, Y camera, Start pause.</p>
      <p><b>Touch:</b> left buttons steer, right buttons accelerate/brake/drift/boost. Tilt steering in Settings.</p>
      <p style="color:var(--dim)">Win career events to earn stars and credits. Stars unlock new locations; credits buy paints, wheels and performance upgrades. Graphics adapt automatically to your device.</p></div>`;
    },
    pause() {
      screens.pause.innerHTML = `<div class="center"><div class="panel" style="min-width:300px"><h2>Paused</h2>
        <button class="btn primary" data-p="resume">Resume</button><button class="btn" data-p="restart">Restart</button>
        <button class="btn" data-p="settings">Settings</button><button class="btn" data-p="quit">Quit to menu</button></div></div>`;
      screens.pause.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { sfx('click'); if (b.dataset.p === 'settings') show('settings', { from: 'pause' }); else emit(b.dataset.p); });
    },
    results(r) {
      if (!r) return;
      screens.results.innerHTML = `<div class="center"><div class="panel results">
        <div class="sub" style="margin:0 0 6px">${r.title || 'Results'}</div>
        <div class="big">${r.headline}</div>
        ${r.stars != null ? `<div class="stars" style="font-size:34px">${starStr(r.stars)}</div>` : ''}
        ${r.lines ? r.lines.map((l) => `<div class="row"><label>${l[0]}</label><b>${l[1]}</b></div>`).join('') : ''}
        ${r.table ? `<table>${r.table.map((row) => `<tr class="${row.me ? 'me' : ''}"><td>${row.pos}</td><td>${row.name}</td><td style="text-align:right">${row.time}</td></tr>`).join('')}</table>` : ''}
        ${r.credits ? `<div class="row"><label>Credits earned</label><b style="color:#ffd34d">+${r.credits} CR</b></div>` : ''}
        <div style="margin-top:12px"><button class="btn primary small" data-r="continue">Continue</button><button class="btn small" data-r="restart">Retry</button></div></div></div>`;
      screens.results.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { sfx('confirm'); emit(b.dataset.r === 'continue' ? 'quit' : 'restart'); });
    },
    multiplayer(data) {
      const d = screens.multiplayer;
      d.innerHTML = `<div class="topbar">${back()}${wallet()}</div><div class="panel" style="max-width:560px"><h2>Multiplayer</h2>
        <div id="mp-body">${data && data.html ? data.html : '<p style="color:var(--dim)">Online racing is being prepared. Check back soon!</p>'}</div></div>`;
      emit('multiplayer-screen', d.querySelector('#mp-body'));
    },
  };

  // ---------- HUD ----------
  const hudEl = document.createElement('div'); hudEl.id = 'hud'; root.appendChild(hudEl);
  hudEl.innerHTML = `<div class="tl"><div class="pos"></div><div class="lap"></div><div class="time"></div><div class="best"></div><div class="delta"></div></div>
    <div class="br"><div class="speed">0</div><div class="unit">KM/H</div><div class="boost"><i></i></div></div>
    <canvas class="map" width="340" height="340"></canvas><div class="msg"></div><div class="note"></div><div class="drift"></div><div class="wrong">WRONG WAY</div><div class="fps"></div>
    <button class="pausebtn">II</button>`;
  const $ = (s) => hudEl.querySelector(s);
  const H = { pos: $('.pos'), lap: $('.lap'), time: $('.time'), best: $('.best'), delta: $('.delta'), speed: $('.speed'), unit: $('.unit'), boost: $('.boost'), boostI: $('.boost i'), msg: $('.msg'), note: $('.note'), drift: $('.drift'), wrong: $('.wrong'), fps: $('.fps'), map: $('.map') };
  $('.pausebtn').onclick = () => emit('pause');
  const mctx = H.map.getContext('2d');
  let mapPath = null, mapB = null, lastMsg = '';
  const hud = {
    setTrack(points, bounds) {
      mapB = bounds; mapPath = new Path2D();
      const sx = (x) => 20 + ((x - bounds.minX) / Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)) * 300;
      const sz = (z) => 20 + ((z - bounds.minZ) / Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)) * 300;
      points.forEach((p, i) => (i ? mapPath.lineTo(sx(p.x), sz(p.z)) : mapPath.moveTo(sx(p.x), sz(p.z))));
      mapPath.closePath();
      hud._sx = sx; hud._sz = sz;
    },
    update(h) {
      const mph = settings.units === 'mph';
      H.speed.textContent = Math.round(h.speedKmh * (mph ? 0.6214 : 1));
      H.unit.textContent = mph ? 'MPH' : 'KM/H';
      H.pos.innerHTML = h.position ? `${h.position}<small>/${h.racers}</small>` : '';
      H.lap.textContent = h.lapCount && h.lapCount < 99 ? `LAP ${Math.max(1, Math.min(h.lap, h.lapCount))}/${h.lapCount}` : h.lap ? `LAP ${Math.max(1, h.lap)}` : '';
      H.time.textContent = fmt(h.lapTime);
      H.best.textContent = h.bestLap ? `BEST ${fmt(h.bestLap)}` : (h.extra || '');
      H.delta.textContent = h.ghostDelta != null ? `${h.ghostDelta > 0 ? '+' : '−'}${Math.abs(h.ghostDelta).toFixed(2)}` : '';
      H.delta.style.color = h.ghostDelta > 0 ? '#ff6b6b' : '#5dff9b';
      H.boostI.style.width = `${Math.round((h.boost || 0) * 100)}%`;
      H.boost.classList.toggle('on', !!h.boosting);
      const msg = h.message || '';
      if (msg !== lastMsg) { H.msg.textContent = msg; H.msg.classList.remove('pop'); void H.msg.offsetWidth; if (msg) H.msg.classList.add('pop'); lastMsg = msg; }
      H.note.textContent = h.note || '';
      H.drift.textContent = h.driftScore ? `DRIFT ${Math.round(h.driftScore).toLocaleString()}${h.driftChain ? `  +${Math.round(h.driftChain)} x${h.driftMult.toFixed(1)}` : ''}` : '';
      H.wrong.style.display = h.wrongWay ? 'block' : 'none';
      H.fps.textContent = settings.showFps && h.fps ? `${Math.round(h.fps)} FPS · ${h.qualityLabel || ''}` : '';
      if (mapPath && h.minimap) {
        mctx.clearRect(0, 0, 340, 340);
        mctx.lineJoin = 'round';
        mctx.strokeStyle = 'rgba(0,0,0,.6)'; mctx.lineWidth = 14; mctx.stroke(mapPath);
        mctx.strokeStyle = 'rgba(255,255,255,.85)'; mctx.lineWidth = 6; mctx.stroke(mapPath);
        for (const o of h.minimap.others) { mctx.fillStyle = o.color || '#ffb020'; mctx.beginPath(); mctx.arc(hud._sx(o.x), hud._sz(o.z), 7, 0, 7); mctx.fill(); }
        const p = h.minimap.player; mctx.fillStyle = '#ff2a3d'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 3;
        mctx.beginPath(); mctx.arc(hud._sx(p.x), hud._sz(p.z), 10, 0, 7); mctx.fill(); mctx.stroke();
      }
    },
  };

  // ---------- touch controls ----------
  const isTouch = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && innerWidth < 1200;
  if (isTouch()) document.body.classList.add('touch');
  const touchEl = document.createElement('div'); touchEl.id = 'touch'; root.appendChild(touchEl);
  touchEl.innerHTML = '<div class="tb steerL">◀</div><div class="tb steerR">▶</div><div class="tb acc">GO</div><div class="tb brk">BRAKE</div><div class="tb drf">DRIFT</div><div class="tb bst">BOOST</div>';
  const tstate = { left: false, right: false, acc: false, brk: false, drf: false, bst: false };
  const bind = (cls, key) => {
    const el = touchEl.querySelector('.' + cls);
    const on = (v) => (e) => { e.preventDefault(); tstate[key] = v; el.classList.toggle('down', v); if (v && settings.vibration !== false && navigator.vibrate) navigator.vibrate(8); };
    el.addEventListener('pointerdown', on(true)); el.addEventListener('pointerup', on(false)); el.addEventListener('pointercancel', on(false)); el.addEventListener('pointerleave', on(false));
  };
  bind('steerL', 'left'); bind('steerR', 'right'); bind('acc', 'acc'); bind('brk', 'brk'); bind('drf', 'drf'); bind('bst', 'bst');
  let tsteer = 0;
  const input = {
    read(dt = 1 / 60) {
      const target = (tstate.right ? 1 : 0) - (tstate.left ? 1 : 0);
      tsteer += Math.max(-dt * 4, Math.min(dt * 4, target - tsteer));
      if (!target && Math.abs(tsteer) < 0.05) tsteer = 0;
      const active = current === 'hud' && isTouch();
      return { active, steer: tsteer, throttle: tstate.acc || (active && settings.autoThrottle && !tstate.brk) ? 1 : 0, brake: tstate.brk ? 1 : 0, handbrake: tstate.drf, boost: tstate.bst };
    },
  };

  const toastEl = document.createElement('div'); toastEl.id = 'toast'; root.appendChild(toastEl);
  let toastT = 0;
  function toast(t) { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2400); }

  return {
    on(ev, f) { (handlers[ev] = handlers[ev] || []).push(f); },
    settings, hud, input, toast,
    get screen() { return current; },
    show,
    showMenu() { show('main'); },
    showPause() { show('pause'); },
    showResults(r) { show('results', r); },
    showHUD() { show('hud'); },
    setProfile(p) { profile = p; if (current === 'garage' && render._garage) render._garage(); else if (current && current !== 'hud' && current !== 'results' && current !== 'pause' && current !== 'settings' && current !== 'quick' && render[current]) render[current](); },
  };
}
