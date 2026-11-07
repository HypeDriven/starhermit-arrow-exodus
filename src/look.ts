// The look for the frame's graphics level: engine-owned effects from
// levelSettings(), the game's art from js/gfx.js by the level's quality tier,
// its spark counts scaled by the level's particle budget within the tier. The
// renderer and the title's drift and glass read it.
import { frame, levelSettings, type GraphicsLevel, type QualityTier } from "starhermit:engine";
import { loadClassic } from "starhermit:script";
import type { Look } from "./render.js";

loadClassic("js/gfx.js");
const Gfx = (globalThis as unknown as { AXGfx: { resolve(quality: string, k: number, maxTexture: number): Pick<Look, "preset" | "reflections" | "detail" | "particles" | "background" | "budget"> } }).AXGfx;
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

let key = "";
let cur: Look | null = null;
/** The look for this frame (recomputed when the level changes). */
export function look(): Look {
  const level = frame().level;
  if (level !== key || !cur) {
    key = level;
    const s = levelSettings(level);
    cur = {
      ...Gfx.resolve(s.quality, s.particles / levelSettings(ANCHOR[s.quality]).particles, s.maxTextureSize),
      shadows: s.shadows ? s.shadowMapSize : 0,
      ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
      bloom: s.bloom ? s.bloom.resolution : null,
      grade: s.grade,
      antialias: s.antialias,
    };
  }
  return cur;
}
