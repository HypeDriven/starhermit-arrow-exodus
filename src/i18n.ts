// Localization: the game's string tables (js/strings.js: the nine StarHermit
// locales, English source tables by key) in the interface language the runtime
// reports (preferences().language: the player's choice in Options › Language,
// else the device's). The UI is immediate mode, so a language change shows on
// the next frame with the round, timers and the board kept (the browser build
// re-rendered its DOM text on `ax-language` for the same effect).
import { onPreferencesChange, preferences } from "starhermit:engine";
import { loadClassic } from "starhermit:script";
import * as ui from "starhermit:ui";

loadClassic("js/strings.js");
type Table = Record<string, string>;
const S = (globalThis as unknown as { AXStrings: { LOCALES: string[]; STRINGS: Record<string, Table> } }).AXStrings;
export const LOCALES = S.LOCALES;
const PRIMARY: Record<string, string> = { en: "en-US", es: "es-419", de: "de-DE", fr: "fr-FR", pt: "pt-BR", it: "it-IT" };
const REGION: Record<string, string> = {
  "en-au": "en-GB", "en-nz": "en-GB", "en-ie": "en-GB", "en-in": "en-GB", "en-za": "en-GB",
  "fr-be": "fr-FR", "fr-ch": "fr-FR", "pt-pt": "pt-BR", "es-mx": "es-419", "es-ar": "es-419",
};

/** The supported locale nearest a BCP 47 tag. */
export function pickLocale(tag: string): string {
  const t = String(tag || "en-US");
  const exact = LOCALES.find((l) => l.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const region = REGION[t.toLowerCase()];
  if (region) return region;
  return PRIMARY[t.split("-")[0]!.toLowerCase()] ?? "en-US";
}

export let locale = pickLocale(preferences().language);
ui.setLanguage(locale);
onPreferencesChange((p) => {
  const next = pickLocale(p.language);
  if (next === locale) return;
  locale = next;
  ui.setLanguage(locale);
});

/** A string by key in the player's language (else en-US, else `fallback`, else
 * the key); `{name}` placeholders from vars. */
export function t(key: string, vars?: Record<string, string | number> | null, fallback?: string): string {
  let s = S.STRINGS[locale]?.[key] ?? S.STRINGS["en-US"]![key] ?? fallback ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}
