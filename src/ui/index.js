// Roadster UI: title, main menu, mode/track select, career, multiplayer lobby, garage with 3D
// preview, settings, HUD, pause, results, loading, toasts, and mobile touch controls.
//
//   const ui = createUI({ THREE, root, buildCarModel, paints, wheels, tracks, modes });
//   ui.on('start', ({ mode, eventId, track, laps, opponents, difficulty, car }) => ...);
//   ui.on('pause' | 'resume' | 'restart' | 'quit' | 'settings' | 'purchase' | 'equip' | 'multiplayer' | 'lobby', ...)
//   per frame in race: ui.hud.update({...}, dt); read ui.input.touchState (or ui.input.poll()).
import { loadSettings, saveSettings, detectQuality, resolveGraphics, isTouchDevice, createAdaptiveQuality, QUALITY_PRESETS } from './settings.js';
import { createInput } from './input.js';
import { createTouchControls } from './touch.js';
import { createHUD } from './hud.js';
import { createShowroom, buildPlaceholderRoadster } from './garage.js';
import { DEFAULT_PAINTS, DEFAULT_WHEELS, DEFAULT_TRACKS, DEFAULT_MODES, UPGRADES } from './catalog.js';

export { detectQuality, resolveGraphics, createAdaptiveQuality, QUALITY_PRESETS, loadSettings, buildPlaceholderRoadster };
export { DEFAULT_PAINTS, DEFAULT_WHEELS, DEFAULT_TRACKS, DEFAULT_MODES, UPGRADES };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmtCr = (n) => `${Math.round(n).toLocaleString()} cr`;
const fmtTime = (t) => (t == null || !isFinite(t)) ? '--:--.---' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;
const starStr = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));

const TIPS = [
  'Hold DRIFT through a corner, then release for a boost refill.',
  'Boost drains the battery. Regenerative braking tops it back up.',
  'Three stars on every career event unlocks a secret paint.',
  'Time Trial saves your best lap as a ghost to race against.',
  'Graphics on Auto adjust themselves to keep the game smooth.',
];

export function createUI(opts = {}) {
  const THREE = opts.THREE;
  const root = opts.root || document.body;
  let paints = opts.paints || DEFAULT_PAINTS;
  let wheels = opts.wheels || DEFAULT_WHEELS;
  const tracks = opts.tracks || DEFAULT_TRACKS;
  const modes = opts.modes || DEFAULT_MODES;
  // opts.upgradeCosts = { motor: [..], inverter: [..], ... } lets the game set the economy.
  const upgrades = UPGRADES.map((u) => ({ ...u, cost: opts.upgradeCosts?.[u.id] || u.cost }));

  // ---------- state ----------
  const settings = loadSettings();
  const detected = detectQuality();
  if (!settings.resolvedQuality) settings.resolvedQuality = detected.tier;
  const touch = isTouchDevice();
  let profile = {
    credits: 5000, stars: 0,
    owned: { paints: paints.filter((p) => !p.price).map((p) => p.id), wheels: wheels.filter((w) => !w.price).map((w) => w.id) },
    upgrades: { motor: 0, inverter: 0, tires: 0, battery: 0 },
    careerEvents: defaultCareer(tracks),
  };
  let inRace = false, paused = false;

  // ---------- events ----------
  const listeners = {};
  const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => off(ev, fn); };
  const off = (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); };
  const emit = (ev, data) => { (listeners[ev] || []).forEach((f) => { try { f(data); } catch (e) { console.error(e); } }); };

  // ---------- DOM ----------
  const shell = h(`<div class="ui-root${touch ? ' is-touch' : ''}">
    <canvas class="ui-showroom"></canvas>
    <div class="ui-vignette"></div>
    <div class="ui-layer"></div>
    <div class="ui-toasts"></div>
    <div class="ui-rotate"><div>↻</div><p>Rotate your device to landscape</p></div>
  </div>`);
  root.appendChild(shell);
  const layer = shell.querySelector('.ui-layer');
  const toasts = shell.querySelector('.ui-toasts');

  const getSettings = () => settings;
  const input = createInput(getSettings);
  const hud = createHUD(shell, getSettings);
  const touchCtl = createTouchControls(shell, input, getSettings, () => pause());

  let showroom = null;
  if (THREE) {
    try {
      showroom = createShowroom(THREE, shell.querySelector('.ui-showroom'), {
        buildCarModel: opts.buildCarModel, paints, wheels, getQuality: () => resolveGraphics(settings).tier,
      });
      showroom.setCar({ paint: settings.car.color, wheels: settings.car.wheels });
    } catch (e) { console.warn('[ui] showroom disabled:', e); }
  }

  // ---------- sounds (fallback; audio team can set ui.builtinSounds = false) ----------
  let actx = null;
  const api = { builtinSounds: true };
  function sfx(type) {
    emit('ui-sound', type);
    if (!api.builtinSounds) return;
    try {
      actx ||= new (window.AudioContext || window.webkitAudioContext)();
      const vol = settings.masterVol * settings.sfxVol * 0.18;
      if (vol <= 0) return;
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      const f = { hover: 1800, click: 900, back: 420, buy: 1300, error: 160 }[type] || 800;
      o.type = type === 'error' ? 'square' : 'sine';
      o.frequency.setValueAtTime(f, t);
      if (type === 'buy') o.frequency.exponentialRampToValueAtTime(f * 2, t + 0.12);
      if (type === 'click') o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.05);
      g.gain.setValueAtTime(type === 'hover' ? vol * 0.35 : vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (type === 'hover' ? 0.04 : 0.14));
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.16);
    } catch { /* audio unavailable */ }
  }
  layer.addEventListener('pointerover', (e) => { const b = e.target.closest('button:not([disabled]), .ui-card'); if (b && !b.contains(e.relatedTarget)) sfx('hover'); });

  // ---------- screens ----------
  const screens = {};
  const stack = [];
  let current = null;

  function mount(name, el) { el.classList.add('ui-screen'); el.dataset.screen = name; layer.appendChild(el); screens[name] = el; return el; }

  function go(name, { replace = false, data } = {}) {
    if (current === name && !data) return;
    if (current && !replace) stack.push(current);
    show(name, data);
  }
  function back() {
    if (paused && current === 'pause') { resume(); return; }
    if (current === 'confirm') { sfx('back'); closeConfirm(false); return; }
    if (!stack.length) return;
    sfx('back');
    show(stack.pop());
  }
  function show(name, data) {
    // Deactivate every other screen, not just `current`: several flows reset `current`
    // before calling show(), which used to leave dialogs (e.g. the quit confirm) stuck open.
    for (const [n, sEl] of Object.entries(screens)) if (n !== name) sEl.classList.remove('active');
    current = name;
    const el = screens[name];
    el._onShow?.(data);
    // Only activate if still current: a quick second navigation must not leave two screens shown.
    requestAnimationFrame(() => { if (current === name) el.classList.add('active'); });
    shell.dataset.screen = name;
    showroom?.setShot(name === 'garage' ? 'garage' : 'menu');
    // Focus the first control for keyboard/gamepad users.
    setTimeout(() => { if (current === name && !touch) (el.querySelector('[data-autofocus]') || el.querySelector('button:not([disabled])'))?.focus({ preventScroll: true }); }, 60);
  }

  const topbar = () => `<div class="ui-topbar">
      <div class="ui-brand"><span class="ui-logo">ROADSTER</span></div>
      <div class="ui-vmode ui-seg" role="radiogroup" aria-label="Vehicle mode">
        <button data-vmode="flight" role="radio">✈ Flight</button><button data-vmode="ground" role="radio">⛟ Ground</button>
      </div>
      <div class="ui-wallet"><button class="ui-profile" data-go="account"><i>●</i><b data-bind="accountName">Guest</b></button><span class="ui-stars">★ <b data-bind="stars">0</b></span><span class="ui-credits"><b data-bind="credits">0</b> cr</span></div>
    </div>`;
  const backBtn = (label = 'Back') => `<button class="ui-back" data-act="back" aria-label="${label}"><span>‹</span> ${label}</button>`;

  // Title
  const title = mount('title', h(`<section class="s-title">
    <div class="t-mark">
      <div class="t-kicker">ELECTRIC HYPERCAR RACING</div>
      <h1>ROADSTER</h1>
      <div class="t-line"></div>
    </div>
    <button class="t-press" data-autofocus>${touch ? 'Tap to start' : 'Press any key'}</button>
    <div class="t-foot">v0.1 · ${esc(detected.tier.toUpperCase())} GRAPHICS DETECTED</div>
  </section>`));
  const leaveTitle = () => { if (current !== 'title') return; sfx('click'); emit('interact'); go('main', { replace: true }); };
  title.addEventListener('pointerup', leaveTitle);
  addEventListener('keydown', (e) => { if (current === 'title' && !e.repeat) leaveTitle(); });

  // Main menu
  const mainEl = mount('main', h(`<section class="s-main">
    ${topbar()}
    <nav class="m-nav">
      <button data-go="play" class="m-big" data-autofocus><small>01</small>Play</button>
      <button data-go="garage"><small>02</small>Garage</button>
      <button data-act="tutorial"><small>03</small>Tutorial</button>
      <button data-go="settings"><small>04</small>Settings</button>
      <button data-go="account"><small>05</small>Profile</button>
      <button data-go="about"><small>06</small>About</button>
    </nav>
    <div class="m-hero">
      <div class="m-hero-name">TESLA ROADSTER</div>
      <div class="m-specs">
        <div><b>1.9</b><span>s 0–100 km/h</span></div>
        <div><b>400+</b><span>km/h top speed</span></div>
        <div><b>1000</b><span>km range</span></div>
      </div>
      <div class="m-paint" data-bind="paintName"></div>
    </div>
  </section>`));

  // Mode select
  const playEl = mount('play', h(`<section class="s-play">
    ${topbar()}
    <div class="ui-head">${backBtn()}<h2>Choose a mode</h2></div>
    <div class="p-modes">${modes.map((m, i) => `
      <button class="ui-card p-mode" data-mode="${esc(m.id)}" style="--i:${i}">
        <span class="p-icon">${esc(m.icon || '•')}</span>
        <b>${esc(m.name)}</b><p>${esc(m.desc)}</p>
      </button>`).join('')}
    </div>
  </section>`));
  playEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]'); if (!b) return; sfx('click');
    const mode = b.dataset.mode;
    if (!settings.tutorialSeen && settings.vehicleMode === 'flight' && mode !== 'multiplayer') {
      settings.tutorialSeen = true; saveSettings(settings);
      confirmBox('First flight?', 'Take the one-minute tutorial to learn thrust, pitch, and rings.',
        () => startTutorial(), { yes: 'Start tutorial', no: 'Skip', onNo: () => { playEl.querySelector(`[data-mode="${CSS.escape(mode)}"]`)?.click(); } });
      return;
    }
    if (mode === 'career') go('career');
    else if (mode === 'multiplayer') go('multiplayer');
    else go('setup', { data: { mode } });
  });

  // Career
  const careerEl = mount('career', h(`<section class="s-career">
    ${topbar()}
    <div class="ui-head">${backBtn()}<h2>Career</h2><span class="ui-sub" data-bind="careerProgress"></span></div>
    <div class="c-grid"></div>
  </section>`));
  careerEl._onShow = renderCareer;
  function renderCareer() {
    const ev = profile.careerEvents || [];
    const earned = ev.reduce((a, e) => a + (e.stars || 0), 0);
    careerEl.querySelector('[data-bind=careerProgress]').textContent = `${earned} / ${ev.length * 3} ★`;
    careerEl.querySelector('.c-grid').innerHTML = ev.map((e, i) => {
      const t = tracks.find((x) => x.id === e.track);
      return `<button class="ui-card c-event${e.locked ? ' locked' : ''}" data-event="${esc(e.id)}" ${e.locked ? 'disabled' : ''} style="--i:${i}">
        <span class="c-num">${String(i + 1).padStart(2, '0')}</span>
        <b>${esc(e.name || t?.name || e.track)}</b>
        <p>${esc(typeLabel(e.type))} · ${e.laps || 3} laps${t ? ' · ' + esc(t.name) : ''}</p>
        <span class="c-stars">${e.locked ? '🔒 ' + esc(e.unlock || 'Locked') : starStr(e.stars || 0)}</span>
        ${e.reward ? `<span class="c-reward">${fmtCr(e.reward)}</span>` : ''}
      </button>`;
    }).join('');
  }
  careerEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-event]'); if (!b || b.disabled) return;
    const ev = profile.careerEvents.find((x) => x.id === b.dataset.event);
    startRace({ mode: 'career', eventId: ev.id, track: ev.track, laps: ev.laps, opponents: ev.opponents, difficulty: ev.difficulty });
  });

  // Race setup (quick race / time trial)
  const setup = { mode: 'quick', track: tracks[0]?.id, laps: 3, opponents: 5, difficulty: 'normal' };
  const setupEl = mount('setup', h(`<section class="s-setup">
    ${topbar()}
    <div class="ui-head">${backBtn()}<h2 data-bind="setupTitle">Quick Race</h2></div>
    <div class="su-tracks"></div>
    <div class="su-opts">
      <div class="ui-row"><label>Laps</label><div class="ui-stepper" data-k="laps" data-min="1" data-max="10"><button data-d="-1" aria-label="Fewer laps">−</button><b></b><button data-d="1" aria-label="More laps">+</button></div></div>
      <div class="ui-row" data-only="quick"><label>Opponents</label><div class="ui-stepper" data-k="opponents" data-min="0" data-max="7"><button data-d="-1" aria-label="Fewer opponents">−</button><b></b><button data-d="1" aria-label="More opponents">+</button></div></div>
      <div class="ui-row" data-only="quick"><label>Difficulty</label><div class="ui-seg" data-k="difficulty">
        ${['easy', 'normal', 'hard', 'insane'].map((d) => `<button data-v="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div></div>
    </div>
    <button class="ui-primary su-go">Start race <span>›</span></button>
  </section>`));
  setupEl._onShow = (d) => { if (d?.mode) setup.mode = d.mode; renderSetup(); };
  function renderSetup() {
    setupEl.querySelector('[data-bind=setupTitle]').textContent = setup.mode === 'timetrial' ? 'Time Trial' : 'Quick Race';
    setupEl.querySelectorAll('[data-only=quick]').forEach((r) => { r.style.display = setup.mode === 'quick' ? '' : 'none'; });
    setupEl.querySelector('.su-tracks').innerHTML = tracks.map((t, i) => `
      <button class="ui-card su-track${t.id === setup.track ? ' sel' : ''}" data-track="${esc(t.id)}" style="--i:${i}">
        <div class="su-thumb" style="${t.thumb ? `background-image:url('${esc(t.thumb)}')` : `--h:${(i * 67 + 200) % 360}`}"></div>
        <b>${esc(t.name)}</b><p>${esc(t.desc || '')}</p>
        ${t.best ? `<span class="su-best">Best ${fmtTime(t.best)}</span>` : ''}
      </button>`).join('');
    setupEl.querySelectorAll('.ui-stepper').forEach((s) => { s.querySelector('b').textContent = setup[s.dataset.k]; });
    setupEl.querySelectorAll('.ui-seg button').forEach((b) => b.classList.toggle('sel', b.dataset.v === setup.difficulty));
  }
  setupEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-track]');
    if (t) { setup.track = t.dataset.track; sfx('click'); renderSetup(); setupEl.querySelector(`[data-track="${CSS.escape(setup.track)}"]`)?.focus(); return; }
    const st = e.target.closest('.ui-stepper button');
    if (st) {
      const s = st.parentElement, k = s.dataset.k;
      setup[k] = Math.max(+s.dataset.min, Math.min(+s.dataset.max, setup[k] + +st.dataset.d)); sfx('hover'); renderSetup(); return;
    }
    const sg = e.target.closest('.ui-seg button');
    if (sg) { setup.difficulty = sg.dataset.v; sfx('click'); renderSetup(); return; }
    if (e.target.closest('.su-go')) {
      startRace({ mode: setup.mode, track: setup.track, laps: setup.laps,
        opponents: setup.mode === 'timetrial' ? 0 : setup.opponents, difficulty: setup.difficulty });
    }
  });

  // Multiplayer
  const mpEl = mount('multiplayer', h(`<section class="s-mp">
    ${topbar()}
    <div class="ui-head">${backBtn()}<h2>Multiplayer</h2></div>
    <div class="mp-panel">
      <label class="ui-field"><span>Driver name</span><input maxlength="16" class="mp-name" placeholder="Your name" autocomplete="nickname"></label>
      <button class="ui-primary" data-mp="quick" data-autofocus>Quick match <span>›</span></button>
      <button class="ui-secondary" data-mp="create">Create private room</button>
      <div class="mp-join"><input maxlength="6" class="mp-code" placeholder="ROOM CODE" autocapitalize="characters" spellcheck="false"><button class="ui-secondary" data-mp="join">Join</button></div>
      <p class="mp-status" aria-live="polite"></p>
    </div>
  </section>`));
  const mpName = mpEl.querySelector('.mp-name');
  mpEl._onShow = () => { mpName.value = settings.playerName || ''; mpEl.querySelector('.mp-status').textContent = ''; };
  mpName.addEventListener('change', () => { settings.playerName = mpName.value.trim().slice(0, 16); saveSettings(settings); });
  mpEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mp]'); if (!b) return;
    const name = (mpName.value.trim() || 'Driver' + Math.floor(Math.random() * 900 + 100)).slice(0, 16);
    settings.playerName = name; saveSettings(settings);
    const code = mpEl.querySelector('.mp-code').value.trim().toUpperCase();
    if (b.dataset.mp === 'join' && code.length < 4) { sfx('error'); setMpStatus('Enter a room code first.'); return; }
    sfx('click');
    setMpStatus(b.dataset.mp === 'join' ? `Joining ${code}…` : 'Connecting…');
    emit('multiplayer', { action: b.dataset.mp, code, name, car: carPayload() });
  });
  function setMpStatus(t) { mpEl.querySelector('.mp-status').textContent = t; }

  // Lobby
  let lobby = { code: '', players: [], host: false, ready: false, track: tracks[0]?.id };
  const lobbyEl = mount('lobby', h(`<section class="s-lobby">
    ${topbar()}
    <div class="ui-head"><button class="ui-back" data-lobby="leave"><span>‹</span> Leave</button><h2>Lobby</h2>
      <button class="lb-code" title="Copy room code"><span>ROOM</span><b></b></button></div>
    <div class="lb-body">
      <ul class="lb-players"></ul>
      <div class="lb-side">
        <div class="lb-track"></div>
        <button class="ui-secondary lb-ready" data-lobby="ready">Ready</button>
        <button class="ui-primary lb-start" data-lobby="start">Start race <span>›</span></button>
      </div>
    </div>
  </section>`));
  function renderLobby() {
    lobbyEl.querySelector('.lb-code b').textContent = lobby.code || '----';
    lobbyEl.querySelector('.lb-players').innerHTML = (lobby.players || []).map((p) => `
      <li class="${p.ready ? 'ready' : ''}${p.me ? ' me' : ''}"><i style="background:${esc(p.color || '#3ea6ff')}"></i>
        <b>${esc(p.name)}</b>${p.host ? '<em>HOST</em>' : ''}<span>${p.ping != null ? p.ping + ' ms · ' : ''}${p.ready ? 'READY' : 'NOT READY'}</span></li>`).join('')
      || '<li class="empty">Waiting for drivers…</li>';
    const t = tracks.find((x) => x.id === lobby.track);
    lobbyEl.querySelector('.lb-track').innerHTML = `<span>TRACK</span><b>${esc(t?.name || lobby.track || '—')}</b>`;
    const rb = lobbyEl.querySelector('.lb-ready');
    rb.textContent = lobby.ready ? 'Not ready' : 'Ready'; rb.classList.toggle('sel', !!lobby.ready);
    lobbyEl.querySelector('.lb-start').style.display = lobby.host ? '' : 'none';
  }
  lobbyEl.addEventListener('click', (e) => {
    if (e.target.closest('.lb-code')) { navigator.clipboard?.writeText(lobby.code).then(() => toast('Room code copied')).catch(() => {}); return; }
    const b = e.target.closest('[data-lobby]'); if (!b) return;
    const action = b.dataset.lobby; sfx(action === 'leave' ? 'back' : 'click');
    if (action === 'ready') { lobby.ready = !lobby.ready; renderLobby(); emit('lobby', { action, ready: lobby.ready }); }
    else if (action === 'leave') { emit('lobby', { action }); show('multiplayer'); }
    else emit('lobby', { action, track: lobby.track, car: carPayload() });
  });

  // Garage
  let garageTab = 'paint', garageSel = null;
  const garageEl = mount('garage', h(`<section class="s-garage">
    ${topbar()}
    <div class="ui-head">${backBtn()}<h2>Garage</h2></div>
    <div class="g-stats"></div>
    <div class="g-panel">
      <div class="ui-tabs g-tabs" role="tablist">
        <button data-tab="paint" role="tab">Paint</button><button data-tab="wheels" role="tab">Wheels</button><button data-tab="upgrades" role="tab">Upgrades</button>
      </div>
      <div class="g-items"></div>
      <div class="g-foot"><div class="g-info"><b class="g-name"></b><span class="g-price"></span></div><button class="ui-primary g-act"></button></div>
    </div>
  </section>`));
  garageEl._onShow = () => { garageSel = null; renderGarage(); };
  function equippedOf(tab) { return tab === 'paint' ? settings.car.color : settings.car.wheels; }
  function renderGarage() {
    garageEl.querySelectorAll('.g-tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.tab === garageTab));
    const items = garageEl.querySelector('.g-items');
    const foot = garageEl.querySelector('.g-foot');
    if (garageTab === 'upgrades') {
      foot.style.display = 'none';
      items.className = 'g-items g-upgrades';
      items.innerHTML = upgrades.map((u) => {
        const lvl = profile.upgrades?.[u.id] || 0, max = u.cost.length, cost = u.cost[lvl];
        return `<div class="g-up"><div><b>${esc(u.name)}</b><p>${esc(u.desc)}</p>
          <div class="g-pips">${Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div></div>
          <button class="ui-secondary" data-up="${u.id}" ${lvl >= max ? 'disabled' : ''}>${lvl >= max ? 'Maxed' : fmtCr(cost)}</button></div>`;
      }).join('');
    } else {
      foot.style.display = '';
      const list = garageTab === 'paint' ? paints : wheels;
      const owned = profile.owned?.[garageTab === 'paint' ? 'paints' : 'wheels'] || [];
      garageSel ??= equippedOf(garageTab);
      items.className = 'g-items ' + (garageTab === 'paint' ? 'g-swatches' : 'g-wheels');
      items.innerHTML = list.map((it) => {
        const own = owned.includes(it.id) || !it.price;
        const vis = garageTab === 'paint'
          ? `<i class="g-sw" style="--c:${esc(it.color)}"></i>`
          : `<i class="g-wh" style="--c:${esc(it.color || '#bbb')};--n:${it.spokes || 8}"></i>`;
        return `<button class="g-item${it.id === garageSel ? ' sel' : ''}${it.id === equippedOf(garageTab) ? ' eq' : ''}${own ? '' : ' lock'}" data-item="${esc(it.id)}" title="${esc(it.name)}" aria-label="${esc(it.name)}">${vis}${own ? '' : '<em>🔒</em>'}</button>`;
      }).join('');
      const it = list.find((x) => x.id === garageSel) || list[0];
      const own = owned.includes(it.id) || !it.price;
      garageEl.querySelector('.g-name').textContent = it.name;
      garageEl.querySelector('.g-price').textContent = own ? (it.id === equippedOf(garageTab) ? 'Equipped' : 'Owned') : fmtCr(it.price);
      const act = garageEl.querySelector('.g-act');
      act.disabled = own && it.id === equippedOf(garageTab);
      act.innerHTML = own ? (act.disabled ? 'Equipped ✓' : 'Equip') : `Buy · ${fmtCr(it.price)}`;
      act.classList.toggle('cant', !own && profile.credits < it.price);
    }
    renderStats();
  }
  function renderStats() {
    const u = profile.upgrades || {};
    const stats = [
      ['Acceleration', 0.78 + (u.motor || 0) * 0.055], ['Top speed', 0.8 + (u.inverter || 0) * 0.05],
      ['Grip', 0.68 + (u.tires || 0) * 0.07], ['Battery', 0.7 + (u.battery || 0) * 0.075],
    ];
    garageEl.querySelector('.g-stats').innerHTML = stats.map(([n, v]) =>
      `<div class="g-stat"><span>${n}</span><div><i style="width:${Math.min(100, v * 100).toFixed(0)}%"></i></div></div>`).join('');
  }
  garageEl.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { garageTab = tab.dataset.tab; garageSel = null; sfx('click'); renderGarage(); return; }
    const item = e.target.closest('[data-item]');
    if (item) {
      garageSel = item.dataset.item; sfx('hover');
      showroom?.setCar(garageTab === 'paint' ? { paint: garageSel } : { wheels: garageSel }); // live preview, even if locked
      renderGarage();
      garageEl.querySelector(`[data-item="${CSS.escape(garageSel)}"]`)?.focus();
      return;
    }
    const up = e.target.closest('[data-up]');
    if (up) { purchase('upgrade', up.dataset.up); return; }
    if (e.target.closest('.g-act')) {
      const kind = garageTab === 'paint' ? 'paint' : 'wheel';
      const list = garageTab === 'paint' ? paints : wheels;
      const it = list.find((x) => x.id === garageSel);
      const owned = profile.owned?.[garageTab === 'paint' ? 'paints' : 'wheels'] || [];
      if (!it) return;
      if (owned.includes(it.id) || !it.price) equip(kind, it.id);
      else purchase(kind, it.id);
    }
  });
  function equip(kind, id) {
    if (kind === 'paint') settings.car.color = id; else settings.car.wheels = id;
    saveSettings(settings); sfx('click');
    showroom?.setCar({ paint: settings.car.color, wheels: settings.car.wheels });
    emit('equip', carPayload());
    renderGarage(); refreshBindings();
  }
  function purchase(kind, id) {
    let price;
    if (kind === 'upgrade') { const u = upgrades.find((x) => x.id === id); price = u.cost[profile.upgrades?.[id] || 0]; }
    else price = (kind === 'paint' ? paints : wheels).find((x) => x.id === id)?.price || 0;
    if (price == null) return;
    if (profile.credits < price) { sfx('error'); toast(`Need ${fmtCr(price - profile.credits)} more`); return; }
    sfx('buy');
    if (listeners.purchase?.length) { emit('purchase', { kind, id, price }); pendingEquip = kind !== 'upgrade' ? { kind, id } : null; }
    else {
      // Standalone fallback when no game is listening: handle the wallet locally.
      profile.credits -= price;
      if (kind === 'upgrade') profile.upgrades[id] = (profile.upgrades[id] || 0) + 1;
      else profile.owned[kind === 'paint' ? 'paints' : 'wheels'].push(id);
      if (kind !== 'upgrade') equip(kind, id);
      toast('Purchased'); renderGarage(); refreshBindings();
    }
  }
  let pendingEquip = null;

  // Settings
  const SETTINGS_SCHEMA = [
    { tab: 'graphics', key: 'quality', label: 'Quality', type: 'seg', options: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']] },
    { tab: 'graphics', key: 'resolutionScale', label: 'Resolution scale', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', manual: true },
    { tab: 'graphics', key: 'shadows', label: 'Shadows', type: 'toggle', manual: true },
    { tab: 'graphics', key: 'fov', label: 'Field of view', type: 'range', min: 55, max: 95, step: 1, fmt: (v) => v + '°' },
    { tab: 'graphics', key: 'showFps', label: 'Show FPS', type: 'toggle' },
    { tab: 'controls', key: 'controls', label: 'Input', type: 'seg', options: [['auto', 'Auto'], ['keyboard', 'Keyboard'], ['gamepad', 'Gamepad'], ['touch', 'Touch']] },
    { tab: 'controls', key: 'steerSensitivity', label: 'Steering sensitivity', type: 'range', min: 0.5, max: 1.5, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    { tab: 'controls', key: 'invertPitch', label: 'Invert pitch (flight)', type: 'toggle' },
    { tab: 'controls', key: 'tiltSteer', label: 'Tilt to steer (mobile)', type: 'toggle' },
    { tab: 'controls', key: 'haptics', label: 'Vibration', type: 'toggle' },
    { tab: 'audio', key: 'masterVol', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    { tab: 'audio', key: 'musicVol', label: 'Music', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    { tab: 'audio', key: 'sfxVol', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    { tab: 'gameplay', key: 'units', label: 'Speed units', type: 'seg', options: [['kmh', 'km/h'], ['mph', 'mph']] },
    { tab: 'gameplay', key: 'camera', label: 'Default camera', type: 'seg', options: [['chase', 'Chase'], ['hood', 'Hood'], ['cinematic', 'Cinematic']] },
  ];
  let settingsTab = 'graphics';
  const setEl = mount('settings', h(`<section class="s-settings">
    ${topbar()}
    <div class="ui-head">${backBtn()}<h2>Settings</h2></div>
    <div class="st-panel">
      <div class="ui-tabs st-tabs" role="tablist">${['graphics', 'controls', 'audio', 'gameplay'].map((t) => `<button data-tab="${t}" role="tab">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      <div class="st-rows"></div>
      <div class="st-extra"></div>
    </div>
  </section>`));
  setEl._onShow = renderSettings;
  function renderSettings() {
    setEl.querySelectorAll('.st-tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.tab === settingsTab));
    const auto = settings.quality === 'auto';
    setEl.querySelector('.st-rows').innerHTML = SETTINGS_SCHEMA.filter((r) => r.tab === settingsTab).map((r) => {
      const v = settings[r.key], dis = r.manual && auto;
      let ctl = '';
      if (r.type === 'seg') ctl = `<div class="ui-seg">${r.options.map(([val, lab]) => `<button data-set="${r.key}" data-v="${val}" class="${v === val ? 'sel' : ''}">${lab}</button>`).join('')}</div>`;
      if (r.type === 'toggle') ctl = `<button class="ui-toggle${v ? ' on' : ''}" data-set="${r.key}" data-toggle role="switch" aria-checked="${!!v}" ${dis ? 'disabled' : ''}><i></i></button>`;
      if (r.type === 'range') ctl = `<div class="ui-range"><input type="range" data-set="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" ${dis ? 'disabled' : ''} aria-label="${esc(r.label)}"><output>${r.fmt(v)}</output></div>`;
      return `<div class="ui-row${dis ? ' dim' : ''}"><label>${esc(r.label)}${dis ? ' <small>(Auto)</small>' : ''}</label>${ctl}</div>`;
    }).join('');
    const extra = setEl.querySelector('.st-extra');
    if (settingsTab === 'graphics') {
      const g = resolveGraphics(settings);
      extra.innerHTML = `<p class="st-note">Detected: <b>${esc(detected.gpu)}</b> · ${detected.cores ?? '?'} cores. ${auto ? `Auto is running <b>${g.tier}</b> and adjusts with frame rate.` : ''}</p>`;
    } else if (settingsTab === 'controls') {
      extra.innerHTML = `<table class="st-keys"><tbody>
        ${[['Accelerate', 'W / ↑', 'RT'], ['Brake / reverse', 'S / ↓', 'LT'], ['Steer', 'A D / ← →', 'Left stick'], ['Drift (handbrake)', 'Space', 'A'],
          ['Boost', 'Shift', 'X / RB'], ['Camera', 'C', 'Y'], ['Flight: pitch / roll', 'S W · A D', 'Left stick'], ['Flight: thrust', 'W (hold)', 'RT'], ['Reset car', 'R', 'Back'], ['Pause', 'Esc / P', 'Start']]
          .map(([a, k, p]) => `<tr><td>${a}</td><td><kbd>${k}</kbd></td><td><kbd>${p}</kbd></td></tr>`).join('')}</tbody></table>`;
    } else if (settingsTab === 'gameplay') {
      extra.innerHTML = `<button class="ui-secondary st-reset">Reset all settings</button>`;
    } else extra.innerHTML = '';
  }
  function setSetting(key, v) {
    settings[key] = v;
    if (key === 'quality' && v !== 'auto') {
      const p = QUALITY_PRESETS[v]; settings.resolutionScale = p.resolutionScale; settings.shadows = p.shadows;
    }
    saveSettings(settings);
    emit('settings', { ...settings, graphics: resolveGraphics(settings) });
    applyInputMode();
  }
  setEl.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { settingsTab = tab.dataset.tab; sfx('click'); renderSettings(); return; }
    if (e.target.closest('.st-reset')) {
      const keep = { playerName: settings.playerName, car: settings.car };
      try { localStorage.removeItem('roadster.settings.v1'); } catch { /* ignore */ }
      Object.assign(settings, loadSettings(), keep, { resolvedQuality: detected.tier });
      setSetting('quality', 'auto'); renderSettings(); toast('Settings reset'); return;
    }
    const b = e.target.closest('button[data-set]'); if (!b) return;
    const key = b.dataset.set;
    if (b.hasAttribute('data-toggle')) {
      let nv = !settings[key];
      if (key === 'tiltSteer' && nv && !(await touchCtl.enableTilt())) { toast('Tilt is not available on this device'); nv = false; }
      setSetting(key, nv);
    } else setSetting(key, b.dataset.v);
    sfx('click'); renderSettings();
    setEl.querySelector(`[data-set="${key}"]${b.dataset.v ? `[data-v="${b.dataset.v}"]` : ''}`)?.focus();
  });
  setEl.addEventListener('input', (e) => {
    const r = e.target.closest('input[type=range][data-set]'); if (!r) return;
    const row = SETTINGS_SCHEMA.find((x) => x.key === r.dataset.set);
    r.nextElementSibling.textContent = row.fmt(+r.value);
    setSetting(r.dataset.set, +r.value);
  });

  // About
  mount('about', h(`<section class="s-about">
    ${topbar()}
    <div class="ui-head">${backBtn()}<h2>About</h2></div>
    <div class="ab-body">
      <p>An electric hypercar racing game built for the web, phones, and tablets.</p>
      <p>Fan project. Not affiliated with or endorsed by Tesla, Inc.</p>
      <p class="ab-small">Made with Three.js.</p>
    </div>
  </section>`));

  // Pause overlay
  const pauseEl = mount('pause', h(`<section class="s-pause ui-modal">
    <div class="ui-dialog">
      <h2>Paused</h2>
      <button class="ui-primary" data-p="resume" data-autofocus>Resume</button>
      <button class="ui-secondary" data-p="restart">Restart</button>
      <button class="ui-secondary" data-p="settings">Settings</button>
      <button class="ui-secondary" data-p="quit">Quit to menu</button>
    </div>
  </section>`));
  pauseEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) { if (e.target === pauseEl) resume(); return; }
    sfx('click');
    const a = b.dataset.p;
    if (a === 'resume') resume();
    else if (a === 'restart') { closeOverlays(); paused = false; emit('restart'); enterRace(); }
    else if (a === 'settings') go('settings');
    else if (a === 'quit') confirmBox('Quit this race?', 'Progress in this race will be lost.', () => { paused = false; emit('quit'); showMenu(); });
  });

  // Results
  const resEl = mount('results', h(`<section class="s-results">
    <div class="r-card">
      <div class="r-kicker"></div>
      <h2 class="r-title"></h2>
      <div class="r-stars"></div>
      <dl class="r-rows"></dl>
      <div class="r-reward"></div>
      <div class="r-btns"><button class="ui-secondary" data-r="retry">Retry</button><button class="ui-primary" data-r="continue" data-autofocus>Continue <span>›</span></button></div>
    </div>
  </section>`));
  resEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return; sfx('click');
    if (b.dataset.r === 'retry') { emit('restart'); enterRace(); }
    else { emit('quit'); showMenu(); }
  });

  // Confirm dialog
  const confirmEl = mount('confirm', h(`<section class="s-confirm ui-modal"><div class="ui-dialog">
    <h2></h2><p></p><div class="r-btns"><button class="ui-secondary" data-c="no" data-autofocus>Cancel</button><button class="ui-primary" data-c="yes">Confirm</button></div></div></section>`));
  let confirmCb = null, confirmNo = null;
  function confirmBox(t, p, cb, { yes = 'Confirm', no = 'Cancel', onNo = null } = {}) {
    confirmEl.querySelector('h2').textContent = t; confirmEl.querySelector('p').textContent = p;
    confirmEl.querySelector('[data-c=yes]').textContent = yes; confirmEl.querySelector('[data-c=no]').textContent = no;
    confirmCb = cb; confirmNo = onNo; go('confirm');
  }
  // Every exit path (confirm, cancel, Esc/Backspace/gamepad B via back(), backdrop click) closes the dialog.
  function closeConfirm(ok) {
    const cb = ok ? confirmCb : confirmNo; confirmCb = null; confirmNo = null;
    if (current === 'confirm') { screens.confirm.classList.remove('active'); current = null; const prev = stack.pop(); if (prev) show(prev); }
    cb?.();
  }
  confirmEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) { if (e.target === confirmEl) { sfx('back'); closeConfirm(false); } return; }
    sfx(b.dataset.c === 'yes' ? 'click' : 'back');
    closeConfirm(b.dataset.c === 'yes');
  });

  // Account: sign in, create account, or play as guest. The multiplayer team owns the backend;
  // this screen only emits 'auth' and reflects ui.setAccount({...}).
  let account = { signedIn: false, email: '', name: '', pending: false, error: '' };
  let authTab = 'signin';
  const accEl = mount('account', h(`<section class="s-account">
    ${topbar()}
    <div class="ui-head">${backBtn()}<h2>Profile</h2></div>
    <div class="acc-panel">
      <div class="acc-out">
        <div class="ui-tabs acc-tabs" role="tablist"><button data-atab="signin" role="tab">Sign in</button><button data-atab="signup" role="tab">Create account</button></div>
        <form class="acc-form" novalidate>
          <label class="ui-field"><span>Email</span><input type="email" name="email" autocomplete="email" inputmode="email" required></label>
          <label class="ui-field"><span>Password</span><input type="password" name="password" autocomplete="current-password" minlength="8" required></label>
          <label class="ui-field acc-confirm"><span>Confirm password</span><input type="password" name="password2" autocomplete="new-password"></label>
          <p class="acc-err" role="alert"></p>
          <button class="ui-primary acc-submit" type="submit">Sign in</button>
        </form>
        <div class="acc-or"><span>or</span></div>
        <button class="ui-secondary acc-guest">Play as guest</button>
        <p class="acc-note">Guests keep progress on this device only. An account saves it online and lets friends find you.</p>
      </div>
      <div class="acc-in">
        <div class="acc-avatar"></div>
        <b class="acc-name"></b><span class="acc-email"></span>
        <button class="ui-secondary acc-signout">Sign out</button>
      </div>
    </div>
  </section>`));
  const accForm = accEl.querySelector('.acc-form');
  function renderAccount() {
    accEl.classList.toggle('signed-in', !!account.signedIn);
    accEl.querySelectorAll('[data-atab]').forEach((b) => b.classList.toggle('sel', b.dataset.atab === authTab));
    accEl.querySelector('.acc-confirm').style.display = authTab === 'signup' ? '' : 'none';
    accForm.password.autocomplete = authTab === 'signup' ? 'new-password' : 'current-password';
    const sub = accEl.querySelector('.acc-submit');
    sub.disabled = !!account.pending;
    sub.textContent = account.pending ? 'Please wait…' : (authTab === 'signup' ? 'Create account' : 'Sign in');
    accEl.querySelector('.acc-err').textContent = account.error || '';
    const nm = account.name || (account.email || '').split('@')[0] || 'Driver';
    accEl.querySelector('.acc-avatar').textContent = nm.slice(0, 1).toUpperCase();
    accEl.querySelector('.acc-name').textContent = nm;
    accEl.querySelector('.acc-email').textContent = account.email || '';
  }
  accEl._onShow = () => { account.error = ''; renderAccount(); };
  accEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-atab]');
    if (t) { authTab = t.dataset.atab; account.error = ''; sfx('click'); renderAccount(); return; }
    if (e.target.closest('.acc-guest')) { sfx('click'); emit('auth', { action: 'guest' }); back(); return; }
    if (e.target.closest('.acc-signout')) {
      confirmBox('Sign out?', 'Progress on this device stays; online saves resume when you sign back in.', () => {
        emit('auth', { action: 'signout' }); account = { signedIn: false, email: '', name: '' }; renderAccount(); refreshBindings();
      }, { yes: 'Sign out' });
    }
  });
  accForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = accForm.email.value.trim(), password = accForm.password.value;
    let err = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err = 'Enter a valid email address.';
    else if (password.length < 8) err = 'Password must be at least 8 characters.';
    else if (authTab === 'signup' && password !== accForm.password2.value) err = 'Passwords do not match.';
    if (err) { account.error = err; sfx('error'); renderAccount(); return; }
    account.error = ''; account.pending = true; renderAccount(); sfx('click');
    emit('auth', { action: authTab, email, password });
    accForm.password.value = ''; accForm.password2.value = ''; // never keep the password in the DOM
  });

  // Tutorial cards: the game drives them with ui.tutorial.show / done.
  const tutEl = h(`<div class="ui-tut" role="status" aria-live="polite">
    <div class="tut-card"><div class="tut-step"></div><p class="tut-text"></p><div class="tut-keys"></div>
      <button class="tut-skip">Skip tutorial</button></div></div>`);
  shell.appendChild(tutEl);
  let tutCurrent = null, tutTimer = 0, tutCount = 0;
  const keyChips = (hint) => String(hint || '').split(/\s*\+\s*|\s*\/\s*/).filter(Boolean).map((k) => `<kbd>${esc(k)}</kbd>`).join('<em>or</em>');
  tutEl.querySelector('.tut-skip').addEventListener('click', () => { sfx('back'); tutorial.hide(); emit('tutorial', { action: 'skip' }); });
  const tutorial = {
    /** Show a step card that waits for the player: { id, text, keyHint, touchHint?, step?, total? } */
    show({ id, text, keyHint, touchHint, step, total } = {}) {
      clearTimeout(tutTimer);
      tutCurrent = id; tutCount++;
      tutEl.classList.remove('done');
      tutEl.querySelector('.tut-step').textContent = step ? `STEP ${step}${total ? ' / ' + total : ''}` : 'TUTORIAL';
      tutEl.querySelector('.tut-text').textContent = text || '';
      const hint = touch && touchHint ? touchHint : keyHint;
      tutEl.querySelector('.tut-keys').innerHTML = hint ? keyChips(hint) : '';
      tutEl.classList.remove('show'); void tutEl.offsetWidth; tutEl.classList.add('show');
      emit('tutorial', { action: 'show', id });
    },
    /** Mark a step complete: shows a check, then hides unless a new step replaces it. */
    done(id) {
      if (id != null && id !== tutCurrent) return;
      tutEl.classList.add('done'); sfx('buy');
      const n = tutCount;
      tutTimer = setTimeout(() => { if (n === tutCount) tutEl.classList.remove('show'); }, 900);
    },
    hide() { clearTimeout(tutTimer); tutCurrent = null; tutEl.classList.remove('show', 'done'); },
    get current() { return tutCurrent; },
    /** Call when the whole tutorial finishes. */
    complete() { settings.tutorialSeen = true; saveSettings(settings); this.hide(); emit('tutorial', { action: 'complete' }); },
  };


  const loadEl = h(`<div class="ui-loading"><div class="l-inner"><div class="l-logo">ROADSTER</div><div class="l-bar"><i></i></div><p class="l-text"></p><p class="l-tip"></p></div></div>`);
  shell.appendChild(loadEl);

  // ---------- flows ----------
  function carPayload() {
    const paint = paints.find((p) => p.id === settings.car.color) || paints[0];
    const wheel = wheels.find((w) => w.id === settings.car.wheels) || wheels[0];
    return { paint: paint.id, wheels: wheel.id, color: paint.color, paintSpec: paint, wheelSpec: wheel, upgrades: { ...profile.upgrades } };
  }
  function startRace(cfg) {
    sfx('click');
    raceVehicle = cfg.vehicleMode || settings.vehicleMode || 'flight';
    hud.setMode(raceVehicle);
    touchCtl.setThrust(0);
    emit('start', { ...cfg, vehicleMode: raceVehicle, car: carPayload(), settings: { ...settings, graphics: resolveGraphics(settings) } });
    enterRace();
  }
  function startTutorial() { startRace({ mode: 'tutorial', vehicleMode: settings.vehicleMode || 'flight', track: tracks[0]?.id }); }
  let raceVehicle = 'flight';
  function closeOverlays() { screens[current]?.classList.remove('active'); current = null; stack.length = 0; shell.dataset.screen = ''; }
  function enterRace() {
    closeOverlays(); inRace = true; paused = false;
    shell.classList.add('in-race');
    showroom?.stop();
    hud.show(true); applyInputMode();
  }
  function showMenu() {
    inRace = false; paused = false; tutorial.hide();
    shell.classList.remove('in-race');
    hud.show(false); touchCtl.show(false);
    showroom?.setCar({ paint: settings.car.color, wheels: settings.car.wheels });
    showroom?.start();
    stack.length = 0; current = null;
    show('main'); refreshBindings();
  }
  function pause() {
    if (!inRace || paused) return;
    paused = true; sfx('click'); emit('pause');
    touchCtl.show(false);
    stack.length = 0; current = null; show('pause');
  }
  function resume() {
    if (!paused) return;
    paused = false; closeOverlays(); sfx('back'); emit('resume');
    applyInputMode();
  }
  function applyInputMode() {
    const mode = settings.controls === 'auto' ? (touch ? 'touch' : 'keyboard') : settings.controls;
    touchCtl.setMode(raceVehicle);
    touchCtl.show(inRace && !paused && mode === 'touch');
  }
  function showResults(r = {}) {
    inRace = false; touchCtl.show(false); hud.show(false); tutorial.hide();
    const pos = r.position;
    resEl.querySelector('.r-kicker').textContent = r.kicker || (r.mode === 'timetrial' ? 'TIME TRIAL' : 'RACE COMPLETE');
    resEl.querySelector('.r-title').textContent = r.title || (pos === 1 ? 'Victory' : pos ? `Finished ${pos}${['th', 'st', 'nd', 'rd'][pos] || 'th'}` : (r.newRecord ? 'New record' : 'Finished'));
    resEl.querySelector('.r-stars').innerHTML = r.stars != null ? starStr(r.stars).split('').map((s, i) => `<span style="--i:${i}" class="${s === '★' ? 'on' : ''}">★</span>`).join('') : '';
    const rows = [
      pos != null && ['Position', `${pos} / ${r.racers ?? '-'}`],
      r.time != null && ['Total time', fmtTime(r.time)],
      r.bestLap != null && ['Best lap', fmtTime(r.bestLap) + (r.newRecord ? ' <em>NEW RECORD</em>' : '')],
      r.topSpeedKmh != null && ['Top speed', settings.units === 'mph' ? `${Math.round(r.topSpeedKmh * 0.621371)} mph` : `${Math.round(r.topSpeedKmh)} km/h`],
      r.driftScore != null && ['Drift score', Math.round(r.driftScore).toLocaleString()],
      ...(r.extra || []),
    ].filter(Boolean);
    resEl.querySelector('.r-rows').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
    resEl.querySelector('.r-reward').innerHTML = r.credits ? `<span>+${fmtCr(r.credits)}</span>` : '';
    stack.length = 0; current = null; show('results');
    if (r.credits) sfx('buy');
  }

  function refreshBindings() {
    shell.querySelectorAll('[data-bind=credits]').forEach((n) => { n.textContent = Math.round(profile.credits || 0).toLocaleString(); });
    shell.querySelectorAll('[data-bind=stars]').forEach((n) => { n.textContent = typeof profile.stars === 'number' ? profile.stars : Object.values(profile.stars || {}).reduce((a, b) => a + (+b || 0), 0); });
    const p = paints.find((x) => x.id === settings.car.color);
    mainEl.querySelector('[data-bind=paintName]').textContent = p ? p.name : '';
    shell.querySelectorAll('[data-vmode]').forEach((b) => { const on = b.dataset.vmode === settings.vehicleMode; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); });
    shell.querySelectorAll('[data-bind=accountName]').forEach((n) => { n.textContent = account.signedIn ? (account.name || account.email || 'Driver') : 'Guest'; });
    shell.querySelectorAll('.ui-profile').forEach((n) => n.classList.toggle('in', !!account.signedIn));
  }

  // ---------- toasts ----------
  function toast(text, { ms = 2400, icon = '' } = {}) {
    const t = h(`<div class="ui-toast">${icon ? `<i>${esc(icon)}</i>` : ''}<span>${esc(text)}</span></div>`);
    toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, ms);
  }

  // ---------- menu navigation: keyboard + gamepad ----------
  shell.addEventListener('click', (e) => {
    const vm = e.target.closest('[data-vmode]');
    if (vm) { settings.vehicleMode = vm.dataset.vmode; saveSettings(settings); sfx('click'); refreshBindings(); emit('vehiclemode', settings.vehicleMode); return; }
    if (e.target.closest('[data-act=tutorial]')) { startTutorial(); return; }
    const g = e.target.closest('[data-go]'); if (g) { sfx('click'); go(g.dataset.go); return; }
    if (e.target.closest('[data-act=back]')) back();
  });
  function focusables() {
    const el = screens[current]; if (!el) return [];
    return [...el.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')].filter((n) => n.offsetParent !== null);
  }
  function moveFocus(dx, dy) {
    const list = focusables(); if (!list.length) return;
    const cur = document.activeElement;
    if (!list.includes(cur)) { list[0].focus(); return; }
    if (cur.type === 'range' && dx) { cur.stepUp?.(dx); if (dx < 0) cur.stepDown(2); cur.dispatchEvent(new Event('input', { bubbles: true })); return; }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestD = Infinity;
    for (const n of list) {
      if (n === cur) continue;
      const b = n.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const ddx = bx - ax, ddy = by - ay;
      const along = dx ? ddx * dx : ddy * dy; if (along <= 2) continue;
      const across = dx ? Math.abs(ddy) : Math.abs(ddx);
      const d = along + across * 2.5;
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) { best.focus({ preventScroll: false }); sfx('hover'); }
  }
  addEventListener('keydown', (e) => {
    if (inRace && !paused) {
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) { e.preventDefault(); pause(); }
      return;
    }
    if (!current || current === 'title') return;
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range';
    if (e.code === 'Escape' || (e.code === 'Backspace' && !typing)) { e.preventDefault(); if (current === 'main') return; back(); return; }
    if (typing) return;
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (dirs[e.code]) { e.preventDefault(); moveFocus(...dirs[e.code]); }
  });

  let padPrev = {}, padRepeat = 0;
  function padLoop(now) {
    requestAnimationFrame(padLoop);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = [...pads].find((x) => x && x.connected); if (!p) return;
    const btn = (i) => !!p.buttons[i]?.pressed;
    const st = {
      up: btn(12) || p.axes[1] < -0.6, down: btn(13) || p.axes[1] > 0.6,
      left: btn(14) || p.axes[0] < -0.6, right: btn(15) || p.axes[0] > 0.6,
      a: btn(0), b: btn(1), start: btn(9), lb: btn(4), rb: btn(5),
    };
    const pressed = (k) => st[k] && !padPrev[k];
    if (inRace && !paused) { if (pressed('start')) pause(); padPrev = st; return; }
    if (current === 'title' && (pressed('a') || pressed('start'))) leaveTitle();
    else if (current) {
      const dir = st.up ? [0, -1] : st.down ? [0, 1] : st.left ? [-1, 0] : st.right ? [1, 0] : null;
      const fresh = (st.up && !padPrev.up) || (st.down && !padPrev.down) || (st.left && !padPrev.left) || (st.right && !padPrev.right);
      if (dir && (fresh || now > padRepeat)) { moveFocus(...dir); padRepeat = now + (fresh ? 380 : 120); }
      if (pressed('a')) document.activeElement?.click?.();
      if (pressed('b')) back();
      if (pressed('start') && paused) resume();
      // Bumpers switch tabs where a screen has them.
      if (pressed('lb') || pressed('rb')) {
        const tabs = [...(screens[current]?.querySelectorAll('.ui-tabs button') || [])];
        const i = tabs.findIndex((t) => t.classList.contains('sel'));
        if (tabs.length) tabs[(i + (st.rb ? 1 : -1) + tabs.length) % tabs.length].click();
      }
    }
    padPrev = st;
  }
  requestAnimationFrame(padLoop);

  // Pause automatically when the tab is hidden mid-race.
  document.addEventListener('visibilitychange', () => { if (document.hidden && inRace) pause(); });

  // ---------- boot ----------
  showroom?.start();
  show(opts.skipTitle ? 'main' : 'title');
  refreshBindings();

  Object.defineProperties(api, Object.getOwnPropertyDescriptors({
    on, off, settings, input, hud, toast, touch: touchCtl, tutorial,
    get vehicleMode() { return settings.vehicleMode; },
    setVehicleMode(m) { settings.vehicleMode = m; saveSettings(settings); refreshBindings(); },
    /** Reflect auth state from the backend: { signedIn, email, name, pending, error } */
    setAccount(a = {}) {
      const was = account.signedIn;
      account = { ...account, pending: false, ...a };
      if (a.signedIn && !was) { if (current === 'account') back(); toast(`Signed in as ${account.name || account.email}`); }
      renderAccount(); refreshBindings();
    },
    get account() { return { ...account }; },
    get showroom() { return showroom; },
    get inRace() { return inRace; },
    get paused() { return paused; },
    graphics: () => resolveGraphics(settings),
    detected,
    showMenu, showPause: pause, pause, resume, enterRace, showResults,
    go: (n, d) => go(n, { data: d }),
    setProfile(p = {}) {
      profile = { ...profile, ...p, owned: { ...profile.owned, ...(p.owned || {}) }, upgrades: { ...profile.upgrades, ...(p.upgrades || {}) } };
      if (pendingEquip) {
        const { kind, id } = pendingEquip; pendingEquip = null;
        if ((profile.owned[kind === 'paint' ? 'paints' : 'wheels'] || []).includes(id)) equip(kind, id);
      }
      refreshBindings();
      if (current === 'garage') renderGarage();
      if (current === 'career') renderCareer();
    },
    get profile() { return profile; },
    setCatalog({ paints: p, wheels: w } = {}) { if (p) paints = p; if (w) wheels = w; showroom?.setCatalog(p, w); },
    setLoading(progress, text = '') {
      if (progress == null || progress >= 1) { loadEl.classList.remove('show'); return; }
      if (!loadEl.classList.contains('show')) loadEl.querySelector('.l-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
      loadEl.classList.add('show');
      loadEl.querySelector('.l-bar i').style.width = `${Math.round(progress * 100)}%`;
      loadEl.querySelector('.l-text').textContent = text;
    },
    showLobby(data = {}) {
      lobby = { ...lobby, ...data };
      renderLobby();
      if (current !== 'lobby') { screens[current]?.classList.remove('active'); stack.length = 0; stack.push('main', 'play', 'multiplayer'); current = null; show('lobby'); }
    },
    setMultiplayerStatus: setMpStatus,
    /** Change graphics tier from the engine's adaptive loop so the menu reflects it. */
    setResolvedQuality(tier) { settings.resolvedQuality = tier; saveSettings(settings); if (current === 'settings') renderSettings(); },
  }));
  return api;
}

function typeLabel(t) {
  return ({ race: 'Race', timetrial: 'Time Trial', timeattack: 'Time Attack', elimination: 'Elimination', elim: 'Elimination', drift: 'Drift', sprint: 'Sprint' })[t] || (t ? t[0].toUpperCase() + t.slice(1) : 'Race');
}

function defaultCareer(tracks) {
  const ids = tracks.map((t) => t.id);
  const pick = (i) => ids[i % ids.length];
  return [
    { id: 'c1', name: 'First Charge',  track: pick(0), type: 'race',        laps: 2, opponents: 3, difficulty: 'easy',   reward: 1500, stars: 0 },
    { id: 'c2', name: 'Night Shift',   track: pick(1), type: 'race',        laps: 3, opponents: 5, difficulty: 'normal', reward: 2500, stars: 0 },
    { id: 'c3', name: 'Salt Sprint',   track: pick(2), type: 'timetrial',   laps: 1, difficulty: 'normal', reward: 2500, stars: 0, locked: true, unlock: '3 ★ to unlock' },
    { id: 'c4', name: 'Last One Out',  track: pick(0), type: 'elimination', laps: 5, opponents: 7, difficulty: 'hard',   reward: 4000, stars: 0, locked: true, unlock: '6 ★ to unlock' },
    { id: 'c5', name: 'Sideways',      track: pick(1), type: 'drift',       laps: 2, difficulty: 'normal', reward: 3500, stars: 0, locked: true, unlock: '9 ★ to unlock' },
    { id: 'c6', name: 'Plaid Cup',     track: pick(2), type: 'race',        laps: 4, opponents: 7, difficulty: 'insane', reward: 8000, stars: 0, locked: true, unlock: '12 ★ to unlock' },
  ];
}
