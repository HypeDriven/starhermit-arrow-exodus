// Unit tests for the pure graphics quality model (js/gfx.js). Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import '../gpu-level.js'; // sets globalThis.StarHermitGpu (ES-module package: the UMD takes the global path)
const { detectPreset, detectLevel, presetForLevel, budget, BUDGETS, LEVELS, resolve, presetTier, choosePreset, describe, normalizePreset, CATEGORIES, PRESETS } = await import('../js/gfx.js');
import { GFX_STRINGS, gfxStrings } from '../js/gfx-i18n.js';

test('hardware level picks the Auto preset (StarHermit gpu-level.js)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)'), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)'), 'ultra');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)'), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)'), 20);
  assert.equal(detectPreset('Adreno (TM) 740', { mobile: true }), 'balanced', 'phones: Balanced at most');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090)', { mobile: true }), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 650', { mobile: true }), 'low');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(9), 'balanced');
  assert.equal(presetForLevel(16), 'high');
});

test('per-preset budgets: explicit, monotonic and scaled by hardware level', () => {
  for (const p of PRESETS) {
    const b = BUDGETS[p];
    for (const k of ['geometry', 'material', 'texture', 'sparks', 'pool', 'motes', 'bloomRes']) assert.ok(k in b, `${p}.${k}`);
    assert.ok(b.sparks[1] <= b.pool);
  }
  assert.equal(BUDGETS.low.material, 'lambert');
  assert.equal(BUDGETS.low.geometry, 'lite');
  assert.equal(BUDGETS.ultra.geometry, 'rich');
  for (let i = 1; i < PRESETS.length; i++) {
    const a = BUDGETS[PRESETS[i - 1]], b = BUDGETS[PRESETS[i]];
    assert.ok(b.pool >= a.pool && b.motes >= a.motes && b.texture >= a.texture && b.sparks[1] >= a.sparks[1]);
  }
  // within a preset, sparks grow with the level (≤ 4×, never past the pool) and shrink below its floor
  assert.deepEqual(budget('high', 10).sparks, BUDGETS.high.sparks);
  assert.ok(budget('high', 14).sparks[0] > BUDGETS.high.sparks[0]);
  assert.ok(budget('low', 20).sparks[1] <= BUDGETS.low.sparks[1] * 4);
  assert.ok(budget('ultra', 20).sparks[1] <= BUDGETS.ultra.pool);
  assert.ok(budget('ultra', 2).sparks[1] < BUDGETS.ultra.sparks[1]);
  assert.deepEqual(resolve({ preset: 'low' }, 'low', 0).budget.sparks, BUDGETS.low.sparks);
});

test('resolve: auto uses the detected preset, explicit preset wins', () => {
  const a = resolve({}, 'low');
  assert.equal(a.preset, 'low'); assert.equal(a.auto, true); assert.equal(a.post, false);
  assert.equal(a.shadows, 'off'); assert.equal(a.antialias, 'msaa');
  const h = resolve({ preset: 'high' }, 'low');
  assert.equal(h.preset, 'high'); assert.equal(h.auto, false);
  assert.equal(h.shadows, presetTier('high', 'shadows')); assert.equal(h.post, true);
  assert.equal(resolve({ preset: 'bogus' }, undefined).preset, 'balanced');
});

test('resolve: overrides, invalid tiers and scale clamp', () => {
  const r = resolve({ preset: 'high', bloom: 'off', shadows: 'nope', render_scale: 5 }, 'low');
  assert.equal(r.bloom, 'off');
  assert.equal(r.shadows, 'medium', 'invalid override falls back to the preset tier');
  assert.equal(r.renderScale, 2);
  assert.equal(resolve({ preset: 'low', render_scale: 0.1 }).renderScale, 0.5);
  assert.equal(resolve({ preset: 'ultra' }).scale, 1.25);
  assert.equal(resolve({}).adaptive, true);
  assert.equal(resolve({ adaptive: false, show_fps: true }).showFps, true);
  // every category resolves to one of its tiers for every preset
  for (const p of PRESETS) for (const [cat, tiers] of Object.entries(CATEGORIES))
    assert.ok(tiers.includes(resolve({ preset: p })[cat]), `${p}.${cat}`);
});

test('choosing a preset clears overrides but keeps scale and toggles', () => {
  const s = choosePreset({ preset: 'high', bloom: 'off', ao: 'high', render_scale: 1.5, show_fps: true }, 'ultra');
  assert.equal(s.preset, 'ultra');
  assert.ok(!('bloom' in s) && !('ao' in s));
  assert.equal(s.render_scale, 1.5); assert.equal(s.show_fps, true);
  assert.equal(choosePreset({}, 'auto').preset, 'auto');
});

test('legacy tiers normalise and describe() summarises cost', () => {
  assert.equal(normalizePreset('medium'), 'balanced');
  assert.equal(normalizePreset('auto'), 'auto');
  assert.equal(normalizePreset(undefined), 'auto');
  const d = describe(resolve({ preset: 'high' }), [800, 800]);
  assert.match(d, /2048² shadows/); assert.match(d, /SMAA/); assert.match(d, /800×800 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('graphics strings exist in every required locale', () => {
  const need = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const en = GFX_STRINGS['en-US'];
  for (const loc of need) {
    const t = GFX_STRINGS[loc];
    assert.ok(t, loc);
    for (const k of Object.keys(en)) assert.ok(t[k], `${loc}.${k}`);
    for (const c of Object.keys(CATEGORIES)) assert.ok(t.cat[c], `${loc}.cat.${c}`);
    for (const tiers of Object.values(CATEGORIES)) for (const x of tiers) assert.ok(t.tier[x], `${loc}.tier.${x}`);
    for (const p of PRESETS) assert.ok(t.tier[p], `${loc}.tier.${p}`);
  }
  assert.equal(gfxStrings('es-MX'), GFX_STRINGS['es-419']);
  assert.equal(gfxStrings('xx'), GFX_STRINGS['en-US']);
});
