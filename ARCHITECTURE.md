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
audio.update({ speed, throttle, brake, slip, surface, boost, airborne }, dt)
audio.updateJet({ firing, fuel, wanted }, dt); audio.land(impact, surface)   // jet hops
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

## Fly mode (the main game): jet hops

The Roadster drives on the road and fires short thruster bursts to hop over traffic, gaps and up through sky rings.

- `src/game/hopRace.js`: `HopRace extends Race`, so driving, AI, laps, online and the HUD all come from the ground race. On top it adds:
  - a jet tank per car (`c.jet`): a full tank burns in 1.4 s and refills in 2.6 s on the road; every ring adds 45%.
  - vertical motion (`jetStep`): thrust, gravity (at least 5.5 m/s², so low-gravity worlds still hop rather than hang), a shallow glide when coming down at speed, hard landings above 22 m/s.
  - walls only count within 2.2 m of the road, so you can hop over them; falling 12 m below the road respawns you before the next gap.
  - rings from `world.hopRings` (gap worlds) or generated about every 300 m over straight stretches, 4.5 to 10 m up.
  - AI: `aiAimLane` lines the car up under the next ring, `aiJet` times the burn so the arc passes through it.
  - kinds: `ringrace` (vs AI), `ringtrial` (missed ring +2 s), `freeflight`, `tutorial` (drive, jet, ring, glide, boost, lap).
- Input: the handbrake input is the jet in this mode (Space, touch JET button, gamepad A).
- Worlds pick their road layout with `createWorld(id, { mode: 'hop' })`; gap worlds (Spires, Red Rock Run, Cloud Isles) are hop-only.

## Secrets (easter eggs): `src/secrets/`

Three hidden objects per world (30 in all), each with a challenge. Wired in with one call,
`attachSecrets(game)` in `game.js`; the races do not know about it.

- `defs.js`: the 30 secrets (name, hint, flavour text, tier, challenge), rewards, jet trails.
  A secret is placed **relative to the track** (`at` 0..1 along the lap, `side`, `tier`), never at
  fixed coordinates, so it stays reachable when scenery or barriers change:
  `low` = just past the road edge, a tap of the jets up; `high` = over the road, a long burn;
  `wall` = off the track on open ground outside the 16 m fence (full burn over it, then drive),
  or on top of the fence on sky roads where there is no ground.
- `hunt.js`: per race. Finds a valid spot for each secret (off gaps, rings, corners and rock),
  detects the player's car touching one, runs challenges (Spark Run, Sky High, Long Glide,
  Bullseye; sized from the world's gravity), feeds the radar, draws the jet trail.
- `props.js`: the little procedural models. `overlay.js` + `secrets.css`: banner, radar and
  challenge card in the race. `log.js`: the Secrets screen and its main-menu entry.
- Progression: silent until found. `HUNTER_STARS` career stars or `HUNTER_FINDS` finds make the
  player a Secret Hunter: hints in the log, light beams, a radar arrow, and Secret Hunt (free
  roam from the log) where touching a secret starts its challenge.
- Runs in Fly mode only (not the tutorial, not Drive). State is `profile.secrets`.
- Reads from the race: `player.v`, `player.jet`, `player.info`, `player.outside`, `track`
  (`locate/pointAt/curvatureAt/roadHalf/wallHalf`), `groundAt`, `gapAt`, `rings`, `g`, `jetUp`,
  `kind`, `skyWorld`, `respawn()`, `flash()`. UI hooks used: `ui.addScreen`, `ui.startRace`, `ui.screen`.
- Check: `node tests/secrets/defs.test.js`.

## Graphics and auto quality: `src/core/quality.js`, `src/core/postfx.js`

- `QualityManager` picks Low / Medium / High / Ultra. First guess from the GPU name, cores, memory
  and device type (`detectTier`). While racing it watches frame rate against the display's real
  refresh rate (measured in menus, so a 30 Hz battery-saver phone isn't treated as a slow GPU) and,
  where the browser allows (`EXT_disjoint_timer_query_webgl2`), real GPU time per frame. It lowers
  render resolution first, then the tier; it only steps up when frames are on time and the GPU is
  under half busy. What it learns is stored per GPU + screen (`localStorage['roadster-quality-learned']`)
  so the next visit starts at the right level; a learned cap gets one retry after a week.
- `PostFX` (Medium and up, WebGL2 with float buffers): HDR scene buffer with MSAA, mip-chain
  bloom, filmic tone mapping, colour grade, vignette, dithering, and chromatic aberration / radial
  blur while boosting (High+). Low draws straight to the screen as before. Each race can grade its
  own look with `race.postLook()`. Custom shaders should end with `#include <colorspace_fragment>`
  so they look the same with and without post.
- Check: `node tests/quality/quality.test.js`.
