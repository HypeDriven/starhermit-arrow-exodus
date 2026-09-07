import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIR = new URL('../js/', import.meta.url);
const ctx = { console };
vm.createContext(ctx);
for (const f of ['rng.js', 'rules.js', 'content.js', 'store.js'])
  vm.runInContext(readFileSync(new URL(f, DIR), 'utf8'), ctx, { filename: f });

const R = ctx.AXRules, S = ctx.AXStore, C = ctx.AXContent;

// deterministic replay: same seed + commands → identical hash
function playSeq(cfg, cmds) {
  let st = R.createGame(cfg);
  for (const c of cmds) { const r = R.applyCommand(st, c); if (r.ok) st = r.state; }
  return st;
}
const cfg = C.JOURNEY[0];
const start = R.createGame(cfg);
const sol = R.solve(start);
if (!sol) throw new Error('j01 unsolvable');
const cmds = sol.map(id => ({ type: 'exit', piece: id }));
const h1 = R.hashState(playSeq(cfg, cmds));
const h2 = R.hashState(playSeq(cfg, cmds));
if (h1 !== h2) throw new Error('replay hash mismatch');
const end = playSeq(cfg, cmds);
if (!end.terminal || !end.terminal.won) throw new Error('j01 not won after solution');
if (end.score.total !== end.score.exitPoints + end.score.perfectBonus)
  throw new Error('score total mismatch');
console.log('rules replay OK, hash', h1, 'total', end.score.total);

// invalid command rejection, state untouched
const bad = R.applyCommand(start, { type: 'exit', piece: 'nope' });
if (bad.ok || bad.reason !== 'unknown-piece' || bad.state !== start)
  throw new Error('bad piece accepted');
const bad2 = R.applyCommand(start, null);
if (bad2.ok || bad2.reason !== 'malformed-command') throw new Error('null cmd accepted');
const blockedPiece = R.legalExits(start).length < start.pieces.length
  ? start.pieces.find(p => !R.legalExits(start).some(e => e.piece === p.id)) : null;
if (blockedPiece) {
  const pr = R.applyCommand(start, { type: 'exit', piece: blockedPiece.id });
  if (pr.ok || pr.reason !== 'blocked-path') throw new Error('blocked exit accepted');
}
console.log('invalid command rejection OK');

// every shipped config must be solvable
for (const lvl of C.JOURNEY) {
  let state = R.createGame(lvl);
  const solution = R.solve(state);
  if (!solution) throw new Error('unsolvable journey level ' + lvl.id);
  for (const piece of solution) {
    const next = R.applyCommand(state, { type: 'exit', piece });
    if (!next.ok) throw new Error('solution rejected for ' + lvl.id);
    state = next.state;
  }
  if (!state.terminal?.won) throw new Error('journey level did not end in a win: ' + lvl.id);
}
console.log('all ' + C.JOURNEY.length + ' journey levels solvable OK');
for (const c of [...C.CHALLENGES, ...C.PRACTICE])
  if (!R.solve(R.createGame(c))) throw new Error('unsolvable ' + c.id);
for (let d = 0; d < 14; d++) { // two weeks of dailies
  const date = new Date(Date.UTC(2026, 8, 7 + d)).toISOString().slice(0, 10);
  if (!R.solve(R.createGame(C.dailyConfig(date)))) throw new Error('unsolvable daily ' + date);
}
console.log('challenges/practice/14 dailies solvable OK');

// endless wave regeneration
const esc = R.createGame(C.SCORE_CHASE);
let st = esc, guard = 0;
while (st.endlessWave < 12 && guard++ < 400) {
  const s2 = R.solve(st);
  if (!s2) throw new Error('endless wave unsolvable at wave ' + st.endlessWave);
  for (const id of s2) { const r = R.applyCommand(st, { type: 'exit', piece: id }); if (r.ok) st = r.state; }
}
if (st.endlessWave < 12) throw new Error('endless did not advance, stuck at wave ' + st.endlessWave);
console.log('endless wave regeneration OK (reached wave ' + st.endlessWave + ', arrows now ' + st.pieces.length + ')');

// tutorial lesson fixtures winnable and goals reachable
for (const ls of C.tutorialLessons()) {
  const lst = R.createGame(ls.cfg);
  if (!R.solve(lst)) throw new Error('lesson unsolvable ' + ls.id);
}
console.log('tutorial fixtures solvable OK');

// store: migrate a partial older save — nested stats must merge, not NaN
const partial = { v: 1, settings: {}, progress: { stats: { rounds: 3 } } };
const m = S.migrate(JSON.parse(JSON.stringify(partial)));
if (typeof m.progress.stats.exits !== 'number' || m.progress.stats.rounds !== 3)
  throw new Error('migrate stats merge failed: ' + JSON.stringify(m.progress.stats));
console.log('store migrate deep-merge OK');

// serialize roundtrip preserves hash
const ser = R.deserialize(R.serialize(end));
if (R.hashState(ser) !== h1) throw new Error('serialize roundtrip mismatch');
console.log('serialize roundtrip OK');

// leaderboard tie-break ordering
const lb = S.sortEntries([
  { score: 100, invalid: 2, durationMs: 9000, sessionId: 'b' },
  { score: 100, invalid: 1, durationMs: 9000, sessionId: 'z' },
  { score: 100, invalid: 1, durationMs: 8000, sessionId: 'z' },
  { score: 200, invalid: 9, durationMs: 1, sessionId: 'a' },
]);
if (lb[0].score !== 200 || lb[1].durationMs !== 8000 || lb[2].sessionId !== 'z' || lb[3].invalid !== 2)
  throw new Error('tie-break order wrong: ' + JSON.stringify(lb));
console.log('leaderboard tie-breaks OK');
console.log('\nALL TARGETED CHECKS PASS');
