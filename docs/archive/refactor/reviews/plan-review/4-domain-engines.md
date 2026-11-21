# Plan review 4: the domain engines

Read-only review by an agent, 2026-11-19, on `refactor/main` at `48f18af`.

**Size:**

| Folder          | Lines  | Files |
| --------------- | ------ | ----- |
| `decks/domain`  | 12,352 | 49    |
| `drafts/domain` | 3,010  |       |
| `card-search`   | 3,561  |       |

## Findings, ranked

1. **Giant functions, and no package targets them.**
   - `stepGoldfishState` is 572 lines (a 17-case `switch`).
   - `draftDeck` is 498 lines.
   - Twelve more functions are 100 to 203 lines: `simulateCastOnCurve`, `playtestCard`, `optimizeDeck`,
     `applyChoices`, `recordDraft`, `rateCard`, `rankCuts`, `computeRatingFeatures`,
     `simulateOpeningHands`, `suggestSwaps`, `scoreDeck`, `fitLogisticWeights`.
   - Fix: a handler per case in a lookup table, as `sim-pipeline` already does.
   - `ctx` appears about 250 times.
   - About 32 unexplained decimal weights sit in `rate.ts`.
2. **Parallel scoring models.**
   - Three weight tables: `RATING_WEIGHTS`, suggest's `WEIGHTS` and `CUT_WEIGHTS`.
   - Two `toRatingProfile`, two role-gap types, and `optimize.scoreDeck`.
   - One scorer (`rateCard`) could serve suggest, cuts and draft-deck: about −300 to −500 lines. It
     changes behaviour, so it's the owner's call. No package covers it.
3. **Three mana-payment engines** (goldfish, castability and mana).
   - Four parsers of `{X}` costs.
   - Two `ManaColor` types.
4. **Four opening-hand engines** (P15 already plans one). `isEarlyPlay` and `isEarlyRamp` are copied
   word for word, and `creatureTypes` exists twice with different rules.
5. **The simulator's plugin options are speculative.** Seven injected options are used only by tests.
   Dropping them saves about −150 to −250 lines.
6. **About 130 oracle-text regexes** across the domain.
   - Four ways to strip reminder text.
   - 83 raw `/\bLegendary\b/.test(typeLine)` checks outside the kernel.
7. **Purity is good.** No `Date.now`, `Math.random` or `process.env`. There's one unexplained
   0.001 tie-break.

## Cluster map inside `decks/domain`

| Cluster | Files                       | What's in it                                                                                                                           |
| ------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Core    | about 20                    | `deck`, `format-rules`, `stats`, `boards`, `brackets`, `rules`, `snapshots`, `sharing`, …                                              |
| Advice  | about 16, about 5,000 lines | rate, signals, suggest, cuts, swaps, optimize, eval, replacements, upgrade-roadmap, draft-deck, mana-base, commanders, audit-report, … |
| Play    | 10                          | goldfish, goldfish-session, sim-pipeline, draws, mulligan-trainer, mana, mana-symbols, castability, deck-profile                       |
| Proxies | 4                           | proxy-sheet, playtest-card, token-proxies, proxy-progress                                                                              |

Tangles to fix **before** P18:

- Core imports advice, because `ProfileLine` lives in `suggest`.
- `castability` and `mana-base` form a type-level cycle.
- `audit-report` imports play.
- `suggest` and `suggestion-types` import each other.

## P18

- Play (10 files) and proxies (4) fit the planned split.
- Core (about 20) and advice (about 16) each break the 12-file rule.
- Option: split advice into **scoring** and **building**.
- Rename `draft-deck` (for example `build-from-collection`), so it isn't confused with the `drafts`
  module.

## Doc 66 and P12–P15

Today they move regexes rather than delete them.

- P11 adds about +600 to +900 lines before any saving.
- `faces-and-types` is a weak first recognizer: it deletes nothing and makes every consumer load
  features.

Options:

- Keep `cardTypes` as the pure type-line helper, and point the 83 raw checks at it.
- Ship a first recognizer that deletes an old function (tap mana, or tags).
- Add a ratchet on the count of oracle-text regexes.
- Slice P12–P14 by ability rather than by consumer file. Each slice adds its recognizer, switches the
  consumers, deletes the old function and its tests, and removes the allowlist entry.
- Merge a slice only if it's net zero or smaller.

## Estimated saving if done well

About −1,400 to −2,600 lines in these folders:

| Work                                  | Saving       |
| ------------------------------------- | ------------ |
| Recognizer glue                       | −400 to −900 |
| Opening hands                         | −400 to −700 |
| One scorer                            | −300 to −500 |
| Simulator options and payment parsers | −250 to −450 |

Splitting long functions doesn't remove lines.

## Questions for the owner

- Is the hybrid `deckFit` + `rateCard` score deliberate, or can one scorer win?
- Should the type-line helper stay pure in the kernel, with features covering oracle text only?
- Are the simulator's injectable plugins needed, or are they test scaffolding?
- Is splitting advice into scoring and building OK under decision 4?
- Are the weights fitted or hand-tuned? Either way, document which.
