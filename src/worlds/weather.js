// Weather: particles that follow the camera, plus the matching fog, light
// and grip changes. Grip changes are part of gameplay (rain is slippery),
// so they are the same on every quality tier; only particle counts differ.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { softDot } from './textures.js';

export const WEATHER = {
  clear: { label: 'Clear', grip: 1, wet: 0, look: { fog: 1, dim: 1, cloud: 0 } },
  cloudy: { label: 'Overcast', grip: 1, wet: 0, look: { fog: 1.6, dim: 0.8, cloud: 0.7 } },
  rain: { label: 'Rain', grip: 0.8, wet: 1, particles: 'rain', look: { fog: 2.6, dim: 0.62, cloud: 0.95 } },
  storm: { label: 'Thunderstorm', grip: 0.72, wet: 1, particles: 'rain', lightning: true, look: { fog: 3.4, dim: 0.45, cloud: 1 } },
  fog: { label: 'Fog', grip: 0.97, wet: 0.3, look: { fog: 7, dim: 0.85, cloud: 0.85 } },
  snow: { label: 'Snow', grip: 0.66, wet: 0.2, particles: 'snow', look: { fog: 3.2, dim: 0.85, cloud: 0.9 } },
  dust: { label: 'Dust storm', grip: 0.88, wet: 0, particles: 'dust', look: { fog: 5, dim: 0.75, cloud: 0.6 } },
};

const BOX = 70; // particle volume around the camera, metres

export function createWeather(scene, quality, sky, materials) {
  const group = new THREE.Group();
  group.name = 'weather';
  scene.add(group);
  let current = 'clear';
  let system = null;
  let flash = 0;
  let nextStrike = 6;
  const rand = mulberry32(42);

  function clearSystem() {
    if (!system) return;
    group.remove(system.obj);
    system.obj.geometry.dispose();
    system.obj.material.dispose();
    system = null;
  }

  function makeRain(n) {
    const pos = new Float32Array(n * 6);
    const seeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      seeds[i * 3] = (rand() - 0.5) * BOX;
      seeds[i * 3 + 1] = rand() * BOX;
      seeds[i * 3 + 2] = (rand() - 0.5) * BOX;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.38, depthWrite: false });
    const obj = new THREE.LineSegments(g, m);
    obj.frustumCulled = false;
    return { obj, seeds, n, kind: 'rain', speed: 26 };
  }

  function makePoints(n, kind) {
    const pos = new Float32Array(n * 3);
    const seeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      seeds[i * 3] = (rand() - 0.5) * BOX;
      seeds[i * 3 + 1] = rand() * BOX * 0.6;
      seeds[i * 3 + 2] = (rand() - 0.5) * BOX;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      map: softDot(),
      color: kind === 'snow' ? 0xffffff : 0xc98b5a,
      size: kind === 'snow' ? 0.22 : 0.5,
      transparent: true,
      opacity: kind === 'snow' ? 0.9 : 0.35,
      depthWrite: false,
    });
    const obj = new THREE.Points(g, m);
    obj.frustumCulled = false;
    return { obj, seeds, n, kind, speed: kind === 'snow' ? 1.6 : 0.6 };
  }

  let time = 0;
  function set(name) {
    const w = WEATHER[name] ? name : 'clear';
    current = w;
    clearSystem();
    const def = WEATHER[w];
    if (def.particles === 'rain') system = makeRain(quality.particles);
    else if (def.particles) system = makePoints(quality.particles, def.particles);
    if (system) group.add(system.obj);
    sky.setWeatherLook(def.look);
    // Wet roads: smoother and darker, so they reflect the sky and lights.
    for (const m of materials.wettable) {
      const base = m.userData.baseRoughness ?? m.roughness;
      m.userData.baseRoughness = base;
      m.roughness = base * (1 - 0.72 * def.wet);
      if (!m.userData.baseColor) m.userData.baseColor = m.color.clone();
      m.color.copy(m.userData.baseColor).multiplyScalar(1 - 0.35 * def.wet);
      m.needsUpdate = true;
    }
  }

  function update(dt, camera) {
    time += dt;
    if (system && camera) {
      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      const a = system.obj.geometry.attributes.position.array;
      const s = system.seeds;
      const half = BOX / 2;
      const wrap = (v, c) => {
        let d = (v - c + half) % BOX;
        if (d < 0) d += BOX;
        return c - half + d;
      };
      if (system.kind === 'rain') {
        const fall = time * system.speed;
        for (let i = 0; i < system.n; i++) {
          const x = wrap(s[i * 3] + time * 2, cx);
          const z = wrap(s[i * 3 + 2], cz);
          let y = (s[i * 3 + 1] - fall) % BOX;
          if (y < 0) y += BOX;
          y += cy - BOX * 0.35;
          a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z;
          a[i * 6 + 3] = x - 0.05; a[i * 6 + 4] = y - 0.9; a[i * 6 + 5] = z;
        }
      } else {
        const fall = time * system.speed;
        const windX = system.kind === 'dust' ? time * 14 : Math.sin(time * 0.3) * 2;
        for (let i = 0; i < system.n; i++) {
          const sway = Math.sin(time * 1.3 + i) * (system.kind === 'snow' ? 0.6 : 0.3);
          a[i * 3] = wrap(s[i * 3] + windX + sway, cx);
          let y = (s[i * 3 + 1] - fall) % (BOX * 0.6);
          if (y < 0) y += BOX * 0.6;
          a[i * 3 + 1] = y + cy - BOX * 0.25;
          a[i * 3 + 2] = wrap(s[i * 3 + 2] + sway, cz);
        }
      }
      system.obj.geometry.attributes.position.needsUpdate = true;
    }

    // Lightning: a brief blue-white flash of the ambient light.
    if (WEATHER[current].lightning) {
      nextStrike -= dt;
      if (nextStrike <= 0) {
        flash = 1;
        nextStrike = 5 + rand() * 12;
      }
    }
    if (flash > 0) {
      flash = Math.max(0, flash - dt * 3.5);
      const f = flash > 0.6 || (flash > 0.25 && flash < 0.4) ? flash : 0;
      sky.hemi.intensity = (sky.hemi.userData.base ?? (sky.hemi.userData.base = sky.hemi.intensity)) + f * 6;
      if (flash === 0) { sky.hemi.intensity = sky.hemi.userData.base; delete sky.hemi.userData.base; }
    }
  }

  return {
    set,
    update,
    get name() { return current; },
    get grip() { return WEATHER[current].grip; },
    get wet() { return WEATHER[current].wet; },
    // 0..1 brightness of the current lightning flash, for audio thunder cues.
    get flash() { return flash; },
    dispose() { clearSystem(); scene.remove(group); },
  };
}
