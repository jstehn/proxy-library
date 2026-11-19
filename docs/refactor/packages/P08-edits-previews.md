# P08. Deck edits and previews

- **Branch:** `refactor/P08-edits-previews` · **Depends on:** P05 · **Parallel with:** P06, P07
- **Audit:** doc 65 F2 (previews), D9

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

(empty)
