# Arrow Exodus — Running Game Design Document

## 1. Overview

**Pitch.** A machined steel plate holds a grid of enamel arrow tiles. Tap any arrow whose lane to the plate edge is clear and it flies off; anything in the lane blocks it. Clear every arrow before the plate locks up.

| | |
|---|---|
| Genre | Single-player direction/removal puzzle (perfect information, deterministic) |
| Players | 1; asynchronous comparison is local-only today (see §12) |
| Session | 30 s (Learn lesson) to ~4 min (7×7 Journey stage); Score Chase runs until the plate locks |
| Platforms | Desktop and mobile browsers with WebGL; a text fallback preserves progress without WebGL |
| Rendering | Three.js (r-module in `vendor/`) scene inside a square canvas; every menu, HUD line and overlay is semantic HTML |
| Version | `starhermit.txt`: `version=1.0.0`, `contentVersion=1` |

File map (everything that ships or tests the game):

| Path | Owns |
|---|---|
| `index.html` | Shell, inline CSS palette, eight `<section class="screen">` panels, script load order |
| `js/rng.js` | mulberry32 PRNG, FNV-1a `hashString`, three derived streams (rules / decor / av) |
| `js/rules.js` | Pure rules: board generation, legality, `applyCommand`, scoring, solver, hints, hashing |
| `js/content.js` | Themes, 40 Journey stages, 6 Challenges, 3 Practice presets, Score Chase ruleset, daily generator, 6 Learn lessons, 9 achievements |
| `js/store.js` | Checksummed localStorage save document, defaults, migration, tie-break sort |
| `js/audio.js` | WebAudio buses, event → clip map with procedural fallback, ambience, generative pad, captions |
| `js/render3d.js` | Three.js plate, tiles, bolts, tweens, particles, dust motes, picking, cursor/hint rings, graphics settings (IBL, shadows, post chain, adaptive resolution) |
| `js/gfx.js` | Pure graphics quality model: presets, categories, GPU detection, `resolve`, `presetTier`, `choosePreset`, `describe` |
| `js/gfx-i18n.js` | Graphics-section strings in the nine required locales |
| `js/game.js` | Controller: screens, rounds, timer, HUD, overlays, settings, results, achievements, input |
| `server.js` | Local static server plus `GET /api/v1/time`; declared as `server=server.js` |
| `sfx/*.opus`, `sfx/manifest.txt` | 13 authored clips and the canonical event binding table (§9) |
| `assets/` | Key art and results illustrations (§8, §15) |
| `coverart.png`, `icon.png`, `favicon.svg` | Store cover (1200×675), 256 px icon, SVG tab icon |
| `tests/rules.test.mjs`, `tests/gfx.test.mjs`, `tests/e2e.mjs` | `npm test` rules + graphics-model suites; Playwright playthrough (`npm run test:e2e`) |
| `vendor/three.module.min.js` | Three.js r160 (MIT) |
| `vendor/addons/` | Three.js r160 (0.160.1) addons: postprocessing passes, shaders, `RoomEnvironment`; mapped as `three/addons/` in the importmap |

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

| Input | Desktop | Mobile | Feedback |
|---|---|---|---|
| Tap an arrow | left click on the tile | single touch on the tile | free: launch tween + sparks + `launch`/`launch-big` (+ `combo` from ×2); blocked: 0.3 s sideways shake + `blocked` + mistake count |
| Move focus ring | Arrow keys (starts at 0,0) | — | white ring on the cell + `cursor` tick |
| Launch focused cell | Enter or Space | — | as tap |
| Hint | H or **Hint (H)** button | button | blue ring 2.6 s + `hint` |
| Undo | U or **Undo (U)** button | button | tile drops back instantly + `undo` |
| Pause | P, Esc, or **Pause (Esc)** | button | overlay; Esc resumes |
| Restart / Replay | button (HUD, pause, results) | button | the same seed is re-dealt in every mode; a fresh Practice or Score Chase board comes from re-entering the mode (seed = `hash(id:sessionId:roundsPlayed)`) |
| Settings | Esc closes | tap Close | focus returns to the opener |

Canvas picking (`render3d.pickPiece`) raycasts only the piece group; tiles mid-flight are ignored so a double tap cannot re-launch. Input is refused while paused, after the round is over, or when the state is terminal (`tapPiece`); there is no animation lock — a new tap during a launch tween is accepted because the logical state is already settled. Every `[data-action]` button plays `ui` before its handler. Hiding the tab pauses the round and suspends audio; returning resumes audio only (the player un-pauses). There is no drag, pinch, or camera gesture; `touch-action: manipulation` on the canvas host suppresses double-tap zoom.

## 7. Screens and UI flow

`showScreen(name)` toggles `display` on the eight `.screen` sections; overlays are `position:fixed` backdrops.

```
title ──Play/Daily──────────────► play ◄──────────────────────────────┐
  │ Journey ► journey-info ─Begin─┘   ├─ pause-overlay (Resume, Restart, Settings, Resign, Quit) │
  │ Profile ► profile-info           ├─ results-overlay (Replay, Next stage?, Back to Modes, Title) │
  │ Settings ► settings-overlay      └─ settings-overlay (from pause)                                 │
  └─(journey-info / profile-info) Back to Modes ► modes ─► learn / journey-info / daily / practice-info / challenge-info / score-chase-info
```

- **Title**: heading, key art (`#title-art`, 16:9, max 640 px), one-line rule, primary **Play**, then Daily / Journey / Profile / Settings.
- **Modes**: six buttons with one-line descriptions. Reached from Journey or Profile via **Back to Modes**, or from results.
- **Info panels**: Journey (stage n of 40, cleared count, stars), Practice (three preset buttons with board summary), Challenge (six cards with intro and local best), Score Chase (intro + local best), Profile (rounds, wins, arrows launched, best combo, achievements n/9).
- **Play**: `#hud-title` (mode + stage), `#hud-subtitle` (intro/lesson text), square `#canvas-host` sized `min(72vh, 100%, 640px)`, `#caption-line` (aria-live), `#hud-status` (Score · arrows left · mistakes · time · limit · plate), action row.
- **Results**: illustration (cleared / locked), headline ("Plate cleared!", "No clear paths left", "Time's up", "Round resigned"), breakdown rows (Exits, Best combo, Flawless bonus, Time bonus, Plates cleared, Mistakes, Time, Total), buttons. Lesson completion reuses the card with the lesson title.

Layout: `.screen` max-width 1180 px, padding 24/32 px; ≤640 px wide → padding 16/14 px, `h1` 1.6 rem, buttons ≥44 px tall. Portrait phone: the canvas is the full width and the action row wraps beneath it; landscape phone: the canvas is 72 vh tall and centred, HUD scrolls below. Modals are `max-width: min(92vw, 480px)`, `max-height: 86vh`, scrollable. The viewport is `viewport-fit=cover`; no safe-area insets are applied (§16). Must never be cut off: the canvas, the four HUD buttons, the results buttons.

## 8. Art direction

**Palette (index.html `:root`)**: bg `#0f1216`, panel `#1a1e24`, panel2 `#232830`, line `#39414d`, text `#eef1f5`, muted `#aab3bf`, accent amber `#f2b04e`, accent2 teal `#7fd4c1`; buttons `#2c333d` / hover `#39424e`; canvas well `#0c0f13`. High-contrast variant: bg `#000000`, panel `#0a0a0a`, panel2 `#141414`, line `#9a9a9a`, text `#ffffff`, muted `#dcdcdc`, accent `#ffd34d`, accent2 `#5ff2d0`.

**Themes (content.js `THEMES`, applied by `render3d.setTheme` from the Settings choice)**:

| Theme | plate | cell | enamel (single) | enamel2 (big) | bolt | key light | background |
|---|---|---|---|---|---|---|---|
| Foundry Plate | `#2a3038` | `#232932` | `#f2b04e` | `#7fd4c1` | `#59687c` | `#ffe0b0` | `#14171d` |
| Glacier Mill | `#39424e` | `#303947` | `#9fd8f0` | `#f0c987` | `#6d7f94` | `#d8f0ff` | `#10161e` |
| Verdigris Works | `#2e3d3a` | `#27342f` | `#7fd4c1` | `#e8b04e` | `#5d7a70` | `#d0ffe8` | `#101814` |
| Ember Forge | `#3a2c28` | `#32251f` | `#f08a4e` | `#f0d8a0` | `#7a5f52` | `#ffc890` | `#18100d` |
| Porcelain Bench | `#8a8f96` | `#7d828a` | `#2e6fe4` | `#e4572e` | `#4e545e` | `#fff2dd` | `#3a3e45` |

**Shape language.** Everything is procedural in `render3d.geoCache`: a rimmed plate with four hex studs, recessed 0.96-unit cell inlays, 0.92-unit bevelled tiles with an enamel cap and an extruded metal chevron (big tiles span two cells with two chevrons), hex bolt heads with a slot. Direction is carried by chevron geometry, never colour. Single arrows are `enamel`, big arrows `enamel2`. Tiles and enamel caps are rounded, bevelled extrusions. Materials: plate roughness 0.45 / metalness 0.75, enamel roughness 0.3 / metalness 0.05, bolts metalness 0.85; chevrons are near-black gunmetal when reflections are on so direction always reads against the enamel. ACES tone mapping, exposure 1.05, sRGB output. Lights: warm directional key (4, 8, 5) with PCF soft shadows (shadow box fitted to the plate and decor in light space), hemisphere fill, theme-accent rim. See **Graphics** below for the quality-dependent effects.

**Hero.** The plate. The camera (`fitCamera`) is authored to frame the whole plate at 36° FOV from a raised three-quarter view; it never orbits.

**Typography.** System UI stack (`-apple-system, Segoe UI, Roboto, …`), 16 px base, 19 px with Larger text; headings 700 weight.

**Motion.** Tween manager with authored easings, no cumulative lerps. Launch: 0.5 s ease-in slide off the plate with a small arc and spin, 18 sparks (8 with low sparks) at the edge, camera shake 0.04 (0.08 big). Blocked: 0.3 s perpendicular shake. Drop-in: 0.35 s ease-out fall for new waves. Win: 90-particle gold burst (`#ffd070`; 30 with low sparks), shake 0.12. Free markers pulse ±12 %. Hint ring `#7fb0ff`. **Reduced motion**: pieces vanish instantly, no drop-in, no shake, no pulse, no dust motes or lamp shimmer; event timing is unchanged.

**Graphics.** Quality-dependent effects (all in `render3d.js`, tiers in `gfx.js`): image-based lighting from a PMREM-filtered `RoomEnvironment` (`reflections`; the hemisphere fill drops from 0.55 to 0.2 when it is on); surface detail (`detail: detailed`) — procedural brushed-steel colour/roughness maps on the plate, rim and bolts, fine grain on cells, clearcoat `MeshPhysicalMaterial` enamel, and a lamp-pool workbench texture on the floor; key-light shadows at 1024/2048/4096² (`shadows`); an EffectComposer chain built only when needed — RenderPass → GTAO (`ao` on/high: 8/16 samples) → UnrealBloom (strength 0.45, threshold 1.6 on HDR input, so only the free-marker dots (×5 HDR) and sparks (×4) bloom) → OutputPass → colour grade with S-curve contrast, slight saturation, warm highlights/cool shadows and a vignette (`grade`) → SMAA or FXAA (`antialias`; MSAA uses a 4-sample render target with post, or canvas MSAA without it); sparks (`particles`: low = 8 per launch / 30 on win, high = 18 / 90 with additive glow); ambient motion (`background: animated`) — 70 dust motes drifting in the lamp light and a ±3 % key-light shimmer, both off under reduced motion; `static` also stops the title key-art drift. Presets: **Low** (DPR ≤ 1, canvas MSAA, no post, no shadows, no IBL — the pre-upgrade look and cost), **Balanced** (DPR ≤ 1.5, 1024² shadows, IBL, detail, bloom, grade, FXAA), **High** (DPR ≤ 2, 2048² shadows, GTAO, SMAA, dust motes), **Ultra** (1.25× scale, 4096² shadows, full GTAO, MSAA). **Auto** (default) reads the unmasked WebGL renderer once (`gpuInfo`): SwiftShader/llvmpipe → Low, discrete GPUs / Apple M → High, else Balanced; touch/mobile devices are capped at Balanced. Pixel ratio = min(DPR, preset cap) × preset scale × render scale × adaptive scale. Adaptive resolution averages 90 frames: > 26 ms steps down 0.1 (min 0.6), < 14 ms steps back 0.05 (max 1). Changes apply live: shadow map size/enable, IBL, materials and the board are rebuilt, the post chain rebuilds on its next frame, and the WebGL renderer is recreated only when canvas MSAA must toggle. If the post chain fails to build or render, the plate renders without it and the Graphics section shows a note (nothing is logged).

**Settings → Graphics** (section at the bottom of the Settings dialog, from Title or Pause): Quality `#set-tier` (Auto (detected: <tier>) / Low / Balanced / High / Ultra); Render scale `#gfx-scale` 50–200 %; one select per category `#gfx-<category>` for shadows, ambient occlusion, bloom, colour grade, anti-aliasing, reflections, surface detail, sparks and ambient motion, each defaulting to "From preset (<tier>)"; Adaptive resolution `#gfx-adaptive` (on); Show frame rate `#gfx-fps` (off; `#fps-meter` top-right shows fps and pixel ratio); a summary line `#gfx-summary` "GPU · cost · W×H px" and the post-processing note `#gfx-note`. Choosing a preset clears the category overrides. Values persist in the save document (`settings.graphicsTier` = preset, `settings.graphics` = overrides, `render_scale`, `adaptive`, `show_fps`; the legacy `medium` reads as Balanced); `body[data-gfx-preset]` reflects the resolved preset. Strings come from `js/gfx-i18n.js` by `navigator.language` (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT; fallback en-US).

**Visual assets the design calls for**: title key art (`assets/key-art.webp`), results illustrations for cleared and locked plates (`assets/plate-cleared.webp`, `assets/no-lanes.webp`), store cover (`coverart.png`), icon and favicon. See §15.

## 9. Audio direction

**Mix.** Four gain buses (`music`, `effects`, `ambience`, `voice`) into a master (`audio.js ensureCtx`); defaults 0.6 / 0.9 / 0.5 / 0.8; Mute zeroes all buses. Audio starts on the first pointer gesture (`AXAudio.start`). Every authored clip plays on `effects`. Ambience is a looped low-passed brown-noise room tone at 260 Hz (workshop hum). Music is a generative pad: a four-chord walk (A–C–E, F–A–C, G–B–D, D–A–D) at half pitch through a 640 Hz low-pass, one swell every 5.2 s. The `voice` bus exists but nothing routes to it. Each event has a procedural fallback (`SFX` map) that plays while the clip is loading or if the fetch fails; synth pitch variants use the seeded AV stream. Captions (Settings) print each cue's short text on `#caption-line` for 1.8 s.

**SFX event table** (source of `sfx/manifest.txt`; all clips MOSS-SFX v2.0, 48 kHz mono Opus):

| Event id | File | Sound | Usage |
|---|---|---|---|
| `ui` | ui-tap.opus | soft plastic button tap | every `[data-action]` press |
| `cursor` | cursor-tick.opus | tiny wooden tick | keyboard focus ring moved |
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
| `time-warning` | time-warning.opus | two low relay ticks | once at 10 s left on timed plates; synth fallback if the clip fails to load |

## 10. Localization

The shipped build is **English only** except the Settings → Graphics section (§8, `js/gfx-i18n.js`, picked from `navigator.language`): `<html lang="en">`, strings hard-coded in `index.html`, `js/game.js` (HUD, results, settings labels) and `js/content.js` (stage names, intros, lesson text, achievements). There is no language switcher and no locale detection. The product requirement — en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT — is listed under Design intent not yet implemented (§16). Layout allowances already in place for expansion: buttons wrap in `.row`, the results card scrolls, the settings rows use `justify-content: space-between` with a flexible label.

## 11. Accessibility

- **Keyboard-only path**: every screen is plain buttons in DOM order; in play the arrow keys move a visible white ring, Enter/Space launches, H/U/P/Esc act; Esc resumes from pause and closes Settings. Focus is visible (`:focus-visible` 3 px teal outline) and Settings returns focus to its opener.
- **Announcements**: `#hud-status` and `#caption-line` are `aria-live="polite"`; results and settings cards are `role="dialog" aria-modal="true"`.
- **Captions**: Settings → "Captions for sound cues" prints the cue text (§9).
- **Contrast and size**: text `#eef1f5` on `#0f1216` (≈16:1); High contrast switches to the black palette; Larger text raises the base to 19 px. Direction is geometry, single vs big arrows differ by size and chevron count as well as colour.
- **Reduced motion**: Settings toggle (also persisted) removes drop-ins, flights, shake and pulses (§8).
- **Targets**: buttons ≥44 px tall on narrow screens; tiles are 0.92 cell wide, about 60 px on a 5×5 plate at the 362 px mobile canvas but only ~38 px (less with foreshortening) on 7×7 plates (§16).
- **No WebGL**: the play screen shows a text notice; menus, settings and progress still work.
- Not provided: a DOM mirror of the board for screen readers (a `boardMirror` setting is stored but unused), gamepad input, hold/toggle or confirm-tap assists (`confirmExits`, `leftHanded`, `haptics`, `colorPalette` are stored defaults with no effect).

## 12. StarHermit integration

Conventions per https://wiki.starhermit.com/.

- **Manifest** `starhermit.txt`: `name=Arrow Exodus`, `launch=index.html`, `owner=<uuid>`, `server=server.js`, `version=1.0.0`, `contentVersion=1`, `cover=coverart.png`.
- **Server script** `server.js`: serves the distribution and answers `GET /api/v1/time` with `{ now, utcDate }`. The client does not yet call it (dailies use the device clock, §16).
- **Used**: `js/platform.js` (host adapter, classic script after `store.js`): reads `#game_token=<jwt>` from the fragment (query fallbacks for local dev, stripped after read), decodes `sub` + `game_scope` (slug never hard-coded), sends `Authorization: Bearer`, re-mints the token every 45 min via `POST /api/v1/games/{slug}/launch-token` (60 s retry on failure), fetches the display name from `GET /api/v1/users/{sub}/profile` (nickname, fallback `Player ` + id8; never `/api/v1/me`, never usernames), and mirrors the save document to the cloud slot `GET/PUT /api/v1/me/cloud-saves/{slug}` (stored-zip + base64, one slot). Remote save wins on load; localStorage stays the offline cache; saves debounce 2 s and flush on `pagehide`/hidden. Not used: leaderboards, achievements API, presence, sessions, rooms, chat. The title screen shows the account line (nickname + sync status).
- **Local stand-ins**: achievements (9 stable keys: `first-exit`, `first-win`, `flawless`, `combo-8`, `journey-half`, `journey-done`, `daily-7`, `score-3000`, `exits-500`) unlock idempotently in `recordResult` and are stored in the save document; personal bests per Journey stage, Challenge, Daily date and Score Chase live in the same document. `store.js` carries a leaderboard tie-break (`sortEntries`: score desc, fewer mistakes, lower duration, session id) and a local board store that the UI does not yet read.

## 13. Technical architecture

- **Load order** (`index.html`): ES module `render3d.js` (imports Three.js) exposes `window.AXRender`; classic scripts `rng.js`, `rules.js`, `content.js`, `store.js`, `platform.js`, `audio.js` define UMD globals; then `game.js` is imported as a module and runs `init()`.
- **rules.js** is browser/Node isomorphic and side-effect free; snapshots are cloned via JSON so `applyCommand` never mutates its input. `hashState` (stable-key JSON + FNV-1a) identifies a state minus its event list; `serialize`/`deserialize` gate on `STATE_VERSION`. `validateCommandShape` bounds command size (512 bytes) and id length for a future network boundary.
- **Replay/determinism**: `createGame(cfg)` + ordered commands reproduce the state hash (`tests/rules.test.mjs`). Elapsed time enters only through quantized `atMs`.
- **Controller** (`game.js`): `round` holds `cfg, ctx, state, history[], startMs, pausedTotal, pausedAt, timerId, cursor, over, timedOut, warned, lesson, lessonCount`; command ids `c<n>` are monotonic. Pause is implemented as clock accounting (`pausedTotal`), so the rules never see paused time.
- **Renderer** (`render3d.js`): consumes `(state, events, instant, freeIds)` in `syncState`; reconciles meshes to the snapshot (undo, waves), animates only the differences. Layers: 0 environment, 1 gameplay, 2 selection (rings, glow dots), 3 effects (pooled 400-point particle system). Raycasts hit layers 1–2 only. Geometry is cached once; materials rebuild per theme; `dispose()` releases GPU resources when a round starts or ends.
- **Graphics settings** (`setGraphics`, `graphicsInfo`; model in `gfx.js`, §8 Graphics): presets and per-category overrides never change rules, picking or what is visible on the plate. The post chain is rebuilt when its key (ao, bloom, grade, antialias, size, pixel ratio) changes and is skipped entirely when empty.
- **Persistence** (`store.js`): `localStorage['arrowexodus.save.v1'] = { sum, payload }` with FNV-1a checksum; a corrupt or future-version document yields a fresh one; partial documents deep-merge defaults; an in-memory fallback keeps the session alive when storage is unavailable.
- **Budgets**: one draw call per tile part (≈3–4 per piece, ≤80 pieces in extreme endless waves), a single instanced stud mesh, one particle mesh; no per-frame allocation in the tween or particle loops; `dt` capped at 50 ms.
- **Module loading**: `render3d.js` imports the addons as `three/addons/…` through the importmap; they import `three`, which resolves to the same `vendor/three.module.min.js` URL, so there is one Three.js instance.
- **E2E driving** (`tests/e2e.mjs`): starts its own static server on an ephemeral port, launches headless Chrome, wraps `AXRules.createGame/applyCommand` read-only for synchronisation, projects board cells to screen coordinates by replicating `fitCamera`, and plays through real clicks, touches and key presses.

## 14. Testing and acceptance criteria

`npm test` → `tests/rules.test.mjs` and `node --test tests/gfx.test.mjs` (no dependencies). The graphics suite checks `detectPreset` on sample GPU strings (software → Low, discrete/Apple M → High, mobile cap), `resolve` with Auto/preset/overrides/invalid tiers/scale clamp, preset-clears-overrides, legacy `medium`, `describe`, and that every locale has every Graphics string. The rules suite verifies: deterministic replay hash for Journey 1; win after the solver's order and `total = exitPoints + perfectBonus`; rejection of unknown piece, null command and blocked exit without mutation; all 40 Journey stages, 6 Challenges, 3 Practice presets and 14 consecutive dailies solvable; Score Chase reaches wave 12; all 6 lesson fixtures solvable; save migration deep-merges stats; serialize round-trip preserves the hash; tie-break order.

`npm run test:e2e` (Playwright + `/usr/bin/google-chrome`) at desktop 1280×800 and mobile 390×844 with touch: title visible → Play → Journey 1 cleared by clicking/tapping visible tiles → "Plate cleared!" → stars persisted; desktop additionally: Next stage → Esc pause/resume → Hint → exit/Undo/re-exit by keyboard → clear stage 2 by keyboard → Modes → Learn lesson 1 complete → Title → Settings change, Esc close, persistence across reload → seeded save boots Journey 12 solvable; both viewports then run the Graphics pass: Settings → Graphics, Low then High (checked via `body[data-gfx-preset]` and the summary), a Bloom override saved, Ultra clears it, a Shadows override + frame-rate toggle, reload keeps them, Play at Ultra shows `#fps-meter`, Pause → Settings → Low switches live, then back to Auto. Any page error or non-GPU console error or warning fails the run. Headless runs use SwiftShader (`--use-angle=swiftshader`), so Auto resolves to Low; under WSL the tests need `DISPLAY` unset (`env -u DISPLAY -u WAYLAND_DISPLAY npm run test:e2e`) or Chrome's GPU process can block on the X socket.

QA bar as checkable statements: every button on every screen is reachable by click, touch and Tab; no console errors or warnings on load or during play at both viewports; HUD, canvas and overlay buttons fully visible at 390×844 portrait and 844×390 landscape; a new player reaches the first launch within two inputs (Play, tap); every mechanic is introduced by an intro line or a Learn lesson before it appears; reduced motion, high contrast and large text survive reload.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/key-art.webp` | Title-screen hero image (`#title-art`) | FLUX.2 klein, 1200×672, seed 2712 | generated in this pass, wired |
| `assets/plate-cleared.webp` | Results illustration on wins and lesson completion | FLUX.2 klein, 640×400, seed 4101 | generated in this pass, wired |
| `assets/no-lanes.webp` | Results illustration on lock-up | FLUX.2 klein, 640×400, seed 4102 | generated in this pass, wired |
| `coverart.png` | Store cover 1200×675 (`cover=` in manifest) | FLUX.2 klein key art (seed 2712), scaled to 1200×675, 256-colour PNG 277 KB | replaced in this pass (previous file was a generic placeholder unrelated to the game) |
| `icon.png`, `favicon.svg` | Launcher icon, tab icon (three enamel arrows) | hand-authored SVG | shipped |
| `sfx/*.opus` ×13 | Event clips (§9) | MOSS-SFX v2.0 | shipped |
| `sfx/time-warning.opus` | 10-second warning | MOSS-SFX | generated in this pass |
| `vendor/three.module.min.js` | Renderer | Three.js | shipped |
| 3D models / character animation | — | — | none needed: all geometry is procedural; no humanoid |

## 16. Known limitations

- No localization beyond the Settings → Graphics section; everything else is English only.
- The title screen has no WebGL renderer (the menu hero canvas has no model), so graphics settings affect the play canvas; on the title only Ambient motion applies (key-art drift).
- Dailies derive the date from the device clock, not `/api/v1/time`; a wrong local clock plays a different day's plate.
- The Modes screen labels Score Chase as local-best only; no global/friends board exists and nothing is submitted anywhere.
- The Modes screen has no direct button on the Title screen (reached via Journey/Profile → Back to Modes); **Begin Profile** on the Profile panel returns to the Title.
- A level's `theme` field is content metadata only; the renderer always uses the Settings theme.
- `server.js` does not refuse `tests/`, `tools/` or dotfiles.
- Settings stored but without effect: `colorPalette`, `leftHanded`, `haptics`, `boardMirror`, `confirmExits`; the `voice` bus has no sources.
- Time-outs end as terminal reason `resigned` (the controller resigns at the limit); only a command arriving after the limit yields `time-up`.
- The tutorial's `t3` lesson text says the blocked tap "explains itself", but the only explanation is the shake, the caption (if captions are on) and the mistake counter.
- No safe-area insets on notched phones; no gamepad; no screen-reader board model.
- 7×7 tiles fall below the 44 px touch-target guideline on 390 px-wide phones; the keyboard path is not available on touch devices.

**Design intent not yet implemented**: the nine required locales with a language switcher; StarHermit daily/score-chase leaderboards and server-side achievements (the tie-break and command validation are ready; achievements stay local inside the cloud-saved doc); server-time daily boundary; a DOM board mirror for screen readers; safe-area padding.

## Browser interference

`browser-guard.js` (loaded from `index.html`) suppresses browser UI that gets in the way of play: the right-click context menu, the iOS long-press callout, copy / cut / paste, and page text selection. Text fields (inputs, textareas, selects, contenteditable) keep normal selection, context menu and clipboard behaviour.
