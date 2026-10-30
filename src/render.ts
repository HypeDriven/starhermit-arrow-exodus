// The plate on starhermit:scene, ported from the browser build's three.js
// presentation layer (js/render3d.js): a machined metal plate of enamel arrow
// tiles at tabletop scale, one warm key light, soft fill, a rim light, seeded
// metal ingots on the workbench, sparks, dust motes and camera shake. It
// consumes immutable rules snapshots and event lists and never mutates game
// state; decorative randomness comes from the decor seed stream.
//
// What changed from three.js, and why:
// - Shape / ExtrudeGeometry (not in the engine) are geometry.ts.
// - Layers do not exist: picking raycasts the piece group only, as before.
// - The EffectComposer chain (GTAO, UnrealBloom, the grade ShaderPass, SMAA /
//   FXAA / canvas MSAA) is renderer.ao / bloom / grade / antialias; the
//   grade's GLSL is the built-in display-space grade with the same curve,
//   tints and vignette.
// - Lights, shadows (the fitted shadow.camera box, bias, normalBias) and the
//   RoomEnvironment(renderer) reflections are the page's own values (engine
//   minor 23+ follows three r155+). r160 scaled scene.environment by each
//   material's envMapIntensity, so each standard material takes the room as
//   its own envMap at the page's intensity.
// - The canvas textures are DataTextures with the page's colour spaces
//   (brushed steel as stored, the workbench sRGB; minor 28 follows colorSpace).
// - Render scale, pixel-ratio cap and adaptive resolution are the runtime's
//   graphics level.
// - The camera aspect is the window's (no setViewOffset): frameBoard moves
//   the camera and pulls it back until the plate fits the part of the window
//   the HUD leaves free, as the square canvas host did.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry,
  DataTexture, DirectionalLight, DoubleSide, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending, Object3D, OrthographicCamera,
  PCFSoftShadowMap, PMREMGenerator, PerspectiveCamera, PlaneGeometry, Points, PointsMaterial, Raycaster, RepeatWrapping,
  ClampToEdgeWrapping, RingGeometry, RoomEnvironment, SRGBColorSpace, SphereGeometry, Vector3, pointerToNdc, renderer, scene,
} from "starhermit:scene";
import type { Material, Texture } from "starhermit:scene";
import { arrowGeometry, roundedSlab } from "./geometry.js";

// -- the shapes the renderer reads ------------------------------------------------------
export interface Piece { id: string; d: number; cells: [number, number][] }
export interface RState { seed: number; cfg: { board: { rows: number; cols: number } }; pieces: Piece[]; bolts: [number, number][] }
export interface REvent { type: string; piece?: string; d?: number; big?: boolean; combo?: number }
export interface Palette { plate: number; plateEdge: number; cell: number; floor: number; enamel: number; enamel2: number; bolt: number; light: number; accent: number; fog: number }
export interface Theme { id: string; palette: Palette }
export interface Look {
  preset: string; shadows: string; shadowMap: number; ao: string; bloom: string; grade: string; antialias: "off" | "fxaa" | "smaa" | "msaa";
  reflections: string; detail: string; particles: string; background: string;
  budget: { geometry: string; material: string; texture: number; sparks: number[]; pool: number; motes: number; bloomRes: number };
}
interface Rng { next(): number }
interface RngApi { derive(seed: number, stream: number): Rng; STREAM_DECOR: number }
/** The part of the window the plate may use, in normalized device coordinates (y up). */
export interface Frame { x0: number; y0: number; x1: number; y1: number }

const PI = Math.PI;
const CELL = 1.06;            // world units per board cell
const PLATE_TOP = 0.55;       // y of the plate surface
// world direction per facing: 0 up(-z) 1 right(+x) 2 down(+z) 3 left(-x)
const DIRV = [new Vector3(0, 0, -1), new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(-1, 0, 0)];
// arrow geometry's tip points -z at rest (facing 0)
const DIR_ROTY = [0, -PI / 2, PI, PI / 2];

// ---------- procedural surface textures (deterministic value noise) ----------
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function dataTex(size: number, paint: (d: Uint8Array, n: number) => void, wrap = true): DataTexture {
  const px = new Uint8Array(size * size * 4);
  paint(px, size);
  const t = new DataTexture(px, size, size);
  t.wrapS = t.wrapT = wrap ? RepeatWrapping : ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}
interface Texs { brushed: DataTexture | null; grain: DataTexture | null; bench: DataTexture | null }
function makeTextures(size: number): Texs {
  // Sizes follow the preset budget: brushed steel `size`, grain size/2, workbench 2×size.
  if (!size) return { brushed: null, grain: null, bench: null };
  const k = size / 256; // patterns are authored at 256 px; feature sizes scale with the texture
  // brushed steel: long horizontal streaks, roughness + a faint colour modulation
  const brushed = dataTex(size, (d, n) => {
    for (let y = 0; y < n; y++) {
      const yy = Math.floor(y / k);
      const row = hash2(0, yy) * 0.5 + hash2(1, yy >> 1) * 0.3;
      for (let x = 0; x < n; x++) {
        const v = 0.72 + row * 0.22 + hash2(Math.floor(x / k) >> 5, yy) * 0.06;
        const i = (y * n + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255); d[i + 3] = 255;
      }
    }
  });
  // fine grain for enamel / cell inlays (roughness variation only)
  const grain = dataTex(size / 2, (d, n) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 0.8 + hash2(x + 7, y + 3) * 0.2;
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255); d[i + 3] = 255;
    }
  });
  // workbench: pool of lamp light fading to the corners, with wood-like grain (an sRGB color map)
  const bench = dataTex(size * 2, (d, n) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / n - 0.5, v = y / n - 0.5;
      const r = Math.sqrt(u * u + v * v * 1.4);
      const pool = 1 - Math.min(1, Math.max(0, (r - 0.05) / 0.42));
      const by = Math.floor(y / k);
      const streak = hash2(0, by >> 1) * 0.5 + hash2(Math.floor(x / k) >> 6, by) * 0.5;
      const val = (0.35 + 0.65 * pool * pool) * (0.86 + streak * 0.14);
      const i = (y * n + x) * 4;
      d[i] = Math.round(Math.min(1, val * 1.04) * 255);
      d[i + 1] = Math.round(val * 255);
      d[i + 2] = Math.round(val * 0.94 * 255);
      d[i + 3] = 255;
    }
  }, false);
  bench.colorSpace = SRGBColorSpace;
  return { brushed, grain, bench };
}

// Mesh detail per preset budget ('lite' | 'standard' | 'rich'); 'standard' is the original set.
const GEO_LOD: Record<string, { bevel: number; curve: number; arrowBevel: number; dot: [number, number]; ring: number; bolt: number; stud: number }> = {
  lite: { bevel: 1, curve: 2, arrowBevel: 0, dot: [8, 6], ring: 16, bolt: 6, stud: 6 },
  standard: { bevel: 2, curve: 4, arrowBevel: 1, dot: [10, 8], ring: 24, bolt: 6, stud: 8 },
  rich: { bevel: 3, curve: 8, arrowBevel: 3, dot: [16, 12], ring: 48, bolt: 12, stud: 16 },
};
type Geos = Record<"arrow" | "arrowBig" | "tile" | "tileTop" | "tileBigH" | "tileBigHTop" | "tileBigV" | "tileBigVTop" | "cell" | "bolt" | "boltSlot" | "marker" | "dot" | "stud", BufferGeometry>;
function geoCache(variant: string): Geos {
  const L = GEO_LOD[variant] ?? GEO_LOD.standard!;
  return {
    arrow: arrowGeometry(0.62, 0.17, 0.085, L.arrowBevel),
    arrowBig: arrowGeometry(0.7, 0.2, 0.1, L.arrowBevel),
    tile: roundedSlab(0.92, 0.92, 0.16, 0.1, 0.025, L),
    tileTop: roundedSlab(0.8, 0.8, 0.06, 0.08, 0.018, L),
    tileBigH: roundedSlab(0.92 * 2 + 0.1, 0.92, 0.16, 0.1, 0.025, L),
    tileBigHTop: roundedSlab(0.8 * 2 + 0.18, 0.8, 0.06, 0.08, 0.018, L),
    tileBigV: roundedSlab(0.92, 0.92 * 2 + 0.1, 0.16, 0.1, 0.025, L),
    tileBigVTop: roundedSlab(0.8, 0.8 * 2 + 0.18, 0.06, 0.08, 0.018, L),
    cell: new PlaneGeometry(0.96, 0.96),
    bolt: new CylinderGeometry(0.3, 0.34, 0.18, L.bolt),
    boltSlot: new BoxGeometry(0.34, 0.05, 0.07),
    marker: new RingGeometry(0.3, 0.4, L.ring),
    dot: new SphereGeometry(0.07, L.dot[0], L.dot[1]),
    stud: new CylinderGeometry(0.09, 0.11, 0.08, L.stud),
  };
}

// ---------- tiny deterministic tween manager ----------
interface Tween { dur: number; ease?: (k: number) => number; onUpdate(k: number): void; onDone?: () => void; tag?: string; t?: number }
const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3);
const easeIn = (k: number): number => k * k * k;
class Tweens {
  list: Tween[] = [];
  add(t: Tween): void { t.t = 0; if (t.tag) this.kill(t.tag); this.list.push(t); }
  kill(tag: string): void { for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.tag === tag) this.list.splice(i, 1); }
  tick(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i]!;
      tw.t = (tw.t ?? 0) + dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.onUpdate((tw.ease || easeInOut)(k));
      if (k >= 1) { this.list.splice(i, 1); if (tw.onDone) tw.onDone(); }
    }
  }
  finishAll(): void { const l = this.list; this.list = []; for (const tw of l) { tw.onUpdate(1); if (tw.onDone) tw.onDone(); } }
  get busy(): boolean { return this.list.length > 0; }
}

// ---------- pooled particle bursts (never raycast) ----------
class Particles {
  cap: number; pos: Float32Array; vel: Float32Array; life: Float32Array; col: Float32Array;
  points: Points; cursor = 0; boost = 1; active: number;
  constructor(capacity: number) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -999;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(this.pos, 3));
    g.setAttribute("color", new BufferAttribute(this.col, 3));
    this.points = new Points(g, new PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.active = capacity;
  }
  setPool(n: number): void {
    this.active = Math.max(1, Math.min(this.cap, n));
    for (let i = this.active; i < this.cap; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -999; }
    if (this.cursor >= this.active) this.cursor = 0;
    this.points.geometry.setDrawRange(0, this.active);
    this.upload(true, false);
  }
  /** high: additive glowing sparks; boost > 1 pushes colours into the bloom range. */
  setMode(high: boolean, boost: number): void {
    const m = this.points.material;
    m.blending = high ? AdditiveBlending : NormalBlending;
    m.size = high ? 0.085 : 0.07;
    m.toneMapped = boost <= 1;
    this.boost = boost;
  }
  burst(p: Vector3, color: number, n: number, spread: number, up: number): void {
    const c = new Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.active;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const a = Math.random() * PI * 2, r = Math.random() * spread;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = Math.random() * up + 0.8;
      this.vel[i * 3 + 2] = Math.sin(a) * r * 0.5;
      this.life[i] = 0.7 + Math.random() * 0.4;
      const b = this.boost * (0.7 + Math.random() * 0.6);
      this.col[i * 3] = c.r * b; this.col[i * 3 + 1] = c.g * b; this.col[i * 3 + 2] = c.b * b;
    }
    this.upload(true, true);
  }
  tick(dt: number): void {
    let any = false;
    for (let i = 0; i < this.active; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.vel[i * 3 + 1]! -= 4.5 * dt;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
    }
    if (any) this.upload(true, false);
  }
  /** Attributes are copied when set: hand the arrays over again. */
  upload(pos: boolean, col: boolean): void {
    const g = this.points.geometry;
    if (pos) { const a = g.getAttribute("position")!; a.array = this.pos; a.needsUpdate = true; }
    if (col) { const a = g.getAttribute("color")!; a.array = this.col; a.needsUpdate = true; }
  }
}

// ---------- the scene ----------
const camera = new PerspectiveCamera(36, 1, 0.1, 100);
const VIEW = new Vector3(0, 0.82, 0.62).normalize(); // the camera's direction from its target (render3d.js camBase)
const camBase = new Vector3(0, 7.5, 8.5);
const camTarget = new Vector3(0, 0.4, 0);
let camShake = 0;
let fit: Frame = { x0: -1, y0: -1, x1: 1, y1: 1 };
let fitKey = "";

const envGroup = new Group();
const boardGroup = new Group();
const pieceGroup = new Group();
const selGroup = new Group();
const root = new Group();
root.add(envGroup, boardGroup, pieceGroup, selGroup);

const KEY_BASE = 2.6;
const keyLight = new DirectionalLight(0xffe0b0, KEY_BASE);
keyLight.position.set(4, 8, 5);
keyLight.shadow.bias = -0.002;
const shadowCam = keyLight.shadow.camera as OrthographicCamera;
shadowCam.left = -8; shadowCam.right = 8; shadowCam.top = 8; shadowCam.bottom = -8;
const fillLight = new HemisphereLight(0xfff0dd, 0x1a2028, 0.55);
const rimLight = new DirectionalLight(0xffdcb0, 0.5);
rimLight.position.set(-5, 4, -4);

const tweens = new Tweens();
let particles: Particles | null = null;
const MOTES = 140;
let moteCount = 0;
const motePos = new Float32Array(MOTES * 3), moteSeed = new Float32Array(MOTES * 3);
for (let i = 0; i < MOTES; i++) { moteSeed[i * 3] = hash2(i, 1); moteSeed[i * 3 + 1] = hash2(i, 2); moteSeed[i * 3 + 2] = hash2(i, 3); }
let motes: Points | null = null;

let q: Look | null = null;
let geos: Geos | null = null;
let geoVariant = "";
let texSize = -1;
let texs: Texs = { brushed: null, grain: null, bench: null };
const mats: Record<string, Material> = {};
let envTex: Texture | null = null;
let theme: Theme | null = null;
let rng: RngApi | null = null;
let reducedMotion = false;
let cursorRing: Mesh | null = null;

interface PieceMesh { group: Group; big: boolean }
let pieceMeshes = new Map<string, PieceMesh>();
let freeDots = new Map<string, Mesh>();
let boltMeshes: Group[] = [];
const cellPos = new Map<string, Vector3>();
let curState: RState | null = null;
let hintMeshes: Mesh[] = [];
let boardDims = { w: 6, h: 6 };
let clockT = 0;
let pulseT = 0;
let built = false;

const cellKey = (r: number, c: number): string => r + ":" + c;

function build(): void {
  if (built) return;
  built = true;
  scene.add(root, keyLight, keyLight.target, fillLight, rimLight);
  particles = new Particles(800); // the largest budget's pool; the preset sets the active size
  const mg = new BufferGeometry();
  mg.setAttribute("position", new BufferAttribute(motePos, 3));
  motes = new Points(mg, new PointsMaterial({ color: 0xffe2b8, size: 0.028, transparent: true, opacity: 0.28, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true }));
  motes.frustumCulled = false;
  motes.visible = false;
  scene.add(motes);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

/** Shows or hides the plate (the title and menus draw over nothing). */
export function setVisible(on: boolean): void {
  renderer.camera = on ? camera : null;
}
export function init(rngApi: RngApi): void { rng = rngApi; }

// ---------- theme / materials ----------
export function setTheme(th: Theme): void {
  theme = th;
  if (!q) return;
  const p = th.palette;
  scene.background = new Color(p.fog);
  scene.fog = null;
  keyLight.color.set(p.light);
  rimLight.color.set(p.accent);
  buildMaterials(p);
  buildEnv();
  if (curState) buildBoard(curState);
}

function buildMaterials(p: Palette): void {
  if (!q) return;
  for (const k of Object.keys(mats)) { mats[k]!.dispose(); delete mats[k]; }
  const det = q.detail === "detailed" && !!texs.brushed;
  const env = q.reflections === "on";
  // Low budget: Lambert with no texture maps unless detail/reflections are switched on.
  const lambert = q.budget.material === "lambert" && !det && !env;
  const std = (o: { color: number | Color; roughness: number; metalness?: number; map?: Texture | null; roughnessMap?: Texture | null }, envI: number): Material => {
    if (lambert) return new MeshLambertMaterial({ color: o.color });
    const m = new MeshStandardMaterial({ color: o.color, roughness: o.roughness, metalness: o.metalness ?? 0, map: o.map ?? null, roughnessMap: o.roughnessMap ?? null });
    m.envMapIntensity = envI;
    if (env) m.envMap = envTex;
    return m;
  };
  mats.plate = std({ color: p.plate, roughness: det ? 0.5 : 0.45, metalness: 0.75, roughnessMap: det ? texs.brushed : null, map: det ? texs.brushed : null }, 0.55);
  if (det) mats.plate.color.multiplyScalar(1.15);
  mats.plateEdge = std({ color: p.plateEdge, roughness: 0.6, metalness: 0.6, roughnessMap: det ? texs.brushed : null }, 0.5);
  mats.cell = std({ color: p.cell, roughness: 0.7, metalness: 0.5, roughnessMap: det ? texs.grain : null }, 0.4);
  mats.floor = std({ color: det ? new Color(p.floor).multiplyScalar(1.5) : p.floor, roughness: 0.95, map: det ? texs.bench : null }, 0.35);
  const enamel = (c: number): Material => {
    if (det && !lambert) {
      const m = new MeshPhysicalMaterial({ color: c, roughness: 0.34, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.18, roughnessMap: texs.grain });
      m.envMapIntensity = 0.22;
      if (env) m.envMap = envTex;
      return m;
    }
    return std({ color: c, roughness: 0.3, metalness: 0.05 }, 0.3);
  };
  mats.enamel = enamel(p.enamel);
  mats.enamel2 = enamel(p.enamel2);
  mats.bolt = std({ color: p.bolt, roughness: 0.35, metalness: 0.85, roughnessMap: det ? texs.brushed : null }, 0.6);
  mats.tile = std({ color: p.plateEdge, roughness: 0.5, metalness: 0.7 }, 0.5);
  // chevrons stay dark against the enamel so direction always reads first
  mats.chevron = std({ color: env ? 0x0d0f12 : p.plateEdge, roughness: env ? 0.4 : 0.5, metalness: env ? 0.6 : 0.7 }, 0.25);
  const glow = new MeshBasicMaterial({ color: p.accent, transparent: true, opacity: 0.9 });
  if (q.bloom === "on") { // HDR so only the free markers and sparks cross the bloom threshold
    glow.color.multiplyScalar(5);
    glow.toneMapped = false;
  }
  mats.freeGlow = glow;
  particles!.setMode(q.particles === "high", q.bloom === "on" ? 4 : 1);
}

// ---------- environment (deterministic decor from the decor stream) ----------
function clear(g: Group): void { while (g.children.length) g.remove(g.children[g.children.length - 1]!); }
const decorGeos: BufferGeometry[] = [];
function buildEnv(): void {
  clear(envGroup);
  for (const g of decorGeos.splice(0)) g.dispose();
  const floorGeo = new PlaneGeometry(50, 40);
  decorGeos.push(floorGeo);
  const floor = new Mesh(floorGeo, mats.floor!);
  floor.rotation.x = -PI / 2; floor.receiveShadow = true;
  envGroup.add(floor);
  // seeded decor: small metal ingots scattered beside the plate
  if (curState && rng) {
    const drng = rng.derive(curState.seed, rng.STREAM_DECOR);
    for (let i = 0; i < 5; i++) {
      const w = 0.35 + drng.next() * 0.4;
      const g = new BoxGeometry(w, w * 0.5, w * 0.7);
      decorGeos.push(g);
      const ingot = new Mesh(g, drng.next() > 0.5 ? mats.plateEdge! : mats.bolt!);
      const side = i % 2 ? 1 : -1;
      ingot.position.set(side * (boardDims.w / 2 + 1.6 + drng.next() * 1.4), w * 0.25, -2 + drng.next() * 4);
      ingot.rotation.y = drng.next() * 1.2;
      ingot.castShadow = ingot.receiveShadow = true;
      envGroup.add(ingot);
    }
  }
}

// ---------- board construction ----------
function layout(cfg: RState["cfg"]): { pos: Map<string, Vector3>; w: number; h: number } {
  const { rows, cols } = cfg.board;
  const pos = new Map<string, Vector3>();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pos.set(cellKey(r, c), new Vector3((c - (cols - 1) / 2) * CELL, PLATE_TOP, (r - (rows - 1) / 2) * CELL));
  return { pos, w: cols * CELL, h: rows * CELL };
}
const boardGeos: BufferGeometry[] = [];

function boltGroup(p: Vector3): Group {
  const grp = new Group();
  const head = new Mesh(geos!.bolt, mats.bolt!);
  head.position.y = 0.09; head.castShadow = true;
  const slot = new Mesh(geos!.boltSlot, mats.plateEdge!);
  slot.position.y = 0.19;
  grp.add(head, slot);
  grp.position.copy(p);
  return grp;
}

export function buildBoard(state: RState): void {
  build();
  curState = state;
  if (!q || !geos || !theme) return;
  tweens.list = [];
  clear(pieceGroup);
  pieceMeshes = new Map();
  clear(selGroup);
  freeDots = new Map();
  hintMeshes = [];
  boltMeshes = [];
  clear(boardGroup);
  for (const g of boardGeos.splice(0)) g.dispose();
  cellPos.clear();

  const L = layout(state.cfg);
  const fresh = boardDims.w !== L.w + 1.2 || boardDims.h !== L.h + 1.2;
  boardDims = { w: L.w + 1.2, h: L.h + 1.2 };
  if (fresh) fitKey = "";

  // machined plate with a raised rim
  const rimGeo = new BoxGeometry(L.w + 1.1, PLATE_TOP, L.h + 1.1), plateGeo = new BoxGeometry(L.w + 0.5, 0.12, L.h + 0.5);
  boardGeos.push(rimGeo, plateGeo);
  const rim = new Mesh(rimGeo, mats.plateEdge!);
  rim.position.y = PLATE_TOP / 2;
  rim.castShadow = rim.receiveShadow = true;
  boardGroup.add(rim);
  const plate = new Mesh(plateGeo, mats.plate!);
  plate.position.y = PLATE_TOP - 0.06;
  plate.receiveShadow = true;
  boardGroup.add(plate);

  // corner studs (instanced)
  const studs = new InstancedMesh(geos.stud, mats.bolt!, 4);
  const m4 = new Matrix4();
  ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).forEach(([sx, sz], i) => {
    m4.makeTranslation(sx * (L.w / 2 + 0.32), PLATE_TOP + 0.02, sz * (L.h / 2 + 0.32));
    studs.setMatrixAt(i, m4);
  });
  studs.instanceMatrix.needsUpdate = true;
  boardGroup.add(studs);

  // recessed cell inlays
  for (const [key, p] of L.pos) {
    const inlay = new Mesh(geos.cell, mats.cell!);
    inlay.rotation.x = -PI / 2;
    inlay.position.copy(p); inlay.position.y += 0.001;
    inlay.receiveShadow = true;
    boardGroup.add(inlay);
    cellPos.set(key, p.clone());
  }

  // bolts
  for (const [r, c] of state.bolts) {
    const p = L.pos.get(cellKey(r, c));
    if (!p) continue;
    const grp = boltGroup(p);
    boardGroup.add(grp);
    boltMeshes.push(grp);
  }

  for (const piece of state.pieces) placePiece(piece, true);
  buildEnv();
  fitShadow();
  if (!cursorRing) {
    cursorRing = new Mesh(geos.marker, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }));
    cursorRing.rotation.x = -PI / 2;
    cursorRing.scale.setScalar(1.15);
    cursorRing.noAO = true;
    root.add(cursorRing);
  }
  cursorRing.material.opacity = 0;
}

function pieceCenter(piece: Piece): Vector3 {
  const L = layout(curState!.cfg);
  const p = new Vector3();
  for (const [r, c] of piece.cells) p.add(L.pos.get(cellKey(r, c))!);
  return p.multiplyScalar(1 / piece.cells.length);
}

function makePieceMesh(piece: Piece): Group {
  const g = geos!;
  const big = piece.cells.length > 1;
  const grp = new Group();
  const horiz = big && piece.cells[0]![0] === piece.cells[1]![0];
  const tile = new Mesh(big ? (horiz ? g.tileBigH : g.tileBigV) : g.tile, mats.tile!);
  tile.position.y = 0.08; tile.castShadow = tile.receiveShadow = true;
  const top = new Mesh(big ? (horiz ? g.tileBigHTop : g.tileBigVTop) : g.tileTop, big ? mats.enamel2! : mats.enamel!);
  top.position.y = 0.17;
  const arrow = new Mesh(big ? g.arrowBig : g.arrow, mats.chevron!);
  arrow.position.y = 0.2;
  arrow.rotation.y = DIR_ROTY[piece.d]!;
  grp.add(tile, top, arrow);
  if (big) { // second chevron reinforces the span
    const arrow2 = new Mesh(g.arrowBig, mats.chevron!);
    arrow2.rotation.y = DIR_ROTY[piece.d]!;
    const off = DIRV[piece.d]!.clone().multiplyScalar(-0.5);
    arrow.position.copy(off.clone().multiplyScalar(0.45)); arrow.position.y = 0.2;
    arrow2.position.copy(off.multiplyScalar(-0.45)); arrow2.position.y = 0.2;
    grp.add(arrow2);
  }
  grp.userData.pieceId = piece.id;
  return grp;
}

function placePiece(piece: Piece, instant: boolean): void {
  const g = makePieceMesh(piece);
  g.position.copy(pieceCenter(piece));
  pieceGroup.add(g);
  pieceMeshes.set(piece.id, { group: g, big: piece.cells.length > 1 });
  if (!instant && !reducedMotion) {
    const targetY = g.position.y;
    g.position.y = targetY + 1.8;
    tweens.add({ dur: 0.35, ease: easeOut, tag: "drop:" + piece.id, onUpdate: (k) => { g.position.y = targetY + 1.8 * (1 - k); } });
  }
}

function removePieceMesh(id: string): void {
  const e = pieceMeshes.get(id);
  if (e) { pieceGroup.remove(e.group); pieceMeshes.delete(id); }
  const dot = freeDots.get(id);
  if (dot) { selGroup.remove(dot); freeDots.delete(id); }
}

function sparkCount(i: number): number {
  const n = q!.budget.sparks[i]!;
  return q!.particles === "low" ? Math.max(1, Math.round(n / 3)) : n;
}

// ---------- state sync: compares the snapshot to the mirrored meshes, animates differences ----------
export function syncState(state: RState, events: REvent[] | null, instant: boolean, freeIds: string[]): void {
  curState = state;
  if (!q || !geos || !theme) return;
  const evs = events || [];
  const seen = new Set(state.pieces.map((p) => p.id));
  // pieces that vanished without an exit event (e.g. undo restore)
  for (const [id] of pieceMeshes) if (!seen.has(id) && !evs.some((e) => e.type === "exit" && e.piece === id)) removePieceMesh(id);

  for (const ev of evs) {
    if (ev.type === "exit") {
      const e = pieceMeshes.get(ev.piece!);
      if (!e) continue;
      pieceMeshes.delete(ev.piece!);
      const dot = freeDots.get(ev.piece!);
      if (dot) { selGroup.remove(dot); freeDots.delete(ev.piece!); }
      const dir = DIRV[ev.d!]!;
      const dist = Math.max(boardDims.w, boardDims.h) + 2;
      if (instant || reducedMotion) pieceGroup.remove(e.group);
      else {
        const start = e.group.position.clone();
        const spin = ev.big ? 0.6 : 1.4;
        tweens.add({
          dur: 0.5, ease: easeIn, tag: "exit:" + ev.piece,
          onUpdate: (k) => {
            e.group.position.copy(start).addScaledVector(dir, k * dist);
            e.group.position.y = start.y + Math.sin(k * PI * 0.5) * 1.2;
            e.group.rotation.y = DIR_ROTY[ev.d!]! + k * spin;
          },
          onDone: () => { pieceGroup.remove(e.group); },
        });
        const edgeP = start.clone().addScaledVector(dir, boardDims.w * 0.4);
        particles!.burst(edgeP, theme.palette.accent, sparkCount(0), 1.2, 1.4);
      }
      if (!reducedMotion) camShake = Math.max(camShake, ev.big ? 0.08 : 0.04);
    } else if (ev.type === "blocked") {
      const e = pieceMeshes.get(ev.piece!);
      if (e && !instant && !reducedMotion) {
        const perp = new Vector3(DIRV[ev.d!]!.z, 0, -DIRV[ev.d!]!.x);
        const base = e.group.position.clone();
        tweens.add({
          dur: 0.3, ease: (k) => k, tag: "shake:" + ev.piece,
          onUpdate: (k) => { e.group.position.copy(base).addScaledVector(perp, Math.sin(k * PI * 6) * 0.09 * (1 - k)); },
          onDone: () => { e.group.position.copy(base); },
        });
      }
    } else if (ev.type === "wave") {
      // fresh plate arrived; pieces drop in
      for (const piece of state.pieces) if (!pieceMeshes.has(piece.id)) placePiece(piece, instant);
      for (const b of boltMeshes) boardGroup.remove(b);
      boltMeshes = [];
      const L = layout(state.cfg);
      for (const [r, c] of state.bolts) {
        const p = L.pos.get(cellKey(r, c));
        if (!p) continue;
        const grp = boltGroup(p);
        boardGroup.add(grp);
        boltMeshes.push(grp);
      }
      if (!reducedMotion) camShake = Math.max(camShake, 0.06);
    } else if (ev.type === "win") {
      particles!.burst(new Vector3(0, 1.4, 0), 0xffd070, sparkCount(1), 3.4, 2.8);
      if (!reducedMotion) camShake = Math.max(camShake, 0.12);
    } else if (ev.type === "lose") {
      if (!reducedMotion) camShake = Math.max(camShake, 0.15);
    }
  }
  // reconcile: any piece present in state but without a mesh (e.g. undo)
  for (const piece of state.pieces) if (!pieceMeshes.has(piece.id)) placePiece(piece, true);
  updateFreeMarkers(freeIds);
}

/** Soft glow dots over every arrow with a clear lane. */
function updateFreeMarkers(ids: string[]): void {
  const want = new Set(ids);
  for (const [id, dot] of freeDots) if (!want.has(id)) { selGroup.remove(dot); freeDots.delete(id); }
  for (const id of want) {
    if (freeDots.has(id)) continue;
    const e = pieceMeshes.get(id);
    if (!e) continue;
    const dot = new Mesh(geos!.dot, mats.freeGlow!);
    dot.position.copy(e.group.position);
    dot.position.y += e.big ? 0.55 : 0.48;
    dot.noAO = true;
    selGroup.add(dot);
    freeDots.set(id, dot);
  }
}

// ---------- hint / cursor ----------
export function setHint(pieceId: string): void {
  clearHint();
  const e = pieceMeshes.get(pieceId);
  if (!e || !geos) return;
  const ring = new Mesh(geos.marker, new MeshBasicMaterial({ color: 0x7fb0ff, transparent: true, opacity: 0.95, side: DoubleSide, depthWrite: false }));
  ring.rotation.x = -PI / 2;
  ring.position.copy(e.group.position);
  ring.position.y = PLATE_TOP + 0.02;
  if (e.big) ring.scale.setScalar(1.6);
  ring.noAO = true;
  selGroup.add(ring);
  hintMeshes.push(ring);
}
export function clearHint(): void {
  for (const m of hintMeshes) { selGroup.remove(m); m.material.dispose(); }
  hintMeshes = [];
}
/** The keyboard / gamepad focus ring on a cell [r, c], or none. */
export function setCursor(cell: [number, number] | null): void {
  if (!cursorRing) return;
  const p = cell ? cellPos.get(cellKey(cell[0], cell[1])) : undefined;
  if (!p) { cursorRing.material.opacity = 0; return; }
  cursorRing.position.copy(p);
  cursorRing.position.y += 0.02;
  cursorRing.material.opacity = 0.75;
}

// ---------- picking ----------
const raycaster = new Raycaster();
/** The piece under a window pixel (one still in the state; not mid-flight), or null. */
export function pickPiece(x: number, y: number): string | null {
  if (!renderer.camera) return null;
  raycaster.setFromCamera(pointerToNdc(x, y), camera);
  const hits = raycaster.intersectObjects(pieceGroup.children, true);
  for (const hit of hits) {
    let o: Object3D | null = hit.object;
    while (o && !o.userData.pieceId) o = o.parent;
    const id = o ? String(o.userData.pieceId) : null;
    if (id && pieceMeshes.has(id)) return id;
  }
  return null;
}

// ---------- the camera ----------
/** Fits the plate (rim and tiles) into `frame` (NDC, y up): pulls the camera
 * back until every corner is inside, and slides it across its view until the
 * plate is centred there. */
export function frameBoard(frame: Frame, aspect: number): void {
  const key = [frame.x0, frame.y0, frame.x1, frame.y1, aspect, boardDims.w, boardDims.h].map((n) => n.toFixed(4)).join(",");
  if (key === fitKey) return;
  fitKey = key;
  fit = frame;
  // minor 20+: the camera renders and projects with its own aspect (three parity)
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const hw = boardDims.w / 2, hh = boardDims.h / 2;
  const pts: Vector3[] = [];
  for (const x of [-hw, hw]) for (const z of [-hh, hh]) for (const y of [0, PLATE_TOP + 0.3]) pts.push(new Vector3(x, y, z));
  const right = new Vector3(1, 0, 0);
  const up = new Vector3(0, VIEW.z, -VIEW.y); // the view's up, perpendicular to its axis
  const rw = (frame.x1 - frame.x0) / 2, rh = (frame.y1 - frame.y0) / 2;
  const cx = (frame.x0 + frame.x1) / 2, cy = (frame.y0 + frame.y1) / 2;
  const tanHalf = Math.tan((camera.fov * PI / 180) / 2);
  let d = 6;
  let ox = 0, oy = 0;
  const _v = new Vector3();
  const target = new Vector3();
  for (let i = 0; i < 60; i++) {
    target.set(0, 0.3, 0.3).addScaledVector(right, ox).addScaledVector(up, oy);
    camera.position.copy(target).addScaledVector(VIEW, d);
    camera.lookAt(target);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      _v.copy(p).project(camera);
      minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x); minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
    }
    const over = Math.max((maxX - minX) / 2 / (rw * 0.94), (maxY - minY) / 2 / (rh * 0.94));
    const ex = cx - (minX + maxX) / 2, ey = cy - (minY + maxY) / 2;
    if (over > 1.001) { d *= Math.min(1.6, over + 0.02); continue; }
    if (over < 0.97 && i < 30) { d *= Math.max(0.7, over + 0.01); continue; }
    if (Math.abs(ex) < 0.002 && Math.abs(ey) < 0.002) break;
    // Sliding camera and target by Δ moves the image by -Δ / half the view's extent there.
    ox -= ex * tanHalf * d * aspect;
    oy -= ey * tanHalf * d;
  }
  camera.far = Math.max(100, d * 4);
  camera.updateProjectionMatrix();
  camBase.copy(camera.position);
  camTarget.copy(target);
}
export function currentFit(): Frame { return fit; }

// ---------- graphics ----------
/** Shadow box fitted tightly around the plate and the decor beside it (render3d.js fitShadow). */
function fitShadow(): void {
  const cam = shadowCam;
  keyLight.target.position.set(0, 0, 0);
  keyLight.target.updateMatrixWorld();
  keyLight.updateMatrixWorld();
  const view = new Matrix4().lookAt(keyLight.position, keyLight.target.position, new Vector3(0, 1, 0));
  view.setPosition(keyLight.position).invert();
  const hx = boardDims.w / 2 + 3.2, hz = boardDims.h / 2 + 2.2;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const v = new Vector3();
  for (const x of [-hx, hx]) for (const y of [0, 2.2]) for (const z of [-hz, hz]) {
    v.set(x, y, z).applyMatrix4(view);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  cam.left = minX; cam.right = maxX; cam.top = maxY; cam.bottom = minY;
  cam.near = Math.max(0.1, -maxZ - 1); cam.far = -minZ + 1;
  cam.updateProjectionMatrix();
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.02;
}

/** The page's reflections: RoomEnvironment(renderer) prefiltered once (sigma 0.04). */
function buildEnvironment(): void {
  if (envTex) return;
  try {
    const envRoom = new RoomEnvironment(renderer); envRoom.position.y = 0; /* the page's three (pre-r183) builds the room at the origin */ envTex = new PMREMGenerator(renderer).fromScene(envRoom, 0.04).texture;
  } catch (e) {
    console.warn("environment:", e instanceof Error ? e.message : String(e));
  }
}

/** Applies the look for the frame's graphics level (js/gfx.js resolve); cheap when unchanged. */
export function applyLook(next: Look): void {
  if (q && JSON.stringify(q) === JSON.stringify(next)) return;
  build();
  q = next;
  const b = next.budget;
  particles!.setPool(b.pool);
  moteCount = Math.min(MOTES, b.motes);
  motes!.geometry.setDrawRange(0, moteCount);
  const ts = b.texture || (next.detail === "detailed" ? 128 : 0);
  if (ts !== texSize) {
    for (const t of Object.values(texs)) t?.dispose();
    texSize = ts;
    texs = makeTextures(ts);
  }
  if (b.geometry !== geoVariant) {
    const old = geos;
    geos = geoCache(b.geometry);
    geoVariant = b.geometry;
    if (cursorRing) cursorRing.geometry = geos.marker;
    if (old) for (const g of Object.values(old)) g.dispose();
  }
  const shadows = next.shadowMap > 0;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  keyLight.castShadow = shadows;
  if (shadows) keyLight.shadow.mapSize = next.shadowMap;
  if (next.reflections === "on") {
    buildEnvironment();
    scene.environment = envTex;
    fillLight.intensity = 0.2; // image-based light supplies most of the fill
  } else {
    scene.environment = null;
    fillLight.intensity = 0.55;
  }
  const aoHigh = next.ao === "high";
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.7, radius: 0.35, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: aoHigh ? 16 : 8,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: aoHigh ? 6 : 4, rings: 2, samples: aoHigh ? 16 : 8, radiusExponent: 2 },
  };
  // high threshold: only the HDR free markers, sparks and specular glints bloom
  // the page's r160 UnrealBloomPass exactly (model "r160", strength 0.45 as written)
  renderer.bloom = next.bloom === "on" ? { model: "r160", strength: 0.45, radius: 0.35, threshold: 1.6, resolution: b.bloomRes } : null;
  // render3d.js GradeShader after OutputPass: a gentle S-curve (contrastCurve "s", 0.22 of c²(3−2c)),
  // a touch more saturation, cool shadows / warm highlights, a soft vignette.
  renderer.grade = next.grade === "on" ? {
    space: "display", contrastCurve: "s", contrast: 0.22, saturation: 1.1,
    shadows: [0.95, 0.98, 1.05], highlights: [1.04, 1.0, 0.95], split: [0.15, 0.75],
    vignette: { amount: 0.26, inner: 0.3, outer: 0.8, scale: [1, 0.9] },
  } : null;
  renderer.antialias = next.antialias;
  if (theme) setTheme(theme); // materials and the board pick up detail / env / geometry changes
  applyMotion();
}

function applyMotion(): void {
  if (motes && q) motes.visible = q.background === "animated" && !reducedMotion && moteCount > 0;
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; applyMotion(); }
export function skipAll(): void { tweens.finishAll(); }
export function isBusy(): boolean { return tweens.busy; }

// ---------- per frame ----------
export function update(dtRaw: number): void {
  if (!q || !renderer.camera) return;
  const dt = Math.min(0.05, dtRaw || 0.016);
  tweens.tick(dt);
  particles!.tick(dt);
  pulseT += dt;
  // ambient life: dust motes and a faint lamp shimmer (static under reduced motion)
  if (motes!.visible) {
    clockT += dt;
    const W = boardDims.w + 2, H = boardDims.h + 2;
    for (let i = 0; i < moteCount; i++) {
      const a = moteSeed[i * 3]!, b = moteSeed[i * 3 + 1]!, c = moteSeed[i * 3 + 2]!;
      const rise = (clockT * (0.04 + c * 0.05) + b) % 1;
      motePos[i * 3] = (a - 0.5) * W + Math.sin(clockT * 0.3 + c * 20) * 0.35;
      motePos[i * 3 + 1] = PLATE_TOP + 0.3 + rise * 2.4;
      motePos[i * 3 + 2] = (b - 0.5) * H + Math.cos(clockT * 0.25 + a * 20) * 0.35;
    }
    const attr = motes!.geometry.getAttribute("position")!;
    attr.array = motePos;
    attr.needsUpdate = true;
  }
  keyLight.intensity = motes!.visible ? KEY_BASE * (1 + Math.sin(clockT * 1.3) * 0.02 + Math.sin(clockT * 3.7) * 0.01) : KEY_BASE;
  // free-marker gentle pulse (cosmetic)
  const pulse = reducedMotion ? 1 : 1 + Math.sin(pulseT * 1000 / 350) * 0.12;
  for (const [, dot] of freeDots) dot.scale.setScalar(pulse);
  // camera: the fitted base + event shake (never cumulative)
  let sx = 0, sy = 0;
  if (camShake > 0 && !reducedMotion) {
    camShake = Math.max(0, camShake - dt * 0.5);
    sx = (Math.random() - 0.5) * camShake;
    sy = (Math.random() - 0.5) * camShake;
  } else camShake = Math.max(0, camShake - dt * 0.5);
  camera.position.set(camBase.x + sx, camBase.y + sy, camBase.z);
  camera.lookAt(camTarget);
}
