# Design: Calibrated weights per `PowerTier`, `upgrade_roadmap`, and `diff_deck`

- **Phase:** 57 (Deck-AI Phase 5, tududi #157)
- **Status:** Draft → In review → **Approved** (2026-11-13)
- **Related ADRs:** 0016 (client-safe module API), 0022 (LLM tool API), 0023 (process sized to feature)
- **Lesson:** no (extends `rate.ts`, `eval-ratings.ts`, `swaps.ts`, `snapshots.ts`, and `optimize.ts`)

## 1. Purpose & scope

Complete the Deck-AI & Optimizer roadmap with calibrated scoring weights and two iteration/planning MCP tools:

1. **Calibrated `RATING_WEIGHTS_BY_TIER` (`rate.ts` + `scripts/eval-ratings.ts`):**
   - Extract `ratingFeatureVector` in `rate.ts` so both `rateCard` and logistic-regression calibration share the exact same feature computation.
   - Add `fitLogisticWeights` (L2-regularized gradient descent on binary cross-entropy) and `--calibrate` mode to `scripts/eval-ratings.ts` to fit weights per `PowerTier` (`casual`, `upgraded`, `optimized`) against held-out Commander decklists and print before/after Recall@50 & MRR.
   - Update `RATING_WEIGHTS_BY_TIER` in `rate.ts` with calibrated weights that improve hold-out metrics without breaking existing `rate.test.ts` invariants.
2. **`upgrade_roadmap` (`domain/upgrade-roadmap.ts` + `queries/upgrade-roadmap.ts` + MCP tool):**
   - Builds a tiered cut/add swap roadmap across budget tiers (default `[2500, 7500, 20000]` cents = `$25 / $75 / $200`).
   - Pairs `rankCuts` cut candidates with legal store `scoreForDeck` upgrades within each tier's incremental budget, computing cumulative cost and projected `scoreDeck` delta per tier.
3. **`diff_deck` (`queries/snapshots.ts` + MCP tool):**
   - Ergonomic read-only snapshot comparison defaulting `beforeSnapshotId` to the deck's most recent saved snapshot and `afterSnapshotId` to the live deck.
   - Reuses `compareDeckSnapshot` and `formatSnapshotComparison`, enriched with `scoreBefore`, `scoreAfter`, and `scoreDelta` from `scoreDeck`.

## 2. Domain & query design

- **`src/modules/decks/domain/rate.ts`:**
  - `RatingFeatureVector` & `ratingFeatureVector(card, profile, options)` returning raw feature values matching `rateCard` parts.
  - `fitLogisticWeights(samples, initialWeights, options)` using L2-regularized logistic regression over feature vectors.
- **`src/modules/decks/domain/upgrade-roadmap.ts`** (pure, browser-safe):
  - `buildUpgradeRoadmap(input)` takes `format`, `targetBracket`, `currentDeck`, `cuts`, `candidates`, and `tiersCents` (sorted ascending, unique), greedily pairing non-overlapping cuts and adds within each tier's budget and scoring the resulting deck with `scoreDeck`.
- **`src/modules/decks/queries/upgrade-roadmap.ts`:**
  - `deckUpgradeRoadmap(db, userId, deckId, { tiersCents? })` loads `deckView`, `combosForDeck`, `rankCuts`, store candidates via `suggestionContext` + `storeCandidates` + `withinTarget` + `embedSimForCards`, and calls `buildUpgradeRoadmap`.
- **`src/modules/decks/queries/snapshots.ts`:**
  - Extend `compareDeckSnapshot` (or add `diffDeckWithScore`) to compute `scoreDeck` for `beforeLines` and `afterLines` so `diff_deck` reports `scoreBefore`, `scoreAfter`, and `scoreDelta`.

## 3. Invariants

1. **Single feature path:** `rateCard` and `fitLogisticWeights` consume the same feature extraction logic.
2. **Read-only:** `upgrade_roadmap` and `diff_deck` have `scope: "read"`, `readOnly: true`, and never mutate deck state.
3. **Bracket & legality respect:** `upgrade_roadmap` respects `withinTarget` so Bracket-capped decks are never recommended Game Changers or illegal cards.

## 4. Test plan

- **Unit tests:**
  - `rate.test.ts`: `ratingFeatureVector` matches `rateCard` logit, and `fitLogisticWeights` separates positive vs. negative synthetic samples.
  - `upgrade-roadmap.test.ts`: respects tier budgets, does not reuse the same cut/add across tiers, and computes `scoreDelta`.
- **Integration & registry checks:**
  - `tests/integration/embeddings.int.test.ts`: verify `deckUpgradeRoadmap` and `diff_deck` snapshot comparison.
  - `direnv exec . pnpm check` verifies typecheck, lint, cycles, format, and all unit tests including `registry.test.ts`.
