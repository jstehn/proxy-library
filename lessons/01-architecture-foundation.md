# Lesson 01: Architecture foundation

**Phase 1 of the roadmap.** No game features yet. This phase builds the floor every feature
stands on: shared types, dependency injection, transactions, tests, and lint rules that keep the
architecture honest. Read it alongside [`docs/architecture/`](../docs/architecture/overview.md).

## Contents

1. [What got built](#1-what-got-built)
2. [The shared kernel, and the TypeScript it teaches](#2-the-shared-kernel-and-the-typescript-it-teaches)
3. [Randomness you can replay](#3-randomness-you-can-replay)
4. [Dependency injection, for real this time](#4-dependency-injection-for-real-this-time)
5. [The Unit of Work: all or nothing](#5-the-unit-of-work-all-or-nothing)
6. [Config: parse, don't validate](#6-config-parse-dont-validate)
7. [Tests: unit, property, integration](#7-tests-unit-property-integration)
8. [Architecture as lint rules](#8-architecture-as-lint-rules)
9. [Things that bit us](#9-things-that-bit-us)
10. [Exercises](#10-exercises)

---

## 1. What got built

```
src/shared/
  kernel/          pure building blocks (no I/O, no frameworks)
    result.ts        Result<T, E>, ok(), err()
    brand.ts         Brand<T, Name>: nominal types
    ids.ts           UserId
    money.ts         Cents (branded integer) + companion object
    clock.ts         Clock port (interface)
    rng.ts           Rng port, seededRng, weightedPick, weightedSample
    unit-of-work.ts  UnitOfWork port (interface)
    assert-never.ts  exhaustiveness helper
    testing/         fakes: fixedClock, manualClock, inMemoryUnitOfWork
  runtime/         real adapters that touch the OS: systemClock, randomSeed
  config/          Zod-parsed environment (the only reader of process.env)
  db/              Drizzle client, DbExecutor, UnitOfWork implementation, migrations
src/server/
  core.ts          wiring shared by app + worker (the composition root's body)
  container.ts     the app's composition root (server-only, cached across hot reloads)
  health.ts        walking-skeleton use case
src/app/api/health/route.ts   controller: use case → HTTP
worker/            `pnpm worker health|migrate`
tests/setup/       integration test global setup
eslint.config.mjs  the architecture, as lint rules
```

Try it:

```sh
pnpm db:start
pnpm worker health                 # use case → unit of work → Postgres
pnpm dev                           # then open http://localhost:3000/api/health
pnpm check                         # typecheck + lint + format + unit tests
pnpm test:int                      # integration tests against tcg_test
```

## 2. The shared kernel, and the TypeScript it teaches

### `Result`: discriminated unions ([`result.ts`](../src/shared/kernel/result.ts))

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

- `<T, E>` are **generics**, like `Generic[T]` / `TypeVar` in Python. `Result<Cents, WalletError>`
  fills them in.
- The `|` makes it a **union**, and `ok: true` vs `ok: false` is the **discriminant**. After
  `if (!r.ok) return r;`, TypeScript _knows_ `r` is the success case, so `r.value` compiles.
  Before that check, `r.value` is a compile error. That's how the compiler forces you to handle
  failures.
- `ok()` has **overloads**: `ok()` returns `Ok<void>` (success with nothing to return), and
  `ok(x)` returns `Ok<typeof x>`. Python's `@overload` is the same idea.

### Branded types ([`brand.ts`](../src/shared/kernel/brand.ts), [`money.ts`](../src/shared/kernel/money.ts))

```ts
declare const brand: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
export type Cents = Brand<number, "Cents">;
```

TypeScript is **structural**: two types with the same shape are interchangeable, so by default
`number` = `number` whether it's cents or a card count. `T & { [brand]: Name }` (an
**intersection**) adds a fake property that exists only at compile time. `Cents` is still a plain
number at runtime, but you can't pass a raw `42` where `Cents` is expected. You have to go through
`Cents.of(42)`, which validates. (Python: `NewType("Cents", int)`.)

### Companion objects: a value object without a class

```ts
export type Cents = Brand<number, "Cents">;   // the TYPE named Cents
export const Cents = { of, fromUsd, add, … }; // a VALUE also named Cents
```

TypeScript keeps types and values in separate namespaces, so one name can be both. At use sites
it reads like a class with static methods (`Cents.add(a, b)`, `Cents.format(c)`), but it's just an
object of functions: no `this`, no `new`, nothing to subclass.

Note `Cents.fromUsd("0.29")` parses the string **digit by digit** instead of doing
`0.29 * 100` (which is `28.999999999999996`). The test file has that exact case.

### Interfaces as ports ([`clock.ts`](../src/shared/kernel/clock.ts), [`unit-of-work.ts`](../src/shared/kernel/unit-of-work.ts))

```ts
export interface Clock {
  now(): Date;
}
```

This is a `typing.Protocol`. Anything with a `now(): Date` method **is** a Clock, with no
`implements` keyword. `systemClock()`, `fixedClock(...)` and `manualClock(...)` are three
implementations.

### Closures hold state ([`kernel/testing/index.ts`](../src/shared/kernel/testing/index.ts))

```ts
export function manualClock(start) {
  let current = new Date(start).getTime(); // private state
  return {
    now: () => new Date(current),
    advanceBy: (ms) => {
      current += ms;
    },
  };
}
```

`current` is invisible from outside. Only the returned functions can touch it. This is the
factory-function pattern from ADR 0002 in miniature, the same trick as a Python closure with
`nonlocal`.

## 3. Randomness you can replay

[`rng.ts`](../src/shared/kernel/rng.ts) implements a **seeded pseudo-random generator**:
`seededRng("pack-42")` produces the same sequence every time.

- **cyrb128** hashes any string into 128 bits of seed, and **sfc32** turns that into a fast
  stream of numbers in [0, 1). Both are small, well-known algorithms.
- In production, `randomSeed()` (in `shared/runtime`) gets 128 unpredictable bits from the OS.
  We **store that seed with each opening**, so any pack can be regenerated exactly: great for
  debugging "I got three mythics?!".
- `weightedPick` picks proportionally to weight (mythic 1 : rare 7).
  `weightedSample(rng, options, k)` draws `k` **distinct** items, one at a time, which is how a
  booster sheet is sampled (no duplicates within one draw). Phase 5's pack engine is built on
  these.

## 4. Dependency injection, for real this time

The walking skeleton shows the whole pattern in about 40 lines.

**The use case** ([`src/server/health.ts`](../src/server/health.ts)) declares what it needs and
nothing more:

```ts
type HealthTx = { system: { databaseTime(): Promise<Date> } };
export function makeCheckHealth(deps: { uow: UnitOfWork<HealthTx>; clock: Clock }) {
  return async () => { … };
}
```

**The composition root** ([`src/server/core.ts`](../src/server/core.ts)) builds real things
and plugs them in:

```ts
const clock = systemClock();
const uow = makeDrizzleUnitOfWork(db, (tx) => ({ system: makeSystemService(tx) }));
checkHealth: makeCheckHealth({ uow, clock }),
```

**The test** ([`health.test.ts`](../src/server/health.test.ts)) plugs in fakes and runs the
**same code** with no database and frozen time:

```ts
makeCheckHealth({
  uow: inMemoryUnitOfWork({
    system: { databaseTime: async () => new Date("2026-01-01T00:00:01Z") },
  }),
  clock: fixedClock("2026-01-01T00:00:00Z"),
});
```

Two details worth noticing:

- **Structural typing does the plumbing.** The container's `uow` has a bundle type like
  `{ system: SystemService }`. Later it will be `{ system, wallet, inventory, … }`. That's
  assignable to `UnitOfWork<HealthTx>` because it has _at least_ what `HealthTx` asks for. Each
  use case sees only its slice. This is the **interface segregation principle**, for free.
- **Two composition roots, one wiring.** [`container.ts`](../src/server/container.ts) (app) and
  [`worker/container.ts`](../worker/container.ts) both call `buildCore`. The app's version adds
  `import "server-only"` (build error if a browser component imports it) and caches the
  container on `globalThis`, so Next's hot reload doesn't open a new database pool on every save.

## 5. The Unit of Work: all or nothing

[`shared/db/unit-of-work.ts`](../src/shared/db/unit-of-work.ts):

```ts
return await db.transaction(async (tx) => {
  const result = await work(bindServices(tx));
  if (!result.ok) {
    rolledBackWith = result;
    throw rollback;
  } // → ROLLBACK
  return result; // → COMMIT
});
```

Drizzle rolls a transaction back when the callback throws. Our use cases _return_ failures
instead of throwing (ADR 0003), so the unit of work translates: an `err` result becomes a private
throw (rollback), which we catch and turn back into the original `err` for the caller.
`bindServices(tx)` rebuilds every module's services around the open transaction, so all of their
writes land in the same transaction.

The integration test ([`unit-of-work.int.test.ts`](../src/shared/db/unit-of-work.int.test.ts))
proves the three cases against real Postgres: `ok` commits, `err` rolls back _both_ inserts and
returns the error, and a throw rolls back and rethrows.

## 6. Config: parse, don't validate

[`shared/config/index.ts`](../src/shared/config/index.ts) parses `process.env` with a Zod schema
**once**, at startup, into a typed `Config`. Zod is the Pydantic equivalent. If `DATABASE_URL` is
missing, you get a readable error immediately instead of a mysterious failure deep inside a query
later. Nothing else reads `process.env` (lint enforces it), so every setting the app depends on
is listed in one schema.

## 7. Tests: unit, property, integration

Vitest is configured with two **projects** ([`vitest.config.ts`](../vitest.config.ts)):

| Project       | Files           | Database | Run with        |
| ------------- | --------------- | -------- | --------------- |
| `unit`        | `*.test.ts`     | no       | `pnpm test`     |
| `integration` | `*.int.test.ts` | tcg_test | `pnpm test:int` |

**Property-based tests** (fast-check ≈ Hypothesis) state a rule and let the library hunt for a
counterexample across hundreds of generated inputs:

```ts
it("add and subtract are inverses", () => {
  fc.assert(
    fc.property(cents, cents, (a, b) => {
      expect(Cents.subtract(Cents.add(a, b), b)).toBe(a);
    }),
  );
});
```

When a property fails, fast-check **shrinks** the input to the smallest failing case and prints a
seed to replay it.

**Statistical tests** check the odds: 80,000 seeded picks at 1:7 weights must land within ±0.005
of 12.5% mythics (more than 4 standard errors, so it's not flaky, and it's deterministic anyway
because the seed is fixed).

**A safety guard earned its keep.** The integration setup refuses to run unless the database
name contains `_test`. On the first run it _did_ refuse, because Vitest's per-project `env`
applies inside test workers but not in the global setup. Without the guard, setup would have
migrated the dev database.

## 8. Architecture as lint rules

[`eslint.config.mjs`](../eslint.config.mjs) classifies every folder as an **element**
(`kernel`, `db`, `server`, `app`, module layers, …). It then lists which element may import
which, and `default: "disallow"` covers everything else. It also bans `Math.random`, `new Date()`,
`process.env` and `fetch` outside the places ADRs allow them, and flags import cycles.

To prove the rules work, we created a fake `demo` module full of deliberate violations: a domain
importing Drizzle, an application importing infrastructure, the UI deep-importing a module's
internals, a cycle, and so on. Lint caught all **17**, and every legal import passed. Then the
fixtures were deleted. A sample of the messages:

```
Architecture: module-layer (demo/application) may not import module-layer (demo/infrastructure).
Architecture: app may not import db.
Inject an Rng instead of Math.random (ADR 0008).
Dependency cycle detected  import/no-cycle
```

## 9. Things that bit us

| Problem                                        | Cause                                                                      | Fix                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ERR_PNPM_IGNORED_BUILDS`                      | pnpm 12 blocks dependency install scripts by default (supply-chain safety) | allow-list `esbuild` in `pnpm-workspace.yaml`, with a comment on why               |
| Vite "ESM syntax in a file loaded as CommonJS" | `package.json` had no `"type"`                                             | `"type": "module"`: `.ts`/`.js` files are ES modules                               |
| Boundaries warned about `src/shared/config.ts` | element patterns match **folders**, not files                              | `config.ts` → `config/index.ts`; a module's `index.ts` is classified by its folder |
| Integration setup hit the dev DB               | project `env` isn't applied to global setup                                | setup reads `TEST_DATABASE_URL` explicitly, and the `_test` guard stays            |
| `server-only` can't go in shared code          | it **throws** outside Next.js (worker, tests)                              | only `src/server/container.ts` imports it                                          |

## 10. Exercises

1. In `health.test.ts`, change the fake `databaseTime` to return a different date and watch the
   test fail. Then write a third test using `manualClock` that calls `checkHealth` twice,
   advancing the clock by one hour between calls.
2. Try to break the architecture: in `src/server/health.ts`, add
   `import { createDatabase } from "@/shared/db"` (allowed: server may use db). Now create
   `src/app/test/page.tsx` that imports `@/shared/db` and run `pnpm lint`. Read the message, then
   delete the file.
3. In `rng.test.ts`, add a property: "`weightedPick` never returns an item with weight 0" for
   _random_ weight arrays. Hint: `fc.array(fc.nat({ max: 5 }))` for weights, and skip arrays whose
   weights are all zero with `fc.pre(...)`.
4. In a scratch file: `const a = Cents.of(100); const n: number = 5; Cents.add(a, n);`. Why doesn't
   it compile? What's the one legitimate way to turn `n` into `Cents`?
5. Run `pnpm db:stop`, then `curl -i localhost:3000/api/health` with `pnpm dev` running. Which line
   of code turned the connection error into a 503?
