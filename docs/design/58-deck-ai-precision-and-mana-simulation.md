# Design: Deck-AI precision, transparent brackets, and cast-on-curve mana analysis

- **Phase:** 58
- **Status:** **Approved** (2026-11-13)
- **Related ADRs:** 0006 (CQRS-lite reads), 0008 (injected RNG and clock), 0016 (client-safe module API), 0022 (LLM tool API), 0023 (process sized to feature)
- **Lesson:** no (extends existing `decks/domain`, `decks/queries`, and `_llm-tools`)

## 1. Purpose & scope

Address the five highest-leverage precision gaps in Proxy Library's deck-building and diagnostic tools:

1. **Snapshot scoring parity & reference-deck regression suite:** Eliminate `audit_deck` vs. `diff_deck` score drift caused by missing fields on snapshot-only cards, and add a deterministic reference-deck test suite.
2. **Type filtering in `semantic_search_for_deck`:** Let callers filter by card type (e.g., permanent types for Muldrotha) before vector/RRF ranking.
3. **Transparent Commander bracket reasons:** Expose the exact cards and rule thresholds driving `estimateBracket` alongside the existing `targetBracket` manual override.
4. **Separate Inclusion Rate and Log-Lift in card scoring:** Stop penalizing format staples (e.g. _Rhystic Study_, _Demonic Tutor_, _Sol Ring_) in `rank_cuts` and `rateCard` by separating raw commander inclusion (staple power) from smoothed log-lift (theme fit).
5. **Cast-on-curve probability in `plan_mana_base`:** Replace pure pip-share rules of thumb with per-card cast-on-curve probabilities using hypergeometric / seeded Monte Carlo simulation.

**Out of scope:**

- New external data scrapers (uses existing EDHREC `inclusionRate` / `synergy` data from Phase 45 and local catalog data).
- Reusable card packages, Moxfield/Archidekt `#Tag` round-tripping, and shareable mulligan-trainer scorecards (deferred to later phases).

## 2. Ubiquitous language

| Term                   | Meaning in this codebase                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inclusion rate**     | Fraction of EDHREC decks for a commander playing a card (`[0, 1]`), measuring staple/power adoption.                                                                                                                                                          |
| **Log-lift**           | $\ln\left(\frac{\max(\epsilon, \text{inclusionRate})}{\max(\epsilon, \text{baselineRate})}\right)$ where $\text{baselineRate} = \text{inclusionRate} - \text{synergy}$ and $\epsilon = 0.005$; symmetric measure of theme fit relative to the color identity. |
| **Cast-on-curve rate** | Probability in `[0, 1]` that an opening hand + draws by turn $T = \max(1, \text{MV})$ has $\ge T$ lands/mana sources and satisfies all colored pips of a spell.                                                                                               |
| **Bracket reason**     | A structured rule trigger (Game Changers, Mass Land Denial, Extra Turns, Two-Card Combos) explaining why `estimateBracket` returned a floor.                                                                                                                  |

## 3. Domain & query design

### 3.1 Snapshot scoring parity (`queries/preview.ts`, `queries/snapshots.ts`)

- Extend `PreviewLine` / `loadCardsForPreview` to load `keywords` and `rarity` from the catalog tables so `previewLineToOptimizerCard` no longer falls back to `keywords: []` and `rarity: "common"` for cards present in a snapshot but absent from the live deck.
- Add `src/modules/decks/domain/reference-decks.test.ts` with a fixed set of Commander reference lists (e.g., precons, upgraded value, high-power) asserting deterministic `scoreDeck` bands and `audit_deck` / `diff_deck` parity.

### 3.2 Semantic search type filter (`queries/` + `_llm-tools/tools/library.ts`)

- Add optional `types?: string[]` (include any of these types, e.g. `["creature", "artifact", "enchantment", "planeswalker", "land"]`) and `excludeTypes?: string[]` (e.g. `["instant", "sorcery"]`) to `semantic_search_for_deck`'s Zod schema.
- Apply the type predicates in SQL on `type_line` before the `card_embeddings` cosine-similarity + RRF merge so top-$K$ results only contain legal card types.

### 3.3 Transparent bracket reasons (`domain/brackets.ts`, `queries/audit.ts`, `_llm-tools/tools/decks.ts`)

```ts
export type BracketRuleReason = Readonly<{
  rule: "game_changers" | "mass_land_denial" | "extra_turns" | "two_card_combo";
  bracketFloor: Bracket;
  count: number;
  threshold: number;
  cards: readonly string[];
  summary: string;
}>;
```

- Return `reasons: readonly BracketRuleReason[]` from `estimateBracket` (and surface it in `get_deck` and `audit_deck`), while keeping `targetBracket` (set via `update_deck`) as the authoritative manual override.

### 3.4 Inclusion + Log-Lift (`domain/rate.ts`, `domain/cuts.ts`, `domain/suggest.ts`)

```ts
/** Smoothed log-lift from EDHREC inclusionRate and synergy (baseline = inclusionRate - synergy). */
export function edhrecLogLift(inclusionRate: number, synergy: number): number;
```

- In `ratingFeatureVector` (`rate.ts`):
  - Keep `edhrecInclusion` (`confidence * inclusionRate`) as an independent positive staple signal.
  - Replace thresholded `edhrecSynergy` / `edhrecNegative` with `edhrecLift` (`confidence * clamp(edhrecLogLift(inclusionRate, synergy), -2, 2)`), so high-inclusion staples with `synergy ≈ 0` get `lift ≈ 0` (no penalty) plus positive `inclusion` points, while genuine anti-synergies get symmetric negative lift.
- In `rankCuts` (`cuts.ts`) and `suggest_for_deck` (`suggest.ts`):
  - Protect high-inclusion cards (`inclusionRate >= 0.25`) from theme-mismatch cut penalties, and emit both `inclusionPct` and `lift` in `reasons` / `parts`.

### 3.5 Cast-on-curve simulation (`domain/mana.ts` + `plan_mana_base` + `audit_deck`)

```ts
export type CardCastability = Readonly<{
  oracleId: string;
  name: string;
  manaValue: number;
  manaCost: string | null;
  /** Probability in [0, 1] of casting on turn max(1, manaValue). */
  castOnCurvePct: number;
  /** Most constraining color pip, if any (e.g. "B" when short on black sources). */
  bottleneckColor: ManaColor | null;
}>;
```

- Pure function `simulateCastOnCurve(deck, { rng, trials })` in `decks/domain/` using injected `Rng` (ADR 0008):
  - Simulates `trials` (default `500`) openings + draws up to turn $T = \min(7, \max(1, \text{MV}))$ on the play, accounting for tapped vs. untapped lands and dual/fetch color flexibility.
  - Reports per-card `castOnCurvePct` and flags cards below `0.75` (75%) in `plan_mana_base` and `audit_deck` findings.

## 4. Invariants

1. **Snapshot parity:** Scoring the exact same deck state via `audit_deck` and `diff_deck` produces identical `scoreDeck` totals (within floating-point rounding).
2. **Pre-ranking type filter:** When `types` or `excludeTypes` is provided to `semantic_search_for_deck`, every returned card satisfies the type predicate and the full `limit` is filled from matching cards when available.
3. **Staple protection:** A card with `inclusionRate >= 0.25` and `synergy ≈ 0` never receives a negative EDHREC contribution in `rateCard` or `rankCuts`.
4. **Deterministic mana simulation:** `simulateCastOnCurve` is a pure function with injected `Rng`; identical seeds produce bit-identical `castOnCurvePct` values.
5. **Override precedence:** `targetBracket` remains the player-controlled override; `estimateBracket` only explains the automatic floor.

## 5. Patterns applied

- **Functional core, imperative shell:** All math (`edhrecLogLift`, `simulateCastOnCurve`, `estimateBracket` reasons) lives in `src/modules/decks/domain/` with zero DB or network dependencies.
- **Injected RNG (ADR 0008):** `simulateCastOnCurve` accepts `Rng` (`seededRng(...)` in queries/tests).
- **Single feature path:** `rateCard` and `fitLogisticWeights` continue sharing `ratingFeatureVector`.

## 6. Test plan

- **Domain unit & property tests:**
  - `rate.test.ts`: verify `edhrecLogLift` symmetry, zero-clamp safety, and that high-inclusion / zero-synergy staples (`Sol Ring`, `Rhystic Study`) score positively without negative lift.
  - `brackets.test.ts`: verify `reasons` lists exact cards, counts, and thresholds for each bracket floor.
  - `mana.test.ts`: verify `simulateCastOnCurve` determinism with `seededRng` and monotonicity (adding untapped colored sources never decreases `castOnCurvePct`).
  - `reference-decks.test.ts`: verify `scoreDeck` stability across reference Commander lists.
- **Integration tests:**
  - `snapshots` / `audit` integration test: verify `audit_deck` and `diff_deck` return identical `scoreDeck` values when comparing equivalent states, and diverge accurately when cards with `keywords`/`rarity` are swapped.
  - `semantic_search_for_deck` integration test: verify `types` / `excludeTypes` filters out instants/sorceries while keeping permanents.
- **Verification:** `direnv exec . pnpm check` and `direnv exec . pnpm test:int`.

## 7. Decisions (resolved 2026-11-13)

1. **`edhrecLift` replaces `edhrecSynergy`/`edhrecNegative`:** Replace both in `rate.ts` and re-calibrate `RATING_WEIGHTS_BY_TIER` via `scripts/eval-ratings.ts --calibrate` so there is one clean, symmetric lift signal alongside `edhrecInclusion` with no conflicting weights.
2. **Before/after castability in `plan_mana_base`:** Run `simulateCastOnCurve` both before and after the proposed land additions so the player sees the exact castability improvement for bottlenecked spells.
