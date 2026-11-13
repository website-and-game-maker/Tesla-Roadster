// "How to drive": the controls for the device the player is on, big and first.
// The other devices' controls sit folded away underneath, so the screen never looks
// unsure about what the player is holding.
import { DEVICE_LABEL } from './device.js';

export const CONTROLS = {
  touch: [
    { key: 'GO', what: 'Drive', how: 'Hold the big button on the right' },
    { key: 'BRAKE', what: 'Brake, then reverse', how: 'Hold it next to GO' },
    { key: '◀ ▶', what: 'Steer', how: 'Drag left or right anywhere on the left side', tiltAlt: 'Or tilt your device like a steering wheel' },
    { key: 'DRIFT', what: 'Drift round corners', how: 'Hold while turning' },
    { key: '⚡', what: 'Boost', how: 'Tap when it glows' },
    { key: '❚❚', what: 'Pause', how: 'Top middle of the screen' },
  ],
  keyboard: [
    { key: 'W  or  ↑', what: 'Drive' },
    { key: 'S  or  ↓', what: 'Brake, then reverse' },
    { key: 'A D  or  ← →', what: 'Steer' },
    { key: 'Space', what: 'Drift round corners' },
    { key: 'Shift', what: 'Boost' },
    { key: 'C', what: 'Change camera' },
    { key: 'R', what: 'Put the car back on the road' },
    { key: 'Esc  or  P', what: 'Pause' },
  ],
  gamepad: [
    { key: 'RT', what: 'Drive' },
    { key: 'LT', what: 'Brake, then reverse' },
    { key: 'Left stick', what: 'Steer' },
    { key: 'A', what: 'Drift round corners' },
    { key: 'X  or  RB', what: 'Boost' },
    { key: 'Y', what: 'Change camera' },
    { key: 'Back', what: 'Put the car back on the road' },
    { key: 'Start', what: 'Pause' },
  ],
};

/** Flying controls (the main game). */
export const FLIGHT_CONTROLS = {
  touch: [
    { key: 'THRUST', what: 'Thrust', how: 'Slide the lever on the right up; it stays where you leave it' },
    { key: 'Stick', what: 'Bank and climb', how: 'Left stick: sideways banks the car into a turn, pull down to climb, push up to dive', tiltAlt: 'Or tilt your device to bank' },
    { key: '⚡', what: 'Overdrive boost', how: 'Hold it. Flying through rings recharges it' },
    { key: 'BRAKE', what: 'Air-brake and hover', how: 'Hold it: the fans keep you up even when slow' },
    { key: '❚❚', what: 'Pause', how: 'Top middle of the screen' },
  ],
  keyboard: [
    { key: 'W  or  S', what: 'More or less thrust' },
    { key: 'A D  or  ← →', what: 'Bank into a turn' },
    { key: '↑  or  I', what: 'Climb' },
    { key: '↓  or  K', what: 'Dive' },
    { key: 'Q  or  E', what: 'Rudder (flat turn)' },
    { key: 'Shift', what: 'Overdrive boost' },
    { key: 'Space', what: 'Air-brake and hover' },
    { key: 'C', what: 'Change camera' },
    { key: 'R', what: 'Reset to the last ring' },
    { key: 'Esc  or  P', what: 'Pause' },
  ],
  gamepad: [
    { key: 'RT  or  LT', what: 'More or less thrust' },
    { key: 'Left stick', what: 'Bank and climb' },
    { key: 'X  or  RB', what: 'Overdrive boost' },
    { key: 'A', what: 'Air-brake and hover' },
    { key: 'Y', what: 'Change camera' },
    { key: 'Back', what: 'Reset to the last ring' },
    { key: 'Start', what: 'Pause' },
  ],
};
export const controlsFor = (device, vehicle) => (vehicle === 'ground' ? CONTROLS : FLIGHT_CONTROLS)[device];

/** One short line for the start of a race. */
export const QUICK_HINT = {
  flight_touch: 'Drive with GO and steer. Hold JET to hop through the rings.',
  flight_touchTilt: 'Tilt to steer, hold GO. Hold JET to hop through the rings.',
  flight_keyboard: 'W to drive, A D to steer. Hold SPACE to fire the jets through the rings.',
  flight_gamepad: 'RT to drive, left stick to steer. Hold A to fire the jets through the rings.',
  touch: 'Hold GO to drive. Drag on the left side to steer.',
  touchTilt: 'Hold GO to drive. Tilt your device to steer.',
  keyboard: 'W or ↑ to drive. A D or ← → to steer. Space to drift.',
  gamepad: 'RT to drive. Left stick to steer. A to drift.',
};

const ICON = { touch: '📱', keyboard: '⌨️', gamepad: '🎮' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function rows(device, { tiltOn = false, compact = false, vehicle = 'flight' } = {}) {
  return controlsFor(device, vehicle).map((c) => {
    const how = tiltOn && c.tiltAlt ? c.tiltAlt.replace(/^Or t/, 'T') : c.how;
    const alt = !tiltOn && c.tiltAlt && !compact ? `<em>${esc(c.tiltAlt)}</em>` : '';
    const keys = c.key.split('  or  ');
    const cap = keys.length > 1 ? `<span class="ht-keys">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('<i>or</i>')}</span>` : `<kbd>${esc(c.key)}</kbd>`;
    return `<li>${cap}<span><b>${esc(c.what)}</b>${how && !compact ? `<small>${esc(how)}</small>` : ''}${alt}</span></li>`;
  }).join('');
}

/**
 * The guide's inner HTML.
 * @param {'touch'|'keyboard'|'gamepad'} device
 * @param {{ tiltAvailable: boolean, tiltOn: boolean }} tilt
 */
export function howToHTML(device, { tiltAvailable = false, tiltOn = false, vehicle = 'flight' } = {}) {
  const others = Object.keys(CONTROLS).filter((d) => d !== device);
  const tiltCard = device === 'touch' && tiltAvailable ? `
    <div class="ht-tilt${tiltOn ? ' on' : ''}">
      <div class="ht-tilt-art" aria-hidden="true"><span class="ht-phone"></span></div>
      <div class="ht-tilt-text">
        <span class="ht-badge">${tiltOn ? 'On' : 'Try this'}</span>
        <h3>${vehicle === 'ground' ? 'Tilt to steer' : 'Tilt to bank'}</h3>
        <p>${vehicle === 'ground' ? 'Hold your device sideways with both hands and tilt it left or right, just like a steering wheel. Your thumbs stay free for GO and BRAKE.' : 'Hold your device sideways and tilt it left or right to bank. Your thumbs stay free for thrust and climbing.'}</p>
      </div>
      <button class="${tiltOn ? 'ui-secondary sel' : 'ui-primary'} ht-tilt-btn" data-howto="tilt" role="switch" aria-checked="${tiltOn}">${tiltOn ? 'Tilt is on ✓' : 'Turn on tilt'}</button>
    </div>` : '';
  return `
    <div class="ht-device"><span aria-hidden="true">${ICON[device]}</span> Playing with a <b>${esc(DEVICE_LABEL[device].toLowerCase())}</b></div>
    ${tiltCard}
    <ul class="ht-list ht-${device}">${rows(device, { tiltOn, vehicle })}</ul>
    <details class="ht-other">
      <summary>Using something else?</summary>
      <div class="ht-other-cols">
        ${others.map((d) => `<div><h4>${ICON[d]} ${esc(DEVICE_LABEL[d])}</h4><ul class="ht-list ht-small">${rows(d, { compact: true, vehicle })}</ul></div>`).join('')}
      </div>
      <p class="ht-note">The game switches on its own as soon as you use one.</p>
    </details>`;
}
