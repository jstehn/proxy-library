# Design: One-shot `audit_deck` and Monte Carlo `simulate_opening_hands`

- **Phase:** 56 (Deck-AI Phase 4, tududi #156)
- **Status:** Draft → In review → **Approved** (2026-11-13)
- **Related ADRs:** 0008 (injected `Rng`), 0016 (client-safe module API), 0022 (LLM tool API), 0023 (process sized to feature)
- **Lesson:** no (composes `draws.ts`, `rules.ts`, `brackets.ts`, `stats.ts`, `cuts.ts`, and `optimize.ts`)

## 1. Purpose & scope

Give the LLM and deck builder two fast, read-only diagnostic tools:

1. **`simulate_opening_hands` (`goldfish.ts`):** A deterministic Monte Carlo London-mulligan simulator (default `1,000` hands) using an injected `Rng`. Evaluates keepable-hand rates, mulligan distribution, early ramp / early play rates, mana screw/flood frequencies, turn-3 land drop rates, and 3 sample kept hands.
2. **`audit_deck` (`audit.ts`):** A one-shot deck health report combining legality (`deckProblems`), Commander bracket & two-card combos (`estimateBracket`, `bracketWarning`, `combosForDeck`), `scoreDeck` breakdown, role gaps vs. `roleTargets`, mana/color balance, ownership/missing cost, top `rankCuts` candidates, a 500-hand goldfish summary, and prioritized `findings`.

**Out of scope:**

- Calibrated ML weights per `PowerTier`, `upgrade_roadmap`, and `diff_deck` (Phase 57 / #157).

## 2. Domain model

- **`src/modules/decks/domain/goldfish.ts`** (pure, browser-safe):
  - `simulateOpeningHands(cards: readonly LibraryCard[], options: SimulateHandsOptions): GoldfishReport`
  - Uses `shuffled(options.rng, cards)` (`@/shared/kernel`).
  - London mulligan policy: keeps when `lands` is in `[minLands, maxLands]` and `(!requireEarlyPlay || hasEarlyPlay)`, otherwise mulligans up to `maxMulligans` (default `2`) and bottoms excess lands or highest-MV spells to reach `7 - Math.max(0, mulligans - (freeMulligan ? 1 : 0))`.
- **`src/modules/decks/queries/audit.ts`**:
  - `auditDeck(db, userId, deckId)`: runs `deckView` + `combosForDeck`, computes `deckProblems`, `estimateBracket`, `scoreDeck`, `deckStats`, `rankCuts`, and `simulateOpeningHands(cards, { rng: seededRng(...), trials: 500 })`, returning a structured report with prioritized `findings`.

## 3. Invariants

1. **Deterministic with `Rng`:** Given the same `seed`, `simulateOpeningHands` and `auditDeck` return identical results; `Math.random()` is never called.
2. **Read-only:** Both tools have `scope: "read"`, `readOnly: true`, and never mutate deck state.

## 4. Test plan

- **Unit tests (`goldfish.test.ts`):**
  - Determinism with `seededRng`, London mulligan bottoming reduces hand size correctly (free first mulligan vs. paid), and mana-screwed vs. balanced land counts produce expected keepable-rate differences.
- **Integration / tool checks:**
  - `auditDeck` verified in `tests/integration/embeddings.int.test.ts`; `pnpm check` verifies schema and registry rules.
