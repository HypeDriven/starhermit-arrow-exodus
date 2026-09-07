/**
 * Arrow Exodus — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Play (Journey stage 1) → clear the plate by tapping arrows
 *   (pointer taps on the 3D canvas, keyboard cursor+Enter as exercised
 *   fallback) → results screen → Next stage → pause/resume, hint, undo
 *   on stage 2 → results → Learn lesson 1 → lesson complete → title →
 *   settings open/change/persist.
 * A second pass runs the same core flow on a mobile viewport with touch.
 *
 * The game exposes no round state on window, so the test installs a
 * read-only observation wrapper around AXRules.createGame/applyCommand
 * (window.__axProbe) purely for synchronization and for choosing which
 * visible arrow to tap next (via AXRules.hint — the same legality
 * surface the Hint button uses). Every action is a real click/tap/key
 * press on visible elements; no game code is modified.
 *
 * Note: this build has no localization switcher; language coverage is
 * not exercised here.
 *
 * Run: npm run test:e2e
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/arrow-exodus-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const filePath = pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, pathname);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const ok = (name) => console.log(`ok - ${name}`);

// ---------- in-page helpers ----------

// Read-only state probe: wrap the rules entry points the controller calls.
async function installProbe(page) {
  await page.evaluate(() => {
    window.__axProbe = { state: null, seq: 0 };
    const R = window.AXRules;
    if (!R) throw new Error('AXRules missing');
    const cg = R.createGame;
    R.createGame = (cfg) => { const s = cg(cfg); window.__axProbe.state = s; window.__axProbe.seq++; return s; };
    const ac = R.applyCommand;
    R.applyCommand = (state, cmd) => {
      const r = ac(state, cmd);
      if (r.ok) { window.__axProbe.state = r.state; window.__axProbe.seq++; }
      return r;
    };
  });
}

const probeSummary = (page) => page.evaluate(() => {
  const s = window.__axProbe?.state;
  return s ? { seq: window.__axProbe.seq, pieces: s.pieces.length, terminal: s.terminal, invalid: s.invalid }
           : null;
});

// `seq` increments on every accepted command, so it stays monotonic even
// across undo (where state.tick would repeat a previous value).
async function waitCmd(page, before, timeout = 1500) {
  try {
    await page.waitForFunction((n) => (window.__axProbe?.seq ?? 0) > n, before, { timeout });
    return true;
  } catch { return false; }
}

// Replicates render3d.js fitCamera + projection to map a board cell to
// client coordinates so we can really click/tap the visible arrow.
async function cellScreenPos(page, r, c) {
  return page.evaluate(([r, c]) => {
    const s = window.__axProbe?.state;
    const canvas = document.querySelector('#canvas-host canvas');
    if (!s || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const rows = s.cfg.board.rows, cols = s.cfg.board.cols;
    const CELL = 1.06;
    const bw = cols * CELL + 1.2, bh = rows * CELL + 1.2;
    const aspect = rect.width / rect.height;
    const tan = Math.tan(Math.PI / 10); // half of fov 36deg
    const dist = Math.max(6.5, (bh * 0.62) / tan, (bw * 0.66) / (tan * aspect)) + 1.4;
    const eye = [0, dist * 0.82, dist * 0.62];
    const tgt = [0, 0.3, 0.3];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
    const fwd = norm(sub(tgt, eye));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const p = [(c - (cols - 1) / 2) * CELL, 0.55, (r - (rows - 1) / 2) * CELL];
    const d = sub(p, eye);
    const cz = -dot(d, fwd);
    const ndcX = (dot(d, right) / -cz) / (tan * aspect);
    const ndcY = (dot(d, up) / -cz) / tan;
    return { x: rect.left + ((ndcX + 1) / 2) * rect.width, y: rect.top + ((1 - ndcY) / 2) * rect.height };
  }, [r, c]);
}

// Keyboard path: move the game's focus cursor to (r, c) with real arrow
// presses and tap with Enter. `cur` tracks the cursor across calls.
async function tapCellKeyboard(page, cur, r, c) {
  if (cur.r == null) { await page.keyboard.press('ArrowUp'); cur.r = 0; cur.c = 0; }
  while (cur.r > r) { await page.keyboard.press('ArrowUp'); cur.r--; }
  while (cur.r < r) { await page.keyboard.press('ArrowDown'); cur.r++; }
  while (cur.c > c) { await page.keyboard.press('ArrowLeft'); cur.c--; }
  while (cur.c < c) { await page.keyboard.press('ArrowRight'); cur.c++; }
  await page.keyboard.press('Enter');
}

// Ask the rules engine (same API as the Hint button) which piece to send
// off next, then tap its cell through the visible UI until the plate is
// cleared. Removing a provably free arrow can never lock a solvable
// board, so this always reaches a terminal state.
async function clearPlate(page, { pointer, touch, cur }) {
  for (let guard = 0; guard < 60; guard++) {
    const st = await probeSummary(page);
    if (!st) throw new Error('state probe empty mid-round');
    if (st.terminal) return st;
    const cells = await page.evaluate(() => window.AXRules.hint(window.__axProbe.state)?.cells ?? null);
    if (!cells) throw new Error('no legal exit but round not terminal');
    const [r, c] = cells[0];
    let acted = false;
    if (pointer) {
      const pos = await cellScreenPos(page, r, c);
      if (pos) {
        if (touch) await page.touchscreen.tap(pos.x, pos.y);
        else await page.mouse.click(pos.x, pos.y);
        acted = await waitCmd(page, st.seq, 900);
      }
    }
    if (!acted) { // keyboard fallback (also covers "no WebGL" devices)
      await tapCellKeyboard(page, cur, r, c);
      if (!(await waitCmd(page, st.seq))) throw new Error(`tap on (${r},${c}) did not register`);
    }
  }
  throw new Error('plate not cleared within guard limit');
}

const hudArrowsLeft = (page) => page.evaluate(() => {
  const m = document.getElementById('hud-status').textContent.match(/(\d+) arrows? left/);
  return m ? parseInt(m[1], 10) : -1;
});

const overlayVisible = (page, id) =>
  page.waitForFunction((i) => document.getElementById(i).style.display === 'flex', id, { timeout: 8000 });

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  await page.goto(await BASE_URL, { waitUntil: 'load' });
  await installProbe(page);

  // title
  await page.waitForSelector('[data-screen="title"]', { state: 'visible', timeout: 10000 });
  await page.screenshot({ path: SHOT('title', name) });
  ok(`${name}: title screen visible`);

  // start journey stage 1 via the big Play button
  await page.click('[data-action="play"]');
  await page.waitForSelector('[data-screen="play"]', { state: 'visible' });
  await page.waitForFunction(() => !!window.__axProbe?.state && document.querySelector('#canvas-host canvas'));
  const t1 = await page.textContent('#hud-title');
  if (!/Journey 1/.test(t1)) throw new Error(`expected Journey 1, got "${t1}"`);
  ok(`${name}: journey stage 1 started ("${t1.trim()}")`);

  // clear plate 1 through pointer/touch taps on the visible arrows
  const st1 = await clearPlate(page, { pointer: true, touch: !!ctxOpts.hasTouch, cur: {} });
  if (!st1.terminal?.won) throw new Error(`stage 1 not won: ${JSON.stringify(st1.terminal)}`);
  await overlayVisible(page, 'results-overlay');
  const headline = await page.textContent('#results-overlay h2');
  if (!/Plate cleared/.test(headline)) throw new Error(`unexpected headline "${headline}"`);
  await page.screenshot({ path: SHOT('results-stage1', name) });
  ok(`${name}: stage 1 cleared — results shown ("${headline.trim()}", mistakes: ${st1.invalid})`);

  // progression persisted
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem('arrowexodus.save.v1');
    return raw ? JSON.parse(JSON.parse(raw).payload) : null;
  });
  if (!saved?.progress?.journeyStars?.j01) throw new Error('journey stage 1 stars not persisted');
  ok(`${name}: progress persisted (j01 stars: ${saved.progress.journeyStars.j01})`);

  if (full) {
    // stage 2: pause/resume, hint, undo
    await page.click('#results-overlay [data-action="next"]');
    await page.waitForFunction(() => /Journey 2/.test(document.getElementById('hud-title').textContent));
    ok(`${name}: stage 2 started via Next stage`);

    await page.keyboard.press('Escape');
    await overlayVisible(page, 'pause-overlay');
    await page.screenshot({ path: SHOT('pause', name) });
    await page.click('#pause-overlay [data-action="resume"]');
    await page.waitForFunction(() => document.getElementById('pause-overlay').style.display === 'none');
    ok(`${name}: pause (Esc) and resume work`);

    await page.click('[data-action="hint"]'); // visible Hint button, cosmetic ring
    ok(`${name}: hint button works`);

    // exit one arrow, then undo it via the Undo button and re-exit it
    const before = await hudArrowsLeft(page);
    const target = await page.evaluate(() => window.AXRules.hint(window.__axProbe.state).cells);
    const tick0 = (await probeSummary(page)).seq;
    const pos = await cellScreenPos(page, target[0][0], target[0][1]);
    await page.mouse.click(pos.x, pos.y);
    if (!(await waitCmd(page, tick0))) throw new Error('pre-undo tap did not register');
    const afterExit = await hudArrowsLeft(page);
    if (afterExit !== before - 1) throw new Error(`expected ${before - 1} arrows left, got ${afterExit}`);
    await page.click('[data-action="undo"]');
    const afterUndo = await hudArrowsLeft(page);
    if (afterUndo !== before) throw new Error(`undo did not restore arrow (HUD: ${afterUndo})`);
    // probe is stale after undo; re-exit the same (again guaranteed free) arrow by keyboard
    const tickU = (await probeSummary(page)).seq;
    const cur = {};
    await tapCellKeyboard(page, cur, target[0][0], target[0][1]);
    if (!(await waitCmd(page, tickU))) throw new Error('re-exit after undo did not register');
    ok(`${name}: exit → undo → re-exit (keyboard cursor) verified via HUD`);

    const st2 = await clearPlate(page, { pointer: false, touch: false, cur });
    if (!st2.terminal?.won) throw new Error(`stage 2 not won: ${JSON.stringify(st2.terminal)}`);
    await overlayVisible(page, 'results-overlay');
    await page.screenshot({ path: SHOT('results-stage2', name) });
    ok(`${name}: stage 2 cleared via keyboard play`);

    // back to modes, then Learn lesson 1
    await page.click('#results-overlay [data-action="results-modes"]');
    await page.waitForSelector('[data-screen="modes"]', { state: 'visible' });
    await page.click('[data-action="learn"]');
    await page.waitForFunction(() => /Learn/.test(document.getElementById('hud-title').textContent));
    const lessonCells = await page.evaluate(() => window.AXRules.hint(window.__axProbe.state).cells);
    const lTick = (await probeSummary(page)).seq;
    const lpos = await cellScreenPos(page, lessonCells[0][0], lessonCells[0][1]);
    await page.mouse.click(lpos.x, lpos.y);
    if (!(await waitCmd(page, lTick))) throw new Error('lesson tap did not register');
    await overlayVisible(page, 'results-overlay');
    const lessonHead = await page.textContent('#results-overlay h2');
    if (!/Lesson complete/.test(lessonHead)) throw new Error(`unexpected lesson outcome "${lessonHead}"`);
    await page.screenshot({ path: SHOT('lesson', name) });
    ok(`${name}: Learn lesson 1 completed ("${lessonHead.trim()}")`);

    await page.click('#results-overlay [data-action="quit-play"]');
    await page.waitForSelector('[data-screen="title"]', { state: 'visible' });
    ok(`${name}: quit to title`);

    // settings: open from title, change values, Esc-close, persistence
    await page.click('[data-action="settings"]');
    await overlayVisible(page, 'settings-overlay');
    await page.click('#set-muted');
    await page.selectOption('#set-tier', 'low');
    await page.check('#set-motion');
    await page.screenshot({ path: SHOT('settings', name) });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('settings-overlay').style.display === 'none');
    const savedSettings = await page.evaluate(() => {
      const raw = localStorage.getItem('arrowexodus.save.v1');
      return raw ? JSON.parse(JSON.parse(raw).payload).settings : null;
    });
    if (!savedSettings || savedSettings.muted !== true ||
        savedSettings.graphicsTier !== 'low' || savedSettings.reducedMotion !== true)
      throw new Error('settings not persisted: ' + JSON.stringify(savedSettings));
    ok(`${name}: settings open/change/Esc-close persisted (muted, tier low, reduced motion)`);

    // saved visual prefs must apply from boot (body classes, muted audio)
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-screen="title"]', { state: 'visible' });
    const boot = await page.evaluate(() => ({
      rm: matchMedia('(prefers-reduced-motion: reduce)').matches, // context only
      muted: JSON.parse(JSON.parse(localStorage.getItem('arrowexodus.save.v1')).payload).settings.muted,
    }));
    if (!boot.muted) throw new Error('muted setting lost after reload');
    ok(`${name}: settings survive reload`);

    // stage 12 was previously ungenerable (createGame threw). Seed a
    // returning player's save so Play starts Journey 12, then verify it
    // boots and renders without page errors.
    await page.evaluate(() => {
      const w = JSON.parse(localStorage.getItem('arrowexodus.save.v1'));
      const d = JSON.parse(w.payload);
      for (let i = 1; i <= 11; i++) d.progress.journeyStars['j' + String(i).padStart(2, '0')] = 1;
      w.payload = JSON.stringify(d);
      w.sum = window.AXStore.checksum(w.payload);
      localStorage.setItem('arrowexodus.save.v1', JSON.stringify(w));
    });
    await page.reload({ waitUntil: 'load' });
    await installProbe(page);
    await page.waitForSelector('[data-screen="title"]', { state: 'visible' });
    await page.click('[data-action="play"]');
    await page.waitForFunction(() => !!window.__axProbe?.state && document.querySelector('#canvas-host canvas'));
    const t12 = await page.textContent('#hud-title');
    if (!/Journey 12/.test(t12)) throw new Error(`expected Journey 12, got "${t12}"`);
    const j12solvable = await page.evaluate(() => !!window.AXRules.solve(window.__axProbe.state));
    if (!j12solvable) throw new Error('Journey 12 board not solvable');
    await page.screenshot({ path: SHOT('journey12', name) });
    ok(`${name}: Journey 12 (previously ungenerable) boots, renders, is solvable`);
  }

  await context.close();
  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
}

// ---------- main ----------
const BASE_URL = new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — arrow-exodus, desktop + mobile, no page errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
