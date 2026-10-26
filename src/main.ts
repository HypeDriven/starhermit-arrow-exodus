// Arrow Exodus on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. Clear a metal plate of enamel arrows by
// launching each one whose lane to the edge is open. The rules, content,
// seeds and save document are the browser build's classic scripts (js/);
// the controller is game.ts, the plate render.ts, the screens screens.ts.
import { frame, onPreferencesChange, onStart, onSuspend, onUpdate, preferences } from "starhermit:engine";
import { onAction, onPointerButton, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded } from "starhermit:platform";
import { saves } from "starhermit:storage";
import * as audio from "./audio.js";
import * as game from "./game.js";
import { app, round } from "./game.js";
import { look } from "./look.js";
import { refresh } from "./online.js";
import * as render from "./render.js";
import { initSave, onSettingsChange } from "./save.js";
import { buildUi, noteSignedOut } from "./screens.js";
import { initStyles } from "./style.js";

onStart(() => {
  initStyles();
  initSave();
  refresh();
  audio.loadSfx();
  audio.startBeds(); // the room tone and pad start with the mixer (a browser's at the first press)
  render.init(game.RNG);
  render.setReducedMotion(preferences().reducedMotion);
  render.setTheme(game.themeRow());
  game.showScreen("title");
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onSettingsChange(() => { if (round) render.setTheme(game.themeRow()); });
onSessionEnded(() => noteSignedOut());
onSuspend(() => {
  // A hidden window pauses the round, as the browser build's visibilitychange did.
  game.pause();
  void saves.flush();
});

// -- the manifest's actions (players rebind them in the runtime's Options) ---------------------
let pausedFrame = -1;
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  if (app.screen !== "play" || !round) return;
  if (app.settings) { if (e.action === "pause") app.settings = false; return; }
  if (app.overlay === "pause") {
    if (e.action === "pause" && frame().frame !== pausedFrame) game.resume();
    return;
  }
  if (app.overlay) return;
  const dirs: Record<string, [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const d = dirs[e.action];
  if (d) { ui.setFocus(null); game.moveCursor(d[0], d[1]); return; }
  switch (e.action) {
    // Enter / Space on a focused HUD button is the button's.
    case "launch": if (!ui.focused()) game.launchCursor(); break;
    case "hint": game.hint(); break;
    case "undo": game.undo(); break;
    case "pause": pausedFrame = frame().frame; game.pause(); break;
  }
});

// -- tapping the plate (canvas picking) ---------------------------------------------------------
function tap(x: number, y: number): void {
  if (app.screen !== "play" || !round || app.overlay || app.settings || ui.pointerOver()) return;
  const id = render.pickPiece(x, y);
  if (id) game.tapPiece(id);
}
// Touch and the mouse can both report one tap: a pointer press right after a touch is skipped.
let lastTouch = -1;
onPointerButton((e) => {
  if (e.button !== 0 || !e.pressed || frame().time * 1000 - lastTouch < 600) return;
  tap(e.x, e.y);
});
onTouch((e) => {
  if (!e.primary || e.phase !== "start") return;
  lastTouch = frame().time * 1000;
  tap(e.x, e.y);
});

// -- the frame ----------------------------------------------------------------------------------
onUpdate((dt) => {
  render.applyLook(look());
  game.tick();
  audio.pollBeds();
  buildUi();
  render.update(dt);
});
