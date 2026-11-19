# P08. Deck edits and previews

- **Branch:** `refactor/P08-edits-previews` · **Depends on:** P05 · **Parallel with:** P06, P07
- **Audit:** doc 65 F2 (previews), D9
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S1](../dedup-playbook.md#s1) (`edit_deck`, `update_deck`, `create_deck` rows) · **Lines to remove:** about −700 to −1,000

## Goal

Changing a deck (one card, a whole list, headings, printings, snapshots) is a set of capabilities
that both adapters use. A dry run is a stored preview that survives restarts.

## Touches

`src/modules/decks/application/manage-decks.ts` (834 lines: split by job), new
`decks/application/previews.ts`, `decks/infrastructure/` (preview repository and table), a
`drizzle/` migration, the `edit_deck` binding, the builder's edit actions (`setQuantityAction`
and similar). **Avoid:** read actions (P06).

## Steps

1. Split `manage-decks.ts` by job (entries, list replacement, headings, printings, snapshots),
   each file under 500 lines, with one factory per file wired in `core.ts`.
2. `previewChanges(actor, input)` returns `{ previewId, report }` and stores the preview behind a
   `PreviewRepository` port (`deck_change_previews` table with `expires_at`; the goldfish session
   table is the model). `applyPreview(actor, previewId)` applies it if the deck hasn't changed
   since (compare fingerprints). This replaces `pendingPreviews` in `tools/decks.ts`.
3. The `edit_deck` binding covers `save=false` (preview) and `save=true` (apply), as the tool
   does today.
4. The builder's edit actions call the same capabilities. (A "review before saving" button can
   use previews later; that's backlog, not this package.)
5. Delete the old code and its tests; write new ones (fake repository, plus one integration
   test for the table).

## Done when

- No module-level `Map` holds request state: `grep -rn "new Map<" src/app` shows only lookup
  tables.
- `manage-decks.ts` is gone (split).

## Handoff

**Done:**

- `manage-decks.ts` (834 lines) is gone. Six factories by job, each under 310 lines, composed in
  `make-decks.ts` (so `container.decks` keeps its shape): `deck-lifecycle` (create, update,
  delete, copy, from cards), `deck-entries` (counts, notes, role/pin, moves, `applyChanges`),
  `deck-lists` (import, replace), `deck-headings`, `deck-printings`, `deck-snapshots`.
- **Stored previews.** `deck_change_previews` table (migration 0049; id, user, deck, fingerprint,
  the resolved changes as JSON, `expires_at`) behind a `PreviewRepository` port
  (`drizzleChangePreviewRepository`). The `deckPreviews` capability (`decks/application/deck-previews.ts`)
  has `previewChanges` (dry run and store), `saveChanges` (dry run and save with a fingerprint) and
  `applyPreview` (commit a stored preview). It returns structured warnings (key card cut, avoid card
  added); the binding words them. The module-level `pendingPreviews` map is gone, and previews now
  survive a restart. Expired ones are pruned each time one is stored.
- **Bindings:** `edit_deck`, `update_deck` and `create_deck` (with `present/deck-preview.ts`). New
  capabilities behind them: `startDeck` (create, bracket, first list), `deckPlanEdits` (profile,
  primer, research source) and `deckEdits` (the decks use cases `createDeck`, `updateDeck`,
  `deleteDeck`, `importList`, `replaceList`). The builder's plan panel (`saveDeckPlanAction`) saves
  through `deckPlanEdits`, the same as `update_deck`.
- **Deleted:** `apply_changes`, `replace_deck_list`, `create_deck`, `update_deck`, `delete_deck`,
  `set_deck_profile`, `set_primer`, `deck_sources` (internal tools) and the two consolidated
  wrappers. `tools/decks.ts` is down from 1,223 to about 300 lines (EDHREC only, for P09).
  `DeckChangePreview` moved to `decks/domain/preview.ts` (the application layer may not import
  queries).
- **Checked:** `edit_deck`, `create_deck` and `update_deck` regenerate identical reference outputs
  (only the order-of-run noise below). Gate: `pnpm check` and 281 integration tests green.
  Unit tests for the capability (fake repository), the three bindings, and an integration test for
  the table (store, find for its own player only, expiry, prune, delete with the deck).

**Changes in behaviour (small, on purpose):**

- `update_deck`'s `format` was a list that included `"other"`, which is not a deck format (it would
  have been written to the deck). It now uses the real list (`FORMATS`: adds `casual` and
  `limited`, drops `other`).
- The profile and primer warnings (unknown key card, card not in the deck) are gone. Their values
  were thrown away by the public `update_deck` already, so no caller saw them.
- Applying a stored preview by `previewId` re-runs the dry run on the (unchanged) deck instead of
  replaying a stored copy. The answer is the same; the stored row is small.

**Notes:**

- **Lines:** source 91,887 (was about 91,780). Not the −700 to −1,000 the playbook hoped for: the
  old tools shed about 1,100 lines, and the capability, port, table, repository, three bindings
  and presenter added about as much. The split adds only headers. The next savings come with P09
  (the rest of `tools/` and the legacy list) and P18.
- **Not done (left for later packages):** the builder's `setQuantityAction` and the Edit as text
  box still call `getContainer().decks.*` directly. They already share the use cases with the
  tools (`decks.setEntry`, `replaceList`), so there is no second copy of the logic; they move onto
  `action()` in P19. A "review before saving" button for the builder could use `previewChanges`
  (backlog).
- `docs/refactor/reference/tools/*.json` regenerate with small differences (`targetBracket: null`,
  an extra deck in `list_decks`): the script runs tools in registry order and `create_deck` now
  runs first. Left as is.
