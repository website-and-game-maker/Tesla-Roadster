// Worlds team public API.
//
//   import { WORLDS, createWorld } from './src/worlds/index.js';
//   const world = createWorld('coast', { scene, renderer, quality: 'high', timeOfDay: 18, weather: 'clear' });
//   // each frame:
//   world.update(dt, carPosition, camera);
//
// See src/worlds/README.md for the full contract.
import * as THREE from 'three';
import { createNoise2D } from './noise.js';
import { getQuality } from './quality.js';
import { buildTrackData, buildTrackMeshes, buildCheckpoints, buildGrid } from './track.js';
import { makeHeightFn, buildTerrain, buildWater } from './terrain.js';
import { createSky } from './sky.js';
import { createWeather, WEATHER } from './weather.js';
import { scatterProps } from './props.js';
import { detailTexture, softDot } from './textures.js';

import coast from './defs/coast.js';
import saltflats from './defs/saltflats.js';
import city from './defs/city.js';
import alpine from './defs/alpine.js';
import launch from './defs/launch.js';
import mars from './defs/mars.js';
import moon from './defs/moon.js';

const DEFS = [coast, saltflats, city, alpine, launch, mars, moon];

const DEFAULT_SURFACES = {
  road: { grip: 1, rolling: 0.012 },
  kerb: { grip: 0.93, rolling: 0.016 },
  shoulder: { grip: 0.68, rolling: 0.05 },
};

// Catalogue for menus and progression. Cheap: only measures each track.
export const WORLDS = DEFS.map((d, order) => {
  const curve = new THREE.CatmullRomCurve3(d.points.map(([x, z, y = 0]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
  const length = curve.getLength();
  const lapGold = length / d.goldSpeed;
  const total = lapGold * d.laps;
  return {
    id: d.id,
    order,
    name: d.name,
    tagline: d.tagline,
    description: d.description,
    location: d.location,         // 'Earth' | 'Mars' | 'Moon'
    gravity: d.gravity,
    laps: d.laps,
    lengthMeters: Math.round(length),
    unlock: d.unlock,             // total stars needed to open this world
    unlockStars: d.unlock,
    // Medal targets in seconds for the full race (laps) and for one lap.
    par: {
      gold: Math.round(total),
      silver: Math.round(total * 1.12),
      bronze: Math.round(total * 1.28),
      lapGold: Math.round(lapGold * 10) / 10,
    },
    weathers: d.weathers,
    defaultWeather: d.defaultWeather,
    defaultTime: d.defaultTime,
    music: d.music,
  };
});

export { WEATHER };

export function getWorldInfo(id) {
  return WORLDS.find((w) => w.id === id) || null;
}

// Stars earned for a finished race time (0..3).
export function starsForTime(id, seconds) {
  const w = getWorldInfo(id);
  if (!w || !Number.isFinite(seconds)) return 0;
  if (seconds <= w.par.gold) return 3;
  if (seconds <= w.par.silver) return 2;
  if (seconds <= w.par.bronze) return 1;
  return 0;
}

// Which worlds are open for a given star total.
export function unlockedWorlds(totalStars) {
  return WORLDS.filter((w) => totalStars >= (w.unlock ?? 0)).map((w) => w.id);
}

export function createWorld(id, opts = {}) {
  const def = DEFS.find((d) => d.id === id) || DEFS[0];
  const { scene, renderer = null } = opts;
  if (!scene) throw new Error('createWorld needs { scene }');
  const quality = getQuality(opts.quality);
  const root = new THREE.Group();
  root.name = `world-${def.id}`;
  scene.add(root);

  const noise = createNoise2D(def.seed);
  const track = buildTrackData(def);
  const heightFn = makeHeightFn(def, track, noise);
  const detailMap = detailTexture(quality.textureSize >= 512 ? 512 : 256, quality.anisotropy, def.seed % 97);

  const updaters = [];
  const glowMats = [];
  const time0 = performance.now();

  // Terrain and water.
  const terrain = buildTerrain(def, track, heightFn, quality, detailMap);
  root.add(terrain);
  let water = null;
  if (def.water) {
    water = buildWater(def, track, quality);
    root.add(water);
  }

  // Road, kerbs, barriers, start gantry.
  const trackGroup = buildTrackMeshes(track, def, { detailMap, terrainHeight: heightFn }, quality);
  root.add(trackGroup);
  const roadMat = trackGroup.getObjectByName('road').material;

  // Scenery.
  const bounds = terrain.userData.bounds;
  const props = scatterProps(def.props || [], { track, heightFn, quality, bounds, seed: def.seed });
  root.add(props.group);

  const signCache = new Map();
  const ctx = {
    track,
    heightFn,
    quality,
    softDot: softDot(),
    onUpdate: (fn) => updaters.push(fn),
    glow: (mat, max) => glowMats.push({ mat, max }),
    sign: (text, bg, fg, accent) => {
      const k = `${text}|${bg}|${fg}|${accent}`;
      if (!signCache.has(k)) signCache.set(k, signTex(text, bg, fg, accent));
      return signCache.get(k);
    },
  };
  if (def.landmarks) {
    const lm = def.landmarks(ctx);
    if (lm) {
      lm.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.castShadow || quality.shadows;
          o.receiveShadow = true;
        }
      });
      root.add(lm);
    }
  }

  // Sky, lights, weather.
  const sky = createSky(def, scene, renderer, quality);
  root.add(sky.group);
  sky.setTime(opts.timeOfDay ?? def.defaultTime ?? 12);
  const weather = createWeather(scene, quality, sky, { wettable: [roadMat] });
  const allowed = def.weathers || ['clear'];
  weather.set(allowed.includes(opts.weather) ? opts.weather : def.defaultWeather || 'clear');

  const surfaces = {
    road: { ...DEFAULT_SURFACES.road, ...(def.surfaces?.road || {}) },
    kerb: { ...DEFAULT_SURFACES.kerb, ...(def.surfaces?.kerb || {}) },
    shoulder: { ...DEFAULT_SURFACES.shoulder, ...(def.surfaces?.shoulder || {}) },
  };

  const checkpoints = buildCheckpoints(track, 12);
  const grid = buildGrid(track, 8);
  const spawn = { position: grid[0].position.clone(), heading: grid[0].heading };

  // Night factor drives windows, lamps, beacons.
  let lastNight = -1;
  function applyNight() {
    const n = sky.state.night;
    if (Math.abs(n - lastNight) < 0.01) return;
    lastNight = n;
    props.setNight(n);
    for (const g of glowMats) g.mat.emissiveIntensity = g.max * n;
  }
  applyNight();

  const projTmp = {};
  let hint = -1;
  const camTarget = new THREE.Vector3();

  const world = {
    id: def.id,
    info: getWorldInfo(def.id),
    def,
    object: root,
    sun: sky.sun,
    ambient: sky.hemi,
    gravity: def.gravity,
    laps: def.laps,
    trackCurve: track.curve,
    trackLength: track.length,
    roadHalfWidth: track.roadHalfWidth,
    wallHalfWidth: track.wallHalfWidth,
    spawn,
    grid,
    checkpoints,
    // Pre-sampled centre line every ~2 m (Float32Array xyz), for minimaps and AI.
    samples: { count: track.count, spacing: track.spacing, position: track.pos, forward: track.fwd, right: track.right, curvature: track.curvature },
    // Minimap polyline in world x/z (every ~8 m).
    minimap: (() => {
      const out = [];
      const step = Math.max(1, Math.round(8 / track.spacing));
      for (let i = 0; i < track.count; i += step) out.push([track.pos[i * 3], track.pos[i * 3 + 2]]);
      return out;
    })(),

    // Where is (x, z) relative to the track? { distance, progress, lateral, height, forward, right, curvature, kerb, index }
    getTrackInfo(x, z, hintIndex = -1, out = {}) {
      return track.project(x, z, hintIndex, out);
    },

    // Ground height under (x, z). On the road and run-off this is the exact
    // road surface; elsewhere it is the terrain.
    getGroundHeight(x, z) {
      const p = track.project(x, z, hint, projTmp);
      hint = p.index;
      if (Math.abs(p.lateral) <= track.wallHalfWidth + 1) {
        // Matches the slight crown of the road mesh.
        const a = Math.abs(p.lateral);
        const crown = a < track.roadHalfWidth ? 0.03 * (1 - a / track.roadHalfWidth) : -0.02;
        return p.height + crown;
      }
      return heightFn(x, z);
    },

    // Surface under (x, z): { type, grip, rolling }. Grip already includes weather.
    getSurface(x, z) {
      const p = track.project(x, z, hint, projTmp);
      hint = p.index;
      const a = Math.abs(p.lateral);
      let type = 'shoulder';
      if (a <= track.roadHalfWidth) type = 'road';
      else if (p.kerb && a <= track.roadHalfWidth + 1.1) type = 'kerb';
      const s = surfaces[type];
      return { type, grip: s.grip * weather.grip, rolling: s.rolling };
    },

    get timeOfDay() { return sky.state.hour; },
    get weather() { return weather.name; },
    // true when it is dark enough for headlights; nightAmount is 0..1.
    get night() { return sky.state.night > 0.5; },
    get nightAmount() { return sky.state.night; },
    // 0..1 lightning flash brightness, for thunder audio.
    get lightning() { return weather.flash; },
    weathers: allowed,

    setTimeOfDay(h) {
      sky.setTime(h);
      applyNight();
    },
    // Lead's quality settings can change the shadow map size live.
    setShadowSize(size) {
      const s = sky.sun.shadow;
      if (!s || s.mapSize.x === size) return;
      s.mapSize.set(size, size);
      if (s.map) { s.map.dispose(); s.map = null; }
    },
    setWeather(w) {
      weather.set(allowed.includes(w) ? w : 'clear');
      applyNight();
    },

    update(dt, carPosition, camera) {
      const t = (performance.now() - time0) / 1000;
      const focus = carPosition || (camera ? camTarget.copy(camera.position) : null);
      sky.update(dt, focus, camera);
      weather.update(dt, camera || (focus ? { position: focus } : null));
      if (water) water.userData.update(dt);
      applyNight();
      for (const fn of updaters) fn(dt, sky.state.night, t);
    },

    dispose() {
      weather.dispose();
      sky.dispose();
      scene.remove(root);
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
              // Shared cached textures (road, detail) are kept for the next world.
              if (m[k] && m[k].userData?.owned) m[k].dispose();
            }
            m.dispose();
          }
        }
      });
      for (const t of signCache.values()) t.dispose();
    },
  };
  return world;
}

function signTex(text, bg = '#111', fg = '#fff', accent = '#e31937') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = accent;
  g.fillRect(0, 140, 512, 20);
  g.fillStyle = fg;
  g.font = 'bold 64px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
