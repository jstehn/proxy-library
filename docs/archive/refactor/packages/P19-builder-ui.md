# P19. Break up the deck builder UI

- **Branch:** `refactor/P19-builder-ui` · **Depends on:** P09b · **Parallel with:** waves 3–4,
  except P16 (both touch `stats/stats-panel.tsx`)
- **Audit:** doc 65 F8
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S9](../dedup-playbook.md#s9) · **Lines to remove:** about −300 to −800 (low confidence)

## Goal

The builder's state lives in one tested reducer, and each panel is its own component with its own
hooks and actions.

## Touches

`src/app/decks/[id]/builder/` (all): `deck-builder.tsx` (1,459 lines, 35 `useState`/`useEffect`),
`actions.ts`, `deck-list.tsx` (607), `snapshots-panel.tsx`, `primer-panel.tsx`.

## Steps

P09b already moved `actions.ts` onto `action()` and capabilities (≤ 350 lines). P19 doesn't change
what the actions do. When step 3 gives each panel its own `actions.ts`, move the existing
`action(...)` definitions there as they are.

1. Map the 35 hooks: which state is shared between panels, and which belongs to one panel.
2. Shared state goes into `builder-state.ts`: a `useReducer` with named actions and a pure
   reducer, unit-tested. Panel-only state moves into the panel.
3. One folder per panel (`list/`, `stats/`, `suggestions/`, `snapshots/`, `primer/`, `cuts/`,
   `test-hand/`), each with its component, hooks and an `actions.ts` for its server actions.
4. Check dark mode and phone width with screenshots, and run the builder's Playwright flow.

## Done when

- No file in `builder/` is over 500 lines (largest: `snapshots-panel.tsx`, 481), and none calls `getContainer` (the lint ratchet from P09b). The reducer has unit tests. The e2e builder flow passes.

## Handoff

**Done:**

- **One reducer.** `builder/builder-state.ts` (294 lines) holds what several panels share: the deck
  in hand, the message, the target bracket, which of the 8 panels are open, the role/bracket-rule
  highlight (one at a time), the selected card (with its detail, other decks and quantity) and the
  look-alikes. 24 named actions, a pure `builderReducer`, and `copiesOnBoards`. Tested in
  `builder-state.test.ts` (22 tests: optimistic quantity, move and merge up to 99, line edits,
  panels, highlights, stale detail / other-decks / look-alike answers ignored, copies taken).
  The old `useRef`s for "is this still the selected card" became checks inside the reducer.
- **Two hooks send the changes.** `use-deck-changes.ts` (every save: show at once, call the action,
  show the server's deck, undo on refusal) and `use-selection.ts` (select from grid, deck, or
  suggestion, and start the reads). `deck-builder.tsx` is 1,454 to 262 lines of composition.
- **Panel-only state moved into its panel.** The collection's filters and pages are in
  `collection/use-browse.ts`; the deck list keeps its view and tag filter; each panel keeps its own
  loading state, as before.
- **One folder per panel:** `collection/`, `selection/` (sheet, fields, printing picker),
  `list/` (`deck-list.tsx` 596 to 248, plus `groups.ts`, `list-line.tsx`, `heading-title.tsx`),
  `stats/`, `bracket/`, `suggestions/`, `cuts/`, `draft/`, `mana-base/`, `snapshots/`, `primer/`
  (plan actions renamed into it), `test-hand/`, `tokens/`. Each has its `actions.ts` where it has
  server actions: the P09b `action(...)` definitions moved as they were. `actions.ts`,
  `reads/` and `plan/` are gone. `shared-view.tsx` imports from the new paths.
- **Results.** `builderAction`, `ifInvalid`, `QuantityResult` and the server action `loadBuilderDeck`
  are gone; both removal-list rows are deleted. Every action is a plain `action(schema, handler)`.
  Handlers that can refuse return `Result<Value, Rejected>` (`answer.ts`: `{ kind: "Rejected",
message, deck? }`); a refusal carries the server's deck, which replaces `loadBuilderDeck` when a
  guess has to be undone. Components read the answer with `settle(answer, textForBadInput)` (changes
  and saves; the old `ifInvalid` sentences are now arguments) or `valueOr(answer, fallback)` (reads).
- **No feature changes intended.** Same buttons, labels, classes, keys and messages.

**Size (honest, `pnpm sizes`):** source lines 92,379 to 92,909 (+530), code lines 79,270 to 79,685
(+415), files over 500: 21 to 19 (`deck-builder.tsx` and `deck-list.tsx` left the allowlist). Test
lines +304. The playbook's −300 to −800 did not happen: the old file held little copy-pasted code
(the state was entangled, not duplicated), and the split added imports, prop types and the
reducer's action types for 14 new files. The result is structural: the biggest builder file is
481 lines, and shared state is one tested place.

**Not verified:** nothing was driven in a browser or by Playwright (not allowed here). The by-eye
and e2e checks are in `deferred-checks.md` under "Left by P19". `pnpm check` is green; no
integration tests were run (no SQL or wiring changed).

**Found but not done:**

- `startDeckAction` (`app/decks/commanders/actions.ts`) and `ListPreviewSummary` mapping
  (`app/decks/edit-as-text/actions.ts`) are removal-list rows that also name P19, but those files
  are outside the builder folder. They remain for P11 / P10.
- A failed `setQuantity`, `move`, `swap` or `addLands` still only shows the message and leaves the
  guess in place, as before. A refusal now carries the deck, so undoing is a one-line change if the
  owner wants it (product call, not made).
- Reads keep `null` for "not found or not yours" inside the `Ok` (`valueOr(answer, null)`); only
  the input-didn't-fit case is the `Err`. If a read should show an error to the player, that is a
  small change per panel.
- `selectSuggestion` is the same function as `selectFromGrid` (a suggestion is a grid card);
  `SuggestionCard` may be able to lose its alias.
