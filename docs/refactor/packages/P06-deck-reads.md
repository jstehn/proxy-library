# P06. Deck read capabilities

- **Branch:** `refactor/P06-deck-reads` · **Depends on:** P05 · **Parallel with:** P07, P08
- **Audit:** doc 65 F2, F6, D8, D9
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S1](../dedup-playbook.md#s1) (`get_deck` row) and [S2](../dedup-playbook.md#s2) (deck reads) · **Lines to remove:** about −800 to −1,200

## Goal

The UI and the model read a deck through the same functions: `deckOverview` (sections on
request), `deckProblems`, `deckBracket`, plus the decks module's error text.

## Touches

`src/modules/decks/application/` (new `deck-reads.ts`, `describe-error.ts`),
`src/modules/decks/queries/{decks,audit,mana-base,card-facts,deck-combos}.ts` (orchestration moves
out; SQL stays), `src/app/decks/[id]/builder/{actions,derive}.ts` (read actions only),
`src/app/decks/[id]/page.tsx`, bindings `get_deck`, `create_deck`, `update_deck`.
**Avoid:** `queries/suggestions.ts` (P07) and edit actions (P08).

## Steps

1. List what `get_deck` returns today (`docs/refactor/reference/tools/get_deck.json`) and what the
   builder's `loadBuilderDeck` returns. Design `deckOverview(actor, deckId, sections)` to cover
   both. Each section is computed only when asked for.
2. Move `problemsOf`, `bracketOf`, `listAndFingerprint` and `cardsBehindRoleCounts` (from
   `_llm-tools/tools/decks.ts`) and `builder/derive.ts`'s problem logic into `decks` capabilities.
   Use `isPlayed` for board filters.
3. Read ports for what the queries load. The queries implement them; fakes go in
   `decks/testing/`.
4. `describeDeckError(error)`: an exhaustive `switch` ending in `assertNever`. It replaces the 8
   `Record<string, string>` maps in `builder/actions.ts` and the tools' own error text.
5. Bindings for `get_deck`, `create_deck`, `update_deck`. The builder and deck page call the same
   capabilities, with no `getContainer().db` in these actions.
6. Delete the old tool code and the old tests for what moved. Write new unit tests against fakes.

## Done when

- The three tools come from bindings. `builder/actions.ts` read actions have no `db` access.
- Allowlist: `_llm-tools/tools/decks.ts` is shorter, `builder/actions.ts` is under 500 lines or has a reason.

## Handoff

(empty)
