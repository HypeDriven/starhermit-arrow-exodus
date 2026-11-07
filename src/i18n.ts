// Localization: the game's string tables (assets/strings.json: the nine
// StarHermit locales, keyed; the account and leaderboard lines are the engine's
// own `starhermit.*` strings) in the interface language the engine's strings
// follow (the player's choice in Options › Language, else the device's). The UI
// is immediate mode, so a language change shows on the next frame with the
// round, timers and the board kept.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

/** A string by key in the player's language (else `fallback`, else the key);
 * `{name}` placeholders from vars. */
export function t(key: string, vars?: Record<string, string | number> | null, fallback?: string): string {
  if (fallback !== undefined && !strings.has(key)) return fallback;
  return strings.t(key, vars ?? undefined);
}
