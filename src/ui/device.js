// Which device is the player using right now: 'touch', 'keyboard' or 'gamepad'.
//
// The first guess comes from the screen (a coarse pointer with touch points means a
// phone or tablet). After that the last thing the player actually used wins: a key
// press means keyboard, a finger means touch, a controller button means gamepad.
// So an iPad with a keyboard case, or a touchscreen laptop, settles on what the
// player is really holding instead of guessing once and being wrong.
import { isTouchDevice } from './settings.js';

export const DEVICE_LABEL = {
  touch: 'Touch screen',
  keyboard: 'Keyboard',
  gamepad: 'Controller',
};

/** True when steering by tilting the device can work here (a touch device with motion sensors). */
export function canTilt() {
  return typeof window !== 'undefined' && typeof DeviceOrientationEvent !== 'undefined' && isTouchDevice();
}

export function createDeviceWatcher() {
  let device = isTouchDevice() ? 'touch' : 'keyboard';
  const listeners = new Set();
  const set = (d) => {
    if (d === device) return;
    device = d;
    listeners.forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } });
  };

  addEventListener('keydown', (e) => {
    // Typing a name or room code is not "switching to keyboard" on a phone.
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    // Modifier-only presses and media keys don't count.
    if (/^(Shift|Control|Alt|Meta|Audio|Media)/.test(e.key) && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') return;
    set('keyboard');
  }, true);
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') set('touch');
    else if (e.pointerType === 'mouse' && device === 'touch' && !isTouchDevice()) set('keyboard');
  }, true);

  // Gamepads only report while polled. A connected pad only counts once a button or
  // stick is actually used, so a controller left plugged in does not take over.
  const poll = () => {
    requestAnimationFrame(poll);
    if (device === 'gamepad' || !navigator.getGamepads) return;
    for (const p of navigator.getGamepads()) {
      if (!p || !p.connected) continue;
      if (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5)) { set('gamepad'); return; }
    }
  };
  requestAnimationFrame(poll);

  return {
    get current() { return device; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set,
  };
}
