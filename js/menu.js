// Main-menu hero: loads the TRELLIS-generated GLB and orbits it slowly.
// Degrades to the Blender-rendered poster (assets/menu/hero.webp) when
// WebGL or the model is unavailable, and respects reduced-motion.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

function init() {
  const host = document.querySelector('.menu-hero');
  const canvas = document.getElementById('menu-hero-canvas');
  const screen = document.querySelector('[data-screen="title"]');
  if (!host || !canvas || !screen) return;

  const useFallback = () => host.classList.add('no-webgl');
  const heroSrc = canvas.dataset.src;
  if (!heroSrc || !webglAvailable()) { useFallback(); return; }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch { useFallback(); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff2dd, 2.4); key.position.set(2.5, 3, 2);
  const rim = new THREE.DirectionalLight(0x7fd4c1, 1.6); rim.position.set(-3, 1.5, -2.5);
  const fill = new THREE.PointLight(0xf2b04e, 18, 12); fill.position.set(0, -1.2, 2.2);
  scene.add(key, rim, fill);

  const group = new THREE.Group();
  scene.add(group);

  let spinning = true;
  new GLTFLoader().load(heroSrc, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 2.6 / Math.max(size.x, size.y, size.z);
    model.scale.setScalar(s);
    model.position.sub(center.multiplyScalar(s));
    group.add(model);
    spinning = true;
  }, undefined, () => useFallback());

  // Pointer parallax: the hero leans gently toward the cursor / touch point.
  let targetTiltX = 0, targetTiltY = 0, tiltX = 0, tiltY = 0;
  window.addEventListener('pointermove', (e) => {
    targetTiltY = (e.clientX / window.innerWidth - 0.5) * 0.35;
    targetTiltX = (e.clientY / window.innerHeight - 0.5) * 0.22;
  }, { passive: true });

  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (screen.style.display === 'none') return; // menu hidden; skip render
    const t = clock.getElapsedTime();
    if (spinning && !REDUCED) group.rotation.y = t * 0.45;
    tiltX += (targetTiltX - tiltX) * 0.05;
    tiltY += (targetTiltY - tiltY) * 0.05;
    group.rotation.x = REDUCED ? 0.12 : 0.12 + tiltX + Math.sin(t * 0.7) * 0.03;
    group.position.y = REDUCED ? 0 : Math.sin(t * 0.9) * 0.08;
    camera.position.set(tiltY * 1.4, 0.35, 4.4);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }
  frame();
  window.addEventListener('pagehide', () => cancelAnimationFrame(raf), { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else init();
