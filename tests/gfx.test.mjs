// Unit tests for the graphics quality model (js/gfx.js): the runtime's quality
// tier picks a preset, the level scales the spark budget. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from './load.mjs';

const G = loadClassic('gfx.js').AXGfx;

test('every tier resolves to its preset row, unknown tiers to balanced', () => {
  for (const p of G.PRESETS) {
    const r = G.resolve(p, G.TIER_FLOOR[p]);
    assert.equal(r.preset, p);
    for (const [cat, tiers] of Object.entries(G.CATEGORIES)) assert.ok(tiers.includes(r[cat]), `${p}.${cat}`);
    assert.equal(r.shadowMap, G.SHADOW_MAP[r.shadows]);
    assert.deepEqual(r.budget.sparks, G.BUDGETS[p].sparks);
  }
  assert.equal(G.resolve('nonsense', 3).preset, 'balanced');
  assert.equal(G.resolve('low', 0).shadows, 'off');
  assert.equal(G.resolve('low', 0).budget.material, 'lambert');
  assert.equal(G.resolve('ultra', 7).budget.geometry, 'rich');
});

test('budgets are monotonic across tiers', () => {
  for (let i = 1; i < G.PRESETS.length; i++) {
    const a = G.BUDGETS[G.PRESETS[i - 1]], b = G.BUDGETS[G.PRESETS[i]];
    assert.ok(b.pool >= a.pool && b.motes >= a.motes && b.texture >= a.texture && b.sparks[1] >= a.sparks[1]);
    assert.ok(b.pool <= G.POOL_MAX && b.motes <= G.MOTE_MAX);
  }
});

test('sparks grow with the level within a tier, at most 4x and never past the pool', () => {
  const base = G.budget('high', 4).sparks;
  const up = G.budget('high', 6).sparks;
  assert.ok(up[0] > base[0] && up[1] > base[1]);
  const top = G.budget('balanced', 9);
  assert.ok(top.sparks[1] <= top.pool);
  assert.ok(top.sparks[0] <= G.BUDGETS.balanced.sparks[0] * 4);
  assert.deepEqual(G.budget('ultra', 0).sparks, G.BUDGETS.ultra.sparks, 'below the floor: the tier budget');
});
