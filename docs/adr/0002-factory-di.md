# 0002. Use plain functions with factory-function DI and a single composition root

- **Status:** Proposed
- **Date:** 2026-09-26

## Context

We want dependency injection (to swap adapters and fakes) without a DI container or class
hierarchies. TypeScript interfaces are structural, like Python `Protocol`s.

## Decision

- **Domain:** plain `type`s and pure functions. No classes.
- **Application:** `makeX(deps) => useCase` factory functions that close over their dependencies.
  Service types are derived with `ReturnType<typeof makeX>` or declared as interfaces when they
  are ports.
- **Adapters:** also factories (`drizzleLedgerRepo(db)`). A class is allowed only when an
  adapter genuinely owns mutable internal state _and_ a factory would be awkward (expected to be
  rare, e.g. a token-bucket rate limiter).
- **Composition roots:** `src/server/container.ts` (app) and `worker/container.ts` (worker) are
  the only places that construct real adapters and call factories. The app container is cached
  on `globalThis` in dev so hot reload doesn't create new DB pools.

## Consequences

- ✅ Dependencies are visible in signatures, and tests build use cases with fakes in one line.
- ✅ No decorators, reflection or container magic to learn.
- ❌ The composition root grows as the app grows. That's acceptable, and it reads as a map of the
  system.
- ❌ `this`-free closures mean no `instanceof` checks. We use discriminated unions instead.

## Alternatives considered

- **Classes with constructor injection:** fine, but more ceremony in TS, and `this` binding
  pitfalls when passing methods as callbacks.
- **DI container (tsyringe, inversify):** needs decorators and reflection metadata. Magic that
  hides the wiring.
- **Module-level singletons (`import { db } from "@/db"`):** impossible to swap in tests, and
  hidden coupling.
