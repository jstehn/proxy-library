# P07b. Candidate pool and suggestion service

- **Branch:** `refactor/P07b-candidate-pool` · **Depends on:** P05, P07a · **Parallel with:** P08
- **Audit:** doc 65 F6, D2
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A (especially A1 to A2), then [S2](../dedup-playbook.md#s2) · **Lines to remove:** about −1,000 to −1,500

## Goal

"Cards you could add, owned or for sale at their cheapest printing" is one read port
(`CandidatePool`) used by suggestions, commanders, combos, semantic search, mana base,
draft-a-deck and search-for-deck. The scoring in `suggestions.ts` moves into an application read
service that uses the pool and pure `domain/suggest` functions.

## Why this is its own package

The copies are **not** the same query. Before writing the pool, pin what each one does (A1
table, A2 test) and decide each disagreement with the user:

- ordering (shared-count, EDHREC synergy, rarity, combo partner first);
- which finish is "cheapest" (P03 left three named price fragments);
- whether the deck's own cards are excluded, and how real cards (`usesRealCards`) count;
- EDHREC and combo-partner filters (only suggestions use them);
- owned = "one row per oracle card at its most-owned printing" vs. other rules.

## Touches

`src/modules/decks/queries/{suggestions,commanders,deck-combos,semantic-search,draft-deck,mana-base,search-for-deck,browse}.ts`,
new `decks/application/candidate-pool.ts` (port) and `decks/queries/candidate-pool.ts` (SQL),
the builder's suggestion actions. **Avoid:** `queries/decks.ts`, `audit.ts` (P06), the tool
bindings (P07c).

## Steps

1. List every candidate query (`with cheapest as`, `ownedCandidates`, `storeCandidates`,
   `toCandidate`, `cheapestForSale`): filter, order, columns, price finish. Put the table in the
   handoff. Ask the user about each disagreement (tududi comment).
2. A2 test: feed every copy the same inputs (foil-only, etched-only, no price, in another deck,
   real-card deck, colourless commander, split card). Record the answers.
3. Design `CandidatePool`: `owned(filter)`, `forSale(filter)`, `byIds(ids)`, one `Candidate`
   type; one SQL implementation using P03's fragments.
4. Move scoring and orchestration out of `queries/suggestions.ts` into an application service
   that takes the pool. Builder suggestion actions call it through `action()`.
5. Delete the replaced queries and old tests; fake-pool unit tests for scoring, an integration
   test for the SQL. Add the lint rule from S2.

## Done when

- The command below finds candidate SQL only in the pool's implementation.
- `queries/suggestions.ts` is gone or under 500 lines (remove it from the oversize allowlist).

## Re-check the numbers

```bash
grep -rlniE "with cheapest|cheapest as|function (ownedCandidates|storeCandidates|toCandidate|cheapestForSale)" src --include='*.ts' | grep -v '\.test\.'
```

## A1 inventory (2026-11-19, `refactor/main` after P07a)

Every copy has two halves. **Owned half:** one row per oracle card, at one of its owned printings.
**Store half:** cards in enabled sets that the player owns no printing of, at the cheapest printing
for sale. The filter, ranking, limit and columns differ per caller.

| Copy                                                                    | Owned: which printing                                               | Owned: price                              | Owned: extra columns                         | Store: how many, ranked by                                      | Store: price rule                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `suggestions.ts` `ownedCandidates` / `storeCandidates`                  | most copies (`quantity desc, printing_id`)                          | `latestPrice` in the owned finish         | owned, owned_real, other_decks, free, EDHREC | 400, by combo partner, shared count, synergy, inclusion, rarity | cheapest finish of any printing (`order by usd_cents, p.id`), keeps the finish |
| `suggestions.ts` `ownedCandidatesForIds` + inline store (similar cards) | most copies                                                         | `latestPrice`, optional max price         | same, EDHREC null                            | by ids (no limit)                                               | same, `distinct on oracle_id`                                                  |
| `draft-deck.ts`                                                         | most copies                                                         | `latestPrice` in the owned finish         | `also_in` names                              | 500, by shared count, rarity                                    | same                                                                           |
| `mana-base.ts` `landPoolsForDeck`                                       | most copies                                                         | **null**                                  | `also_in` names                              | **200, `order by oracle_id`** (no ranking)                      | same                                                                           |
| `search-for-deck.ts`                                                    | **most special** (`MOST_SPECIAL_FIRST`: price, foil, art)           | `latestPrice` in the owned finish         | none                                         | `perQuery`, by price then name; optional max price              | same                                                                           |
| `commanders.ts`                                                         | most copies                                                         | `cheapestPrice` (null for the owned list) | `leads` (decks led)                          | 600, unranked                                                   | `cheapestPrice` over finishes with a price (same answer, no finish kept)       |
| `semantic-search.ts`, `deck-combos.ts`                                  | use `ownedCandidatesForIds` and `candidateColumns` from suggestions |                                           |                                              |                                                                 |                                                                                |

## Disagreements that need your answer

1. **Which owned printing stands for a card.** Five copies take "the printing you hold most
   copies of"; `search-for-deck` takes your "most special" one (priciest, foil, special art).
   Proposed: both are real needs. Keep two named orderings in the pool (`byCopies`,
   `mostSpecial`) and let the caller choose, because search shows what you'd show off and the
   rest only need a representative.
2. **What an owned card's price means.** Suggestions, draft and search price it at the finish you
   own. Mana base and the commander list give owned cards no price. Proposed: the pool always
   prices owned cards at their owned finish; callers that don't want a price ignore it.
3. **Mana base's store lands are cut by `order by oracle_id limit 200`.** That keeps an arbitrary
   200, not the best 200. Proposed: rank by role/theme fit like the spell pool, and treat the
   current behaviour as a bug.
4. **Cheapest store printing.** All copies agree (cheapest finish across enabled-set printings,
   ties by printing id) except commanders, which prices by `cheapestPrice` and keeps no finish.
   Same answer in practice; proposed: one rule, finish kept.
5. **The deck's own cards.** Suggestions drops owned cards when `owned <= inThisDeck`
   afterwards in code; the others rely on the copy limit in `fitsDeck`. Proposed: the pool takes
   the deck context's `inDeck` list and excludes at the limit; suggestions keeps its extra
   "you'd have to take it from another deck" rule in the service.

## Proposed shape

- `decks/queries/candidate-pool.ts` is the only file with the owned-per-card and cheapest-for-sale
  SQL. It exports `ownedCards(userId, withReal, { printing: "byCopies" | "mostSpecial" })` and
  `cheapestForSale(userId, withReal, filter)` as SQL fragments, plus a `CandidateRow` shape.
- `decks/application/candidate-pool.ts` is the port the services use:
  `owned(filter) / forSale(filter) / byIds(ids)` returning one `Candidate`. The filter is typed
  (deck context, colours, tags, legality, price cap, rank, limit). Search-language conditions
  (search-for-deck) go through `filter.condition`, built in queries, because the search
  language compiles to SQL.
- Scoring and orchestration from `suggestions.ts` move to `application/suggest-cards.ts` using
  the port and the pure `domain/suggest`.

## Handoff

(empty; inventory above is the first step)
