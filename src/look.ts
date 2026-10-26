// The look for the frame's graphics level: js/gfx.js's preset for the
// runtime's quality tier (frame().quality), its budgets scaled by the level
// (frame().levelIndex). The renderer and the title's drift and glass read it.
import { frame } from "starhermit:engine";
import { loadClassic } from "starhermit:script";
import type { Look } from "./render.js";

loadClassic("js/gfx.js");
const Gfx = (globalThis as unknown as { AXGfx: { resolve(quality: string, levelIndex: number): Look } }).AXGfx;

let key = "";
let cur: Look = Gfx.resolve("balanced", 2);
/** The look for this frame (recomputed when the level changes). */
export function look(): Look {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k !== key) { key = k; cur = Gfx.resolve(f.quality, f.levelIndex); }
  return cur;
}
