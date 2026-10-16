/* StarHermit adapter tests: loads starhermit-sdk.js + js/platform.js in a
 * sandbox with a stubbed fetch and launch fragment. Run: node --test */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'arrow-exodus';
const USER = 'a1b2c3d4-0000-4000-8000-000000000001';

const b64url = s => Buffer.from(s).toString('base64url');
const jwt = claims => b64url('{"alg":"none"}') + '.' + b64url(JSON.stringify(claims)) + '.sig';

function boot({ hash = '' } = {}) {
  const calls = [];
  const cloud = { bytes: null };
  const kv = { music: 0.3 };
  const ctx = {
    URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, Blob, Response, console,
    // long timers (token renewal) are recorded, not scheduled, so the test exits
    setTimeout: (fn, ms) => (ms > 5000 ? 0 : setTimeout(fn, ms)),
    clearTimeout: id => { if (id) clearTimeout(id); },
    addEventListener() {},
    document: { hidden: false, addEventListener() {} },
    location: { hash, search: '', pathname: '/', hostname: 'localhost', origin: 'http://localhost', href: 'http://localhost/' + hash },
    history: { state: null, replaceState(_s, _t, url) { ctx.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } },
  };
  ctx.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers && init.headers.Authorization });
    const u = decodeURIComponent(url);
    if (u.endsWith('/api/v1/users/' + USER + '/profile')) return Response.json({ nickname: 'Fletch' });
    if (u.endsWith('/cloud-saves/game:' + SLUG)) {
      if (method === 'PUT') {
        if (cloud.conflict) { cloud.conflict = false; return Response.json({ etag: '"other"' }, { status: 412 }); }
        cloud.puts = (cloud.puts || 0) + 1;
        cloud.bytes = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        return Response.json({ etag: '"v' + cloud.puts + '"' });
      }
      return cloud.bytes ? new Response(cloud.bytes) : new Response('', { status: 404 });
    }
    if (u.endsWith('/games/' + SLUG + '/settings')) {
      if (method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return Response.json({ settings: kv }); }
      return Response.json({ settings: kv });
    }
    if (u.endsWith('/games/' + SLUG + '/controls')) return Response.json({ actions: [{ action: 'hint', codes: ['KeyJ'] }] });
    return new Response('', { status: 404 });
  };
  ctx.self = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['starhermit-sdk.js', 'js/platform.js', 'js/store.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return { ctx, calls, cloud, kv, P: ctx.AXPlatform, SH: ctx.StarHermit, S: ctx.AXStore };
}

const wrap = doc => { const payload = JSON.stringify(doc); return JSON.stringify({ sum: 'x', payload }); };

test('standalone: no token, no network, local behaviour', async () => {
  const { P, calls } = boot();
  assert.equal(P.hosted, false);
  assert.equal(await P.init(), null);
  P.onLocalSave(wrap({ settings: { music: 1 } }));
  await P.flushCloud();
  assert.equal(P.inviteLink(), null);
  assert.equal(P.canSignIn(), false); // not on *.starhermit.com
  assert.deepEqual(JSON.parse(JSON.stringify(await P.loadBindings({ hint: ['KeyH'] }))), { hint: ['KeyH'] });
  assert.deepEqual(JSON.parse(JSON.stringify(await P.submitScore(1200))), { posted: false, rank: null });
  assert.equal(calls.length, 0);
});

test('launch token: identity, cloud save game:<slug>, settings, bindings', async () => {
  const token = jwt({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 });
  const { P, SH, ctx, calls, cloud, kv } = boot({ hash: '#game_token=' + token + '&session_id=s1' });
  assert.equal(P.hosted, true);
  assert.equal(SH.slug, SLUG);
  assert.equal(SH.token, token);
  assert.equal(ctx.location.hash, '', 'launch fragment stripped');

  let named = null;
  const raw = await P.init({ onProfile: p => { named = p.displayName; } });
  assert.equal(raw, null, 'no cloud save yet');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(named, 'Fletch');
  assert.equal(P.profile.displayName, 'Fletch');
  assert.deepEqual(JSON.parse(JSON.stringify(P.platformSettings)), { music: 0.3 });
  assert.ok(calls.every(c => c.auth === 'Bearer ' + token));
  assert.ok(!calls.some(c => c.url.includes('/api/v1/me') && !c.url.includes('cloud-saves')), 'never /api/v1/me');

  // settings patch only carries changed keys; cloud save round-trips
  const doc = { v: 1, settings: { music: 0.3, effects: 0.5 }, progress: { endlessBest: 42 } };
  const wrapped = wrap(doc);
  P.onLocalSave(wrapped);
  await P.flushCloud();
  const patch = calls.find(c => c.method === 'PATCH');
  assert.ok(patch.url.endsWith('/api/v1/games/' + SLUG + '/settings'));
  assert.deepEqual(patch.body, { settings: { effects: 0.5 } });
  assert.equal(kv.effects, 0.5);
  const put = calls.find(c => c.method === 'PUT');
  assert.equal(decodeURIComponent(put.url), '/api/v1/me/cloud-saves/game:' + SLUG);
  assert.ok(cloud.bytes && cloud.bytes.length > 0);
  assert.equal(P.sync, 'synced');

  // a fresh launch loads the same document remote-first
  const again = boot({ hash: '#game_token=' + token });
  again.cloud.bytes = cloud.bytes;
  assert.equal(await again.P.init(), wrapped);

  assert.deepEqual(JSON.parse(JSON.stringify(await P.loadBindings({ hint: ['KeyH'], undo: ['KeyU'] }))),
    { hint: ['KeyJ'], undo: ['KeyU'] });
  assert.match(P.inviteLink(), new RegExp('/game-invite/' + USER + '/' + SLUG + '$'));
});

test('sign-out on refused renewal shows standalone state', async () => {
  const token = jwt({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 });
  const { P, SH } = boot({ hash: '#game_token=' + token });
  const seen = [];
  await P.init({ onAuth: a => seen.push(a.signedIn) });
  SH.signOut('expired');
  assert.deepEqual(seen, [false]);
  assert.equal(P.hosted, false);
  assert.equal(P.inviteLink(), null);
});

test('account strings exist in every required locale', async () => {
  const { PLATFORM_STRINGS } = await import('../js/gfx-i18n.js');
  const keys = Object.keys(PLATFORM_STRINGS['en-US']);
  for (const loc of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'])
    for (const k of keys) assert.ok(PLATFORM_STRINGS[loc] && PLATFORM_STRINGS[loc][k], loc + '.' + k);
});

test('save conflict: the cloud copy is reloaded and handed to the game for merging', async () => {
  const token = jwt({ sub: USER, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 });
  const { P, SH, S, cloud } = boot({ hash: '#game_token=' + token });
  const conflicts = [];
  await P.init({ onConflict: raw => conflicts.push(raw) });
  const mine = S.fresh(); mine.progress.journeyStars = { j01: 3 }; mine.progress.stats.rounds = 4;
  const theirs = S.fresh(); theirs.progress.journeyStars = { j01: 1, j02: 2 }; theirs.progress.endlessBest = 900;
  theirs.progress.stats.rounds = 7; theirs.settings.music = 0;
  const wrapDoc = d => { const payload = JSON.stringify(d); return JSON.stringify({ sum: S.checksum(payload), payload }); };
  // another device wrote first: the next conditional PUT is refused
  cloud.bytes = null;
  P.onLocalSave(wrapDoc(mine));
  await P.flushCloud();
  cloud.conflict = true;
  P.onLocalSave(wrapDoc(mine));
  // the reload after the refused write reads the other device's save
  const other = boot({ hash: '#game_token=' + token });
  await other.P.init();
  other.P.onLocalSave(wrapDoc(theirs)); await other.P.flushCloud();
  cloud.bytes = other.cloud.bytes;
  await P.flushCloud();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(SH.saveConflicted(), false, 'reload clears the conflict');
  assert.equal(conflicts.length, 1);
  const merged = S.mergeDocs(S.loadRaw(conflicts[0]), mine);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.progress.journeyStars)), { j01: 3, j02: 2 });
  assert.equal(merged.progress.endlessBest, 900);
  assert.equal(merged.progress.stats.rounds, 7);
  assert.equal(merged.settings.music, mine.settings.music, 'local settings kept');
});

test('every player-facing string exists in all nine locales', async () => {
  const ctx = { URLSearchParams, location: { search: '' }, navigator: { languages: ['en-US'] } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ['sh-language.js', 'js/i18n.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const S = ctx.AXI18n.strings, keys = Object.keys(S['en-US']);
  assert.deepEqual([...ctx.AXI18n.locales], ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']);
  for (const loc of ctx.AXI18n.locales) for (const k of keys) assert.ok(S[loc][k], loc + '.' + k);
  // every journey stage, challenge, lesson and theme has a translated name
  ctx.self = ctx;
  for (const f of ['js/rng.js', 'js/content.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const content = ctx.AXContent;
  for (const loc of ctx.AXI18n.locales) {
    for (const l of content.JOURNEY) { assert.ok(S[loc]['j.' + l.id]); if (l.intro) assert.ok(S[loc]['ji.' + l.id], loc + ' ji.' + l.id); }
    for (const c of content.CHALLENGES) assert.ok(S[loc]['ch.' + c.id] && S[loc]['chi.' + c.id]);
    for (const l of content.tutorialLessons()) assert.ok(S[loc]['lt.' + l.id] && S[loc]['lx.' + l.id]);
    for (const th of content.THEMES) assert.ok(S[loc]['theme.' + th.id]);
  }
});
