# P07. Candidate pool and store quote

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

(empty)
