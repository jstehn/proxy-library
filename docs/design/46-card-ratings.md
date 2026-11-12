# Design: Card ratings for recommendations

- **Phase:** 46 (backlog task #53, subtasks #54–#59)
- **Status:** **Approved** (2026-11-12)
- **Related ADRs:** 0006 (CQRS-lite reads), 0019 (Precomputed/synced card features)
- **Lesson:** no

## 1. Purpose & scope

Replace the ad-hoc raw point sums in `suggest.ts` and `cuts.ts` with a calibrated **`0–100` Card Rating** (`100 * sigmoid(z)`) and an explainable breakdown (`parts`), unifying **all** the rich signals Proxy Library now has:

- **Produces/consumes synergy (#54):** pure regex rules over oracle text (`makes` vs `uses` resources/triggers, e.g., Treasure makers ↔ artifact-sacrifice payoffs), with commander matches weighted ~3× and counts dampened (`sqrt` / `log1p`).
- **Role need & curve fit (#55):** boost cards filling roles below `roleTargets(format)` proportional to the deficit, and penalize already-saturated mana-value slots or top-heavy cards in high-curve decks.
- **EDHREC community signal (design doc 45 / #86):** commander-specific `synergy` and `inclusionRate`, weighted by sample confidence (`totalDecks`), plus a mild penalty for strongly negative synergy.
- **Quality prior (#59):** Scryfall's global `edhrec_rank`, precon `deck_lists` frequency (and player deck frequency where available), with rarity/price `strength` as fallback when `edhrec_rank` is null.
- **Penalties & filters (#56):** target-bracket violations (kept as strict filter / `hiddenOverTarget` in suggestions and strong penalty in `rankCuts`), optional price-cap penalty, and off-plan / curve-bloat penalties.
- **Evaluation harness (#57):** hold out 10 non-land cards from real decklists (precons first), measure **Recall@50** and **MRR**, and tune weights empirically.
- **Text embeddings (#58):** explicitly **gated** on #57 — only add local embeddings + `pgvector` if the harness reveals a recall gap that produces/consumes + EDHREC + themes + quality prior do not already cover.

**Out of scope:**

- Collaborative filtering across external user accounts or scraping additional external sites.
- Changing format legality or color identity rules (these remain hard SQL filters in `fitsDeck`).
- Building #58 (embeddings) before #57's harness results are measured.

## 2. Ubiquitous language

| Term              | Meaning in this codebase                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Card rating**   | Integer in `[0, 100]` (`Math.round(100 * sigmoid(z))`) measuring how strongly a card belongs in a specific deck.               |
| **Rating part**   | One named, weighted component (`synergy`, `edhrec`, `roleNeed`, `themeFit`, `quality`, `curvePenalty`, …) contributing to `z`. |
| **Signal**        | A resource or event a card **produces** (`makes`) or **consumes** (`uses`), extracted from oracle text by regex rules.         |
| **Quality prior** | Commander/format-independent card strength from `edhrec_rank`, precon appearance count, and rarity/price fallback.             |
| **Recall@50**     | Fraction of 10 held-out non-land cards from a real decklist that appear in the top 50 recommendations for the remaining deck.  |

## 3. Domain model

### `src/modules/decks/domain/signals.ts` (#54)

Pure regex table mapping oracle text (reminder text stripped, using existing `stripReminderText` patterns) to `{ makes: readonly SignalTag[]; uses: readonly SignalTag[] }`.

Initial signal vocabulary (extensible data table, no NLP):

- `treasure` (creates Treasure vs cares about Treasures / artifact sacrifice)
- `token` (creates creature/artifact tokens vs cares about tokens / creatures entering / sacrificing)
- `sacrifice` (sac-outlet / edict vs death triggers / leaves-battlefield / graveyard)
- `plus_one_counter` (puts +1/+1 counters vs proliferates / cares about counters / modified)
- `graveyard` (mills / discards / puts into graveyard vs reanimates / flashback / cares about cards in graveyard)
- `lifegain` (gains life vs triggers on life gain / pays life)
- `landfall_ramp` (puts extra lands / fetches lands vs landfall triggers)
- `spellslinger` (cheap instants/sorceries / copies spells vs magecraft / prowess / cast-noncreature triggers)
- `blink_etb` (exiles & returns / flickers vs strong ETB triggers)
- `artifact_synergy` (creates/is cheap artifact vs affinity / artifact-ETB / metalcraft)
- `enchantment_synergy` (creates/is enchantment vs constellation / enchantress)
- `draw_discard` (wheels / looting / extra draw vs draw-triggers / discard payoffs)

Matching rule for a candidate against a deck:

- Deck builds `deckMakes: Map<SignalTag, number>` and `deckUses: Map<SignalTag, number>`, where **commander lines contribute `3`× weight** (and main-deck lines `1`×).
- Candidate score for signal `s` where candidate `makes` `s` and deck `uses` `s` (or vice versa):
  `Math.sqrt(deckCount)` (or `Math.log1p(deckCount)`) so 20 Treasure makers don't drown out every other axis.

### `src/modules/decks/domain/rate.ts` (#53, #55, #56, #59)

```ts
export type RatingPartKind =
  | "synergy" // produces/consumes oracle-text matches (#54)
  | "themeFit" // deck themes, tribes, commander keywords
  | "edhrec" // EDHREC commander synergy + inclusion rate, confidence-weighted (#86)
  | "roleNeed" // fills a role below format target (#55)
  | "quality" // edhrec_rank + precon frequency + strength fallback (#59)
  | "curvePenalty" // crowded mana-value slot or top-heavy in high-curve deck (#55/#56)
  | "pricePenalty" // over optional per-card price cap (#56)
  | "bracketPenalty"; // over target bracket (used in rankCuts / non-strict views, #56)

export type RatingPart = Readonly<{
  kind: RatingPartKind;
  /** Signed contribution to the logit `z` before sigmoid. */
  contribution: number;
  /** Human-readable detail, e.g. "matches artifact sacrifice ×6" or "EDHREC 42% (+28% syn)". */
  label: string;
}>;

export type CardRating = Readonly<{
  /** Calibrated 0–100 score: Math.round(100 * sigmoid(z)). */
  rating: number;
  /** Raw logit `z = bias + sum(parts.contribution)`. */
  logit: number;
  parts: readonly RatingPart[];
}>;
```

### Rich signals incorporated into `CandidateCard` and `DeckProfile`

1. **EDHREC (`edhrec` + `edhrecTotalDecks`):**
   - Positive `synergy` and `inclusionRate` contribute positively, scaled by confidence `Math.min(1, totalDecks / 100)` when `totalDecks` is known.
   - Strongly negative `synergy` (e.g. `< -0.10` with `totalDecks >= 50`) applies a small negative contribution so cards players actively cut from that commander don't float up on generic staples alone.
2. **Quality prior (`quality`, #59):**
   - `edhrecRank` (1..30,000+): `1 - Math.log10(Math.max(1, edhrecRank)) / 4.5` clamped to `[0, 1]` (rank #1 Sol Ring → `~1.0`, rank #1000 → `~0.33`, rank #15000 → `~0.07`).
   - `preconCount` (how many `deck_lists` precons include this `oracle_id`): `Math.min(1, Math.log1p(preconCount) / Math.log1p(20))`.
   - Fallback when both are absent: existing `strength(rarity, priceCents)` normalized to `[0, 1]`.
3. **Role need & curve saturation (`roleNeed` & `curvePenalty`, #55):**
   - `roleNeed`: for each `gap` in `profile.gaps` that the card fills, scale by `(gap.target - gap.count) / gap.target` so a role at `1/10` gets a stronger boost than `9/10`.
   - `curvePenalty`: track `curveCounts` (non-land cards per mana-value bucket `0..1`, `2`, `3`, `4`, `5`, `6+`) and `averageManaValue` in `DeckProfile`. Penalize cards with `manaValue >= 5` when `averageManaValue > curveGuide(format)`, or cards landing in an already-overcrowded CMC slot (e.g. `> 22` cards at 3 MV in Commander).
4. **Penalties (#56):**
   - `pricePenalty`: when an optional `maxCardPriceCents` is passed (e.g. budget mode or MCP arg), penalize cards above the cap.
   - `bracketPenalty`: `rankCuts` uses the same `CardRating` components (plus `notOwned` and `surplusRole` adjustments) so suggestions and cuts agree on card value.

### Integration with `suggest.ts` and `cuts.ts`

- `Scored` gains `rating: CardRating` (with `score` backed by `rating.logit` or `rating.rating` for deterministic ordering).
- `deckProfile` computes `signals` (`makes`/`uses` counts with commander 3×) and `curveCounts` alongside `themes`, `tribes`, `gaps`, `keywords`.
- `CandidateCard` accepts optional `text`, `edhrecRank`, `preconCount`, `edhrecTotalDecks`, and `isGameChanger` so all existing callers and unit tests remain backwards-compatible while queries pass the full rich fields.

## 4. Invariants

1. `rating` is always an integer in `[0, 100]`.
2. `sigmoid(0) === 0.5` (`rating === 50`); monotonically increasing in `logit`.
3. Every non-zero `RatingPart` has a human-readable `label`, and `logit === RATING_BIAS + sum(parts.map(p => p.contribution))`.
4. Commander `makes`/`uses` signals carry 3× weight compared to main-deck cards, and deck signal counts are sublinearly dampened (`Math.sqrt`).
5. Format legality, color identity, copy limits, and strict `targetBracket` hiding (`hiddenOverTarget`) remain hard constraints in suggestions.
6. All rating functions are pure and deterministic (no DB, network, or clock calls).

## 5. Read models & UI / MCP

- `src/modules/decks/queries/suggestions.ts`:
  - `suggestionContext` already fetches deck `lines`; extend `view.lines` / `CandidateRow` to include `edhrec_rank` (already on `printings`), `precon_count` (correlated/aggregated from `deck_lists`), and `edhrec_total_decks` (already on `edhrec_commanders`).
  - `Suggestion` exposes `rating: number` (`0–100`) and `ratingParts: RatingPart[]` alongside `reasons`.
- `src/app/_llm-tools/tools/decks.ts`:
  - `suggest_for_deck` and `rank_cuts` include `rating` (`0–100`) and formatted parts in their JSON output so the LLM sees both the calibrated score and why.
- Web UI (`SuggestionsPanel` / `CutsPanel`):
  - Show a compact `0–100` rating badge on each suggested card / cut candidate with its top contributing parts.

## 6. Test plan

- **Domain unit/property tests (`signals.test.ts`, `rate.test.ts`):**
  - `makes` ↔ `uses` matching for Treasures, sacrifice, +1/+1 counters, graveyard, spellslinger, tokens.
  - Commander 3× weighting and `sqrt` dampening properties.
  - `rating` bounds `[0, 100]`, monotonicity, and `logit` sum invariant via `fast-check`.
  - Role deficit scaling, curve-slot saturation penalty, EDHREC confidence weighting, quality prior (`edhrecRank` + `preconCount`), and price/bracket penalties.
- **Evaluation harness (`eval.ts` / `pnpm tsx` or Vitest bench, #57):**
  - Load real precon `deck_lists` (from DB or fixture snapshot), hold out 10 non-land cards per deck, rank the legal candidate pool, and report **Recall@50** and **MRR** across archetypes.
  - Compare baseline (`suggest.ts` v1) vs full `CardRating` and tune `RATING_WEIGHTS`.
- **Verification:** `direnv exec . pnpm check` (typecheck, lint, cycles, format, unit tests).

## 7. Open questions

1. **Precon frequency (`preconCount`):** Should we compute `preconCount` on the fly in `suggestions.ts` or store a lightweight `precon_count` column on `printings` (or a materialized/synced count) during catalog sync? _(Recommendation: compute via a small indexed query or CTE on `deck_lists` first to avoid a migration, and only denormalize if `EXPLAIN ANALYZE` shows >10 ms.)_
2. **#58 Text embeddings:** Confirm we keep #58 gated behind #57's Recall@50 harness results (only build if the harness shows a meaningful gap).
