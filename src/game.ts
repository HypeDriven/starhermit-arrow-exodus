// The controller, ported from the browser build's js/game.js without its DOM:
// the screens' state machine (title → modes / info panels → play ↔ pause →
// results), the round (rules snapshots, history for undo, the clock with its
// time limit and ten-second warning, lessons' goals), recording results into
// the progress document (stars, bests, stats, achievements), the leaderboard
// post, and the actions every screen calls. The rules, content and seeds are
// the shared classic scripts (js/rules.js, js/content.js, js/rng.js), so a
// round plays exactly as before. screens.ts draws this state each frame.
import { frame } from "starhermit:engine";
import { announce } from "starhermit:ui";
import { loadClassic } from "starhermit:script";
import * as audio from "./audio.js";
import * as render from "./render.js";
import { t } from "./i18n.js";
import { gameSettings, persist, progress, type Progress } from "./save.js";
import { signedIn, submitScore } from "./online.js";

loadClassic("js/rules.js");
loadClassic("js/content.js");

// -- the classic scripts' shapes ---------------------------------------------------------
export interface Cfg {
  id: string; name?: string; intro?: string; seed?: number; date?: string;
  board: { rows: number; cols: number }; arrows?: number; bolts?: number; bigs?: number;
  mechanics?: { hint?: boolean; undo?: boolean }; timeLimitSec?: number; par?: { timeSec?: number };
  endless?: boolean; mastery?: boolean;
}
export interface Score { exits: number; exitPoints: number; comboBest: number; perfectBonus: number; timeBonus: number; waveBonus: number; waves: number; total: number }
export interface State extends render.RState {
  cfg: Cfg; score: Score; invalid: number; elapsedMs: number; endlessWave: number;
  terminal: { won: boolean; reason: string } | null;
}
interface Res { ok: boolean; reason?: string; state: State; events: render.REvent[] }
interface RulesApi {
  TERMINAL: { CLEAR: string; LOCKED: string; TIME: string; RESIGN: string };
  createGame(cfg: Cfg): State;
  applyCommand(state: State, cmd: Record<string, unknown>): Res;
  checkExit(state: State, piece: string): string | null;
  legalExits(state: State): { piece: string }[];
  hint(state: State): { piece: string } | null;
}
export interface Lesson { id: string; title: string; text: string; cfg: Cfg; goal?: { event: string; count: number } }
export interface ThemeRow extends render.Theme { name: string; unlockStars: number }
interface ContentApi {
  THEMES: ThemeRow[]; JOURNEY: Cfg[]; CHALLENGES: Cfg[]; PRACTICE: Cfg[]; SCORE_CHASE: Cfg;
  ACHIEVEMENTS: { key: string; name: string }[];
  dailyConfig(date: string): Cfg; utcDateString(): string; tutorialLessons(): Lesson[];
}
interface RngApi { hashString(s: string): number; derive(seed: number, stream: number): { next(): number }; STREAM_AV: number; STREAM_DECOR: number }
const G = globalThis as unknown as { AXRules: RulesApi; AXContent: ContentApi; AXRNG: RngApi };
export const Rules = G.AXRules;
export const Content = G.AXContent;
export const RNG = G.AXRNG;

/** Milliseconds of game time (frame().time: the frames' clock, which a hidden window stops). */
function now(): number { return frame().time * 1000; }

// -- screens -----------------------------------------------------------------------------
export type Screen = "title" | "modes" | "journey-info" | "practice-info" | "challenge-info" | "score-chase-info" | "profile-info" | "play";
export type Overlay = null | "pause" | "results" | "lesson";
export const app = {
  screen: "title" as Screen,
  overlay: null as Overlay,
  /** Settings dialog open (over the title or the pause card). */
  settings: false,
  toast: null as { text: string; until: number } | null,
  caption: null as { key: string; until: number } | null,
};
export function showScreen(s: Screen): void { app.screen = s; app.overlay = null; render.setVisible(s === "play"); }
export function toast(text: string): void {
  app.toast = { text, until: now() + 2600 };
  announce(text);
}
audio.setCaptions((key) => {
  if (!gameSettings().captions) return;
  app.caption = { key, until: now() + 1800 };
  announce(t(key));
});

// -- localized content names (content.js keeps the English data) --------------------------
export const stageName = (lvl: Cfg): string => t("j." + lvl.id, null, lvl.name);
export const stageIntro = (lvl: Cfg): string => (lvl.intro ? t("ji." + lvl.id, null, lvl.intro) : "");
export const challengeName = (ch: Cfg): string => t("ch." + ch.id, null, ch.name);
export const challengeIntro = (ch: Cfg): string => t("chi." + ch.id, null, ch.intro);
export const practiceName = (pr: Cfg): string => t("pr." + pr.id, null, pr.name);
export const lessonTitle = (ls: Lesson): string => t("lt." + ls.id, null, ls.title);
export const lessonText = (ls: Lesson): string => t("lx." + ls.id, null, ls.text);
export const themeName = (th: ThemeRow): string => t("theme." + th.id, null, th.name);
export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// -- the round ---------------------------------------------------------------------------
type Kind = "journey" | "tutorial" | "daily" | "practice" | "challenge" | "score";
export interface Ctx { kind: Kind; label: () => string; sub?: () => string; index?: number; lesson?: Lesson }
export interface Round {
  cfg: Cfg; ctx: Ctx; state: State; history: State[];
  startMs: number; pausedTotal: number; pausedAt: number | null; endMs: number | null;
  cursor: [number, number] | null; over: boolean; timedOut: boolean; warned: boolean;
  lesson: Lesson | null; lessonCount: number; lb: { posted: boolean; rank: number | null } | null; lbPending: boolean;
  /** When the results card (or lesson card) opens. */
  showAt: number | null;
}
export let round: Round | null = null;
const sessionId = RNG.hashString(String(Date.now()) + ":" + Math.random()).toString(36);
let cmdSeq = 0;
let hintUntil = 0;
let roundNo = 0;

export function freeIds(state: State): string[] { return Rules.legalExits(state).map((e) => e.piece); }
export function elapsedMs(): number {
  if (!round) return 0;
  const at = round.pausedAt != null ? round.pausedAt : now();
  return Math.max(0, at - round.startMs - round.pausedTotal);
}
export function stars(): number { return Object.values(progress().journeyStars).reduce((a, b) => a + b, 0); }

export function nextJourneyIndex(): number {
  const s = progress().journeyStars;
  for (let i = 0; i < Content.JOURNEY.length; i++) if (!s[Content.JOURNEY[i]!.id]) return i;
  return Content.JOURNEY.length - 1;
}
function roundSeed(cfg: Cfg): number {
  if (typeof cfg.seed === "number") return cfg.seed >>> 0;
  return RNG.hashString(cfg.id + ":" + sessionId + ":" + progress().stats.rounds);
}
export function themeRow(): ThemeRow {
  const id = gameSettings().theme;
  return Content.THEMES.find((th) => th.id === id) ?? Content.THEMES[0]!;
}

export function startRound(baseCfg: Cfg, ctx: Ctx): void {
  const cfg = { ...baseCfg, seed: roundSeed(baseCfg) };
  const state = Rules.createGame(cfg);
  roundNo++;
  round = {
    cfg, ctx, state, history: [], startMs: now(), pausedTotal: 0, pausedAt: null, endMs: null,
    cursor: null, over: false, timedOut: false, warned: false, lesson: ctx.lesson ?? null, lessonCount: 0,
    lb: null, lbPending: false, showAt: null,
  };
  app.settings = false;
  showScreen("play");
  render.setTheme(themeRow());
  render.buildBoard(state);
  render.syncState(state, [], true, freeIds(state));
  announce(ctx.label() + (ctx.sub ? ". " + ctx.sub() : ""));
}

export function startJourney(idx: number): void {
  const lvl = Content.JOURNEY[idx]!;
  startRound(lvl, { kind: "journey", label: () => t("label.journey", { n: idx + 1, name: stageName(lvl) }), sub: () => stageIntro(lvl), index: idx });
}
export function startLesson(idx: number): void {
  const ls = Content.tutorialLessons()[idx]!;
  startRound(ls.cfg, { kind: "tutorial", label: () => t("label.learn", { name: lessonTitle(ls) }), sub: () => lessonText(ls), lesson: ls, index: idx });
}
export function firstUnfinishedLesson(): number {
  const lessons = Content.tutorialLessons();
  for (let i = 0; i < lessons.length; i++) if (!progress().tutorialDone[lessons[i]!.id]) return i;
  return 0;
}
export function startDaily(): void {
  const cfg = Content.dailyConfig(Content.utcDateString());
  startRound(cfg, { kind: "daily", label: () => t("daily.name", { date: cfg.date ?? "" }), sub: () => t("daily.intro", null, cfg.intro) });
}
export function startScoreChase(): void {
  startRound(Content.SCORE_CHASE, { kind: "score", label: () => t("label.score"), sub: () => t("score.intro", null, Content.SCORE_CHASE.intro) });
}
export function startPractice(pr: Cfg): void {
  startRound(pr, { kind: "practice", label: () => t("label.practice", { name: practiceName(pr) }), sub: () => t("practice.sub") });
}
export function startChallenge(ch: Cfg): void {
  startRound(ch, { kind: "challenge", label: () => t("label.challenge", { name: challengeName(ch) }), sub: () => challengeIntro(ch) });
}
export function restart(): void {
  if (!round) return;
  startRound(round.ctx.kind === "tutorial" ? round.lesson!.cfg : round.cfg, round.ctx);
}
export function next(): void {
  if (!round) return;
  if (round.ctx.kind === "journey") startJourney(round.ctx.index! + 1);
  else if (round.ctx.kind === "tutorial") startLesson(round.ctx.index! + 1);
}

// -- play ----------------------------------------------------------------------------------
function playable(): boolean { return !!round && !round.over && round.pausedAt == null && !round.state.terminal && app.overlay === null; }

export function tapPiece(pieceId: string): void {
  if (!round || !playable()) return;
  const legal = Rules.checkExit(round.state, pieceId) === null;
  const res = Rules.applyCommand(round.state, { type: legal ? "exit" : "probe", piece: pieceId, id: "c" + ++cmdSeq, atMs: elapsedMs() });
  if (!res.ok) { audio.play("invalid"); return; }
  round.history.push(round.state);
  round.state = res.state;
  render.clearHint();
  render.syncState(res.state, res.events, false, freeIds(res.state));
  handleEvents(res.events);
  if (res.state.terminal) finishRound(res.state);
}

function handleEvents(events: Res["events"]): void {
  for (const ev of events) {
    if (ev.type === "exit") {
      audio.play(ev.big ? "launch-big" : "launch");
      const combo = Number(ev.combo) || 0;
      if (combo >= 2) audio.play("combo");
      lessonEvent("exit");
    } else if (ev.type === "blocked") {
      audio.play("blocked");
      lessonEvent("blocked");
    } else if (ev.type === "wave") audio.play("wave");
    else if (ev.type === "win") { audio.play("win"); lessonEvent("win"); }
    else if (ev.type === "lose") audio.play("lose");
  }
}

function lessonEvent(name: string): void {
  if (!round || !round.lesson || round.over) return;
  const goal = round.lesson.goal;
  if (!goal || goal.event !== name) return;
  round.lessonCount++;
  if (round.lessonCount >= goal.count) {
    round.over = true;
    progress().tutorialDone[round.lesson.id] = true;
    persist();
    audio.play("star");
    round.showAt = now() + 700;
    pendingOverlay = "lesson";
  }
}
let pendingOverlay: Overlay = null;

export function undo(): void {
  if (!round || !playable()) return;
  if (!round.cfg.mechanics?.undo || !round.history.length) return;
  round.state = round.history.pop()!;
  render.syncState(round.state, [], true, freeIds(round.state));
  audio.play("undo");
  lessonEvent("undo");
}

export function hint(): void {
  if (!round || !playable()) return;
  if (!round.cfg.mechanics?.hint) return;
  const h = Rules.hint(round.state);
  if (!h) return;
  render.setHint(h.piece);
  hintUntil = now() + 2600;
  audio.play("hint");
}

export function moveCursor(dr: number, dc: number): void {
  if (!round || !playable()) return;
  const { rows, cols } = round.cfg.board;
  const c = round.cursor ?? [0, 0];
  round.cursor = [Math.min(rows - 1, Math.max(0, c[0] + dr)), Math.min(cols - 1, Math.max(0, c[1] + dc))];
  render.setCursor(round.cursor);
  audio.play("cursor");
  const p = pieceAt(round.cursor[0], round.cursor[1]);
  announce(`${round.cursor[0] + 1}, ${round.cursor[1] + 1}` + (p ? ` ${["↑", "→", "↓", "←"][p.d]}` : ""));
}
function pieceAt(r: number, c: number): render.Piece | null {
  if (!round) return null;
  for (const p of round.state.pieces) for (const cell of p.cells) if (cell[0] === r && cell[1] === c) return p;
  return null;
}
export function launchCursor(): void {
  if (!round || !round.cursor) return;
  const p = pieceAt(round.cursor[0], round.cursor[1]);
  if (p) tapPiece(p.id);
}

// -- pause --------------------------------------------------------------------------------
export function pause(): void {
  if (!round || round.over || round.pausedAt != null || app.screen !== "play") return;
  round.pausedAt = now();
  app.overlay = "pause";
}
export function resume(): void {
  if (!round || round.pausedAt == null) return;
  round.pausedTotal += now() - round.pausedAt;
  round.pausedAt = null;
  app.overlay = null;
  app.settings = false;
}
export function resign(): void {
  if (!round || round.over || round.state.terminal) return;
  if (round.pausedAt != null) { // settle the open pause so away time is not billed to the round
    round.pausedTotal += now() - round.pausedAt;
    round.pausedAt = null;
  }
  app.overlay = null;
  const res = Rules.applyCommand(round.state, { type: "resign", id: "c" + ++cmdSeq, atMs: elapsedMs() });
  if (!res.ok) return;
  round.state = res.state;
  render.syncState(res.state, res.events, false, []);
  handleEvents(res.events);
  finishRound(res.state);
}
export function quitToTitle(): void {
  round = null;
  app.settings = false;
  render.clearHint();
  showScreen("title");
}
export function toModes(): void { quitToTitle(); showScreen("modes"); }

// -- the clock (the browser build's 250 ms timer, here each frame) ---------------------------
export function tick(): void {
  if (round && !round.over && !round.state.terminal && round.pausedAt == null) {
    const limit = round.cfg.timeLimitSec;
    if (limit && !round.warned && limit * 1000 - elapsedMs() <= 10000) {
      round.warned = true; // one warning per round, 10 s before the limit
      audio.play("time-warning");
    }
    if (limit && elapsedMs() >= limit * 1000) {
      round.timedOut = true;
      const res = Rules.applyCommand(round.state, { type: "resign", id: "c" + ++cmdSeq });
      if (res.ok) {
        round.state = res.state;
        handleEvents(res.events);
        finishRound(res.state);
      }
    }
  }
  if (hintUntil && now() > hintUntil) { hintUntil = 0; render.clearHint(); }
  if (round && round.showAt != null && now() >= round.showAt) {
    round.showAt = null;
    app.overlay = pendingOverlay;
    app.settings = false;
  }
  const ms = now();
  if (app.toast && ms > app.toast.until) app.toast = null;
  if (app.caption && ms > app.caption.until) app.caption = null;
}

// -- results -------------------------------------------------------------------------------
function recordResult(state: State): void {
  const p: Progress = progress(), st = p.stats;
  st.rounds++;
  st.exits += state.score.exits;
  st.bestCombo = Math.max(st.bestCombo, state.score.comboBest);
  st.playMs += elapsedMs();
  const won = !!(state.terminal && state.terminal.won);
  if (won) {
    st.wins++;
    if (state.invalid === 0) st.flawlessWins++;
  }
  const r = round!;
  const kind = r.ctx.kind;
  if (kind === "journey" && won) {
    const id = r.cfg.id;
    let s = 1;
    if (state.invalid === 0) s++;
    if (r.cfg.par && r.cfg.par.timeSec && state.elapsedMs > 0 && state.elapsedMs < r.cfg.par.timeSec * 1000) s++;
    p.journeyStars[id] = Math.max(p.journeyStars[id] || 0, s);
    p.journeyBest[id] = Math.max(p.journeyBest[id] || 0, state.score.total);
  } else if (kind === "challenge" && won) {
    p.challengeBest[r.cfg.id] = Math.max(p.challengeBest[r.cfg.id] || 0, state.score.total);
  } else if (kind === "daily" && won) {
    const date = r.cfg.date ?? "";
    p.dailiesDone[date] = Math.max(p.dailiesDone[date] || 0, state.score.total);
  } else if (kind === "score") {
    p.endlessBest = Math.max(p.endlessBest || 0, state.score.total);
  }
  // achievements (idempotent, stable lowercase keys)
  const unlock = (key: string): void => {
    if (!p.achievements[key]) { p.achievements[key] = Date.now(); audio.play("star"); }
  };
  if (st.exits > 0) unlock("first-exit");
  if (won) unlock("first-win");
  if (won && state.invalid === 0) unlock("flawless");
  if (state.score.comboBest >= 8) unlock("combo-8");
  if (Object.keys(p.journeyStars).length >= 20) unlock("journey-half");
  if (Object.keys(p.journeyStars).length >= Content.JOURNEY.length) unlock("journey-done");
  if (Object.keys(p.dailiesDone).length >= 7) unlock("daily-7");
  if (state.score.total >= 3000) unlock("score-3000");
  if (st.exits >= 500) unlock("exits-500");
  persist();
}

function finishRound(state: State): void {
  const r = round!;
  r.over = true;
  r.endMs = elapsedMs();
  recordResult(state);
  // A lesson whose goal this was shows its own card (the browser build's results card replaced it 0.1 s later).
  if (pendingOverlay !== "lesson" || r.showAt == null) {
    r.showAt = now() + 800;
    pendingOverlay = "results";
  }
  // Signed in: post the total (not Practice or a lesson) and show the board rank on the card.
  if (r.ctx.kind !== "practice" && r.ctx.kind !== "tutorial" && signedIn()) {
    r.lbPending = true;
    const mine = roundNo;
    void submitScore(state.score.total).then((res) => {
      if (roundNo !== mine || !round) return;
      round.lb = res;
      round.lbPending = false;
    });
  }
}

export function terminalHeadline(state: State): string {
  if (!state.terminal) return t("h.over");
  if (round?.timedOut) return t("h.timeUp");
  switch (state.terminal.reason) {
    case Rules.TERMINAL.CLEAR: return t("h.clear");
    case Rules.TERMINAL.LOCKED: return t("h.locked");
    case Rules.TERMINAL.TIME: return t("h.timeUp");
    default: return t("h.resigned");
  }
}
export function scoreBreakdown(state: State): [string, string][] {
  const s = state.score;
  const lines: [string, string][] = [
    [t("r.exits"), t("r.exitsVal", { n: s.exits, p: s.exitPoints })],
    [t("r.combo"), "×" + s.comboBest],
    [t("r.flawless"), t("r.pts", { n: s.perfectBonus })],
    [t("r.timeBonus"), t("r.pts", { n: s.timeBonus })],
  ];
  if (state.cfg.endless) lines.push([t("r.plates"), t("r.exitsVal", { n: s.waves, p: s.waveBonus })]);
  lines.push([t("r.mistakes"), String(state.invalid)]);
  lines.push([t("r.time"), fmtTime(round?.endMs != null ? round.endMs : elapsedMs())]);
  lines.push([t("r.total"), t("r.pts", { n: s.total })]);
  return lines;
}
/** The results card's leaderboard line (signed in, not Practice), or null. */
export function leaderboardLine(): string | null {
  if (!round || (!round.lbPending && !round.lb)) return null;
  const r = round.lb;
  return !r ? t("p.lbPosting") : !r.posted ? t("p.lbNotPosted") : r.rank ? t("p.lbRank", { rank: r.rank }) : t("p.lbPosted");
}

/** The HUD status line. */
export function hudStatus(): string {
  if (!round) return "";
  const s = round.state;
  const left = s.pieces.length;
  // score.total is finalized only at the end; show the live sum mid-round
  const live = s.score.exitPoints + s.score.perfectBonus + s.score.timeBonus + s.score.waveBonus;
  let txt = t("hud.score", { n: live }) + " · " + t(left === 1 ? "hud.left1" : "hud.leftN", { n: left }) + " · " +
    t(s.invalid === 1 ? "hud.mist1" : "hud.mistN", { n: s.invalid }) + " · " + fmtTime(round.endMs ?? elapsedMs());
  if (s.cfg.timeLimitSec) txt += " · " + t("hud.limit", { t: fmtTime(Math.max(0, s.cfg.timeLimitSec * 1000 - (round.endMs ?? elapsedMs()))) });
  if (s.cfg.endless) txt += " · " + t("hud.plate", { n: s.endlessWave });
  return txt;
}
