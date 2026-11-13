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

/** One short line for the start of a race. */
export const QUICK_HINT = {
  touch: 'Hold GO to drive. Drag on the left side to steer.',
  touchTilt: 'Hold GO to drive. Tilt your device to steer.',
  keyboard: 'W or ↑ to drive. A D or ← → to steer. Space to drift.',
  gamepad: 'RT to drive. Left stick to steer. A to drift.',
};

const ICON = { touch: '📱', keyboard: '⌨️', gamepad: '🎮' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function rows(device, { tiltOn = false, compact = false } = {}) {
  return CONTROLS[device].map((c) => {
    const how = tiltOn && c.tiltAlt ? 'Tilt your device like a steering wheel' : c.how;
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
export function howToHTML(device, { tiltAvailable = false, tiltOn = false } = {}) {
  const others = Object.keys(CONTROLS).filter((d) => d !== device);
  const tiltCard = device === 'touch' && tiltAvailable ? `
    <div class="ht-tilt${tiltOn ? ' on' : ''}">
      <div class="ht-tilt-art" aria-hidden="true"><span class="ht-phone"></span></div>
      <div class="ht-tilt-text">
        <span class="ht-badge">${tiltOn ? 'On' : 'Try this'}</span>
        <h3>Tilt to steer</h3>
        <p>Hold your device sideways with both hands and tilt it left or right, just like a steering wheel. Your thumbs stay free for GO and BRAKE.</p>
      </div>
      <button class="${tiltOn ? 'ui-secondary sel' : 'ui-primary'} ht-tilt-btn" data-howto="tilt" role="switch" aria-checked="${tiltOn}">${tiltOn ? 'Tilt is on ✓' : 'Turn on tilt'}</button>
    </div>` : '';
  return `
    <div class="ht-device"><span aria-hidden="true">${ICON[device]}</span> Playing with a <b>${esc(DEVICE_LABEL[device].toLowerCase())}</b></div>
    ${tiltCard}
    <ul class="ht-list ht-${device}">${rows(device, { tiltOn })}</ul>
    <details class="ht-other">
      <summary>Using something else?</summary>
      <div class="ht-other-cols">
        ${others.map((d) => `<div><h4>${ICON[d]} ${esc(DEVICE_LABEL[d])}</h4><ul class="ht-list ht-small">${rows(d, { compact: true })}</ul></div>`).join('')}
      </div>
      <p class="ht-note">The game switches on its own as soon as you use one.</p>
    </details>`;
}
