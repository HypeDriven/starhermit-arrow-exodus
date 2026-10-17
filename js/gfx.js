/* Arrow Exodus — graphics quality model: presets, per-category overrides,
 * GPU detection and a cost summary. Pure (no three.js, no DOM), so the
 * settings panel, the renderer and the Node unit tests agree on what a
 * setting means. Modelled on root-and-ruin/web/gfx.js.
 */

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category -> allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],       // RoomEnvironment image-based lighting
  detail: ['plain', 'detailed'],    // brushed-metal / grain textures, clearcoat enamel
  particles: ['low', 'high'],       // spark counts, glowing additive sparks
  background: ['static', 'animated'], // drifting dust motes + lamp shimmer
};

// Each preset is a row of tiers, a render scale and a device-pixel-ratio cap.
const TABLE = {
  low: { scale: 1, maxDpr: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa',
    reflections: 'off', detail: 'plain', particles: 'low', background: 'static' },
  balanced: { scale: 1, maxDpr: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa',
    reflections: 'on', detail: 'detailed', particles: 'high', background: 'static' },
  high: { scale: 1, maxDpr: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa',
    reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
  ultra: { scale: 1.25, maxDpr: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa',
    reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Hardware level (0–20, StarHermit gpu-level.js) at which Auto starts choosing each preset.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

// Per-preset asset and effect budgets, each tuned to hold 60 FPS on the weakest GPU Auto gives that
// preset (Low: level 0 phones / Intel UHD; Balanced: level 4 Iris Xe; High: level 10 GTX 1070; Ultra:
// level 17 RTX 4080). Gameplay is identical on every preset; only these visuals change.
//   geometry  — tile/arrow mesh variant: 'lite' (1 bevel segment, 2-segment corners, 8-sided dots),
//               'standard' (the original meshes) or 'rich' (3 bevel segments, smooth corners and rims)
//   material  — 'lambert' (per-vertex lighting, no textures) or 'pbr' (Standard / Physical)
//   texture   — procedural surface texture size in px (brushed steel; grain ½, workbench 2×); 0 = none
//   sparks    — spark particles per arrow exit / per cleared plate, scaled within the preset by the
//               hardware level (StarHermitGpu.scaleBudget, ≤ 4×) and capped by the pool
//   pool      — spark particle pool size
//   motes     — drifting dust motes when Ambient motion is on
//   bloomRes  — bloom pass resolution as a fraction of the canvas
export const BUDGETS = {
  low: { geometry: 'lite', material: 'lambert', texture: 0, sparks: [6, 24], pool: 160, motes: 0, bloomRes: 0.5 },
  balanced: { geometry: 'standard', material: 'pbr', texture: 128, sparks: [10, 45], pool: 240, motes: 30, bloomRes: 0.5 },
  high: { geometry: 'standard', material: 'pbr', texture: 256, sparks: [18, 90], pool: 400, motes: 70, bloomRes: 0.75 },
  ultra: { geometry: 'rich', material: 'pbr', texture: 512, sparks: [28, 140], pool: 800, motes: 140, bloomRes: 1 },
};

function gpuApi() {
  return typeof globalThis !== 'undefined' ? globalThis.StarHermitGpu : undefined;
}

/** Hardware level 0–20 for a renderer string (+ optional detectSystem() fields such as mobile). */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  if (!G) return 0;
  return G.detectLevel(Object.assign({ webgl: true, webgl2: true }, system || {}, { gpu: String(gpu || '') }));
}

/** Auto preset for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  if (G) return G.presetForLevel(level, LEVELS);
  return PRESETS.filter(p => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (hardware level → preset). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/** The preset's budget, with spark counts scaled for the hardware level within the preset. */
export function budget(preset, level) {
  const b = BUDGETS[preset] || BUDGETS.balanced;
  const G = gpuApi();
  const lv = Number.isFinite(level) ? level : LEVELS[preset];
  const scale = (n) => Math.max(1, Math.min(b.pool, Math.round(G ? G.scaleBudget(n, lv, LEVELS[preset]) : n)));
  return Object.assign({}, b, { sparks: b.sparks.map(scale) });
}

/** Normalise a stored preset name (older saves used auto/low/medium/high). */
export function normalizePreset(v) {
  if (v === 'medium') return 'balanced';
  return PRESETS.includes(v) ? v : 'auto';
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const rs = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, renderScale: rs, scale: row.scale * rs, maxDpr: row.maxDpr };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  out.budget = budget(preset, level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' ||
    out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears every per-category override (scale and toggles are kept). */
export function choosePreset(saved, preset) {
  const s = Object.assign({}, saved || {});
  for (const cat of Object.keys(CATEGORIES)) delete s[cat];
  s.preset = PRESETS.includes(preset) ? preset : 'auto';
  return s;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

const COST_EN = { noShadows: 'no shadows', shadows: 'shadows', reflections: 'reflections', ao: 'ambient occlusion',
  aoHigh: 'full ambient occlusion', bloom: 'bloom', noAA: 'no anti-aliasing' };

/** Cost summary, e.g. "2048² shadows · reflections · bloom · SMAA · 1280×1280 px". `L`: localized labels. */
export function describe(r, pixels, L) {
  const t = Object.assign({}, COST_EN, L || {});
  const parts = [
    r.shadows === 'off' ? t.noShadows : `${SHADOW_MAP[r.shadows]}² ${t.shadows}`,
    r.reflections === 'on' ? t.reflections : null,
    r.ao === 'off' ? null : r.ao === 'high' ? t.aoHigh : t.ao,
    r.bloom === 'on' ? t.bloom : null,
    r.antialias === 'off' ? t.noAA : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
