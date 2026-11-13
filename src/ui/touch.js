// Mobile touch controls: drag-anywhere steering on the left, pedals and buttons on the right,
// optional tilt steering. Writes into input.touchState.
// setPointerCapture can throw (e.g. pointer already released); capture is best-effort.
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* ignore */ } };

export function createTouchControls(root, input, getSettings, onPause) {
  const el = document.createElement('div');
  el.className = 'ui-touch';
  el.innerHTML = `
    <div class="t-steer" data-zone="steer">
      <div class="t-steer-track"><div class="t-steer-knob"></div></div>
      <span class="t-hint">Drag to steer</span>
    </div>
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

  zone.addEventListener('pointerdown', (e) => {
    if (getSettings().tiltSteer) return;
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
    if (!getSettings().tiltSteer) return;
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
      addEventListener('deviceorientation', onTilt); tiltOn = true; return true;
    } catch { return false; }
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
    /** 'flight' shows the stick + thrust lever, 'ground' the steering slider + pedals. */
    setMode(m) { layout = m === 'flight' ? 'flight' : 'ground'; el.classList.toggle('flight', layout === 'flight'); },
    setThrust,
    show(v) {
      el.classList.toggle('show', v);
      if (!v) {
        Object.assign(ts, { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, pitch: 0, roll: 0, yaw: 0 });
        setKnob(0); setStick(0, 0); el.querySelectorAll('.on').forEach((n) => n.classList.remove('on'));
      }
    },
    setBoostReady(ready) { el.querySelector('.t-boost').classList.toggle('ready', ready); },
  };
}
