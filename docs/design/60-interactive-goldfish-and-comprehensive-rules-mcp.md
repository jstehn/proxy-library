# Design: Interactive Goldfishing & Comprehensive Rules in MCP

- **Phase:** 60
- **Status:** **Approved**. Superseded in part (2026-11-19): the interactive goldfish was removed (P24)
- **Related ADRs:** 0001, 0002, 0003, 0006, 0007, 0008, 0009, 0022, 0023
- **Lesson:** no

## 1. Purpose & scope

Extend Proxy Library's unified MCP / OpenAPI tool suite (`src/app/_llm-tools/registry.ts`, ADR 0022) with two capabilities inspired by `artillect/mtg-mcp-servers` and `mtg-mcp`:

1. **Interactive Goldfishing (`decks` module):** A pure, deterministic turn-by-turn tabletop goldfish state machine (`GoldfishState`) and session use cases exposed to LLMs (`goldfish_start`, `goldfish_step`) so an assistant can draw an opening 7, take London mulligans, step through turns 1–5 (`next_turn`, `play_land`, `cast`, `draw`, `tap`, `untap`, `move`, `peek_library`, `shuffle_library`), and evaluate actual lines of play.
2. **Comprehensive Rules Sync & Lookup (`catalog` module):** A worker sync job and anti-corruption layer (ADR 0007) that fetches Wizards of the Coast's official Magic: The Gathering Comprehensive Rules (`.txt`), parses numbered rules and glossary entries, generates local ONNX embeddings (`Xenova/bge-small-en-v1.5`, 384-d) into PostgreSQL `pgvector`, and exposes hybrid exact/keyword/semantic lookup via `lookup_rules`.

**Out of scope:** Full rules enforcement (stack, priority, state-based actions, replacement effects, automatic mana-pool payment), multiplayer game state, or a new interactive browser UI (this phase targets domain + application + infra + MCP/OpenAPI tools; UI can consume the same domain reducer later).

## 2. Ubiquitous language

| Term                        | Meaning in this codebase                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goldfish session**        | A single-player tabletop playtest game on a deck, identified by `sessionId` and holding `GoldfishState`.                                                             |
| **Goldfish card**           | One physical copy in a deck (`key: "oracleId#copyIndex"`), carrying card metadata (`name`, `typeLine`, `manaCost`, `manaValue`, `isLand`, `tags`) for LLM reasoning. |
| **Goldfish zone**           | One of `library` (ordered top-first), `hand`, `battlefield`, `graveyard`, `exile`, or `commandZone`.                                                                 |
| **Comprehensive Rule (CR)** | A numbered section, rule, subrule (e.g. `702.19a`), or glossary entry from Wizards' official Comprehensive Rules text.                                               |
| **Hybrid rule lookup**      | Combining exact rule-number matching, PostgreSQL full-text search (`tsvector`), and `pgvector` cosine similarity via Reciprocal Rank Fusion (RRF).                   |

## 3. Domain model

### 3.1 Interactive goldfishing (`src/modules/decks/domain/goldfish-session.ts`)

Reuses `LibraryCard`, `DrawLine`, `OPENING_HAND`, and `library()` from `src/modules/decks/domain/draws.ts`, extending cards with `manaCost` and `text` where helpful and modeling all tabletop zones.

```ts
export type GoldfishZone =
  "library" | "hand" | "battlefield" | "graveyard" | "exile" | "commandZone";

export type GoldfishCard = LibraryCard &
  Readonly<{
    manaCost?: string;
    isCommander: boolean;
  }>;

export type BattlefieldPermanent = Readonly<{
  card: GoldfishCard;
  tapped: boolean;
  enteredTurn: number;
}>;

export type GoldfishState = Readonly<{
  format: string;
  onTheDraw: boolean;
  freeMulligan: boolean;
  turn: number; // 0 = pre-game / opening hand; 1+ = active turns
  mulligans: number;
  toBottom: number; // > 0 while London mulligan bottoming is pending
  landsPlayedThisTurn: number;
  library: readonly GoldfishCard[]; // index 0 is top of library
  hand: readonly GoldfishCard[];
  battlefield: readonly BattlefieldPermanent[];
  graveyard: readonly GoldfishCard[];
  exile: readonly GoldfishCard[];
  commandZone: readonly GoldfishCard[];
  lastActionNote: string;
}>;

export type GoldfishAction =
  | Readonly<{ kind: "mulligan"; rng: Rng }>
  | Readonly<{ kind: "bottom"; keys: readonly string[] }>
  | Readonly<{ kind: "next_turn" }>
  | Readonly<{ kind: "draw"; count?: number }>
  | Readonly<{ kind: "play_land"; key: string; tapped?: boolean; ignoreLandLimit?: boolean }>
  | Readonly<{
      kind: "cast";
      key: string;
      from?: "hand" | "commandZone" | "graveyard" | "exile";
      to?: "battlefield" | "graveyard" | "exile";
      tapped?: boolean;
    }>
  | Readonly<{ kind: "tap"; key: string }>
  | Readonly<{ kind: "untap"; key: string }>
  | Readonly<{
      kind: "move";
      key: string;
      from: GoldfishZone;
      to: Exclude<GoldfishZone, "library"> | "library_top" | "library_bottom";
    }>
  | Readonly<{ kind: "shuffle_library"; rng: Rng }>;

export type GoldfishError =
  | Readonly<{ kind: "MulliganNotAllowed"; reason: string }>
  | Readonly<{ kind: "PendingBottom"; remaining: number }>
  | Readonly<{ kind: "CardNotFound"; key: string; zone?: GoldfishZone }>
  | Readonly<{ kind: "NotALand"; key: string; name: string }>
  | Readonly<{ kind: "LandLimitReached"; landsPlayedThisTurn: number }>
  | Readonly<{ kind: "InvalidBottomSelection"; expected: number; received: number }>
  | Readonly<{ kind: "EmptyLibrary" }>;
```

### 3.2 Comprehensive Rules (`src/modules/catalog/domain/comprehensive-rules.ts`)

```ts
export type RuleKind = "section" | "rule" | "subrule" | "glossary";

export type ParsedRule = Readonly<{
  ruleNumber: string; // e.g. "702.19", "702.19a", or "glossary:trample"
  kind: RuleKind;
  section: string; // e.g. "702. Keyword Abilities"
  parentNumber: string | null; // e.g. "702.19" for "702.19a"
  title: string | null; // e.g. "Trample" for glossary or keyword heading
  text: string;
}>;

export type ParsedComprehensiveRules = Readonly<{
  version: string; // e.g. "2026-09-01" parsed from effective-date header
  rules: readonly ParsedRule[];
}>;

export type RuleSearchHit = Readonly<{
  ruleNumber: string;
  kind: RuleKind;
  section: string;
  parentNumber: string | null;
  title: string | null;
  text: string;
  crVersion: string;
  score: number;
}>;
```

## 4. Invariants

1. **Card conservation:** Across every `GoldfishAction`, the multiset of `GoldfishCard.key` across `library ∪ hand ∪ battlefield ∪ graveyard ∪ exile ∪ commandZone` is invariant (no cards created or lost).
2. **London mulligan gate:** While `toBottom > 0`, `next_turn`, `draw`, `play_land`, and `cast` return `Err({ kind: "PendingBottom" })`.
3. **Mulligan window:** `mulligan` is only valid when `turn === 0` and `toBottom === 0`; otherwise `Err({ kind: "MulliganNotAllowed" })`.
4. **Commander free first mulligan (CR 103.5c):** When `freeMulligan` is `true`, `toBottom = Math.max(0, mulligans - 1)`; when `false`, `toBottom = mulligans`.
5. **Turn 1 draw rule:** On `next_turn` advancing from `turn === 0` to `turn === 1`, a card is drawn only if `onTheDraw === true`. On `turn >= 1`, `next_turn` untaps all `battlefield` permanents, resets `landsPlayedThisTurn = 0`, increments `turn`, and draws 1 card (if library is non-empty).
6. **Land drop limit:** `play_land` rejects non-land cards (`NotALand`) and rejects a second land drop in the same turn (`LandLimitReached`) unless `ignoreLandLimit: true`.
7. **Deterministic randomness:** All shuffles (`startGoldfish`, `mulligan`, `shuffle_library`) accept an injected `Rng` (ADR 0008).
8. **CR parser completeness & idempotence:** Parsing the same CR text yields identical `ParsedComprehensiveRules` with unique `ruleNumber` keys; glossary entries are normalized as `glossary:<lowercase-slug>`.

## 5. Use cases

| Use case                 | Actor / authz                                                | Input                                                | Output                                                    | Errors (`kind`)                    | Transaction?         |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- | ---------------------------------- | -------------------- |
| `startGoldfish`          | Authenticated user (`read` scope, deck owner or public deck) | `{ userId, deckId, onTheDraw?, freeMulligan?, rng }` | `{ sessionId, state }`                                    | `DeckNotFound`, `EmptyLibrary`     | Yes (insert session) |
| `stepGoldfish`           | Authenticated user (`read` scope, session owner)             | `{ userId, sessionId, action }`                      | `{ sessionId, state, peeked? }`                           | `SessionNotFound`, `GoldfishError` | Yes (update session) |
| `syncComprehensiveRules` | Worker (`catalog` sync)                                      | `{ force?: boolean }`                                | `{ skipped: boolean, version, ruleCount, embeddedCount }` | `GatewayError`                     | Per-batch upsert     |
| `lookupRules`            | Public / MCP (`read` scope)                                  | `{ query, limit? }`                                  | `{ crVersion, hits: RuleSearchHit[] }`                    | `InvalidQuery`                     | No (read query)      |

Note on MCP tools (`src/app/_llm-tools/`):

- `goldfish_start` (`scope: "read"`, `readOnly: false` — creates an ephemeral playtest session; or `decks:write`? Kept in `read` or `decks:write` — see Open Questions).
- `goldfish_step` (`scope: "read"` — advances the session; supports all `GoldfishAction` variants plus `peek_library` (`count`) without mutating deck data).
- `lookup_rules` (`scope: "read"`, `readOnly: true` — hybrid exact rule-number + keyword + semantic lookup).

## 6. Ports

### 6.1 `decks` module (`src/modules/decks/application/ports.ts`)

```ts
export type GoldfishSessionRecord = Readonly<{
  id: string;
  userId: UserId;
  deckId: DeckId;
  state: GoldfishState;
  updatedAt: Date;
}>;

export interface GoldfishSessionRepository {
  create(record: GoldfishSessionRecord): Promise<void>;
  findById(id: string, userId: UserId): Promise<GoldfishSessionRecord | null>;
  save(id: string, userId: UserId, state: GoldfishState, updatedAt: Date): Promise<void>;
  pruneOlderThan(cutoff: Date): Promise<number>;
}
```

### 6.2 `catalog` module (`src/modules/catalog/application/ports.ts`)

Reuses existing `TextEmbedder` (`(texts: readonly string[]) => Promise<number[][]>`) and adds:

```ts
export interface ComprehensiveRulesGateway {
  /** Discover and download the latest official Wizards Comprehensive Rules UTF-8 text. */
  fetchLatestRulesText(): Promise<{ sourceUrl: string; text: string }>;
}

export type ComprehensiveRuleRow = ParsedRule &
  Readonly<{
    crVersion: string;
    embedding: number[];
    updatedAt: Date;
  }>;

export interface ComprehensiveRulesRepository {
  currentVersion(): Promise<string | null>;
  replaceAll(rows: readonly ComprehensiveRuleRow[], syncedAt: Date): Promise<void>;
}
```

## 7. State machines

`GoldfishState` transitions:

| From phase                   | Event             | Guard                                                           | To phase / effects                                                                                     |
| ---------------------------- | ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `turn === 0, toBottom === 0` | `mulligan`        | —                                                               | `mulligans + 1`, reshuffle all cards, deal 7, `toBottom` per CR 103.5c                                 |
| `toBottom > 0`               | `bottom`          | `keys.length === toBottom`, all keys in `hand`                  | Move `keys` to bottom of `library`, `toBottom = 0`                                                     |
| `toBottom === 0`             | `next_turn`       | —                                                               | Untap `battlefield`, `landsPlayedThisTurn = 0`, `turn + 1`, draw 1 (unless `turn === 0 && !onTheDraw`) |
| `toBottom === 0`             | `draw`            | `count >= 1`                                                    | Move up to `count` cards from top of `library` to `hand`                                               |
| `toBottom === 0`             | `play_land`       | `card.isLand`, `landsPlayedThisTurn === 0 \|\| ignoreLandLimit` | Move from `hand` to `battlefield`, `landsPlayedThisTurn + 1`                                           |
| `toBottom === 0`             | `cast`            | card in `from` zone                                             | Move from `from` to `to` (defaults: permanent → `battlefield`, non-permanent → `graveyard`)            |
| any                          | `tap` / `untap`   | card on `battlefield`                                           | Toggle `tapped`                                                                                        |
| any                          | `move`            | card in `from` zone                                             | Move card to `to` zone (`library_top` = index 0, `library_bottom` = end)                               |
| any                          | `shuffle_library` | —                                                               | `shuffled(rng, library)`                                                                               |

## 8. Persistence

### 8.1 `goldfish_sessions` (owned by `decks`, `src/modules/decks/infrastructure/schema.ts`)

| Column       | Type          | Constraints / Notes                                                     |
| ------------ | ------------- | ----------------------------------------------------------------------- |
| `id`         | `text`        | PK (UUID)                                                               |
| `user_id`    | `integer`     | Not null, FK → users                                                    |
| `deck_id`    | `integer`     | Not null, FK → decks (`onDelete: "cascade"`)                            |
| `state`      | `jsonb`       | `$type<GoldfishState>()`, not null                                      |
| `updated_at` | `timestamptz` | Not null                                                                |
| `expires_at` | `timestamptz` | Not null (24h sliding TTL, refreshed on each step), indexed for pruning |

**Expiry & space bounds:** Every `startGoldfish` and `stepGoldfish` call sets `expires_at = now + 24h`. On `startGoldfish`, expired rows (`expires_at < now`) are deleted, and each user is capped at 10 active sessions (oldest beyond 10 are deleted). The nightly worker cleanup also deletes any remaining expired rows so `goldfish_sessions` never grows unbounded.

### 8.2 `comprehensive_rules` (owned by `catalog`, `src/modules/catalog/infrastructure/schema.ts`)

| Column          | Type          | Constraints / Notes                                         |
| --------------- | ------------- | ----------------------------------------------------------- |
| `rule_number`   | `text`        | PK (`"702.19a"`, `"glossary:trample"`)                      |
| `kind`          | `text`        | Not null (`'section' \| 'rule' \| 'subrule' \| 'glossary'`) |
| `section`       | `text`        | Not null                                                    |
| `parent_number` | `text`        | Nullable                                                    |
| `title`         | `text`        | Nullable                                                    |
| `text`          | `text`        | Not null                                                    |
| `cr_version`    | `text`        | Not null                                                    |
| `embedding`     | `vector(384)` | Not null, HNSW index (`vector_cosine_ops`)                  |
| `search_vector` | `tsvector`    | Generated (`to_tsvector('english', coalesce(title, '')      |     | ' ' |     | text)`), GIN index |
| `updated_at`    | `timestamptz` | Not null                                                    |

## 9. Read models (queries)

- `lookupRules(db, embedder, { query, limit })` in `src/modules/catalog/queries/rules.ts`:
  1. **Exact rule-number fast path:** If `query.trim()` matches `/^\d{3}(?:\.\d+[a-z]?)?$/i`, fetch exact match + direct children (`parent_number = normalized` or `rule_number LIKE normalized || '%'`), ordered by `rule_number`.
  2. **Hybrid RRF path:** Embed `query` via `TextEmbedder`, run top-30 `tsvector` FTS candidates (`websearch_to_tsquery('english', query)`) and top-30 `pgvector` cosine-distance candidates, combine ranks with Reciprocal Rank Fusion (`1 / (60 + rank)`), and return top `limit` (default `8`, max `20`).

## 10. Events emitted

None (goldfishing is ephemeral playtesting; CR sync logs a standard `sync_runs` record with `kind = "comprehensive_rules"`).

## 11. Patterns applied

- **Functional core, imperative shell (`patterns.md` §1):** All goldfish transitions (`startGoldfishState`, `stepGoldfishState`) and CR text parsing (`parseComprehensiveRules`) are pure functions with zero I/O.
- **Ports & adapters + ACL (`patterns.md` §2, ADR 0007):** `ComprehensiveRulesGateway` isolates Wizards' HTML/TXT discovery and encoding quirks from the domain parser.
- **Unified LLM tool registry (ADR 0022):** `goldfish_start`, `goldfish_step`, and `lookup_rules` are registered once in `src/app/_llm-tools/registry.ts`, automatically serving both `/api/mcp` and `/api/tools/<name>`.

## 12. Test plan

- **Domain unit & property tests:**
  - `goldfish-session.test.ts`: `fast-check` property test verifying **Invariant 1 (card conservation)** across arbitrary valid action sequences; unit tests for London mulligan (`freeMulligan` true/false), `PendingBottom` gate, turn-1 draw vs on-the-draw, `LandLimitReached`, `cast` routing, `move` to `library_top`/`library_bottom`.
  - `comprehensive-rules.test.ts`: fixture test parsing sample CR header, numbered sections, rules, subrules, and glossary entries; idempotence and uniqueness checks.
- **Use-case tests (fakes):**
  - `goldfish.test.ts` with in-memory `GoldfishSessionRepository` fake.
  - `sync-rules.test.ts` with fake `ComprehensiveRulesGateway`, `ComprehensiveRulesRepository`, and deterministic fake `TextEmbedder`.
- **Contract / integration tests:**
  - Drizzle schema + `lookupRules` hybrid query test against Postgres (`pgvector` + `tsvector` RRF + exact rule-number match).
- **Verification:** `pnpm check` passes cleanly.

## 13. Resolved decisions

1. **Goldfish session storage (`goldfish_sessions` in Postgres with 24h TTL + per-user cap):** Chosen over a stateless HMAC token to keep MCP payloads tiny (`sessionId` UUID instead of multi-KB serialized deck state). Responses return a compact board view (`libraryCount` + active zones, omitting the full `library` array and full oracle text) to minimize LLM token usage. Expired sessions are pruned on `startGoldfish` and in the nightly worker so the table never grows unbounded.
2. **MCP scope (`"read"`):** `goldfish_start` and `goldfish_step` require only `"read"` scope because they never mutate saved decklists.
3. **CR sync cadence:** Runs on the regular sync schedule with a CR-version short-circuit (skips download/embedding when unchanged) plus an admin trigger.
