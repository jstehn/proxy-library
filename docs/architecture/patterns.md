# Pattern catalog

Every pattern used in this codebase, **where** it's used, and **why**. If you're about to write
something that looks like a pattern but isn't listed here, add it here (or an ADR) first.

Code sketches are illustrative. Real signatures are fixed in each module's design doc.

---

## 1. Functional core, imperative shell

**What:** decisions are pure functions (`input → output`, no I/O). A thin shell around them does
the I/O: load data, call the pure function, save the result.

**Where:** everywhere there are rules.

- `wallet/domain/allowance.ts`: `accrueAllowance(policy, lastAccruedAt, now) → { periods, amount, nextAccruedAt }`
- `packs/domain/generate.ts`: `generatePack(config, rng) → PackCard[]`
- `decks/domain/ownership.ts`: `checkOwnership(deck, holdings, policy) → Shortfall[]`
- `trades/domain/validate.ts`: `validateTrade(trade, holdingsA, holdingsB, balances) → Result`

**Why:** pure functions are trivially testable (no mocks), deterministic, and easy to reason about.
This is where most bugs would hide, so it's where tests are cheapest.

```ts
// shell (application)                         // core (domain)
const last = await repo.lastAllowance(userId);  export function accrueAllowance(
const r = accrueAllowance(policy, last, clock.now());   policy: AllowancePolicy, last: Date, now: Date,
if (r.periods > 0) await repo.append(...);      ): Accrual { /* math only */ }
```

## 2. Ports & adapters (hexagonal)

**What:** the application layer declares **interfaces for what it needs** (ports). Infrastructure
provides **implementations** (adapters). The core never imports the adapter.

**Where:** every boundary with the outside world: DB (`LedgerRepo`, `CollectionRepo`), HTTP
(`ScryfallGateway`, `MtgjsonGateway`), time (`Clock`), randomness (`Rng`), files (`ImageStore`),
auth (`SessionReader`).

**Why:** swap Postgres for an in-memory fake in tests, or Scryfall for a fixture file, without
touching business logic.

**Python analogy:** TS interfaces are **structural**, exactly like `typing.Protocol`. An object
satisfies `LedgerRepo` if it has the right methods. No `implements` keyword is required.

## 3. Dependency injection with factory functions + a composition root

**What:** use cases are built by `makeX(dependencies)` functions that close over their dependencies. One
file per entry point (`src/server/container.ts`, `worker/container.ts`) constructs the real
adapters and calls the factories. This is the **composition root**. No DI container library.

```ts
export type WalletDependencies = { ledger: LedgerRepo; clock: Clock; policy: AllowancePolicy };

export function makeWalletService(dependencies: WalletDependencies) {
  const { ledger, clock, policy } = dependencies;

  async function balance(userId: UserId): Promise<Cents> { … }
  async function debit(userId: UserId, amount: Cents): Promise<Result<void, InsufficientFunds>> { … }

  return { balance, debit };
}
export type WalletService = ReturnType<typeof makeWalletService>;
```

**Why:** dependencies are explicit in the signature, and tests pass fakes by hand. It's the same
effect as ArjanCodes' "pass the Protocol into `__init__`", minus the classes.

**Rule:** only composition roots call `make*` with real adapters. Nothing reaches for a global
`db`.

## 4. Repository (write side)

**What:** a port that loads and saves one **aggregate** (a cluster of data that must stay
consistent together), phrased in domain terms: `ledger.append(entry)`,
`inventory.markOpened(itemId)`. It doesn't expose generic `query(sql)`.

**Where:** one per aggregate: `LedgerRepo`, `SealedInventoryRepo`, `CollectionRepo`, `DeckRepo`,
`TradeRepo`.

**Why:** keeps SQL out of use cases and gives tests a seam.

**Not for reads.** Screens use query functions (pattern 6).

## 5. Unit of Work (transaction boundary)

**What:** `unitOfWork.run(work)` opens one DB transaction, builds **transaction-bound services** for the
modules involved, runs `work`, and **commits on `ok` / rolls back on `err` or throw**.

```ts
export interface UnitOfWork<S> {
  run<T, E>(work: (services: S) => Promise<Result<T, E>>): Promise<Result<T, E>>;
}

// store/application/buy-sealed.ts: store declares only what it needs (interface segregation)
type BuySealedServices = { wallet: WalletOps; inventory: InventoryOps; pricing: SealedPricing };
type BuySealedDependencies = { unitOfWork: UnitOfWork<BuySealedServices> };

export function makeBuySealed(dependencies: BuySealedDependencies) {
  const { unitOfWork } = dependencies;

  async function buySealed(actor: Actor, productId: SealedProductId) {
    return unitOfWork.run(async ({ wallet, inventory, pricing }) => {
      const price = await pricing.priceOf(productId);
      const paid = await wallet.debit(actor.userId, price, { kind: "purchase_sealed", productId });
      if (!paid.ok) return paid; // → rollback
      return ok(await inventory.addSealed(actor.userId, productId));
    });
  }

  return buySealed;
}
```

**Where:** every use case that touches more than one aggregate or module (buy, open, sell back,
trade).

**Why:** money and cards must move **together or not at all**. Because TS typing is structural,
the composition root's big services object automatically satisfies each use case's small
`BuySealedServices`, so no module has to import the composition root.

## 6. CQRS-lite: query functions for reads

**What:** reads bypass repositories and use cases. `queries/*.ts` are plain functions:
`(db, params) → Promise<ViewModel[]>`, written as one efficient SQL query each.

**Where:** collection grid, store listings, profile stats, activity feed, deck builder search.

**Why:** screens want joins, filters, pagination, and aggregates. Forcing them through aggregates
creates N+1 queries and bloated repos. Reads can't break invariants, so they don't need the
domain layer.

**Rule:** queries **never write**. View models are plain serializable objects (they cross the
server → client component boundary).

## 7. Result type + discriminated-union errors

**What:** expected failures are **return values**, not exceptions.

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
type WalletError =
  | { kind: "InsufficientFunds"; balance: Cents; required: Cents }
  | { kind: "SelfFundingNotPermitted" };
```

Callers must check `r.ok` before touching `r.value`, and the compiler enforces it. UI mapping uses
an **exhaustive switch** with `assertNever`, so adding a new error kind breaks the build everywhere
it isn't handled.

**Exceptions** are for **defects and outages** (a bug, the DB down, a violated invariant). They
bubble up to Next's error boundary and get logged.

**Where:** every use case returns `Promise<Result<T, ModuleError>>`.

## 8. Branded types (value objects on a budget)

**What:** `type UserId = Brand<string, "UserId">`. At runtime it's a plain string, but the compiler
refuses to pass a `CardId` where a `UserId` is expected. Brands are created only by **smart
constructors** that validate (`Cents.of(n)` rejects non-integers). Each brand has a companion
object of the same name holding its constructor and operations (`Cents.add`, `Cents.format`).

**Where:** all ids, `Cents`, `Percent`/`BasisPoints` (sell-back rate).

**Why:** `transfer(from, to, amount)` with three plain values invites argument-order bugs. Brands
make those bugs compile errors.

**Python analogy:** `NewType("UserId", str)` with mypy strict.

## 9. Parse, don't validate (Zod at the edges)

**What:** untrusted data (form input, env vars, MTGJSON/Scryfall JSON) is **parsed once at the
boundary** into precise types. Inside, code trusts the types and never re-checks.

**Where:** server actions (FormData → input type), `shared/config/` (env), catalog gateways
(external JSON).

**Python analogy:** Pydantic models at the API edge.

## 10. Anti-corruption layer (ACL)

**What:** external data shapes stop at `catalog/infrastructure`. MTGJSON's `booster.sheets` and
Scryfall's `prices.usd_foil` are mapped into **our** domain types (`BoosterConfig`, `Printing`,
`Price`) by pure mapper functions.

**Why:** when MTGJSON changes a field name, one mapper and its test change. Nothing else
does. It also lets `packs` depend on a clean `BoosterConfig` instead of raw JSON.

## 11. Strategy

**What:** interchangeable algorithms behind one function type, chosen at runtime.

| Strategy slot        | Implementations                                                                       |
| -------------------- | ------------------------------------------------------------------------------------- |
| `PackGenerator`      | `sheetBasedGenerator` (MTGJSON booster config), `raritySlotGenerator` (fallback)      |
| `DeckExporter`       | `plainTextExporter`, `moxfieldCsvExporter`, `proxySheetExporter`                      |
| `CollectionExporter` | `moxfieldCsv`, `archidektCsv`                                                         |
| `AllowancePolicy`    | data rather than code: `{ amount, period }` (a strategy that turned out to be config) |

In TS a strategy is usually **just a function type**: `type PackGenerator = (config, rng) => PackCard[]`.
Pick with a lookup table, not an `if` chain.

## 12. Composite

**What:** sealed products are trees. A box contains packs, a bundle contains packs, cards and
dice, and a Draft Night contains packs and a collector pack. `SealedContents` is a recursive
discriminated union, and **one recursive function** expands any node.

```ts
type SealedContents =
  | { kind: "pack"; boosterType: BoosterType; setCode: SetCode }
  | { kind: "card"; cardId: CardId; finish: Finish }
  | { kind: "sealed"; productId: SealedProductId } // nested product
  | { kind: "variable"; options: SealedContents[][] } // "one of these configurations"
  | { kind: "other"; name: string }; // dice, spindown, …
```

## 13. Explicit state machines

**What:** lifecycles are modelled as a **transition table + pure `transition(state, event)`
function** that returns `Result`. Illegal transitions are unrepresentable or return `err`.

| Machine                   | States                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Sealed item (`inventory`) | `unopened → opened` (terminal)                                                            |
| Trade (`trades`)          | `proposed → accepted \| declined \| cancelled \| countered`, `countered → (new proposal)` |
| Opening sequence (client) | `sealed → tearing → dealt → revealing(i) → summary`                                       |

**Why:** status bugs ("accepted a cancelled trade") become compile or test failures instead of
data corruption.

## 14. Decorator, by function composition

**What:** wrap a function to add behavior while keeping its type.

```ts
const scryfallFetch = withUserAgent(ua)(
  withRateLimit({ perSecond: 8 })(withRetry({ attempts: 3 })(fetchJson)),
);
```

**Where:** HTTP clients (`shared/http`), image cache (`withDiskCache(fetchImage)`).

**Why:** rate limiting, retries and caching are each written and tested once, then composed.

## 15. Append-only ledger (event-sourcing-lite)

**What:** money is never a mutable `balance` column. Every change is an **immutable ledger entry**
(`amount`, `kind`, `ref`), and the balance is `SUM(amount)`. Acquisitions of cards are logged the
same way.

**Why:** a full audit trail for free, and "total spent" and "self-funded" become simple aggregate
queries. You can never be in a state where you can't explain a balance. Concurrency is handled by
locking a per-user `wallet_accounts` row during debits (ADR [0004](../adr/0004-append-only-ledger.md)).

## 16. Domain events → activity (transactional outbox-lite)

**What:** use cases record events (`PackOpened`, `RarePulled`, `TradeCompleted`) through an
`EventRecorder` port **inside the same transaction**. They're persisted to an `activity_events`
table, and the activity feed is a query over that table.

**Why:** the feed can never show an event whose transaction rolled back, and modules don't call
the activity module directly (loose coupling).

**YAGNI:** no message bus, no async subscribers until something actually needs them.

## 17. Injected nondeterminism: `Clock` and `Rng`

**What:** nothing calls `new Date()` or `Math.random()` outside adapters. Code receives a `Clock`
and an `Rng`.

**Why:** tests can freeze time ("3 weeks passed, so 3 allowances") and seed randomness ("this seed
yields this exact pack"). Monte Carlo tests of pack odds become reproducible.

## 18. Contract tests for ports

**What:** one test suite per port (`describeLedgerRepoContract(makeRepo)`), run against **both**
the in-memory fake and the Drizzle adapter.

**Why:** it guarantees the fake behaves like the real thing, so fast use-case tests built on
fakes can be trusted.

---

## Anti-patterns we avoid

| Smell                                                | Instead                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| God service (`CardService` doing everything)         | One module per concept; use cases are small, single-purpose functions              |
| `utils.ts` / `helpers.ts` junk drawers               | Put the function in the module that owns the concept                               |
| Scryfall JSON or Drizzle rows in the UI              | Map to domain types (ACL) or view models (queries)                                 |
| Inheritance hierarchies                              | Composition, unions and strategies                                                 |
| `process.env.X` scattered around                     | `shared/config/`, injected                                                         |
| `any`, non-null `!`, `as` casts                      | Parse with Zod, narrow with checks. `as` is allowed only inside smart constructors |
| Boolean flag parameters (`open(id, true)`)           | Separate functions or an options object with named fields                          |
| Business rules in React components or server actions | Move them into domain functions                                                    |
| Premature interfaces                                 | See below                                                                          |

## When _not_ to add an abstraction

Add a port or interface **only** when at least one of these is true:

1. It crosses a **process/IO boundary** (DB, network, filesystem, time, randomness), or
2. There are **two or more real implementations** today (strategies, exporters).

A fake for testing counts as an implementation only for IO boundaries. Pure logic doesn't need a
fake, because you test it directly. Otherwise, write a plain function and refactor when a second
implementation actually shows up.
