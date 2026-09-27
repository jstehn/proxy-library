// Real implementations of kernel ports that touch the outside world (the system clock,
// the OS random source). Only composition roots import these.
import type { Clock } from "@/shared/kernel";

export function systemClock(): Clock {
  return { now: () => new Date() };
}

/** 128 bits from the OS CSPRNG as hex; feed to `seededRng` and store with the opening. */
export function randomSeed(): string {
  const words = crypto.getRandomValues(new Uint32Array(4));
  return Array.from(words, (word) => word.toString(16).padStart(8, "0")).join("");
}

/** Wait for real. Only composition roots pass this in; tests pass a fake that moves a manual clock. */
export function realSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
