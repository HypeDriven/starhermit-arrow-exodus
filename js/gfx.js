/* Arrow Exodus — the game's art per graphics tier (pure: no scene, no engine).
 * The runtime's Options › Graphics picks the graphics level; its quality tier
 * (`frame().quality`: low, balanced, high, ultra) selects one of the browser
 * build's four art rows here, and the level's particle budget within the tier
 * scales the spark counts. The engine-owned effects (shadows, AO, bloom,
 * grade, anti-aliasing) come from levelSettings() in src/look.ts. Gameplay is
 * identical on every tier; only visuals change.
 * UMD: globalThis.AXGfx (starhermit:script loadClassic) and Node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AXGfx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PRESETS = ['low', 'balanced', 'high', 'ultra'];

  // Category -> tiers, cheapest first.
  var CATEGORIES = {
    reflections: ['off', 'on'],         // studio environment image-based lighting
    detail: ['plain', 'detailed'],      // brushed-metal / grain textures, clearcoat enamel
    particles: ['low', 'high'],         // spark counts, glowing additive sparks
    background: ['static', 'animated']  // drifting dust motes + lamp shimmer + title drift
  };

  // Each preset is a row of tiers.
  var TABLE = {
    low: { reflections: 'off', detail: 'plain', particles: 'low', background: 'static' },
    balanced: { reflections: 'on', detail: 'detailed', particles: 'high', background: 'static' },
    high: { reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
    ultra: { reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' }
  };

  // Per-preset asset and effect budgets (the browser build's, unchanged):
  //   geometry  'lite' | 'standard' | 'rich' tile/arrow mesh detail
  //   material  'lambert' (no texture maps) | 'pbr' (standard / physical)
  //   texture   procedural surface texture size (px; grain ½, workbench 2×); 0 = none
  //   sparks    sparks per arrow exit / per cleared plate (scaled within the tier)
  //   pool      spark particle pool size
  //   motes     drifting dust motes when Ambient motion is on
  var BUDGETS = {
    low: { geometry: 'lite', material: 'lambert', texture: 0, sparks: [6, 24], pool: 160, motes: 0 },
    balanced: { geometry: 'standard', material: 'pbr', texture: 128, sparks: [10, 45], pool: 240, motes: 30 },
    high: { geometry: 'standard', material: 'pbr', texture: 256, sparks: [18, 90], pool: 400, motes: 70 },
    ultra: { geometry: 'rich', material: 'pbr', texture: 512, sparks: [28, 140], pool: 800, motes: 140 }
  };
  var POOL_MAX = 800, MOTE_MAX = 140;

  /** A tier's budget with sparks scaled by k (the level's particle budget over
   * the tier's anchor level's: at most 4×, never past the pool) and the texture
   * held to the level's largest. */
  function budget(preset, k, maxTexture) {
    var p = BUDGETS[preset] ? preset : 'balanced';
    var b = Object.assign({}, BUDGETS[p]);
    var kk = Math.max(1, Math.min(4, isFinite(k) ? Number(k) : 1));
    b.sparks = BUDGETS[p].sparks.map(function (n) { return Math.max(1, Math.min(b.pool, Math.round(n * kk))); });
    if (isFinite(maxTexture)) b.texture = Math.min(b.texture, Number(maxTexture));
    return b;
  }

  /** The art for a quality tier (an unknown one is balanced). */
  function resolve(quality, k, maxTexture) {
    var preset = PRESETS.indexOf(quality) >= 0 ? quality : 'balanced';
    var out = Object.assign({ preset: preset }, TABLE[preset]);
    out.budget = budget(preset, k, maxTexture);
    return out;
  }

  return { PRESETS: PRESETS, CATEGORIES: CATEGORIES, TABLE: TABLE, BUDGETS: BUDGETS,
    POOL_MAX: POOL_MAX, MOTE_MAX: MOTE_MAX, budget: budget, resolve: resolve };
});
