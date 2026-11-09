// Sky, sun, ambient light, stars, fog and environment reflections, all
// driven by one time-of-day value (0..24 h) and the world's atmosphere type.
import * as THREE from 'three';
import { mulberry32, clamp, smoothstep } from './noise.js';
import { softDot } from './textures.js';

const C = (hex) => new THREE.Color(hex);

// Atmosphere palettes keyed by sun elevation in degrees. Values between keys
// are interpolated, so dawn and dusk blend smoothly.
const ATMOSPHERES = {
  earth: [
    { el: -18, zenith: C(0x02040b), horizon: C(0x0a1222), sun: C(0x8aa4ff), sunI: 0.18, hemiI: 0.22, fog: C(0x0b1220) },
    { el: -6, zenith: C(0x0b1530), horizon: C(0x3a3352), sun: C(0x9db0ff), sunI: 0.2, hemiI: 0.3, fog: C(0x2b2a40) },
    { el: 0, zenith: C(0x23386a), horizon: C(0xf08a4b), sun: C(0xff8a3c), sunI: 1.1, hemiI: 0.55, fog: C(0xc98a68) },
    { el: 8, zenith: C(0x3463a8), horizon: C(0xf6c08c), sun: C(0xffc387), sunI: 2.4, hemiI: 0.8, fog: C(0xd9b89b) },
    { el: 25, zenith: C(0x2f6fc4), horizon: C(0xb9d4ec), sun: C(0xfff1dc), sunI: 3.2, hemiI: 1.0, fog: C(0xb6cbe0) },
    { el: 90, zenith: C(0x1f5fbf), horizon: C(0xa9c9ea), sun: C(0xffffff), sunI: 3.6, hemiI: 1.1, fog: C(0xaec6e2) },
  ],
  // Mars: butterscotch days, blue sunsets (fine dust scatters blue forward).
  mars: [
    { el: -18, zenith: C(0x030203), horizon: C(0x120c0b), sun: C(0x7f8fb0), sunI: 0.12, hemiI: 0.16, fog: C(0x150e0c) },
    { el: -5, zenith: C(0x15100f), horizon: C(0x2d3b55), sun: C(0x8ea6d0), sunI: 0.2, hemiI: 0.25, fog: C(0x2a2a33) },
    { el: 2, zenith: C(0x4a3022), horizon: C(0x6f8fb8), sun: C(0xcfe0ff), sunI: 1.2, hemiI: 0.5, fog: C(0x7a6a62) },
    { el: 12, zenith: C(0x8a5a3c), horizon: C(0xd09a6a), sun: C(0xfff0dc), sunI: 2.2, hemiI: 0.75, fog: C(0xc48d64) },
    { el: 90, zenith: C(0x9a6a48), horizon: C(0xdcae80), sun: C(0xfff4e6), sunI: 2.6, hemiI: 0.85, fog: C(0xd0a077) },
  ],
  // Airless: black sky, harsh sun, no fog to speak of.
  space: [
    { el: -18, zenith: C(0x000000), horizon: C(0x010103), sun: C(0x9fb4ff), sunI: 0.35, hemiI: 0.12, fog: C(0x020203) },
    { el: 0, zenith: C(0x000000), horizon: C(0x020206), sun: C(0xffffff), sunI: 3.2, hemiI: 0.15, fog: C(0x030305) },
    { el: 90, zenith: C(0x000000), horizon: C(0x020206), sun: C(0xffffff), sunI: 4.2, hemiI: 0.18, fog: C(0x030305) },
  ],
};

function samplePalette(list, el, out) {
  let a = list[0];
  let b = list[list.length - 1];
  for (let i = 0; i < list.length - 1; i++) {
    if (el >= list[i].el && el <= list[i + 1].el) { a = list[i]; b = list[i + 1]; break; }
  }
  if (el < list[0].el) b = a;
  if (el > b.el) a = b;
  const t = a === b ? 0 : clamp((el - a.el) / (b.el - a.el), 0, 1);
  out.zenith.copy(a.zenith).lerp(b.zenith, t);
  out.horizon.copy(a.horizon).lerp(b.horizon, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  out.sunI = a.sunI + (b.sunI - a.sunI) * t;
  out.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
  return out;
}

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;

const skyFrag = /* glsl */`
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float sunSize;
uniform float glow;
uniform float haze;
uniform float overcast;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(horizon, zenith, up);
  // Below the horizon fade to a ground haze so the far edge never shows.
  col = mix(col, ground, 1.0 - smoothstep(-0.25, 0.0, h));
  float s = max(dot(d, sunDir), 0.0);
  // Forward scattering around the sun, stronger near the horizon.
  col += sunColor * glow * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 0.6) * (1.0 - overcast * 0.8);
  col += sunColor * haze * pow(1.0 - abs(h), 6.0) * pow(s, 2.0) * 0.4;
  // Sun disc.
  float disc = smoothstep(cos(sunSize), cos(sunSize * 0.8), s);
  col += sunColor * disc * 25.0 * (1.0 - overcast) * step(-0.02, sunDir.y + 0.03);
  // Overcast: flatten towards grey cloud deck.
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum) * vec3(0.92, 0.95, 1.0), overcast * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(def, scene, renderer, quality) {
  const atmosphere = ATMOSPHERES[def.atmosphere || 'earth'];
  const group = new THREE.Group();
  group.name = 'sky';

  const uniforms = {
    zenith: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    ground: { value: new THREE.Color() },
    sunColor: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunSize: { value: def.sunSize ?? 0.012 },
    glow: { value: def.atmosphere === 'space' ? 0.15 : 1 },
    haze: { value: def.atmosphere === 'space' ? 0 : 1 },
    overcast: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  dome.scale.setScalar(5000);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  // Stars, faded in at night (always visible in airless worlds).
  const rand = mulberry32(def.seed + 999);
  const starCount = quality.particles > 1000 ? 2600 : 900;
  const sp = new Float32Array(starCount * 3);
  const sc = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    sp[i * 3] = r * Math.cos(th) * 400;
    sp[i * 3 + 1] = Math.abs(u) * 400 - 20;
    sp[i * 3 + 2] = r * Math.sin(th) * 400;
    const tint = rand();
    const b = 0.5 + rand() * 0.5;
    sc[i * 3] = b * (tint < 0.2 ? 0.8 : 1);
    sc[i * 3 + 1] = b * 0.95;
    sc[i * 3 + 2] = b * (tint > 0.8 ? 0.8 : 1);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const starMat = new THREE.PointsMaterial({
    size: 2.2,
    map: softDot(),
    vertexColors: true,
    transparent: false,
    depthWrite: false,
    depthTest: false,
    fog: false,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  group.add(stars);

  // A celestial body hanging in the sky: the Moon on Earth, Earth on the Moon.
  let body = null;
  if (def.skyBody) {
    body = makeSkyBody(def.skyBody);
    group.add(body);
  }

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.name = 'sun';
  sun.castShadow = quality.shadows;
  if (quality.shadows) {
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const r = quality.shadowRange;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 800 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.camera.updateProjectionMatrix();
  }
  const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5a4a3a, 1);
  hemi.name = 'ambient';
  scene.add(sun, sun.target, hemi);

  scene.fog = new THREE.FogExp2(0xffffff, def.fogDensity ?? 0.0012);

  const pal = { zenith: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), fog: new THREE.Color(), sunI: 1, hemiI: 1 };
  const sunDir = new THREE.Vector3();
  let weatherFog = 1;
  let weatherDim = 1;
  let overcast = 0;
  let lastEnvHour = -99;
  let pmrem = null;
  let envRT = null;
  const envScene = new THREE.Scene();
  const envDome = new THREE.Mesh(dome.geometry, dome.material);
  envDome.scale.setScalar(100);
  envScene.add(envDome);

  const state = { hour: def.defaultTime ?? 12 };

  function setTime(hour) {
    state.hour = ((hour % 24) + 24) % 24;
    // Sun sweeps east (+x) -> south -> west over the day, tilted by latitude.
    const ang = ((state.hour - 6) / 12) * Math.PI;
    const tilt = THREE.MathUtils.degToRad(def.sunTilt ?? 35);
    sunDir.set(Math.cos(ang), Math.sin(ang) * Math.cos(tilt), Math.sin(ang) * Math.sin(tilt) * 0.6 + 0.25);
    sunDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(def.sunAzimuth ?? 0));
    sunDir.normalize();
    const el = THREE.MathUtils.radToDeg(Math.asin(sunDir.y));
    samplePalette(atmosphere, el, pal);
    apply(el);
  }

  function apply(el) {
    uniforms.zenith.value.copy(pal.zenith).multiplyScalar(weatherDim);
    uniforms.horizon.value.copy(pal.horizon).multiplyScalar(weatherDim);
    uniforms.ground.value.copy(pal.fog).multiplyScalar(0.7 * weatherDim);
    uniforms.sunColor.value.copy(pal.sun);
    uniforms.sunDir.value.copy(sunDir);
    uniforms.overcast.value = overcast;

    // Below the horizon the "sun" light becomes moonlight from the opposite side.
    const night = el < -4;
    const dir = night ? sunDir.clone().multiplyScalar(-1).setY(Math.abs(sunDir.y) * 0.8 + 0.35).normalize() : sunDir;
    sun.userData.dir = dir.clone();
    sun.color.copy(night ? C(0x9fb4ff) : pal.sun);
    sun.intensity = (night ? (def.atmosphere === 'space' ? 0.6 : 0.25) : pal.sunI) * (1 - overcast * 0.75);
    hemi.color.copy(pal.zenith).lerp(C(0xffffff), 0.35);
    hemi.groundColor.copy(def.groundBounce ? C(def.groundBounce) : pal.fog).multiplyScalar(0.6);
    hemi.intensity = pal.hemiI * (1 - overcast * 0.3) * (def.ambientScale ?? 1);

    scene.fog.color.copy(pal.fog).multiplyScalar(weatherDim);
    scene.fog.density = (def.fogDensity ?? 0.0012) * weatherFog;

    const nightAmt = def.atmosphere === 'space' ? 1 : 1 - smoothstep(-12, 2, el);
    starMat.opacity = nightAmt * (1 - overcast);
    stars.visible = starMat.opacity > 0.01;
    state.night = 1 - smoothstep(-8, 4, el);
    if (body) {
      const bdir = def.skyBody.fixed ? new THREE.Vector3(...def.skyBody.fixed).normalize() : sunDir.clone().multiplyScalar(-1).setY(Math.abs(sunDir.y) * 0.6 + 0.25).normalize();
      body.position.copy(bdir).multiplyScalar(400);
      body.lookAt(0, 0, 0);
      body.visible = def.skyBody.fixed ? true : nightAmt > 0.05;
      if (overcast > 0.6) body.visible = false;
    }
    if (scene.background !== null && !(scene.background instanceof THREE.Texture)) scene.background = null;
  }

  function updateEnv(force) {
    if (!quality.envMap || !renderer) return;
    if (!force && Math.abs(state.hour - lastEnvHour) < 0.25) return;
    lastEnvHour = state.hour;
    if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
    const old = envRT;
    envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);
    scene.environment = envRT.texture;
    if (old) old.dispose();
  }

  setTime(state.hour);

  return {
    group,
    sun,
    hemi,
    state,
    setTime(h) { setTime(h); updateEnv(false); },
    setWeatherLook({ fog = 1, dim = 1, cloud = 0 }) {
      weatherFog = fog;
      weatherDim = dim;
      overcast = cloud;
      setTime(state.hour);
      updateEnv(true);
    },
    updateEnv,
    // Keep the dome and the shadow box centred on the camera / car.
    update(dt, focus, camera) {
      if (camera) group.position.copy(camera.position);
      else if (focus) group.position.copy(focus);
      if (focus) {
        const dir = sun.userData.dir || sunDir;
        // Snap to shadow texels to stop shimmering as the car moves.
        const r = quality.shadowRange;
        const texel = (r * 2) / (quality.shadowMapSize || 1024);
        const fx = Math.round(focus.x / texel) * texel;
        const fz = Math.round(focus.z / texel) * texel;
        sun.target.position.set(fx, focus.y, fz);
        sun.position.set(fx + dir.x * 300, focus.y + dir.y * 300, fz + dir.z * 300);
      }
    },
    dispose() {
      dome.geometry.dispose();
      dome.material.dispose();
      starGeo.dispose();
      starMat.dispose();
      if (body) { body.geometry.dispose(); body.material.dispose(); }
      if (envRT) envRT.dispose();
      if (pmrem) pmrem.dispose();
      scene.remove(sun, sun.target, hemi);
      sun.dispose && sun.dispose();
      if (scene.environment === envRT?.texture) scene.environment = null;
      scene.fog = null;
    },
  };
}

function makeSkyBody({ kind, size = 24 }) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const rand = mulberry32(kind === 'earth' ? 3 : 9);
  ctx.clearRect(0, 0, 256, 256);
  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.clip();
  if (kind === 'earth') {
    ctx.fillStyle = '#1b4f9c';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#3f7a3a';
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      ctx.ellipse(rand() * 256, rand() * 256, 10 + rand() * 40, 6 + rand() * 25, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      ctx.ellipse(rand() * 256, rand() * 256, 6 + rand() * 30, 2 + rand() * 6, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Terminator: half lit.
    const g = ctx.createLinearGradient(40, 0, 230, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  } else {
    ctx.fillStyle = '#d9d6cc';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(120,118,112,0.45)';
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.arc(rand() * 256, rand() * 256, 4 + rand() * 26, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  // Atmospheric rim.
  if (kind === 'earth') {
    ctx.strokeStyle = 'rgba(120,180,255,0.7)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(128, 128, 121, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, depthWrite: false, depthTest: false, fog: false, toneMapped: false }),
  );
  m.renderOrder = -8;
  m.frustumCulled = false;
  return m;
}
