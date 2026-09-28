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

/** Best preset for this GPU, from the unmasked renderer string when the browser exposes it. */
export function detectPreset(gpu, opts) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?! graphics)|apple m\d/.test(g)) p = 'high';
  // Touch / mobile devices never auto-select above Balanced.
  if (opts && opts.mobile && (p === 'high' || p === 'ultra')) p = 'balanced';
  return p;
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
export function resolve(saved, detected) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const rs = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, renderScale: rs, scale: row.scale * rs, maxDpr: row.maxDpr };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
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
