# Architecture & team contracts

Plain ES modules, **no build step**. `index.html` has an import map that maps `three` to
`vendor/three.module.js` (three.js **r160**). Every module imports `three` as a bare
specifier. The site is served from the repo root (GitHub Pages: deploy from branch `main`, `/`).

The main loop lives in `src/game/game.js` (lead). Physics runs at a fixed 120 Hz step.

## Folder ownership (one team per folder, to avoid merge conflicts)

| Folder | Owner | Purpose |
|---|---|---|
| `index.html`, `src/core/`, `src/physics/`, `src/game/` | Lead / integration | boot, loop, input, quality scaling, saves, vehicle physics, AI, race modes, camera, integration glue |
| `src/car/` + `car-preview.html` | Car art | detailed procedural Roadster model |
| `src/worlds/` + `worlds-preview.html` | Worlds | tracks, environments, scenery, sky, weather |
| `src/audio/` + `audio-demo.html` | Audio | motor sound, SFX, music |
| `src/ui/` (incl. `src/ui/ui.css`) | Menus / UI | menus, garage, settings, HUD, pause, results, touch controls |
| `src/multiplayer/` + `multiplayer-demo.html`, `docs/MULTIPLAYER.md` | Multiplayer | online rooms (WebRTC P2P, static hosting) |

The lead ships simple fallbacks in `src/game/fallback/` so the game runs before each team
lands its module. `src/game/registry.js` dynamically imports each team module and uses the
fallback if it is missing or throws. Teams: do not edit other folders; ask the lead for hooks.

## Contracts (as proposed by each team)

### Car — `src/car/roadster.js`
```js
const car = createRoadster({ paint, wheels, quality });   // 'low'|'medium'|'high'
car.object  // THREE.Group, origin on ground between axles, +Z forward, metres
car.update(dt, speedMps, steerRad); car.setPaint(id); car.setWheels(id)
car.setBrake(b); car.setHeadlights(b); car.setReverse(b); car.wheelPositions; car.dispose()
export PAINTS, WHEELS   // [{ id, name, ... }]
```

### Worlds — `src/worlds/index.js`
```js
const world = createWorld(id, { scene, renderer, quality, timeOfDay, weather });
world.trackCurve      // closed CatmullRomCurve3 centre line; t=0 is start/finish, driving direction = increasing t
world.roadHalfWidth   // metres, centre -> road edge   (lead request)
world.wallHalfWidth   // metres, centre -> barrier; physics keeps cars inside (lead request)
world.spawn, world.checkpoints, world.getGroundHeight(x,z), world.getSurface(x,z) -> {grip, rolling}
world.gravity, world.update(dt, carPosition), world.setTimeOfDay(h), world.setWeather(w), world.dispose()
export WORLDS  // [{ id, name, description, unlock, laps, par }]
```
Lead samples `trackCurve` (`src/game/trackSampler.js`) for lap progress (0..1), AI racing
lines, wall collisions and the minimap.

### Audio — `src/audio/AudioEngine.js`
```js
const audio = new AudioEngine(); audio.unlock();     // first user gesture
audio.update({ speed, throttle, brake, slip, surface, boost }, dt)
audio.collision(impulse); audio.ui('click'|'hover'|'confirm'|'back'|'countdown'|'go'|'lap'|'unlock')
audio.music.play('menu'|'race'|'results'); audio.music.setIntensity(0..1)
audio.setVolume(channel, v); audio.mute(b); export mountAudioSettings(container, audio)
```

### UI — `src/ui/index.js`
```js
const ui = createUI({ root, THREE, buildCarModel, tracks, modes });
ui.on('start'|'resume'|'restart'|'quit'|'settings', cb)
ui.settings   // persisted settings object
ui.hud.update({ speedKmh, lap, lapCount, lapTime, bestLap, position, racers, boost, battery, fps, minimap })
ui.input      // { steer, throttle, brake, handbrake, boost } from touch (lead merges keyboard/gamepad)
ui.showMenu(); ui.showPause(); ui.showResults(data); ui.toast(text)
```
Lead request: also accept `ui.setProfile({ credits, stars, owned, upgrades, unlocked })` so the
garage and career map show progression, and emit `ui.on('purchase', {kind, id})`.

### Multiplayer — `src/multiplayer/`
```js
const mp = new Multiplayer({ name, color });
mp.hostRoom({ trackId, laps }); mp.joinRoom(code); mp.quickMatch()
mp.sendState({ pos, quat, vel, speed, steer, lap, progress })  // progress 0..1 along lap
mp.getRemoteCars(); events 'lobby','countdown','positions','results'
```
