// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset through the real Settings
// dialog, starts the Journey with the big Play button and keeps sending arrows off the plate by tapping
// them on the canvas (sparks, slide tweens, camera shake), moving to the next stage when one is cleared.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('[data-screen="title"]', { state: 'visible' });
  await page.click('[data-action="settings"]');
  await page.waitForFunction(() => document.getElementById('settings-overlay').style.display === 'flex');
  await page.selectOption('#set-tier', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('settings-overlay').style.display === 'none');
}

// Same projection as js/render3d.js fitCamera, to find a cell's arrow on screen.
function cellScreenPos(page, r, c) {
  return page.evaluate(([r, c]) => {
    const s = window.__axBench?.state;
    const canvas = document.querySelector('#canvas-host canvas');
    if (!s || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const rows = s.cfg.board.rows, cols = s.cfg.board.cols, CELL = 1.06;
    const bw = cols * CELL + 1.2, bh = rows * CELL + 1.2, aspect = rect.width / rect.height, tan = Math.tan(Math.PI / 10);
    const dist = Math.max(6.5, (bh * 0.62) / tan, (bw * 0.66) / (tan * aspect)) + 1.4;
    const eye = [0, dist * 0.82, dist * 0.62], tgt = [0, 0.3, 0.3];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
    const fwd = norm(sub(tgt, eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
    const d = sub([(c - (cols - 1) / 2) * CELL, 0.55, (r - (rows - 1) / 2) * CELL], eye);
    const cz = -dot(d, fwd);
    const x = (dot(d, right) / -cz) / (tan * aspect), y = (dot(d, up) / -cz) / tan;
    return { x: rect.left + ((x + 1) / 2) * rect.width, y: rect.top + ((1 - y) / 2) * rect.height };
  }, [r, c]);
}

export async function start(page, { mobile }) {
  // Read-only state mirror (like the e2e probe) so the next free arrow can be found and tapped.
  await page.evaluate(() => {
    const B = window.__axBench = { state: null };
    const R = window.AXRules, cg = R.createGame, ac = R.applyCommand;
    R.createGame = (cfg) => (B.state = cg(cfg));
    R.applyCommand = (s, cmd) => { const r = ac(s, cmd); if (r.ok) B.state = r.state; return r; };
  });
  await page.click('[data-action="play"]');
  await page.waitForSelector('[data-screen="play"]', { state: 'visible' });
  await page.waitForFunction(() => !!window.__axBench.state && document.querySelector('#canvas-host canvas'));
  let stopped = false;
  page.once('close', () => { stopped = true; });
  (async () => {
    while (!stopped) {
      try {
        const results = await page.evaluate(() => document.getElementById('results-overlay').style.display === 'flex');
        if (results) await page.click('#results-overlay [data-action="next"]');
        else {
          const cells = await page.evaluate(() => window.AXRules.hint(window.__axBench.state)?.cells ?? null);
          const pos = cells && await cellScreenPos(page, cells[0][0], cells[0][1]);
          if (pos) { if (mobile) await page.touchscreen.tap(pos.x, pos.y); else await page.mouse.click(pos.x, pos.y); }
        }
      } catch { /* page closing or overlay animating */ }
      await new Promise((r) => setTimeout(r, 450));
    }
  })();
  await page.waitForTimeout(500);
}
