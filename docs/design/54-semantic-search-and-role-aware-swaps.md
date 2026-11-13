# Design: Semantic search, role-aware swaps, and combo finder

- **Phase:** 54 (Deck-AI Phase 2, tududi #153 & #154)
- **Status:** Draft → In review → **Approved** (2026-11-13)
- **Related ADRs:** 0016 (client-safe module API), 0017 (shared card search), 0022 (LLM tool API), 0023 (process sized to feature), 0025 (Commander Spellbook combo data)
- **Lesson:** no (builds directly on `pgvector` and `swaps.ts` patterns from Phase 53)

## 1. Purpose & scope

Make card discovery and 1-for-1 swaps more accurate for both the web app and LLM deck-building tools:

1. **`semantic_search_for_deck`:** Embed a natural-language concept query (e.g., _"free sacrifice outlets that draw cards"_) via `TextEmbedder` and retrieve matching legal cards in the deck's color identity using `pgvector` cosine similarity, fused with optional structured search filters (`maxPriceCents`, `pool`, `query`), scored by `rateCard`.
2. **Role-aware & effect-similar `suggestSwaps`:** When pairing a cut card with a replacement, reward candidates that preserve a needed `TargetedTag` the cut was filling or have high embedding similarity to the cut card (for replacing over-bracket / expensive cards).
3. **`find_combos_for_deck`:** Expose `combosForDeck` and `comboPartnersForDeck` (`spellbook_two_card_combos`) as a read-only MCP tool showing complete combos in the deck and 1-card-away combo partners in the player's collection/store (filtered by `targetBracket`).

**Out of scope:**

- Multi-card Simulated Annealing deck optimization (Phase 55 / #155).
- `audit_deck` and `simulate_opening_hands` (Phase 56 / #156).

## 2. Ubiquitous language

| Term                         | Meaning in this codebase                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concept query                | A natural-language description of a card effect embedded with `EMBEDDING_MODEL` (`Xenova/bge-small-en-v1.5`).                                     |
| RRF (Reciprocal Rank Fusion) | Combining two ranked lists (`vectorRank` and `filterRank`) via `1 / (60 + rank)` so cards matching both concept and keyword filters rank highest. |
| Role-preserving swap         | A swap where `add` shares a needed `TargetedTag` with `cut`, preventing `suggestSwaps` from cutting removal/ramp without replacing that function. |

## 3. Domain model

Pure additions in `src/modules/decks/domain/swaps.ts`:

```ts
export type SwapReason =
  | Readonly<{ kind: "ratingGain"; cutRating: number; addRating: number }>
  | Readonly<{ kind: "fillsRole"; tag: TargetedTag }>
  | Readonly<{ kind: "preservesRole"; tag: TargetedTag }>
  | Readonly<{ kind: "similarEffect"; similarityPct: number }>
  | Readonly<{ kind: "fixesOverBracket"; target: Bracket }>
  | Readonly<{ kind: "fixesNotOwned" }>
  | Readonly<{ kind: "lowersCurve"; cutMv: number; addMv: number }>;

export type SwapCutMeta = Readonly<{
  manaValue: number;
  rating: number;
  isBasicLand?: boolean;
  /** Role tags the cut card currently provides (for role-preserving swaps). */
  roles?: readonly TargetedTag[];
}>;

// Optional similarity lookup passed into SwapOptions:
// cutAddSimilarity?: (cutOracleId: string, addOracleId: string) => number | null;
```

- When scoring `(cut, add)` pairs in `suggestSwaps`:
  - Add `+ROLE_PRESERVE_BONUS` (e.g. `8`) if `cut.roles` and `add.card.roles` share a `TargetedTag` that is at or below target.
  - Add `+SIMILAR_EFFECT_BONUS * sim` (e.g. `10 * sim`) when `cutAddSimilarity` returns `sim >= 0.65`.
  - Keep `suggestSwaps` pure and browser-safe (`src/modules/decks/client.ts`).

## 4. Invariants

1. **Deck rules enforced in `semantic_search_for_deck`:** All returned cards respect format legality, commander color identity, copy limits, and `targetBracket` (no `overBracket` suggestions).
2. **Owned-first:** `semantic_search_for_deck` returns `owned` (free copies first) and `store` pools separately, matching `suggest_for_deck` and `similar_cards`.
3. **Pure `suggestSwaps`:** No DB/ONNX imports in `swaps.ts`; `cutAddSimilarity` is an optional pure callback.
4. **Bracket-safe combos in `find_combos_for_deck`:** 1-card-away combo partners that would push the deck over `targetBracket` are excluded (or flagged when `targetBracket` is `null`).

## 5. Use cases

| Use case / tool            | Actor / authz     | Input                                                                      | Output                                                       | Errors (`kind`)          | Transaction? |
| -------------------------- | ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------ | ------------ |
| `semantic_search_for_deck` | Signed-in / owner | `deckId`, `concept`, `filter?`, `maxPriceCents?`, `limit?`, `includeText?` | `owned[]`, `store[]` with `similarityPct`, `rating`, `price` | `NotFound`, `Validation` | No (read)    |
| `find_combos_for_deck`     | Signed-in / owner | `deckId`, `limit?`                                                         | `complete[]`, `oneCardAway[]` (owned/store)                  | `NotFound`               | No (read)    |

## 6. Read models (queries)

- `semanticSearchForDeck(db, embedder, userId, deckId, options)` in `src/modules/decks/queries/semantic-search.ts`:
  - Embeds `options.concept` once with `embedder([options.concept])`.
  - Queries `card_embeddings` with `pgvector` cosine distance (`1 - (e.embedding <=> queryVec)`) joined to `printings` within `fitsDeck(context)` (and optional `maxPriceCents`), splitting into `owned` and `store` pools, and fusing with optional `filter` query via RRF.
  - Scores each result with `rateCard` under the deck's `RatingProfile` and `targetBracket`.
- `deckCombosView(db, userId, deckId, limit)` in `src/modules/decks/queries/combos.ts`:
  - Calls `combosForDeck` for complete combos and `comboPartnersForDeck` for 1-card-away partners, splitting partners into `owned` vs. `store` with prices.

## 7. Test plan

- **Domain unit tests (`swaps.test.ts`):**
  - `suggestSwaps` prefers a role-preserving replacement over a slightly higher-rated unrelated card when a needed role would otherwise drop.
  - `suggestSwaps` prefers high-similarity replacement when `cutAddSimilarity` is provided and emits `preservesRole` / `similarEffect` reasons.
- **Integration tests (`embeddings.int.test.ts` / `combos.int.test.ts`):**
  - `semanticSearchForDeck` with a fake `TextEmbedder` returns matching cards in color identity, respects `maxPriceCents`, and excludes `overBracket` cards.
  - `deckCombosView` returns complete combos and 1-card-away partners split by owned/store.
- **MCP tool tests:**
  - Tool schemas and registry checks pass (`pnpm check`).
