// The save paths src/save.ts takes, on js/store.js's pure functions: the
// browser build's cloud save (the JS SDK's save.json: the checksummed
// { sum, payload } wrapper) parsed and merged into this device's progress,
// and two devices' engine saves ({ v, progress }) merged on a conflict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from './load.mjs';

// (objects from the scripts' own realm: compared as JSON)
const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const S = loadClassic('rng.js', 'store.js').AXStore;
const wrap = (doc) => { const payload = JSON.stringify(doc); return JSON.stringify({ sum: S.checksum(payload), payload }); };
const docOf = (data) => S.migrate({ v: data.v, progress: data.progress });

test('a browser-build cloud save migrates: records merged, its game settings read', () => {
  const old = S.fresh();
  old.settings.theme = 'glacier';
  old.settings.captions = true;
  old.progress.journeyStars = { j01: 3, j02: 1 };
  old.progress.endlessBest = 900;
  old.progress.achievements = { 'first-win': 100 };
  old.progress.stats.rounds = 12;
  const imported = S.loadRaw(wrap(old));
  assert.ok(imported);
  assert.equal(imported.settings.theme, 'glacier');
  const here = S.fresh();
  here.progress.journeyStars = { j02: 2, j03: 1 };
  here.progress.achievements = { 'first-win': 50, flawless: 60 };
  here.progress.stats.rounds = 3;
  const merged = S.mergeDocs(imported, here);
  same(merged.progress.journeyStars, { j01: 3, j02: 2, j03: 1 });
  assert.equal(merged.progress.endlessBest, 900);
  same(merged.progress.achievements, { 'first-win': 50, flawless: 60 });
  assert.equal(merged.progress.stats.rounds, 12);
});

test('a corrupt or foreign-format slot is ignored', () => {
  assert.equal(S.loadRaw('{"sum":"x","payload":"{}"}'), null);
  assert.equal(S.loadRaw('not json'), null);
  assert.equal(S.loadRaw(null), null);
});

test('engine saves ({ v, progress }) merge on a conflict', () => {
  const a = { v: 1, progress: { ...S.fresh().progress, challengeBest: { c1: 500 }, dailiesDone: { '2026-10-01': 10 } } };
  const b = { v: 1, progress: { ...S.fresh().progress, challengeBest: { c1: 700, c2: 1 }, tutorialDone: { t1: true } } };
  const m = S.mergeDocs(docOf(a), docOf(b));
  same(m.progress.challengeBest, { c1: 700, c2: 1 });
  same(m.progress.dailiesDone, { '2026-10-01': 10 });
  assert.equal(m.progress.tutorialDone.t1, true);
  assert.equal(S.mergeDocs(null, docOf(b)).progress.tutorialDone.t1, true);
});
