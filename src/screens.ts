// The browser build's DOM screens as starhermit:ui, built every frame: the
// title (key art with its slow drift, the vignette, kicker, name, rule,
// tagline, account line, Play and the secondary grid), the mode list and the
// info panels (Journey, Practice, Challenge, Score Chase, Profile), the play
// HUD around the 3D plate (title and lesson text above it; caption, status
// line and actions below it, or beside it on a short landscape screen), and
// the pause, results, lesson and settings cards as modal dialogs over the
// plate, plus the toast. The browser's media queries are layouts picked by
// the window's logical size: phone width (≤ 640 px, the title's ≤ 760 px)
// and short landscape (≤ 500 px tall).
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel, primaryPointer } from "starhermit:input";
import * as ui from "starhermit:ui";
import { requestSignIn } from "starhermit:platform";
import * as audio from "./audio.js";
import * as game from "./game.js";
import { app, Content, round } from "./game.js";
import { t } from "./i18n.js";
import { copyInvite, displayName, signedIn } from "./online.js";
import * as render from "./render.js";
import { gameSettings, progress, setGameSetting, syncStatus } from "./save.js";
import { look } from "./look.js";

// -- helpers ------------------------------------------------------------------------------
interface View { w: number; h: number; s: number; narrow: boolean; short: boolean; phoneTitle: boolean }
function view(): View {
  const { width, height, safeArea } = frame();
  const s = ui.preferences().scale;
  const w = Math.max(1, (width - safeArea.left - safeArea.right) / s);
  const h = Math.max(1, (height - safeArea.top - safeArea.bottom) / s);
  return { w, h, s, narrow: w <= 640, short: h <= 500 && w > h, phoneTitle: w <= 760 };
}
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
type Cls = string | ui.Style | false | null | undefined;

/** Plays the UI tap (every [data-action] button did) and runs the action. */
function act(fn: () => void): void { audio.play("ui"); fn(); }

/** A button whose label wraps (as a paragraph face) when it is wider than `width`. */
function button(id: string, text: string, styles: Cls[], width?: number): boolean {
  const s = ui.preferences().scale;
  if (width) {
    const w = ui.measureText(text, { kind: "button", style: styles.filter(Boolean) as (string | ui.Style)[] }).width / s;
    if (w > width) {
      const pad = w - ui.measureText(text, { style: styles.filter(Boolean) as (string | ui.Style)[] }).width / s;
      const align = styles.includes("btn-list") ? "start" : "center";
      return ui.style(...styles, "wide").id(id).button(text, { content: () => { ui.style({ text: { align } }).paragraph(text, Math.max(40, width - pad)); } });
    }
  }
  return ui.style(...styles).id(id).button(text);
}

interface Btn { id: string; text: string; primary?: boolean; act: () => void }
/** Buttons in rows that wrap at `width` (the browser's flex-wrap .row). */
function buttonRows(label: string, list: Btn[], width: number, spacing: number, justify: ui.Align): ui.Rect {
  const s = ui.preferences().scale;
  const styles = (b: Btn): string[] => ["btn", ...(b.primary ? ["btn.primary"] : [])];
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, ui.measureText(b.text, { kind: "button", style: styles(b) }).width / s + 1);
    if (rows.at(-1)!.length && used + spacing + bw > width) { rows.push([]); used = 0; }
    used += (rows.at(-1)!.length ? spacing : 0) + bw;
    rows.at(-1)!.push(b);
  }
  return ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) if (button(b.id, b.text, styles(b), width)) act(b.act);
    }, { spacing, justify, align: "center", ...(justify !== "start" ? { width } : {}) }));
  }, { spacing, align: justify === "center" ? "center" : "start" });
}

/** A key's label for the HUD hints, as the browser build printed it ("H", "Esc"). */
function keyLabel(label: string): string {
  if (/^Key[A-Z]$/.test(label)) return label.slice(3);
  if ([...label].length === 1) return label.toUpperCase();
  if (/^Digit\d$/.test(label)) return label.slice(5);
  if (label === "Escape") return "Esc";
  return label.replace(/^Arrow/, "");
}
/** "Hint (H)" with the player's own binding (the tables carry the default key). */
function withKey(key: string, action: string): string {
  const base = t(key).replace(/\s*\([^)]*\)\s*$/, "");
  if (primaryPointer() === "coarse") return base;
  const k = keyLabel(bindingLabel(action, "keyboard"));
  return k ? `${base} (${k})` : base;
}

const lastHeight = new Map<string, number>();
let openedAt = new Map<string, number>();
/** A modal card (the browser's .modal-backdrop + .modal.card), scrolling when
 * taller than the window; `back` runs on Escape / East (not on its first frame). */
function card(key: string, title: string, v: View, build: (inner: number) => void, back?: () => void): void {
  const f = frame();
  if (!openedAt.has(key)) openedAt = new Map([[key, f.frame]]);
  const width = Math.min(v.w * 0.92, 480);
  const inner = width - 32;
  const maxH = v.h * 0.86 - 32;
  const open = ui.dialog(key, title, true, () => {
    const body = (): void => {
      const r = ui.column(`${key}-body`, () => build(inner), { width: inner, spacing: 10, align: "stretch" });
      lastHeight.set(key, r.height / v.s);
    };
    const h = lastHeight.get(key) ?? 0;
    if (h > maxH) ui.scrollArea(`${key}-scroll`, { width: inner + 12, height: Math.max(80, maxH) }, body);
    else body();
  });
  if (!open && back && openedAt.get(key) !== f.frame) back();
}

// -- the title ------------------------------------------------------------------------------
let titleH = 0;
function titleScreen(v: View): void {
  const q = look();
  const full = { width: v.w, height: v.h };
  ui.place("menu-bg", "top-start", () => {
    ui.widget("", { role: "none", size: full, style: ["menu-bg", ...(q.background === "static" ? ["menu-bg-static"] : [])] });
  });
  ui.place("menu-vignette", "top-start", () => {
    ui.widget("", { role: "none", size: full, style: v.phoneTitle && !v.short ? "menu-vignette-phone" : "menu-vignette" });
  });
  const phone = v.phoneTitle && !v.short;
  const padV = v.short ? 14 : phone ? 32 : 48, padH = v.short ? 40 : phone ? 22 : 56;
  const width = Math.min(phone || v.short ? v.w : 600, v.w);
  const inner = Math.max(120, width - padH * 2);
  const s = v.s;
  ui.scrollArea("title-scroll", full, () => {
    ui.column("title-page", () => {
      const content = ui.column("menu-content", () => {
        ui.style("menu-kicker").paragraph(t("kicker"), inner);
        let size = v.short ? 35.2 : phone ? clamp(v.w * 0.1, 33.6, 48) : clamp(v.w * 0.07, 41.6, 73.6);
        const tw = ui.measureText("Arrow Exodus", { style: ["menu-title", { text: { size } }] }).width / s;
        if (tw > inner) size = Math.max(20, size * inner / tw * 0.98);
        ui.style("menu-title", { text: { size } }).label("Arrow Exodus");
        ui.widget("", { role: "none", size: { width: 88, height: 3 }, style: "menu-rule" });
        ui.style("menu-tagline", v.short && { text: { size: 14.7 } }).paragraph(t("tagline"), Math.min(inner, 42 * 16));
        ui.style("menu-account").id("account-line").paragraph(accountLine(), inner);
        const actionsW = Math.min(inner, v.short ? 520 : 340);
        ui.column("menu-actions", () => {
          if (button("btn-play", t("play"), ["menu-play", "wide", v.short && { padding: { top: 8, bottom: 8 } }], actionsW)) act(() => game.startJourney(game.nextJourneyIndex()));
          const cols = v.short ? 3 : 2;
          const gap = v.short ? 8 : 10;
          const cellW = (actionsW - gap * (cols - 1)) / cols;
          const list: Btn[] = [
            { id: "btn-daily", text: t("dailyChallenge"), act: game.startDaily },
            { id: "btn-journey", text: t("journey"), act: () => game.showScreen("journey-info") },
            { id: "btn-profile", text: t("profile"), act: () => game.showScreen("profile-info") },
            { id: "btn-settings", text: t("settings"), act: () => { app.settings = true; } },
          ];
          if (signedIn()) list.push({ id: "btn-invite", text: t("p.invite"), act: invite });
          else list.push({ id: "btn-sign-in", text: t("p.signIn"), act: signIn });
          const blur = q.preset === "high" || q.preset === "ultra";
          ui.grid("menu-secondary", () => {
            list.forEach((b, i) => {
              // an odd last item spans the row (its label is the longest)
              const span = i === list.length - 1 && list.length % cols ? cols - (list.length % cols) + 1 : 1;
              if (span > 1) ui.cell({ span });
              if (button(b.id, b.text, ["menu-secondary", blur && "menu-blur", "wide"], cellW * span + gap * (span - 1))) act(b.act);
            });
          }, { columns: cols, gap, width: actionsW });
        }, { width: actionsW, spacing: v.short ? 8 : 14, align: "stretch" });
      }, { width, padding: { top: padV, bottom: phone ? 56 : padV, start: padH, end: padH }, spacing: v.short ? 6 : 10 });
      titleH = content.height / s;
    }, { width: v.w, height: Math.max(v.h, titleH), justify: phone ? "end" : "center" });
  });
}

function accountLine(): string {
  if (!signedIn()) return signedOutNotice ? t("p.signedOut") : t("p.offline");
  const st = syncStatus();
  const sync = st === "synced" ? t("p.synced") : st === "saving" ? t("p.saving") : t("p.syncOff");
  return t("p.playingAs", { name: displayName() || "…" }) + " · " + sync;
}
let signedOutNotice = false;
export function noteSignedOut(): void { signedOutNotice = true; game.toast(t("p.signedOut")); }
let signingIn = false;
function signIn(): void {
  if (signingIn) return;
  signingIn = true;
  requestSignIn().then(() => { signingIn = false; signedOutNotice = false; }, () => { signingIn = false; });
}
function invite(): void {
  const r = copyInvite();
  game.toast(r.ok ? t("p.inviteCopied") : (t("p.inviteFailed") + (r.link ? " " + r.link : "")));
}

// -- the menu screens ---------------------------------------------------------------------
function page(v: View, key: string, build: (inner: number) => void): void {
  ui.place(`${key}-bg`, "top-start", () => { ui.widget("", { role: "none", size: { width: v.w, height: v.h }, style: "screen" }); });
  const padV = v.narrow ? 16 : 24, padH = v.narrow ? 14 : 32;
  const width = Math.min(1180, v.w);
  const inner = width - padH * 2;
  ui.scrollArea(`${key}-scroll`, { width: v.w, height: v.h }, () => {
    ui.column(`${key}-page`, () => {
      ui.column(key, () => build(inner), { width, padding: { top: padV, bottom: padV, start: padH, end: padH }, spacing: 12 });
    }, { width: v.w, align: "center" });
  });
}
const heading = (text: string, inner: number): void => { ui.style("heading2").paragraph(text, inner); };
const para = (text: string, inner: number, ...cls: Cls[]): void => { ui.style("text", ...cls).paragraph(text, inner); };
function back(id: string, inner: number): void {
  if (button(id, t("backModes"), ["btn"], inner)) act(() => game.showScreen("modes"));
}

function modesScreen(v: View): void {
  page(v, "modes", (inner) => {
    heading(t("modes"), inner);
    const items: [string, string, () => void][] = [
      ["mode-learn", "modes.learn", () => game.startLesson(game.firstUnfinishedLesson())],
      ["mode-journey", "modes.journey", () => game.showScreen("journey-info")],
      ["mode-daily", "modes.daily", game.startDaily],
      ["mode-practice", "modes.practice", () => game.showScreen("practice-info")],
      ["mode-challenge", "modes.challenge", () => game.showScreen("challenge-info")],
      ["mode-score", "modes.score", () => game.showScreen("score-chase-info")],
    ];
    ui.column("mode-list", () => {
      for (const [id, key, fn] of items) if (button(id, t(key), ["btn", "btn-list"], inner)) act(fn);
    }, { spacing: 10 });
  });
}

function journeyInfo(v: View): void {
  const p = progress();
  page(v, "journey-info", (inner) => {
    heading(t("journey"), inner);
    para(t("ji.summary", { n: game.nextJourneyIndex() + 1, total: Content.JOURNEY.length, done: Object.keys(p.journeyStars).length, stars: game.stars() }), inner);
    if (button("btn-begin-journey", t("beginJourney"), ["btn", "btn.primary", "btn-big"], inner)) act(() => game.startJourney(game.nextJourneyIndex()));
    back("btn-back", inner);
  });
}

function practiceInfo(v: View): void {
  page(v, "practice-info", (inner) => {
    heading(t("practice"), inner);
    para(t("practice.desc"), inner);
    for (const pr of Content.PRACTICE) {
      const text = t("pi.line", { name: game.practiceName(pr), rows: pr.board.rows, cols: pr.board.cols, arrows: pr.arrows ?? 0 }) +
        (pr.bolts ? t("pi.bolts", { n: pr.bolts }) : "") + (pr.bigs ? t("pi.bigs", { n: pr.bigs }) : "");
      if (button(`practice-${pr.id}`, text, ["btn"], inner)) act(() => game.startPractice(pr));
    }
    back("btn-back", inner);
  });
}

function challengeInfo(v: View): void {
  const p = progress();
  page(v, "challenge-info", (inner) => {
    heading(t("challenge"), inner);
    para(t("challenge.desc"), inner);
    for (const ch of Content.CHALLENGES) {
      const best = p.challengeBest[ch.id];
      const label = game.challengeName(ch) + (best ? t("ci.best", { n: best }) : "");
      const intro = game.challengeIntro(ch);
      const s = v.s;
      const bw = ui.measureText(label, { kind: "button", style: "btn" }).width / s;
      const side = !v.narrow && bw + 10 + 160 <= inner;
      (side ? ui.row : ui.column)(`ch-${ch.id}`, () => {
        if (button(`challenge-${ch.id}`, label, ["btn"], inner)) act(() => game.startChallenge(ch));
        para(intro, side ? inner - bw - 10 : inner, "muted", "small");
      }, { spacing: side ? 10 : 4, align: side ? "center" : "start" });
    }
    back("btn-back", inner);
  });
}

function scoreChaseInfo(v: View): void {
  page(v, "score-chase-info", (inner) => {
    heading(t("scoreChase"), inner);
    para(t("score.intro", null, Content.SCORE_CHASE.intro) + " " + t("sci.best", { n: progress().endlessBest || 0 }), inner);
    if (button("btn-begin-score", t("beginScore"), ["btn", "btn.primary", "btn-big"], inner)) act(game.startScoreChase);
    back("btn-back", inner);
  });
}

function profileInfo(v: View): void {
  const p = progress();
  page(v, "profile-info", (inner) => {
    heading(t("profile"), inner);
    para(t("pf.summary", {
      rounds: p.stats.rounds, wins: p.stats.wins, exits: p.stats.exits, combo: p.stats.bestCombo,
      a: Object.keys(p.achievements).length, total: Content.ACHIEVEMENTS.length,
    }), inner);
    if (button("btn-begin-profile", t("beginProfile"), ["btn", "btn.primary", "btn-big"], inner)) act(() => game.showScreen("title"));
    back("btn-back", inner);
  });
}

// -- the play HUD ---------------------------------------------------------------------------
function hudActions(): Btn[] {
  const r = round!;
  const list: Btn[] = [];
  if (r.cfg.mechanics?.hint) list.push({ id: "btn-hint", text: withKey("hud.hint", "hint"), act: game.hint });
  if (r.cfg.mechanics?.undo) list.push({ id: "btn-undo", text: withKey("hud.undo", "undo"), act: game.undo });
  list.push({ id: "btn-restart", text: t("restart"), act: game.restart });
  list.push({ id: "btn-pause", text: withKey("hud.pause", "pause"), act: game.pause });
  return list;
}

function playScreen(v: View): void {
  const r = round!;
  const f = frame();
  const caption = app.caption ? t(app.caption.key) : "";
  const pad = v.narrow ? 14 : v.short ? 12 : 24;
  let frameRect: { x: number; y: number; w: number; h: number };
  if (v.short) {
    // HUD beside the board so the board uses nearly the full height.
    const sideW = Math.min(240, (v.w - pad * 2) * 0.27);
    const left = ui.place("hud-left", { anchor: "top-start", x: pad, y: 8 }, () => {
      ui.style("hud-title", { text: { size: 17.6 } }).id("hud-title").paragraph(r.ctx.label(), sideW);
      if (r.ctx.sub) ui.style("hud-subtitle").id("hud-subtitle").paragraph(r.ctx.sub(), sideW);
    }, { spacing: 4, width: sideW });
    const right = ui.place("hud-right", { anchor: "top-end", x: pad, y: 8 }, () => {
      ui.style("caption-line").id("caption-line").paragraph(caption || " ", sideW);
      ui.style("hud-status").id("hud-status").paragraph(game.hudStatus(), sideW);
      ui.column("hud-actions", () => {
        for (const b of hudActions()) if (button(b.id, b.text, ["btn", "wide"], sideW)) act(b.act);
      }, { spacing: 6, width: sideW, align: "stretch" });
    }, { spacing: 6, width: sideW });
    frameRect = { x: left.x + left.width, y: 0, w: right.x - (left.x + left.width), h: f.height };
  } else {
    const width = Math.min(1180, v.w) - pad * 2;
    const top = ui.place("hud-top", { anchor: "top", y: v.narrow ? 12 : 18 }, () => {
      ui.style("hud-title", v.narrow && { text: { size: 20 } }).id("hud-title").paragraph(r.ctx.label(), width);
      if (r.ctx.sub) ui.style("hud-subtitle").id("hud-subtitle").paragraph(r.ctx.sub(), width);
    }, { spacing: 4, width });
    const bottom = ui.place("hud-bottom", { anchor: "bottom", y: v.narrow ? 12 : 18 }, () => {
      ui.style("caption-line", { text: { align: "center" } }).id("caption-line").paragraph(caption || " ", width);
      ui.style("hud-status", { text: { align: "center" } }).id("hud-status").paragraph(game.hudStatus(), width);
      buttonRows("hud-actions", hudActions(), width, 10, "center");
    }, { spacing: 6, width, align: "center" });
    frameRect = { x: 0, y: top.y + top.height, w: f.width, h: bottom.y - (top.y + top.height) };
  }
  // The plate in the free part (the browser build's square canvas host, at most 640 px of the
  // 1180 px page there, here up to 760 logical px).
  const side = Math.min(frameRect.w, frameRect.h, 760 * v.s);
  if (side > 4 && f.width > 0 && f.height > 0) {
    const cx = frameRect.x + frameRect.w / 2, cy = frameRect.y + frameRect.h / 2;
    const x0 = cx - Math.min(frameRect.w, Math.max(side, frameRect.w * 0.5)) / 2;
    const x1 = cx + Math.min(frameRect.w, Math.max(side, frameRect.w * 0.5)) / 2;
    const y0 = cy - side / 2, y1 = cy + side / 2;
    render.frameBoard({ x0: (x0 / f.width) * 2 - 1, x1: (x1 / f.width) * 2 - 1, y1: 1 - (y0 / f.height) * 2, y0: 1 - (y1 / f.height) * 2 }, f.width / f.height);
  }
}

// -- cards ------------------------------------------------------------------------------------
function pauseCard(v: View): void {
  card("pause", t("paused"), v, (inner) => {
    buttonRows("pause-actions", [
      { id: "btn-resume", text: t("resume"), primary: true, act: game.resume },
      { id: "btn-restart-p", text: t("restart"), act: game.restart },
      { id: "btn-settings-p", text: t("settings"), act: () => { app.settings = true; } },
      { id: "btn-resign", text: t("resign"), act: game.resign },
      { id: "btn-quit", text: t("quitTitle"), act: game.quitToTitle },
    ], inner, 10, "start");
  }, game.resume);
}

function scoreLines(lines: [string, string][], inner: number): void {
  ui.grid("score-lines", () => {
    lines.forEach(([k, val], i) => {
      ui.style("score-key").id(`sk-${i}`).label(k);
      ui.style("score-val").id(`sv-${i}`).label(val);
    });
  }, { columns: [{ fr: 1 }, { width: "auto", align: "end" }], gap: { row: 3, column: 16 }, width: inner });
}

function art(cls: string | null, inner: number, v: View): void {
  if (!cls) return;
  ui.widget("", { role: "image", size: { width: inner, height: Math.min(150, inner * 0.4, v.h * 0.22) }, style: ["result-art", cls] });
}

let resultsFocusFor: unknown = null;
function resultsCard(v: View): void {
  const r = round!;
  const st = r.state;
  if (resultsFocusFor !== st) { resultsFocusFor = st; ui.setFocus("btn-replay"); }
  const won = !!(st.terminal && st.terminal.won);
  const cls = won ? "art-cleared" : st.terminal && st.terminal.reason === game.Rules.TERMINAL.LOCKED ? "art-locked" : null;
  // The dialog's title is the headline (a dialog always draws its title first), the art under it.
  card("results", game.terminalHeadline(st), v, (inner) => {
    art(cls, inner, v);
    scoreLines(game.scoreBreakdown(st), inner);
    const lb = game.leaderboardLine();
    if (lb) ui.style("small", "text").id("results-lb").paragraph(lb, inner);
    const list: Btn[] = [{ id: "btn-replay", text: t("replay"), primary: true, act: game.restart }];
    if (r.ctx.kind === "journey" && won && r.ctx.index! + 1 < Content.JOURNEY.length) list.push({ id: "btn-next", text: t("nextStage"), act: game.next });
    list.push({ id: "btn-results-modes", text: t("backModes"), act: game.toModes });
    list.push({ id: "btn-results-title", text: t("titleBtn"), act: game.quitToTitle });
    buttonRows("results-actions", list, inner, 10, "start");
  });
}

function lessonCard(v: View): void {
  const r = round!;
  const lessons = Content.tutorialLessons();
  const hasNext = r.ctx.index! + 1 < lessons.length;
  if (resultsFocusFor !== r.lesson) { resultsFocusFor = r.lesson; ui.setFocus(hasNext ? "btn-next-lesson" : "btn-results-modes"); }
  card("lesson", t("lessonComplete"), v, (inner) => {
    art("art-cleared", inner, v);
    scoreLines([[game.lessonTitle(r.lesson!), t("done")]], inner);
    const list: Btn[] = [];
    if (hasNext) list.push({ id: "btn-next-lesson", text: t("nextLesson"), primary: true, act: game.next });
    list.push({ id: "btn-results-modes", text: t("backModes"), act: game.toModes });
    list.push({ id: "btn-results-title", text: t("titleBtn"), act: game.quitToTitle });
    buttonRows("lesson-actions", list, inner, 10, "start");
  });
}

function settingsCard(v: View): void {
  const close = (): void => { app.settings = false; };
  const st = gameSettings();
  const stars = game.stars();
  card("settings", t("settings"), v, (inner) => {
    const themes = Content.THEMES;
    const options: ui.SelectOption[] = themes.map((th) => stars < th.unlockStars
      ? { text: t("set.locked", { name: game.themeName(th), n: th.unlockStars }), disabled: true }
      : { text: game.themeName(th) });
    const i = Math.max(0, themes.findIndex((th) => th.id === st.theme));
    ui.column("set-theme-row", () => {
      ui.style("text").label(t("set.theme"));
      const n = ui.id("set-theme").select(t("set.theme"), i, options);
      if (n !== i && themes[n] && stars >= themes[n]!.unlockStars) {
        setGameSetting("theme", themes[n]!.id);
        render.setTheme(themes[n]!);
      }
    }, { spacing: 4, width: inner, style: "set-row" });
    const cap = ui.id("set-captions").checkbox(t("set.captions"), st.captions);
    if (cap !== st.captions) setGameSetting("captions", cap);
    // Sound, graphics, language, controls and accessibility are the runtime's Options.
    if (button("btn-options", t("set.options"), ["btn"], inner)) act(openMenu);
    if (button("btn-settings-close", t("close"), ["btn", "btn.primary"], inner)) act(close);
  }, close);
}

// -- the frame ------------------------------------------------------------------------------
/** Builds this frame's UI (from onUpdate, so a press's frame may sign in or copy). */
export function buildUi(): void {
  const v = view();
  const { width, height, safeArea } = frame();
  ui.area({ x: safeArea.left, y: safeArea.top, width: width - safeArea.left - safeArea.right, height: height - safeArea.top - safeArea.bottom }, () => {
    switch (app.screen) {
      case "title": titleScreen(v); break;
      case "modes": modesScreen(v); break;
      case "journey-info": journeyInfo(v); break;
      case "practice-info": practiceInfo(v); break;
      case "challenge-info": challengeInfo(v); break;
      case "score-chase-info": scoreChaseInfo(v); break;
      case "profile-info": profileInfo(v); break;
      case "play": if (round) playScreen(v); break;
    }
    if (app.settings) settingsCard(v);
    else if (app.screen === "play" && round) {
      if (app.overlay === "pause") pauseCard(v);
      else if (app.overlay === "results") resultsCard(v);
      else if (app.overlay === "lesson") lessonCard(v);
    }
    if (!app.settings && app.overlay === null) openedAt.clear();
    if (app.toast) {
      const text = app.toast.text;
      ui.place("toast", { anchor: "bottom", y: 20 }, () => { ui.style("toast").paragraph(text, Math.min(v.w - 32, 560) - 34); });
    }
  });
  // Back (Escape / East) on the menu screens: the screen's back button.
  if (!app.settings && app.screen !== "play" && app.screen !== "title" && ui.back()) {
    audio.play("ui");
    game.showScreen(app.screen === "modes" ? "title" : "modes");
  }
}
