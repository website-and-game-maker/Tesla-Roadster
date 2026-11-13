// Unified driving input: keyboard + gamepad + touch (touch writes into `touchState`).
// Read `input.state` once per frame after calling `input.poll(dt)`.
export function createInput(getSettings) {
  const keys = new Set();
  const state = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, source: 'keyboard' };
  const touchState = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, pitch: 0, roll: 0, yaw: 0, thrust: 0, active: false };
  const edge = new Set(); // one-shot actions: pause, camera, reset
  let kbSteer = 0;

  const map = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'handbrake', ShiftLeft: 'boost', ShiftRight: 'boost',
  };
  const actions = { Escape: 'pause', KeyP: 'pause', KeyC: 'camera', KeyR: 'reset', KeyH: 'horn' };

  const onDown = (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (map[e.code]) { keys.add(map[e.code]); state.source = 'keyboard'; e.preventDefault(); }
    if (actions[e.code] && !e.repeat) edge.add(actions[e.code]);
  };
  const onUp = (e) => { if (map[e.code]) keys.delete(map[e.code]); };
  const onBlur = () => keys.clear();
  addEventListener('keydown', onDown);
  addEventListener('keyup', onUp);
  addEventListener('blur', onBlur);

  let padPrev = {};
  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const b = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      const pad = {
        steer: dz(p.axes[0] || 0), throttle: b(7), brake: b(6),
        handbrake: b(0) > 0.5 || b(1) > 0.5, boost: b(2) > 0.5 || b(5) > 0.5,
        pause: b(9) > 0.5, camera: b(3) > 0.5, reset: b(8) > 0.5,
      };
      for (const a of ['pause', 'camera', 'reset']) if (pad[a] && !padPrev[a]) edge.add(a);
      padPrev = pad;
      return pad;
    }
    return null;
  }

  return {
    state,
    touchState,
    // Contract fields (ARCHITECTURE.md): touch-only values for engines that merge keyboard/gamepad themselves.
    get steer() { return touchState.steer; }, get throttle() { return touchState.throttle; },
    get brake() { return touchState.brake; }, get handbrake() { return touchState.handbrake; },
    get boost() { return touchState.boost; },
    // Flight fields (touch): pitch + = nose up, roll + = right, thrust 0..1 lever.
    get pitch() { return touchState.pitch; }, get roll() { return touchState.roll; },
    get yaw() { return touchState.yaw; }, get thrust() { return touchState.thrust; },
    /** Returns true once per press for 'pause' | 'camera' | 'reset' | 'horn'. */
    consume(action) { const had = edge.has(action); edge.delete(action); return had; },
    trigger(action) { edge.add(action); },
    poll(dt = 1 / 60) {
      const s = getSettings();
      const sens = s.steerSensitivity ?? 1;
      // Keyboard steering eases in/out so tapping feels analog.
      const target = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
      const rate = target === 0 ? 6 : (Math.sign(target) !== Math.sign(kbSteer) ? 9 : 4);
      kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - kbSteer));
      let steer = kbSteer;
      let throttle = keys.has('up') ? 1 : 0;
      let brake = keys.has('down') ? 1 : 0;
      let handbrake = keys.has('handbrake');
      let boost = keys.has('boost');

      const pad = readPad();
      if (pad && (Math.abs(pad.steer) > 0 || pad.throttle || pad.brake || pad.handbrake)) {
        state.source = 'gamepad';
        steer = pad.steer; throttle = Math.max(throttle, pad.throttle); brake = Math.max(brake, pad.brake);
        handbrake ||= pad.handbrake; boost ||= pad.boost;
      }
      if (touchState.active) {
        state.source = 'touch';
        if (Math.abs(touchState.steer) > Math.abs(steer)) steer = touchState.steer;
        throttle = Math.max(throttle, touchState.throttle);
        brake = Math.max(brake, touchState.brake);
        handbrake ||= touchState.handbrake; boost ||= touchState.boost;
      }
      state.steer = Math.max(-1, Math.min(1, steer * sens));
      state.throttle = throttle; state.brake = brake;
      state.handbrake = handbrake; state.boost = boost;
      return state;
    },
    vibrate(ms = 30) {
      if (!getSettings().haptics) return;
      try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
      for (const p of (navigator.getGamepads?.() || [])) {
        p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: 0.6, weakMagnitude: 0.4 }).catch(() => {});
      }
    },
    dispose() {
      removeEventListener('keydown', onDown);
      removeEventListener('keyup', onUp);
      removeEventListener('blur', onBlur);
    },
  };
}
