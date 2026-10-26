// The look of the menus and HUD: the browser build's style sheets
// (index.html's <style> and css/menu.css, rewritten class-based as
// tools/ui-style.css and converted once with `npm run css` into
// assets/ui-style.json) registered as starhermit:ui styles, plus what the
// sheets had no class for: the theme's colors, the modal card as the
// dialog, the results art, selects and checkboxes.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setTheme({
    fontSize: 16, headingSize: 24, smallSize: 14.4, padding: 8, spacing: 10,
    text: "#eef1f5", muted: "#aab3bf", panel: "#1a1e24", control: "#2c333d", hovered: "#39424e",
    pressed: "#454f5d", field: "#232830", accent: "#f2b04e", focus: "#7fd4c1", outline: "#39414d",
  });
  const modal = css.styles[".modal"]!;
  const dim = css.styles[".modal-backdrop"]!;
  ui.setStyles({
    ...css.styles,
    dialog: {
      background: modal.background!, radius: modal.radius!, padding: modal.padding!,
      parts: { backdrop: { background: dim.background! } },
    },
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    // headings are the dialogs' titles (the page headings are .heading2 paragraphs)
    heading: { text: { color: "$text", size: 24, weight: "700" }, margin: { bottom: 4 } },
    checkbox: { text: { color: "$text" }, minHeight: 40, parts: { box: { background: "$panel2", border: { width: 1, color: "$line" }, radius: 4 }, mark: { background: "$accent" } } },
    select: {
      text: { color: "$text" },
      parts: {
        field: { background: "$panel2", padding: { top: 4, end: 8, bottom: 4, start: 8 }, minHeight: 36, border: { width: 1, color: "$line" }, hovered: { border: { color: "$accent" } } },
        list: { background: "$panel2", border: { width: 1, color: "$line" } },
        option: { hovered: { background: "#39424e" }, selected: { text: { color: "$accent" } } },
      },
    },
    scrollArea: { parts: { bar: { background: "$line", radius: 4 } } },
    ".art-cleared": { background: [{ image: "assets/plate-cleared.webp", size: "cover" }, "#0c0f13"], radius: 8 },
    ".art-locked": { background: [{ image: "assets/no-lanes.webp", size: "cover" }, "#0c0f13"], radius: 8 },
    ".menu-bg-static": { animation: "none" },
    ".wide": { width: "fill" },
    ".btn-wrap": { text: { align: "start" } },
  });
}
