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

(empty)
