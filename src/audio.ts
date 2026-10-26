// Sound, ported from the browser build's js/audio.js onto the engine's mixer:
// the authored one-shots (sfx/<name>.opus, see sfx/manifest.json) per logical
// event, the quiet machine-shop room tone and the slow generative pad. The runtime's Options ›
// Audio owns the volumes and mute (the browser build's Music / Effects /
// Ambience / Voice sliders and Mute): events play on "effects", the UI tap and
// cursor tick on "interface", the pad and room tone on "music", each at the
// level the browser build's default bus volume gave it. Captions name each
// cue in the caption line when the game's Captions setting is on.
import { context, createClip, loadClip, play as playClip, type AudioClip } from "starhermit:audio";

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

/** Loads every clip once the mixer runs (natively at once; in a browser after
 * the first press, as the browser build fetched its samples after the audio
 * unlock; the synthesized cues cover the moments before). Loading them while
 * a browser's audio is starting raced its start ("Unknown audio request"),
 * see the port's report. */
let wantSfx = false;
function loadClips(): void {
  for (const file of new Set(Object.values(SAMPLES))) load(file);
}
function load(file: string): void {
  loadClip(`sfx/${file}.opus`).then((c) => { clips.set(file, c); }, (e: unknown) => console.warn(`sfx ${file}: ${String(e)}`));
}
export function loadSfx(): void {
  wantSfx = true;
  pollBeds();
}
export function setCaptions(fn: ((key: string) => void) | null): void { captionFn = fn; }

// -- the room tone and the pad, rendered into clips ------------------------------------------
// The browser build made both with Web Audio nodes; here they are rendered
// once into clips (createClip) with the same oscillators, filters and
// envelopes, because the engine's browser runtime drops clip loads and plays
// in flight while the synthesis graph changes ("Audio output unavailable or
// replaced", "Unknown audio request": see the port's report). For the same
// reason the browser build's synthesized fallback cues (played while a sample
// loaded or after it failed) are not ported: a missing clip is loaded again.
// 8 kHz: both stay below 700 Hz after their filters; rendered a clip a frame.
const RATE = 8000;
/** RBJ biquad lowpass over `x` in place (Web Audio's BiquadFilterNode, Q as linear). */
function lowpass(x: Float32Array, freq: number, q: number): void {
  const w = 2 * Math.PI * freq / RATE, alpha = Math.sin(w) / (2 * q), c = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]!;
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
}
/** One pad chord: three voices (a triangle under two sines) an octave down,
 * lowpassed at 640 Hz, fading in over 1.8 s and out by 6.4 s. */
function chordClip(notes: readonly number[]): AudioClip {
  const n = Math.round(6.6 * RATE);
  const out = new Float32Array(n);
  notes.forEach((freq, v) => {
    const f = freq * 0.5;
    const voice = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ph = (i * f / RATE) % 1;
      voice[i] = v === 0 ? 1 - 4 * Math.abs(ph - 0.5) : Math.sin(2 * Math.PI * ph);
    }
    lowpass(voice, 640, 0.707);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const env = t < 1.8 ? t / 1.8 : t < 6.4 ? 1 - (t - 1.8) / 4.6 : 0;
      out[i]! += voice[i]! * env * 0.05;
    }
  });
  return createClip([out], RATE);
}
/** The machine-shop room tone: brown noise lowpassed at 260 Hz, a seamless 2 s loop. */
function roomClip(): AudioClip {
  const n = 2 * RATE, fade = Math.round(0.25 * RATE);
  const raw = new Float32Array(n + fade);
  let last = 0, seed = 12345;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const w = (seed / 0x7fffffff) * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    raw[i] = last * 3.5;
  }
  lowpass(raw, 260, 0.707);
  const out = raw.slice(0, n);
  for (let i = 0; i < fade; i++) { const k = i / fade; out[i] = raw[n + i]! * (1 - k) + raw[i]! * k; }
  return createClip([out], RATE);
}

/** Plays a logical event's cue (its clip, else the synthesized one). */
export function play(name: string): void {
  const cap = CAPTIONS[name];
  if (cap && captionFn) captionFn(cap);
  const file = SAMPLES[name];
  const clip = file ? clips.get(file) : undefined;
  if (clip) {
    try { playClip(clip, { bus: INTERFACE.has(name) ? "interface" : "effects", gain: EFFECTS }); return; }
    catch { clips.delete(file!); load(file!); } // a clip the mixer lost: load it again
  }
}

// -- the beds (from the start, as the browser build's audio unlock started them) ---------------
let wantBeds = false;
let started = false;
let chord = 0;
const CHORDS = [
  [220.0, 261.63, 329.63], // A C E
  [174.61, 220.0, 261.63], // F A C
  [196.0, 246.94, 293.66], // G B D
  [146.83, 220.0, 293.66], // D A D
];
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
/** Called each frame: starts what waited for the mixer. */
export function pollBeds(): void {
  if (context.state !== "running") return;
  if (wantSfx) { wantSfx = false; loadClips(); }
  if (!wantBeds || started) return;
  try {
    if (!room) {
      room = true;
      playClip(roomClip(), { bus: "music", loop: true, gain: 0.32 * AMBIENCE });
      return;
    }
    if (chordClips.length < CHORDS.length) { chordClips.push(chordClip(CHORDS[chordClips.length]!)); return; }
  } catch (e) { console.warn(`beds: ${String(e)}`); started = true; return; }
  started = true;
  schedulePad();
  setInterval(schedulePad, 5200);
}
let room = false;
