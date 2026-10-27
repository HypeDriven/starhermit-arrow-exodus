# Arrow Exodus — Running Game Design Document

## 1. Overview

**Pitch.** A machined steel plate holds a grid of enamel arrow tiles. Tap any arrow whose lane to the plate edge is clear and it flies off; anything in the lane blocks it. Clear every arrow before the plate locks up.

| | |
|---|---|
| Genre | Single-player direction/removal puzzle (perfect information, deterministic) |
| Players | 1; a global high-score board when signed in (§12) |
| Session | 30 s (Learn lesson) to ~4 min (7×7 Journey stage); Score Chase runs until the plate locks |
| Platforms | StarHermit engine script game (engine 1.19.1, host API 1.21): natively in the StarHermit client, in desktop and mobile browsers on the engine's web runtime |
| Rendering | `starhermit:scene` (three.js-style retained 3D scene) for the plate; every menu, HUD line and card is `starhermit:ui` (immediate mode) styled from the browser build's converted CSS |
| Version | `starhermit.txt`: `version=1.0.0`, `contentVersion=1`, `engine.version=1.19.1`, `engine.minor=15` |

File map (everything that ships or tests the game):

| Path | Owns |
|---|---|
| `starhermit.txt` | Manifest: name, owner, `server=score-script.js`, cover, `launch=index.html`, `engine.*`, `control.*` and `engine.gamepad.*` actions |
| `index.html`, `starhermit-files.json` | The web loader and file index `npm run package` writes (`starhermit package --web .`; never edited) |
| `src/main.ts` | Entry (`engine.entry`): lifecycle, the manifest's actions, pointer/touch picking, the frame |
| `src/game.ts` | Controller: screens state, rounds (history, clock, time limit, lessons), results recording, achievements, leaderboard post, HUD status text |
| `src/render.ts` | The plate on `starhermit:scene`: lights, procedural textures and meshes, tiles, bolts, decor, tweens, sparks, dust motes, free markers, hint/cursor rings, picking, camera fitting, post effects per graphics level |
| `src/geometry.ts` | three.js `Shape` + `ExtrudeGeometry` stand-in: rounded bevelled slabs and the arrow chevrons |
| `src/screens.ts` | All UI: title, modes, info panels, play HUD, pause / results / lesson / settings cards, toast |
| `src/style.ts` | Registers `assets/ui-style.json` (from `tools/ui-style.css`) plus the theme, dialog, select, checkbox and results-art styles |
| `src/audio.ts` | Event → clip map on the engine mixer, captions, the room tone and generative pad rendered into clips |
| `src/save.ts` | Progress as the engine save (`saves`) with conflict merge and the browser build's cloud save migration; the game settings (theme, captions) |
| `src/online.ts` | Score posting through `score-script.js`, the invite link |
| `src/i18n.ts`, `src/look.ts` | The interface language → string table; the graphics level → look |
| `js/rng.js`, `js/rules.js`, `js/content.js`, `js/store.js` | The browser build's pure classic scripts, loaded with `loadClassic` (rules, content, seeds, save document) |
| `js/gfx.js` | Pure graphics model: quality tier → preset row and budgets, level scaling |
| `js/strings.js` | Every player-facing string in the nine locales |
| `score-script.js` | StarHermit platform script (`server=score-script.js`): range-checks a finished round's total and posts it to the `high-score` leaderboard |
| `sfx/*.opus`, `sfx/manifest.*` | 14 authored clips and the event binding table (§9) |
| `assets/` | Key art, results illustrations, `ui-style.json` |
| `cover.jpg`, `coverart.png`, `icon.png`, `favicon.png` | Store cover and icons |
| `tests/` | Unit suites, `native.mjs` with `tests/native/*.play`, `browser.mjs` (§14); left out of the package |
| `tools/` | `package-web.mjs`, `css.mjs`, `ui-style.css` (dev only; left out of the package) |

## 2. Vision and design pillars

The fantasy is a fletcher's workbench: heavy machined steel, glossy enamel, one warm lamp. Every arrow that leaves the plate should feel like a small mechanical release, and a fully cleared plate like the workshop falling silent.

1. **The lane is the whole game.** The only question the player ever answers is "is this arrow's lane clear to the edge?" Rules in: single arrows, two-cell big arrows (both lanes), immovable bolts, time limits. Rules out: rotating arrows, moving pieces, chain reactions, hidden information, power-ups. Nothing on the plate changes except by an arrow leaving.
2. **Never guess, never grind.** Every plate is proven solvable by the same solver that powers hints (`rules.solve`), so a lock-up is always the player's ordering mistake. Rules in: glow dots on every currently free arrow, a Hint that shows a real solution step, Undo in relaxed modes. Rules out: randomly unsolvable boards, luck-based scoring, timers in the first 14 stages.
3. **Mistakes are informative, not fatal.** Tapping a blocked arrow shakes the tile, plays the rattle, resets the combo and costs the 500-point flawless bonus — but never ends the round. Rules out: lives, penalties that subtract score, forced restarts.
4. **Tabletop, not spectacle.** One authored camera fitted to the plate, warm key light, machined-metal materials, tiny bursts of enamel sparks. Rules in: subtle shake tiered by event, pulsing free markers, bloom limited to the free markers and sparks, a gentle colour grade. Rules out: bloom-only selection, camera swoops, decorative motion that competes with the arrows.
5. **Deterministic to the bit.** State transitions depend only on `(state, command)`; the same seed and command list always produce the same `hashState`. Rules out: `Date.now()` or `Math.random()` anywhere in `rules.js`; cosmetic randomness ever touching legality.

## 3. Player experience

**Target player.** Someone who likes short logic puzzles with a physical feel (unblock/sliding-tile players), on phone or desktop, in sessions of one to a handful of plates.

**First 60 seconds.** Title → **Play** starts Journey stage 1 "First Flight" (4×4, five arrows, no bolts, no clock). The HUD subtitle carries the stage intro ("Tap an arrow with a clear lane to send it off the plate. Clear them all."). Glow dots sit over every arrow that can leave right now, so the first tap succeeds without reading. A blocked tap shakes the tile and shows the caption "lane blocked" (when captions are on). Stage 2 "Cross Traffic" introduces blocking in its intro line. New mechanics get an intro line at the stage where they first appear: bolts at stage 9, time limit at 15, big arrows at 17; each is preceded by a mastery stage (10, 20, 30, 40). The optional **Learn** mode (Modes screen) teaches the same six ideas as forced single-action lessons.

**Session shape.** Journey stage (1–4 min) → results card with score breakdown → **Next stage** or **Replay**; three-star chasing (flawless, under par) is the replay hook. Daily is one plate per UTC day. Score Chase is the long session: plates keep arriving until the player locks one.

**Emotional beat.** The last three or four exits of a plate, when the remaining arrows all face inward and the player sees the single order that frees them — then the run of launches with rising combo chimes.

## 4. Core loop and rules contract

All rules live in `js/rules.js`; the controller (`js/game.js`) never mutates state except through `AXRules.applyCommand`.

### Board and entities

- Board: `cfg.board.rows × cols` cells (4×4 to 7×7 in shipped content). Directions `d`: 0 up, 1 right, 2 down, 3 left (`DIRS`).
- **Arrow**: `{ id, d, cells: [[r,c]] }`. **Big arrow**: two adjacent cells, facing along its own axis (horizontal bigs face left/right, vertical bigs face up/down).
- **Bolt**: static occupied cell in `state.bolts` (`[r,c]` pairs). Never removed.
- State: `{ v:1, cfg, seed, rngState, tick, pieces, bolts, score{exits, exitPoints, comboBest, perfectBonus, timeBonus, waveBonus, waves, total}, combo, invalid, elapsedMs, endlessWave, terminal, events }` (`createGame`).

### Legality

`laneBlocker(state, occ, piece)`: from each cell of the piece step in direction `d` to the board edge; the first cell occupied by anything other than the piece itself blocks. An arrow is **free** if no cell of it is blocked (`pieceIsFree`, `legalExits`). A big arrow therefore needs both of its cells' lanes clear (the trailing cell's lane passes through the leading cell, which is its own).

### Commands (`applyCommand`)

| Command | Precondition | Effect |
|---|---|---|
| `{type:'exit', piece, atMs?}` | piece exists, lane clear, not terminal | Remove piece, `combo++`, score the exit, check win/lock, tick++ |
| `{type:'probe', piece, atMs?}` | piece exists, lane blocked, not terminal | `invalid++`, `combo=0`, emit `blocked{by, at}` (counted mistake) |
| `{type:'resign'}` | not terminal | terminal `resigned`, finalize score |

Rejections (`INVALID`): `game-ended`, `blocked-path` (exit on a blocked piece), `not-blocked` (probe on a free piece), `unknown-piece`, `unknown-command`, `malformed-command`. A rejected command returns the same state object and no events. The controller decides exit vs probe with `checkExit` before sending, so a blocked tap always becomes a counted `probe` (`game.js tapPiece`). `atMs` is quantized to 100 ms into `elapsedMs` so replays are clock-independent.

### Resolution order after an exit

1. Piece removed, `combo++`, `comboBest` updated, points added.
2. If no pieces remain: endless → deal next wave (§5); otherwise terminal `board-clear`, `won:true`, flawless and time bonuses applied.
3. Else if `legalExits(s)` is empty: terminal `no-clear-paths`, `won:false`.
4. If a `timeLimitSec` exists and `elapsedMs ≥ limit`: terminal `time-up` (only reachable when a command arrives after the limit; the controller's timer normally resigns first, see §5).
5. `finalizeScore` on any terminal.

### Scoring (`rules.js` constants)

- Single exit `EXIT_BASE = 100`, big exit `BIG_BASE = 250`, plus `COMBO_PT = 25 × (combo − 1)`. Combo counts consecutive exits without a probe.
- Win bonuses: `PERFECT_BONUS = 500` if `invalid === 0`; `TIME_PT_PER_SEC = 5` per whole second under `cfg.par.timeSec` (requires `elapsedMs > 0`).
- Endless: `WAVE_BONUS = 300 × waveNumber` each time a plate is cleared.
- `total = exitPoints + perfectBonus + timeBonus + waveBonus`, written only at terminal; the HUD shows the live sum.

Worked example, Journey 1 (5 single arrows, par 60 s), cleared with no mistakes at 42.3 s: exits 100 + 125 + 150 + 175 + 200 = 750; flawless 500; time ⌊(60000 − 42300)/1000⌋ × 5 = 85; **total 1335**. The same plate with one blocked tap after the second exit: 100 + 125 + 100 + 125 + 150 = 600, no flawless, time bonus unchanged → 685.

### Terminal states and stars

`board-clear` (won), `no-clear-paths`, `time-up`, `resigned`. Journey stars (`game.js recordResult`): 1 for a win, +1 for zero mistakes, +1 for finishing under par. Stars are the only currency: theme unlocks at 10 / 25 / 45 / 70 total stars.

### RNG and seeding

`createGame` derives the rules stream `RNG.derive(seed, STREAM_RULES)` (`seed ^ 0x9e3779b9`, mulberry32). `generateBoard` shuffles cells, places bolts, big arrows, then singles with dealt directions; a candidate is accepted only if `solve()` finds a full removal order and (strict pass, ≥6 pieces) between 1 and ⌈70 %⌉ of pieces are free at the start. 200 strict attempts, 400 relaxed, then a constructive placer (`constructiveAttempt`, 400 + 200 tries) that places pieces in reverse removal order so dense configs are solvable by construction. `solve` is a memoised DFS capped at 250 000 nodes. Seeds per mode are in §5. Decor (`STREAM_DECOR`) drives the ingots beside the plate; `STREAM_AV` drives synth pitch variants; neither touches rules.

### Hints and undo

`hint(state)`: first step of `solve()` if one exists, else the first legal exit; the renderer draws a blue ring for 2.6 s. Hints never cost points. Undo (`game.js undo`) pops the previous snapshot from `round.history`; unlimited, no score penalty, not available once terminal; elapsed time is not rewound.

## 5. Modes and progression

| Mode | Entry | Config source | Seed | Undo / Hint | Clock |
|---|---|---|---|---|---|
| Journey (40 stages) | Title **Play** (next unstarred stage), Journey → **Begin Journey** | `AXContent.JOURNEY` rows | fixed 201–240 | yes / yes | stages 15, 23, 27, 30, 32, 35, 38, 40 |
| Learn (6 lessons) | Modes → **Learn** (first unfinished) | `tutorialLessons()` explicit layouts | fixed 9001–9006 | t6 only / yes | none |
| Daily | Title or Modes → **Daily** | `dailyConfig(utcDateString())` | FNV of `arrowexodus-daily-v1-<date>` | yes / yes | 240 s only on rot 6 |
| Practice (Casual 4×4·6, Apprentice 5×5·10·2 bolts·1 big, Expert 6×6·14·4·2) | Modes → Practice → preset | `PRACTICE` | `hash(id:sessionId:roundsPlayed)` — fresh every round | yes / yes | none |
| Challenge (c1–c6) | Modes → Challenge → card | `CHALLENGES` | fixed 501–506 | per card; no undo except c2 | c1 90 s, c5 120 s, c6 180 s |
| Score Chase (endless) | Modes → Score chase → **Begin** | `SCORE_CHASE` 6×6, 12 arrows, 3 bolts, 1 big | per round like Practice | no / no | none |

**Journey curve** (`content.js J`): 4×4 with 5→8 arrows (1–4); 5×5 9→12 (5–8); bolts from 9; theme index steps up every ~8 stages; time limit first at 15; big arrows from 17; 6×6 from 14, 7×7 from 25; stage 40 "Grand Exodus" is 7×7, 20 arrows, 6 bolts, 3 bigs, 200 s. Mastery stages (10, 20, 30, 40) flag `mastery:true` and combine everything introduced so far. Stages are not gated: **Play** always picks the first stage without stars, and results offer **Next stage** after any win.

**Daily** parameters from `rot = dayIndex % 7`: size 5 + (rot % 3); arrows min(9 + 2·rot, size² − 8); bolts rot % 4; bigs 1 + (rot % 2) when rot ≥ 4; par 120 + 20·rot s; theme `THEMES[rot % 5]`. Best score per date is stored in `dailiesDone`.

**Score Chase waves** (`nextWaveParams`): wave n deals bolts min(3 + ⌊n/2⌋, 8), bigs min(1 + n % 2, 4), arrows max(6, min(12 + n, 36 − bolts − bigs − 6)), from the continuing rules stream; the HUD shows `plate n`. The round ends only by lock-up or resign; `endlessBest` persists.

**Time limits.** The controller timer (250 ms) resigns the round when the limit elapses (`startTimer`), so the stored terminal reason is `resigned` while the headline reads "Time's up" via `round.timedOut`. Ten seconds before the limit the `time-warning` cue plays once.

**Unlocks.** Themes by star total (Foundry 0, Glacier 10, Verdigris 25, Ember 45, Porcelain 70); locked options are disabled in Settings. Achievements (§12) unlock at results time.

## 6. Controls and interaction

The manifest declares eight actions; players rebind keys and pads in the runtime's Options › Controls, and the HUD's key hints ("Hint (H)") show the player's binding (with a touch screen in use the hints are left out).

| Action | Keyboard | Gamepad | Pointer / touch | Feedback |
|---|---|---|---|---|
| Launch an arrow | Enter, Space or Numpad Enter on the focus ring's cell (`launch`) | South | tap or click the tile | free: launch tween + sparks + `launch`/`launch-big` (+ `combo` from ×2); blocked: 0.3 s sideways shake + `blocked` + mistake count |
| Move the focus ring | Arrow keys (`up`/`down`/`left`/`right`; the first press brings it to the top-left cell) | D-pad or left stick | — | white ring on the cell + `cursor` tick; the cell is announced to screen readers |
| Hint | H (`hint`) or **Hint** | North | button | blue ring 2.6 s + `hint` |
| Undo | U (`undo`) or **Undo** | West | button | tile drops back instantly + `undo` |
| Pause / back | P or Esc (`pause`), **Pause** | Start | button | the pause card; the same key resumes, Esc / East closes cards |
| Restart / Replay | button (HUD, pause, results) | — | button | the same seed is re-dealt; a fresh Practice or Score Chase board comes from re-entering the mode |

Every menu and card is `starhermit:ui` widgets: pointer, touch, Tab / arrows + Enter, and the D-pad + South all reach every button; Esc or East goes back from the mode and info screens (to the mode list, from it to the title). On the plate an arrow key takes focus off a HUD button and back to the board; Enter launches only while no HUD button has focus. Picking (`render.pickPiece`) raycasts the piece group only; tiles mid-flight are ignored so a double tap cannot re-launch; a press over a widget never reaches the plate, and a pointer press within 0.6 s of a touch is the same tap. Input is refused while paused, while a card is open, after the round is over or when the state is terminal; there is no animation lock. Every button plays `ui` before its action. A hidden window (`onSuspend`) pauses the round and flushes the save; the game clock stops while it is hidden, and the player un-pauses.

## 7. Screens and UI flow

`game.app.screen` is one of eight screens; the cards are modal `ui.dialog`s over the plate.

```
title ──Play/Daily──────────────► play ◄──────────────────────────────┐
  │ Journey ► journey-info ─Begin─┘   ├─ pause (Resume, Restart, Settings, Resign, Quit to Title)  │
  │ Profile ► profile-info           ├─ results / lesson (Replay or Next lesson, Next stage?, Back to Modes, Title) │
  │ Settings ► settings card         └─ settings card (from pause)                                  │
  └─(journey-info / profile-info) Back to Modes ► modes ─► learn / journey-info / daily / practice-info / challenge-info / score-chase-info
```

- **Title** (css/menu.css's look): the key art fills the window (cover) with its slow 40 s drift (stilled on the Low and Balanced looks, whose Ambient motion is static, and by reduced motion), the left-to-right vignette (a bottom-up one on phones), then the kicker, the name (73.6 px, measured to fit), the amber rule, the tagline, the account line, **Play** and the secondary grid: Daily Challenge, Journey, Profile, Settings, and Sign in with StarHermit (signed out) or Invite a friend (signed in), the odd last one spanning the row. Desktop: a 600 px column at the left, vertically centred; phone width (≤ 760 px): the column across the bottom; short landscape (≤ 500 px tall): compact type and a three-column grid. The column scrolls when it cannot fit. The secondary buttons are frosted glass on the High and Ultra looks only.
- **Modes**: six buttons with one-line descriptions (wrapping on phones). Reached from Journey or Profile via **Back to Modes**, or from results.
- **Info panels**: Journey (stage n of 40, cleared count, stars), Practice (three preset buttons with board summary), Challenge (six cards with their intro beside them, or below on phones, and local best), Score Chase (intro + local best), Profile (rounds, wins, arrows launched, best combo, achievements n/9). Pages are 1180 px wide at most, 24/32 px padding (16/14 on phones), scrolling.
- **Play**: the plate fills the window; the mode + stage title and the intro / lesson text wrap above it; the caption line, the status line (Score · arrows left · mistakes · time · limit · plate) and the action buttons (wrapping rows) sit below it. On a short landscape screen the title column is at the left and the caption, status and a column of actions at the right, the plate between them at nearly the full height. The camera is fitted (`render.frameBoard`) so the whole plate sits in the free part of the window, at most 760 logical px.
- **Results**: headline ("Plate cleared!", "No clear paths left", "Time's up", "Round resigned") as the card's title, illustration (cleared / locked), breakdown rows (Exits, Best combo, Flawless bonus, Time bonus, Plates cleared, Mistakes, Time, Total), the leaderboard line when signed in, buttons; Replay has focus. A lesson's goal shows the lesson card (Lesson complete, the lesson title, Next lesson) 0.7 s after it is reached.
- **Settings** (from the title or the pause card): Visual theme (themes above the player's stars are listed disabled with "unlock at n stars"), Captions for sound cues, **Sound, graphics and more…** (opens the runtime's Options: volumes and mute, graphics level and frame-rate limit, language, controls, accessibility), Close.
- **Toast** at the bottom for invite, sign-out and similar notices, also announced to screen readers.

## 8. Art direction

**Palette (`tools/ui-style.css` `:root`, tokens)**: bg `#0f1216`, panel `#1a1e24`, panel2 `#232830`, line `#39414d`, text `#eef1f5`, muted `#aab3bf`, accent amber `#f2b04e`, accent2 teal `#7fd4c1`; buttons `#2c333d` / hover `#39424e`. High contrast is the runtime's (Options › Accessibility), which forces its own colours over the styles.

**Themes (content.js `THEMES`, applied by `render.setTheme` from the Settings choice)**:

| Theme | plate | cell | enamel (single) | enamel2 (big) | bolt | key light | background |
|---|---|---|---|---|---|---|---|
| Foundry Plate | `#2a3038` | `#232932` | `#f2b04e` | `#7fd4c1` | `#59687c` | `#ffe0b0` | `#14171d` |
| Glacier Mill | `#39424e` | `#303947` | `#9fd8f0` | `#f0c987` | `#6d7f94` | `#d8f0ff` | `#10161e` |
| Verdigris Works | `#2e3d3a` | `#27342f` | `#7fd4c1` | `#e8b04e` | `#5d7a70` | `#d0ffe8` | `#101814` |
| Ember Forge | `#3a2c28` | `#32251f` | `#f08a4e` | `#f0d8a0` | `#7a5f52` | `#ffc890` | `#18100d` |
| Porcelain Bench | `#8a8f96` | `#7d828a` | `#2e6fe4` | `#e4572e` | `#4e545e` | `#fff2dd` | `#3a3e45` |

**Shape language.** Everything is procedural (`render.geoCache`, `geometry.ts`): a rimmed plate with four hex studs, recessed 0.96-unit cell inlays, 0.92-unit bevelled tiles with an enamel cap and an extruded metal chevron (big tiles span two cells with two chevrons), hex bolt heads with a slot, five seeded metal ingots on the workbench. Direction is carried by chevron geometry, never colour. Single arrows are `enamel`, big arrows `enamel2`. Materials: plate roughness 0.45 / metalness 0.75, enamel roughness 0.3 / metalness 0.05, bolts metalness 0.85; chevrons are near-black gunmetal when reflections are on. ACES tone mapping, exposure 1.05. Lights (three.js intensities ÷ π): warm directional key (4, 8, 5) with soft shadows, hemisphere fill, theme-accent rim.

**Hero.** The plate. The camera looks from a raised three-quarter view (36° FOV, the browser build's direction) and is moved and pulled back until the plate fits the free part of the window; it never orbits.

**Typography.** The runtime's system UI face, 16 px base, headings 700 weight; the player's text size and interface size apply on top.

**Motion.** Tween manager with authored easings. Launch: 0.5 s ease-in slide off the plate with a small arc and spin, sparks at the edge, camera shake 0.04 (0.08 big). Blocked: 0.3 s perpendicular shake. Drop-in: 0.35 s ease-out fall for new waves. Win: gold burst (`#ffd070`), shake 0.12. Free markers pulse ±12 %. Hint ring `#7fb0ff`. **Reduced motion** (the runtime's preference): pieces vanish instantly, no drop-in, no shake, no pulse, no dust motes, lamp shimmer or title drift; event timing is unchanged.

**Graphics.** The runtime's Options › Graphics chooses the graphics level (Auto from the GPU, or one of ten); its quality tier picks one of the browser build's presets (`js/gfx.js`), and the level's speed within the tier scales the sparks (× 1.64 per level above the tier's first, at most 4×, never past the pool). The runtime owns render scale, pixel-ratio cap, adaptive resolution, the frame-rate limit and the shadow-map and MSAA caps. Per preset: image-based light from a studio environment prefiltered once (`reflections`; the hemisphere fill drops from 0.55 to 0.2); surface detail (procedural brushed-steel colour/roughness maps on the plate, rim and bolts, fine grain on cells, clearcoat enamel, a lamp-pool workbench texture); key-light shadows at 1024/2048/4096²; `renderer.ao` (GTAO, 8/16 samples), `renderer.bloom` (strength 0.45, threshold 1.6, so only the HDR free-marker dots (×5) and sparks (×4) bloom), `renderer.grade` (display-space S-curve contrast, saturation 1.1, cool shadows / warm highlights, vignette 0.26) and `renderer.antialias` (MSAA / FXAA / SMAA); sparks (high: additive glow; low: a third of them); ambient motion (dust motes and a ±3 % key-light shimmer).

| Tier (levels) | Shadows | AO | Bloom / grade | AA | Reflections / detail | Meshes | Materials | Textures | Sparks per launch / win | Pool | Motes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Low (quantum, atomic) | off | off | off | MSAA | off / plain | lite | Lambert | none | 6 / 24 | 160 | 0 |
| Balanced (molecular, cellular) | 1024² | off | on | FXAA | on / detailed | standard | Standard / Physical | 128 / 64 / 256 px | 10 / 45 | 240 | 30 |
| High (terrestrial–stellar) | 2048² | on | on | SMAA | on / detailed | standard | Standard / Physical | 256 / 128 / 512 px | 18 / 90 | 400 | 70 (animated) |
| Ultra (galactic–infinite) | 4096² | high | on | MSAA | on / detailed | rich | Standard / Physical | 512 / 256 / 1024 px | 28 / 140 | 800 | 140 (animated) |

Changes apply live (`render.applyLook` each frame, rebuilding materials, meshes and the board only when the look changed). Gameplay, picking and what is on the plate are identical on every tier.

**Visual assets**: title key art (`assets/key-art.webp`), results illustrations for cleared and locked plates (`assets/plate-cleared.webp`, `assets/no-lanes.webp`), store cover, icon. See §15.

## 9. Audio direction

**Mix.** The runtime's buses and Options › Audio (volumes, mute, voice limit, mute when unfocused): clips play on `effects` at 0.9 (the browser build's default effects level), the UI tap and cursor tick on `interface`, the bed on `music`. Ambience is a looped low-passed (260 Hz) brown-noise room tone at 0.16; music is a generative pad: a four-chord walk (A–C–E, F–A–C, G–B–D, D–A–D) at half pitch through a 640 Hz low-pass, one 6.6 s swell every 5.2 s, at 0.03. Both are rendered once into clips (`createClip`, 8 kHz, a clip a frame) and start when the mixer runs (natively at once; in a browser after the player's first press); the clips load at that moment too, as the browser build fetched its samples after the audio unlock. Captions (Settings) print each cue's text on the caption line for 1.8 s and announce it.

**SFX event table** (`sfx/manifest.*`; all clips MOSS-SFX v2.0, 48 kHz mono Opus):

| Event id | File | Sound | Usage |
|---|---|---|---|
| `ui` | ui-tap.opus | soft plastic button tap | every button press |
| `cursor` | cursor-tick.opus | tiny wooden tick | focus ring moved |
| `launch` | arrow-launch.opus | thin metallic zip and whoosh | single arrow exits |
| `launch-big` | big-arrow-launch.opus | heavy steel whoosh | big arrow exits |
| `blocked` | lane-blocked.opus | dull metal rattle clunk | blocked tap (counted mistake) |
| `invalid` | invalid-buzz.opus | low double buzz | command rejected outright |
| `combo` | combo-chime.opus | rising glass chime | layered on exits at combo ≥ 2 |
| `wave` | new-plate.opus | plate sliding in and settling | Score Chase next wave |
| `win` | plate-cleared.opus | short bell arpeggio | plate cleared |
| `lose` | round-lost.opus | descending tone with thud | lock-up, time up, resign |
| `undo` | undo-swish.opus | reverse swish | undo |
| `hint` | hint-sparkle.opus | two-note sparkle | hint ring shown |
| `star` | star-twinkle.opus | crystalline ding | achievement unlocked; lesson goal reached |
| `time-warning` | time-warning.opus | two low relay ticks | once at 10 s left on timed plates |

## 10. Localization

Nine locales ship for all player-facing text: **en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT** (`js/strings.js`: menus, mode descriptions, HUD, cards, settings, captions, account and leaderboard lines (`p.*`), and the content names and texts: 40 Journey stages, 6 Challenges, 3 Practice presets, Score Chase, Daily, 6 Learn lessons, 5 themes; `content.js` keeps the English data and the controller looks names up by id).

- **Language**: the runtime's interface language (`preferences().language`: the player's choice in Options › Language, else the account's or the device's), mapped to the nearest shipped locale (`es-MX → es-419`, `en-AU → en-GB`, `fr → fr-FR`, `pt-PT → pt-BR`). A change shows on the next frame; the round, its clock and the plate keep running, and an open results card does not post again.
- Regional variants: es-ES "Pulsa/Intro" and "Hora punta", es-419 "Toca/Enter" and "Hora pico"; fr-CA "Pointage"; en-GB shares the en-US text.
- Layout allowances: button rows wrap by measured width; a button whose label is wider than its column wraps its label; cards scroll when taller than the window.

## 11. Accessibility

- **Keyboard and gamepad**: every screen is `starhermit:ui` widgets (Tab / arrows / Enter, D-pad / South / East, focus ring); in play the arrow keys or D-pad move the plate's focus ring and Enter / South launch (§6).
- **Screen readers**: widgets carry their accessible names; the round's title and intro, each focus-ring move, captions and toasts are announced (`ui.announce`).
- **Captions**: Settings → "Captions for sound cues" (§9).
- **The runtime's settings**: interface and text size, high contrast and reduced motion (Options › Accessibility) apply to every screen; reduced motion also stills the plate (§8). Direction is geometry; single vs big arrows differ by size and chevron count as well as colour.
- **Targets**: buttons ≥ 44 px tall; tiles are 0.92 cell wide, about 60 px on a 5×5 plate on a phone but smaller on 7×7 plates (§16).

## 12. StarHermit integration

- **Manifest** `starhermit.txt`: `name`, `description`, `owner`, `server=score-script.js`, `version=1.0.0`, `contentVersion=1`, `cover=cover.jpg`, `launch=index.html`, `engine.api=1`, `engine.entry=src/main.ts`, `engine.version=1.19.1`, `engine.minor=15`, `engine.capabilities=platform,storage,clipboard`, eight `control.*` actions with their `engine.gamepad.*` defaults.
- **Platform script** `score-script.js`: a practice session that accepts `{type:'result', scores}`, range-checks each score against its board and posts it.
- **Leaderboard**: one board, `high-score` (integer, higher is better, 0–10,000,000). When signed in, every finished Journey, Daily, Challenge or Score Chase round (won, locked, timed out or resigned) post the total (`online.submitScore`: `sessions.practice()`, `connectGame`, `{type:'result'}`, the script's `result-ack`), and the results card shows "Leaderboard rank: #N" (or "Score posted / not posted to the leaderboard."). Practice rounds and lessons post nothing; a guest makes no request.
- **Identity**: `player()`; the title's account line reads "Playing as <nickname> · progress synced / saving… / cloud sync unavailable", or "Offline — progress is stored on this device." for a guest. Signing in is the runtime's: **Sign in with StarHermit** calls `requestSignIn()` (its Account dialog); in the StarHermit client the player is signed in from the start. When the session ends (`onSessionEnded`) the line and a toast read "Signed out of StarHermit — progress stays on this device." and play goes on.
- **Save**: the progress document (`{ v, progress }`: Journey stars and bests, Challenge bests, dailies, Score Chase best, finished lessons, achievements, lifetime stats) is the engine save (`saves`): on the device at once, in the account's cloud slot when signed in. When the account holds another device's save, `onConflict` merges both (`AXStore.mergeDocs`: more stars, higher bests, union of lessons and achievements at the earliest unlock, the larger of each counter).
- **Browser-build saves**: the cloud slot `game:<slug>` the JS SDK wrote (a ZIP with `save.json` holding `{ sum, payload }`) shows as foreign; it is parsed (`AXStore.loadRaw`), merged into the device's progress, its theme and captions taken over unless set since, and saved over the slot once (`replaceForeign`). The browser build's per-player settings keys (its whole settings object) are read as legacy settings: theme and captions are kept, the rest (volumes, mute, graphics, reduced motion, contrast, text size, unused assists) are the runtime's now, and all are removed from the account. A guest's old browser localStorage progress cannot be read by the engine.
- **Game settings**: `theme` and `captions` are `settings` keys (`game.theme`, `game.captions`), kept with the account when signed in.
- **Invite**: when signed in, **Invite a friend** copies `inviteLink()` to the clipboard (`clipboard` capability) and confirms with a toast (or shows the link when copying fails).
- **Reports, language, sound, graphics, controls**: the runtime's Options (no game panels).
- **Not used**: matchmaking, multiplayer sessions, chat, replays, server achievements.
- **Local records**: achievements (9 stable keys: `first-exit`, `first-win`, `flawless`, `combo-8`, `journey-half`, `journey-done`, `daily-7`, `score-3000`, `exits-500`) unlock idempotently in `recordResult` and live in the save; so do personal bests per Journey stage, Challenge, Daily date and Score Chase. `store.js` still carries its local leaderboard tie-break, which the UI does not read.

## 13. Technical architecture

- **Modules**: `src/main.ts` (entry) imports `game.ts`, `render.ts`, `screens.ts`, `save.ts`, `online.ts`, `audio.ts`, `i18n.ts`, `look.ts`, `style.ts`; `screens.ts` reads `game.ts`, which never imports the screens (no module cycle). The browser build's pure scripts load as classic scripts (`loadClassic`: `rng.js`, `store.js`, `rules.js`, `content.js`, `gfx.js`, `strings.js`) and are the same files the Node tests run.
- **rules.js** is side-effect free; snapshots are cloned via JSON so `applyCommand` never mutates its input; `hashState`, `serialize` / `deserialize` and command validation are unchanged.
- **Controller** (`game.ts`): `round` holds `cfg, ctx, state, history[], startMs, pausedTotal, pausedAt, endMs, cursor, over, timedOut, warned, lesson, lessonCount, lb, showAt`; command ids `c<n>` are monotonic. The clock is game time (`frame().time`), checked each frame (the browser build's 250 ms timer): the 10 s warning, and the resign at the limit. Pause is clock accounting, so the rules never see paused time.
- **Renderer** (`render.ts`): consumes `(state, events, instant, freeIds)` in `syncState`, reconciles meshes to the snapshot (undo, waves) and animates only the differences. The scene draws only on the play screen (`renderer.camera` is null elsewhere).
- **The frame** (`onUpdate`): the look for the graphics level, the clock, the beds, the UI (which also fits the camera to the HUD's free area), then tweens, particles, motes and the camera.
- **Budgets**: one mesh per tile part (≈3–4 per piece), one instanced stud mesh, one particle `Points`; no per-frame allocation in the tween or particle loops; `dt` capped at 50 ms.

## 14. Testing and acceptance criteria

`npm test` = `npm run test:unit` + `npm run test:native` (set `STARHERMIT` to the 1.19.1 runtime).

- **Unit** (Node, no dependencies): `tests/rules.test.mjs` (deterministic replay hash for Journey 1; win after the solver's order; rejections without mutation; all 40 Journey stages, 6 Challenges, 3 Practice presets and 14 dailies solvable; Score Chase reaches wave 12; lesson fixtures solvable; save migration; serialize round-trip; tie-break order), `tests/gfx.test.mjs` (tier → preset rows, monotonic budgets, level scaling capped), `tests/i18n.test.mjs` (the nine locales; every locale has every key with the same placeholders; every literal key the TypeScript client uses exists), `tests/save.test.mjs` (a browser-build cloud save parses and merges, corrupt slots are ignored, engine saves merge on a conflict).
- **Native** (`tests/native.mjs`): the committed web index matches the files (`npm run package` ran after the last change); `starhermit check .` with no warnings; every `tests/native/*.play` as a signed-out offscreen render check driving the real UI: `journey.play` (Play, Journey 1 cleared by keyboard in the solver's order, the results card with its flawless bonus, Next stage, the pause card, Quit to Title) and `learn.play` (Journey panel → Back to Modes → Learn, lesson 1 to the lesson card, Next lesson, a hint, Restart, Esc to the pause card, the Settings card with Captions, Close, Resign to the results card, Back to Modes).
- **Browser** (`npm run test:browser`, `tests/browser.mjs`, after `npm run package`): the loader in headless Chrome at 1366×768 and at 390×844 @3× with touch: the engine starts, the title shows, Tab + Enter starts Journey 1, a hint, a tap or click on the plate, and the stage played by keyboard; any page error, failed request or console error or warning fails it, except headless Chrome's software-GPU and missing-audio-device noise. `node ~/games/tools/engine-web-smoke.mjs .` checks the loader at both viewports.
- `npx tsc -p .` (TypeScript 5.9 against `starhermit types .`'s declarations) reports no errors.

QA bar: every button on every screen is reachable by click, touch, Tab and the gamepad; HUD, plate and card buttons fully visible at 390×844 portrait and 844×390 landscape; a new player reaches the first launch within two inputs (Play, tap).

## 15. Asset inventory

| Path | Purpose | Source |
|---|---|---|
| `assets/key-art.webp` | Title background (cover) | FLUX.2 klein, 1200×672, seed 2712 |
| `assets/plate-cleared.webp` | Results illustration on wins and lesson completion | FLUX.2 klein, 640×400, seed 4101 |
| `assets/no-lanes.webp` | Results illustration on lock-up | FLUX.2 klein, 640×400, seed 4102 |
| `assets/ui-style.json` | The UI styles, from `tools/ui-style.css` (`npm run css`) | converted |
| `cover.jpg`, `coverart.png` | Store cover | key art |
| `icon.png`, `favicon.png` | Launcher icon | hand-authored |
| `sfx/*.opus` ×14 | Event clips (§9) | MOSS-SFX v2.0 |

All 3D geometry and surface textures are procedural.

## 16. Known limitations

- Dailies derive the date from the device's UTC clock; a wrong clock plays a different day's plate.
- The Modes screen has no direct button on the Title screen (reached via Journey/Profile → Back to Modes); **Begin Profile** on the Profile panel returns to the Title.
- A level's `theme` field is content metadata only; the renderer always uses the Settings theme.
- Time-outs end as terminal reason `resigned` (the controller resigns at the limit).
- The tutorial's `t3` lesson text says the blocked tap "explains itself"; the explanation is the shake, the caption (if captions are on) and the mistake counter.
- 7×7 tiles fall below the 44 px touch-target guideline on 390 px-wide phones.
- The browser build's own sound sliders (music / effects / ambience / voice) and mute are the runtime's bus volumes and mute; its synthesized fallback cues (heard while a sample loaded) are not played: until the clips load after the first press, cues are silent.
- A guest's browser-build localStorage progress does not carry over (cloud saves do).
