# Testing strategy

A pyramid that mirrors the layers. Most tests are fast and pure, and a few are slow and real.

| Layer             | Test type                           | Tools                      | Speed   | Needs DB? |
| ----------------- | ----------------------------------- | -------------------------- | ------- | --------- |
| `domain/`         | unit + **property-based**           | Vitest + fast-check        | ms      | no        |
| `application/`    | use-case tests with in-memory fakes | Vitest + `*/testing` fakes | ms      | no        |
| `infrastructure/` | integration + **contract** tests    | Vitest + `tcg_test` DB     | ~100 ms | yes       |
| `queries/`        | integration (seeded data → view)    | Vitest + `tcg_test` DB     | ~100 ms | yes       |
| whole app         | a handful of E2E journeys           | Playwright (Nix browsers)  | seconds | yes       |

## Principles

- **Test behavior through public functions**, not internals. Tests for `wallet` call
  `makeWalletService(...)` or domain functions exported from `domain/`.
- **No mocking libraries** for our own code. Use real fakes (`inMemoryLedgerRepo`) that pass the
  same **contract tests** as the real adapter. Mock only at the HTTP edge, with recorded
  fixtures (a few real MTGJSON/Scryfall payloads checked into `tests/fixtures/`).
- **Determinism:** `fixedClock(date)` and `seededRng(seed)` everywhere. A failing property test
  prints its seed so it can be replayed.
- **Property-based tests** (fast-check ≈ Hypothesis) for engines with invariants:
  - a generated pack always has exactly the slot counts of its variant
  - no duplicate card within a sheet draw
  - foil flags only on foil sheets
  - allowance accrual is additive (`accrue(a→b) + accrue(b→c) = accrue(a→c)`)
  - sell-back never pays more than market price
- **Statistical tests** for odds: open N seeded packs and assert that observed rates fall within a
  tolerance of the rates implied by the booster config (a chi-square or a simple tolerance band).
- **Concurrency tests** against the real DB: two simultaneous debits that together exceed the
  balance, where exactly one must succeed.

## No network in automated tests

Automated tests never call MTGJSON, Scryfall or any image host: they're slow, and too many calls
could get the machine's address blocked. Outside data comes from recorded fixtures (below), and
browser tests answer card-image requests locally (`page.route("**/api/images/**", …)`). A check
that really must hit a live endpoint belongs in an opt-in `pnpm test:remote` suite that never runs
by default. A few manual real calls while developing are fine.

This is enforced: the unit and integration projects load `tests/setup/no-network.ts`, which makes
the global `fetch` reject with a message saying what to do instead. Gateways take a `fetchFn`, so
their tests pass a fake one. Run a `*.remote.test.ts` file only while working on the gateway it
covers (`pnpm vitest run --project remote <file>`), not as part of a routine check.

## Recorded fixtures

`tests/fixtures/` holds small, trimmed copies of **real** MTGJSON and Scryfall data (provenance
and the few synthetic additions are in its README). Catalog tests, and the end-to-end setup, read
them through file-based gateways that go through the real anti-corruption layer. No test calls
the network. Before building screens on outside data, also do one **real** run: it found three
problems the fixtures couldn't (design doc 04, section 15).

## Test databases

- `tcg_test` for integration tests (below) and `tcg_e2e` for browser tests. Both are created by
  `pnpm db:start`, and neither is ever your development data.
- Browser tests (`pnpm test:e2e`) start their own dev server on port 3100 against `tcg_e2e`,
  after `tests/e2e/global-setup.ts` migrates and empties it.
- Playwright's browsers come from Nix (`flake.nix`). The npm package `@playwright/test` must be
  pinned to the **same version** as nixpkgs' `playwright-driver`, or it won't find them.

### Integration test database

- `scripts/db.sh` also creates `tcg_test` on the same socket.
- Vitest global setup runs migrations on `tcg_test` once per run.
- Integration tests **empty the tables they use** (`truncate … cascade`) in `beforeEach`, and set
  any shared settings they depend on (such as `economy_settings`) themselves. Never assume another
  test left the defaults in place (a Phase 6 test failed exactly that way).

## Layout

**A test lives with what it covers** (owner decision, 2026-11-19). A test of one module, unit or
integration, sits in that module beside the code. `tests/` holds only what belongs to no single
module.

```
src/modules/wallet/domain/allowance.test.ts                  unit, next to the code it tests
src/modules/wallet/application/wallet-service.test.ts
src/modules/wallet/infrastructure/drizzle-ledger.int.test.ts integration, one module: in the module
src/modules/wallet/testing/ledger-repo.contract.ts           shared contract suite
tests/integration/*.int.test.ts                              journeys across modules (buy → open),
                                                             wired like a small composition root
tests/e2e/*.spec.ts                                          Playwright
tests/fixtures/  tests/setup/                                recorded payloads; test setup
```

## Commands

```sh
pnpm test          # unit + application (no DB), watch mode
pnpm test:int      # integration + contract (starts from tcg_test)
pnpm test:e2e      # Playwright
pnpm check         # typecheck + lint + format:check + unit tests (the pre-commit bar)
```
