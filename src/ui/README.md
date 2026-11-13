# UI (menus, garage, HUD, touch)

Owned by the menus/UI team. Plain ES modules, no build step. Open `src/ui/demo.html` from any static server to try every screen with a fake race.

```js
import * as THREE from 'three';
import { createUI } from './ui/index.js';   // also load src/ui/ui.css
const ui = createUI({ THREE, buildCarModel, paints, wheels, tracks, modes });
ui.on('start', ({ mode, eventId, track, laps, opponents, difficulty, car, settings }) => {});
ui.on('pause' | 'resume' | 'restart' | 'quit', () => {});
ui.on('settings', (s) => {});            // s.graphics = resolved quality preset
ui.on('purchase', ({ kind, id, price }) => {}); // then call ui.setProfile(...)
ui.on('equip', (car) => {});
ui.on('multiplayer', ({ action, code, name, car }) => {}); // then ui.showLobby({...})
ui.on('lobby', ({ action, ready, track }) => {});
ui.on('ui-sound', (type) => {});         // set ui.builtinSounds = false to use the audio team's sounds
```

Per frame in a race: `ui.hud.update({ speedKmh, gear, lap, lapCount, lapTime, bestLap, position, racers, boost, battery, driftScore, message, wrongWay, ghostDelta, eliminated, fps, minimap }, dt)` and read `ui.input.touchState` (or `ui.input.poll(dt)` for keyboard + gamepad + touch merged).

The UI owns Esc / P / gamepad Start for pausing and emits `pause` / `resume`; the engine should not also bind them.

Options: `opts.upgradeCosts = { motor: [...], inverter: [...], tires: [...], battery: [...] }` overrides upgrade prices. HUD also accepts `note` (short callout), `extra` (text under the timers), `driftChain`, `driftMult`.

Other calls: `ui.showMenu()`, `ui.pause()`, `ui.showResults({...})`, `ui.setLoading(0..1, text)`, `ui.toast(text)`, `ui.setProfile({...})`, `ui.setCatalog({ paints, wheels })`, `ui.setResolvedQuality(tier)`.

Graphics helpers: `detectQuality()`, `resolveGraphics(settings)`, `createAdaptiveQuality(tier, onChange)` (steps quality down when FPS stays under 40, never back up to a tier that was too slow).

## Flight mode, tutorial, account

- `start` now carries `vehicleMode: 'flight' | 'ground'` (top-bar toggle, default flight). The tutorial starts with `mode: 'tutorial'`.
- Flight HUD fields: `altitude` (m), `airspeedKmh` (falls back to `speedKmh`), `rings: { hit, total }`, `nextRingDir: { x, y }` (screen-space unit vector, `null` hides the arrow), `thrust` (0..1). `ui.hud.setMode('flight' | 'ground')` is called on start.
- Touch flight controls feed `ui.input.pitch` (+ = nose up, stick down), `roll`, `yaw`, `thrust` (lever, stays put), `boost`, `brake`. All controls are multi-touch.
- Tutorial: `ui.tutorial.show({ id, text, keyHint, touchHint?, step?, total? })`, `ui.tutorial.done(id)`, `ui.tutorial.hide()`, `ui.tutorial.complete()`. Emits `tutorial` `{ action: 'show' | 'skip' | 'complete', id? }`. The first Play in flight mode offers the tutorial once.
- Account: emits `auth` `{ action: 'signin' | 'signup' | 'signout' | 'guest', email?, password? }`. Reflect results with `ui.setAccount({ signedIn, email, name, error })`. Passwords are cleared from the form after submit and never stored.

## Devices and How to drive

`device.js` watches what the player actually uses (finger, key, controller) and the UI follows it when Controls is on Auto: touch controls, the title prompt, the Settings controls list and the How to drive screen all show only that device. `howto.js` builds the How to drive screen: the current device's controls big, a "Tilt to steer" card on phones and tablets with motion sensors, and the other devices folded under "Using something else?". The first race on a device opens it first; the first three races show a one-line reminder. Tilt is owned by `touch.js` (the engine's own tilt stays off when this UI is loaded) and only counts as on once the sensor reports.
