/* Arrow Exodus — Three.js presentation layer.
 * A clean mechanical plate of enamel arrows at tabletop scale: one warm
 * key light, soft environment fill, machined metal plate, enamel inlays.
 * The renderer consumes immutable rules snapshots + event lists; it never
 * mutates game state. All decorative randomness comes from the decor
 * seed stream, never the rules stream.
 *
 * Layers: 0 environment, 1 gameplay (pieces, cells), 2 selection/ghosts,
 * 3 effects. Raycasts only hit layers 1–2.
 */
import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { detectPreset, describe, resolve, SHADOW_MAP } from './gfx.js';

// ---------- GPU probe (one throwaway context, cached) ----------
let gpuCache = null;
function isMobileDevice() {
  try {
    return (window.matchMedia && matchMedia('(pointer:coarse)').matches) ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  } catch (e) { return false; }
}
/** { gpu, detected } — the unmasked GPU name and the Auto preset it maps to. */
export function gpuInfo() {
  if (gpuCache) return gpuCache;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) { gpu = ''; }
  gpuCache = { gpu, detected: detectPreset(gpu, { mobile: isMobileDevice() }) };
  return gpuCache;
}

// Colour grade + vignette, applied in display space after OutputPass.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.26 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // Gentle S-curve contrast, a touch more saturation, warm highlights / cool shadows.
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.95, 0.98, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.15, 0.75, l));
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.0, 0.9));
      c *= 1.0 - uVignette * smoothstep(0.3, 0.8, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// ---------- procedural surface textures (deterministic value noise) ----------
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function canvasTex(size, paint, srgb) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  paint(img.data, size);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function makeTextures() {
  // brushed steel: long horizontal streaks, used as roughness + a faint colour modulation
  const brushed = canvasTex(256, (d, n) => {
    for (let y = 0; y < n; y++) {
      const row = hash2(0, y) * 0.5 + hash2(1, y >> 1) * 0.3;
      for (let x = 0; x < n; x++) {
        const v = 0.72 + row * 0.22 + hash2(x >> 5, y) * 0.06;
        const i = (y * n + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255); d[i + 3] = 255;
      }
    }
  }, false);
  // fine grain for enamel / cell inlays (roughness variation only)
  const grain = canvasTex(128, (d, n) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 0.8 + hash2(x + 7, y + 3) * 0.2;
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(v * 255); d[i + 3] = 255;
    }
  }, false);
  // workbench: pool of lamp light fading to the corners, with wood-like grain
  const bench = canvasTex(512, (d, n) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / n - 0.5, v = y / n - 0.5;
      const r = Math.sqrt(u * u * 1.0 + v * v * 1.4);
      const pool = 1 - Math.min(1, Math.max(0, (r - 0.05) / 0.42));
      const streak = hash2(0, y >> 1) * 0.5 + hash2(x >> 6, y) * 0.5;
      const val = (0.35 + 0.65 * pool * pool) * (0.86 + streak * 0.14);
      const i = (y * n + x) * 4;
      d[i] = Math.round(Math.min(1, val * 1.04) * 255);
      d[i + 1] = Math.round(val * 255);
      d[i + 2] = Math.round(val * 0.94 * 255);
      d[i + 3] = 255;
    }
  }, true);
  bench.wrapS = bench.wrapT = THREE.ClampToEdgeWrapping;
  return { brushed, grain, bench };
}

// Rounded, bevelled tile slab (width along x, depth along z), base at y = 0.
function roundedSlab(w, d, h, r, bevel) {
  const s = new THREE.Shape();
  const x0 = -w / 2 + bevel, x1 = w / 2 - bevel, z0 = -d / 2 + bevel, z1 = d / 2 - bevel;
  const rr = Math.max(0.001, r - bevel);
  s.moveTo(x0 + rr, z0);
  s.lineTo(x1 - rr, z0); s.quadraticCurveTo(x1, z0, x1, z0 + rr);
  s.lineTo(x1, z1 - rr); s.quadraticCurveTo(x1, z1, x1 - rr, z1);
  s.lineTo(x0 + rr, z1); s.quadraticCurveTo(x0, z1, x0, z1 - rr);
  s.lineTo(x0, z0 + rr); s.quadraticCurveTo(x0, z0, x0 + rr, z0);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(Math.PI / 2);           // extrude along -y
  g.translate(0, h - bevel, 0);     // top face at y = h
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(0, -bb.min.y - h / 2, 0); // centre vertically like the old BoxGeometry
  // planar UVs from x/z so grain textures map evenly
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + 0.5, p.getZ(i) + 0.5);
  return g;
}

const LAYER_ENV = 0, LAYER_GAME = 1, LAYER_SEL = 2, LAYER_FX = 3;
const CELL = 1.06;            // world units per board cell
const PLATE_TOP = 0.55;       // y of the plate surface

// world direction per facing: 0 up(-z) 1 right(+x) 2 down(+z) 3 left(-x)
const DIRV = [new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0),
              new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)];
// arrow geo tip points -z at rest (shape +y rotated by rotateX(-PI/2)), i.e. facing 0
const DIR_ROTY = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

// ---------- tiny deterministic tween manager (no per-frame allocation) ----------
class Tweens {
  constructor() { this.list = []; }
  add(t) { // {dur, ease, onUpdate(k), onDone, tag}
    t.t = 0;
    if (t.tag) this.kill(t.tag);
    this.list.push(t);
    return t;
  }
  kill(tag) {
    for (let i = this.list.length - 1; i >= 0; i--)
      if (this.list[i].tag === tag) this.list.splice(i, 1);
  }
  tick(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.onUpdate((tw.ease || easeInOut)(k));
      if (k >= 1) { this.list.splice(i, 1); if (tw.onDone) tw.onDone(); }
    }
  }
  finishAll() {
    for (const tw of this.list) { tw.onUpdate(1); if (tw.onDone) tw.onDone(); }
    this.list.length = 0;
  }
  get busy() { return this.list.length > 0; }
}
const easeInOut = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const easeOut = k => 1 - Math.pow(1 - k, 3);
const easeIn = k => k * k * k;
const easeOutBack = k => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

// ---------- original procedural geometry ----------
function arrowShape(len, headW, shaftW) {
  // arrow pointing +z in shape space (x right, y toward tip), centered
  const s = new THREE.Shape();
  const half = len / 2, headLen = headW * 0.9;
  s.moveTo(-shaftW, -half);
  s.lineTo(shaftW, -half);
  s.lineTo(shaftW, half - headLen);
  s.lineTo(headW, half - headLen);
  s.lineTo(0, half);
  s.lineTo(-headW, half - headLen);
  s.lineTo(-shaftW, half - headLen);
  s.closePath();
  return s;
}

function geoCache() {
  const g = {};
  g.arrow = new THREE.ExtrudeGeometry(arrowShape(0.62, 0.17, 0.085),
    { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
  g.arrow.rotateX(-Math.PI / 2); // lie flat, tip toward -z (facing 0 / up)
  g.arrowBig = new THREE.ExtrudeGeometry(arrowShape(0.7, 0.2, 0.1),
    { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
  g.arrowBig.rotateX(-Math.PI / 2);
  g.tile = roundedSlab(0.92, 0.92, 0.16, 0.1, 0.025);
  g.tileTop = roundedSlab(0.8, 0.8, 0.06, 0.08, 0.018);
  g.tileBigH = roundedSlab(0.92 * 2 + 0.1, 0.92, 0.16, 0.1, 0.025);
  g.tileBigHTop = roundedSlab(0.8 * 2 + 0.18, 0.8, 0.06, 0.08, 0.018);
  g.tileBigV = roundedSlab(0.92, 0.92 * 2 + 0.1, 0.16, 0.1, 0.025);
  g.tileBigVTop = roundedSlab(0.8, 0.8 * 2 + 0.18, 0.06, 0.08, 0.018);
  g.cell = new THREE.PlaneGeometry(0.96, 0.96);
  g.bolt = new THREE.CylinderGeometry(0.3, 0.34, 0.18, 6);
  g.boltSlot = new THREE.BoxGeometry(0.34, 0.05, 0.07);
  g.marker = new THREE.RingGeometry(0.3, 0.4, 24);
  g.dot = new THREE.SphereGeometry(0.07, 10, 8);
  g.stud = new THREE.CylinderGeometry(0.09, 0.11, 0.08, 8);
  return g;
}

// ---------- pooled particle bursts (layer 3, never raycast) ----------
class Particles {
  constructor(scene, capacity) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.07, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true
    }));
    this.points.layers.set(LAYER_FX);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
    this.boost = 1;
  }
  // high: additive glowing sparks; boost > 1 pushes colours into the bloom range
  setMode(high, boost) {
    const m = this.points.material;
    m.blending = high ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.size = high ? 0.085 : 0.07;
    m.toneMapped = boost <= 1;
    m.needsUpdate = true;
    this.boost = boost;
  }
  burst(p, color, n, spread, up) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = Math.random() * up + 0.8;
      this.vel[i * 3 + 2] = Math.sin(a) * r * 0.5;
      this.life[i] = 0.7 + Math.random() * 0.4;
      const b = this.boost * (0.7 + Math.random() * 0.6);
      this.col[i * 3] = c.r * b; this.col[i * 3 + 1] = c.g * b; this.col[i * 3 + 2] = c.b * b;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }
  tick(dt) {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.vel[i * 3 + 1] -= 4.5 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- renderer ----------
export function createRenderer(opts) {
  const host = opts.host;
  const Content = opts.content;
  const settings = opts.settings;
  const tweens = new Tweens();
  const geos = geoCache();
  const mats = {}; // theme materials, rebuilt on setTheme

  const texs = makeTextures();
  const gpu = gpuInfo();
  let q = resolve(opts.graphics || {}, gpu.detected); // resolved graphics settings
  let renderer = null;      // WebGLRenderer; recreated only when canvas MSAA must toggle
  let canvasAA = null;
  let composer = null, postKey = null, postFailed = false;
  let envRT = null;         // PMREM RoomEnvironment render target (reflections)
  let size = [0, 0], pixelRatio = 1, adaptiveScale = 1, frames = [], fps = 0;

  function makeGL() {
    const aa = !q.post && q.antialias === 'msaa';
    if (renderer && aa === canvasAA) return;
    const old = renderer;
    renderer = new THREE.WebGLRenderer({ antialias: aa, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasAA = aa;
    if (old) {
      if (composer) { composer.dispose(); composer = null; }
      postKey = null;
      if (envRT) { envRT.dispose(); envRT = null; }
      if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
      host.replaceChild(renderer.domElement, old.domElement);
      old.dispose();
      size = [0, 0];
    } else host.appendChild(renderer.domElement);
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.layers.enable(LAYER_GAME);
  camera.layers.enable(LAYER_SEL);
  camera.layers.enable(LAYER_FX);
  const camBase = new THREE.Vector3(0, 7.5, 8.5);
  const camTarget = new THREE.Vector3(0, 0.4, 0);
  let camShake = 0;
  let parallax = { x: 0, y: 0 };

  const raycaster = new THREE.Raycaster();
  raycaster.layers.enable(LAYER_GAME);
  raycaster.layers.enable(LAYER_SEL);
  const pointerV = new THREE.Vector2();

  // groups
  const envGroup = new THREE.Group();
  const boardGroup = new THREE.Group();
  const pieceGroup = new THREE.Group();
  const selGroup = new THREE.Group();
  scene.add(envGroup, boardGroup, pieceGroup, selGroup);
  selGroup.traverse(o => o.layers.set(LAYER_SEL));

  // lights (created once, tinted per theme)
  const keyLight = new THREE.DirectionalLight(0xffe0b0, 2.6);
  keyLight.position.set(4, 8, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.bias = -0.002;
  keyLight.shadow.camera.left = -8; keyLight.shadow.camera.right = 8;
  keyLight.shadow.camera.top = 8; keyLight.shadow.camera.bottom = -8;
  const fillLight = new THREE.HemisphereLight(0xfff0dd, 0x1a2028, 0.55);
  const rimLight = new THREE.DirectionalLight(0xffdcb0, 0.5);
  rimLight.position.set(-5, 4, -4);
  scene.add(keyLight, fillLight, rimLight, keyLight.target);

  const particles = new Particles(scene, 400);

  // drifting dust motes in the lamp light ('background: animated'; off with reduced motion)
  const MOTES = 70;
  const motePos = new Float32Array(MOTES * 3), moteSeed = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    moteSeed[i * 3] = hash2(i, 1); moteSeed[i * 3 + 1] = hash2(i, 2); moteSeed[i * 3 + 2] = hash2(i, 3);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xffe2b8, size: 0.028, transparent: true, opacity: 0.28, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true
  }));
  motes.layers.set(LAYER_FX);
  motes.frustumCulled = false;
  motes.visible = false;
  scene.add(motes);
  function tickMotes(t) {
    const W = boardDims.w + 2, H = boardDims.h + 2;
    for (let i = 0; i < MOTES; i++) {
      const a = moteSeed[i * 3], b = moteSeed[i * 3 + 1], c = moteSeed[i * 3 + 2];
      const rise = ((t * (0.04 + c * 0.05) + b) % 1);
      motePos[i * 3] = (a - 0.5) * W + Math.sin(t * 0.3 + c * 20) * 0.35;
      motePos[i * 3 + 1] = PLATE_TOP + 0.3 + rise * 2.4;
      motePos[i * 3 + 2] = (b - 0.5) * H + Math.cos(t * 0.25 + a * 20) * 0.35;
    }
    moteGeo.attributes.position.needsUpdate = true;
  }

  // state mirrors
  let pieceMeshes = new Map();  // pieceId -> {group, cells, d, big, baseY}
  let freeDots = new Map();     // pieceId -> mesh
  let boltMeshes = [];
  let cellMeshes = new Map();   // 'r:c' -> {mesh, pos}
  let curState = null;
  let hintMeshes = [];
  let boardDims = { w: 6, h: 6 };
  let reducedMotion = false;
  let disposed = false;

  function cellKey(r, c) { return r + ':' + c; }

  // ---------- theme ----------
  function themeById(id) {
    return Content.THEMES.find(t => t.id === id) || Content.THEMES[0];
  }
  let themeId = null;
  function setTheme(id) {
    const th = themeById(id);
    themeId = th.id;
    const p = th.palette;
    scene.background = new THREE.Color(p.fog);
    scene.fog = null;
    keyLight.color.set(p.light);
    rimLight.color.set(p.accent);
    buildMaterials(p);
    buildEnv(p);
    if (curState) buildBoard(curState); // rebuild with new materials
  }

  // Materials depend on the theme palette and on the 'detail' / 'reflections' / 'bloom' tiers.
  function buildMaterials(p) {
    for (const m of Object.values(mats)) m.dispose && m.dispose();
    const det = q.detail === 'detailed';
    const env = q.reflections === 'on';
    const std = (o, envI) => {
      const m = new THREE.MeshStandardMaterial(o);
      m.envMapIntensity = envI;
      return m;
    };
    mats.plate = std({ color: p.plate, roughness: det ? 0.5 : 0.45, metalness: 0.75,
      roughnessMap: det ? texs.brushed : null, map: det ? texs.brushed : null }, 0.55);
    if (det) { mats.plate.color.multiplyScalar(1.15); }
    mats.plateEdge = std({ color: p.plateEdge, roughness: 0.6, metalness: 0.6,
      roughnessMap: det ? texs.brushed : null }, 0.5);
    mats.cell = std({ color: p.cell, roughness: 0.7, metalness: 0.5, roughnessMap: det ? texs.grain : null }, 0.4);
    mats.floor = std({ color: det ? new THREE.Color(p.floor).multiplyScalar(1.5) : p.floor, roughness: 0.95,
      map: det ? texs.bench : null }, 0.35);
    const enamel = (c) => det
      ? Object.assign(new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.34, metalness: 0.05,
          clearcoat: 0.8, clearcoatRoughness: 0.18, roughnessMap: texs.grain }), { envMapIntensity: 0.22 })
      : std({ color: c, roughness: 0.3, metalness: 0.05 }, 0.3);
    mats.enamel = enamel(p.enamel);
    mats.enamel2 = enamel(p.enamel2);
    mats.bolt = std({ color: p.bolt, roughness: 0.35, metalness: 0.85, roughnessMap: det ? texs.brushed : null }, 0.6);
    mats.tile = std({ color: p.plateEdge, roughness: 0.5, metalness: 0.7 }, 0.5);
    // chevrons stay dark against the enamel so direction always reads first
    mats.chevron = std({ color: env ? 0x0d0f12 : p.plateEdge,
      roughness: env ? 0.4 : 0.5, metalness: env ? 0.6 : 0.7 }, 0.25);
    mats.freeGlow = new THREE.MeshBasicMaterial({ color: p.accent, transparent: true, opacity: 0.9 });
    if (q.bloom === 'on') { // HDR so only the free markers and sparks cross the bloom threshold
      mats.freeGlow.color.multiplyScalar(5);
      mats.freeGlow.toneMapped = false;
    }
    particles.setMode(q.particles === 'high', q.bloom === 'on' ? 4 : 1);
  }

  // ---------- environment (deterministic decor from decor stream) ----------
  function buildEnv(p) {
    while (envGroup.children.length) {
      const c = envGroup.children.pop();
      c.traverse(o => { if (o.isMesh && o.geometry && !Object.values(geos).includes(o.geometry)) o.geometry.dispose(); });
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 40), mats.floor);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.layers.set(LAYER_ENV);
    envGroup.add(floor);

    // seeded decor: small metal ingots scattered beside the plate
    if (curState) {
      const drng = opts.rng.derive(curState.seed, opts.rng.STREAM_DECOR);
      for (let i = 0; i < 5; i++) {
        const w = 0.35 + drng.next() * 0.4;
        const ingot = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.5, w * 0.7), drng.next() > 0.5 ? mats.plateEdge : mats.bolt);
        const side = i % 2 ? 1 : -1;
        ingot.position.set(side * (boardDims.w / 2 + 1.6 + drng.next() * 1.4), w * 0.25, -2 + drng.next() * 4);
        ingot.rotation.y = drng.next() * 1.2;
        ingot.castShadow = ingot.receiveShadow = true; ingot.layers.set(LAYER_ENV);
        envGroup.add(ingot);
      }
    }
  }

  // ---------- board construction ----------
  function layout(cfg) {
    const { rows, cols } = cfg.board;
    const w = cols * CELL, h = rows * CELL;
    const pos = new Map();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        pos.set(cellKey(r, c), new THREE.Vector3((c - (cols - 1) / 2) * CELL, PLATE_TOP, (r - (rows - 1) / 2) * CELL));
    return { pos, w, h, rows, cols };
  }

  function buildBoard(state) {
    curState = state;
    for (const [, e] of pieceMeshes) pieceGroup.remove(e.group);
    pieceMeshes = new Map();
    for (const [, d] of freeDots) selGroup.remove(d);
    freeDots = new Map();
    boltMeshes = [];
    while (boardGroup.children.length) boardGroup.children.pop();
    clearHint();
    cellMeshes = new Map();

    const L = layout(state.cfg);
    boardDims = { w: L.w + 1.2, h: L.h + 1.2 };

    // machined plate with a raised rim
    const rim = new THREE.Mesh(new THREE.BoxGeometry(L.w + 1.1, PLATE_TOP, L.h + 1.1), mats.plateEdge);
    rim.position.y = PLATE_TOP / 2;
    rim.castShadow = rim.receiveShadow = true; rim.layers.set(LAYER_ENV);
    boardGroup.add(rim);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(L.w + 0.5, 0.12, L.h + 0.5), mats.plate);
    plate.position.y = PLATE_TOP - 0.06;
    plate.receiveShadow = true; plate.layers.set(LAYER_ENV);
    boardGroup.add(plate);

    // corner studs (instanced)
    const studs = new THREE.InstancedMesh(geos.stud, mats.bolt, 4);
    const m4 = new THREE.Matrix4();
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
      m4.makeTranslation(sx * (L.w / 2 + 0.32), PLATE_TOP + 0.02, sz * (L.h / 2 + 0.32));
      studs.setMatrixAt(i, m4);
    });
    studs.layers.set(LAYER_ENV);
    boardGroup.add(studs);

    // recessed cell inlays (interaction layer)
    for (const [key, p] of L.pos) {
      const inlay = new THREE.Mesh(geos.cell, mats.cell);
      inlay.rotation.x = -Math.PI / 2;
      inlay.position.copy(p); inlay.position.y += 0.001;
      inlay.receiveShadow = true;
      inlay.layers.set(LAYER_GAME);
      inlay.userData.cellKey = key;
      boardGroup.add(inlay);
      cellMeshes.set(key, { mesh: inlay, pos: p.clone() });
    }

    // bolts
    for (const [r, c] of state.bolts) {
      const p = L.pos.get(cellKey(r, c));
      if (!p) continue;
      const grp = new THREE.Group();
      const head = new THREE.Mesh(geos.bolt, mats.bolt);
      head.position.y = 0.09; head.castShadow = true;
      const slot = new THREE.Mesh(geos.boltSlot, mats.plateEdge);
      slot.position.y = 0.19;
      grp.add(head, slot);
      grp.position.copy(p);
      grp.traverse(o => o.layers.set(LAYER_ENV));
      boardGroup.add(grp);
      boltMeshes.push(grp);
    }

    // pieces
    for (const piece of state.pieces) placePiece(piece, true);

    fitCamera();
    buildEnv(themeById(settings.theme).palette);
    fitShadow();
    renderer.compile(scene, camera);
  }

  function fitCamera() {
    const aspect = host.clientWidth / Math.max(1, host.clientHeight);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const vFit = (boardDims.h * 0.56) / Math.tan(halfFov);
    const hFit = (boardDims.w * 0.60) / (Math.tan(halfFov) * aspect);
    const dist = Math.max(5.2, vFit, hFit) + 1.2;
    camBase.set(0, dist * 0.82, dist * 0.62);
    camTarget.set(0, 0.3, 0.3);
    camera.position.copy(camBase);
    camera.lookAt(camTarget);
  }

  function pieceCenter(piece) {
    const L = layout(curState.cfg);
    const p = new THREE.Vector3();
    for (const [r, c] of piece.cells) p.add(L.pos.get(cellKey(r, c)));
    p.divideScalar(piece.cells.length);
    return p;
  }

  function makePieceMesh(piece) {
    const big = piece.cells.length > 1;
    const grp = new THREE.Group();
    const horiz = big && piece.cells[0][0] === piece.cells[1][0];
    const tile = new THREE.Mesh(big ? (horiz ? geos.tileBigH : geos.tileBigV) : geos.tile, mats.tile);
    tile.position.y = 0.08; tile.castShadow = tile.receiveShadow = true;
    const top = new THREE.Mesh(big ? (horiz ? geos.tileBigHTop : geos.tileBigVTop) : geos.tileTop,
      big ? mats.enamel2 : mats.enamel);
    top.position.y = 0.17;
    const arrow = new THREE.Mesh(big ? geos.arrowBig : geos.arrow, mats.chevron);
    arrow.position.y = 0.2;
    arrow.rotation.y = DIR_ROTY[piece.d];
    grp.add(tile, top, arrow);
    if (big) { // second chevron reinforces the span
      const arrow2 = new THREE.Mesh(geos.arrowBig, mats.chevron);
      arrow2.position.y = 0.2;
      arrow2.rotation.y = DIR_ROTY[piece.d];
      const off = DIRV[piece.d].clone().multiplyScalar(-0.5);
      arrow.position.copy(off.clone().multiplyScalar(0.45)).setY(0.2);
      arrow2.position.copy(off.multiplyScalar(-0.45)).setY(0.2);
      grp.add(arrow2);
    }
    grp.traverse(o => { o.layers.set(LAYER_GAME); });
    grp.userData.pieceId = piece.id;
    return grp;
  }

  function placePiece(piece, instant) {
    const g = makePieceMesh(piece);
    const center = pieceCenter(piece);
    g.position.copy(center);
    pieceGroup.add(g);
    const entry = { group: g, cells: piece.cells.map(c => c.slice()), d: piece.d,
                    big: piece.cells.length > 1, baseY: center.y };
    pieceMeshes.set(piece.id, entry);
    if (!instant && !reducedMotion) {
      const targetY = g.position.y;
      g.position.y = targetY + 1.8;
      tweens.add({
        dur: 0.35, ease: easeOut, tag: 'drop:' + piece.id,
        onUpdate: k => { g.position.y = targetY + 1.8 * (1 - k); }
      });
    }
  }

  function removePieceMesh(id) {
    const e = pieceMeshes.get(id);
    if (e) { pieceGroup.remove(e.group); pieceMeshes.delete(id); }
    const dot = freeDots.get(id);
    if (dot) { selGroup.remove(dot); freeDots.delete(id); }
  }

  // ---------- state sync ----------
  // Compares snapshot to mirrored meshes; animates differences.
  function syncState(state, events, instant, freeIds) {
    curState = state;
    const evs = events || [];
    const seen = new Set(state.pieces.map(p => p.id));
    // pieces that vanished without an exit event (e.g. undo restore)
    for (const [id] of pieceMeshes)
      if (!seen.has(id) && !evs.some(e => e.type === 'exit' && e.piece === id))
        removePieceMesh(id);

    for (const ev of evs) {
      if (ev.type === 'exit') {
        const e = pieceMeshes.get(ev.piece);
        if (e) {
          pieceMeshes.delete(ev.piece);
          const dot = freeDots.get(ev.piece);
          if (dot) { selGroup.remove(dot); freeDots.delete(ev.piece); }
          const dir = DIRV[ev.d];
          const dist = Math.max(boardDims.w, boardDims.h) + 2;
          if (instant || reducedMotion) { pieceGroup.remove(e.group); }
          else {
            const start = e.group.position.clone();
            const spin = ev.big ? 0.6 : 1.4;
            tweens.add({
              dur: 0.5, ease: easeIn, tag: 'exit:' + ev.piece,
              onUpdate: k => {
                e.group.position.copy(start).addScaledVector(dir, k * dist);
                e.group.position.y = start.y + Math.sin(k * Math.PI * 0.5) * 1.2;
                e.group.rotation.y = DIR_ROTY[ev.d] + k * spin;
              },
              onDone: () => pieceGroup.remove(e.group)
            });
            const edgeP = start.clone().addScaledVector(dir, boardDims.w * 0.4);
            particles.burst(edgeP, themeById(settings.theme).palette.accent, q.particles === 'low' ? 8 : 18, 1.2, 1.4);
          }
          if (!reducedMotion) camShake = Math.max(camShake, ev.big ? 0.08 : 0.04);
        }
      } else if (ev.type === 'blocked') {
        const e = pieceMeshes.get(ev.piece);
        if (e && !instant && !reducedMotion) {
          const perp = new THREE.Vector3(DIRV[ev.d].z, 0, -DIRV[ev.d].x);
          const base = e.group.position.clone();
          tweens.add({
            dur: 0.3, ease: k => k, tag: 'shake:' + ev.piece,
            onUpdate: k => {
              const amp = 0.09 * (1 - k);
              e.group.position.copy(base).addScaledVector(perp, Math.sin(k * Math.PI * 6) * amp);
            },
            onDone: () => e.group.position.copy(base)
          });
        }
      } else if (ev.type === 'wave') {
        // fresh plate arrived; pieces drop in
        for (const piece of state.pieces)
          if (!pieceMeshes.has(piece.id)) placePiece(piece, instant);
        for (const [, b] of boltMeshes.entries()) boardGroup.remove(b);
        boltMeshes = [];
        const L = layout(state.cfg);
        for (const [r, c] of state.bolts) {
          const p = L.pos.get(cellKey(r, c));
          const grp = new THREE.Group();
          const head = new THREE.Mesh(geos.bolt, mats.bolt); head.position.y = 0.09; head.castShadow = true;
          const slot = new THREE.Mesh(geos.boltSlot, mats.plateEdge); slot.position.y = 0.19;
          grp.add(head, slot); grp.position.copy(p);
          grp.traverse(o => o.layers.set(LAYER_ENV));
          boardGroup.add(grp); boltMeshes.push(grp);
        }
        if (!reducedMotion) camShake = Math.max(camShake, 0.06);
      } else if (ev.type === 'win') {
        particles.burst(new THREE.Vector3(0, 1.4, 0), 0xffd070, q.particles === 'low' ? 30 : 90, 3.4, 2.8);
        if (!reducedMotion) camShake = Math.max(camShake, 0.12);
      } else if (ev.type === 'lose') {
        if (!reducedMotion) camShake = Math.max(camShake, 0.15);
      }
    }

    // reconcile: any piece present in state but without a mesh (e.g. undo)
    for (const piece of state.pieces)
      if (!pieceMeshes.has(piece.id)) placePiece(piece, true);

    updateFreeMarkers(freeIds || []);
  }

  // Soft glow dots over every arrow that currently has a clear lane —
  // makes the next useful action obvious without solving the board.
  function updateFreeMarkers(freeIds) {
    const want = new Set(freeIds);
    for (const [id, dot] of freeDots) {
      if (!want.has(id)) { selGroup.remove(dot); freeDots.delete(id); }
    }
    for (const id of want) {
      if (freeDots.has(id)) continue;
      const e = pieceMeshes.get(id);
      if (!e) continue;
      const dot = new THREE.Mesh(geos.dot, mats.freeGlow);
      dot.position.copy(e.group.position);
      dot.position.y += e.big ? 0.55 : 0.48;
      dot.layers.set(LAYER_SEL);
      selGroup.add(dot);
      freeDots.set(id, dot);
    }
  }

  // ---------- hint / cursor ----------
  function setHint(pieceId) {
    clearHint();
    const e = pieceMeshes.get(pieceId);
    if (!e) return;
    const ring = new THREE.Mesh(geos.marker, new THREE.MeshBasicMaterial({
      color: 0x7fb0ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(e.group.position);
    ring.position.y = PLATE_TOP + 0.02;
    if (e.big) ring.scale.setScalar(1.6);
    ring.layers.set(LAYER_SEL);
    selGroup.add(ring);
    hintMeshes.push(ring);
  }
  function clearHint() {
    for (const m of hintMeshes) selGroup.remove(m);
    hintMeshes = [];
  }

  // keyboard / gamepad focus cursor
  const cursorRing = new THREE.Mesh(geos.marker, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
  }));
  cursorRing.rotation.x = -Math.PI / 2;
  cursorRing.layers.set(LAYER_SEL);
  cursorRing.scale.setScalar(1.15);
  scene.add(cursorRing);
  function setCursor(cell) { // [r, c] or null
    if (!cell || !curState) { cursorRing.material.opacity = 0; return; }
    const cm = cellMeshes.get(cellKey(cell[0], cell[1]));
    if (!cm) { cursorRing.material.opacity = 0; return; }
    cursorRing.position.copy(cm.pos);
    cursorRing.position.y += 0.02;
    cursorRing.material.opacity = 0.75;
  }

  // ---------- picking ----------
  function pickPiece(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerV.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerV, camera);
    const hits = raycaster.intersectObjects(pieceGroup.children, true);
    for (const hit of hits) {
      let o = hit.object;
      while (o && !o.userData.pieceId) o = o.parent;
      // ignore meshes whose piece already left the state (mid-exit flight)
      if (o && pieceMeshes.has(o.userData.pieceId)) return o.userData.pieceId;
    }
    return null;
  }
  function screenPosOfPiece(pieceId) {
    const e = pieceMeshes.get(pieceId);
    if (!e) return null;
    const v = e.group.position.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * rect.width + rect.left, y: (1 - v.y) / 2 * rect.height + rect.top };
  }

  // ---------- graphics settings ----------
  // Shadow box fitted tightly around the plate and the decor beside it.
  const _v = new THREE.Vector3();
  function fitShadow() {
    const cam = keyLight.shadow.camera;
    keyLight.target.position.set(0, 0, 0);
    keyLight.target.updateMatrixWorld();
    keyLight.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(keyLight.position, keyLight.target.position, new THREE.Vector3(0, 1, 0));
    view.setPosition(keyLight.position).invert();
    const hx = boardDims.w / 2 + 3.2, hz = boardDims.h / 2 + 2.2;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const x of [-hx, hx]) for (const y of [0, 2.2]) for (const z of [-hz, hz]) {
      _v.set(x, y, z).applyMatrix4(view);
      minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x);
      minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
      minZ = Math.min(minZ, _v.z); maxZ = Math.max(maxZ, _v.z);
    }
    Object.assign(cam, { left: minX, right: maxX, top: maxY, bottom: minY, near: Math.max(0.1, -maxZ - 1), far: -minZ + 1 });
    cam.updateProjectionMatrix();
    keyLight.shadow.bias = -0.0006;
    keyLight.shadow.normalBias = 0.02;
  }

  function applyEnvironment() {
    if (q.reflections === 'on') {
      if (!envRT) {
        const pm = new THREE.PMREMGenerator(renderer);
        const room = new RoomEnvironment(renderer);
        envRT = pm.fromScene(room, 0.04);
        room.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        pm.dispose();
      }
      scene.environment = envRT.texture;
      fillLight.intensity = 0.2;   // IBL supplies most of the fill
    } else {
      scene.environment = null;
      fillLight.intensity = 0.55;
    }
  }

  /** Apply graphics settings live: { preset, render_scale, adaptive, show_fps, <category> }. */
  function setGraphics(saved) {
    q = resolve(saved || {}, gpu.detected);
    makeGL();
    const sm = SHADOW_MAP[q.shadows];
    renderer.shadowMap.enabled = sm > 0;
    keyLight.castShadow = sm > 0;
    if (sm > 0 && keyLight.shadow.mapSize.x !== sm) {
      keyLight.shadow.mapSize.set(sm, sm);
      if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
    }
    applyEnvironment();
    // materials pick up detail / env / shadow changes: rebuild them and the board
    if (themeId) setTheme(themeId);
    for (const m of Object.values(mats)) m.needsUpdate = true;
    applyMotion();
    adaptiveScale = 1;
    frames = [];
    postKey = null;           // rebuild the post chain on the next frame
    postFailed = false;
    fpsVisible(q.showFps);
    size = [0, 0];            // force a resize with the new pixel ratio
  }

  function applyMotion() {
    motes.visible = q.background === 'animated' && !reducedMotion;
  }

  function fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.appendChild(el);
    }
    if (el) el.hidden = !on;
  }

  function buildPost(w, h) {
    if (composer) { composer.dispose(); composer = null; }
    if (!q.post || postFailed) return;
    try {
      const pr = pixelRatio;
      const target = new THREE.WebGLRenderTarget(w * pr, h * pr, {
        type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0,
      });
      const c = new EffectComposer(renderer, target);
      c.setPixelRatio(pr);
      c.setSize(w, h);
      c.addPass(new RenderPass(scene, camera));
      if (q.ao !== 'off') {
        const ao = new GTAOPass(scene, camera, w * pr, h * pr);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.7;
        ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: q.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: q.ao === 'high' ? 6 : 4, rings: 2, samples: q.ao === 'high' ? 16 : 8 });
        c.addPass(ao);
      }
      // high threshold: only the HDR free markers, sparks and specular glints bloom
      if (q.bloom === 'on') c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.35, 1.6));
      c.addPass(new OutputPass());
      if (q.grade === 'on') c.addPass(new ShaderPass(GradeShader));
      if (q.antialias === 'smaa') c.addPass(new SMAAPass(w * pr, h * pr));
      if (q.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
        c.addPass(fxaa);
      }
      composer = c;
    } catch (e) {
      // post-processing is an enhancement: render directly and let the panel say so
      postFailed = true;
      composer = null;
    }
  }

  // Adaptive resolution: ~90-frame average; step down when slow, back up when fast.
  function adapt(dtMs) {
    frames.push(dtMs);
    if (frames.length < 90) return false;
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    frames.length = 0;
    fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = Math.round(fps) + ' fps · ' + (Math.round(pixelRatio * 100) / 100) + '×';
    if (!q.adaptive) return false;
    const before = adaptiveScale;
    if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
    else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
    return before !== adaptiveScale;
  }

  function graphicsInfo() {
    return {
      gpu: gpu.gpu || 'unknown GPU', detected: gpu.detected, resolved: q,
      summary: describe(q, [Math.round(size[0] * pixelRatio), Math.round(size[1] * pixelRatio)]),
      fps: Math.round(fps), adaptiveScale: Math.round(adaptiveScale * 100) / 100, postFailed,
    };
  }

  function setReducedMotion(on) { reducedMotion = !!on; applyMotion(); }
  function setParallax(x, y) { parallax.x = x; parallax.y = y; }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
  }

  function applySize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(window.devicePixelRatio || 1, q.maxDpr) * q.scale * adaptiveScale;
    if (w !== size[0] || h !== size[1] || ratio !== pixelRatio) {
      size = [w, h];
      pixelRatio = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const key = q.post && !postFailed ? [q.ao, q.bloom, q.grade, q.antialias, w, h, pixelRatio].join('|') : 'none';
    if (key !== postKey) { postKey = key; buildPost(w, h); }
  }

  // ---------- frame loop ----------
  let last = 0;
  let running = true;
  let clockT = 0;
  const keyBase = 2.6;
  function frame(t) {
    if (disposed) return;
    requestAnimationFrame(frame);
    if (!running) { last = t; return; }
    const rawDt = last ? t - last : 16;
    const dt = Math.min(0.05, rawDt / 1000);
    last = t;
    if (adapt(Math.min(250, rawDt))) size = [0, 0];
    tweens.tick(dt);
    particles.tick(dt);
    // ambient life: dust motes and a faint lamp shimmer (static under reduced motion)
    if (motes.visible) { clockT += dt; tickMotes(clockT); }
    keyLight.intensity = motes.visible
      ? keyBase * (1 + Math.sin(clockT * 1.3) * 0.02 + Math.sin(clockT * 3.7) * 0.01) : keyBase;
    // free-marker gentle pulse (cosmetic; amplitude never alters picking)
    const pulse = reducedMotion ? 1 : 1 + Math.sin(t / 350) * 0.12;
    for (const [, dot] of freeDots) dot.scale.setScalar(pulse);
    // camera: authored base + pointer parallax + event shake (never cumulative)
    const px = reducedMotion ? 0 : parallax.x * 0.3;
    const py = reducedMotion ? 0 : parallax.y * 0.18;
    let sx = 0, sy = 0;
    if (camShake > 0 && !reducedMotion) {
      camShake = Math.max(0, camShake - dt * 0.5);
      sx = (Math.random() - 0.5) * camShake;
      sy = (Math.random() - 0.5) * camShake;
    } else camShake = Math.max(0, camShake - dt * 0.5);
    camera.position.set(camBase.x + px + sx, camBase.y + py + sy, camBase.z);
    camera.lookAt(camTarget);
    applySize();
    if (composer) {
      try { composer.render(dt); }
      catch (e) { postFailed = true; composer.dispose(); composer = null; renderer.render(scene, camera); }
    } else renderer.render(scene, camera);
  }

  function setRunning(on) { running = !!on; }
  function skipAll() { tweens.finishAll(); }
  function isBusy() { return tweens.busy; }

  function dispose() {
    disposed = true;
    if (composer) composer.dispose();
    if (envRT) envRT.dispose();
    for (const t of Object.values(texs)) t.dispose();
    moteGeo.dispose(); motes.material.dispose(); particles.points.geometry.dispose(); particles.points.material.dispose();
    const fm = document.getElementById('fps-meter');
    if (fm) fm.hidden = true;
    renderer.dispose();
    for (const g of Object.values(geos)) g.dispose();
    for (const m of Object.values(mats)) m.dispose && m.dispose();
    host.removeChild(renderer.domElement);
  }

  setGraphics(opts.graphics || {});
  setTheme(settings.theme || 'foundry');
  resize();
  requestAnimationFrame(frame);

  return {
    buildBoard, syncState, skipAll, isBusy,
    pickPiece, screenPosOfPiece, setCursor,
    setHint, clearHint,
    setTheme, setGraphics, graphicsInfo, setReducedMotion, setParallax,
    resize, dispose, setRunning,
    get quality() { return q.preset; }
  };
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}
