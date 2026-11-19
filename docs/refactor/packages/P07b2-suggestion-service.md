# P07b2. Suggestion service

- **Branch:** `refactor/P07b2-suggestion-service` · **Depends on:** P07b · **Parallel with:** P08
- **Audit:** doc 65 F6, D2
- **Recipe:** [dedup playbook](../dedup-playbook.md), S2 (the scoring half) · **Lines to remove:** about −400 to −600 (mostly by moving, then by dropping duplicates)

## Goal

The scoring and orchestration in `decks/queries/suggestions.ts` (978 lines) becomes an application
service that reads candidates through a `CandidatePool` port, so it can be tested with a fake pool.
`suggestions.ts` ends under 500 lines of SQL readers (or is split by what it reads).

## Touches

`src/modules/decks/queries/suggestions.ts` (and `semantic-search.ts`, `deck-combos.ts`, which call
its readers), new `decks/application/candidate-pool.ts` (the port and the `Candidate` type) and
`decks/application/suggest-cards.ts` (`deckSuggestions`, `similarCards`, `budgetList`,
`budgetReplacements`), `src/server/capabilities.ts`, the builder's `suggestionsAction`,
`similarAction`, `budgetAction`. **Avoid:** the tool bindings (P07c).

## Steps

1. Split `suggestions.ts` by what each function does: SQL readers (`ownedCandidates`,
   `storeCandidates`, `ownedCandidatesForIds`, `candidateColumns`, `fitsDeck`, `edhrecCte`) stay in
   `queries/`; `deckSuggestions`, `similarCards`, `budgetList`, `budgetReplacements`, `best`,
   `wantedFor`, `withinTarget` and `countScoring` are orchestration or scoring.
2. Define the `CandidatePool` port from what those four functions ask for (`owned`, `forSale`,
   `byIds`, with the context). One `Candidate` type (today `SuggestionCard`).
3. Move the four functions to `application/suggest-cards.ts` with the pool and the existing
   `domain/suggest` and `rate` functions. Write fake-pool unit tests first for what they do today
   (the integration tests in `suggestions.int.test.ts` pin the SQL side).
4. Wire in `capabilities.ts`; the builder actions call the capability through `action()`.
5. Delete the old versions; remove `suggestions.ts` from `oversize-allowlist.txt` once under 500.

## Done when

- `queries/suggestions.ts` is under 500 lines (and off the allowlist).
- The four functions have unit tests with a fake pool; the builder actions have no `db` access.

## Handoff

**Done (mechanical split, no behaviour change):** `queries/suggestions.ts` 978 lines is now
four files by job: `suggestion-types.ts` (74: `SuggestionCard`, `Suggestion`, `SuggestionList`,
`SuggestionContext`, `Wanted`), `suggestion-sql.ts` (301: `fitsDeck`, `candidateColumns`,
`ownedCandidates`, `storeCandidates`, `ownedCandidatesForIds`, `toCard`), `suggestions.ts` (417:
`suggestionContext`, `deckSuggestions`, `similarCards`, `budgetList`, scoring helpers) and
`budget-replacements.ts` (244). Importers point at the right file (no re-exports). `suggestions.ts`
is off the oversize allowlist. `pnpm check` and the 278 integration tests pass.

**Not done: the `CandidatePool` port and `application/suggest-cards.ts`.** Reason found while
doing it: `deckSuggestions` is also called by `queries/optimize.ts` and
`queries/upgrade-roadmap.ts`, and `similarCards`/`budgetReplacements` carry inline SQL (nearest
neighbours, the target card, pinned cards). Moving the orchestration to `application/` means
moving those two callers with it and extracting about a dozen readers, and the types
(`SuggestionCard` extends `BrowseCard`, which lives in `queries/browse.ts`) into `domain/`. That
is the same restructure P18 does for the whole `decks` module (queries that do a service's job),
so doing it here would be done twice. Recommendation: fold it into P18 (add a line to its brief),
and treat P07b2's goal as met for size and file-by-job; the fake-pool tests come with the move.
