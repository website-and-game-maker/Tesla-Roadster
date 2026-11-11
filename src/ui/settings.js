// Settings store: defaults, persistence, and automatic graphics-tier detection.
const KEY = 'roadster.settings.v1';

export const QUALITY_PRESETS = {
  low:    { resolutionScale: 0.6,  shadows: false, shadowMapSize: 512,  postFx: false, drawDistance: 400,  particles: 0.3, reflections: false },
  medium: { resolutionScale: 0.8,  shadows: true,  shadowMapSize: 1024, postFx: false, drawDistance: 700,  particles: 0.6, reflections: false },
  high:   { resolutionScale: 1.0,  shadows: true,  shadowMapSize: 2048, postFx: true,  drawDistance: 1200, particles: 1.0, reflections: true },
  ultra:  { resolutionScale: 1.0,  shadows: true,  shadowMapSize: 4096, postFx: true,  drawDistance: 2000, particles: 1.0, reflections: true, pixelRatioCap: 2 },
};

export const DEFAULTS = {
  quality: 'auto',          // 'auto' | 'low' | 'medium' | 'high' | 'ultra'
  resolvedQuality: null,    // tier picked by auto detection
  resolutionScale: 1,
  shadows: true,
  fov: 70,
  showFps: false,
  masterVol: 0.8,
  musicVol: 0.6,
  sfxVol: 0.9,
  controls: 'auto',         // 'auto' | 'keyboard' | 'touch' | 'gamepad'
  tiltSteer: false,
  steerSensitivity: 1,
  units: 'kmh',             // 'kmh' | 'mph'
  camera: 'chase',          // 'chase' | 'hood' | 'cinematic'
  haptics: true,
  playerName: '',
  car: { color: 'pearl', wheels: 'turbine', interior: 'black' },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { ...structuredClone(DEFAULTS), ...s, car: { ...DEFAULTS.car, ...(s.car || {}) } };
    }
  } catch { /* storage blocked: fall through to defaults */ }
  return structuredClone(DEFAULTS);
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function isTouchDevice() {
  return (typeof window !== 'undefined') &&
    (('ontouchstart' in window) || navigator.maxTouchPoints > 0) &&
    matchMedia('(pointer: coarse)').matches;
}

// Guess a quality tier from the GPU string, core count, memory, and screen size.
// The engine should refine this at runtime with measureAndAdapt().
export function detectQuality() {
  let score = 2; // start at "high"
  let gpu = 'unknown';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { tier: 'low', gpu: 'no-webgl' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const g = String(gpu).toLowerCase();
    if (/rtx|radeon rx [5-9]|rx [67]\d{3}|apple m[1-9] (pro|max|ultra)|arc a7/.test(g)) score = 3;
    else if (/apple m[1-9]|apple gpu|gtx 1[0-9]{3}|rx 5[0-9]{2}|iris xe|adreno \(tm\) 7[3-9]\d/.test(g)) score = 2;
    else if (/intel|uhd|hd graphics|mali-g[5-7]\d|adreno \(tm\) 6\d\d|powervr/.test(g)) score = 1;
    if (/swiftshader|llvmpipe|software|basic render/.test(g)) score = 0;
    if (!c.getContext('webgl2')) score = Math.min(score, 1);
  } catch { score = 1; }
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  if (cores <= 4) score -= 0.5;
  if (mem <= 4) score -= 0.5;
  if (isTouchDevice()) score -= 0.5;
  const tiers = ['low', 'medium', 'high', 'ultra'];
  const tier = tiers[Math.max(0, Math.min(3, Math.round(score)))];
  return { tier, gpu, cores, mem };
}

// Effective graphics options for the engine, given current settings.
export function resolveGraphics(s) {
  const tier = s.quality === 'auto' ? (s.resolvedQuality || detectQuality().tier) : s.quality;
  const preset = QUALITY_PRESETS[tier];
  return {
    tier,
    ...preset,
    resolutionScale: s.quality === 'auto' ? preset.resolutionScale : s.resolutionScale,
    shadows: s.quality === 'auto' ? preset.shadows : s.shadows,
    fov: s.fov,
  };
}

// Frame-time watchdog for 'auto' mode: call tick(dtSeconds) each frame;
// it calls onChange(newTier) when sustained FPS is too low or comfortably high.
export function createAdaptiveQuality(startTier, onChange) {
  const tiers = ['low', 'medium', 'high', 'ultra'];
  let idx = tiers.indexOf(startTier);
  let ceiling = tiers.length - 1; // a tier that ever ran too slow is never retried
  let acc = 0, frames = 0, cooldown = 3;
  return {
    get tier() { return tiers[idx]; },
    tick(dt) {
      acc += dt; frames++;
      if (acc < 2) return;
      const fps = frames / acc; acc = 0; frames = 0;
      if (cooldown > 0) { cooldown--; return; }
      if (fps < 40 && idx > 0) {
        ceiling = idx - 1; idx--; cooldown = 2; onChange(tiers[idx], fps);
      } else if (fps > 58 && idx < ceiling) {
        idx++; cooldown = 4; onChange(tiers[idx], fps);
      }
    },
  };
}
