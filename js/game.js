/* Arrow Exodus — game controller: wires rules, content, audio, rendering,
 * persistence into the DOM UI. Browser-only (window.AXGame). */
import { createRenderer, webglAvailable, gpuInfo } from './render3d.js';
import { CATEGORIES, PRESETS, resolve, presetTier, describe, normalizePreset, choosePreset } from './gfx.js';
import { gfxStrings } from './gfx-i18n.js';

const AXAudio = window.AXAudio;
const AXRules = window.AXRules;
const AXContent = window.AXContent;
const AXStore = window.AXStore;
const AXRNG = window.AXRNG;
const AXPlatform = window.AXPlatform;

// ---------- module-level state ----------
let renderer3d = null;      // three.js render handle (createRenderer result) or null if unavailable
let webglOk = false;        // whether WebGL is available on this device
let currentScreen = 'title';
let doc = null;             // save document (settings + progress)
let sessionId = '';         // random per-load id for tie-breaks and practice seeds
let round = null;           // active round context (see startRound)
let cmdSeq = 0;             // monotonically increasing command ids (double-commit guard)
let hintTimer = 0;

// ---------- helpers ----------
function $(id){ return document.getElementById(id); }
function el(tag, cls, txt){ const e=document.createElement(tag); if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e; }

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function freeIds(state) {
  return AXRules.legalExits(state).map(e => e.piece);
}

function elapsedMs() {
  if (!round) return 0;
  const now = round.pausedAt != null ? round.pausedAt : performance.now();
  return Math.max(0, now - round.startMs - round.pausedTotal);
}

// ---------- account / sync status line (title screen) ----------
function renderAccountLine() {
  const line = $('account-line');
  if (!line) return;
  if (!AXPlatform.hosted) {
    line.textContent = 'Offline — progress is stored on this device.';
    return;
  }
  const name = AXPlatform.profile ? AXPlatform.profile.displayName : '…';
  const syncTxt = AXPlatform.sync === 'synced' ? 'progress synced'
    : AXPlatform.sync === 'saving' ? 'saving…'
    : 'cloud sync unavailable';
  line.textContent = 'Playing as ' + name + ' · ' + syncTxt;
}

// ---------- screens ----------
function showScreen(name) {
  currentScreen = name;
  document.querySelectorAll('.screen').forEach(s => {
    const on = s.getAttribute('data-screen') === name;
    s.classList.toggle('active', on);
    s.style.display = on ? '' : 'none';
  });
  window.scrollTo(0, 0);
}

function fillPanels() {
  const p = doc.progress;
  const stars = Object.values(p.journeyStars).reduce((a, b) => a + b, 0);
  const done = Object.keys(p.journeyStars).length;
  $('ji-summary').textContent =
    'Stage ' + (nextJourneyIndex() + 1) + ' of ' + AXContent.JOURNEY.length +
    ' · ' + done + ' cleared · ' + stars + ' stars earned.';

  const pi = $('pi-list');
  pi.innerHTML = '';
  AXContent.PRACTICE.forEach(pr => {
    const b = el('button', 'btn', pr.name + ' — ' + pr.board.rows + '×' + pr.board.cols +
      ', ' + pr.arrows + ' arrows' + (pr.bolts ? ', ' + pr.bolts + ' bolts' : '') +
      (pr.bigs ? ', ' + pr.bigs + ' big' : ''));
    b.setAttribute('data-action', 'practice-start');
    b.setAttribute('data-id', pr.id);
    pi.appendChild(el('div', 'row')).appendChild(b);
  });

  const ci = $('ci-list');
  ci.innerHTML = '';
  AXContent.CHALLENGES.forEach(ch => {
    const best = p.challengeBest[ch.id];
    const b = el('button', 'btn', ch.name + (best ? ' · best ' + best : ''));
    b.setAttribute('data-action', 'challenge-start');
    b.setAttribute('data-id', ch.id);
    const wrap = el('div', 'row');
    wrap.appendChild(b);
    wrap.appendChild(el('span', 'muted small', ch.intro));
    ci.appendChild(wrap);
  });

  $('sci-summary').textContent = AXContent.SCORE_CHASE.intro +
    ' Local best: ' + (p.endlessBest || 0) + '.';

  const aCount = Object.keys(p.achievements).length;
  $('pf-summary').textContent =
    p.stats.rounds + ' rounds · ' + p.stats.wins + ' wins · ' + p.stats.exits +
    ' arrows launched · best combo ' + p.stats.bestCombo + ' · ' +
    aCount + '/' + AXContent.ACHIEVEMENTS.length + ' achievements.';
}

// ---------- round lifecycle ----------
function nextJourneyIndex() {
  const stars = doc.progress.journeyStars;
  for (let i = 0; i < AXContent.JOURNEY.length; i++)
    if (!stars[AXContent.JOURNEY[i].id]) return i;
  return AXContent.JOURNEY.length - 1;
}

function roundSeed(cfg) {
  if (typeof cfg.seed === 'number') return cfg.seed >>> 0;
  return AXRNG.hashString(cfg.id + ':' + sessionId + ':' + doc.progress.stats.rounds);
}

function startRound(baseCfg, ctx) {
  closeOverlays();
  stopTimer();
  if (renderer3d) { renderer3d.dispose(); renderer3d = null; }
  const cfg = Object.assign({}, baseCfg, { seed: roundSeed(baseCfg) });
  const state = AXRules.createGame(cfg);
  round = {
    cfg: cfg, ctx: ctx, state: state, history: [],
    startMs: performance.now(), pausedTotal: 0, pausedAt: null,
    timerId: null, cursor: null, over: false, timedOut: false, warned: false,
    lesson: ctx.lesson || null, lessonCount: 0
  };

  showScreen('play');
  $('hud-title').textContent = ctx.label;
  $('hud-subtitle').textContent = ctx.sub || '';

  const host = $('canvas-host');
  host.innerHTML = '';
  webglOk = webglAvailable();
  if (webglOk) {
    renderer3d = createRenderer({ host: host, content: AXContent, settings: doc.settings, rng: AXRNG,
      graphics: gfxSaved() });
    appliedGfx = JSON.stringify(gfxSaved());
    appliedTheme = doc.settings.theme;
    renderer3d.setReducedMotion(doc.settings.reducedMotion);
    renderer3d.buildBoard(state);
    renderer3d.syncState(state, [], true, freeIds(state));
  } else {
    host.appendChild(el('p', 'muted',
      '3D rendering is unavailable in this browser, so the plate cannot be shown. ' +
      'Your progress and settings are preserved.'));
  }

  buildHud();
  updateHud();
  startTimer();
  AXAudio.setAvRng(AXRNG.derive(cfg.seed, AXRNG.STREAM_AV));
}

function startJourney(idx) {
  const lvl = AXContent.JOURNEY[idx];
  startRound(lvl, { kind: 'journey', label: 'Journey ' + (idx + 1) + ' — ' + lvl.name, sub: lvl.intro, index: idx });
}

function startLesson(idx) {
  const lessons = AXContent.tutorialLessons();
  const ls = lessons[idx];
  startRound(ls.cfg, { kind: 'tutorial', label: 'Learn — ' + ls.title, sub: ls.text, lesson: ls, index: idx });
}

function firstUnfinishedLesson() {
  const lessons = AXContent.tutorialLessons();
  for (let i = 0; i < lessons.length; i++)
    if (!doc.progress.tutorialDone[lessons[i].id]) return i;
  return 0;
}

// ---------- HUD ----------
function buildHud() {
  const hud = $('hud-bottom');
  hud.innerHTML = '';
  const status = el('p', 'small', '');
  status.id = 'hud-status';
  status.setAttribute('aria-live', 'polite');
  hud.appendChild(status);
  const row = el('div', 'row');
  const add = (action, label) => {
    const b = el('button', 'btn', label);
    b.setAttribute('data-action', action);
    row.appendChild(b);
  };
  if (round.cfg.mechanics && round.cfg.mechanics.hint) add('hint', 'Hint (H)');
  if (round.cfg.mechanics && round.cfg.mechanics.undo) add('undo', 'Undo (U)');
  add('restart', 'Restart');
  add('pause', 'Pause (Esc)');
  hud.appendChild(row);
}

function updateHud() {
  if (!round) return;
  const s = round.state;
  const left = s.pieces.length;
  // score.total is finalized only at the end; show the live sum mid-round
  const live = s.score.exitPoints + s.score.perfectBonus + s.score.timeBonus + s.score.waveBonus;
  let txt = 'Score ' + live + ' · ' + left + (left === 1 ? ' arrow' : ' arrows') + ' left · ' +
    s.invalid + (s.invalid === 1 ? ' mistake' : ' mistakes') + ' · ' + fmtTime(elapsedMs());
  if (s.cfg.timeLimitSec) {
    const remain = s.cfg.timeLimitSec * 1000 - elapsedMs();
    txt += ' · limit ' + fmtTime(Math.max(0, remain));
  }
  if (s.cfg.endless) txt += ' · plate ' + s.endlessWave;
  $('hud-status').textContent = txt;
}

function startTimer() {
  stopTimer();
  round.timerId = setInterval(() => {
    if (!round || round.over) return;
    updateHud();
    if (round.cfg.timeLimitSec && !round.warned && !round.state.terminal &&
        round.cfg.timeLimitSec * 1000 - elapsedMs() <= 10000) {
      round.warned = true; // one warning per round, 10 s before the limit
      AXAudio.play('time-warning');
    }
    if (round.cfg.timeLimitSec && !round.state.terminal &&
        elapsedMs() >= round.cfg.timeLimitSec * 1000) {
      round.timedOut = true;
      const res = AXRules.applyCommand(round.state, { type: 'resign', id: 'c' + (++cmdSeq) });
      if (res.ok) {
        round.state = res.state;
        handleEvents(res.events);
        finishRound(res.state);
      }
    }
  }, 250);
}

function stopTimer() {
  if (round && round.timerId) { clearInterval(round.timerId); round.timerId = null; }
}

// ---------- play ----------
function tapPiece(pieceId) {
  if (!round || round.over || round.pausedAt != null) return;
  if (round.state.terminal) return;
  const legal = AXRules.checkExit(round.state, pieceId) === null;
  const cmd = { type: legal ? 'exit' : 'probe', piece: pieceId,
                id: 'c' + (++cmdSeq), atMs: elapsedMs() };
  const res = AXRules.applyCommand(round.state, cmd);
  if (!res.ok) { AXAudio.play('invalid'); return; }
  round.history.push(round.state);
  round.state = res.state;
  if (renderer3d) {
    renderer3d.clearHint();
    renderer3d.syncState(res.state, res.events, false, freeIds(res.state));
  }
  handleEvents(res.events);
  updateHud();
  if (res.state.terminal) finishRound(res.state);
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === 'exit') {
      AXAudio.play(ev.big ? 'launch-big' : 'launch');
      if (ev.combo >= 2) AXAudio.play('combo', ev.combo);
      lessonEvent('exit');
    } else if (ev.type === 'blocked') {
      AXAudio.play('blocked');
      lessonEvent('blocked');
    } else if (ev.type === 'wave') {
      AXAudio.play('wave');
    } else if (ev.type === 'win') {
      AXAudio.play('win');
      lessonEvent('win');
    } else if (ev.type === 'lose') {
      AXAudio.play('lose');
    }
  }
}

function lessonEvent(name) {
  if (!round || !round.lesson || round.over) return;
  const goal = round.lesson.goal;
  if (!goal || goal.event !== name) return;
  round.lessonCount++;
  if (round.lessonCount >= goal.count) {
    round.over = true;
    stopTimer();
    doc.progress.tutorialDone[round.lesson.id] = true;
    AXStore.save(doc);
    AXAudio.play('star');
    setTimeout(() => showLessonComplete(), 700);
  }
}

function undo() {
  if (!round || round.over || round.pausedAt != null) return;
  if (!round.cfg.mechanics || !round.cfg.mechanics.undo) return;
  if (!round.history.length || round.state.terminal) return;
  round.state = round.history.pop();
  if (renderer3d) renderer3d.syncState(round.state, [], true, freeIds(round.state));
  AXAudio.play('undo');
  lessonEvent('undo');
  updateHud();
}

function hint() {
  if (!round || round.over || round.pausedAt != null || round.state.terminal) return;
  const h = AXRules.hint(round.state);
  if (!h) return;
  if (renderer3d) {
    renderer3d.setHint(h.piece);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { if (renderer3d) renderer3d.clearHint(); }, 2600);
  }
  AXAudio.play('hint');
}

// ---------- pause / overlays ----------
function overlayOpen() {
  return $('pause-overlay').style.display === 'flex' ||
         $('results-overlay').style.display === 'flex';
}

function settingsOpen() {
  return $('settings-overlay') && $('settings-overlay').style.display === 'flex';
}

function openOverlay(id) {
  $(id).style.display = 'flex';
}

function closeOverlays() {
  $('pause-overlay').style.display = 'none';
  $('results-overlay').style.display = 'none';
  const so = $('settings-overlay');
  if (so) so.style.display = 'none';
}

function pause() {
  if (!round || round.over || round.pausedAt != null) return;
  round.pausedAt = performance.now();
  openOverlay('pause-overlay');
}

function resume() {
  if (!round || round.pausedAt == null) return;
  round.pausedTotal += performance.now() - round.pausedAt;
  round.pausedAt = null;
  closeOverlays();
}

// ---------- settings ----------
let settingsOpener = null;   // element to return focus to
let captionTimer = 0;

function showCaption(text) {
  const c = $('caption-line');
  if (!c) return;
  c.textContent = text;
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => { c.textContent = ''; }, 1800);
}

// ---------- graphics settings (model in js/gfx.js, strings in js/gfx-i18n.js) ----------
let appliedGfx = '';          // last graphics JSON pushed to the live renderer
let appliedTheme = '';
const GS = gfxStrings(typeof navigator !== 'undefined' ? navigator.language : 'en-US');

/** Saved graphics settings in the shape gfx.resolve() expects. */
function gfxSaved() {
  const g = doc.settings.graphics && typeof doc.settings.graphics === 'object' ? doc.settings.graphics : {};
  return Object.assign({}, g, { preset: normalizePreset(doc.settings.graphicsTier) });
}

function gfxResolved() {
  return resolve(gfxSaved(), gpuInfo().detected);
}

function applyGraphics() {
  const r = gfxResolved();
  document.body.dataset.gfxPreset = r.preset;
  document.body.dataset.gfxAuto = r.auto ? '1' : '0';
  document.body.classList.toggle('gfx-bg-static', r.background === 'static'); // title key-art drift
  if (!renderer3d) return;
  const json = JSON.stringify(gfxSaved());
  if (json !== appliedGfx) { appliedGfx = json; renderer3d.setGraphics(gfxSaved()); }
}

function applyVisualSettings() {
  document.body.classList.toggle('large-text', !!doc.settings.largeText);
  document.body.classList.toggle('high-contrast', !!doc.settings.highContrast);
  applyGraphics();
  if (renderer3d) {
    if (doc.settings.theme !== appliedTheme) { appliedTheme = doc.settings.theme; renderer3d.setTheme(doc.settings.theme); }
    renderer3d.setReducedMotion(doc.settings.reducedMotion);
  }
  AXAudio.setCaptions(doc.settings.captions, showCaption);
}

function tierName(t) { return (GS.tier && GS.tier[t]) || t; }

// Graphics section of the Settings dialog. Every control has a stable id for tests.
function buildGraphicsSection() {
  const sec = el('section', 'gfx-section');
  sec.id = 'gfx-section';
  sec.setAttribute('aria-labelledby', 'gfx-title');
  const h = el('h3', null, GS.section); h.id = 'gfx-title';
  sec.appendChild(h);
  const r = gfxResolved();
  const g = gfxSaved();
  const det = gpuInfo().detected;

  const tier = el('select'); tier.id = 'set-tier'; tier.setAttribute('data-gfx', 'preset');
  const auto = el('option', null, GS.auto.replace('{tier}', tierName(det))); auto.value = 'auto';
  tier.appendChild(auto);
  PRESETS.forEach(p => { const o = el('option', null, tierName(p)); o.value = p; tier.appendChild(o); });
  tier.value = g.preset;
  sec.appendChild(setRow(GS.quality, tier));

  const scale = el('input'); scale.type = 'range'; scale.id = 'gfx-scale'; scale.setAttribute('data-gfx', 'render_scale');
  scale.min = '50'; scale.max = '200'; scale.step = '5';
  scale.value = String(Math.round((Number(g.render_scale) || 1) * 100));
  const out = el('output', 'gfx-scale-val small', scale.value + '%'); out.id = 'gfx-scale-val'; out.setAttribute('for', 'gfx-scale');
  const wrap = el('span', 'gfx-scale-wrap'); wrap.appendChild(scale); wrap.appendChild(out);
  const scaleRow = setRow(GS.renderScale, wrap);
  scaleRow.querySelector('label').setAttribute('for', 'gfx-scale');
  sec.appendChild(scaleRow);

  Object.keys(CATEGORIES).forEach(cat => {
    const sel = el('select'); sel.id = 'gfx-' + cat; sel.setAttribute('data-gfx', cat);
    const from = el('option', null, GS.fromPreset.replace('{tier}', tierName(presetTier(r.preset, cat))));
    from.value = 'preset';
    sel.appendChild(from);
    CATEGORIES[cat].forEach(t => { const o = el('option', null, tierName(t)); o.value = t; sel.appendChild(o); });
    sel.value = CATEGORIES[cat].includes(g[cat]) ? g[cat] : 'preset';
    sec.appendChild(setRow(GS.cat[cat] || cat, sel));
  });

  const adaptive = el('input'); adaptive.type = 'checkbox'; adaptive.id = 'gfx-adaptive'; adaptive.setAttribute('data-gfx', 'adaptive');
  adaptive.checked = g.adaptive !== false;
  sec.appendChild(setRow(GS.adaptive, adaptive));
  const fpsBox = el('input'); fpsBox.type = 'checkbox'; fpsBox.id = 'gfx-fps'; fpsBox.setAttribute('data-gfx', 'show_fps');
  fpsBox.checked = !!g.show_fps;
  sec.appendChild(setRow(GS.showFps, fpsBox));

  const sum = el('p', 'small muted gfx-summary'); sum.id = 'gfx-summary'; sum.setAttribute('aria-live', 'polite');
  sec.appendChild(sum);
  const note = el('p', 'small gfx-note', GS.postFailed); note.id = 'gfx-note'; note.hidden = true;
  sec.appendChild(note);
  return sec;
}

function refreshGraphicsSection() {
  const sec = $('gfx-section');
  if (!sec) return;
  const r = gfxResolved();
  Object.keys(CATEGORIES).forEach(cat => {
    const sel = $('gfx-' + cat);
    if (sel) sel.options[0].textContent = GS.fromPreset.replace('{tier}', tierName(presetTier(r.preset, cat)));
  });
  const info = renderer3d && renderer3d.graphicsInfo ? renderer3d.graphicsInfo() : null;
  let px;
  if (info && info.resolved) {
    const m = /(\d+)×(\d+) px/.exec(info.summary);
    px = m ? [m[1], m[2]] : null;
  } else { // estimate the square board canvas at the current window size
    const side = Math.min(window.innerHeight * 0.72, window.innerWidth - 28, 640);
    const ratio = Math.min(window.devicePixelRatio || 1, r.maxDpr) * r.scale;
    px = [Math.round(side * ratio), Math.round(side * ratio)];
  }
  $('gfx-summary').textContent = [gpuInfo().gpu || 'unknown GPU', describe(r, px, GS.cost)].join(' · ');
  $('gfx-summary').setAttribute('data-gfx-preset', r.preset);
  $('gfx-note').hidden = !(info && info.postFailed);
}

function onGraphicsChange(target) {
  const key = target.getAttribute('data-gfx');
  const s = doc.settings;
  let g = Object.assign({}, s.graphics && typeof s.graphics === 'object' ? s.graphics : {});
  if (key === 'preset') {
    // choosing a preset clears the per-category overrides
    g = choosePreset(g, target.value);
    s.graphicsTier = g.preset;
    delete g.preset;
    Object.keys(CATEGORIES).forEach(cat => { const sel = $('gfx-' + cat); if (sel) sel.value = 'preset'; });
  } else if (key === 'render_scale') {
    g.render_scale = Math.max(0.5, Math.min(2, Number(target.value) / 100));
    $('gfx-scale-val').textContent = target.value + '%';
  } else if (key === 'adaptive') g.adaptive = target.checked;
  else if (key === 'show_fps') g.show_fps = target.checked;
  else if (CATEGORIES[key]) {
    if (target.value === 'preset') delete g[key]; else g[key] = target.value;
  }
  s.graphics = g;
  applyGraphics();
  refreshGraphicsSection();
  AXStore.save(doc);
}

function setRow(labelTxt, control) {
  const row = el('div', 'set-row');
  const lab = el('label', null, labelTxt);
  if (control.id) lab.setAttribute('for', control.id);
  row.appendChild(lab);
  row.appendChild(control);
  return row;
}

function buildSettingsOverlay() {
  const ov = el('div', 'modal-backdrop');
  ov.id = 'settings-overlay';
  const card = el('div', 'modal card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'settings-title');
  const h = el('h2', null, 'Settings');
  h.id = 'settings-title';
  card.appendChild(h);

  const s = doc.settings;
  const check = (id, on) => {
    const c = el('input'); c.type = 'checkbox'; c.id = id; c.checked = !!on; return c;
  };
  const slider = (id, v) => {
    const r = el('input'); r.type = 'range'; r.id = id;
    r.min = '0'; r.max = '1'; r.step = '0.05'; r.value = String(v); return r;
  };

  card.appendChild(setRow('Mute all audio', check('set-muted', s.muted)));
  card.appendChild(setRow('Music volume', slider('set-music', s.music)));
  card.appendChild(setRow('Effects volume', slider('set-effects', s.effects)));
  card.appendChild(setRow('Ambience volume', slider('set-ambience', s.ambience)));
  card.appendChild(setRow('Voice volume', slider('set-voice', s.voice)));
  card.appendChild(setRow('Captions for sound cues', check('set-captions', s.captions)));

  const stars = Object.values(doc.progress.journeyStars).reduce((a, b) => a + b, 0);
  const theme = el('select'); theme.id = 'set-theme';
  AXContent.THEMES.forEach(t => {
    const locked = stars < t.unlockStars;
    const o = el('option', null, t.name + (locked ? ' (unlock at ' + t.unlockStars + ' stars)' : ''));
    o.value = t.id;
    if (locked) o.disabled = true;
    theme.appendChild(o);
  });
  theme.value = s.theme;
  card.appendChild(setRow('Visual theme', theme));

  card.appendChild(setRow('Reduced motion', check('set-motion', s.reducedMotion)));
  card.appendChild(setRow('Larger text', check('set-large', s.largeText)));
  card.appendChild(setRow('High contrast', check('set-contrast', s.highContrast)));
  card.appendChild(buildGraphicsSection());

  const row = el('div', 'row');
  const close = el('button', 'btn primary', 'Close');
  close.setAttribute('data-action', 'settings-close');
  row.appendChild(close);
  card.appendChild(row);

  ov.appendChild(card);
  ov.addEventListener('change', e => {
    if (e.target.hasAttribute('data-gfx')) onGraphicsChange(e.target); else onSettingsChange();
  });
  ov.addEventListener('input', e => {
    if (e.target.type !== 'range') return;
    if (e.target.hasAttribute('data-gfx')) onGraphicsChange(e.target); else onSettingsChange();
  });
  return ov;
}

function onSettingsChange() {
  const s = doc.settings;
  s.muted = $('set-muted').checked;
  s.music = parseFloat($('set-music').value);
  s.effects = parseFloat($('set-effects').value);
  s.ambience = parseFloat($('set-ambience').value);
  s.voice = parseFloat($('set-voice').value);
  s.captions = $('set-captions').checked;
  s.theme = $('set-theme').value;
  s.reducedMotion = $('set-motion').checked;
  s.largeText = $('set-large').checked;
  s.highContrast = $('set-contrast').checked;
  AXAudio.applySettings(s);
  applyVisualSettings();
  AXStore.save(doc);
}

function openSettings() {
  settingsOpener = document.activeElement;
  // rebuild so theme locks and values reflect the latest progress/save
  const old = $('settings-overlay');
  if (old) old.parentNode.replaceChild(buildSettingsOverlay(), old);
  else document.getElementById('app').appendChild(buildSettingsOverlay());
  openOverlay('settings-overlay');
  refreshGraphicsSection();
  const first = $('set-muted');
  if (first) first.focus();
}

function closeSettings() {
  const so = $('settings-overlay');
  if (so) so.style.display = 'none';
  if (settingsOpener && settingsOpener.isConnected) settingsOpener.focus();
  settingsOpener = null;
}

function resign() {
  if (!round || round.over || round.state.terminal) return;
  if (round.pausedAt != null) { // settle the open pause so away time is not billed to the round
    round.pausedTotal += performance.now() - round.pausedAt;
    round.pausedAt = null;
  }
  const res = AXRules.applyCommand(round.state,
    { type: 'resign', id: 'c' + (++cmdSeq), atMs: elapsedMs() });
  if (!res.ok) return;
  round.state = res.state;
  if (renderer3d) renderer3d.syncState(res.state, res.events, false, []);
  handleEvents(res.events);
  finishRound(res.state);
}

function quitToTitle() {
  stopTimer();
  closeOverlays();
  round = null;
  if (renderer3d) { renderer3d.dispose(); renderer3d = null; }
  $('canvas-host').innerHTML = '';
  fillPanels();
  showScreen('title');
}

// ---------- results ----------
function recordResult(state) {
  const p = doc.progress, st = p.stats;
  st.rounds++;
  st.exits += state.score.exits;
  st.bestCombo = Math.max(st.bestCombo, state.score.comboBest);
  st.playMs += elapsedMs();
  const won = !!(state.terminal && state.terminal.won);
  if (won) {
    st.wins++;
    if (state.invalid === 0) st.flawlessWins++;
  }
  const kind = round.ctx.kind;
  if (kind === 'journey' && won) {
    const id = round.cfg.id;
    let stars = 1;
    if (state.invalid === 0) stars++;
    if (round.cfg.par && round.cfg.par.timeSec && state.elapsedMs > 0 &&
        state.elapsedMs < round.cfg.par.timeSec * 1000) stars++;
    p.journeyStars[id] = Math.max(p.journeyStars[id] || 0, stars);
    p.journeyBest[id] = Math.max(p.journeyBest[id] || 0, state.score.total);
  } else if (kind === 'challenge' && won) {
    p.challengeBest[round.cfg.id] = Math.max(p.challengeBest[round.cfg.id] || 0, state.score.total);
  } else if (kind === 'daily' && won) {
    p.dailiesDone[round.cfg.date] = Math.max(p.dailiesDone[round.cfg.date] || 0, state.score.total);
  } else if (kind === 'score') {
    p.endlessBest = Math.max(p.endlessBest || 0, state.score.total);
  }
  // achievements (idempotent, stable lowercase keys)
  const unlock = key => {
    if (!p.achievements[key]) { p.achievements[key] = Date.now(); AXAudio.play('star'); }
  };
  if (st.exits > 0) unlock('first-exit');
  if (won) unlock('first-win');
  if (won && state.invalid === 0) unlock('flawless');
  if (state.score.comboBest >= 8) unlock('combo-8');
  if (Object.keys(p.journeyStars).length >= 20) unlock('journey-half');
  if (Object.keys(p.journeyStars).length >= AXContent.JOURNEY.length) unlock('journey-done');
  if (Object.keys(p.dailiesDone).length >= 7) unlock('daily-7');
  if (state.score.total >= 3000) unlock('score-3000');
  if (st.exits >= 500) unlock('exits-500');
  AXStore.save(doc);
}

function scoreBreakdown(state) {
  const s = state.score;
  const lines = [
    ['Exits', s.exits + ' → ' + s.exitPoints + ' pts'],
    ['Best combo', '×' + s.comboBest],
    ['Flawless bonus', s.perfectBonus + ' pts'],
    ['Time bonus', s.timeBonus + ' pts']
  ];
  if (state.cfg.endless) lines.push(['Plates cleared', s.waves + ' → ' + s.waveBonus + ' pts']);
  lines.push(['Mistakes', String(state.invalid)]);
  lines.push(['Time', fmtTime(elapsedMs())]);
  lines.push(['Total', s.total + ' pts']);
  return lines;
}

function finishRound(state) {
  round.over = true;
  stopTimer();
  recordResult(state);
  setTimeout(() => showResults(state), 800);
}

function terminalHeadline(state) {
  if (!state.terminal) return 'Round over';
  if (round.timedOut) return "Time's up";
  switch (state.terminal.reason) {
    case AXRules.TERMINAL.CLEAR: return 'Plate cleared!';
    case AXRules.TERMINAL.LOCKED: return 'No clear paths left';
    case AXRules.TERMINAL.TIME: return "Time's up";
    default: return 'Round resigned';
  }
}

function fillResults(overlay, headline, lines, art) {
  overlay.innerHTML = '';
  const card = el('div', 'modal card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  if (art) { // decorative illustration; hidden if the asset fails to load
    const img = el('img', 'result-art');
    img.src = art; img.alt = '';
    img.addEventListener('error', () => { img.style.display = 'none'; });
    card.appendChild(img);
  }
  card.appendChild(el('h2', null, headline));
  const dl = el('div', 'small');
  for (const [k, v] of lines) {
    const row = el('div', 'score-line');
    row.appendChild(el('span', 'muted', k));
    row.appendChild(el('span', null, v));
    dl.appendChild(row);
  }
  card.appendChild(dl);
  const row = el('div', 'row');
  card.appendChild(row);
  overlay.appendChild(card);
  return row;
}

function overlayButton(row, action, label, primary) {
  const b = el('button', 'btn' + (primary ? ' primary' : ''), label);
  b.setAttribute('data-action', action);
  row.appendChild(b);
  return b;
}

function showResults(state) {
  if (!round) return;
  closeOverlays();
  const won = !!(state.terminal && state.terminal.won);
  const art = won ? '/assets/plate-cleared.webp'
    : (state.terminal && state.terminal.reason === AXRules.TERMINAL.LOCKED ? '/assets/no-lanes.webp' : null);
  const row = fillResults($('results-overlay'), terminalHeadline(state), scoreBreakdown(state), art);
  overlayButton(row, 'replay', 'Replay', true);
  if (round.ctx.kind === 'journey' && state.terminal && state.terminal.won &&
      round.ctx.index + 1 < AXContent.JOURNEY.length)
    overlayButton(row, 'next', 'Next stage');
  overlayButton(row, 'results-modes', 'Back to Modes');
  overlayButton(row, 'quit-play', 'Title');
  openOverlay('results-overlay');
}

function showLessonComplete() {
  if (!round) return;
  closeOverlays();
  const row = fillResults($('results-overlay'), 'Lesson complete',
    [[round.lesson.title, 'done']], '/assets/plate-cleared.webp');
  const lessons = AXContent.tutorialLessons();
  if (round.ctx.index + 1 < lessons.length)
    overlayButton(row, 'next', 'Next lesson', true);
  overlayButton(row, 'results-modes', 'Back to Modes');
  overlayButton(row, 'quit-play', 'Title');
  openOverlay('results-overlay');
}

// ---------- actions ----------
const actions = {
  'play': () => startJourney(nextJourneyIndex()),
  'daily': () => actions['daily-mode'](),
  'daily-mode': () => {
    const cfg = AXContent.dailyConfig(AXContent.utcDateString());
    startRound(cfg, { kind: 'daily', label: cfg.name, sub: cfg.intro });
  },
  'journey-info': () => showScreen('journey-info'),
  'journey': () => showScreen('journey-info'),
  'start-journey': () => startJourney(nextJourneyIndex()),
  'learn': () => startLesson(firstUnfinishedLesson()),
  'practice-info': () => showScreen('practice-info'),
  'challenge-info': () => showScreen('challenge-info'),
  'score-chase-info': () => showScreen('score-chase-info'),
  'start-score-chase': () =>
    startRound(AXContent.SCORE_CHASE, { kind: 'score', label: 'Score Chase — Endless Plates', sub: AXContent.SCORE_CHASE.intro }),
  'profile': () => showScreen('profile-info'),
  'start-profile': () => showScreen('title'),
  'back-modes': () => showScreen('modes'),
  'practice-start': id => {
    const pr = AXContent.PRACTICE.find(p => p.id === id);
    if (pr) startRound(pr, { kind: 'practice', label: 'Practice — ' + pr.name, sub: 'Relaxed play. No effect on rating.' });
  },
  'challenge-start': id => {
    const ch = AXContent.CHALLENGES.find(c => c.id === id);
    if (ch) startRound(ch, { kind: 'challenge', label: 'Challenge — ' + ch.name, sub: ch.intro });
  },
  'hint': () => hint(),
  'undo': () => undo(),
  'pause': () => pause(),
  'resume': () => resume(),
  'settings': () => openSettings(),
  'settings-close': () => closeSettings(),
  'restart': () => { if (round) startRound(round.ctx.kind === 'tutorial' ? round.lesson.cfg : round.cfg, round.ctx); },
  'resign': () => { closeOverlays(); resign(); },
  'quit-play': () => quitToTitle(),
  'replay': () => actions['restart'](),
  'next': () => {
    if (!round) return;
    if (round.ctx.kind === 'journey') startJourney(round.ctx.index + 1);
    else if (round.ctx.kind === 'tutorial') startLesson(round.ctx.index + 1);
  },
  'results-modes': () => { const r = round; quitToTitle(); showScreen('modes'); }
};

function onAction(action, id) {
  const fn = actions[action];
  if (!fn) return;
  AXAudio.play('ui');
  fn(id);
}

// ---------- input ----------
function pieceAtCell(r, c) {
  if (!round) return null;
  for (const p of round.state.pieces)
    for (const cell of p.cells)
      if (cell[0] === r && cell[1] === c) return p;
  return null;
}

function onKeyDown(e) {
  if (e.key === 'Escape' && settingsOpen()) { e.preventDefault(); closeSettings(); return; }
  if (currentScreen !== 'play' || !round) return;
  if (overlayOpen()) {
    if (e.key === 'Escape') { e.preventDefault(); resume(); }
    return;
  }
  const rows = round.cfg.board.rows, cols = round.cfg.board.cols;
  const moveCursor = (dr, dc) => {
    if (!round.cursor) round.cursor = [0, 0];
    round.cursor = [
      Math.min(rows - 1, Math.max(0, round.cursor[0] + dr)),
      Math.min(cols - 1, Math.max(0, round.cursor[1] + dc))
    ];
    if (renderer3d) renderer3d.setCursor(round.cursor);
    AXAudio.play('cursor');
  };
  switch (e.key) {
    case 'ArrowUp': e.preventDefault(); moveCursor(-1, 0); break;
    case 'ArrowDown': e.preventDefault(); moveCursor(1, 0); break;
    case 'ArrowLeft': e.preventDefault(); moveCursor(0, -1); break;
    case 'ArrowRight': e.preventDefault(); moveCursor(0, 1); break;
    case 'Enter':
    case ' ':
      if (round.cursor) {
        e.preventDefault();
        const p = pieceAtCell(round.cursor[0], round.cursor[1]);
        if (p) tapPiece(p.id);
      }
      break;
    case 'h': case 'H': hint(); break;
    case 'u': case 'U': undo(); break;
    case 'p': case 'P': case 'Escape':
      e.preventDefault(); pause(); break;
  }
}

// ---------- init ----------
async function init() {
  doc = AXStore.load();
  sessionId = AXRNG.hashString(String(Date.now()) + ':' + Math.random()).toString(36);

  // pause / results overlays live inside the play screen
  const playScreen = document.querySelector('[data-screen="play"]');
  const pauseOverlay = el('div', 'modal-backdrop');
  pauseOverlay.id = 'pause-overlay';
  playScreen.appendChild(pauseOverlay);
  const pauseRow = fillResults(pauseOverlay, 'Paused', []);
  overlayButton(pauseRow, 'resume', 'Resume', true);
  overlayButton(pauseRow, 'restart', 'Restart');
  overlayButton(pauseRow, 'settings', 'Settings');
  overlayButton(pauseRow, 'resign', 'Resign');
  overlayButton(pauseRow, 'quit-play', 'Quit to Title');
  const resultsOverlay = el('div', 'modal-backdrop');
  resultsOverlay.id = 'results-overlay';
  playScreen.appendChild(resultsOverlay);
  closeOverlays();

  // event delegation for every [data-action] control
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (b) onAction(b.getAttribute('data-action'), b.getAttribute('data-id'));
  });

  // canvas picking
  $('canvas-host').addEventListener('pointerdown', e => {
    if (!renderer3d || !round || round.over || round.pausedAt != null) return;
    const id = renderer3d.pickPiece(e.clientX, e.clientY);
    if (id) tapPiece(id);
  });

  document.addEventListener('keydown', onKeyDown);

  // audio unlocks on the first gesture; settings follow the save document
  const unlock = () => {
    if (AXAudio.start()) AXAudio.applySettings(doc.settings);
    document.removeEventListener('pointerdown', unlock);
  };
  document.addEventListener('pointerdown', unlock);

  // saved accessibility/visual preferences apply from boot
  AXAudio.setCaptions(doc.settings.captions, showCaption);
  document.body.classList.toggle('large-text', !!doc.settings.largeText);
  document.body.classList.toggle('high-contrast', !!doc.settings.highContrast);
  applyGraphics();

  window.addEventListener('resize', () => { if (renderer3d) renderer3d.resize(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); AXAudio.suspend(); }
    else AXAudio.resume();
  });

  fillPanels();
  renderAccountLine();
  showScreen('title');

  // StarHermit host adapter: identity, token refresh and the cloud save
  // mirror. When a remote save exists it wins over the local cache;
  // localStorage remains the offline fallback either way.
  try {
    const remoteRaw = await AXPlatform.init({
      onProfile: renderAccountLine,
      onSync: renderAccountLine
    });
    const remoteDoc = remoteRaw ? AXStore.loadRaw(remoteRaw) : null;
    if (remoteDoc) {
      doc = remoteDoc;
      AXStore.save(doc); // local cache mirrors the remote doc
      AXAudio.setCaptions(doc.settings.captions, showCaption);
      AXAudio.applySettings(doc.settings);
      document.body.classList.toggle('large-text', !!doc.settings.largeText);
      document.body.classList.toggle('high-contrast', !!doc.settings.highContrast);
      applyGraphics();
      fillPanels();
    }
  } catch (e) { /* offline or no token: the local save is already loaded */ }
}

init();

export default {
  $: $, el: el,
  get webglOk(){ return webglOk; },
  startRound: startRound,
  showScreen: showScreen
};
