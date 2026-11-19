# P18. Split `decks` by responsibility

- **Branch:** `refactor/P18-split-decks` · **Depends on:** P10–P17, **decision 4** · **Parallel with:** none (moves files everywhere)
- **Audit:** doc 65 F1 · **Starts wave 5**

## Goal

`decks` stops doing five jobs. Each job gets its own public API, and no `index.ts` is over 500
lines.

## Touches

All of `src/modules/decks/`, `eslint.config.mjs` (boundaries), `src/server/core.ts`, imports
across `src/app` and bindings. New `docs/adr/0028-split-decks.md`.

## Steps

1. **ADR 0028** with the module list from decision 4. The proposal: `decks` (lists, legality,
   headings, snapshots, sharing), `deck-play` (opening hands, goldfish, simulator), `deck-advice`
   (rating, suggestions, optimizer, swaps, embeddings, combos, brackets, candidate pool),
   `proxies` (sheets, playtest cards, token proxies, PDF). Draw the allowed dependency arrows.
   Get the user's approval.
2. Keep the layer folders inside each new module (ADR 0001). If one of them still has more than
   about 12 files, that's a sign of a fifth responsibility: say so in the ADR, don't hide it in
   subfolders.
3. Move files with `git mv`, one new module per commit. Each gets `index.ts`, `client.ts`,
   `testing/`.
4. Update the boundary lint and the cycle check. Fix imports.
5. Update `docs/architecture/overview.md`'s module table and graph.

## Done when

- `pnpm check` is green, including the cycle check and the new boundaries. Every `index.ts` is
  under 150 lines, and no folder has more than 12 source files. Milestone 3 can start once P20 and P21 are done.

## Handoff

(empty)

## Added from P07b2

Move the suggestion orchestration (`deckSuggestions`, `similarCards`, `budgetList`,
`budgetReplacements` in `queries/suggestions.ts` and `budget-replacements.ts`) into
`application/suggest-cards.ts` behind a `CandidatePool` port, with fake-pool unit tests. It
brings `queries/optimize.ts` and `queries/upgrade-roadmap.ts` (they call `deckSuggestions`) and
the `BrowseCard`/`SuggestionCard` types (to `domain/`) with it. See the P07b2 handoff.
