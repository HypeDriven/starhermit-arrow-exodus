// Sound, ported from the browser build's js/audio.js onto the engine's mixer:
// the authored one-shots (sfx/<name>.opus, see sfx/manifest.json) per logical
// event, the quiet machine-shop room tone and the slow generative pad. The runtime's Options ›
// Audio owns the volumes and mute (the browser build's Music / Effects /
// Ambience / Voice sliders and Mute): events play on "effects", the UI tap and
// cursor tick on "interface", the pad and room tone on "music", each at the
// level the browser build's default bus volume gave it. Captions name each
// cue in the caption line when the game's Captions setting is on.
import { OfflineAudioContext, context, createClip, loadClip, play as playClip, type AudioClip } from "starhermit:audio";

const SAMPLES: Record<string, string> = {
  ui: "ui-tap", cursor: "cursor-tick", launch: "arrow-launch", "launch-big": "big-arrow-launch",
  blocked: "lane-blocked", invalid: "invalid-buzz", combo: "combo-chime", wave: "new-plate",
  win: "plate-cleared", lose: "round-lost", undo: "undo-swish", hint: "hint-sparkle",
  star: "star-twinkle", "time-warning": "time-warning",
};
/** The caption key (js/strings.js 'cap.*') of the cues the browser build captioned. */
const CAPTIONS: Record<string, string> = {
  launch: "cap.launch", "launch-big": "cap.launchBig", blocked: "cap.blocked", invalid: "cap.invalid",
  wave: "cap.wave", win: "cap.win", lose: "cap.lose", undo: "cap.undo", hint: "cap.hint", "time-warning": "cap.warning",
};
const INTERFACE = new Set(["ui", "cursor"]);
// The browser build's default bus volumes (effects 0.9, music 0.6, ambience 0.5).
const EFFECTS = 0.9, MUSIC = 0.6, AMBIENCE = 0.5;

const clips = new Map<string, AudioClip>();
let captionFn: ((key: string) => void) | null = null;

/** Loads every clip and renders the beds at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const file of new Set(Object.values(SAMPLES))) {
    loadClip(`sfx/${file}.opus`).then((c) => { clips.set(file, c); }, (e: unknown) => console.warn(`sfx ${file}: ${String(e)}`));
  }
  Promise.all([renderRoom(), ...CHORDS.map(renderChord)]).then(([room, ...chords]) => { roomClip = room; chordClips = chords; },
    (e: unknown) => console.warn(`beds: ${String(e)}`));
}
export function setCaptions(fn: ((key: string) => void) | null): void { captionFn = fn; }

// -- the room tone and the pad, rendered into clips ------------------------------------------
// The browser build made both with Web Audio nodes; here each is rendered once
// offline, with the same oscillators, filters and envelopes. The browser
// build's synthesized fallback cues (played while a sample loaded or after it
// failed) are not ported.
// 8 kHz: both stay below 700 Hz after their filters.
const RATE = 8000;
const SOFT_Q = -3.01; // Q in dB, as Web Audio's lowpass: linear 0.707
/** One pad chord: three voices (a triangle under two sines) an octave down,
 * lowpassed at 640 Hz, fading in over 1.8 s and out by 6.4 s. */
async function renderChord(notes: readonly number[]): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(6.6 * RATE), RATE);
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 640; lp.Q.value = SOFT_Q;
  const env = off.createGain();
  env.gain.setValueAtTime(0, 0); env.gain.linearRampToValueAtTime(0.05, 1.8); env.gain.linearRampToValueAtTime(0, 6.4);
  notes.forEach((freq, v) => {
    const osc = off.createOscillator();
    osc.type = v === 0 ? "triangle" : "sine"; osc.frequency.value = freq * 0.5;
    osc.connect(lp); osc.start();
  });
  lp.connect(env).connect(off.destination);
  return createClip(await off.startRendering());
}
/** The machine-shop room tone: brown noise lowpassed at 260 Hz, a seamless 2 s
 * loop (filtered periodic noise is periodic once settled). */
async function renderRoom(): Promise<AudioClip> {
  const n = 2 * RATE, settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ color: "brown", seed: 12345, seconds: 2 });
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 260; lp.Q.value = SOFT_Q;
  noise.connect(lp).connect(off.destination); noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}

/** Plays a logical event's cue. */
export function play(name: string): void {
  const cap = CAPTIONS[name];
  if (cap && captionFn) captionFn(cap);
  const file = SAMPLES[name];
  const clip = file ? clips.get(file) : undefined;
  if (clip) {
    try { playClip(clip, { bus: INTERFACE.has(name) ? "interface" : "effects", gain: EFFECTS }); }
    catch { /* the mixer is full this frame: skip it */ }
  }
}

// -- the beds (from the start, as the browser build's audio unlock started them) ---------------
let wantBeds = false;
let started = false;
let chord = 0;
const CHORDS: readonly (readonly number[])[] = [
  [220.0, 261.63, 329.63], // A C E
  [174.61, 220.0, 261.63], // F A C
  [196.0, 246.94, 293.66], // G B D
  [146.83, 220.0, 293.66], // D A D
];
let roomClip: AudioClip | null = null;
let chordClips: AudioClip[] = [];
function schedulePad(): void {
  const clip = chordClips[chord++ % chordClips.length];
  if (clip) try { playClip(clip, { bus: "music", gain: MUSIC }); } catch { /* the mixer is full */ }
}
/** Starts the beds once the mixer runs (natively at once; in a browser after the first press). */
export function startBeds(): void {
  wantBeds = true;
  pollBeds();
}
/** Called each frame: starts the beds once the mixer runs and they're rendered. */
export function pollBeds(): void {
  if (!wantBeds || started || context.state !== "running" || !roomClip) return;
  started = true;
  try { playClip(roomClip, { bus: "music", loop: true, gain: 0.32 * AMBIENCE }); } catch (e) { console.warn(`beds: ${String(e)}`); return; }
  schedulePad();
  setInterval(schedulePad, 5200);
}
