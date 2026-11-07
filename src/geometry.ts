// The two extruded shapes the board uses, on the engine's Shape +
// ExtrudeGeometry (three.js's): the rounded, bevelled tile slabs (render3d.js
// roundedSlab) and the enamel arrows (arrowShape). UVs are planar from x/z
// (+0.5), as render3d.js rewrote them for the grain textures.
import { ExtrudeGeometry, Shape } from "starhermit:scene";
import type { BufferAttribute, BufferGeometry } from "starhermit:scene";

function planarUv(g: BufferGeometry): BufferGeometry {
  const p = (g.getAttribute("position") as BufferAttribute).array;
  const uv = g.getAttribute("uv") as BufferAttribute;
  const out = new Float32Array((p.length / 3) * 2);
  for (let i = 0, k = 0; i < p.length; i += 3, k += 2) { out[k] = p[i]! + 0.5; out[k + 1] = p[i + 2]! + 0.5; }
  uv.array = out;
  uv.needsUpdate = true;
  return g;
}

/** render3d.js roundedSlab: a rounded, bevelled w × d slab of height h, centred on y = 0. */
export function roundedSlab(w: number, d: number, h: number, r: number, bevel: number, lod: { bevel: number; curve: number }): BufferGeometry {
  const x0 = -w / 2 + bevel, x1 = w / 2 - bevel, z0 = -d / 2 + bevel, z1 = d / 2 - bevel;
  const rr = Math.max(0.001, r - bevel);
  const s = new Shape();
  s.moveTo(x0 + rr, z0);
  s.lineTo(x1 - rr, z0); s.quadraticCurveTo(x1, z0, x1, z0 + rr);
  s.lineTo(x1, z1 - rr); s.quadraticCurveTo(x1, z1, x1 - rr, z1);
  s.lineTo(x0 + rr, z1); s.quadraticCurveTo(x0, z1, x0, z1 - rr);
  s.lineTo(x0, z0 + rr); s.quadraticCurveTo(x0, z0, x0 + rr, z0);
  const depth = h - bevel * 2;
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: lod.bevel, curveSegments: lod.curve });
  g.rotateX(Math.PI / 2);
  g.translate(0, depth / 2, 0);
  return planarUv(g);
}

/** render3d.js's arrow chevron: lying flat, tip toward −z, base at y = 0 (or −bevel). */
export function arrowGeometry(len: number, headW: number, shaftW: number, bevelSegments: number): BufferGeometry {
  const half = len / 2, headLen = headW * 0.9;
  const s = new Shape();
  s.moveTo(-shaftW, -half);
  for (const [x, y] of [[shaftW, -half], [shaftW, half - headLen], [headW, half - headLen], [0, half], [-headW, half - headLen], [-shaftW, half - headLen]] as const) s.lineTo(x, y);
  const g = new ExtrudeGeometry(s, bevelSegments
    ? { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments }
    : { depth: 0.1, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return planarUv(g);
}
