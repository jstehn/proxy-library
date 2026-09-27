/**
 * Port for the current time. Code never calls `new Date()` directly: it receives a Clock,
 * so tests can freeze or advance time. See ADR 0008.
 * Real implementation: `systemClock` (shared/runtime). Fakes: shared/kernel/testing.
 */
export interface Clock {
  now(): Date;
}
