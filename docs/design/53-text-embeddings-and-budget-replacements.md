# Design: Text embeddings, rating lift, and budget replacements

- **Phase:** Deck building — Phase 1b (#58 follow-up)
- **Status:** Draft → In review → **Approved** (2026-11-13)
- **Related ADRs:** 0016 (client-safe module API), 0019 (precomputed card features), 0022 (LLM tool API), 0023 (process sized to feature)
- **Lesson:** yes (pgvector HNSW similarity, feature-vector scoring, and local ONNX inference in TypeScript)

## 1. Purpose & scope

Add precomputed card text embeddings (`pgvector` + local `Xenova/bge-small-en-v1.5` ONNX model) and use them to:

1. Improve deck card assessments (`rateCard`, `scoreForDeck`, `rankCuts`, `suggestSwaps`) via `embedSim` (mean of top-5 cosine similarities to cards in the deck).
2. Power semantic `similarCards` and a new **budget replacements** feature that finds cheaper cards with similar rules text and deck fit for expensive cards in a deck.

**Out of scope:**

- Fine-tuning custom embedding models on MTG data.
- Re-ranking or replacing `pgvector` with an external vector database.
- Client-side ONNX inference in the browser (all embedding generation happens in `worker/`, and `pgvector` queries run on the server; `rateCard` / `rankCuts` remain pure and accept precomputed `embedSim` numbers).

## 2. Harness verification (#58 gate)

Design doc 47 gated `pgvector` + worker embedding sync on a ≥ +2–3% `Recall@50` lift over the current `rateCard` baseline. Evaluated across 30 Commander precons (holdout = 10 non-land cards/deck, up to 300 non-land distractors, `Xenova/bge-small-en-v1.5` `q8`, 1,847 cards embedded in 17.3s on CPU):

| Target Bracket        | Baseline (`wEmbed=0`)       | With `embedSim` (`wEmbed=8`)    | Lift                   |
| --------------------- | --------------------------- | ------------------------------- | ---------------------- |
| Bracket 2 (Casual)    | 29.3% Recall@50 / 0.029 MRR | **36.0% Recall@50 / 0.037 MRR** | **+6.7% (+0.008 MRR)** |
| Bracket 3 (Upgraded)  | 26.3% Recall@50 / 0.027 MRR | **35.0% Recall@50 / 0.036 MRR** | **+8.7% (+0.009 MRR)** |
| Bracket 4 (Optimized) | 23.7% Recall@50 / 0.026 MRR | **30.7% Recall@50 / 0.029 MRR** | **+7.0% (+0.003 MRR)** |

The gate is cleared across all three power tiers.

## 3. Ubiquitous language

| Term               | Meaning in this codebase                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean card text    | `${typeLine}\n${cleanedRulesText}` with reminder text `(...)` removed and self-references to the card's name (and comma-prefix short name) replaced with `~`.                          |
| `embedSim`         | Mean cosine similarity between a card's embedding and its top-5 most similar non-land/commander cards in the deck, in `[0, 1]`.                                                        |
| Budget replacement | A cheaper legal card (under `maxPriceCents` or a fraction of the target card's price) ranked by a blend of embedding similarity to the expensive card and `rateCard` fit for the deck. |

## 4. Domain model

Pure additions in `src/modules/catalog/domain/` and `src/modules/decks/domain/`:

```ts
// catalog/domain/embedding-text.ts
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIMS = 384;
export const EMBEDDING_TEXT_VERSION = 1;
export function cleanCardText(name: string, typeLine: string, text: string): string;

// decks/domain/rate.ts
export type RatingPartKind =
  | ...
  | "embedSim";

// Added to RatingCandidate and CutLine:
// embedSim?: number | null;
// Added to Reason:
// | Readonly<{ kind: "embedSim"; similarityPct: number }>
```

- **Centered `embedSim` contribution in `rateCard`:** `Math.max(0, embedSim - EMBED_SIM_BASELINE)` (where `EMBED_SIM_BASELINE ≈ 0.55`, calibrated on the harness) multiplied by `weights.embedSim` per `PowerTier`, so unrelated cards (~0.45–0.55 cosine) get 0 bonus rather than inflating all ratings.
- **Cut scoring (`rankCuts`):** `CutLine` accepts optional `embedSim?: number | null` (mean top-5 similarity to the _other_ non-land/commander cards in the deck). High `embedSim` adds a modest keep bonus; very low `embedSim` does not rescue an off-theme card.
- **Budget replacement scoring (`decks/domain/`):** Given a target expensive card's `priceCents`, `similarity` (cosine similarity in `[0, 1]`), and `rateCard` rating, rank replacements by `similarity * SIM_WEIGHT + (rating / 100) * FIT_WEIGHT` and compute `savedCents = targetPriceCents - candidatePriceCents`.

## 5. Invariants

1. **Pure & browser-safe domain:** `cleanCardText`, `rateCard`, `rankCuts`, `suggestSwaps`, and budget-replacement scoring stay pure and free of Node/ONNX/DB imports.
2. **Deck rules enforced on replacements:** Every budget replacement respects format legality, commander color identity, singleton/copy limits, and `targetBracket` (no `overBracket` suggestions).
3. **Actually cheaper:** A budget replacement for card `X` always has `priceCents !== null && priceCents < X.priceCents` (and `<= maxPriceCents` when specified).
4. **Incremental & idempotent worker pass:** `embed-cards` only computes embeddings for `oracle_id`s missing a row or whose `(model, text_version)` is stale.

## 6. Use cases

| Use case / tool                        | Actor / authz     | Input                                                           | Output                                                                              | Errors (`kind`)          | Transaction?  |
| -------------------------------------- | ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------ | ------------- |
| `embed-cards` (worker CLI + post-sync) | Worker            | optional `limit`                                                | `{ embedded, skipped }`                                                             | Defect on model/DB error | Batch upserts |
| `similar_cards` (upgraded)             | Signed-in / owner | `deckId`, `card`                                                | `owned[]`, `store[]`                                                                | `NotFound`               | No (read)     |
| `budget_replacements` (MCP + UI)       | Signed-in / owner | `deckId`, `card?`, `minPriceCents?`, `maxPriceCents?`, `limit?` | Expensive cards + cheaper replacements with `savedCents`, `similarityPct`, `rating` | `NotFound`               | No (read)     |

## 7. Ports

```ts
// catalog/application/ports.ts
export type TextEmbedder = (texts: readonly string[]) => Promise<Float32Array[]>;

export type EmbeddingRepository = Readonly<{
  listMissingOrStale(
    model: string,
    textVersion: number,
    limit?: number,
  ): Promise<Array<{ oracleId: string; name: string; typeLine: string; text: string }>>;
  upsertBatch(
    rows: ReadonlyArray<{
      oracleId: string;
      model: string;
      textVersion: number;
      embedding: Float32Array;
    }>,
  ): Promise<void>;
}>;
```

## 8. Persistence

- **Dev & deploy environment:**
  - `flake.nix`: switch `postgresql_17` to `postgresql_17.withPackages (ps: [ ps.pgvector ])`.
  - `docker-compose.yml`: switch `db` image from `postgres:17` to `pgvector/pgvector:pg17`.
- **Migration (`drizzle/0043_card_embeddings.sql`):**
  - `CREATE EXTENSION IF NOT EXISTS vector;`
  - Table `card_embeddings`:
    - `oracle_id text PRIMARY KEY`
    - `model text NOT NULL`
    - `text_version integer NOT NULL`
    - `embedding vector(384) NOT NULL`
    - `updated_at timestamptz NOT NULL DEFAULT now()`
  - HNSW index: `CREATE INDEX card_embeddings_hnsw_idx ON card_embeddings USING hnsw (embedding vector_cosine_ops);`

## 9. Read models (queries)

- `decks/queries/suggestions.ts`:
  - `suggestionContext` loads deck card embeddings (or joins `card_embeddings`) so candidate queries (`suggestForDeck`, `budgetList`, `swapSuggestions`) compute `embedSim` (mean of top-5 cosine similarities to non-land/commander deck cards) in SQL/app and pass it to `rateCard` / `rankCuts`.
  - `similarCards` uses `pgvector` cosine distance (`1 - (e.embedding <=> target.embedding)`) as the primary candidate retrieval (top-400 nearest neighbors within color identity & format) instead of only matching coarse role/theme tags, then blends similarity + deck fit.
  - `budgetReplacements(db, userId, deckId, options)`:
    - If `oracleId` is given, finds cheaper replacements for that card.
    - If omitted, picks the top expensive non-land cards in the deck (e.g. `price_cents >= minPriceCents`, default $5.00 / 500¢) and returns top-N cheaper replacements for each (e.g. `price_cents <= maxPriceCents`, default $2.00 / 200¢ or 25% of the card's price), owned first, then store.

## 10. Patterns applied

- **Ports & adapters:** `TextEmbedder` port in `catalog/application/ports.ts`, `@huggingface/transformers` adapter in `catalog/infrastructure/embedder.ts`, fake embedder in `catalog/testing/fakes.ts`.
- **Functional core:** `cleanCardText` and `rateCard` / `rankCuts` / replacement scoring remain pure.

## 11. Test plan

- **Domain unit tests:**
  - `cleanCardText`: strips reminder text, replaces full & comma-short card names with `~`, puts `typeLine` first.
  - `rateCard` / `rankCuts`: `embedSim` contribution respects baseline, `PowerTier` weights, and determinism.
  - Budget replacement scoring: invariants (cheaper than target, deterministic sort, `savedCents` accuracy).
- **Application tests (fakes):**
  - `embedCards` skips up-to-date `(model, textVersion)` rows and batches missing/stale ones.
- **Integration tests (`pnpm test:int`):**
  - `card_embeddings` migration + HNSW cosine query + `similarCards` / `budgetReplacements` against Postgres with `pgvector`.

## 12. Open questions

1. Approve enabling `pgvector` in `flake.nix` (`postgresql_17.withPackages (ps: [ ps.pgvector ])`) and `docker-compose.yml` (`pgvector/pgvector:pg17`), plus adding `@huggingface/transformers` to `package.json`?
2. Default thresholds for `budget_replacements` when no card is specified: `minPriceCents = 500` ($5+) for expensive deck cards, and `maxPriceCents = 200` ($2) or `<= 25%` of the card's price for replacements?
