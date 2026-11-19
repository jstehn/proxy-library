# P07a. Shared SQL pieces: text arrays and store offers

> **P07 was split (2026-11-19).** The candidate queries differ in meaning (ordering, cheapest-finish
> rule, EDHREC joins, combo partners, owned-vs-store exclusion), so the pool and the four tool
> bindings are separate packages: [P07b](P07b-candidate-pool.md) and [P07c](P07c-library-tools.md).
> This file keeps the slices that were safe to do first.

- **Branch:** `refactor/P07-candidates` · **Depends on:** P05 · **Parallel with:** P06, P08
- **Audit:** doc 65 F6, D2, D11
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S1](../dedup-playbook.md#s1) (`search_cards`, `get_cards`, `find_replacements`, `manage_wishlist` rows), [S2](../dedup-playbook.md#s2), [S5](../dedup-playbook.md#s5) (store quote) · **Lines to remove:** about −1,500 to −2,200

## Goal

"Cards you could add, owned or for sale at their cheapest printing" and "today's offer for a
card" are each one read port, used by suggestions, commanders, combos, semantic search, mana base,
draft-a-deck, search-for-deck, the wishlist and the tools.

## Touches

`src/modules/decks/queries/{suggestions,commanders,deck-combos,semantic-search,draft-deck,mana-base,search-for-deck,browse,owned}.ts`,
`src/modules/store/queries/{store,shopping-list}.ts`, `src/modules/wishlist/queries/for-sale.ts`,
new `decks/application/candidate-pool.ts` and `store/application/quote.ts`, bindings
`search_cards`, `get_cards`, `find_replacements`, `manage_wishlist`, builder suggestion actions.
**Avoid:** `queries/decks.ts`, `audit.ts` (P06).

## Steps

1. List every candidate query (`with cheapest as`, `ownedCandidates`, `storeCandidates`,
   `toCandidate`, `cheapestForSale`). Note what each filters on (format, colors, tags, owned or
   not, real cards) and which price finish it picks.
2. Design `CandidatePool`: `owned(filter)`, `forSale(filter)`, `byIds(ids)`, with one `Candidate`
   type. The filter covers all the variants found. One SQL implementation, using P03's price
   fragments.
3. `store.quote(oracleIds | printingIds)`: today's offer, the store's rule (100% of the latest
   price for singles). The wishlist calls it instead of `for-sale.ts`'s own SQL.
4. Move the scoring and orchestration out of `queries/suggestions.ts` (1,053 lines) into an
   application read service that uses the pool and pure `domain/suggest`/`rate` functions.
5. Bindings for the 4 tools; builder suggestion actions call the same service.
6. Delete the replaced queries and their old tests; write new tests (fake pool for scoring, an
   integration test for the SQL).

## Done when

- The command below finds candidate SQL only in the pool's implementation.
- `queries/suggestions.ts` is gone or under 500 lines.

## Re-check the numbers

```bash
grep -rlniE "with cheapest|cheapest as|function (ownedCandidates|storeCandidates|toCandidate|cheapestForSale)" src --include='*.ts' | grep -v '\.test\.'
```

## Handoff

**Done:**

- `textArray` is one function in `@/shared/db` (`text-array.ts`). Four copies are gone. The two
  decks copies added a `"_"` element to keep an empty array typed; it is dropped, because
  `array[]::text[]` is valid and the integration suite passes.
- `storeOfferRows(db, filter)` in `@/shared/db` (`offers.ts`) is the one "what the store sells
  today" read (every printing in an enabled set, once per priced finish). The shopping list
  (`store/queries/shopping-list.ts`) and the wishlist (`wishlist/queries/for-sale.ts`) call it.
- Clone runs 57 → 48 (baseline lowered). Source lines 91,537 → 91,511. `pnpm check` and the 265
  integration tests pass.

**Not done here (moved on):** the candidate pool, `suggestions.ts` and the four tool bindings.
See P07b and P07c.
