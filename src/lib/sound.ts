/**
 * Little chiptune sound effects, synthesized with the Web Audio API (no audio
 * files). Muting is remembered on this device. Browsers only allow sound after
 * the first tap or key press on the page, so nothing plays before that.
 */
import { useSyncExternalStore } from "react";
import type { ResultTier } from "../../lib/game/scoring";

const MUTE_KEY = "bibledive:muted";

// ───────────────────────── mute setting ─────────────────────────

let muted = (() => {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

export function setMuted(value: boolean) {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
  if (!value) void audio()?.resume();
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
    () => false,
  );
}

// ───────────────────────── the synth ─────────────────────────

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  return ctx;
}

// Unlock audio on the first interaction (browsers block it until then).
if (typeof window !== "undefined") {
  const unlock = () => {
    const c = audio();
    if (c && c.state === "suspended") void c.resume();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

function tone(freq: number, at: number, dur: number, opts: { type?: OscillatorType; vol?: number; slideTo?: number } = {}) {
  const c = ctx!;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? "square";
  osc.frequency.setValueAtTime(freq, at);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, at + dur);
  const vol = opts.vol ?? 0.5;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(master!);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function noise(at: number, dur: number, vol = 0.3, lowpass = 1800) {
  const c = ctx!;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const gain = c.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(master!);
  src.start(at);
}

/** C major pentatonic, from C5 up: a climb that always sounds happy. */
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];

/** How many notes each landing gets: the rarer the tier, the bigger the fanfare. */
const LANDING: Record<ResultTier, number[]> = {
  miss: [],
  plankton: [0, 2],
  too_clever: [0, 2, 3],
  schooler: [0, 2, 4],
  rare: [0, 2, 4, 5],
  deep_cut: [0, 2, 4, 5, 7],
  one_in_a_million: [0, 2, 4, 5, 7, 8],
};

let lastJoin = 0;

export type Sfx =
  | { name: "lock" }
  | { name: "wrong" }
  | { name: "suggest" }
  | { name: "tick" }
  | { name: "start" }
  | { name: "join" }
  | { name: "zone"; zone: number }
  | { name: "land"; tier: ResultTier };

export function playSfx(sfx: Sfx) {
  if (muted) return;
  const c = audio();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.01;
  switch (sfx.name) {
    case "lock":
      tone(660, t, 0.08);
      tone(990, t + 0.07, 0.12);
      break;
    case "wrong":
      tone(220, t, 0.16, { slideTo: 150, vol: 0.35 });
      break;
    case "suggest":
      tone(880, t, 0.09, { type: "triangle", vol: 0.45 });
      tone(1318.5, t + 0.08, 0.14, { type: "triangle", vol: 0.35 });
      break;
    case "tick":
      tone(1400, t, 0.03, { type: "square", vol: 0.18 });
      break;
    case "start":
      tone(392, t, 0.1, { type: "triangle" });
      tone(587.33, t + 0.09, 0.16, { type: "triangle" });
      break;
    case "join":
      if (performance.now() - lastJoin < 120) return; // a room filling up shouldn't sound like hail
      lastJoin = performance.now();
      tone(740 + Math.random() * 200, t, 0.06, { type: "triangle", vol: 0.25 });
      break;
    case "zone":
      tone(SCALE[Math.min(SCALE.length - 1, sfx.zone + 1)]!, t, 0.12, { vol: 0.3 });
      break;
    case "land": {
      if (sfx.tier === "miss") {
        tone(420, t, 0.4, { type: "triangle", slideTo: 110, vol: 0.4 });
        noise(t + 0.25, 0.35, 0.25, 900); // splash
        break;
      }
      const notes = LANDING[sfx.tier];
      notes.forEach((n, i) => tone(SCALE[n]!, t + i * 0.07, 0.22 + (i === notes.length - 1 ? 0.35 : 0), { vol: 0.35 }));
      if (sfx.tier === "deep_cut" || sfx.tier === "one_in_a_million") noise(t, 0.18, 0.12, 5000); // the flash
      if (sfx.tier === "one_in_a_million") {
        const end = t + notes.length * 0.07;
        [1, 0, 1, 0].forEach((k, i) => tone(SCALE[7 + k]! * 2, end + 0.1 + i * 0.06, 0.08, { type: "triangle", vol: 0.2 })); // sparkle
      }
      break;
    }
  }
}
