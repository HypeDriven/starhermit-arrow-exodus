/* Arrow Exodus — WebAudio: authored one-shot samples (sfx/*.opus) preferred
 * per logical event, with the original procedural synthesis as fallback while
 * a clip loads or if it fails: metallic launch zips, enamel clicks, quiet
 * machine-shop ambience, adaptive music pad. Browser global: AXAudio.
 */
(function (root) {
  'use strict';

  var ctx = null, master = null;
  var buses = {}; // music, effects, ambience, voice
  var settings = { music: 0.6, effects: 0.9, ambience: 0.5, voice: 0.8, muted: false };
  var captions = false;
  var captionFn = null;
  var started = false;
  var musicTimer = null, ambienceNodes = null;
  var avRng = null; // seeded variants for replay consistency

  function ensureCtx() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    ['music', 'effects', 'ambience', 'voice'].forEach(function (name) {
      var g = ctx.createGain();
      g.gain.value = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      g.connect(master);
      buses[name] = g;
    });
    return true;
  }

  function applySettings(s) {
    Object.assign(settings, s || {});
    if (!ctx) return;
    Object.keys(buses).forEach(function (name) {
      var v = settings.muted ? 0 : (settings[name] != null ? settings[name] : 0.8);
      buses[name].gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    });
  }

  function caption(text) {
    if (captions && captionFn && text) captionFn(text);
  }

  // ---------- primitive builders ----------
  function blip(freq, dur, type, gain, bus, when, sweepTo) {
    var t = (when || ctx.currentTime);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(buses[bus || 'effects']);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function clang(dur, gain, cutoff, when) { // filtered noise = metal impact
    var t = when || ctx.currentTime;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = cutoff; f.Q.value = 1.2;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(buses.effects);
    src.start(t);
  }

  function whoosh(dur, gain, when) { // launch air movement: swept noise
    var t = when || ctx.currentTime;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + dur);
    var g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(buses.effects);
    src.start(t);
  }

  function variant(base) { // seeded pitch variant (±6%) when replay consistency matters
    var r = avRng ? avRng.next() : Math.random();
    return base * (0.94 + r * 0.12);
  }

  // ---------- event map ----------
  var SFX = {
    'ui':        function () { blip(660, 0.06, 'triangle', 0.12); },
    'cursor':    function () { blip(520, 0.04, 'sine', 0.07); },
    'launch':    function () { // arrow exits the plate
      whoosh(0.22, 0.4);
      blip(variant(740), 0.16, 'sine', 0.14, 'effects', ctx.currentTime, 1480);
      clang(0.08, 0.3, 3200);
      caption('arrow launched');
    },
    'launch-big': function () { // big arrow exits: heavier
      whoosh(0.3, 0.5);
      blip(variant(420), 0.24, 'sine', 0.16, 'effects', ctx.currentTime, 840);
      clang(0.12, 0.4, 1800);
      caption('big arrow launched');
    },
    'blocked':   function () { // rattled against an obstacle
      clang(0.07, 0.35, 900);
      blip(170, 0.14, 'square', 0.06, 'effects', ctx.currentTime + 0.04);
      caption('lane blocked');
    },
    'invalid':   function () { blip(160, 0.16, 'square', 0.07); blip(150, 0.14, 'square', 0.05, 'effects', ctx.currentTime + 0.05); caption('not allowed'); },
    'combo':     function (n) { // rising chime with combo length (n = combo)
      var base = 620 * Math.pow(2, Math.min(12, (n || 2)) / 12);
      blip(variant(base), 0.14, 'sine', 0.1);
    },
    'wave':      function () {
      [0, 5, 9].forEach(function (st, i) {
        blip(variant(440 * Math.pow(2, st / 12)), 0.2, 'triangle', 0.12, 'effects', ctx.currentTime + i * 0.07);
      });
      clang(0.1, 0.3, 2400);
      caption('new plate');
    },
    'win':       function () {
      [0, 4, 7, 12].forEach(function (st, i) {
        blip(523 * Math.pow(2, st / 12), 0.5, 'triangle', 0.14, 'effects', ctx.currentTime + i * 0.12);
      });
      caption('plate cleared');
    },
    'lose':      function () { blip(300, 0.5, 'sine', 0.16, 'effects', ctx.currentTime, 180); blip(200, 0.6, 'sine', 0.1, 'effects', ctx.currentTime + 0.15, 120); caption('round lost'); },
    'undo':      function () { blip(500, 0.08, 'triangle', 0.1, 'effects', ctx.currentTime, 380); caption('undo'); },
    'hint':      function () { blip(990, 0.12, 'sine', 0.1); blip(1320, 0.14, 'sine', 0.07, 'effects', ctx.currentTime + 0.07); caption('hint'); },
    'star':      function () { blip(1568, 0.18, 'sine', 0.1); }
  };

  // ---------- authored samples: lazy fetch/decode/cache, synth fallback ----------
  var SAMPLES = { // event name -> sfx/<basename>.opus (see sfx/manifest.json)
    'ui':         'ui-tap',
    'cursor':     'cursor-tick',
    'launch':     'arrow-launch',
    'launch-big': 'big-arrow-launch',
    'blocked':    'lane-blocked',
    'invalid':    'invalid-buzz',
    'combo':      'combo-chime',
    'wave':       'new-plate',
    'win':        'plate-cleared',
    'lose':       'round-lost',
    'undo':       'undo-swish',
    'hint':       'hint-sparkle',
    'star':       'star-twinkle'
  };
  var sampleCache = {}; // basename -> AudioBuffer | 'loading' | 'error'

  function loadSample(basename) {
    if (sampleCache[basename]) return;
    sampleCache[basename] = 'loading';
    fetch('sfx/' + basename + '.opus')
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (bytes) { return ctx.decodeAudioData(bytes); })
      .then(function (buf) { sampleCache[basename] = buf; })
      .catch(function () { sampleCache[basename] = 'error'; });
  }

  function playSample(buf) { // effects bus honors current mute/volume settings
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(buses.effects);
    src.start();
  }

  function play(name, arg) {
    if (!started || !ctx || settings.muted) return;
    if (ctx.state === 'suspended') ctx.resume();
    var basename = SAMPLES[name];
    if (basename) {
      var cached = sampleCache[basename];
      if (cached && typeof cached !== 'string') { playSample(cached); return; }
      if (!cached) loadSample(basename); // lazy load starts after gesture unlock
      // 'loading' or 'error': fall through to the synthesized fallback
    }
    var fn = SFX[name];
    if (fn) fn(arg);
  }

  // ---------- ambience: machine-shop room tone (filtered noise, very quiet) ----------
  function startAmbience() {
    if (!ctx || ambienceNodes) return;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) { // brown-ish noise
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    var g = ctx.createGain(); g.gain.value = 0.32;
    src.connect(f); f.connect(g); g.connect(buses.ambience);
    src.start();
    ambienceNodes = { src: src, gain: g };
  }

  // ---------- music: slow generative pad, seeded chord walk ----------
  var CHORDS = [
    [220.0, 261.63, 329.63], // A  C  E
    [174.61, 220.0, 261.63], // F  A  C
    [196.0, 246.94, 293.66], // G  B  D
    [146.83, 220.0, 293.66]  // D  A  D
  ];
  var chordIdx = 0;
  function schedulePad() {
    if (!ctx || settings.muted) return;
    var t = ctx.currentTime + 0.1;
    var chord = CHORDS[chordIdx % CHORDS.length];
    chordIdx++;
    chord.forEach(function (freq, i) {
      var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = freq * 0.5;
      f.type = 'lowpass'; f.frequency.value = 640;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 1.8);
      g.gain.linearRampToValueAtTime(0.0001, t + 6.4);
      o.connect(f); f.connect(g); g.connect(buses.music);
      o.start(t); o.stop(t + 6.6);
    });
  }
  function startMusic() {
    if (musicTimer || !ctx) return;
    schedulePad();
    musicTimer = setInterval(schedulePad, 5200);
  }

  function start(opts) {
    if (!ensureCtx()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    started = true;
    startAmbience();
    startMusic();
    return true;
  }

  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && started && ctx.state === 'suspended') ctx.resume(); }

  function setAvRng(rng) { avRng = rng; }
  function setCaptions(on, fn) { captions = !!on; captionFn = fn || captionFn; }

  root.AXAudio = {
    start: start, play: play, applySettings: applySettings,
    suspend: suspend, resume: resume, setAvRng: setAvRng, setCaptions: setCaptions,
    isStarted: function () { return started; }
  };
})(typeof self !== 'undefined' ? self : this);
