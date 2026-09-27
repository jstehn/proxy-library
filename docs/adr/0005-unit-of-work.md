# 0005. Coordinate multi-module writes with a Unit of Work

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

Buying, opening, selling back and trading each change several modules' data (wallet + inventory,
inventory + collection, collection + wallet). These changes must be atomic. Modules must not
reach into each other's tables.

## Decision

- Port (in `shared/kernel`):
  ```ts
  interface UnitOfWork<S> {
    run<T, E>(work: (services: S) => Promise<Result<T, E>>): Promise<Result<T, E>>;
  }
  ```
- The Drizzle implementation opens a transaction, builds **transaction-bound services** for every
  module (by calling each module's factories with tx-bound repos), runs `work`, **commits on
  `ok`** and **rolls back on `err` or throw**.
- Each orchestrating use case declares the **narrow** service bundle it needs
  (`type BuySealedTx = { wallet: WalletOps; inventory: InventoryOps }`) and receives a
  `UnitOfWork<BuySealedTx>`. The composition root's full bundle satisfies it structurally.
- Modules call each other's **operations** (`wallet.debit`) and never each other's repositories.
  This keeps every module's invariants (like the wallet lock) in that module.
- Lock ordering rule: when locking multiple users' wallets, lock in ascending `user_id` order to
  avoid deadlocks.

## Consequences

- ✅ Atomic cross-module operations, with module encapsulation preserved.
- ✅ Tests use an in-memory UoW (no real rollback needed for most tests). Rollback behavior is
  covered by integration tests.
- ❌ Transaction-bound services are rebuilt per transaction (cheap closures, negligible cost).

## Alternatives considered

- **Pass `tx` into every function:** leaks Drizzle types into application code.
- **Sagas / eventual consistency:** unnecessary with one database.
- **AsyncLocalStorage "ambient" transaction:** hidden coupling and harder to test and teach.
