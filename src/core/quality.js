// Adaptive graphics quality.
// 1) detectTier(): a first guess from the GPU name, CPU cores, memory and device type.
// 2) QualityManager.frame(): watches real frame times while playing and moves the render
//    resolution (and, if needed, the whole preset) down when the device struggles and back
//    up when it has headroom. Settings that need a scene rebuild (scenery density) are read
//    at the start of each race; resolution, shadows and draw distance change live.

export const ORDER = ['low', 'medium', 'high', 'ultra'];

export const PRESETS = {
  low:    { id: 'low',    name: 'Low',    maxPixelRatio: 1,    shadows: false, shadowSize: 512,  density: 0.35, drawDist: 600,  carDetail: 'low',    particles: 0.4, trails: false, reflections: false },
  medium: { id: 'medium', name: 'Medium', maxPixelRatio: 1.25, shadows: true,  shadowSize: 1024, density: 0.65, drawDist: 900,  carDetail: 'medium', particles: 0.7, trails: true,  reflections: true },
  high:   { id: 'high',   name: 'High',   maxPixelRatio: 1.75, shadows: true,  shadowSize: 2048, density: 1.0,  drawDist: 1300, carDetail: 'high',   particles: 1.0, trails: true,  reflections: true },
  ultra:  { id: 'ultra',  name: 'Ultra',  maxPixelRatio: 2.5,  shadows: true,  shadowSize: 4096, density: 1.4,  drawDist: 1800, carDetail: 'high',   particles: 1.3, trails: true,  reflections: true },
};

export function detectTier(renderer) {
  let gpu = 'unknown';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) { /* ignore */ }
  const g = String(gpu).toLowerCase();
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent));
  const reasons = [];
  let score = 2; // index into ORDER

  if (/swiftshader|llvmpipe|software|microsoft basic/.test(g)) { score = 0; reasons.push('software renderer'); }
  else if (/rtx|radeon rx [67]\d{3}|rx 7\d{3}|apple m[2-9] (pro|max|ultra)|arc a7/.test(g)) { score = 3; reasons.push('high-end GPU'); }
  else if (/geforce|radeon|apple m\d|arc /.test(g)) { score = 2; reasons.push('dedicated / Apple GPU'); }
  else if (/iris xe|adreno.*(7\d\d|8\d\d)|apple gpu|mali-g7\d\d|immortalis/.test(g)) { score = mobile ? 1 : 2; reasons.push('modern integrated / mobile GPU'); }
  else if (/intel|mali|adreno|powervr|videocore/.test(g)) { score = 1; reasons.push('integrated / older mobile GPU'); }

  if (mobile && score > 1) { score = 1; reasons.push('mobile device'); }
  if (cores <= 2 || mem <= 2) { score = Math.max(0, score - 1); reasons.push('few CPU cores / low memory'); }
  return { tier: ORDER[score], gpu: String(gpu), mobile, cores, mem, reasons };
}

export class QualityManager {
  constructor(renderer, mode = 'auto') {
    this.renderer = renderer;
    this.detected = detectTier(renderer);
    this.mode = mode;                 // 'auto' or a preset id
    this.autoTier = ORDER.indexOf(this.detected.tier);
    this.ceiling = 3;                 // highest tier allowed after a downgrade
    this.resScale = 1;                // dynamic resolution multiplier (0.55..1)
    this.listeners = [];
    this._acc = 0; this._frames = 0; this._low = 0; this._high = 0; this._cool = 0;
    this.fps = 60;
  }

  get tierId() { return this.mode === 'auto' ? ORDER[this.autoTier] : this.mode; }
  get preset() { return PRESETS[this.tierId]; }

  onChange(fn) { this.listeners.push(fn); }
  _emit() { this.apply(); for (const f of this.listeners) f(this.preset); }

  setMode(mode) {
    this.mode = mode;
    this.resScale = 1;
    this._emit();
  }

  pixelRatio() {
    const p = this.preset;
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, p.maxPixelRatio) * this.resScale);
  }

  apply() {
    const r = this.renderer;
    r.setPixelRatio(this.pixelRatio());
    r.setSize(window.innerWidth, window.innerHeight, false);
  }

  /** Feed every frame with the real elapsed time (seconds). Only adapts while `active`. */
  frame(dt, active) {
    if (dt > 0.25) return; // tab switch / hitch: ignore
    this._acc += dt; this._frames++;
    if (this._acc < 1) return;
    this.fps = this._frames / this._acc;
    this._acc = 0; this._frames = 0;
    if (!active || this.mode !== 'auto') return;
    if (this._cool > 0) { this._cool--; return; }

    if (this.fps < 47) { this._low++; this._high = 0; } else if (this.fps > 57) { this._high++; this._low = 0; } else { this._low = 0; this._high = 0; }

    if (this._low >= 2) {
      this._low = 0; this._cool = 2;
      if (this.resScale > 0.75) { this.resScale = Math.round((this.resScale - 0.1) * 100) / 100; this.apply(); }
      else if (this.autoTier > 0) { this.ceiling = this.autoTier - 1; this.autoTier--; this.resScale = 0.9; this._emit(); }
      else if (this.resScale > 0.55) { this.resScale -= 0.1; this.apply(); }
    } else if (this._high >= 5) {
      this._high = 0; this._cool = 3;
      if (this.resScale < 1) { this.resScale = Math.min(1, this.resScale + 0.05); this.apply(); }
      else if (this.autoTier < this.ceiling && this.autoTier < 3) { this.autoTier++; this.resScale = 0.9; this._emit(); }
    }
  }

  describe() {
    const d = this.detected;
    return `${this.mode === 'auto' ? 'Auto' : 'Manual'}: ${this.preset.name} @ ${Math.round(this.resScale * 100)}% · ${Math.round(this.fps)} fps · GPU: ${d.gpu}`;
  }
}
