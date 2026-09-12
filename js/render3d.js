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
  g.tile = new THREE.BoxGeometry(0.92, 0.16, 0.92);
  g.tileTop = new THREE.BoxGeometry(0.8, 0.06, 0.8);
  g.tileBigH = new THREE.BoxGeometry(0.92 * 2 + 0.1, 0.16, 0.92);
  g.tileBigHTop = new THREE.BoxGeometry(0.8 * 2 + 0.18, 0.06, 0.8);
  g.tileBigV = new THREE.BoxGeometry(0.92, 0.16, 0.92 * 2 + 0.1);
  g.tileBigVTop = new THREE.BoxGeometry(0.8, 0.06, 0.8 * 2 + 0.18);
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
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    }
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

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

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
  scene.add(keyLight, fillLight, rimLight);

  const particles = new Particles(scene, 400);

  // state mirrors
  let pieceMeshes = new Map();  // pieceId -> {group, cells, d, big, baseY}
  let freeDots = new Map();     // pieceId -> mesh
  let boltMeshes = [];
  let cellMeshes = new Map();   // 'r:c' -> {mesh, pos}
  let curState = null;
  let hintMeshes = [];
  let boardDims = { w: 6, h: 6 };
  let quality = 'medium';
  let reducedMotion = false;
  let disposed = false;

  function cellKey(r, c) { return r + ':' + c; }

  // ---------- theme ----------
  function themeById(id) {
    return Content.THEMES.find(t => t.id === id) || Content.THEMES[0];
  }
  function setTheme(id) {
    const th = themeById(id);
    const p = th.palette;
    scene.background = new THREE.Color(p.fog);
    scene.fog = null;
    keyLight.color.set(p.light);
    rimLight.color.set(p.accent);
    for (const m of Object.values(mats)) m.dispose && m.dispose();
    mats.plate = new THREE.MeshStandardMaterial({ color: p.plate, roughness: 0.45, metalness: 0.75 });
    mats.plateEdge = new THREE.MeshStandardMaterial({ color: p.plateEdge, roughness: 0.6, metalness: 0.6 });
    mats.cell = new THREE.MeshStandardMaterial({ color: p.cell, roughness: 0.7, metalness: 0.5 });
    mats.floor = new THREE.MeshStandardMaterial({ color: p.floor, roughness: 0.95 });
    mats.enamel = new THREE.MeshStandardMaterial({ color: p.enamel, roughness: 0.3, metalness: 0.05 });
    mats.enamel2 = new THREE.MeshStandardMaterial({ color: p.enamel2, roughness: 0.3, metalness: 0.05 });
    mats.bolt = new THREE.MeshStandardMaterial({ color: p.bolt, roughness: 0.35, metalness: 0.85 });
    mats.tile = new THREE.MeshStandardMaterial({ color: p.plateEdge, roughness: 0.5, metalness: 0.7 });
    mats.freeGlow = new THREE.MeshBasicMaterial({ color: p.accent, transparent: true, opacity: 0.9 });
    buildEnv(p);
    if (curState) buildBoard(curState); // rebuild with new materials
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
    const arrow = new THREE.Mesh(big ? geos.arrowBig : geos.arrow, mats.tile);
    arrow.position.y = 0.2;
    arrow.rotation.y = DIR_ROTY[piece.d];
    grp.add(tile, top, arrow);
    if (big) { // second chevron reinforces the span
      const arrow2 = new THREE.Mesh(geos.arrowBig, mats.tile);
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
            particles.burst(edgeP, themeById(settings.theme).palette.accent, quality === 'low' ? 8 : 18, 1.2, 1.4);
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
        particles.burst(new THREE.Vector3(0, 1.4, 0), 0xffd070, quality === 'low' ? 30 : 90, 3.4, 2.8);
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

  // ---------- quality ----------
  function setQuality(tier) {
    quality = tier;
    const dpr = window.devicePixelRatio || 1;
    if (tier === 'low') {
      renderer.setPixelRatio(Math.min(dpr, 1));
      renderer.shadowMap.enabled = false;
      keyLight.castShadow = false;
    } else if (tier === 'medium') {
      renderer.setPixelRatio(Math.min(dpr, 1.5));
      renderer.shadowMap.enabled = true;
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.map && keyLight.shadow.map.dispose();
      keyLight.shadow.map = null;
    } else {
      renderer.setPixelRatio(Math.min(dpr, 2));
      renderer.shadowMap.enabled = true;
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.map && keyLight.shadow.map.dispose();
      keyLight.shadow.map = null;
    }
    resize();
  }

  function setReducedMotion(on) { reducedMotion = !!on; }
  function setParallax(x, y) { parallax.x = x; parallax.y = y; }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
  }

  // ---------- frame loop ----------
  let last = 0;
  let running = true;
  function frame(t) {
    if (disposed) return;
    requestAnimationFrame(frame);
    if (!running) { last = t; return; }
    const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
    last = t;
    tweens.tick(dt);
    particles.tick(dt);
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
    renderer.render(scene, camera);
  }

  function setRunning(on) { running = !!on; }
  function skipAll() { tweens.finishAll(); }
  function isBusy() { return tweens.busy; }

  function dispose() {
    disposed = true;
    renderer.dispose();
    for (const g of Object.values(geos)) g.dispose();
    for (const m of Object.values(mats)) m.dispose && m.dispose();
    host.removeChild(renderer.domElement);
  }

  setTheme(settings.theme || 'foundry');
  setQuality(settings.graphicsTier === 'auto'
    ? ((window.matchMedia && matchMedia('(pointer:coarse)').matches) ? 'medium' : 'high')
    : settings.graphicsTier);
  resize();
  requestAnimationFrame(frame);

  return {
    buildBoard, syncState, skipAll, isBusy,
    pickPiece, screenPosOfPiece, setCursor,
    setHint, clearHint,
    setTheme, setQuality, setReducedMotion, setParallax,
    resize, dispose, setRunning,
    get quality() { return quality; }
  };
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}
