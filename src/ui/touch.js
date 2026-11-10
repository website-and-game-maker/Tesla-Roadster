// Mobile touch controls: drag-anywhere steering on the left, pedals and buttons on the right,
// optional tilt steering. Writes into input.touchState.
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
    zone.setPointerCapture(e.pointerId); zone.classList.add('on');
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
      e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.classList.add('on'); ts.active = true;
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

  return {
    el,
    enableTilt,
    show(v) { el.classList.toggle('show', v); if (!v) { Object.assign(ts, { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false }); setKnob(0); } },
    setBoostReady(ready) { el.querySelector('.t-boost').classList.toggle('ready', ready); },
  };
}
