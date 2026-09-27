# 0003. Return Result types for expected failures; throw only for defects

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Many operations have normal failure outcomes: insufficient funds, pack already opened, card not
owned, trade no longer open, self-funding not permitted. TypeScript can't declare what a
function throws, so exceptions make these outcomes invisible to callers.

## Decision

- `shared/kernel/result.ts` defines `Result<T, E> = { ok: true; value: T } | { ok: false; error: E }`
  plus `ok()`, `err()` and a few combinators (`map`, `andThen`), added only when needed.
- Each module defines its errors as a **discriminated union** on `kind`.
- Use cases return `Promise<Result<T, ModuleError>>`. UI code maps errors with an exhaustive
  `switch` ending in `assertNever`.
- **Exceptions are for defects/outages only:** bugs, broken invariants, DB/network down. They
  surface through Next.js error boundaries and logs.
- `UnitOfWork.run` rolls back when the work returns `err` (see [0005](0005-unit-of-work.md)).

## Consequences

- ✅ The compiler lists every failure a caller must handle, and adding an error kind breaks the
  build where it's unhandled.
- ✅ Failures are data: easy to test (`expect(r).toEqual(err({ kind: "InsufficientFunds", … }))`).
- ❌ Slightly more verbose call sites (`if (!r.ok) return r;`).
- ❌ Third-party code still throws, so adapters must catch and translate expected cases.

## Alternatives considered

- **Typed exception classes:** Pythonic, but callers can't see or be forced to handle them.
- **A library (neverthrow, Effect):** powerful, but a big learning surface. A 20-line Result is
  enough, and we can adopt a library later if chaining gets painful.
