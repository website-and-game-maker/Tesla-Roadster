// Auto-quality logic: detection, learning, refresh rate and the frame-time watcher.
// Run: node tests/quality/quality.test.js
import assert from 'node:assert/strict';

const store = new Map();
const setEnv = ({ gpu = 'ANGLE (NVIDIA GeForce GTX 1660)', ua = 'Mozilla/5.0 (Windows NT 10.0)', cores = 8, mem = 8, touch = 0 } = {}) => {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua, hardwareConcurrency: cores, deviceMemory: mem, maxTouchPoints: touch }, configurable: true });
  globalThis.screen = { width: 1920, height: 1080 };
  globalThis.window = { devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080 };
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  return { getContext: () => ({ getExtension: () => null, getParameter: () => gpu, RENDERER: 0 }), setPixelRatio() {}, setSize() {} };
};
const { detectTier, QualityManager } = await import('../../src/core/quality.js');

// detection
assert.equal(detectTier(setEnv({ gpu: 'Google SwiftShader' })).tier, 'low');
assert.equal(detectTier(setEnv({ gpu: 'NVIDIA GeForce RTX 4070' })).tier, 'ultra');
assert.equal(detectTier(setEnv({ gpu: 'NVIDIA GeForce GTX 1660' })).tier, 'high');
assert.equal(detectTier(setEnv({ gpu: 'Apple GPU', ua: 'iPhone', cores: 6, mem: 4 })).tier, 'medium');
assert.equal(detectTier(setEnv({ gpu: 'Adreno (TM) 740', ua: 'Android Mobile', cores: 8, mem: 12 })).tier, 'high');
assert.equal(detectTier(setEnv({ gpu: 'Mali-G52', ua: 'Android Mobile', cores: 4, mem: 2 })).tier, 'low');

// watcher steps resolution down, then the tier, when frames are slow
const run = (q, fps, seconds) => { for (let i = 0; i < fps * seconds; i++) q.frame(1 / fps, true); };
store.clear();
let q = new QualityManager(setEnv(), 'auto');
assert.equal(q.tierId, 'high');
run(q, 30, 30);
assert.ok(q.tierId !== 'high', 'drops a tier at 30 fps on a 60 Hz screen');
const dropped = q.tierId;

// ...and remembers it on the next visit
const q2 = new QualityManager(setEnv(), 'auto');
assert.equal(q2.tierId, dropped);
assert.ok(q2.learned);

// a 30 Hz display (phone in low-power mode) is not mistaken for a slow GPU
store.clear();
q = new QualityManager(setEnv(), 'auto');
for (let i = 0; i < 200; i++) q.frame(1 / 30, false); // menu frames: measure the refresh rate
assert.equal(q.refresh, 30);
run(q, 30, 30);
assert.equal(q.tierId, 'high', 'holds its tier at a steady 30 fps on a 30 Hz screen');

// settle() ignores loading hitches
store.clear();
q = new QualityManager(setEnv(), 'auto');
q.settle(3);
run(q, 10, 2.5);
assert.equal(q.resScale, 1);

// steady headroom steps back up, but never above the learned ceiling
q = new QualityManager(setEnv(), 'auto');
q.autoTier = 1; q.ceiling = 2; q.resScale = 1;
run(q, 60, 60);
assert.equal(q.tierId, 'high');

// manual mode never adapts
q = new QualityManager(setEnv(), 'low');
run(q, 20, 20);
assert.equal(q.tierId, 'low');
assert.equal(q.resScale, 1);

console.log('quality tests passed');
