# 0027. One versioned `CardFeatures` model, built by recognizers and stored per oracle card

- **Status:** Accepted (user, 2026-11-19; design doc 66, section 12)
- **Date:** 2026-11-19
- **Extends:** 0019

## Context

ADR 0019 stores role tags, themes and bracket flags per printing, worked out at sync. Everything
else that reads rules text (the simulator, mana and castability, the deck profile, the rules
checks, two signals systems, land checks) parses it again at run time with its own regexes: about
11 files and 4,800 lines (doc 65, F4). Where those copies disagree, a card is "ramp" in one place
and not in another, and the faces of a two-face card are glued together three different ways.

Doc 65's decision 3 asked whether to compute features at sync or on load. Features are read in
23 files, including deck building, and the search and suggestion SQL filter on them over the
whole catalog, so they are **computed at sync and on update, and stored**.

## Decision

- **One pure function**, `extractFeatures(cardText)`, in `src/modules/catalog/domain/features/`,
  returns `CardFeatures`: faces and types, mana production, cost changes, cast permissions,
  triggers, effects, role tags, themes, signals, land facts.
- It runs a **registry** of recognizers, `{ id, field, recognize }`. Each field has one owning
  recognizer; each regex over card text lives in exactly one recognizer, with a fixture test on
  real card text (`tests/fixtures/features/`). A lint rule forbids text regexes elsewhere.
- Features are **stored per oracle card** in `card_features` (jsonb plus the GIN-indexed arrays
  the SQL filters need), with `features_version`. This replaces ADR 0019's per-printing columns
  (dropped in P13).
- **One integer `FEATURES_VERSION`.** A golden test over the fixture cards fails when output
  changes without a bump. A sync step and `pnpm worker sync features` recompute rows below the
  current version. A reader that finds a missing or old row computes and saves it (lazy repair),
  so a deploy never serves empty features.
- Consumers read `CardFeatures` through `catalog.cardFeatures(oracleIds)` and never read oracle
  text. The package split is P11 (model, storage, faces and types), P12 (mana and casting),
  P13 (tags, themes, signals), P14 (lands, types, drafts).
- Moving code into a recognizer does not change what it answers. Improvements are separate,
  tested commits with a version bump.

## Consequences

- A new ability is one recognizer and its fixture test, not an edit in five files. The
  simulator stops building regexes per game event.
- `shared/card-search` returns to being the search language; the tag, theme and bracket word
  lists move to the kernel because the parser needs them.
- The catalog's domain now holds card rules (as ADR 0019 already noted for tags). The catalog
  sync depends on the recognizers; consumers depend on the catalog's public API.
- Stored features can still be stale between a version bump and the next sync. Lazy repair
  covers readers that go through `cardFeatures`; SQL filters (`tag:`, `theme:`) only see rows at
  the current version until the pass runs.
- Two version counters coexist during P11 to P13 (the old printings columns and the new table).
  P13 deletes the old one.
- Open product questions (what "ramp" means, joining faces, one signals vocabulary, keywords,
  tokens, cost reducers, land cycles) are listed in doc 66 and decided by the user before the
  packages that touch them.

## Alternatives considered

- **Compute on load and cache** (decision 3's other branch): fine for speed (2.0 s for the
  catalog, 5 ms for a deck's tags), but SQL cannot call it, and every consumer would need the text
  at hand.
- **Keep per-printing storage** (ADR 0019): no join, but 2.6 times the work and the copies can
  disagree between reprints. Left to the user as doc 66, question 1.
- **A version per recognizer:** re-runs only what changed, but a whole-catalog run takes about
  2 s, so one integer is enough.
- **Leave the regexes where they are and add a lint rule:** stops new copies, removes none.
