// Mobile touch controls: drag-anywhere steering on the left, pedals and buttons on the right,
// optional tilt steering. Writes into input.touchState.
import { canTilt } from './device.js';

// setPointerCapture can throw (e.g. pointer already released); capture is best-effort.
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* ignore */ } };

export function createTouchControls(root, input, getSettings, onPause, onTiltToggle) {
  const el = document.createElement('div');
  el.className = 'ui-touch';
  el.innerHTML = `
    <div class="t-steer" data-zone="steer">
      <div class="t-steer-track"><div class="t-steer-knob"></div></div>
      <span class="t-hint">Drag to steer</span>
    </div>
    ${canTilt() ? '<button class="t-tilt" aria-pressed="false"><span aria-hidden="true">📱</span> Tilt to steer</button>' : ''}
    <div class="t-right">
      <button class="t-btn t-boost" data-btn="boost" aria-label="Boost">⚡</button>
      <button class="t-btn t-hand" data-btn="handbrake" aria-label="Handbrake">DRIFT</button>
      <button class="t-pedal t-brake" data-btn="brake" aria-label="Brake"><span>BRAKE</span></button>
      <button class="t-pedal t-gas" data-btn="throttle" aria-label="Accelerate"><span>GO</span></button>
    </div>
    <div class="f-stick" aria-label="Pitch and roll">
      <div class="f-base"><i class="f-ring"></i><div class="f-knob"></div></div>
      <span class="t-hint">Pitch &amp; roll</span>
    </div>
    <div class="f-right">
      <div class="f-thrust" aria-label="Thrust" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="f-fill"></div><div class="f-handle"></div><span>THRUST</span>
      </div>
      <div class="f-btns">
        <button class="t-btn t-boost" data-fbtn="boost" aria-label="Boost">⚡</button>
        <button class="t-btn f-brake" data-fbtn="brake" aria-label="Brake or hover">BRAKE<br><small>HOVER</small></button>
      </div>
    </div>
    <button class="t-pause" aria-label="Pause">❚❚</button>`;
  root.appendChild(el);

  const ts = input.touchState;
  const knob = el.querySelector('.t-steer-knob');
  const zone = el.querySelector('.t-steer');
  let steerId = null, steerX0 = 0;
  const RANGE = () => Math.min(120, innerWidth * 0.14);

  const setKnob = (v) => { knob.style.transform = `translateX(${v * RANGE()}px)`; };

  const hint = el.querySelector('.t-hint');
  const tiltBtn = el.querySelector('.t-tilt');
  const tiltActive = () => !!getSettings().tiltSteer && tiltOn;
  // The steering strip says what steers the car right now, and the in-race pill shows tilt's state.
  function refreshTiltLook() {
    const on = tiltActive();
    hint.textContent = on ? 'Tilt to steer' : 'Drag to steer';
    zone.classList.toggle('tilting', on);
    if (tiltBtn) {
      tiltBtn.classList.toggle('on', on);
      tiltBtn.setAttribute('aria-pressed', String(on));
      tiltBtn.lastChild.textContent = on ? ' Tilt is on' : ' Tilt to steer';
    }
    if (!on && steerId === null) { setKnob(0); ts.steer = 0; }
  }
  tiltBtn?.addEventListener('click', async () => { await onTiltToggle?.(); refreshTiltLook(); });

  zone.addEventListener('pointerdown', (e) => {
    if (tiltActive()) return;
    steerId = e.pointerId; steerX0 = e.clientX;
    capture(zone, e.pointerId); zone.classList.add('on');
    ts.active = true;
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== steerId) return;
    const v = Math.max(-1, Math.min(1, (e.clientX - steerX0) / RANGE()));
    ts.steer = Math.sign(v) * Math.pow(Math.abs(v), 1.3); // finer control near center
    setKnob(v);
  });
  const endSteer = (e) => {
    if (e.pointerId !== steerId) return;
    steerId = null; ts.steer = 0; setKnob(0); zone.classList.remove('on');
  };
  zone.addEventListener('pointerup', endSteer);
  zone.addEventListener('pointercancel', endSteer);

  // Pedals and buttons: hold to press, slide between them works because each tracks its own pointer.
  for (const b of el.querySelectorAll('[data-btn]')) {
    const key = b.dataset.btn;
    const on = (e) => {
      e.preventDefault(); capture(b, e.pointerId); b.classList.add('on'); ts.active = true;
      ts[key] = (key === 'throttle' || key === 'brake') ? 1 : true;
      input.vibrate(12);
    };
    const off = () => { b.classList.remove('on'); ts[key] = (key === 'throttle' || key === 'brake') ? 0 : false; };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  el.querySelector('.t-pause').addEventListener('click', () => onPause());

  // Tilt steering (landscape). iOS requires a permission prompt from a user gesture.
  let tiltOn = false;
  const onTilt = (e) => {
    if (!getSettings().tiltSteer || steerId !== null) return;
    const landscape = (screen.orientation?.angle ?? window.orientation ?? 0);
    const raw = Math.abs(landscape) === 90 ? (e.beta || 0) * Math.sign(landscape) : (e.gamma || 0);
    const v = Math.max(-1, Math.min(1, raw / 30));
    ts.steer = Math.abs(v) < 0.05 ? 0 : v; ts.active = true; setKnob(v);
  };
  async function enableTilt() {
    if (tiltOn) return true;
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false;
      }
      // Some tablets and laptops have the API but no motion sensor. Only call tilt "on"
      // once the sensor actually reports, so it never looks on while steering does nothing.
      const works = await new Promise((resolve) => {
        const probe = (e) => { if (e.beta != null || e.gamma != null) { done(true); } };
        const done = (v) => { clearTimeout(timer); removeEventListener('deviceorientation', probe); resolve(v); };
        const timer = setTimeout(() => done(false), 1500);
        addEventListener('deviceorientation', probe);
      });
      if (!works) return false;
      addEventListener('deviceorientation', onTilt); tiltOn = true; return true;
    } catch { return false; }
  }
  // A saved "tilt on" from last time needs the sensor listener again. iPhones only allow
  // that from a tap, so this is called on the first tap and again at each race start.
  async function ensureTilt() {
    if (!getSettings().tiltSteer) { refreshTiltLook(); return true; }
    const ok = await enableTilt();
    refreshTiltLook();
    return ok;
  }

  // ---------- flight layout ----------
  // Each control tracks its own pointerId, so the stick and right-hand controls work together
  // under multi-touch.
  Object.assign(ts, { pitch: 0, roll: 0, yaw: 0, thrust: 0 });
  const stick = el.querySelector('.f-base'), fknob = el.querySelector('.f-knob');
  let stickId = null, sc = { x: 0, y: 0 };
  const STICK_R = () => stick.clientWidth * 0.42 || 60;
  const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.4); // finer control near centre
  const setStick = (x, y) => { fknob.style.transform = `translate(${x * STICK_R()}px, ${y * STICK_R()}px)`; };
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault(); stickId = e.pointerId; capture(stick, e.pointerId);
    const r = stick.getBoundingClientRect(); sc = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    stick.classList.add('on'); ts.active = true; moveStick(e);
  });
  function moveStick(e) {
    if (e.pointerId !== stickId) return;
    let x = (e.clientX - sc.x) / STICK_R(), y = (e.clientY - sc.y) / STICK_R();
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    const inv = getSettings().invertPitch ? -1 : 1;
    ts.roll = curve(x);
    ts.pitch = curve(y) * inv;   // stick down = nose up (positive pitch)
    setStick(x, y);
  }
  stick.addEventListener('pointermove', moveStick);
  const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; ts.pitch = 0; ts.roll = 0; setStick(0, 0); stick.classList.remove('on'); };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);

  // Thrust is a lever: it stays where you leave it.
  const thr = el.querySelector('.f-thrust'), tfill = el.querySelector('.f-fill'), thandle = el.querySelector('.f-handle');
  let thrId = null;
  const setThrust = (v) => {
    ts.thrust = Math.max(0, Math.min(1, v));
    tfill.style.height = `${ts.thrust * 100}%`; thandle.style.bottom = `calc(${ts.thrust * 100}% - 14px)`;
    thr.setAttribute('aria-valuenow', Math.round(ts.thrust * 100));
  };
  const thrFromEvent = (e) => { const r = thr.getBoundingClientRect(); setThrust(1 - (e.clientY - r.top) / r.height); };
  thr.addEventListener('pointerdown', (e) => { e.preventDefault(); thrId = e.pointerId; capture(thr, e.pointerId); thr.classList.add('on'); ts.active = true; thrFromEvent(e); input.vibrate(8); });
  thr.addEventListener('pointermove', (e) => { if (e.pointerId === thrId) thrFromEvent(e); });
  const endThr = (e) => { if (e.pointerId === thrId) { thrId = null; thr.classList.remove('on'); } };
  thr.addEventListener('pointerup', endThr); thr.addEventListener('pointercancel', endThr);

  for (const b of el.querySelectorAll('[data-fbtn]')) {
    const key = b.dataset.fbtn;
    const on = (e) => { e.preventDefault(); capture(b, e.pointerId); b.classList.add('on'); ts.active = true; ts[key] = key === 'brake' ? 1 : true; input.vibrate(12); };
    const off = () => { b.classList.remove('on'); ts[key] = key === 'brake' ? 0 : false; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  let layout = 'ground';
  return {
    el,
    enableTilt,
    // Fly mode is now jet hops: it keeps the driving controls and the DRIFT button becomes JET.
    setMode(m) {
      layout = 'ground';
      const hop = m === 'flight' || m === 'hop';
      el.classList.remove('flight');
      el.classList.toggle('hop', hop);
      const hb = el.querySelector('[data-btn="handbrake"]');
      if (hb) { hb.textContent = hop ? 'JET' : 'DRIFT'; hb.setAttribute('aria-label', hop ? 'Jets' : 'Handbrake'); }
    },
    setThrust,
    ensureTilt,
    refreshTiltLook,
    get tiltActive() { return tiltActive(); },
    show(v) {
      el.classList.toggle('show', v);
      if (!v) {
        Object.assign(ts, { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, pitch: 0, roll: 0, yaw: 0 });
        setKnob(0); setStick(0, 0); el.querySelectorAll('.on').forEach((n) => n.classList.remove('on'));
      } else refreshTiltLook();
    },
    setBoostReady(ready) { el.querySelector('.t-boost').classList.toggle('ready', ready); },
  };
}
