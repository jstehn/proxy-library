"use client";
// Opening sounds, made with the Web Audio API: no sound files (design doc 08, rule 6).
// A sound is a few "nodes" wired together: a source (noise or a tone), a filter that shapes it,
// and a gain (volume) that fades it in and out. Browsers only allow audio after a click, so the
// AudioContext is created on the first sound, which always follows a click.
import { useCallback, useSyncExternalStore } from "react";
import { seededRng } from "@/shared/kernel";
import type { HitLevel } from "./machine";

export type Sounds = Readonly<{
  tear(): void;
  flip(): void;
  hit(level: Exclude<HitLevel, "none">): void;
}>;

/** A buffer of white noise. The kernel's seeded generator is fine for this: it's not a game roll. */
function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * seconds),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  const rng = seededRng("noise");
  for (let index = 0; index < samples.length; index++) samples[index] = rng.next() * 2 - 1;
  return buffer;
}

/** Volume that jumps to `peak` and fades to silence over `seconds`, starting at `start`. */
function envelope(context: AudioContext, start: number, peak: number, seconds: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  gain.connect(context.destination);
  return gain;
}

function tone(
  context: AudioContext,
  frequency: number,
  start: number,
  seconds: number,
  peak: number,
) {
  const oscillator = context.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.value = frequency;
  oscillator.connect(envelope(context, start, peak, seconds));
  oscillator.start(start);
  oscillator.stop(start + seconds);
}

function noise(
  context: AudioContext,
  options: { seconds: number; peak: number; filter: BiquadFilterType; from: number; to: number },
) {
  const now = context.currentTime;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context, options.seconds);
  const filter = context.createBiquadFilter();
  filter.type = options.filter;
  filter.frequency.setValueAtTime(options.from, now);
  filter.frequency.exponentialRampToValueAtTime(options.to, now + options.seconds);
  source.connect(filter);
  filter.connect(envelope(context, now, options.peak, options.seconds));
  source.start(now);
}

// Note frequencies in hertz.
const E5 = 659.25;
const G5 = 783.99;
const B5 = 987.77;
const C6 = 1046.5;
const E6 = 1318.51;

/** The opening sounds, or null where the browser has no Web Audio. */
export function makeSounds(): Sounds | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  let context: AudioContext | null = null;
  const audio = () => (context ??= new AudioContext());

  return {
    tear() {
      // A rip: noise through a band-pass filter sweeping down.
      noise(audio(), { seconds: 0.45, peak: 0.5, filter: "bandpass", from: 4000, to: 500 });
    },
    flip() {
      // A card snap: a very short burst of high noise.
      noise(audio(), { seconds: 0.07, peak: 0.35, filter: "highpass", from: 2500, to: 1800 });
    },
    hit(level) {
      const now = audio().currentTime;
      const notes = level === "mythic" ? [E5, G5, C6, E6] : [E5, B5];
      notes.forEach((frequency, index) => tone(audio(), frequency, now + index * 0.11, 0.6, 0.18));
    },
  };
}

const MUTED_KEY = "tcg.opening.muted";
const listeners = new Set<() => void>();
let mutedInMemory = false; // used when the browser blocks storage (private windows)

function readMuted(): boolean {
  try {
    const stored = window.localStorage.getItem(MUTED_KEY);
    return stored === null ? mutedInMemory : stored === "true";
  } catch {
    return mutedInMemory;
  }
}

function subscribeToMuted(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener); // another tab changed it
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Whether sound is muted, remembered in this browser. `useSyncExternalStore` reads a value that
 * lives outside React (here, localStorage) and re-renders when it changes. The server always
 * renders "not muted", since it can't see the browser's storage.
 */
export function useMuted(): [boolean, () => void] {
  const muted = useSyncExternalStore(subscribeToMuted, readMuted, () => false);
  const toggle = useCallback(() => {
    mutedInMemory = !readMuted();
    try {
      window.localStorage.setItem(MUTED_KEY, String(mutedInMemory));
    } catch {
      // Storage blocked: the in-memory value still works until the page is closed.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [muted, toggle];
}

function subscribeToMotion(listener: () => void): () => void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Whether the viewer asked their system for less motion (design doc 08, rule 5). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}
