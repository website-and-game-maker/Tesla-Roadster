// Sanity checks on the secrets catalogue. Run: node tests/secrets/defs.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECRETS, ALL_SECRETS, TOTAL, TRAILS, CHALLENGES } from '../../src/secrets/defs.js';

const worldsSrc = readFileSync(new URL('../../src/worlds/index.js', import.meta.url), 'utf8');
const worldIds = [...worldsSrc.matchAll(/^import (\w+) from '\.\/defs\/\w+\.js';/gm)].map((m) => m[1]);
const propsSrc = readFileSync(new URL('../../src/secrets/props.js', import.meta.url), 'utf8');

assert.equal(worldIds.length, 10, 'expected 10 worlds');
for (const id of worldIds) assert.ok(SECRETS[id], `world ${id} has secrets`);
for (const id of Object.keys(SECRETS)) assert.ok(worldIds.includes(id), `secrets for unknown world ${id}`);
assert.equal(TOTAL, 30);

const ids = new Set(), names = new Set();
for (const [world, list] of Object.entries(SECRETS)) {
  assert.equal(list.length, 3, `${world}: three secrets`);
  assert.deepEqual(list.map((s) => s.tier).sort(), ['high', 'low', 'wall'], `${world}: one secret of each tier`);
  for (const s of list) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`); ids.add(s.id);
    assert.ok(!names.has(s.name), `duplicate name ${s.name}`); names.add(s.name);
    assert.ok(s.at > 0.05 && s.at < 0.95, `${s.id}: 'at' keeps clear of the start line`);
    assert.ok(s.side === 1 || s.side === -1, `${s.id}: side`);
    assert.ok(CHALLENGES[s.challenge], `${s.id}: challenge ${s.challenge} exists`);
    assert.ok(new RegExp(`^  ${s.prop}\\(`, 'm').test(propsSrc), `${s.id}: prop '${s.prop}' has a builder`);
    assert.ok(s.flavor.length > 8 && s.hint.length > 20, `${s.id}: has flavour text and a hint`);
    // the hint must agree with where the secret is
    if (s.tier !== 'high') assert.ok(s.hint.toLowerCase().includes(s.side < 0 ? 'left' : 'right'), `${s.id}: hint names the ${s.side < 0 ? 'left' : 'right'} side`);
  }
}
for (const type of Object.keys(CHALLENGES)) assert.ok(ALL_SECRETS.some((s) => s.challenge === type), `challenge ${type} is used`);
assert.equal(TRAILS[0].id, '');
for (let i = 1; i < TRAILS.length; i++) assert.ok(TRAILS[i].need > TRAILS[i - 1].need && TRAILS[i].need <= TOTAL, 'trails unlock in order');
console.log(`secrets catalogue ok: ${TOTAL} secrets in ${Object.keys(SECRETS).length} worlds`);
