# Worlds

Seven original circuits, from a clifftop coast road to the Moon. Everything
is generated in code from fixed seeds (no downloaded assets), so a world
loads in well under a second and is identical for every player.

| # | id | World | Modes | Gravity | Unlock (stars) | Feel |
|---|----|-------|-------|---------|----------------|------|
| 1 | `coast` | Cypress Coast | flight, ground | 9.81 | 0 | clifftop highway at sunset, lighthouse |
| 2 | `saltflats` | Salt Flats Speedway | flight, ground | 9.81 | 7 | 2 km straights, top-speed runs, dust storms |
| 3 | `spires` | Skyline Spires | flight | 9.81 | 14 | slalom between glass towers, under sky bridges |
| 4 | `city` | Neon Downtown | flight, ground | 9.81 | 22 | night street circuit, 90° corners, wet neon |
| 5 | `alpine` | Glacier Pass | flight, ground | 9.81 | 29 | hairpins, the flight course dives under a stone arch |
| 6 | `canyon` | Red Rock Run | flight | 9.81 | 36 | river canyon, natural arches, two pops over the rim |
| 7 | `launch` | Launch Complex 39 | flight, ground | 9.81 | 43 | loop around a rocket on the pad |
| 8 | `mars` | Red Planet Rally | flight, ground | 3.71 | 50 | loose regolith, habitat, dust devils |
| 9 | `isles` | Cloud Isles | flight | 9.81 | 58 | floating islands above a sea of cloud |
| 10 | `moon` | Tranquility Ring | flight, ground | 1.62 | 65 | black sky, Earth overhead |

Unlocks: each world offers up to 12 stars (4 career events x 3), and a world
opens at about 60% of the stars available before it (`unlock = round(order * 7.2)`).
Flight-only worlds have no road: filter `WORLDS` by `modes` before offering ground races.

Preview any world, mode, quality tier, time of day and weather at
`worlds-preview.html?world=mars&mode=flight&quality=high&time=18&weather=dust`.

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

### Flight mode
`createWorld(id, { ..., mode: 'flight' | 'ground' })`. Without `mode`, worlds with a road start in ground mode.

- `world.flightCurve`: closed 3D `CatmullRomCurve3`; `t = 0` is the start, increasing `t` is forward. `world.flightLength` (m), `world.flightLaps`.
- `world.rings`: `[{ index, position, quaternion, normal, radius, t, distance }]`, 80 to 150 m apart (closer where the path twists). The ring's plane faces along the path (`normal` = path tangent; quaternion rotates +Z onto it). Rings sit under bridges and arches, between towers and islands.
- `world.crossedRing(ring, prevPos, pos)`: true if the car went through the ring this frame, in the direction of travel.
- `world.setNextRing(i)` colours the rings (passed, gold target, cyan ahead); `world.ringObject` is the InstancedMesh if you want to hide it.
- `world.colliders`: `[{ type: 'box', min, max } | { type: 'sphere', center, radius }]` for towers, bridges, arches, islands, rocks, landmarks. `world.queryColliders(x, z, r)` returns the ones near a point; `world.colliderDistance(c, x, y, z)` gives the distance to one (negative inside). Same on every quality tier.
- `world.getGroundHeight(x, z)`: terrain, road, water surface or cloud deck. Anything below is a crash.
- `world.ceiling` (max altitude, m), `world.spawn` (`{ position, heading, pitch }` just behind the first ring), `world.groundSpawn` (on the road).
- `WORLDS[i].modes` and `WORLDS[i].flight = { laps, lengthMeters, ceiling, par }`; `starsForTime(id, seconds, 'flight')`.
- Every course is checked to keep each ring clear of terrain and colliders; a fix-up pass lifts any part of a generated path that would clip something.

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
