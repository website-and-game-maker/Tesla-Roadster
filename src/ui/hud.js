// In-race HUD: speedometer dial, gear, laps/times, position, boost + battery, minimap,
// drift score, center messages, wrong-way warning, ghost delta, FPS.
const fmtTime = (t) => {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
const ordinal = (n) => {
  const t = n % 100, o = n % 10;
  return n + ((t >= 11 && t <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[o] || 'th'));
};

export function createHUD(root, getSettings) {
  const el = document.createElement('div');
  el.className = 'ui-hud';
  el.innerHTML = `
    <div class="h-tl">
      <div class="h-pos"><b>-</b><span>/-</span></div>
      <div class="h-lap">LAP <b>-</b><span>/-</span></div>
    </div>
    <div class="h-tr">
      <div class="h-time"><label>TIME</label><b class="h-cur">--:--.---</b></div>
      <div class="h-time"><label>BEST</label><b class="h-best">--:--.---</b></div>
      <div class="h-ghost"></div>
      <div class="h-extra"></div>
    </div>
    <canvas class="h-map" width="360" height="360"></canvas>
    <div class="h-dash">
      <canvas class="h-dial" width="440" height="440"></canvas>
      <div class="h-readout"><b class="h-speed">0</b><span class="h-unit">KM/H</span><i class="h-gear">D</i></div>
      <div class="h-bars">
        <div class="h-bar h-boost"><label>BOOST</label><div><i></i></div></div>
        <div class="h-bar h-batt"><label>BATTERY</label><div><i></i></div></div>
      </div>
    </div>
    <div class="h-drift"><b>0</b><span class="h-dlabel">DRIFT</span></div>
    <div class="h-note"></div>
    <div class="h-msg"></div>
    <div class="h-wrong">WRONG WAY</div>
    <div class="h-elim"></div>
    <div class="h-fps"></div>`;
  root.appendChild(el);

  const $ = (s) => el.querySelector(s);
  const dial = $('.h-dial'), dctx = dial.getContext('2d');
  const map = $('.h-map'), mctx = map.getContext('2d');
  const r = { speed: $('.h-speed'), unit: $('.h-unit'), gear: $('.h-gear'), cur: $('.h-cur'), best: $('.h-best'),
    pos: $('.h-pos'), lap: $('.h-lap'), boost: $('.h-boost i'), batt: $('.h-batt i'), drift: $('.h-drift'),
    msg: $('.h-msg'), wrong: $('.h-wrong'), ghost: $('.h-ghost'), elim: $('.h-elim'), fps: $('.h-fps'), note: $('.h-note'), extra: $('.h-extra'), dlabel: $('.h-dlabel') };

  let lastNote = '', noteTimer = 0, shownSpeed = 0, lastMsg = '', msgTimer = 0, lastDrift = 0, mapBounds = null, mapPts = null;
  let last = {};
  const setText = (node, key, v) => { if (last[key] !== v) { node.textContent = v; last[key] = v; } };

  function drawDial(frac, redline) {
    const w = dial.width, cx = w / 2, cy = w / 2, R = w * 0.43;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    dctx.clearRect(0, 0, w, w);
    dctx.lineCap = 'round';
    dctx.lineWidth = 14; dctx.strokeStyle = 'rgba(255,255,255,0.10)';
    dctx.beginPath(); dctx.arc(cx, cy, R, a0, a1); dctx.stroke();
    // ticks
    dctx.lineWidth = 3;
    for (let i = 0; i <= 20; i++) {
      const a = a0 + (a1 - a0) * (i / 20), inner = i % 5 === 0 ? R - 30 : R - 22;
      dctx.strokeStyle = i / 20 > redline ? 'rgba(255,70,70,0.8)' : 'rgba(255,255,255,0.35)';
      dctx.beginPath(); dctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      dctx.lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); dctx.stroke();
    }
    const g = dctx.createLinearGradient(0, w, w, 0);
    g.addColorStop(0, '#3ea6ff'); g.addColorStop(0.7, '#9b7bff'); g.addColorStop(1, '#ff4d6d');
    dctx.lineWidth = 14; dctx.strokeStyle = g;
    dctx.shadowColor = 'rgba(80,160,255,0.8)'; dctx.shadowBlur = 18;
    dctx.beginPath(); dctx.arc(cx, cy, R, a0, a0 + (a1 - a0) * Math.max(0.001, frac)); dctx.stroke();
    dctx.shadowBlur = 0;
  }

  function computeBounds(pts) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) { const x = p.x ?? p[0], z = p.z ?? p[1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const span = Math.max(x1 - x0, z1 - z0) || 1;
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, s: (map.width * 0.84) / span };
  }

  function drawMap(mm) {
    const w = map.width;
    mctx.clearRect(0, 0, w, w);
    if (mm.trackPoints && mm.trackPoints !== mapPts) { mapPts = mm.trackPoints; mapBounds = computeBounds(mapPts); }
    if (!mapPts || !mapBounds) return;
    const P = (x, z) => [w / 2 + (x - mapBounds.cx) * mapBounds.s, w / 2 + (z - mapBounds.cz) * mapBounds.s];
    mctx.lineJoin = 'round';
    for (const [lw, col] of [[16, 'rgba(0,0,0,0.45)'], [9, 'rgba(255,255,255,0.75)']]) {
      mctx.lineWidth = lw; mctx.strokeStyle = col; mctx.beginPath();
      mapPts.forEach((p, i) => { const [x, y] = P(p.x ?? p[0], p.z ?? p[1]); i ? mctx.lineTo(x, y) : mctx.moveTo(x, y); });
      mctx.closePath(); mctx.stroke();
    }
    for (const o of mm.others || []) {
      const [x, y] = P(o.x, o.z);
      mctx.fillStyle = o.color || '#ffb020'; mctx.beginPath(); mctx.arc(x, y, 8, 0, Math.PI * 2); mctx.fill();
    }
    if (mm.player) {
      const [x, y] = P(mm.player.x, mm.player.z);
      mctx.save(); mctx.translate(x, y); mctx.rotate(-(mm.player.rot || 0));
      mctx.fillStyle = '#3ea6ff'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 3;
      mctx.beginPath(); mctx.moveTo(0, 14); mctx.lineTo(10, -10); mctx.lineTo(-10, -10); mctx.closePath();
      mctx.fill(); mctx.stroke(); mctx.restore();
    }
  }

  return {
    el,
    show(v) { el.classList.toggle('show', v); if (v) { last = {}; } },
    /** Center message, e.g. '3', 'GO!', 'FINAL LAP'. Auto-hides after `secs`. */
    flash(text, secs = 1.2) {
      r.msg.textContent = text; r.msg.classList.remove('pop'); void r.msg.offsetWidth; r.msg.classList.add('pop');
      msgTimer = secs; lastMsg = text;
    },
    update(d = {}, dt = 1 / 60) {
      const s = getSettings();
      const mph = s.units === 'mph';
      const speed = Math.abs(d.speedKmh || 0) * (mph ? 0.621371 : 1);
      shownSpeed += (speed - shownSpeed) * Math.min(1, dt * 12);
      setText(r.speed, 'speed', String(Math.round(shownSpeed)));
      setText(r.unit, 'unit', mph ? 'MPH' : 'KM/H');
      const maxShown = mph ? 260 : 420; // Roadster tops out above 400 km/h
      drawDial(Math.min(1, shownSpeed / maxShown), 0.8);
      setText(r.gear, 'gear', d.gear != null ? String(d.gear) : (d.speedKmh < -1 ? 'R' : 'D'));

      if (d.lap != null) r.lap.innerHTML = `LAP <b>${Math.max(1, d.lap)}</b><span>/${d.lapCount ?? '-'}</span>`;
      if (d.position != null) r.pos.innerHTML = `<b>${ordinal(d.position)}</b><span>/${d.racers ?? '-'}</span>`;
      r.pos.style.display = d.position != null ? '' : 'none';
      setText(r.cur, 'cur', fmtTime(d.lapTime));
      setText(r.best, 'best', fmtTime(d.bestLap));
      r.boost.style.width = `${Math.round((d.boost ?? 0) * 100)}%`;
      r.boost.parentElement.parentElement.classList.toggle('full', (d.boost ?? 0) >= 0.999);
      r.batt.style.width = `${Math.round((d.battery ?? 1) * 100)}%`;
      r.batt.parentElement.parentElement.classList.toggle('low', (d.battery ?? 1) < 0.15);

      // drift score pops while active
      const ds = Math.round(d.driftScore || 0);
      r.drift.classList.toggle('on', ds > 0);
      if (ds !== lastDrift) { r.drift.firstElementChild.textContent = ds.toLocaleString(); lastDrift = ds; }

      if (d.message && d.message !== lastMsg) this.flash(d.message);
      if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) { r.msg.classList.remove('pop'); lastMsg = d.message || ''; } }
      if (!d.message && msgTimer <= 0) lastMsg = '';

      // Short centre callouts ('FINAL LAP', 'NEW BEST') shown below the big countdown text.
      if (d.note && d.note !== lastNote) {
        r.note.textContent = d.note; r.note.classList.remove('pop'); void r.note.offsetWidth; r.note.classList.add('pop');
        noteTimer = 1.6; lastNote = d.note;
      }
      if (noteTimer > 0) { noteTimer -= dt; if (noteTimer <= 0) r.note.classList.remove('pop'); }
      if (!d.note && noteTimer <= 0) lastNote = '';
      setText(r.extra, 'extra', d.extra || '');
      const chain = d.driftChain ? ` · ${d.driftChain} CHAIN` : '';
      setText(r.dlabel, 'dlabel', `DRIFT${d.driftMult > 1 ? ' ×' + (+d.driftMult).toFixed(1) : ''}${chain}`);
      r.wrong.classList.toggle('on', !!d.wrongWay);
      if (d.ghostDelta != null) {
        const g = d.ghostDelta;
        r.ghost.textContent = `${g <= 0 ? '−' : '+'}${Math.abs(g).toFixed(2)}`;
        r.ghost.className = 'h-ghost on ' + (g <= 0 ? 'ahead' : 'behind');
      } else r.ghost.className = 'h-ghost';
      if (d.eliminated) { r.elim.textContent = `${d.eliminated} ELIMINATED`; r.elim.classList.add('on'); }
      else r.elim.classList.remove('on');

      r.fps.style.display = s.showFps ? '' : 'none';
      if (s.showFps && d.fps != null) setText(r.fps, 'fps', `${Math.round(d.fps)} FPS`);
      if (d.minimap) drawMap(d.minimap);
    },
  };
}
