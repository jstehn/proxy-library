# Design: Deck data from other players (EDHREC)

- **Phase:** 45 (backlog task #86)
- **Status:** **Approved** (2026-11-12)
- **Related ADRs:** 0006 (CQRS-lite reads), 0007 (External data behind an ACL), 0019 (Precomputed/synced card features)
- **Lesson:** no

## 1. Purpose & scope

Bring community Commander deck statistics from EDHREC (inclusion rate and synergy score per commander) into Proxy Library so **deck suggestions** (`deckSuggestions`, `suggest_for_deck`, `budgetList`) and **cards to cut** (`rankCuts`) can recommend synergistic cards that local regex tags miss — especially combos, build-around payoffs, and commander staples — while still respecting ownership, format legality, and target brackets.

**Out of scope:**

- Scraping or proxying EDHREC from Next.js request handlers (all external fetches happen in `catalog` via the worker, per ADR 0007).
- Non-Commander formats (EDHREC only covers Commander).
- Commander popularity ranking on `/decks/commanders` (already uses Scryfall's `edhrec_rank`, design doc 39).

## 2. Ubiquitous language

| Term                 | Meaning in this codebase                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Commander slug**   | EDHREC's URL key for a commander: lowercase front-face name with non-alphanumerics removed and spaces turned into `-` (e.g. `"Atraxa, Praetors' Voice"` → `"atraxa-praetors-voice"`). |
| **Inclusion rate**   | Fraction of recorded EDHREC decks for that commander that play the card (`numDecks / potentialDecks`, in `[0, 1]`).                                                                   |
| **EDHREC synergy**   | EDHREC's `synergy` score in `[-1, 1]`: how much more often this card appears with this commander than with other commanders of the same color identity.                               |
| **Community signal** | Pure `{ inclusionRate, synergy }` pair attached to a candidate or deck line when EDHREC data is present for the deck's commander.                                                     |

## 3. Domain model

### `catalog/domain/edhrec.ts`

```ts
/** Pure slugification for EDHREC commander URLs (front face only for DFCs). */
export function commanderSlug(name: string): string;

export type EdhrecCardEntry = Readonly<{
  cardName: string;
  numDecks: number;
  potentialDecks: number;
  /** Clamped to [0, 1]. */
  inclusionRate: number;
  /** Clamped to [-1, 1]. */
  synergy: number;
}>;

export type EdhrecCommanderPage = Readonly<{
  slug: string;
  totalDecks: number;
  cards: readonly EdhrecCardEntry[];
}>;
```

### `decks/domain/suggest.ts` and `decks/domain/cuts.ts`

```ts
export type EdhrecSignal = Readonly<{
  inclusionRate: number; // [0, 1]
  synergy: number; // [-1, 1]
}>;

// Added as optional on CandidateCard and CutLine so existing callers and tests stay unchanged:
// edhrec?: EdhrecSignal | null;

// New Reason variant in suggest.ts:
// | Readonly<{ kind: "edhrec"; inclusionPct: number; synergyPct: number }>
```

Scoring rule in `suggest.ts`:

- A card earns EDHREC points when `synergy >= 0.05` (5%+) or `inclusionRate >= 0.15` (15%+).
- Points = `WEIGHTS.edhrecSynergy * Math.max(0, synergy) + WEIGHTS.edhrecInclusion * inclusionRate` (capped, e.g. `4 * max(0, synergy) + 2 * inclusionRate`, so strong synergy + high inclusion adds up to ~6 points, comparable to matching a theme + role).
- Adds `{ kind: "edhrec", inclusionPct: Math.round(inclusionRate * 100), synergyPct: Math.round(synergy * 100) }` to `reasons`.
- Never bypasses format legality, color identity, copy limits, or target bracket filtering.

## 4. Invariants

1. **No network in request handlers:** `decks` queries and UI server actions only read Postgres (`edhrec_commanders`, `edhrec_commander_cards`); they never call EDHREC.
2. **Bounded values:** `inclusionRate` is always in `[0, 1]` and `synergy` is always in `[-1, 1]`, enforced in the ACL mapper and DB `CHECK` constraints.
3. **Graceful absence:** When a commander has no cached EDHREC rows (or the deck is not Commander), suggestions and `rankCuts` behave identically to today.
4. **Deduplicated per oracle card:** A commander's `edhrec_commander_cards` has at most one row per `(commander_oracle_id, card_oracle_id)` (if EDHREC lists a card in multiple sections, keep the highest `num_decks` / `synergy`).
5. **Polite fetching:** `EdhrecGateway` rate-limits requests (e.g. 1 req/s with `User-Agent`) and records `not_found` / `error` statuses with `fetched_at` so missing commanders aren't hammered on every sync.

## 5. Use cases

| Use case                      | Actor / authz               | Input                                       | Output                                                          | Errors (`kind`)             | Transaction?         |
| ----------------------------- | --------------------------- | ------------------------------------------- | --------------------------------------------------------------- | --------------------------- | -------------------- |
| `syncEdhrec` (worker)         | System / Admin              | `{ limit?: number; force?: boolean }`       | `EdhrecSyncSummary` (`synced`, `notFound`, `skipped`, `failed`) | — (fail-safe per commander) | Per-commander upsert |
| `deckSuggestions` (query)     | Signed-in user (deck owner) | `userId`, `deckId`, options                 | `SuggestionList` (with `edhrec` reasons)                        | —                           | Read-only            |
| `rankCuts` (pure + query/MCP) | Signed-in user (deck owner) | `lines` (with optional `edhrec`), `context` | `RankedCut[]`                                                   | —                           | Pure / Read-only     |

## 6. Ports

In `catalog/application/ports.ts`:

```ts
export interface EdhrecGateway {
  /** Fetch and Zod-parse one commander's EDHREC page, or null on 404. */
  commanderPage(slug: string): Promise<EdhrecCommanderPage | null>;
}

export interface EdhrecRepository {
  /** Commanders to refresh: those in player decks/precons first, then enabled sets, missing or stale. */
  commandersToSync(
    staleBefore: Date,
    limit: number,
  ): Promise<ReadonlyArray<{ oracleId: string; name: string }>>;
  /** Resolve card names to oracle_ids in our catalog. */
  resolveOracleIdsByName(names: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Upsert commander metadata and replace its card entries atomically. */
  saveCommanderData(
    commanderOracleId: string,
    slug: string,
    status: "ok" | "not_found",
    totalDecks: number,
    entries: ReadonlyArray<{ cardOracleId: string; inclusionRate: number; synergy: number }>,
    fetchedAt: Date,
  ): Promise<void>;
}
```

## 7. Persistence

Owned by `catalog` (`src/modules/catalog/infrastructure/schema.ts`, new Drizzle migration):

1. `edhrec_commanders`
   - `commander_oracle_id` (`text`, primary key)
   - `slug` (`text`, not null)
   - `status` (`text`, not null — `'ok' | 'not_found'`)
   - `total_decks` (`integer`, not null, default `0`)
   - `fetched_at` (`timestamptz`, not null)
2. `edhrec_commander_cards`
   - `commander_oracle_id` (`text`, not null, references `edhrec_commanders.commander_oracle_id` on delete cascade)
   - `card_oracle_id` (`text`, not null)
   - `inclusion_rate` (`doublePrecision`, not null, `CHECK (inclusion_rate >= 0 AND inclusion_rate <= 1)`)
   - `synergy` (`doublePrecision`, not null, `CHECK (synergy >= -1 AND synergy <= 1)`)
   - Primary key: `(commander_oracle_id, card_oracle_id)`
   - Index: `(commander_oracle_id, synergy desc)`

## 8. Read models (queries)

- `src/modules/decks/queries/suggestions.ts`:
  - `suggestionContext` reads the deck's commander `oracleId`(s) (already in `view.lines`).
  - `ownedCandidates` and `storeCandidates` include cards present in `edhrec_commander_cards` for the deck's commander(s) in addition to `sharedCount(want) > 0`, and project `inclusion_rate` and `synergy`.
- `src/modules/decks/queries/cuts.ts` (or `decks.ts` / `rank_cuts` MCP tool):
  - Attaches `edhrec` signal to each `CutLine` when the deck is Commander.
- UI (`deck-builder.tsx` / suggestion reason formatter):
  - Formats `{ kind: "edhrec", inclusionPct, synergyPct }` as e.g. `"EDHREC: 68% of decks (+34% synergy)"`.

## 9. Patterns applied

- **Anti-corruption layer (ADR 0007):** Zod-parsed EDHREC JSON in `catalog/infrastructure/edhrec-gateway.ts` with recorded fixture tests.
- **CQRS-lite cross-module reads (ADR 0006):** `decks/queries` reads `edhrec_commander_cards` directly in SQL; `decks/domain` remains pure.
- **Fail-safe sync step (like WPN in design doc 13):** A 404 or transient error for one commander is recorded/logged without aborting the nightly sync.

## 10. Test plan

- **Domain unit/property tests:**
  - `commanderSlug` (punctuation, apostrophes, accents, double-faced `"Front // Back"`).
  - `scoreForDeck` & `rank` with `edhrec` signals (synergy/inclusion thresholds, reason generation, tie-breaking, zero-leakage when `edhrec` is absent).
  - `rankCuts` with `edhrec` signals.
- **Infrastructure / ACL tests:**
  - `EdhrecGateway` mapper against a recorded EDHREC JSON fixture (deduplication, clamping, 404 handling).
- **Integration tests:**
  - `EdhrecRepository` round-trip (`saveCommanderData`, `commandersToSync` prioritization and staleness).
  - `deckSuggestions` query with seeded `edhrec_commanders` / `edhrec_commander_cards`.

## 11. Decisions from review (2026-11-12)

1. **Sync scope & cadence:** Sync commanders in players' decks and precons first, plus up to 50 missing/stale enabled-set commanders per nightly run (14-day TTL), plus `pnpm worker sync-edhrec` for manual runs.
2. **Partner commanders:** Query each partner's individual EDHREC page and take the max `synergy` / `inclusionRate` per card.
3. **Cards to cut (`rankCuts`):** Include a small keep bonus in `rankCuts` for high-inclusion / high-synergy EDHREC cards so suggestions and cuts agree.
