// Post-processing for races: the scene is drawn into a high-dynamic-range buffer
// (with MSAA where the device can afford it), then
//   1. bloom: bright pixels (sun, jet flames, rings, headlights, neon) are blurred
//      through a chain of ever smaller copies and added back, so light glows;
//   2. composite: bloom + filmic tone mapping + a light colour grade + vignette, with
//      a touch of chromatic aberration and radial speed blur while boosting.
// Low quality skips all of this and draws straight to the screen as before.
// No build step and no outside code: three.js only.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Downsample with 4 bilinear taps (a 4x4 box). The first pass also keeps only light
// above the threshold (soft knee) and weights taps by 1/(1+luma) so single very
// bright pixels do not flicker ("fireflies").
const DOWN_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 texel;
uniform float threshold;
uniform float knee;
uniform float prefilter;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 bright(vec3 c) {
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, l - threshold) / max(l, 1e-4);
  return c * w;
}
void main() {
  vec3 a = texture2D(tSrc, vUv + texel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + texel * vec2( 1.0, -1.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-1.0,  1.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + texel * vec2( 1.0,  1.0)).rgb;
  if (prefilter > 0.5) {
    a = bright(min(a, vec3(64.0))); b = bright(min(b, vec3(64.0)));
    c = bright(min(c, vec3(64.0))); d = bright(min(d, vec3(64.0)));
    float wa = 1.0 / (1.0 + luma(a)), wb = 1.0 / (1.0 + luma(b)), wc = 1.0 / (1.0 + luma(c)), wd = 1.0 / (1.0 + luma(d));
    gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
  } else {
    gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
  }
}`;

// Upsample the smaller level with a 3x3 tent filter and add this level on top.
const UP_FRAG = /* glsl */`
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 texel;
uniform float radius;
varying vec2 vUv;
void main() {
  vec2 o = texel * radius;
  vec3 s = texture2D(tLow, vUv).rgb * 4.0;
  s += (texture2D(tLow, vUv + vec2(-o.x, 0.0)).rgb + texture2D(tLow, vUv + vec2(o.x, 0.0)).rgb
      + texture2D(tLow, vUv + vec2(0.0, -o.y)).rgb + texture2D(tLow, vUv + vec2(0.0, o.y)).rgb) * 2.0;
  s += texture2D(tLow, vUv - o).rgb + texture2D(tLow, vUv + o).rgb
     + texture2D(tLow, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLow, vUv + vec2(-o.x, o.y)).rgb;
  gl_FragColor = vec4(s / 16.0 + texture2D(tHigh, vUv).rgb, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float bloomStrength;
uniform float vignette;
uniform float aberration;
uniform float speedBlur;
uniform float saturation;
uniform float contrast;
uniform vec3 tint;
uniform float time;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
void main() {
  vec2 fromC = vUv - 0.5;
  float r2 = dot(fromC, fromC);
  vec3 col;
  if (aberration > 0.0001) {
    vec2 off = fromC * aberration * r2 * 4.0;
    col = vec3(texture2D(tScene, vUv - off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv + off).b);
  } else {
    col = texture2D(tScene, vUv).rgb;
  }
  if (speedBlur > 0.001) {
    // radial blur toward the centre, stronger at the edges: a sense of speed
    vec3 acc = col;
    for (int i = 1; i < 6; i++) {
      float k = float(i) / 6.0;
      acc += texture2D(tScene, vUv - fromC * speedBlur * k * smoothstep(0.02, 0.25, r2)).rgb;
    }
    col = acc / 6.0;
  }
  col += texture2D(tBloom, vUv).rgb * bloomStrength;
  col *= tint;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, saturation), 0.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  // gentle S-curve after tone mapping, then vignette
  vec3 c = gl_FragColor.rgb;
  c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
  c *= 1.0 - vignette * smoothstep(0.12, 0.75, r2 * 1.6);
  gl_FragColor.rgb = c;
  #include <colorspace_fragment>
  // dither so the sky and fog never band
  gl_FragColor.rgb += (hash(vUv * 977.0) - 0.5) / 255.0;
}`;

/** What each quality tier gets. `null` = render straight to the screen. */
export const POST_PRESETS = {
  low: null,
  medium: { msaa: 2, levels: 4, bloom: 0.55, speedFx: false },
  high: { msaa: 4, levels: 5, bloom: 0.6, speedFx: true },
  ultra: { msaa: 4, levels: 6, bloom: 0.65, speedFx: true },
};

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.supported = PostFX.isSupported(renderer);
    this.preset = null;
    this.enabled = false;
    this.w = 0; this.h = 0;
    this.down = []; this.up = [];
    this.sceneRT = null;
    this.time = 0;
    // what the race asks for this frame (0..1 each)
    this.speed = 0; this.boost = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const pass = (frag, uniforms, toneMapped = false) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped });
    this.downMat = pass(DOWN_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1.15 }, knee: { value: 0.6 }, prefilter: { value: 0 } });
    this.upMat = pass(UP_FRAG, { tLow: { value: null }, tHigh: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1 } });
    this.compMat = pass(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, bloomStrength: { value: 0.6 }, vignette: { value: 0.32 }, aberration: { value: 0 },
      speedBlur: { value: 0 }, saturation: { value: 1.08 }, contrast: { value: 0.12 }, tint: { value: new THREE.Color(1, 1, 1) }, time: { value: 0 },
    }, true);
  }

  /** Half-float colour buffers are needed for HDR bloom; WebGL2 + the float buffer extension. */
  static isSupported(renderer) {
    try {
      const caps = renderer.capabilities, ext = renderer.extensions;
      if (!caps.isWebGL2) return false;
      return ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    } catch (e) { return false; }
  }

  /** Called on every quality change with the tier id. */
  configure(tierId) {
    const p = this.supported ? POST_PRESETS[tierId] || null : null;
    const same = p && this.preset && p.msaa === this.preset.msaa && p.levels === this.preset.levels;
    this.preset = p;
    this.enabled = !!p;
    if (!p) { this.disposeTargets(); return; }
    this.compMat.uniforms.bloomStrength.value = p.bloom;
    if (!same) { this.disposeTargets(); this.w = 0; this.h = 0; }
  }

  /** Per-world look: palette tweaks so Mars is warmer, the Moon colder, night bluer. */
  setLook({ tint = 0xffffff, saturation = 1.08, contrast = 0.12, vignette = 0.32, threshold = 1.15 } = {}) {
    const u = this.compMat.uniforms;
    u.tint.value.set(tint); u.saturation.value = saturation; u.contrast.value = contrast; u.vignette.value = vignette;
    this.downMat.uniforms.threshold.value = threshold;
  }

  ensureTargets() {
    const size = this.renderer.getDrawingBufferSize(this._v || (this._v = new THREE.Vector2()));
    const w = Math.max(1, size.x | 0), h = Math.max(1, size.y | 0);
    if (w === this.w && h === this.h && this.sceneRT) return;
    this.disposeTargets();
    this.w = w; this.h = h;
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: true, samples: this.preset.msaa });
    let lw = w, lh = h;
    for (let i = 0; i < this.preset.levels; i++) {
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
      this.down.push(new THREE.WebGLRenderTarget(lw, lh, opts));
      this.up.push(new THREE.WebGLRenderTarget(lw, lh, opts));
    }
  }

  disposeTargets() {
    if (this.sceneRT) this.sceneRT.dispose();
    for (const t of this.down) t.dispose();
    for (const t of this.up) t.dispose();
    this.sceneRT = null; this.down = []; this.up = [];
  }

  blit(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /** Draw a frame. `fx` = { speed 0..1, boost 0..1 } from the race, for the speed effects. */
  render(scene, camera, dt = 1 / 60, fx = null) {
    const r = this.renderer;
    if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return; }
    this.ensureTargets();
    this.time = (this.time + dt) % 1000;
    const prevAuto = r.autoClear;

    // 1. scene into the HDR buffer
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    r.autoClear = false;

    // 2. bloom chain
    const dm = this.downMat.uniforms;
    let src = this.sceneRT.texture, sw = this.w, sh = this.h;
    for (let i = 0; i < this.down.length; i++) {
      dm.tSrc.value = src; dm.texel.value.set(1 / sw, 1 / sh); dm.prefilter.value = i === 0 ? 1 : 0;
      this.blit(this.downMat, this.down[i]);
      src = this.down[i].texture; sw = this.down[i].width; sh = this.down[i].height;
    }
    const um = this.upMat.uniforms;
    let low = this.down[this.down.length - 1];
    for (let i = this.down.length - 2; i >= 0; i--) {
      um.tLow.value = low.texture; um.tHigh.value = this.down[i].texture;
      um.texel.value.set(1 / low.width, 1 / low.height);
      this.blit(this.upMat, this.up[i]);
      low = this.up[i];
    }

    // 3. composite to the screen
    const cu = this.compMat.uniforms;
    cu.tScene.value = this.sceneRT.texture;
    cu.tBloom.value = low.texture;
    cu.time.value = this.time;
    const speedFx = this.preset.speedFx && fx;
    const b = speedFx ? Math.max(0, Math.min(1, fx.boost || 0)) : 0;
    const s = speedFx ? Math.max(0, Math.min(1, fx.speed || 0)) : 0;
    // ease toward the target so the effect breathes in and out instead of popping
    const k = 1 - Math.exp(-dt * 6);
    this.boost += (b - this.boost) * k; this.speed += (s - this.speed) * k;
    cu.aberration.value = 0.004 * this.boost + 0.0015 * this.speed * this.speed;
    cu.speedBlur.value = 0.05 * this.boost + 0.02 * Math.max(0, this.speed - 0.6);
    // bloom levels are summed, so scale by 1/levels to keep strength tier-independent
    cu.bloomStrength.value = this.preset.bloom / Math.max(1, this.down.length - 1);
    this.blit(this.compMat, null);
    r.autoClear = prevAuto;
  }

  dispose() {
    this.disposeTargets();
    this.downMat.dispose(); this.upMat.dispose(); this.compMat.dispose();
    this.quad.geometry.dispose();
  }
}
