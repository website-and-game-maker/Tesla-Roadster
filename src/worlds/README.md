# Worlds

Seven original circuits, from a clifftop coast road to the Moon. Everything
is generated in code from fixed seeds (no downloaded assets), so a world
loads in well under a second and is identical for every player.

| # | id | World | Where | Gravity | Unlock (stars) | Feel |
|---|----|-------|-------|---------|----------------|------|
| 1 | `coast` | Cypress Coast | Earth | 9.81 | 0 | flowing clifftop highway at sunset, lighthouse |
| 2 | `saltflats` | Salt Flats Speedway | Earth | 9.81 | 8 | 2 km straights, top-speed runs, dust storms |
| 3 | `city` | Neon Downtown | Earth | 9.81 | 17 | night street circuit, 90° corners, wet neon |
| 4 | `alpine` | Glacier Pass | Earth | 9.81 | 27 | hairpins climbing 110 m, snow and ice |
| 5 | `launch` | Launch Complex 39 | Earth | 9.81 | 39 | fast loop around a rocket on the pad |
| 6 | `mars` | Red Planet Rally | Mars | 3.71 | 53 | loose regolith, habitat, dust devils, big air |
| 7 | `moon` | Tranquility Ring | Moon | 1.62 | 69 | black sky, Earth overhead, floaty jumps |

Unlock thresholds match the lead's career (four events per world, up to 3
stars each), so the player needs to master Earth before the rocket takes them to Mars: a nod
to the real Roadster that was launched into space in 2018.

Preview any world, quality tier, time of day and weather at
`worlds-preview.html?world=mars&quality=high&time=18&weather=dust`.

## API

```js
import { WORLDS, createWorld, starsForTime, unlockedWorlds, WEATHER } from './src/worlds/index.js';

const world = createWorld('coast', {
  scene, renderer,            // renderer is used for sky reflections (optional)
  quality: 'high',            // 'low' | 'medium' | 'high' | 'ultra'
  timeOfDay: 18.5,            // 0..24, default per world
  weather: 'clear',           // see world.weathers for what each world allows
});

// every frame
world.update(dt, carPosition, camera);
```

### Track
- `world.trackCurve`: closed `CatmullRomCurve3`; `t = 0` is the start/finish line, increasing `t` is the driving direction.
- `world.trackLength` (m), `world.roadHalfWidth`, `world.wallHalfWidth` (barriers are built exactly there; every track is at least 14 m wide and separate parts are always more than 2 × wallHalfWidth apart).
- `world.samples`: centre line pre-sampled every ~2 m (`position`, `forward`, `right` Float32Arrays, `curvature` 1/m, + = right turn). Handy for AI lines.
- `world.getTrackInfo(x, z, hintIndex?)` → `{ index, distance, progress (0..1), lateral (m, + right), height, forward, right, curvature, kerb }`. Pass last frame's `index` as the hint for speed.
- `world.spawn` `{ position, heading }`, `world.grid` (8 staggered slots for multiplayer/AI), `world.checkpoints` (12, index 0 at the line), `world.minimap` (array of `[x, z]`).
- Heading convention: forward vector is `(sin h, 0, cos h)`, so `object.rotation.y = heading` for a model facing +Z.

### Physics inputs
- `world.gravity` (m/s²): 9.81 on Earth, 3.71 Mars, 1.62 Moon.
- `world.getGroundHeight(x, z)`: exact road surface inside the barriers, terrain outside. Same on every quality tier.
- `world.getSurface(x, z)` → `{ type: 'road' | 'kerb' | 'shoulder', grip, rolling }`. Grip already includes the weather (rain 0.8, storm 0.72, snow 0.66, dust 0.88).

### Look
- `world.sun` (DirectionalLight, shadow box follows the car), `world.setShadowSize(px)`, `world.ambient` (HemisphereLight).
- `world.setTimeOfDay(h)`, `world.setWeather(name)`, `world.timeOfDay`, `world.weather`, `world.night` (true when headlights are needed), `world.nightAmount` (0..1), `world.lightning` (0..1 flash, for thunder).
- Weathers: `clear`, `cloudy`, `rain`, `storm`, `fog`, `snow`, `dust`. Rain makes the road darker and glossier.

### Progression
- `WORLDS[i]`: `{ id, order, name, tagline, description, location, gravity, laps, lengthMeters, unlock (stars needed), par: { gold, silver, bronze, lapGold }, weathers, defaultWeather, defaultTime, music }`.
- `starsForTime(id, raceSeconds)` → 0..3, `unlockedWorlds(totalStars)` → ids.

### Quality tiers
Tiers only change visuals: terrain resolution, prop density, shadow map size,
particle counts, texture sizes and reflections. Physics data never changes.
`low` turns off shadows and environment reflections for weak phones.

## Files
- `index.js` public API and catalogue
- `track.js` centre line, road/kerb/barrier meshes, projections
- `terrain.js` heightfield and water, `sky.js` atmosphere/sun/stars, `weather.js`, `props.js` instanced scenery
- `textures.js` procedural canvas textures, `noise.js` seeded noise
- `defs/*.js` one file per world
