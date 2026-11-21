# P03. One current-price query

- **Branch:** `refactor/P03-current-price` · **Depends on:** P02 · **Parallel with:** P04
- **Audit:** doc 65 D1

## Goal

"Today's price of a printing in a finish" is written once, in `catalog`, and every query uses it.

## Touches

`src/modules/catalog/queries/` (new `prices.ts`), and the 29 files listed by the command below
(mostly `src/modules/decks/queries/*`, plus store, wishlist, trades, collection,
real-collection, packs and drafts infrastructure, and `shared/card-search/sql.ts`).

## Steps

1. Read 3 or 4 of the existing subqueries and list the variants: latest snapshot per finish
   (`distinct on (finish) … order by day desc`), latest for one finish (`order by day desc limit
1`), and "cheapest finish today".
2. In `catalog/queries/prices.ts`, export SQL fragment functions for each variant (for example
   `latestPrice(printingColumn, finishColumn)`, `latestPricesByFinish(printingColumn)`,
   `cheapestFinishToday(printingColumn)`). If a Postgres view (`current_prices`) is simpler and
   fast enough, use it instead, with a migration. Test the fragments in an integration test.
3. Replace all 45 subqueries. Where a copy did something different, note in the handoff which
   variant it now uses and why.
4. Lint: forbid the text `price_snapshots` in template strings outside
   `src/modules/catalog/` (a `no-restricted-syntax` rule on `TemplateElement`).

## Done when

- The command below lists only `catalog` files.
- `pnpm test:int` passes for the queries touched (or the failures are in STATUS).

## Re-check the numbers

```bash
grep -rlE "(from|join) price_snapshots" src --include='*.ts' | grep -v '\.test\.' | grep -v modules/catalog
```

## Handoff

Done on `refactor/P03-current-price`; `pnpm check` and `pnpm test:int` (265 tests, 9 new) pass.

- **Where the fragments live (differs from the brief).** They are in `src/shared/db/prices.ts`
  (exported from `@/shared/db`), not `catalog/queries/prices.ts`: queries and `card-search` may not
  import a module (ADR 0009), so a catalog file could not be used by 24 of the 25 callers. The
  table stays the catalog's; only the fragments sit in `db`. No view or migration: the fragments
  are as fast as the old copies, which they reproduce word for word.
- Fragments: `latestPrice(printing, finish)`, `cheapestPrice(printing)`,
  `latestPriceRows(printing)` (one row per finish, used as `join lateral`),
  `latestPricesByFinish(printing)` (jsonb), `newestDayPrice(printing)`, `nonfoilFirstPrice(printing)`,
  `latestSnapshot(printing, finish)` (price and day, for the store's quote), `newestPriceDay()` and
  `newestDayPrices()`. Arguments are column text (`"p.id"`) or `sql`; only code literals, never
  user input.
- 39 subqueries in 25 files were replaced (the brief said 45 in 29; the grep command now lists no
  file outside `catalog` and `shared/db`).
- **Copies that differed, kept as their own fragments:** `card-facts.ts` and one in
  `suggestions.ts` take the newest day's cheapest price in any finish (`newestDayPrice`); the draft
  catalog prefers nonfoil (`nonfoilFirstPrice`); the store's featured art and the deck repository's
  "cheapest printing first" order use only the newest day (`newestDayPrices`). I did not merge
  these with "latest per finish": they answer different questions. Whether they should is a
  product decision.
- Lint: a `no-restricted-syntax` rule forbids `price_snapshots` in template strings outside
  `src/modules/catalog/` and `shared/db/prices.ts`. `card-search/sql.ts` may now import `db`
  (a narrow boundary rule) so its `usd` filter can use `cheapestPrice`.
- New `tests/integration/prices.int.test.ts` checks each fragment against a known history.
- Reference tool outputs unchanged (apart from `draw_sample`'s random sample).
- Source lines: 90,968 before, 90,973 after (+75 for `prices.ts`, so the net is flat). Clone
  baseline 58 to 57.
