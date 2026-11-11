// Loads each team's module if it exists and works, otherwise the lead's fallback.
// This lets every team merge independently without breaking the playable game.
import * as fbCar from './fallback/car.js';
import * as fbWorld from './fallback/world.js';
import * as fbAudio from './fallback/audio.js';
import * as fbUI from './fallback/ui.js';

async function tryImport(path, check) {
  try {
    const m = await import(path);
    if (check(m)) return m;
    console.warn(`[registry] ${path} loaded but is missing the expected exports; using fallback`);
  } catch (e) {
    console.info(`[registry] ${path} not available (${e.message}); using fallback`);
  }
  return null;
}

export async function loadModules() {
  const [car, worlds, audio, ui, mp] = await Promise.all([
    tryImport('../car/roadster.js', (m) => typeof m.createRoadster === 'function' && Array.isArray(m.PAINTS)),
    tryImport('../worlds/index.js', (m) => typeof m.createWorld === 'function' && Array.isArray(m.WORLDS)),
    tryImport('../audio/AudioEngine.js', (m) => typeof m.AudioEngine === 'function'),
    tryImport('../ui/index.js', (m) => typeof m.createUI === 'function'),
    tryImport('../multiplayer/index.js', (m) => typeof m.Multiplayer === 'function'),
  ]);
  return {
    car: car || fbCar, carIsFallback: !car,
    worlds: worlds || fbWorld, worldsIsFallback: !worlds,
    audio: audio || fbAudio, audioIsFallback: !audio,
    ui: ui || fbUI, uiIsFallback: !ui,
    multiplayer: mp,
    fallback: { car: fbCar, worlds: fbWorld, audio: fbAudio, ui: fbUI },
  };
}
