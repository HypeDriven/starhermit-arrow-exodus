/* Arrow Exodus — graphics quality model (pure: no scene, no engine).
 * The runtime's Options › Graphics picks the graphics level (Auto from the
 * GPU, or one of ten); its quality tier (`frame().quality`: low, balanced,
 * high, ultra) selects one of the browser build's four presets here, each
 * tuned to hold 60 FPS on the weakest GPU it was given, and the level's
 * speed within the tier scales the spark counts (as the browser build scaled
 * them by its hardware level). The runtime owns what the old Graphics panel
 * did besides: Auto, render scale and pixel-ratio cap, adaptive resolution,
 * the frame-rate limit, and the shadow-map size and MSAA samples it holds to
 * the level. Gameplay is identical on every tier; only visuals change.
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
    shadows: ['off', 'low', 'medium', 'high'],
    ao: ['off', 'on', 'high'],
    bloom: ['off', 'on'],
    grade: ['off', 'on'],
    antialias: ['off', 'fxaa', 'smaa', 'msaa'],
    reflections: ['off', 'on'],         // studio environment image-based lighting
    detail: ['plain', 'detailed'],      // brushed-metal / grain textures, clearcoat enamel
    particles: ['low', 'high'],         // spark counts, glowing additive sparks
    background: ['static', 'animated']  // drifting dust motes + lamp shimmer + title drift
  };

  // Each preset is a row of tiers.
  var TABLE = {
    low: { shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa',
      reflections: 'off', detail: 'plain', particles: 'low', background: 'static' },
    balanced: { shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa',
      reflections: 'on', detail: 'detailed', particles: 'high', background: 'static' },
    high: { shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa',
      reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
    ultra: { shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa',
      reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' }
  };

  // Shadow-map size per tier (the runtime holds it to the level's own cap).
  var SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

  // Per-preset asset and effect budgets (the browser build's, unchanged):
  //   geometry  'lite' | 'standard' | 'rich' tile/arrow mesh detail
  //   material  'lambert' (no texture maps) | 'pbr' (standard / physical)
  //   texture   procedural surface texture size (px; grain ½, workbench 2×); 0 = none
  //   sparks    sparks per arrow exit / per cleared plate (scaled by level within the tier)
  //   pool      spark particle pool size
  //   motes     drifting dust motes when Ambient motion is on
  //   bloomRes  bloom resolution as a fraction of the frame
  var BUDGETS = {
    low: { geometry: 'lite', material: 'lambert', texture: 0, sparks: [6, 24], pool: 160, motes: 0, bloomRes: 0.5 },
    balanced: { geometry: 'standard', material: 'pbr', texture: 128, sparks: [10, 45], pool: 240, motes: 30, bloomRes: 0.5 },
    high: { geometry: 'standard', material: 'pbr', texture: 256, sparks: [18, 90], pool: 400, motes: 70, bloomRes: 0.75 },
    ultra: { geometry: 'rich', material: 'pbr', texture: 512, sparks: [28, 140], pool: 800, motes: 140, bloomRes: 1 }
  };
  var POOL_MAX = 800, MOTE_MAX = 140;

  // The first graphics-level index of each tier (quantum, molecular, terrestrial, galactic).
  var TIER_FLOOR = { low: 0, balanced: 2, high: 4, ultra: 7 };

  /** A tier's budget at a level index (0 quantum … 9 infinite): levels are about
   * 1.64× apart in GPU throughput, so sparks grow by that per level above the
   * tier's first (at most 4×, never past the pool). */
  function budget(preset, levelIndex) {
    var p = BUDGETS[preset] ? preset : 'balanced';
    var b = Object.assign({}, BUDGETS[p]);
    var lv = isFinite(levelIndex) ? Number(levelIndex) : TIER_FLOOR[p];
    var k = Math.min(4, Math.pow(1.64, Math.max(0, lv - TIER_FLOOR[p])));
    b.sparks = BUDGETS[p].sparks.map(function (n) { return Math.max(1, Math.min(b.pool, Math.round(n * k))); });
    return b;
  }

  /** The look for a quality tier (an unknown one is balanced) at a level index. */
  function resolve(quality, levelIndex) {
    var preset = PRESETS.indexOf(quality) >= 0 ? quality : 'balanced';
    var out = Object.assign({ preset: preset }, TABLE[preset]);
    out.budget = budget(preset, levelIndex);
    out.shadowMap = SHADOW_MAP[out.shadows];
    return out;
  }

  return { PRESETS: PRESETS, CATEGORIES: CATEGORIES, TABLE: TABLE, BUDGETS: BUDGETS, SHADOW_MAP: SHADOW_MAP,
    TIER_FLOOR: TIER_FLOOR, POOL_MAX: POOL_MAX, MOTE_MAX: MOTE_MAX, budget: budget, resolve: resolve };
});
