# Design: Whole-deck scoreDeck objective and Simulated Annealing optimizeDeck

- **Phase:** 55 (Deck-AI Phase 3, tududi #155)
- **Status:** Draft → In review → **Approved** (2026-11-13)
- **Related ADRs:** 0008 (injected `Rng`), 0016 (client-safe module API), 0022 (LLM tool API), 0023 (process sized to feature)
- **Lesson:** no (builds directly on `rate.ts`, `stats.ts`, `signals.ts`, `swaps.ts`, and `suggestions.ts`)

## 1. Purpose & scope

Individual 1-for-1 swap heuristics (`suggestSwaps`) evaluate each card against a static snapshot of the deck. Replacing several cards at once shifts role counts, mana curve, color pip balance, and internal synergy together.

This phase adds:

1. **Pure whole-deck objective (`scoreDeck`):** Computes a transparent, multi-factor deck score (`total` + component breakdown) from a complete list of cards, re-evaluating `rateCard`, role deficits, mana curve, color balance, signal/embedding cohesion, bracket compliance, and added budget against the candidate deck state.
2. **Simulated Annealing optimizer (`optimizeDeck`):** Uses an injected `Rng` (`src/shared/kernel/rng.ts`) to search multi-card swap combinations (up to `maxSwaps`) over an owned or store candidate pool, accepting uphill moves and probabilistically accepting temporary downhill moves early in the cooling schedule to escape local maxima, while tracking the global best state found.
3. **`optimize_deck` MCP tool + Builder preview:** Exposes `optimizeDeckForView` as a read-only MCP tool (`optimize_deck`) and a Builder UI preview action in `CutsPanel` so players can inspect before/after score breakdowns and apply suggested swaps.

**Out of scope:**

- `audit_deck` and `simulate_opening_hands` (Phase 56 / #156).
- Logistic-regression / GBDT calibrated weights per `PowerTier` (Phase 57 / #157).

## 2. Ubiquitous language

| Term              | Meaning in this codebase                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DeckScore`       | Composite whole-deck objective value (`total`) plus component scores (`cardQuality`, `roleCoverage`, `curveScore`, `colorBalance`, `synergyCohesion`) and penalties (`bracketPenalty`, `budgetPenalty`). |
| Swappable slot    | A non-land, non-commander, non-locked card on the `main` board that the optimizer may swap out for a candidate.                                                                                          |
| Cooling schedule  | Exponential temperature decay `temp = initialTemp * coolingRate^step` controlling acceptance of worse intermediate states (`exp(delta / temp)`).                                                         |
| Global best state | The highest-`DeckScore` configuration observed across all SA iterations, returned regardless of the final cooled state.                                                                                  |

## 3. Domain model (`src/modules/decks/domain/optimize.ts`)

Pure and browser-safe (exported from `src/modules/decks/client.ts` and `src/modules/decks/index.ts`):

- **`scoreDeck(cards, context)` -> `DeckScore`**:
  - Computes `deckStats` and `deckProfile` on `cards`.
  - Evaluates each non-land `main` card with `rateCard` against the live `RatingProfile` of `cards` to get `cardQualityMean` (0–100).
  - Computes:
    - `roleCoverage` (0–100): penalizes deficits below `roleTargets(format)` for `ramp` and `draw`.
    - `curveScore` (0–100): rewards balanced low-MV curve and penalizes `averageManaValue` above format target (`3.2` Commander, `2.5` 60-card).
    - `colorBalance` (0–100): compares colored mana pip share against mana source share across `MANA_COLORS`.
    - `synergyCohesion` (0–100): combines internal `produces -> consumes` signal match density with optional `pairSimilarity` mean.
    - `bracketPenalty`: heavy penalty when `targetBracket !== null` and the deck's Game Changer / MLD / extra-turn count exceeds the bracket's allowance.
    - `budgetPenalty`: penalty when `maxAddedPriceCents` is specified and total added card price exceeds it.
  - Combines components into `total` (rounded to 2 decimal places).

- **`optimizeDeck(currentDeck, candidatePool, options)` -> `OptimizeResult`**:
  - Validates inputs; locks `commander` cards, lands, and `lockedOracleIds`.
  - Runs `iterations` (default `400`) SA steps using `options.rng`:
    - Each step either swaps an available slot with an unused candidate (within `maxSwaps`, default `5`), swaps an already-swapped slot to a different candidate, or reverts one active swap (`20%` probability when swaps > 0).
    - Computes `scoreDeck` on the proposed deck; accepts if `delta >= 0` or `rng.next() < Math.exp(delta / temp)`.
    - Updates `bestDeck` / `bestScore` whenever `nextScore.total > bestScore.total`.
  - Returns `before`, `after`, `delta`, `swaps` (net `cut -> add` pairs), `iterationsRun`, `acceptedMoves`, `improvedMoves`.

## 4. Invariants

1. **Deterministic with `Rng`:** Given the same `seed` (`seededRng(seed)`), `optimizeDeck` produces identical swaps and scores; `Math.random()` is never called (ADR 0008).
2. **Deck rules preserved:** Commanders, lands, and `lockedOracleIds` are never cut; Commander singleton uniqueness is maintained across swaps; `swaps.length <= maxSwaps`.
3. **Read-only optimization:** Neither `optimize_deck` nor the Builder preview mutates the saved deck; changes are applied only when the player/LLM explicitly confirms via `apply_changes` or Builder swap actions.

## 5. Use cases / MCP tool

| Tool            | Actor / authz     | Input                                                                                               | Output                                                                         | Errors (`kind`) | Transaction? |
| --------------- | ----------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------- | ------------ |
| `optimize_deck` | Signed-in / owner | `deckId`, `pool` (`"owned" \| "store"`), `maxSwaps?`, `maxAddedPriceCents?`, `iterations?`, `seed?` | `before`, `after`, `delta`, `swaps[]`, `totalAddedPriceCents`, `iterationsRun` | `NotFound`      | No (read)    |

## 6. Query layer (`src/modules/decks/queries/optimize.ts`)

- `optimizeDeckForView(db, userId, deckId, options)`:
  - Fetches `deckView` and `deckSuggestions` in parallel.
  - Maps mainboard/commander lines and candidate pool (`owned` or `store`) to `OptimizerCard[]`, filtering out lands and cards already in the deck.
  - Runs `optimizeDeck` with `seededRng(options.seed ?? "default")` (or caller-provided `Rng`) and returns the structured result.

## 7. Test plan

- **Domain unit tests (`optimize.test.ts`):**
  - `scoreDeck` increases when replacing a high-MV off-role filler card with an on-theme low-MV ramp/draw card, and applies `bracketPenalty` when exceeding `targetBracket`.
  - `optimizeDeck` is deterministic for a fixed `seededRng`, respects `maxSwaps`, `lockedOracleIds`, `maxAddedPriceCents`, and improves `after.total >= before.total` on a synthetic suboptimal deck.
- **Integration / tool tests:**
  - `optimize_deck` schema & registry checks pass (`pnpm check`).
  - Integration test in `tests/integration/` verifies `optimizeDeckForView` runs against a seeded DB deck and returns valid swaps without mutating the deck.
