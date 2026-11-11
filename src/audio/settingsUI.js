// Drop-in volume settings panel. Unstyled beyond the basics so the menu team
// can theme it via the .audio-settings class names.
//
//   mountAudioSettings(document.querySelector('#settings-audio'), audio);

const ROWS = [
  ['master', 'Master'],
  ['music', 'Music'],
  ['engine', 'Engine'],
  ['sfx', 'Effects'],
  ['ui', 'Interface'],
];

export function mountAudioSettings(container, audio) {
  const root = document.createElement('div');
  root.className = 'audio-settings';
  root.style.cssText = 'display:grid;grid-template-columns:auto 1fr 3ch;gap:10px 12px;align-items:center;font:inherit;';

  const sliders = {};
  for (const [key, label] of ROWS) {
    const id = `audio-vol-${key}-${Math.random().toString(36).slice(2, 7)}`;
    const lab = document.createElement('label');
    lab.htmlFor = id;
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.id = id;
    input.className = 'audio-settings__slider';
    input.style.width = '100%';
    const val = document.createElement('span');
    val.className = 'audio-settings__value';
    val.style.textAlign = 'right';
    input.addEventListener('input', () => audio.setVolume(key, input.value / 100));
    // Short preview so players hear what they're changing.
    input.addEventListener('change', () => audio.ui(key === 'music' ? 'hover' : 'click'));
    root.append(lab, input, val);
    sliders[key] = { input, val };
  }

  const muteLab = document.createElement('label');
  muteLab.className = 'audio-settings__mute';
  muteLab.style.gridColumn = '1 / -1';
  const mute = document.createElement('input');
  mute.type = 'checkbox';
  mute.addEventListener('change', () => audio.mute(mute.checked));
  muteLab.append(mute, document.createTextNode(' Mute all sound'));

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'audio-settings__reset';
  reset.textContent = 'Reset to defaults';
  reset.style.gridColumn = '1 / -1';
  reset.style.justifySelf = 'start';
  reset.addEventListener('click', () => { audio.resetVolumes(); audio.ui('back'); });

  root.append(muteLab, reset);
  container.appendChild(root);

  const sync = (s) => {
    for (const [key] of ROWS) {
      const pct = Math.round(s[key] * 100);
      sliders[key].input.value = String(pct);
      sliders[key].val.textContent = String(pct);
    }
    mute.checked = !!s.muted;
  };
  sync(audio.settings);
  const off = audio.onChange(sync);

  return () => {
    off();
    root.remove();
  };
}
