// Keyboard + gamepad + (optional) touch/tilt input, merged into one driving state.
// External sources (e.g. the UI team's touch controls) can be merged with setExternal().

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();     // edge-triggered this frame
    this.state = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
    this.external = null;         // function returning partial state
    this.tilt = { enabled: false, gamma: 0 };
    this.lastDevice = 'keyboard';
    this._kbSteer = 0;
    this._padPrev = {};
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code); this.lastDevice = 'keyboard';
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && e.target === document.body) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  setExternal(fn) { this.external = fn; }

  async enableTilt(on) {
    this.tilt.enabled = on;
    if (!on) return true;
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') { this.tilt.enabled = false; return false; }
      }
    } catch (e) { this.tilt.enabled = false; return false; }
    if (!this._tiltBound) {
      this._tiltBound = true;
      addEventListener('deviceorientation', (e) => {
        // landscape: beta is left/right tilt; portrait: gamma
        const landscape = Math.abs(window.orientation || 0) === 90 || innerWidth > innerHeight;
        let v = landscape ? (e.beta || 0) : (e.gamma || 0);
        if (landscape && (window.orientation === -90)) v = -v;
        this.tilt.gamma = v;
      });
    }
    return true;
  }

  wasPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }

  /** Call once per frame. Returns the merged driving state. */
  poll(dt, sens = 1) {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    // keyboard steering ramps so tapping gives small corrections
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 6 : (Math.sign(target) !== Math.sign(this._kbSteer) ? 9 : 3.2 * sens);
    this._kbSteer += clamp(target - this._kbSteer, -rate * dt, rate * dt);

    const s = this.state;
    s.steer = this._kbSteer;
    s.throttle = (k.has('ArrowUp') || k.has('KeyW')) ? 1 : 0;
    s.brake = (k.has('ArrowDown') || k.has('KeyS')) ? 1 : 0;
    s.handbrake = k.has('Space');
    s.boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN');

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      const any = Math.abs(ax) > 0.15 || rt > 0.05 || lt > 0.05 || p.buttons.some((b) => b.pressed);
      if (!any) continue;
      this.lastDevice = 'gamepad';
      const dz = 0.12;
      const sx = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
      s.steer = clamp(Math.sign(sx) * Math.pow(Math.abs(sx), 1.4) * sens, -1, 1);
      s.throttle = Math.max(s.throttle, rt);
      s.brake = Math.max(s.brake, lt);
      s.handbrake = s.handbrake || !!p.buttons[0]?.pressed;
      s.boost = s.boost || !!p.buttons[2]?.pressed || !!p.buttons[1]?.pressed;
      // edge buttons mapped onto keyboard codes so the game handles one set
      const map = { 3: 'KeyC', 9: 'Escape', 8: 'KeyR', 12: 'ArrowUp', 13: 'ArrowDown' };
      for (const [i, code] of Object.entries(map)) {
        const on = !!p.buttons[i]?.pressed;
        if (on && !this._padPrev[i]) this.pressed.add('Pad' + code);
        this._padPrev[i] = on;
      }
      break;
    }

    if (this.tilt.enabled) {
      const t = clamp(this.tilt.gamma / 28, -1, 1);
      s.steer = clamp(s.steer + Math.sign(t) * Math.pow(Math.abs(t), 1.2) * sens, -1, 1);
    }

    if (this.external) {
      const e = this.external();
      if (e) {
        if (e.steer) s.steer = clamp(s.steer + e.steer, -1, 1);
        if (e.roll) s.steer = clamp(s.steer + e.roll, -1, 1);
        s.throttle = Math.max(s.throttle, e.throttle || 0);
        s.brake = Math.max(s.brake, e.brake || 0);
        s.handbrake = s.handbrake || !!e.handbrake;
        s.boost = s.boost || !!e.boost;
        if (e.active) this.lastDevice = 'touch';
      }
    }
    return s;
  }

  /**
   * Flight axes (call after poll()). Keyboard: ↑/↓ climb/dive, W/S throttle, Space hover.
   * Gamepad: left stick Y pitch, RT/LT throttle, A hover. Touch comes from setExternal().
   */
  pollFlight(dt, invert = false) {
    const k = this.keys, f = this.flight || (this.flight = { pitch: 0, throttle: 0, thrust: null, hover: false, yaw: 0 });
    const up = k.has('ArrowUp') || k.has('KeyI'), down = k.has('ArrowDown') || k.has('KeyK');
    const target = (up ? 1 : 0) - (down ? 1 : 0);
    f.pitch += clamp(target - f.pitch, -dt * 5, dt * 5);
    f.throttle = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    f.hover = k.has('Space');
    f.yaw = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    f.thrust = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ay = p.axes[1] || 0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (Math.abs(ay) > 0.12) f.pitch = clamp(Math.sign(ay) * Math.pow(Math.abs(ay), 1.3), -1, 1);
      if (rt > 0.05 || lt > 0.05) f.throttle = rt - lt;
      if (p.buttons[0]?.pressed) f.hover = true;
      const rx = p.axes[2] || 0; if (Math.abs(rx) > 0.15) f.yaw = rx;
      break;
    }
    if (this.external) {
      const e = this.external();
      if (e && e.active) {
        if (e.pitch) f.pitch = clamp(e.pitch, -1, 1);
        if (e.thrust != null) f.thrust = e.thrust;
        if (e.brake || e.hover) f.hover = true;
        if (e.yaw) f.yaw = e.yaw;
      }
    }
    const out = { ...f, pitch: invert ? -f.pitch : f.pitch };
    return out;
  }

  endFrame() { this.pressed.clear(); }
}
