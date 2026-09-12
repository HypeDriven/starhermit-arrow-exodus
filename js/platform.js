/* Arrow Exodus — StarHermit host adapter: launch-token read, identity,
 * cloud-save mirror, token refresh. Every call is a no-op when the game runs
 * standalone (no launch token): localStorage stays the only save and offline
 * play is unchanged.
 *
 * Contract (wiki): the platform opens the game as index.html#game_token=<jwt>
 * (optional &session_id=), stripped from the URL after the read. The JWT
 * carries sub = user id and game_scope = this game's slug — never hard-coded.
 * Same-origin /api calls send Authorization: Bearer. The display name is the
 * profile nickname from GET /api/v1/users/{sub}/profile (never /api/v1/me,
 * never usernames). Cloud save is one zip+base64 slot at
 * /api/v1/me/cloud-saves/{slug}, loaded remote-first and saved debounced.
 * Browser global: window.AXPlatform. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AXPlatform = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REFRESH_MS = 45 * 60 * 1000;  // token lives 60 min; re-mint at 45
  var RETRY_MS = 60 * 1000;         // failed refresh retry
  var SAVE_DEBOUNCE_MS = 2000;

  // ---------- minimal ZIP writer/reader (stored entries, no compression) ----------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipStore(name, dataBytes) {
    var enc = new TextEncoder();
    var nameB = enc.encode(name);
    var crc = crc32(dataBytes);
    var out = [];
    var u16 = function (v) { out.push(v & 0xff, (v >> 8) & 0xff); };
    var u32 = function (v) { out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); };
    u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
    u32(crc); u32(dataBytes.length); u32(dataBytes.length);
    u16(nameB.length); u16(0);
    var head = new Uint8Array(out);
    var cd = [];
    var c16 = function (v) { cd.push(v & 0xff, (v >> 8) & 0xff); };
    var c32 = function (v) { cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); };
    c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
    c32(crc); c32(dataBytes.length); c32(dataBytes.length);
    c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0);
    var cdHead = new Uint8Array(cd);
    var cdOff = head.length + nameB.length + dataBytes.length;
    var parts = [head, nameB, dataBytes, cdHead, nameB];
    var eocd = [];
    var e32 = function (v) { eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); };
    var e16 = function (v) { eocd.push(v & 0xff, (v >> 8) & 0xff); };
    e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
    e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
    parts.push(new Uint8Array(eocd));
    var total = 0, o = 0;
    for (var p = 0; p < parts.length; p++) total += parts[p].length;
    var buf = new Uint8Array(total);
    for (var q = 0; q < parts.length; q++) { buf.set(parts[q], o); o += parts[q].length; }
    return buf;
  }
  function unzipFirstEntry(zipBytes) {
    var dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    var off = 0;
    while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
      var method = dv.getUint16(off + 8, true);
      var size = dv.getUint32(off + 18, true);
      var nameLen = dv.getUint16(off + 26, true);
      var extraLen = dv.getUint16(off + 28, true);
      var dataOff = off + 30 + nameLen + extraLen;
      if (method !== 0) throw new Error('unsupported zip entry');
      return zipBytes.slice(dataOff, dataOff + size);
    }
    throw new Error('bad zip');
  }
  function bytesToBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---------- state ----------
  var token = null;        // launch token, never persisted
  var userId = null;       // JWT sub
  var slug = null;         // JWT game_scope — the cloud-save gameKey
  var profile = null;      // { displayName }
  var sync = 'offline';    // offline | saving | synced
  var refreshTimer = null, retryTimer = null, saveTimer = null;
  var pendingSave = null;  // wrapped save string awaiting the debounced PUT
  var listeners = { profile: [], sync: [] };

  function notify(kind, value) {
    var fns = listeners[kind];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](value); } catch (e) { /* listener errors never break the adapter */ }
    }
  }
  function setSync(state) {
    if (sync === state) return;
    sync = state;
    notify('sync', sync);
  }

  // ---------- launch token ----------
  // Fragment first (the platform contract); query params are local-dev only.
  function readToken() {
    try {
      var h = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
      var t = h.get('game_token');
      if (t) {
        h.delete('game_token');
        h.delete('session_id');
        var rest = h.toString();
        if (window.history && window.history.replaceState)
          window.history.replaceState(null, '',
            window.location.pathname + window.location.search + (rest ? '#' + rest : ''));
        return t;
      }
      var q = new URLSearchParams(window.location.search);
      return q.get('game_token') || q.get('token') || q.get('launch') || null;
    } catch (e) { return null; }
  }

  function decodeJwt(t) {
    try {
      var seg = String(t).split('.')[1];
      if (!seg) return null;
      var b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
      b64 += '='.repeat((4 - (b64.length % 4)) % 4);
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return null; }
  }

  // ---------- REST ----------
  function apiFetch(path, method, body, binary, keepalive) {
    var headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    var opts = { method: method || 'GET', headers: headers, credentials: 'same-origin', keepalive: !!keepalive };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      if (binary) {
        if (res.status === 404) return { status: 404, bytes: null };
        if (!res.ok) return { status: res.status, bytes: null };
        return res.arrayBuffer().then(function (buf) { return { status: res.status, bytes: buf }; });
      }
      return res.json().catch(function () { return null; }).then(function (json) {
        return { status: res.status, json: json };
      });
    });
  }

  // ---------- token refresh (scoped tokens may re-mint) ----------
  function refreshToken() {
    if (!token || !slug) return;
    apiFetch('/api/v1/games/' + encodeURIComponent(slug) + '/launch-token', 'POST')
      .then(function (r) {
        if (r.json && typeof r.json.token === 'string' && r.json.token) {
          token = r.json.token;
          var claims = decodeJwt(token);
          if (claims && claims.sub) userId = claims.sub;
          if (claims && claims.game_scope) slug = claims.game_scope;
        } else {
          retryRefresh();
        }
      })
      .catch(retryRefresh);
  }
  function retryRefresh() {
    if (retryTimer || !token) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      refreshToken();
    }, RETRY_MS);
  }
  function startRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshToken, REFRESH_MS);
  }

  // ---------- identity ----------
  // Nickname via /api/v1/users/{sub}/profile — the only profile read a
  // game-scoped token may make. Never /api/v1/me, never usernames.
  function fetchProfile() {
    if (!token || !userId) return Promise.resolve(null);
    return apiFetch('/api/v1/users/' + encodeURIComponent(userId) + '/profile')
      .then(function (r) {
        var name = null;
        if (r.status >= 200 && r.status < 300 && r.json && typeof r.json.nickname === 'string')
          name = r.json.nickname;
        profile = { displayName: (name || ('Player ' + String(userId).slice(0, 8))).slice(0, 40) };
        notify('profile', profile);
        return profile;
      })
      .catch(function () {
        if (!profile) {
          profile = { displayName: 'Player ' + String(userId).slice(0, 8) };
          notify('profile', profile);
        }
        return profile;
      });
  }

  // ---------- cloud save (one slot, zip+base64; localStorage stays the cache) ----------
  function loadCloud() {
    if (!token || !slug) return Promise.resolve(null);
    return apiFetch('/api/v1/me/cloud-saves/' + encodeURIComponent(slug), 'GET', undefined, true)
      .then(function (r) {
        if (r.status === 404 || !r.bytes || !r.bytes.byteLength) return null;
        var entry = unzipFirstEntry(new Uint8Array(r.bytes));
        return new TextDecoder().decode(entry); // wrapped {sum, payload} save string
      })
      .catch(function () { return null; });
  }

  function pushCloud() {
    if (!token || !slug || pendingSave == null) return Promise.resolve(false);
    var raw = pendingSave;
    pendingSave = null;
    var body;
    try {
      body = { dataBase64: bytesToBase64(zipStore('save.json', new TextEncoder().encode(raw))) };
    } catch (e) { return Promise.resolve(false); }
    return apiFetch('/api/v1/me/cloud-saves/' + encodeURIComponent(slug), 'PUT', body, false, true)
      .then(function (r) {
        if (r.status >= 200 && r.status < 300) { setSync('synced'); return true; }
        pendingSave = pendingSave == null ? raw : pendingSave; // keep for the next flush
        setSync('offline');
        return false;
      })
      .catch(function () {
        pendingSave = pendingSave == null ? raw : pendingSave;
        setSync('offline');
        return false;
      });
  }

  function scheduleCloudSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; pushCloud(); }, SAVE_DEBOUNCE_MS);
  }

  // Called by AXStore.save with the wrapped local save string; mirrors it.
  function onLocalSave(wrapped) {
    if (!token || !slug) return;
    pendingSave = wrapped;
    setSync('saving');
    scheduleCloudSave();
  }

  function flushCloud() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return pushCloud();
  }

  // ---------- boot ----------
  // Resolves with the wrapped remote save string when one exists (remote wins
  // over local), or null. opts.onProfile / opts.onSync fire on updates.
  function init(opts) {
    opts = opts || {};
    if (typeof opts.onProfile === 'function') listeners.profile.push(opts.onProfile);
    if (typeof opts.onSync === 'function') listeners.sync.push(opts.onSync);

    token = readToken();
    if (token) {
      var claims = decodeJwt(token);
      if (!claims) token = null; // malformed: treat as standalone
      else {
        if (typeof claims.sub === 'string' && claims.sub) userId = claims.sub;
        if (typeof claims.game_scope === 'string' && claims.game_scope) slug = claims.game_scope;
        if (!userId || !slug) token = null; // not a usable launch token
      }
    }

    if (!token) { setSync('offline'); return Promise.resolve(null); }

    startRefresh();
    try {
      window.addEventListener('pagehide', flushCloud);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) flushCloud();
      });
    } catch (e) { /* no window events available */ }

    fetchProfile(); // nickname lands via onProfile whenever it resolves
    return loadCloud();
  }

  return {
    init: init,
    onLocalSave: onLocalSave,
    flushCloud: flushCloud,
    get hosted() { return !!token; },
    get profile() { return profile; },
    get sync() { return sync; }
  };
});
