/* Arrow Exodus — pure deterministic rules engine.
 * No rendering, no DOM, no Date.now(): every transition derives from
 * (state, command) only. Usable from browser (window.AXRules) and Node.
 *
 * Core loop: a board of enamel arrows on a metal plate. An arrow with a
 * completely clear lane in its facing direction can be tapped to fly off
 * the board; anything in the lane (another arrow, a big arrow, a bolt)
 * blocks it. Clear every arrow to win. If no arrow has a clear lane while
 * arrows remain, the board is locked and the round is lost.
 *
 * Pieces: { id, d, cells } — d: 0 up, 1 right, 2 down, 3 left.
 * Big arrows occupy two adjacent cells; both lanes must be clear.
 * Bolts are static obstacles listed in state.bolts as [r, c] pairs.
 *
 * Commands: 'exit' (must be legal), 'probe' (records a blocked tap as a
 * counted mistake), 'resign'. Invalid commands are rejected with an
 * explicit reason and never mutate state.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.AXRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AXRules = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var STATE_VERSION = 1;
  var EXIT_BASE = 100;       // points per single arrow exit
  var BIG_BASE = 250;        // points per big arrow exit
  var COMBO_PT = 25;         // extra per current combo length
  var PERFECT_BONUS = 500;   // win bonus for zero mistakes
  var TIME_PT_PER_SEC = 5;   // win bonus per second under par
  var WAVE_BONUS = 300;      // endless: bonus per cleared wave
  var SOLVE_NODE_CAP = 250000; // solver guard against pathological boards

  var DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // up right down left
  var DIR_NAMES = ['up', 'right', 'down', 'left'];

  var TERMINAL = {
    CLEAR: 'board-clear',
    LOCKED: 'no-clear-paths',
    TIME: 'time-up',
    RESIGN: 'resigned'
  };

  var INVALID = {
    ENDED: 'game-ended',
    BLOCKED: 'blocked-path',
    UNKNOWN: 'unknown-piece',
    NOT_BLOCKED: 'not-blocked',
    BAD_CMD: 'unknown-command',
    BAD_SHAPE: 'malformed-command'
  };

  // ---------- helpers ----------

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Stable stringify: object keys sorted recursively → canonical hashing.
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      var out = '[';
      for (var i = 0; i < v.length; i++) out += (i ? ',' : '') + stableStringify(v[i]);
      return out + ']';
    }
    var keys = Object.keys(v).sort(), s = '{';
    for (var k = 0; k < keys.length; k++) {
      s += (k ? ',' : '') + JSON.stringify(keys[k]) + ':' + stableStringify(v[keys[k]]);
    }
    return s + '}';
  }

  function hashState(state) {
    var copy = clone(state);
    delete copy.events;
    return RNG.hashString(stableStringify(copy));
  }

  function cellKey(r, c) { return r + ':' + c; }

  // Occupancy map: cellKey -> piece id or 'bolt'.
  function buildOccupancy(state) {
    var occ = {};
    var i, j;
    for (i = 0; i < state.bolts.length; i++) occ[cellKey(state.bolts[i][0], state.bolts[i][1])] = 'bolt';
    for (i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      for (j = 0; j < p.cells.length; j++) occ[cellKey(p.cells[j][0], p.cells[j][1])] = p.id;
    }
    return occ;
  }

  function findPiece(state, id) {
    for (var i = 0; i < state.pieces.length; i++)
      if (state.pieces[i].id === id) return state.pieces[i];
    return null;
  }

  // Lane check: from each cell of the piece, walk in direction d to the
  // board edge; any occupancy blocks the exit.
  function laneBlocker(state, occ, piece) {
    var rows = state.cfg.board.rows, cols = state.cfg.board.cols;
    var dr = DIRS[piece.d][0], dc = DIRS[piece.d][1];
    for (var i = 0; i < piece.cells.length; i++) {
      var r = piece.cells[i][0] + dr, c = piece.cells[i][1] + dc;
      while (r >= 0 && r < rows && c >= 0 && c < cols) {
        var hit = occ[cellKey(r, c)];
        if (hit && hit !== piece.id) return { cell: [r, c], by: hit };
        r += dr; c += dc;
      }
    }
    return null;
  }

  function pieceIsFree(state, occ, piece) {
    return !laneBlocker(state, occ, piece);
  }

  // ---------- legality ----------

  function checkExit(state, pieceId) {
    if (state.terminal) return INVALID.ENDED;
    var p = findPiece(state, pieceId);
    if (!p) return INVALID.UNKNOWN;
    var occ = buildOccupancy(state);
    return laneBlocker(state, occ, p) ? INVALID.BLOCKED : null;
  }

  function legalExits(state) {
    if (state.terminal) return [];
    var occ = buildOccupancy(state);
    var out = [];
    for (var i = 0; i < state.pieces.length; i++)
      if (pieceIsFree(state, occ, state.pieces[i]))
        out.push({ piece: state.pieces[i].id, d: state.pieces[i].d, big: state.pieces[i].cells.length > 1 });
    return out;
  }

  // ---------- solver (shared by generation, validation, and hints) ----------
  // Depth-first search over removal orders with subset memoization and a
  // node-visit cap. Returns an ordered list of piece ids, or null.
  function solve(state) {
    var rows = state.cfg.board.rows, cols = state.cfg.board.cols;
    var boltOcc = {};
    for (var i = 0; i < state.bolts.length; i++) boltOcc[cellKey(state.bolts[i][0], state.bolts[i][1])] = true;
    var pieces = state.pieces.map(function (p) { return { id: p.id, d: p.d, cells: p.cells }; });
    var memo = {};
    var nodes = 0;

    function freeWith(p, remaining) {
      var dr = DIRS[p.d][0], dc = DIRS[p.d][1];
      for (var i = 0; i < p.cells.length; i++) {
        var r = p.cells[i][0] + dr, c = p.cells[i][1] + dc;
        while (r >= 0 && r < rows && c >= 0 && c < cols) {
          var own = false;
          for (var j = 0; j < p.cells.length; j++)
            if (p.cells[j][0] === r && p.cells[j][1] === c) { own = true; break; }
          if (!own && (boltOcc[cellKey(r, c)] || remaining[cellKey(r, c)])) return false;
          r += dr; c += dc;
        }
      }
      return true;
    }

    function dfs(remaining, count) {
      if (count === 0) return [];
      if (++nodes > SOLVE_NODE_CAP) return null;
      var key = Object.keys(remaining).sort().join('|');
      if (memo[key]) return null;
      for (var i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        var occCells = true;
        for (var j = 0; j < p.cells.length; j++)
          if (!remaining[cellKey(p.cells[j][0], p.cells[j][1])]) { occCells = false; break; }
        if (!occCells) continue; // already removed
        if (!freeWith(p, remaining)) continue;
        for (j = 0; j < p.cells.length; j++) delete remaining[cellKey(p.cells[j][0], p.cells[j][1])];
        var sub = dfs(remaining, count - 1);
        for (j = 0; j < p.cells.length; j++) remaining[cellKey(p.cells[j][0], p.cells[j][1])] = true;
        if (sub) return [p.id].concat(sub);
      }
      memo[key] = true;
      return null;
    }

    var remaining = {};
    for (var i = 0; i < pieces.length; i++)
      for (var j = 0; j < pieces[i].cells.length; j++)
        remaining[cellKey(pieces[i].cells[j][0], pieces[i].cells[j][1])] = true;
    return dfs(remaining, pieces.length);
  }

  // ---------- board generation ----------
  // Rejection sampling verified by the solver: bolt and piece placement is
  // drawn from the rules stream, directions are dealt, and the board is
  // accepted only if it is provably solvable and not trivially open.
  function generateBoard(cfg, rng) {
    var rows = cfg.board.rows, cols = cfg.board.cols;
    var nBolts = cfg.bolts || 0, nBigs = cfg.bigs || 0;
    var nArrows = cfg.arrows || 8;
    var maxPieces = rows * cols - nBolts - nBigs; // bigs take one extra cell
    if (nArrows > maxPieces) throw new Error('arrow count exceeds capacity');

    function attempt(relaxed) {
      var cells = [];
      var r, c;
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) cells.push([r, c]);
      rng.shuffle(cells);
      var bolts = cells.slice(0, nBolts);
      var free = cells.slice(nBolts);
      var used = {};
      var i;
      for (i = 0; i < bolts.length; i++) used[cellKey(bolts[i][0], bolts[i][1])] = true;

      var pieces = [];
      var idn = 0;
      // big arrows first: they need an adjacent pair
      for (var b = 0; b < nBigs; b++) {
        var placedBig = false;
        rng.shuffle(free);
        for (i = 0; i < free.length && !placedBig; i++) {
          var cell = free[i];
          if (used[cellKey(cell[0], cell[1])]) continue;
          var horiz = rng.next() < 0.5;
          var nb = horiz ? [cell[0], cell[1] + 1] : [cell[0] + 1, cell[1]];
          if (nb[0] >= rows || nb[1] >= cols || used[cellKey(nb[0], nb[1])]) continue;
          used[cellKey(cell[0], cell[1])] = true;
          used[cellKey(nb[0], nb[1])] = true;
          // horizontal bigs face left/right, vertical bigs face up/down
          var d = horiz ? (rng.next() < 0.5 ? 1 : 3) : (rng.next() < 0.5 ? 0 : 2);
          pieces.push({ id: 'p' + (++idn), d: d, cells: [cell, nb] });
          placedBig = true;
        }
        if (!placedBig) return null; // cramped board: retry
      }
      // single arrows
      var placedCount = 0;
      for (i = 0; i < free.length && placedCount < nArrows - nBigs; i++) {
        var cc = free[i];
        if (used[cellKey(cc[0], cc[1])]) continue;
        used[cellKey(cc[0], cc[1])] = true;
        pieces.push({ id: 'p' + (++idn), d: rng.int(4), cells: [cc] });
        placedCount++;
      }
      if (placedCount < nArrows - nBigs) return null;

      var probe = { cfg: cfg, bolts: bolts, pieces: pieces, terminal: null };
      var sol = solve(probe);
      if (!sol) return null;
      if (!relaxed && pieces.length >= 6) {
        var occ = buildOccupancy(probe);
        var freeCount = 0;
        for (i = 0; i < pieces.length; i++) if (pieceIsFree(probe, occ, pieces[i])) freeCount++;
        if (freeCount === 0 || freeCount > Math.ceil(pieces.length * 0.7)) return null;
      }
      return { bolts: bolts, pieces: pieces };
    }

    for (var a = 0; a < 200; a++) {
      var got = attempt(false);
      if (got) return got;
    }
    for (a = 0; a < 400; a++) { // relaxed: any solvable board
      var got2 = attempt(true);
      if (got2) return got2;
    }
    // Dense configs are almost never solvable by chance, so rejection
    // sampling exhausts itself. Fall back to constructive placement:
    // pieces are placed in reverse removal order, each with a lane that
    // avoids every already-placed piece — solvable by construction.
    // Runs only after the sampler fails, so boards that previously
    // generated successfully are unchanged.
    for (a = 0; a < 400; a++) {
      var got3 = constructiveAttempt(cfg, rng, false);
      if (got3) return got3;
    }
    for (a = 0; a < 200; a++) {
      var got4 = constructiveAttempt(cfg, rng, true);
      if (got4) return got4;
    }
    throw new Error('could not generate a solvable board for cfg ' + cfg.id);
  }

  // Constructive placement: deal bolts, then place pieces one at a time;
  // each piece's exit lane must clear every cell already used (already
  // placed pieces leave after it, so removing in reverse placement order
  // is always a valid solution). Verified with solve() as a guard.
  function constructiveAttempt(cfg, rng, relaxed) {
    var rows = cfg.board.rows, cols = cfg.board.cols;
    var nBolts = cfg.bolts || 0, nBigs = cfg.bigs || 0;
    var nArrows = cfg.arrows || 8;
    var r, c, i;

    var cells = [];
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) cells.push([r, c]);
    rng.shuffle(cells);
    var bolts = cells.slice(0, nBolts);
    var used = {};
    for (i = 0; i < bolts.length; i++) used[cellKey(bolts[i][0], bolts[i][1])] = true;

    function laneClear(cr, cc, d) { // no used cell in the lane to the edge
      var dr = DIRS[d][0], dc = DIRS[d][1];
      var r2 = cr + dr, c2 = cc + dc;
      while (r2 >= 0 && r2 < rows && c2 >= 0 && c2 < cols) {
        if (used[cellKey(r2, c2)]) return false;
        r2 += dr; c2 += dc;
      }
      return true;
    }

    // placement plan: bigs and singles interleaved, reverse removal order
    var plan = [];
    for (i = 0; i < nBigs; i++) plan.push(2);
    while (plan.length < nArrows) plan.push(1);
    rng.shuffle(plan);

    var pieces = [];
    var idn = 0;
    for (var pi = 0; pi < plan.length; pi++) {
      var size = plan[pi];
      var avail = [];
      for (i = 0; i < cells.length; i++)
        if (!used[cellKey(cells[i][0], cells[i][1])]) avail.push(cells[i]);
      rng.shuffle(avail);
      var placed = false;
      for (i = 0; i < avail.length && !placed; i++) {
        var cell = avail[i];
        if (size === 1) {
          var dirs = [0, 1, 2, 3];
          rng.shuffle(dirs);
          for (var di = 0; di < 4; di++) {
            if (!laneClear(cell[0], cell[1], dirs[di])) continue;
            used[cellKey(cell[0], cell[1])] = true;
            pieces.push({ id: 'p' + (++idn), d: dirs[di], cells: [cell] });
            placed = true;
            break;
          }
        } else {
          var horiz = rng.next() < 0.5;
          var nb = horiz ? [cell[0], cell[1] + 1] : [cell[0] + 1, cell[1]];
          if (nb[0] >= rows || nb[1] >= cols || used[cellKey(nb[0], nb[1])]) continue;
          // bigs face along their axis; both cells share one lane, so a
          // clear lane from the leading cell clears the whole piece
          var cand = horiz ? [[1, nb], [3, cell]] : [[2, nb], [0, cell]];
          if (rng.next() < 0.5) cand.reverse();
          for (var ci = 0; ci < cand.length; ci++) {
            var d = cand[ci][0], lead = cand[ci][1];
            if (!laneClear(lead[0], lead[1], d)) continue;
            used[cellKey(cell[0], cell[1])] = true;
            used[cellKey(nb[0], nb[1])] = true;
            pieces.push({ id: 'p' + (++idn), d: d, cells: [cell, nb] });
            placed = true;
            break;
          }
        }
      }
      if (!placed) return null;
    }

    var probe = { cfg: cfg, bolts: bolts, pieces: pieces, terminal: null };
    if (!solve(probe)) return null; // guard: construction must be provably solvable
    if (!relaxed && pieces.length >= 6) {
      var occ = buildOccupancy(probe);
      var freeCount = 0;
      for (i = 0; i < pieces.length; i++) if (pieceIsFree(probe, occ, pieces[i])) freeCount++;
      if (freeCount === 0 || freeCount > Math.ceil(pieces.length * 0.7)) return null;
    }
    return { bolts: bolts, pieces: pieces };
  }

  // ---------- game creation ----------

  // cfg: { id, version, kind, seed, board:{rows,cols}, arrows, bolts, bigs,
  //        layout:{rows,cols,pieces,bolts} | null, timeLimitSec,
  //        par:{timeSec}, mechanics:{undo,hint}, endless, waveScale }
  function createGame(cfg) {
    var seed = cfg.seed >>> 0;
    var rng = RNG.derive(seed, RNG.STREAM_RULES);
    var board;
    if (cfg.layout) {
      board = { bolts: clone(cfg.layout.bolts || []), pieces: clone(cfg.layout.pieces) };
      // sanity: layout pieces must be well-formed
      board.pieces.forEach(function (p, i) { if (!p.id) p.id = 'p' + (i + 1); });
    } else {
      board = generateBoard(cfg, rng);
    }

    var state = {
      v: STATE_VERSION,
      cfg: clone(cfg),
      seed: seed,
      rngState: rng.state,
      tick: 0,
      pieces: board.pieces,
      bolts: board.bolts,
      score: { exits: 0, exitPoints: 0, comboBest: 0, perfectBonus: 0,
               timeBonus: 0, waveBonus: 0, waves: 0, total: 0 },
      combo: 0,
      invalid: 0,
      elapsedMs: 0,
      endlessWave: 1,
      terminal: null,
      events: []
    };
    return state;
  }

  // Endless: derive the next wave's parameters from the wave number and
  // deal a fresh board from the continuing rules stream.
  function nextWaveParams(cfg, wave) {
    var rows = cfg.board.rows, cols = cfg.board.cols;
    var bolts = Math.min((cfg.bolts || 0) + Math.floor(wave / 2), 8);
    var bigs = Math.min((cfg.bigs || 0) + (wave % 2), 4);
    // arrows must fit: bolts take a cell each, bigs one extra cell each,
    // and the plate keeps at least 6 open cells so waves stay generable
    var cap = rows * cols - bolts - bigs - 6;
    return {
      rows: rows, cols: cols,
      arrows: Math.max(6, Math.min(cfg.arrows + wave, cap)),
      bolts: bolts,
      bigs: bigs
    };
  }

  // ---------- resolution ----------

  function applyCommand(state, cmd) {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
      return { ok: false, reason: INVALID.BAD_SHAPE, state: state, events: [] };
    }
    if (cmd.type === 'resign') {
      if (state.terminal) return { ok: false, reason: INVALID.ENDED, state: state, events: [] };
      var rs = clone(state);
      rs.tick++;
      rs.terminal = { reason: TERMINAL.RESIGN, won: false };
      rs.events = [{ type: 'lose', reason: TERMINAL.RESIGN }];
      finalizeScore(rs);
      return { ok: true, state: rs, events: rs.events };
    }
    if (cmd.type !== 'exit' && cmd.type !== 'probe') {
      return { ok: false, reason: INVALID.BAD_CMD, state: state, events: [] };
    }
    if (typeof cmd.piece !== 'string') {
      return { ok: false, reason: INVALID.BAD_SHAPE, state: state, events: [] };
    }
    if (state.terminal) return { ok: false, reason: INVALID.ENDED, state: state, events: [] };

    var piece = findPiece(state, cmd.piece);
    if (!piece) return { ok: false, reason: INVALID.UNKNOWN, state: state, events: [] };
    var occ = buildOccupancy(state);
    var blocker = laneBlocker(state, occ, piece);

    if (cmd.type === 'exit' && blocker) {
      return { ok: false, reason: INVALID.BLOCKED, state: state, events: [] };
    }
    if (cmd.type === 'probe' && !blocker) {
      return { ok: false, reason: INVALID.NOT_BLOCKED, state: state, events: [] };
    }

    var s = clone(state);
    s.events = [];
    s.tick++;
    if (typeof cmd.atMs === 'number' && isFinite(cmd.atMs) && cmd.atMs >= 0) {
      s.elapsedMs = Math.floor(cmd.atMs / 100) * 100; // quantized, replay-safe
    }

    if (cmd.type === 'probe') {
      s.invalid++;
      s.combo = 0;
      s.events.push({
        type: 'blocked', piece: piece.id, cells: clone(piece.cells), d: piece.d,
        by: blocker.by, at: clone(blocker.cell)
      });
    } else {
      // exit: remove the piece, score with combo
      var idx = -1;
      for (var i = 0; i < s.pieces.length; i++) if (s.pieces[i].id === piece.id) { idx = i; break; }
      var removed = s.pieces.splice(idx, 1)[0];
      s.combo++;
      s.score.comboBest = Math.max(s.score.comboBest, s.combo);
      var big = removed.cells.length > 1;
      var pts = (big ? BIG_BASE : EXIT_BASE) + COMBO_PT * (s.combo - 1);
      s.score.exitPoints += pts;
      s.score.exits++;
      s.events.push({
        type: 'exit', piece: removed.id, cells: removed.cells, d: removed.d,
        big: big, points: pts, combo: s.combo
      });

      if (!s.pieces.length) {
        if (s.cfg.endless) {
          s.score.waves++;
          s.score.waveBonus += WAVE_BONUS * s.endlessWave;
          s.endlessWave++;
          var rng = RNG.create(s.rngState);
          var waveCfg = Object.assign({}, s.cfg, nextWaveParams(s.cfg, s.endlessWave));
          var board = generateBoard(waveCfg, rng);
          s.pieces = board.pieces;
          s.bolts = board.bolts;
          s.rngState = rng.state;
          s.events.push({ type: 'wave', wave: s.endlessWave, arrows: board.pieces.length });
        } else {
          s.terminal = { reason: TERMINAL.CLEAR, won: true };
          if (s.invalid === 0) s.score.perfectBonus = PERFECT_BONUS;
          if (s.cfg.par && s.cfg.par.timeSec && s.elapsedMs > 0 && s.elapsedMs < s.cfg.par.timeSec * 1000) {
            s.score.timeBonus = Math.floor((s.cfg.par.timeSec * 1000 - s.elapsedMs) / 1000) * TIME_PT_PER_SEC;
          }
          s.events.push({ type: 'win', reason: TERMINAL.CLEAR });
        }
      } else if (legalExits(s).length === 0) {
        s.terminal = { reason: TERMINAL.LOCKED, won: false };
        s.events.push({ type: 'lose', reason: TERMINAL.LOCKED });
      }
    }

    if (!s.terminal && s.cfg.timeLimitSec && s.elapsedMs >= s.cfg.timeLimitSec * 1000) {
      s.terminal = { reason: TERMINAL.TIME, won: false };
      s.events.push({ type: 'lose', reason: TERMINAL.TIME });
    }

    if (s.terminal) finalizeScore(s);
    return { ok: true, state: s, events: s.events };
  }

  function finalizeScore(s) {
    s.score.total = s.score.exitPoints + s.score.perfectBonus + s.score.timeBonus + s.score.waveBonus;
  }

  // ---------- hints (same legality surface as play) ----------
  // Prefer the first step of a full solution; otherwise any legal exit.
  function hint(state) {
    var exits = legalExits(state);
    if (!exits.length) return null;
    var sol = solve(state);
    if (sol && sol.length) {
      var p = findPiece(state, sol[0]);
      if (p) return { piece: p.id, d: p.d, cells: clone(p.cells), why: 'solution' };
    }
    var e = exits[0];
    var p2 = findPiece(state, e.piece);
    return { piece: p2.id, d: p2.d, cells: clone(p2.cells), why: 'any' };
  }

  // ---------- validation (network / replay boundary) ----------

  function validateCommandShape(cmd, maxLen) {
    if (!cmd || typeof cmd !== 'object') return INVALID.BAD_SHAPE;
    if (JSON.stringify(cmd).length > (maxLen || 512)) return INVALID.BAD_SHAPE;
    if (cmd.type !== 'exit' && cmd.type !== 'probe' && cmd.type !== 'resign') return INVALID.BAD_CMD;
    if (cmd.id != null && (typeof cmd.id !== 'string' || cmd.id.length > 64)) return INVALID.BAD_SHAPE;
    if (cmd.type !== 'resign' && typeof cmd.piece !== 'string') return INVALID.BAD_SHAPE;
    return null;
  }

  // ---------- serialization ----------

  function serialize(state) { return JSON.stringify(state); }
  function deserialize(json) {
    var s = JSON.parse(json);
    if (s.v !== STATE_VERSION) throw new Error('unsupported state version ' + s.v);
    return s;
  }

  return {
    STATE_VERSION: STATE_VERSION,
    TERMINAL: TERMINAL,
    INVALID: INVALID,
    DIRS: DIRS,
    DIR_NAMES: DIR_NAMES,
    createGame: createGame,
    applyCommand: applyCommand,
    checkExit: checkExit,
    legalExits: legalExits,
    solve: solve,
    hint: hint,
    findPiece: findPiece,
    buildOccupancy: buildOccupancy,
    laneBlocker: laneBlocker,
    generateBoard: generateBoard,
    hashState: hashState,
    stableStringify: stableStringify,
    serialize: serialize,
    deserialize: deserialize,
    clone: clone,
    validateCommandShape: validateCommandShape
  };
});
