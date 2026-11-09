// Procedural textures painted on canvases at load time. No image downloads,
// so worlds load instantly on GitHub Pages and on slow mobile networks.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Periodic value noise so the texture tiles without seams.
function tileableNoise(size, seed, octaves = 5, baseCells = 8) {
  const rand = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const y1 = (y0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const x1 = (x0 + 1) % cells;
        const a = grid[y0 * cells + x0];
        const b = grid[y0 * cells + x1];
        const c = grid[y1 * cells + x0];
        const d = grid[y1 * cells + x1];
        out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function finish(c, { repeat = true, anisotropy = 4, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// Grey detail texture that multiplies terrain vertex colours, adding grit
// and micro variation up close.
export function detailTexture(size, anisotropy, seed = 7) {
  return memo(`detail-${size}-${seed}`, () => {
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const n = tileableNoise(size, seed, 6, 4);
    const rand = mulberry32(seed + 1);
    for (let i = 0; i < size * size; i++) {
      const grain = (rand() - 0.5) * 0.18;
      const v = Math.max(0, Math.min(1, 0.72 + (n[i] - 0.5) * 0.55 + grain)) * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finish(c, { anisotropy, srgb: false });
  });
}

// Road surface. u runs across the road (0 = left edge, 1 = right edge),
// v runs along it; one texture repeat covers `period` metres of road.
// style: 'highway' | 'race' | 'city' | 'mountain' | 'dirt' | 'regolith'
export function roadTexture(style, size, anisotropy) {
  return memo(`road-${style}-${size}`, () => {
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const base = tileableNoise(size, 101, 6, 6);
    const rand = mulberry32(55);
    const dirt = style === 'dirt' || style === 'regolith';
    const palette = {
      highway: [58, 60, 63],
      race: [52, 53, 56],
      city: [46, 47, 50],
      mountain: [64, 64, 66],
      dirt: [150, 120, 88],
      regolith: [150, 82, 52],
    }[style] || [58, 60, 63];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const u = x / size;
        // Tyre wear: two darker, smoother bands where wheels run.
        const wear = Math.exp(-(((u - 0.3) / 0.07) ** 2)) + Math.exp(-(((u - 0.7) / 0.07) ** 2));
        const speck = rand() < 0.08 ? (rand() - 0.3) * 60 : 0;
        let k = 0.8 + (base[i] - 0.5) * (dirt ? 0.7 : 0.35) - wear * (dirt ? 0.12 : 0.08);
        if (dirt) {
          // Rutted wheel tracks on unpaved surfaces.
          k -= wear * 0.1 * (0.6 + 0.4 * Math.sin(y * 0.9 + base[i] * 8));
        }
        img.data[i * 4] = Math.max(0, Math.min(255, palette[0] * k + speck));
        img.data[i * 4 + 1] = Math.max(0, Math.min(255, palette[1] * k + speck));
        img.data[i * 4 + 2] = Math.max(0, Math.min(255, palette[2] * k + speck));
        img.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Fine cracks and patch repairs on public roads.
    if (!dirt && style !== 'race') {
      ctx.strokeStyle = 'rgba(20,20,22,0.35)';
      ctx.lineWidth = Math.max(1, size / 512);
      for (let k = 0; k < 14; k++) {
        let px = rand() * size;
        let py = rand() * size;
        ctx.beginPath();
        ctx.moveTo(px, py);
        for (let s = 0; s < 8; s++) {
          px += (rand() - 0.5) * size * 0.06;
          py += (rand() - 0.2) * size * 0.06;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(30,30,32,0.25)';
      for (let k = 0; k < 3; k++) {
        ctx.fillRect(rand() * size * 0.8, rand() * size, size * (0.08 + rand() * 0.12), size * (0.05 + rand() * 0.1));
      }
    }

    // Lane markings, painted slightly rough.
    const line = (u0, width, color, dash) => {
      ctx.fillStyle = color;
      const x0 = u0 * size;
      const w = width * size;
      if (!dash) {
        ctx.fillRect(x0 - w / 2, 0, w, size);
      } else {
        ctx.fillRect(x0 - w / 2, 0, w, size * dash);
      }
    };
    const s = size;
    if (style === 'highway') {
      line(0.04, 0.012, 'rgba(235,235,225,0.9)');
      line(0.96, 0.012, 'rgba(235,235,225,0.9)');
      line(0.49, 0.009, 'rgba(230,180,40,0.9)');
      line(0.51, 0.009, 'rgba(230,180,40,0.9)');
    } else if (style === 'race') {
      line(0.025, 0.014, 'rgba(240,240,240,0.92)');
      line(0.975, 0.014, 'rgba(240,240,240,0.92)');
    } else if (style === 'city') {
      line(0.03, 0.01, 'rgba(225,225,220,0.85)');
      line(0.97, 0.01, 'rgba(225,225,220,0.85)');
      line(0.5, 0.01, 'rgba(225,225,220,0.85)', 0.33);
    } else if (style === 'mountain') {
      line(0.04, 0.012, 'rgba(235,235,225,0.85)');
      line(0.96, 0.012, 'rgba(235,235,225,0.85)');
      line(0.5, 0.01, 'rgba(235,235,225,0.85)', 0.4);
    }
    // Speckle over the paint so it reads as worn, not vector-perfect.
    const paint = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < s * s; i++) {
      if (rand() < 0.06) {
        const d = 0.8 + rand() * 0.2;
        paint.data[i * 4] *= d;
        paint.data[i * 4 + 1] *= d;
        paint.data[i * 4 + 2] *= d;
      }
    }
    ctx.putImageData(paint, 0, 0);
    return finish(c, { anisotropy });
  });
}

// Roughness map paired with the road: tyre-polished bands are smoother,
// which makes them glint when the road is wet.
export function roadRoughness(size, anisotropy) {
  return memo(`road-rough-${size}`, () => {
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const n = tileableNoise(size, 303, 5, 8);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const u = x / size;
        const wear = Math.exp(-(((u - 0.3) / 0.07) ** 2)) + Math.exp(-(((u - 0.7) / 0.07) ** 2));
        const v = (0.85 - wear * 0.2 + (n[i] - 0.5) * 0.3) * 255;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c, { anisotropy, srgb: false });
  });
}

// Red and white racing kerb stripes.
export function kerbTexture(colors = ['#d8262b', '#f2f2f2']) {
  return memo(`kerb-${colors.join()}`, () => {
    const c = canvas(64, 128);
    const ctx = c.getContext('2d');
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = colors[1];
    ctx.fillRect(0, 64, 64, 64);
    return finish(c, { anisotropy: 4 });
  });
}

// Building facade: a grid of windows, some lit. Returns colour and an
// emissive map so lit windows glow at night.
export function facadeTextures(seed = 3) {
  return memo(`facade-${seed}`, () => {
    const size = 256;
    const col = canvas(size);
    const emi = canvas(size);
    const a = col.getContext('2d');
    const b = emi.getContext('2d');
    const rand = mulberry32(seed);
    a.fillStyle = '#6b6e74';
    a.fillRect(0, 0, size, size);
    b.fillStyle = '#000';
    b.fillRect(0, 0, size, size);
    const cols = 8;
    const rows = 16;
    const cw = size / cols;
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const x = k * cw + cw * 0.15;
        const y = r * rh + rh * 0.18;
        const w = cw * 0.7;
        const h = rh * 0.62;
        const glass = 30 + rand() * 30;
        a.fillStyle = `rgb(${glass},${glass + 8},${glass + 18})`;
        a.fillRect(x, y, w, h);
        if (rand() < 0.38) {
          const warm = rand() < 0.75;
          const l = 0.55 + rand() * 0.45;
          b.fillStyle = warm
            ? `rgba(255,${190 + rand() * 40},${120 + rand() * 50},${l})`
            : `rgba(${150 + rand() * 60},${200 + rand() * 40},255,${l})`;
          b.fillRect(x, y, w, h);
        }
      }
    }
    return { map: finish(col, { anisotropy: 4 }), emissiveMap: finish(emi, { anisotropy: 4 }) };
  });
}

// Soft round sprite used for snow, dust and stars.
export function softDot() {
  return memo('soft-dot', () => {
    const c = canvas(64);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return finish(c, { repeat: false, srgb: true });
  });
}

// Bold text panel for trackside signs and the start gantry.
export function signTexture(text, { bg = '#111', fg = '#fff', accent = '#e31937', w = 512, h = 128 } = {}) {
  return memo(`sign-${text}-${bg}-${fg}-${accent}`, () => {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, h - h * 0.1, w, h * 0.1);
    ctx.fillStyle = fg;
    ctx.font = `bold ${Math.floor(h * 0.5)}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h * 0.46);
    return finish(c, { repeat: false, anisotropy: 4 });
  });
}

export function disposeTextureCache() {
  for (const v of cache.values()) {
    if (v && v.dispose) v.dispose();
    else if (v) for (const t of Object.values(v)) t.dispose && t.dispose();
  }
  cache.clear();
}
