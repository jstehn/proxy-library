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

**Done:**

- `describeDeckError` (`decks/application/describe-error.ts`): one exhaustive `switch` over every
  decks error kind. It replaces the 11 inline `Record<string, string>` maps in
  `builder/actions.ts`. The wording is now the same in the builder and for the model (a few
  messages got slightly more specific; e.g. heading failures no longer say "That change wasn't
  understood").
- `deckOverview` (`application/deck-overview.ts`): one read of a deck: view, stats, problems,
  bracket, combos, list text and fingerprint, plus parts on request (`printings`, `tokens`,
  `sources`, `profile`, `odds`). Readers are ports; fakes in `decks/testing/deck-view.ts`.
  Shared pure helpers in `domain/deck-reads.ts` (`problemsOfLines`, `bracketReport`,
  `listAndFingerprint`) replace the copies in `_llm-tools/tools/decks.ts`, the builder's
  `derive.ts` and the deck page (which had its own list/fingerprint code).
- Small capabilities for what `get_deck` can add: `deckFacts`, `deckSignals`, `deckManaPlan`.
- `get_deck` is a binding (`bindings/get-deck.ts`, 89 lines). Its output shaping moved to
  `_llm-tools/present/get-deck*.ts` (compact, full, card details). The old `get_deck`, its
  internal tools (`getDeck`, `deck_facts`, `mana_base_skeleton`, `get_deck_profile`) and
  `fullDeckPayload`/`compactDeckPayload` are deleted.
- The builder (`loadBuilderDeck`, `tokensAction`, `deckPlanAction`, `manaBaseAction`) and the
  deck page read through the capabilities. Types `DeckLine`, `DeckView`, `OtherDeckUse`,
  `DeckSource`, `StoredDeckProfile`, `DeckAuditReport`, `ManaBasePlanWithCastability` moved to
  `domain/` so `application/` can name them.
- **Checked:** the new binding and the old tool gave identical JSON for 10 inputs (compact, full,
  every `include`, `cards`, `boards`, `cursor`, a missing deck). The reference outputs are
  unchanged. `pnpm check` and the integration suite (265) pass.

**Deviations and notes:**

- `create_deck` and `update_deck` stay with P08 (the dedup playbook's S1 table gives them to
  P08, and they share its write capabilities). Their old tool code is untouched.
- Builder read actions that still use `getContainer().db`: `browseAction`, `cardDetailAction`,
  `otherDecksAction`, `takeFromDeckAction`, `printingsAction`, `suggestionsAction`,
  `optimizeDeckAction`, `draftDeckAction`, `similarAction`, `budgetAction` and the snapshot
  reads. They belong to P07 (candidates, suggestions, similar, budget) and P08 (snapshots,
  take). `builder/actions.ts` is 759 lines (was 842); P07/P08 take it below 350.
- `get_deck` drops the internal-only `tag`, `singleTagOnly` and `fields` filters. The public
  tool never passed them.
- `describeError` in a binding now receives the request too (`BindingRequest`), so
  "Deck 12 isn't yours" can name the id.
- The shared deck page still loads the deck twice (`deckForViewer`, then `deckOverview`);
  `deckForViewer` should return only the access answer. The owner path did this before.
- Source lines 91,358 → 91,537 (+179). The new capabilities and shaping are in; the old
  `_llm-tools/tools/decks.ts` is 2,145 → 1,223. The rest of that file (edit tools, profile,
  primer, sources) goes with P08. This package adds lines; the saving comes when P08 and P09
  delete the legacy edit tools and `consolidated.ts`.
