// Unit tests for the game's art per graphics tier (js/gfx.js): the runtime's
// quality tier picks a row, the level's particle budget scales the sparks.
// Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from './load.mjs';

const G = loadClassic('gfx.js').AXGfx;

test('every tier resolves to its row, unknown tiers to balanced', () => {
  for (const p of G.PRESETS) {
    const r = G.resolve(p, 1);
    assert.equal(r.preset, p);
    for (const [cat, tiers] of Object.entries(G.CATEGORIES)) assert.ok(tiers.includes(r[cat]), `${p}.${cat}`);
    assert.deepEqual(r.budget.sparks, G.BUDGETS[p].sparks);
  }
  assert.equal(G.resolve('nonsense', 1).preset, 'balanced');
  assert.equal(G.resolve('low', 1).budget.material, 'lambert');
  assert.equal(G.resolve('ultra', 1).budget.geometry, 'rich');
});

test('budgets are monotonic across tiers', () => {
  for (let i = 1; i < G.PRESETS.length; i++) {
    const a = G.BUDGETS[G.PRESETS[i - 1]], b = G.BUDGETS[G.PRESETS[i]];
    assert.ok(b.pool >= a.pool && b.motes >= a.motes && b.texture >= a.texture && b.sparks[1] >= a.sparks[1]);
    assert.ok(b.pool <= G.POOL_MAX && b.motes <= G.MOTE_MAX);
  }
});

test('sparks grow with the level within a tier, at most 4x and never past the pool', () => {
  const base = G.budget('high', 1).sparks;
  const up = G.budget('high', 2).sparks;
  assert.ok(up[0] > base[0] && up[1] > base[1]);
  const top = G.budget('balanced', 64);
  assert.ok(top.sparks[1] <= top.pool);
  assert.ok(top.sparks[0] <= G.BUDGETS.balanced.sparks[0] * 4);
  assert.deepEqual(G.budget('ultra', 0.5).sparks, G.BUDGETS.ultra.sparks, 'below the anchor: the tier budget');
});

test('the texture is held to the level', () => {
  assert.equal(G.budget('ultra', 1, 256).texture, 256);
  assert.equal(G.budget('high', 1, 4096).texture, 256);
});
