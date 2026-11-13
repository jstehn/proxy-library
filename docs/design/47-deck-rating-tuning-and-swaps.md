# Design: Deck rating tuning, bracket weights, and swap suggestions

- **Phase:** Deck building — Phase 1 (#58, #150, #85)
- **Status:** Draft → In review → **Approved** (2026-11-13)
- **Related ADRs:** 0016 (client-safe module API), 0019 (precomputed card features), 0022 (LLM tool API), 0023 (process sized to feature)
- **Lesson:** no (unless #58 proves embeddings + `pgvector` are needed, in which case: yes — vector similarity & feature tuning)

## 1. Purpose & scope

Make card recommendations (`rateCard`) and cut rankings (`rankCuts`) adapt to a deck's target power level (Commander Brackets 1–5), verify via an offline evaluation harness whether frozen text embeddings (#58) add signal on top of existing synergy/EDHREC features, and combine `rankCuts` + `rateCard` into one-step **"cut X, add Y" swap suggestions** (#85) in both the deck builder UI and MCP tools.

**Out of scope:**

- Fine-tuning a transformer/embedding model on MTG decks (too small a dataset, high overfitting risk).
- Adding `pgvector` or a worker embedding pipeline _unless_ the offline harness shows a meaningful `recall@50` lift over existing features.
- Two-card combo detection (#79, Phase 2) and strict ownership (#77, Phase 3).

## 2. Ubiquitous language

| Term       | Meaning in this codebase                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| Power tier | Grouped Commander bracket band for weight tuning: `"casual"` (1–2), `"upgraded"` (3), `"optimized"` (4–5).   |
| `embedSim` | Mean cosine similarity between a candidate's frozen text embedding and its top-5 most similar cards in deck. |
| Swap       | A paired recommendation (`cut` from main deck + `add` from owned/store pool) with net gain and reasons.      |
| Net gain   | How much a swap improves the deck: replacement `rating` minus the cut card's `rating` (plus problem fixes).  |

## 3. Domain model

Pure additions in `src/modules/decks/domain/`:

```ts
export type PowerTier = "casual" | "upgraded" | "optimized";

export function powerTierForBracket(bracket: Bracket | null): PowerTier {
  if (bracket === null || bracket === 3) return "upgraded";
  return bracket <= 2 ? "casual" : "optimized";
}

// In rate.ts:
export type RatingWeights = typeof RATING_WEIGHTS; // plus optional embedSim weight if harness approves
// weightsForBracket(targetBracket: Bracket | null): RatingWeights

// In cuts.ts:
// cutWeightsForBracket(targetBracket: Bracket | null): CutWeights

// New file: src/modules/decks/domain/swaps.ts
export type SwapReason =
  | Readonly<{ kind: "ratingGain"; cutRating: number; addRating: number }>
  | Readonly<{ kind: "fillsRole"; tag: TargetedTag }>
  | Readonly<{ kind: "fixesOverBracket"; target: Bracket }>
  | Readonly<{ kind: "fixesNotOwned" }>
  | Readonly<{ kind: "lowersCurve"; cutMv: number; addMv: number }>;

export type SwapSuggestion = Readonly<{
  cut: RankedCut;
  add: Scored;
  netGain: number;
  reasons: readonly SwapReason[];
}>;
```

### How deck power tunes the weights

- **Casual (Brackets 1–2):** Higher weight on `theme`, `tribe`, and (if enabled) `embedSim` (cards that _read_ like the deck's mechanic); lower weight on `quality` (`edhrecRank`) and curve penalties.
- **Upgraded (Bracket 3 / default):** Balanced `synergy`, `roleNeed`, `edhrec`, and `quality`, with `bracketPenalty` on Game Changers / MLD / chained extra turns.
- **Optimized (Brackets 4–5):** Higher weight on `quality` (`edhrecRank`), `edhrecInclusion`, `synergy`, and `topHeavyPenalty` (curve efficiency); lower weight on generic text similarity.

Exact weight values are **not** hand-guessed—they are fit by running logistic regression on the rating parts (`synergy`, `themeFit`, `edhrec`, `roleNeed`, `quality`, curve) over held-out cards stratified by `PowerTier` in the evaluation harness.

## 4. Invariants

1. **Pure & browser-safe:** `rateCard`, `rankCuts`, `weightsForBracket`, and `suggestSwaps` stay pure and exportable through `src/modules/decks/client.ts`.
2. **Valid swaps only:** `suggestSwaps` never suggests cutting a basic land, never suggests adding a card already in the deck (for singleton formats like Commander), and never suggests a swap that introduces a new `overBracket` violation when `targetBracket` is set.
3. **Net improvement:** Every returned `SwapSuggestion` either has `netGain > 0` or resolves an active `overBracket` / `notOwned` problem on the cut card.
4. **Deterministic order:** Sorted by `netGain` descending, then `add.score` descending, then `cut.keepScore` ascending, then `oracleId`.
5. **Embeddings gated by harness (#58):** No database migration (`pgvector`) or worker job is added unless the offline harness demonstrates a clear `recall@50` improvement on top of `synergy` + `edhrec`.

## 5. Use cases

| Use case / tool | Actor / authz     | Input                                       | Output             | Errors (`kind`)                       | Transaction?         |
| --------------- | ----------------- | ------------------------------------------- | ------------------ | ------------------------------------- | -------------------- |
| `suggest_swaps` | Signed-in / owner | `deckId`, `pool` (`owned`/`store`), `limit` | `SwapSuggestion[]` | `NotFound`, `Forbidden`               | No (read)            |
| Apply swap (UI) | Deck owner        | `deckId`, `cutOracleId`, `addOracleId`      | Updated deck       | `NotFound`, `Forbidden`, `Validation` | Yes (`applyChanges`) |

## 6. Patterns applied

- **Functional core** (`rate.ts`, `cuts.ts`, `swaps.ts`): pure functions run identically in the browser (live deck builder) and on the server (MCP tools).
- **One shared rating model:** `suggestSwaps` scores both the cut candidate and the replacement using `rateCard` under the same `RatingProfile` and `targetBracket`, so `netGain` is apples-to-apples.

## 7. Test plan

- **Evaluation harness (offline script):**
  - Stratify real decks (precons + player/reference Commander decks) by `estimateBracket` / `PowerTier`.
  - Hold out 10 non-land cards per deck; measure `recall@50` and `MRR` for:
    1. Current static `RATING_WEIGHTS` (baseline)
    2. Bracket-tuned weights per `PowerTier`
    3. Bracket-tuned weights + frozen `embedSim` (`bge-small` / `all-MiniLM`)
  - Measure `rankCuts` precision (do known-weak precon cards / over-bracket cards rank at the top of cuts?).
- **Domain unit & property tests:**
  - `powerTierForBracket` and `weightsForBracket` cover all brackets 1–5 + `null`.
  - `suggestSwaps` invariants (no duplicate singletons, no basic land cuts, deterministic ordering, bracket-safe replacements).
- **Application / MCP tests:**
  - `suggest_swaps` tool schema, authorization, and `applyChanges` round-trip.

## 8. Decisions (approved 2026-11-13)

1. **Power tiers (3 vs. 5):** Approved — **3 tiers** (`casual` 1–2, `upgraded` 3, `optimized` 4–5).
2. **Embeddings gate (#58):** Approved — run the offline harness comparison first and only add `pgvector` + worker embedding sync if `embedSim` shows a clear lift (≥ +2–3% `recall@50`).
3. **MCP surface (#85):** Approved — dedicated `suggest_swaps` MCP tool plus a "Swaps" section in the deck builder's Cards to cut panel.
