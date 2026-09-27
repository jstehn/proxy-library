# 0008. Generate randomness server-side through injected Rng and Clock ports

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Pack contents must not be predictable or manipulable by the client. Pack odds and allowance
accrual must be testable, which requires deterministic randomness and time.

## Decision

- `shared/kernel` defines `Rng` (`next(): number` in `[0, 1)`) and `Clock` (`now(): Date`).
- Production: `cryptoRng()` (seeded from `crypto.getRandomValues`, fresh per opening) and
  `systemClock()`. Tests: `seededRng(seed)` and `fixedClock(date)` / `manualClock()`.
- Packs are generated **at opening time**, on the server, inside the opening transaction. The
  client only receives the result.
- The seed used for each opening is stored with the opening record. It isn't secret after the fact,
  and it makes any reported "weird pack" reproducible.
- Weighted selection helpers (`weightedPick`, `weightedSampleWithoutReplacement`) live in the
  kernel next to `Rng` and are property-tested.

**Implementation note (Phase 1):** there's no separate `cryptoRng`. Production draws a fresh
128-bit seed from the OS (`randomSeed()` in `shared/runtime`) and uses `seededRng(seed)`, which
is the same generator tests use, so every opening can be replayed from its stored seed.
`weightedSampleWithoutReplacement` shipped as `weightedSample`.

## Consequences

- ✅ Reproducible Monte Carlo tests of pack odds, and exact replays of any opening.
- ✅ No `Math.random()` or `new Date()` hidden in logic (lint-enforced).
- ❌ Every function needing time or randomness takes one more parameter. That visibility is the
  point.

## Alternatives considered

- **Generate at purchase time:** would work, but opening is the "moment", and deferring
  generation also lets booster-config fixes apply to unopened stock.
- **Client-side generation:** trivially cheatable.
