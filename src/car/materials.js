// Paints, wheel finishes and the PBR materials for one car.
// Every car gets its own material set (the game spawns several cars with
// different paints), but generated textures are cached and shared.

import * as THREE from 'three';

/** Selectable paints. `unlock` is a hint for the progression system. */
export const PAINTS = [
  { id: 'pearlWhite', name: 'Pearl White Multi-Coat', color: 0xf2f2ef, metalness: 0.15, roughness: 0.32, clearcoat: 1, iridescence: 0.35 },
  { id: 'solidBlack', name: 'Solid Black', color: 0x0b0c0e, metalness: 0.0, roughness: 0.3, clearcoat: 1 },
  { id: 'midnightSilver', name: 'Midnight Silver', color: 0x45484d, metalness: 0.75, roughness: 0.38, clearcoat: 1 },
  { id: 'deepBlue', name: 'Deep Blue Metallic', color: 0x0f2a63, metalness: 0.7, roughness: 0.35, clearcoat: 1 },
  { id: 'ultraRed', name: 'Ultra Red', color: 0xa3070f, metalness: 0.45, roughness: 0.3, clearcoat: 1 },
  { id: 'quicksilver', name: 'Quicksilver', color: 0xb9bcc0, metalness: 0.9, roughness: 0.25, clearcoat: 1 },
  { id: 'stealthMatte', name: 'Stealth Matte Grey', color: 0x2c2f33, metalness: 0.3, roughness: 0.62, clearcoat: 0 },
  { id: 'voltLime', name: 'Volt Lime', color: 0x9bd40f, metalness: 0.35, roughness: 0.3, clearcoat: 1, unlock: 'level5' },
  { id: 'sunsetOrange', name: 'Sunset Orange', color: 0xe0530f, metalness: 0.5, roughness: 0.3, clearcoat: 1, unlock: 'level10' },
  { id: 'nebulaPurple', name: 'Nebula Purple', color: 0x3c1466, metalness: 0.8, roughness: 0.3, clearcoat: 1, iridescence: 1, unlock: 'level15' },
  { id: 'liquidGold', name: 'Liquid Gold', color: 0xd4a43a, metalness: 1, roughness: 0.16, clearcoat: 1, unlock: 'level25' },
  { id: 'mirrorChrome', name: 'Mirror Chrome', color: 0xe8e8ea, metalness: 1, roughness: 0.04, clearcoat: 1, unlock: 'level40' },
];

/** Wheel styles × finishes. */
export const WHEELS = [
  { id: 'aeroSilver', name: 'Aero Turbine, Silver', style: 'aero', color: 0xc9ccd0, metalness: 1, roughness: 0.28 },
  { id: 'aeroBlack', name: 'Aero Turbine, Gloss Black', style: 'aero', color: 0x111214, metalness: 0.6, roughness: 0.2 },
  { id: 'sportGunmetal', name: 'Sport 10-Spoke, Gunmetal', style: 'sport', color: 0x3a3d42, metalness: 1, roughness: 0.32 },
  { id: 'sportSilver', name: 'Sport 10-Spoke, Silver', style: 'sport', color: 0xd0d3d6, metalness: 1, roughness: 0.22 },
  { id: 'bladeBlack', name: 'Blade 14-Spoke, Satin Black', style: 'blade', color: 0x18191b, metalness: 0.5, roughness: 0.5, unlock: 'level8' },
  { id: 'bladeGold', name: 'Blade 14-Spoke, Bronze', style: 'blade', color: 0x9a7440, metalness: 1, roughness: 0.3, unlock: 'level20' },
];

export const CALIPERS = { red: 0xc0121c, black: 0x151515, yellow: 0xe5b50c, blue: 0x1846c4 };

const byId = (list, id) => list.find((p) => p.id === id) || list[0];
export const getPaint = (id) => byId(PAINTS, id);
export const getWheel = (id) => byId(WHEELS, id);

// ------------------------------------------------------------ textures
let tireNormal = null;
/** Tire tread normal map, drawn once on a canvas. U = around the tire. */
function tireNormalMap() {
  if (tireNormal || typeof document === 'undefined') return tireNormal;
  const W = 512, H = 64;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, W, H);
  // Circumferential grooves (running around the tire) across the tread band.
  const groove = (v) => {
    const y = v * H;
    g.fillStyle = 'rgb(128,60,200)'; g.fillRect(0, y - 2, W, 2);
    g.fillStyle = 'rgb(128,196,200)'; g.fillRect(0, y, W, 2);
  };
  [0.38, 0.5, 0.62].forEach(groove);
  // Angled lateral sipes on the shoulders.
  for (let x = 0; x < W; x += 16) {
    for (const [v0, v1] of [[0.25, 0.36], [0.64, 0.75]]) {
      g.strokeStyle = 'rgb(70,128,200)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, v0 * H); g.lineTo(x + 5, v1 * H); g.stroke();
      g.strokeStyle = 'rgb(186,128,200)';
      g.beginPath(); g.moveTo(x + 2, v0 * H); g.lineTo(x + 7, v1 * H); g.stroke();
    }
  }
  tireNormal = new THREE.CanvasTexture(cv);
  tireNormal.wrapS = THREE.RepeatWrapping;
  tireNormal.repeat.set(6, 1);
  return tireNormal;
}

let flakeTex = null;
/**
 * Metallic-flake normal map: fine random speckle. Under a smooth clearcoat it
 * gives the paint a subtle sparkle that changes as the car turns.
 */
function flakeNormalMap() {
  if (flakeTex || typeof document === 'undefined') return flakeTex;
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N * N; i++) {
    img.data[i * 4] = 128 + (rnd() - 0.5) * 150;
    img.data[i * 4 + 1] = 128 + (rnd() - 0.5) * 150;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  flakeTex = new THREE.CanvasTexture(cv);
  flakeTex.wrapS = flakeTex.wrapT = THREE.RepeatWrapping;
  flakeTex.repeat.set(14, 14);
  return flakeTex;
}

let blobTex = null;
/** Soft radial shadow used under the car when real shadows are off. */
export function contactShadowTexture() {
  if (blobTex || typeof document === 'undefined') return blobTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(cv);
  return blobTex;
}

// ------------------------------------------------------------ materials
/**
 * Lets the paint discard fragments where the per-vertex `cut` distance is
 * negative, which is how the wheel arches are opened in the body shell.
 * Every geometry drawn with the paint needs a `cut` attribute (≥ 0 = keep).
 */
function addArchCut(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float cut;\nvarying float vCut;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCut = cut;');
    sh.fragmentShader = 'varying float vCut;\n'
      + sh.fragmentShader.replace('void main() {', 'void main() {\nif (vCut < 0.0) discard;');
  };
  mat.customProgramCacheKey = () => 'roadster-arch-cut';
}

/** Applies a paint definition to an existing physical material. */
export function applyPaint(mat, paint) {
  mat.color.setHex(paint.color);
  mat.metalness = paint.metalness;
  mat.roughness = paint.roughness;
  if (mat.isMeshPhysicalMaterial) {
    mat.clearcoat = paint.clearcoat ?? 1;
    mat.clearcoatRoughness = 0.04;
    mat.iridescence = paint.iridescence ?? 0;
    mat.iridescenceIOR = 1.5;
    // Flakes only show in metallic paints; solid and matte stay clean.
    const flake = paint.metalness > 0.3 ? 0.06 + paint.metalness * 0.1 : 0;
    mat.normalMap = flake > 0 ? flakeNormalMap() : null;
    mat.normalScale.set(flake, flake);
    mat.sheen = paint.sheen ?? 0;
  }
  mat.needsUpdate = true;
}

export function applyWheelFinish(mat, wheel) {
  mat.color.setHex(wheel.color);
  mat.metalness = wheel.metalness;
  mat.roughness = wheel.roughness;
}

/**
 * One car's materials. `quality` low swaps physical for standard materials
 * (no clearcoat pass) to save GPU time.
 */
export function createMaterials(quality, paintId, wheelId, caliper = 'red') {
  const hi = quality !== 'low';
  const Phys = hi ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const paint = new Phys({ vertexColors: true });
  applyPaint(paint, getPaint(paintId));
  addArchCut(paint);

  const rim = new THREE.MeshStandardMaterial();
  applyWheelFinish(rim, getWheel(wheelId));

  const m = {
    paint,
    rim,
    glass: new Phys({
      color: 0x070b10, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.68,
      ...(hi ? { clearcoat: 1, clearcoatRoughness: 0.01 } : {}), envMapIntensity: 2.2,
    }),
    gloss: new Phys({ color: 0x050506, metalness: 0.2, roughness: 0.18, ...(hi ? { clearcoat: 1 } : {}) }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0.1, roughness: 0.6 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.8 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.7 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.08 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.4, roughness: 0.35, normalMap: hi ? flakeNormalMap() : null, normalScale: new THREE.Vector2(0.3, 0.3) }),
    lug: new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 1, roughness: 0.25 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, normalMap: hi ? tireNormalMap() : null }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.9, roughness: 0.45 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6d6e70, metalness: 0.95, roughness: 0.38 }),
    caliper: new THREE.MeshStandardMaterial({ color: CALIPERS[caliper] ?? CALIPERS.red, roughness: 0.35, metalness: 0.2 }),
    well: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, side: THREE.DoubleSide }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf2ff, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.3 }),
    bezel: new THREE.MeshStandardMaterial({ color: 0x0d0e10, metalness: 0.8, roughness: 0.25 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1418, emissiveIntensity: 0.9, roughness: 0.2 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 }),
    // Flight hardware (rocket model).
    thrusterGlow: new THREE.MeshStandardMaterial({ color: 0x0a1a24, emissive: 0x5cd0ff, emissiveIntensity: 0.4, roughness: 0.3 }),
    flameOuter: new THREE.MeshBasicMaterial({
      color: 0x3a9cff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
    flameCore: new THREE.MeshBasicMaterial({
      color: 0xe8f6ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
    shadow: new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }),
  };
  return m;
}
