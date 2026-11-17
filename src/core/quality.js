// Adaptive graphics quality.
// 1) detectTier(): a first guess from the GPU name, CPU cores, memory and device type.
// 2) A remembered result: once the game has learned what this device can really hold,
//    the next visit starts there instead of guessing again (stored per GPU).
// 3) QualityManager.frame(): watches real frame times while playing and moves the render
//    resolution (and, if needed, the whole preset) down when the device struggles and back
//    up when it has headroom. It knows the display's real refresh rate (a phone in
//    low-power mode runs at 30 Hz, a gaming monitor at 144 Hz), and where the browser
//    can time the GPU it only steps up when the GPU really has room to spare.
// Settings that need a scene rebuild (scenery density) are read at the start of each
// race; resolution, shadows, post effects and draw distance change live.

export const ORDER = ['low', 'medium', 'high', 'ultra'];

export const PRESETS = {
  low:    { id: 'low',    name: 'Low',    maxPixelRatio: 1,    shadows: false, shadowSize: 512,  density: 0.35, drawDist: 600,  carDetail: 'low',    particles: 0.4, trails: false, reflections: false, post: false },
  medium: { id: 'medium', name: 'Medium', maxPixelRatio: 1.25, shadows: true,  shadowSize: 1024, density: 0.65, drawDist: 900,  carDetail: 'medium', particles: 0.7, trails: true,  reflections: true,  post: true },
  high:   { id: 'high',   name: 'High',   maxPixelRatio: 1.75, shadows: true,  shadowSize: 2048, density: 1.0,  drawDist: 1300, carDetail: 'high',   particles: 1.0, trails: true,  reflections: true,  post: true },
  ultra:  { id: 'ultra',  name: 'Ultra',  maxPixelRatio: 2.5,  shadows: true,  shadowSize: 4096, density: 1.4,  drawDist: 1800, carDetail: 'high',   particles: 1.3, trails: true,  reflections: true,  post: true },
};

const LEARN_KEY = 'roadster-quality-learned';

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
  const pixels = (screen.width || 1280) * (screen.height || 720) * (window.devicePixelRatio || 1) ** 2;
  const reasons = [];
  let score = 2; // index into ORDER

  if (/swiftshader|llvmpipe|software|microsoft basic/.test(g)) { score = 0; reasons.push('software renderer'); }
  else if (/rtx [2-9]\d|rtx a\d|radeon rx [67]\d{3}|rx 7\d{3}|rx 9\d{3}|apple m[1-9] (pro|max|ultra)|apple m[3-9]\b|arc a7|arc b\d/.test(g)) { score = 3; reasons.push('high-end GPU'); }
  else if (/geforce|radeon|apple m\d|arc |quadro/.test(g)) { score = 2; reasons.push('dedicated / Apple Silicon GPU'); }
  else if (/iris xe|adreno.*(7[3-9]\d|8\d\d)|apple gpu|apple a1[5-9]|mali-g7\d\d|mali-g[67]\d\d? mc|immortalis|xclipse/.test(g)) { score = mobile ? 1 : 2; reasons.push('modern integrated / mobile GPU'); }
  else if (/intel|mali|adreno|powervr|videocore/.test(g)) { score = 1; reasons.push('integrated / older mobile GPU'); }
  else reasons.push('unrecognised GPU: starting at High and measuring');

  // Phones: Medium is the safe start. A recent flagship (modern GPU, lots of memory, many
  // cores) can try High; the frame-time watcher steps it back down within seconds if needed.
  if (mobile && score >= 1) {
    const flagship = mem >= 8 && cores >= 8 && /adreno.*(7[3-9]\d|8\d\d)|immortalis|xclipse|apple/.test(g);
    if (flagship) { score = 2; reasons.push('recent flagship phone / tablet'); }
    else if (score > 1) { score = 1; reasons.push('mobile device'); }
  }
  if (cores <= 2 || mem <= 2) { score = Math.max(0, score - 1); reasons.push('few CPU cores / low memory'); }
  // a 4K / 5K screen at full resolution costs four times a 1080p one
  if (!mobile && pixels > 8.5e6 && score === 3) reasons.push('very high resolution screen (resolution scales first)');
  return { tier: ORDER[score], gpu: String(gpu), mobile, cores, mem, reasons };
}

function readLearned() {
  try { return JSON.parse(localStorage.getItem(LEARN_KEY) || 'null'); } catch (e) { return null; }
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
    this._acc = 0; this._frames = 0; this._low = 0; this._high = 0; this._cool = 0; this._settle = 0;
    this.fps = 60;
    this.learned = false;
    // what the device remembered from last time (same GPU and screen)
    this.sig = `${this.detected.gpu}|${this.detected.mobile ? 'm' : 'd'}|${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`;
    const L = readLearned();
    if (L && L.sig === this.sig && ORDER[L.tier]) {
      // a cap learned more than a week ago gets one more try (drivers and browsers improve)
      this.autoTier = L.tier; this.ceiling = Date.now() - (L.at || 0) > 7 * 864e5 ? 3 : (L.ceiling ?? 3); this.resScale = Math.max(0.55, Math.min(1, L.resScale || 1));
      this.learned = true;
    }
    // display refresh rate, measured from frame intervals while nothing heavy is drawn
    this.refresh = 60; this._dts = [];
    this.gpu = new GpuTimer(renderer);
  }

  get tierId() { return this.mode === 'auto' ? ORDER[this.autoTier] : this.mode; }
  get preset() { return PRESETS[this.tierId]; }
  /** frames per second the watcher aims for: the display's rate, at most 60 */
  get target() { return Math.max(28, Math.min(60, this.refresh)); }

  onChange(fn) { this.listeners.push(fn); }
  _emit() { this.apply(); this._remember(); for (const f of this.listeners) f(this.preset); }

  _remember() {
    if (this.mode !== 'auto') return;
    try { localStorage.setItem(LEARN_KEY, JSON.stringify({ sig: this.sig, tier: this.autoTier, ceiling: this.ceiling, resScale: this.resScale, at: Date.now() })); } catch (e) { /* private mode */ }
  }

  setMode(mode) {
    this.mode = mode;
    this.resScale = 1;
    this._emit();
  }

  /** Ignore the next couple of seconds (a race is loading, shaders are compiling). */
  settle(seconds = 2) { this._settle = seconds; this._acc = 0; this._frames = 0; this._low = 0; this._high = 0; }

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
    if (!active) this._sampleRefresh(dt);
    this.gpu.poll();
    if (this._settle > 0) { this._settle -= dt; return; }
    this._acc += dt; this._frames++;
    if (this._acc < 1) return;
    this.fps = this._frames / this._acc;
    this._acc = 0; this._frames = 0;
    if (!active || this.mode !== 'auto') return;
    if (this._cool > 0) { this._cool--; return; }

    const T = this.target, budget = 1000 / T, gms = this.gpu.ms;
    const slow = this.fps < T * 0.8 || (gms > 0 && gms > budget * 1.05 && this.fps < T * 0.92);
    // Only step up when frames are on time and, where we can measure it, the GPU is under
    // half busy, so a step up doesn't immediately have to be undone.
    const roomy = this.fps > T * 0.95 && (gms <= 0 || gms < budget * 0.5);
    if (slow) { this._low++; this._high = 0; } else if (roomy) { this._high++; this._low = 0; } else { this._low = 0; this._high = 0; }

    if (this._low >= 2) {
      this._low = 0; this._cool = 2;
      if (this.resScale > 0.75) { this.resScale = Math.round((this.resScale - 0.1) * 100) / 100; this.apply(); this._remember(); }
      else if (this.autoTier > 0) { this.ceiling = this.autoTier - 1; this.autoTier--; this.resScale = 0.9; this._emit(); }
      else if (this.resScale > 0.55) { this.resScale -= 0.1; this.apply(); this._remember(); }
    } else if (this._high >= 5) {
      this._high = 0; this._cool = 3;
      if (this.resScale < 1) { this.resScale = Math.min(1, Math.round((this.resScale + 0.05) * 100) / 100); this.apply(); this._remember(); }
      else if (this.autoTier < this.ceiling && this.autoTier < 3 && this.refresh >= 50) { this.autoTier++; this.resScale = 0.9; this._emit(); } // not under a 30 Hz cap: that is usually battery saver
    }
  }

  // Menus draw almost nothing, so their frame interval is the display's refresh interval.
  _sampleRefresh(dt) {
    const d = this._dts; d.push(dt);
    if (d.length < 90) return;
    const s = d.slice().sort((a, b) => a - b);
    const med = s[s.length >> 1];
    d.length = 0;
    if (med <= 0) return;
    const hz = 1 / med;
    // snap to the usual rates; anything odd is treated as 60
    const rates = [30, 48, 50, 60, 75, 90, 100, 120, 144, 165, 240];
    const near = rates.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));
    this.refresh = Math.abs(near - hz) / near < 0.12 ? near : 60;
  }

  describe() {
    const d = this.detected, g = this.gpu.ms > 0 ? ` · GPU ${this.gpu.ms.toFixed(1)} ms` : '';
    const how = this.mode === 'auto' ? (this.learned ? 'Auto (learned)' : 'Auto') : 'Manual';
    return `${how}: ${this.preset.name} @ ${Math.round(this.resScale * 100)}% · ${Math.round(this.fps)} / ${Math.round(this.refresh)} fps${g} · GPU: ${d.gpu}`;
  }
}

/**
 * Measures how long the GPU spends on a frame (EXT_disjoint_timer_query_webgl2, desktop
 * Chrome/Edge/Firefox). Results arrive a few frames late; `ms` is a smoothed average, or 0
 * when the browser can't time the GPU (Safari, most phones), in which case only frame
 * rate is used.
 */
class GpuTimer {
  constructor(renderer) {
    this.ms = 0;
    this.gl = null; this.ext = null; this.pending = []; this.active = null;
    try {
      const gl = renderer.getContext();
      if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (ext) { this.gl = gl; this.ext = ext; }
      }
    } catch (e) { /* not available */ }
  }
  begin() {
    if (!this.ext || this.active || this.pending.length > 3) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active); this.active = null;
  }
  poll() {
    if (!this.ext || !this.pending.length) return;
    const gl = this.gl, q = this.pending[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    if (!disjoint) {
      const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      this.ms = this.ms ? this.ms * 0.9 + ms * 0.1 : ms;
    }
    gl.deleteQuery(q); this.pending.shift();
  }
}
