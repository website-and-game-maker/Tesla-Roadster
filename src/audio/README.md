# Audio

All game sound and music is synthesized live with the Web Audio API. There are no audio files to download or license, so it costs nothing in load time and is fully original.

Try everything at `audio-demo.html` (serve the repo with any static server).

## Use

```js
import { AudioEngine, mountAudioSettings } from './src/audio/AudioEngine.js';

const audio = new AudioEngine();          // safe before any user gesture
audio.unlock();                           // call on first click/tap/key (also automatic)

// every frame, for the player's car
audio.update({ speed, throttle, brake, slip, surface, boost }, dt);
//   speed m/s, throttle/brake/slip 0..1,
//   surface 'asphalt'|'dirt'|'grass'|'snow'|'sand', boost true while thrusters fire

audio.collision(impulse);    // impulse ~ change in speed (m/s): 2 tap, 8 hit, 20+ crash
audio.scrape(0..1);          // every frame while grinding a wall
audio.horn(true/false);
audio.ui('click');           // hover click confirm back error countdown go
                             // checkpoint lap coin combo unlock whoosh
audio.setCarActive(false);   // fade car sounds out in menus

// flight mode: call instead of update() each frame while flying (crossfades back on update())
audio.updateFlight({ airspeed, thrust, boost, altitude, gForce }, dt);
//   airspeed m/s, thrust 0..1, boost = afterburner, altitude metres, gForce in g
audio.ui('ring', combo);     // chime climbs a scale as the combo grows
audio.ui('nearMiss'); audio.ui('transform'); audio.ui('stall');

audio.music.play('menu');    // 'menu' | 'race' | 'flight' | 'results', crossfades
audio.music.setIntensity(x); // 0 calm .. 1 full; layers fade in as it rises
audio.music.stop();

audio.setVolume('music', 0.5);  // master | music | engine | sfx | ui, saved to localStorage
audio.mute(true);
mountAudioSettings(element, audio); // ready-made sliders for the settings menu

audio.setQuality('low');     // lighter reverb/voices for weak devices

// other cars (multiplayer/AI), 3D positioned; create after unlock()
audio.setListener(cameraPos, cameraForward, cameraUp);
const remote = audio.createRemoteCar();
remote.update({ speed, throttle, slip, surface });
remote.setPosition({ x, y, z });
remote.dispose();
```

Every call is a safe no-op before `unlock()` or on browsers without Web Audio. Music requested before unlock starts as soon as audio is unlocked.

## What's inside

- `MotorSound.js`: electric motor whine built from stacked tones at multiples of motor speed (pitch tracks road speed, since the car has one gear), inverter hum, regen-braking tone, tire roll and gravel crunch per surface, tire squeal and skid noise, wind that grows with the square of speed, boost thruster roar, and the low-speed pedestrian warning hum real EVs make.
- `FlightSound.js`: ducted-fan thrusters (noise body, blade-pass whirr and turbine whine that spool with thrust), afterburner roar and crackle, wind rush that grows with airspeed, a thin whistle at altitude, and airframe groan under high g.
- `Sfx.js`: layered crash sounds (thump, crunch, crackle, metal ring and glass for big hits), wall scrape, horn, all UI sounds, and flight events (ring chime ladder, near-miss doppler whoosh, road-to-flight transform, stall warning).
- `Music.js`: a step sequencer scheduled on the audio clock. Four original songs (garage menu, race, flight, results), each with pad, bass, drums, arpeggio and lead layers. Lead melodies are generated from a fixed seed in an A A' B A shape, so they repeat like a real tune.
- `AudioEngine.js`: mixer buses, limiter, music ducking on crashes and countdowns, saved volume settings, tab-hide pause, 3D remote cars.
- `settingsUI.js`: the volume settings panel.
