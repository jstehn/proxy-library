# 0019. Store what each card does, worked out by the catalog sync and versioned

- **Status:** Accepted (design doc 20; written after review, 2026-10-06)
- **Date:** 2026-10-06

## Context

Phase 19 gave every card **role tags** (ramp, draw, removal, …) read from its rules text by a
table of regular expressions in `src/shared/card-search/tags.ts`. The deck builder works them out
in the browser for the cards in one deck, which is cheap. Phase 20's suggestions need the
opposite: from the **whole catalog** (about 76,000 printings), find the cards with a given role or
theme (tokens, +1/+1 counters, …). Matching rules text in SQL took about 0.6 s per search on the
real catalog, before any scoring, and the rules would have had to be written twice (JavaScript
for the builder, SQL for the search) and kept the same.

This decision was made during the overnight run of 2026-10-02 → 03 and recorded here after
review.

## Decision

- Each printing **stores its features**: `printings.role_tags` and `printings.theme_tags` (text
  arrays with GIN indexes), and `printings.features_version`.
- The catalog sync works them out in a **tag pass** (step 5b, `tagPass` in
  `catalog/application/sync.ts`), after prices because ramp reads the mana a card makes. It tags
  only printings whose `features_version` is below `CARD_FEATURES_VERSION`, in batches, so a
  normal night tags only new printings. `pnpm worker tag-cards` runs the pass alone.
- The rules stay in **one place**, `src/shared/card-search/tags.ts` (pure, ADR 0017): the sync
  calls the same `cardTags` and `cardThemes` the builder calls in the browser.
- **Changing a rule means bumping `CARD_FEATURES_VERSION`.** The next sync then tags every
  printing again (about 17 s for the whole catalog).
- Queries filter on the stored arrays in SQL (`role_tags && array[…]`) and rank in TypeScript
  (design doc 20, "filter in SQL, rank in TypeScript").

## Consequences

- Suggestion queries take 100–600 ms on the real catalog, and there's one set of rules.
- The catalog now stores an idea that comes from deck building (what a card does in a deck).
  It's derived only from catalog data, so it belongs with the printing, but the catalog sync now
  depends on `shared/card-search`.
- The decks module's queries read these columns (cross-module reads, ADR 0006), so renaming them
  touches decks too.
- **Stored features can be stale.** If someone changes a rule and forgets to bump the version,
  the builder (which works tags out live) and the suggestions (which read stored ones) disagree.
  The version constant's comment says this; a review of any change to `tags.ts` should check it.
- **A fresh database, or one just migrated, has no features** until a sync or
  `pnpm worker tag-cards` runs. Until then, suggestions are empty. The nightly sync fixes this
  by itself.

## Alternatives considered

- **Compute per request** (match rules text in SQL): simpler, nothing to keep up to date, but
  about 0.6 s per search and the rules written twice.
- **Compute in TypeScript over the whole catalog per request:** one set of rules, but reads
  76,000 printings' text for each suggestion.
- **A separate `card_features` table:** keeps the catalog's own table unchanged, but adds a join
  to every suggestion query for the same data, one row per printing.
- **Tag per oracle card instead of per printing:** fewer rows, but the catalog's queries and the
  search language (ADR 0017) work on printings, so every query would need one more join.
