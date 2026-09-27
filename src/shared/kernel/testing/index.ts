// Test doubles for kernel ports. Only test files may import this (lint-enforced).
import type { Clock } from "../clock";
import type { UnitOfWork } from "../unit-of-work";

/** A clock stuck at one instant. */
export function fixedClock(at: Date | string): Clock {
  const instant = new Date(at).getTime();
  return { now: () => new Date(instant) };
}

/** A clock that only moves when the test says so. */
export function manualClock(start: Date | string): Clock & {
  advanceBy(milliseconds: number): void;
  set(to: Date | string): void;
} {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advanceBy: (milliseconds) => {
      current += milliseconds;
    },
    set: (to) => {
      current = new Date(to).getTime();
    },
  };
}

/**
 * Runs work against in-memory services with no transaction. It does NOT roll back:
 * rollback behaviour is covered by the Drizzle unit-of-work integration tests.
 */
export function inMemoryUnitOfWork<Services>(services: Services): UnitOfWork<Services> {
  return { run: (work) => work(services) };
}
