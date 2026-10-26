// The player's progress (js/store.js's document: journey stars and bests,
// challenge bests, dailies, the endless best, achievements, lifetime stats)
// as the game's save: starhermit:storage `saves` keeps { v, progress } on the
// device and, signed in, in the account's cloud slot, with two devices'
// documents merged on a conflict (AXStore.mergeDocs: better records win,
// unlocks unioned). The browser build's cloud save (slot game:<slug>, the JS
// SDK's ZIP with save.json holding the checksummed { sum, payload } wrapper)
// shows as foreign: it is parsed with AXStore.loadRaw, merged in and replaces
// the slot once (`replaceForeign`).
//
// The game's own settings (visual theme, captions) are `settings` (game.<key>,
// synced with the account); the browser build's per-player settings keys are
// migrated (theme, captions) or dropped (volumes, mute, graphics, reduced
// motion, contrast and text size are the runtime's Options now) and removed.
import type { JsonValue } from "starhermit:engine";
import { saves, settings } from "starhermit:storage";
import { loadClassic } from "starhermit:script";

loadClassic("js/rng.js");
loadClassic("js/store.js");

export interface Progress {
  tutorialDone: Record<string, boolean>;
  journeyStars: Record<string, number>;
  journeyBest: Record<string, number>;
  challengeBest: Record<string, number>;
  dailiesDone: Record<string, number>;
  endlessBest: number;
  achievements: Record<string, number>;
  stats: { rounds: number; wins: number; exits: number; bestCombo: number; flawlessWins: number; playMs: number };
  cosmetics: { theme: string };
}
interface Doc { v: number; settings: Record<string, unknown>; progress: Progress }
interface StoreApi {
  fresh(): Doc;
  migrate(doc: unknown): Doc | null;
  loadRaw(raw: string | null): Doc | null;
  mergeDocs(remote: unknown, local: unknown): Doc;
  DEFAULT_SETTINGS: Record<string, unknown>;
}
export const Store = (globalThis as unknown as { AXStore: StoreApi }).AXStore;

const SCHEMA = 1;
/** An engine save's data ({ v, progress }) as a full document, or null. */
function docOf(data: unknown): Doc | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { v?: unknown; progress?: unknown };
  return Store.migrate({ v: typeof d.v === "number" ? d.v : 1, progress: d.progress ?? {} });
}
function dataOf(doc: Doc): JsonValue {
  return { v: doc.v, progress: doc.progress } as unknown as JsonValue;
}

let doc: Doc = Store.fresh();
let lastSavedAt = 0;
const changeListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) arrived. */
export function onProgressChange(fn: () => void): void { changeListeners.add(fn); }
function changed(): void { for (const fn of changeListeners) fn(); }

export function progress(): Progress { return doc.progress; }

/** Saves the document (on the device at once; the account debounced). */
export function persist(): void {
  try { saves.save(dataOf(doc), { schema: SCHEMA }); } catch (e) { console.warn(`save: ${String(e)}`); }
}

function adopt(): void {
  const cur = saves.load();
  if (!cur || cur.savedAt === lastSavedAt) return;
  lastSavedAt = cur.savedAt;
  const next = docOf(cur.data);
  if (next && JSON.stringify(next.progress) !== JSON.stringify(doc.progress)) {
    doc = Store.mergeDocs(next, doc);
    changed();
  }
}

/** The browser build's cloud save: merged with this device's progress, saved over the slot once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const imported = old.text != null ? Store.loadRaw(old.text) : null;
  if (imported) {
    doc = Store.mergeDocs(imported, doc);
    importSettings(imported.settings);
  }
  try { saves.save(dataOf(doc), { schema: SCHEMA, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
  if (imported) changed();
}

/** Reads the device's save and starts listening (call once, from onStart). */
export function initSave(): void {
  const cur = saves.load();
  doc = docOf(cur?.data) ?? Store.fresh();
  lastSavedAt = cur?.savedAt ?? 0;
  saves.onConflict((local, remote) => {
    const merged = Store.mergeDocs(docOf(remote.data), docOf(local?.data));
    return { merged: dataOf(merged) };
  });
  saves.onStatus((_status, state) => {
    if (state === "foreign") migrateForeign();
    else adopt();
  });
  if (saves.state() === "foreign") migrateForeign();
  settings.onLegacy(importLegacy);
  importLegacy();
}

// -- the game's settings ----------------------------------------------------------------
export interface GameSettings { theme: string; captions: boolean }
export function gameSettings(): GameSettings {
  const theme = settings.get("theme");
  const captions = settings.get("captions");
  return { theme: typeof theme === "string" ? theme : "foundry", captions: captions === true };
}
export function setGameSetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
  try { settings.set(key, value as JsonValue); } catch (e) { console.warn(`setting ${key}: ${String(e)}`); }
}
export function onSettingsChange(fn: () => void): void { settings.onChange(() => fn()); }

/** The browser build's settings object's game keys (theme, captions), unless set since. */
function importSettings(old: Record<string, unknown> | undefined): void {
  if (!old) return;
  if (typeof old.theme === "string" && settings.get("theme") === undefined) setGameSetting("theme", old.theme);
  if (typeof old.captions === "boolean" && settings.get("captions") === undefined) setGameSetting("captions", old.captions);
}

/** Keys the browser build kept in the account's per-player settings (its whole settings object). */
export const LEGACY_KEYS = Object.keys(Store.DEFAULT_SETTINGS);
function importLegacy(): void {
  const keys = settings.legacyKeys();
  if (!keys) return;
  const old: Record<string, unknown> = {};
  for (const key of keys) if (LEGACY_KEYS.includes(key)) old[key] = settings.legacy(key);
  importSettings(old);
  for (const key of keys) if (LEGACY_KEYS.includes(key)) settings.removeLegacy(key);
}

/** The save's sync state for the title's account line. */
export function syncStatus(): "synced" | "saving" | "off" {
  switch (saves.state()) {
    case "ready": return saves.status() === "pending" ? "saving" : "synced";
    case "loading": case "uploading": case "foreign": return "saving";
    default: return "off";
  }
}
