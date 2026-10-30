# 0020. Import every paper set's printings, as reference sets, for real collections

- **Status:** Accepted (design doc 16, approved 2026-10-01; built 2026-10-29)
- **Date:** 2026-10-29

## Context

Until phase 16 the catalog held **what can be sold**: enabled sets (bought from) and supporting
sets (whose cards an enabled set's boosters or precons use). The real collection (design doc 16)
needs **every paper card**, because the cards people own come from promos, Secret Lairs, Masters
sets, old core sets, and so on. Of MTGJSON's 810 paper sets, about 300 had their printings in the
catalog.

Two things had to stay true: nothing new is sold, and the nightly price table doesn't grow by
tens of thousands of printings that nobody owns.

## Decision

- The sync imports **every other paper set's printings once**, as a **reference set**: printings
  only, no booster recipes, products or decks, the same way supporting sets are imported. A
  nightly run takes **at most 40** (`REFERENCE_SETS_PER_RUN`), newest first, so no night is long;
  a full run (asked for by an admin, or `pnpm worker sync full`) takes every set still waiting.
  Once imported, a reference set isn't imported again, even by a full run.
- `card_sets.printings_imported_at` records when a set's printings were last imported, by any
  kind of import (full, supporting or reference). A reference set is one with printings that is
  neither enabled nor supporting.
- A reference set **isn't sold**: every store, pack and draft query already reads only enabled
  sets. Enabling it later imports it fully. One that an enabled set starts to draw from becomes
  a supporting set.
- **Prices:** snapshots stay limited to enabled and supporting sets, plus **printings someone
  owns for real**. The catalog asks for those through a port it owns, `ExtraPricedPrintings`.
  The composition root fills it from the real collection, so neither module imports the other.
  Images and legalities are stored for every printing, so real cards look like game cards.

## Consequences

- Real collections can hold any paper card, and their value works for the cards actually
  owned.
- The catalog's job is now "every paper card", and "what can be sold" is a property of a set
  (`is_enabled`). New queries that sell or open things must keep filtering on it.
- The first syncs after this change download about 500 set files (up to about 1 MB each): 40 a
  night (about two weeks), or all at once in one full sync. Until then, a card from a set not yet
  imported shows as "no card has that name" in an import. A set file that fails
  is reported like any other failed set and retried on the next run, because its
  `printings_imported_at` stays empty.
- The `printings` table roughly doubles. Every query that searches all printings (the matcher,
  card search) must stay batched and indexed.

## Alternatives considered

- **Import every set fully and mark them unsold:** brings in boosters and products nobody can
  buy, and many old sets' products refer to cards MTGJSON lists elsewhere.
- **Look up unknown cards from Scryfall when importing:** a network call in a player's request
  (against ADR 0007's politeness and our offline tests), and the result still needs a home.
- **Price every printing every night:** about 160,000 snapshots a day, mostly for cards nobody
  owns.
