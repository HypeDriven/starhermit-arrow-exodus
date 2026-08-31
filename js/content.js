/* Arrow Exodus — versioned content: themes, journey, challenges,
 * tutorial lessons, practice presets, daily ruleset generator.
 * Shared browser (window.AXContent) / Node. Content is data-only; all
 * randomness enters through the config seed.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.AXRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AXContent = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var CONTENT_VERSION = 1;

  // Direction glyphs reinforce meaning (direction is never color-coded).
  var DIR_GLYPHS = ['↑', '→', '↓', '←'];

  // ---------- themes (cosmetic only: materials, light, ambience) ----------
  var THEMES = [
    { id: 'foundry',   name: 'Foundry Plate', unlockStars: 0,
      palette: { plate: 0x2a3038, plateEdge: 0x1b2027, cell: 0x232932, floor: 0x171a20,
                 enamel: 0xf2b04e, enamel2: 0x7fd4c1, bolt: 0x59687c, light: 0xffe0b0,
                 accent: 0xf2b04e, fog: 0x14171d } },
    { id: 'glacier',   name: 'Glacier Mill', unlockStars: 10,
      palette: { plate: 0x39424e, plateEdge: 0x272e38, cell: 0x303947, floor: 0x141a22,
                 enamel: 0x9fd8f0, enamel2: 0xf0c987, bolt: 0x6d7f94, light: 0xd8f0ff,
                 accent: 0x9fd8f0, fog: 0x10161e } },
    { id: 'verdigris', name: 'Verdigris Works', unlockStars: 25,
      palette: { plate: 0x2e3d3a, plateEdge: 0x1f2b28, cell: 0x27342f, floor: 0x131b18,
                 enamel: 0x7fd4c1, enamel2: 0xe8b04e, bolt: 0x5d7a70, light: 0xd0ffe8,
                 accent: 0x7fd4c1, fog: 0x101814 } },
    { id: 'ember',     name: 'Ember Forge', unlockStars: 45,
      palette: { plate: 0x3a2c28, plateEdge: 0x2a1f1c, cell: 0x32251f, floor: 0x1c1310,
                 enamel: 0xf08a4e, enamel2: 0xf0d8a0, bolt: 0x7a5f52, light: 0xffc890,
                 accent: 0xf08a4e, fog: 0x18100d } },
    { id: 'porcelain', name: 'Porcelain Bench', unlockStars: 70,
      palette: { plate: 0x8a8f96, plateEdge: 0x6d7278, cell: 0x7d828a, floor: 0x4a4e55,
                 enamel: 0x2e6fe4, enamel2: 0xe4572e, bolt: 0x4e545e, light: 0xfff2dd,
                 accent: 0x2e6fe4, fog: 0x3a3e45 } }
  ];

  // ---------- journey ----------
  // Compact authored rows:
  // [id, name, seed, [rows,cols], arrows, bolts, bigs, timeLimitSec, parTimeSec, themeIdx, intro]
  var J = [
    ['j01','First Flight',     201,[4,4], 5,0,0,  0, 60,0,'Tap an arrow with a clear lane to send it off the plate. Clear them all.'],
    ['j02','Cross Traffic',    202,[4,4], 6,0,0,  0, 55,0,'Arrows block each other. Free the blocked ones by removing what stands in their lane.'],
    ['j03','Rush Order',       203,[4,4], 7,0,0,  0, 55,0,''],
    ['j04','Tight Corners',    204,[4,4], 8,0,0,  0, 60,0,''],
    ['j05','Full Plate',       205,[5,5], 9,0,0,  0, 75,0,'A larger plate — plan a few exits ahead.'],
    ['j06','Outer Ring',       206,[5,5],10,0,0,  0, 80,0,''],
    ['j07','Switchbacks',      207,[5,5],11,0,0,  0, 85,0,''],
    ['j08','Chain Reaction',   208,[5,5],12,0,0,  0, 90,0,'Every exit opens a lane for someone else.'],
    ['j09','Bolted Down',      209,[5,5], 9,2,0,  0, 90,0,'New: bolts. They never move and block lanes permanently.'],
    ['j10','First Mastery',    210,[5,5],12,3,0,  0, 95,0,'MASTERY: everything so far — a crowded, bolted plate.'],
    ['j11','Rivets',           211,[5,5],11,3,0,  0, 90,1,''],
    ['j12','Dead Ends',        212,[5,5],12,4,0,  0, 95,1,''],
    ['j13','Bolted Gate',      213,[5,5],13,3,0,  0,100,1,''],
    ['j14','Pinwheel',         214,[6,6],12,3,0,  0,110,1,''],
    ['j15','Against the Clock',215,[5,5],11,2,0,120,100,1,'New: a time limit. Work briskly.'],
    ['j16','Machine Shop',     216,[6,6],13,4,0,  0,115,1,''],
    ['j17','Big Rigs',         217,[5,5], 8,1,1,  0,100,1,'New: big arrows. They span two cells and need both lanes clear.'],
    ['j18','Wide Load',        218,[6,6],10,2,2,  0,120,2,''],
    ['j19','Heavy Metal',      219,[6,6],11,2,2,  0,120,2,''],
    ['j20','Second Mastery',   220,[6,6],13,4,2,  0,130,2,'MASTERY: big arrows among the bolts.'],
    ['j21','Convoy',           221,[6,6],12,3,2,  0,125,2,''],
    ['j22','Double Parked',    222,[6,6],12,2,3,  0,130,2,''],
    ['j23','Express Plate',    223,[6,6],14,3,1,150,130,2,''],
    ['j24','Gridlock',         224,[6,6],14,4,2,  0,140,2,''],
    ['j25','Seven by Seven',   225,[7,7],15,4,1,  0,160,3,'The largest plate in the shop.'],
    ['j26','Grand Parade',     226,[7,7],16,4,2,  0,165,3,''],
    ['j27','Under Pressure',   227,[6,6],13,3,2,130,125,3,''],
    ['j28','Bolt Forest',      228,[7,7],14,7,1,  0,170,3,''],
    ['j29','Heavy Convoy',     229,[7,7],15,3,3,  0,170,3,''],
    ['j30','Third Mastery',    230,[7,7],17,5,2,180,170,3,'MASTERY: a clock, bolts, and big rigs at once.'],
    ['j31','Night Shift',      231,[7,7],16,5,2,  0,170,4,''],
    ['j32','Rush Delivery',    232,[6,6],14,4,2,120,120,4,''],
    ['j33','Crowded House',    233,[7,7],18,4,2,  0,180,4,''],
    ['j34','Bolted Convoy',    234,[7,7],16,6,3,  0,185,4,''],
    ['j35','Speedrun Plate',   235,[5,5],11,2,1, 90, 85,4,''],
    ['j36','The Anvil',        236,[7,7],17,6,2,  0,190,4,''],
    ['j37','No Vacancy',       237,[7,7],19,4,2,  0,195,4,''],
    ['j38','Tight Schedule',   238,[7,7],17,5,3,170,180,4,''],
    ['j39','Master Budget',    239,[7,7],18,6,3,  0,200,4,''],
    ['j40','Grand Exodus',     240,[7,7],20,6,3,200,210,0,'MASTERY: the definitive plate. Good luck.']
  ];

  function expandLevel(row, idx) {
    return {
      id: row[0], version: CONTENT_VERSION, kind: 'journey', index: idx,
      name: row[1], seed: row[2],
      board: { rows: row[3][0], cols: row[3][1] },
      arrows: row[4], bolts: row[5], bigs: row[6],
      timeLimitSec: row[7] || 0,
      par: { timeSec: row[8] },
      mechanics: { undo: true, hint: true },
      endless: false,
      theme: THEMES[row[9]].id,
      intro: row[10] || '',
      mastery: /MASTERY/.test(row[10] || '')
    };
  }

  var JOURNEY = J.map(expandLevel);

  // ---------- challenges ----------
  var CHALLENGES = [
    { id: 'c1', name: 'Blitz Plate',      seed: 501, kind: 'challenge',
      board: { rows: 5, cols: 5 }, arrows: 12, bolts: 2, bigs: 0,
      timeLimitSec: 90, par: { timeSec: 80 }, mechanics: { undo: false, hint: true },
      endless: false, theme: 'foundry', intro: 'Clear the plate in 90 seconds. No undo.' },
    { id: 'c2', name: 'Flawless Foundry', seed: 502, kind: 'challenge',
      board: { rows: 5, cols: 5 }, arrows: 10, bolts: 3, bigs: 0,
      timeLimitSec: 0, par: { timeSec: 70 }, mechanics: { undo: true, hint: false },
      endless: false, theme: 'glacier', intro: 'No hints. Chase the flawless bonus: zero mistakes.' },
    { id: 'c3', name: 'Bolt Maze',        seed: 503, kind: 'challenge',
      board: { rows: 6, cols: 6 }, arrows: 12, bolts: 8, bigs: 0,
      timeLimitSec: 0, par: { timeSec: 120 }, mechanics: { undo: false, hint: true },
      endless: false, theme: 'verdigris', intro: 'Eight bolts carve the plate into narrow lanes. No undo.' },
    { id: 'c4', name: 'Big Rigs',         seed: 504, kind: 'challenge',
      board: { rows: 6, cols: 6 }, arrows: 10, bolts: 2, bigs: 4,
      timeLimitSec: 0, par: { timeSec: 130 }, mechanics: { undo: false, hint: false },
      endless: false, theme: 'ember', intro: 'Four big arrows, no assists. Both lanes or nothing.' },
    { id: 'c5', name: 'Rush Hour',        seed: 505, kind: 'challenge',
      board: { rows: 6, cols: 6 }, arrows: 16, bolts: 4, bigs: 1,
      timeLimitSec: 120, par: { timeSec: 110 }, mechanics: { undo: false, hint: true },
      endless: false, theme: 'porcelain', intro: 'Sixteen arrows, two minutes. No undo.' },
    { id: 'c6', name: 'Grand Constraint', seed: 506, kind: 'challenge',
      board: { rows: 7, cols: 7 }, arrows: 20, bolts: 6, bigs: 2,
      timeLimitSec: 180, par: { timeSec: 170 }, mechanics: { undo: false, hint: false },
      endless: false, theme: 'foundry', intro: 'Time limit, bolts, big rigs, no assists. The full test.' }
  ].map(function (c) { c.version = CONTENT_VERSION; return c; });

  // ---------- practice presets ----------
  var PRACTICE = [
    { id: 'casual', name: 'Casual',
      board: { rows: 4, cols: 4 }, arrows: 6, bolts: 0, bigs: 0,
      timeLimitSec: 0, par: { timeSec: 60 }, mechanics: { undo: true, hint: true }, endless: false },
    { id: 'apprentice', name: 'Apprentice',
      board: { rows: 5, cols: 5 }, arrows: 10, bolts: 2, bigs: 1,
      timeLimitSec: 0, par: { timeSec: 100 }, mechanics: { undo: true, hint: true }, endless: false },
    { id: 'expert', name: 'Expert',
      board: { rows: 6, cols: 6 }, arrows: 14, bolts: 4, bigs: 2,
      timeLimitSec: 0, par: { timeSec: 140 }, mechanics: { undo: true, hint: true }, endless: false }
  ].map(function (p) { p.version = CONTENT_VERSION; p.kind = 'practice'; return p; });

  // ---------- score chase ruleset (endless) ----------
  var SCORE_CHASE = {
    id: 'score-std', version: CONTENT_VERSION, kind: 'score', name: 'Endless Plates',
    board: { rows: 6, cols: 6 }, arrows: 12, bolts: 3, bigs: 1,
    timeLimitSec: 0, par: null, mechanics: { undo: false, hint: false }, endless: true,
    theme: 'foundry',
    intro: 'Plate after plate. Play until no arrow has a clear lane.'
  };

  // ---------- daily ----------
  // One immutable ruleset per UTC day, derived purely from the date string.
  function dailyConfig(dateStr) {
    var seed = RNG.hashString('arrowexodus-daily-v' + CONTENT_VERSION + '-' + dateStr);
    var day = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
    var rot = ((day % 7) + 7) % 7;
    var size = 5 + (rot % 3); // 5..7
    var arrows = Math.min(9 + rot * 2, size * size - 8);
    return {
      id: 'daily-' + dateStr, version: CONTENT_VERSION, kind: 'daily',
      name: 'Daily ' + dateStr, seed: seed, date: dateStr,
      board: { rows: size, cols: size },
      arrows: arrows, bolts: rot % 4, bigs: rot >= 4 ? 1 + (rot % 2) : 0,
      timeLimitSec: rot === 6 ? 240 : 0,
      par: { timeSec: 120 + rot * 20 },
      mechanics: { undo: true, hint: true }, endless: false,
      theme: THEMES[rot % THEMES.length].id,
      intro: 'One shared seed for everyone, today only.'
    };
  }

  function utcDateString(nowMs) {
    var d = new Date(nowMs == null ? Date.now() : nowMs);
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }

  // ---------- tutorial (Learn) ----------
  // Lessons use explicit layouts (deterministic fixtures) and the same
  // legal-action API as play. d: 0 up, 1 right, 2 down, 3 left.
  function tutorialLessons() {
    function lessonCfg(id, seed, layout, extra) {
      return Object.assign({
        id: id, version: CONTENT_VERSION, kind: 'tutorial', seed: seed,
        board: { rows: layout.rows, cols: layout.cols }, layout: layout,
        arrows: 0, bolts: 0, bigs: 0,
        timeLimitSec: 0, par: null, mechanics: { undo: false, hint: true }, endless: false
      }, extra || {});
    }
    return [
      { id: 't1', title: 'Send an arrow off',
        text: 'This arrow faces the open edge — its lane is clear. Tap it (or move the focus ring with arrow keys and press Enter) to send it off the plate.',
        goal: { event: 'exit', count: 1 },
        cfg: lessonCfg('t1', 9001, { rows: 3, cols: 3, bolts: [],
          pieces: [{ id: 'p1', d: 0, cells: [[1, 1]] }] }) },
      { id: 't2', title: 'Blocked lanes',
        text: 'The right arrow points left, but its twin blocks the lane. Send off the clear arrow first — that opens the lane for the blocked one. Clear both.',
        goal: { event: 'win', count: 1 },
        cfg: lessonCfg('t2', 9002, { rows: 3, cols: 4, bolts: [],
          pieces: [{ id: 'p1', d: 3, cells: [[1, 1]] }, { id: 'p2', d: 3, cells: [[1, 2]] }] }) },
      { id: 't3', title: 'Mistakes count',
        text: 'Tapping a blocked arrow is a mistake: it shakes, explains itself, and costs your flawless bonus. Tap the blocked right-hand arrow once to see why it cannot leave.',
        goal: { event: 'blocked', count: 1 },
        cfg: lessonCfg('t3', 9003, { rows: 3, cols: 4, bolts: [],
          pieces: [{ id: 'p1', d: 3, cells: [[1, 1]] }, { id: 'p2', d: 3, cells: [[1, 2]] }] }) },
      { id: 't4', title: 'Bolts never move',
        text: 'The dark bolt is riveted to the plate: it blocks lanes forever and cannot be removed. Route around it and clear all three arrows.',
        goal: { event: 'win', count: 1 },
        cfg: lessonCfg('t4', 9004, { rows: 3, cols: 4, bolts: [[1, 1]],
          pieces: [{ id: 'p1', d: 1, cells: [[2, 0]] }, { id: 'p2', d: 3, cells: [[2, 3]] }, { id: 'p3', d: 2, cells: [[0, 2]] }] }) },
      { id: 't5', title: 'Big arrows',
        text: 'The wide arrow spans two cells and needs BOTH lanes clear. Free the small arrow above its path first, then send the big rig off. Clear the plate.',
        goal: { event: 'win', count: 1 },
        cfg: lessonCfg('t5', 9005, { rows: 4, cols: 4, bolts: [],
          pieces: [{ id: 'p1', d: 1, cells: [[2, 1], [2, 2]] }, { id: 'p2', d: 0, cells: [[2, 3]] }] }) },
      { id: 't6', title: 'Second chances',
        text: 'In relaxed modes you can undo (U) or ask for a hint (H). Send any arrow off, then undo it to finish the lesson.',
        goal: { event: 'undo', count: 1 },
        cfg: lessonCfg('t6', 9006, { rows: 3, cols: 4, bolts: [],
          pieces: [{ id: 'p1', d: 3, cells: [[1, 1]] }, { id: 'p2', d: 1, cells: [[1, 2]] }] },
          { mechanics: { undo: true, hint: true } }) }
    ];
  }

  // ---------- achievements (stable lowercase keys, idempotent) ----------
  var ACHIEVEMENTS = [
    { key: 'first-exit',   name: 'First Flight',    desc: 'Send your first arrow off the plate.' },
    { key: 'first-win',    name: 'Clean Plate',     desc: 'Clear every arrow on a plate.' },
    { key: 'flawless',     name: 'Flawless',        desc: 'Win a round with zero mistakes.' },
    { key: 'combo-8',      name: 'Full Flow',       desc: 'Reach an 8-exit combo.' },
    { key: 'journey-half', name: 'Half the Journey', desc: 'Finish 20 journey stages.' },
    { key: 'journey-done', name: 'Master of Plates', desc: 'Finish all 40 journey stages.' },
    { key: 'daily-7',      name: 'Regular',         desc: 'Finish 7 daily challenges.' },
    { key: 'score-3000',   name: 'High Plate',      desc: 'Score 3000+ in a single round.' },
    { key: 'exits-500',    name: 'Fletcher',        desc: 'Send 500 arrows off across all play.' }
  ];

  return {
    CONTENT_VERSION: CONTENT_VERSION,
    DIR_GLYPHS: DIR_GLYPHS,
    THEMES: THEMES,
    JOURNEY: JOURNEY,
    CHALLENGES: CHALLENGES,
    PRACTICE: PRACTICE,
    SCORE_CHASE: SCORE_CHASE,
    ACHIEVEMENTS: ACHIEVEMENTS,
    dailyConfig: dailyConfig,
    utcDateString: utcDateString,
    tutorialLessons: tutorialLessons
  };
});
