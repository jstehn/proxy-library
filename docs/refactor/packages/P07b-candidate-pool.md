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

## Handoff

(empty)
