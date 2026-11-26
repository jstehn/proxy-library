# Design: Complete Scryfall Search & Deckless Synergy Queries

- **Phase:** 71
- **Status:** **Approved** (2026-11-26)
- **Related ADRs:** 0003, 0007, 0009, 0023, 0026, 0027
- **Lesson:** no (extends existing search parser, catalog sync, and LLM tool patterns)
- **Module pages:** `docs/modules/catalog.md`, `docs/modules/card-features.md`, `docs/modules/decks-building.md`, `docs/modules/llm-tools.md`

## 1. Purpose & scope

Bring Proxy Library's card search language (`src/shared/card-search/` and `src/modules/catalog/cards/queries/search-sql.ts`) to feature parity with Scryfall's paper-English search syntax, fix parser and operator edge cases, backfill the missing Scryfall printing metadata needed for metadata filters (`ft:`, `wm:`, `is:reserved`, etc.), and allow the `search_cards` LLM tool to run batched `queries` without a `deckId`.

**Out of scope:**

- Non-USD currencies (`eur:`, `tix:`, `cheapest:`) — Proxy Library tracks USD market prices only.
- Digital platforms and non-English printings (`game:arena`, `game:mtgo`, `in:arena`, `in:mtgo`, `is:digital`, `lang:`) — the catalog is paper English printings only.
- External third-party tagger/cube datasets (`cube:`, `art:` / `atag:`, full Scryfall `otag:` DB) — `otag:` / `function:` continue to map common tagger names onto Proxy Library's own `tag:` and `theme:` system.
- Inline display directives (`order:`, `sort:`, `direction:`, `unique:`) inside the search string — see Open Questions (§10).

## 2. Ubiquitous language

| Term                        | Meaning in this codebase                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Color count**             | Numeric comparison on color / identity / produced-mana cardinality (`c=2`, `id<=3`, `produces>=2`).                                                                                     |
| **Devotion**                | Count of matching colored mana pips (including hybrid pips) in a card's mana cost (`devotion:ggg`, `devotion>=3`).                                                                      |
| **Combined stats (`pt`)**   | Sum of a face's numeric power and toughness (`pt>=8`, `pt>mv`).                                                                                                                         |
| **Printing extras**         | Per-printing metadata synced from Scryfall bulk data via `saveCardExtras` (flavor text, watermark, reserved list, story spotlight, booster, textless, security stamp, illustration id). |
| **Deckless synergy search** | Running 1–6 labeled Scryfall `queries` in `search_cards` without a `deckId`, returning merged/deduplicated results across `owned`, `game`, `real`, `store`, or `both`.                  |

## 3. Domain model

### 3.1 Search parser (`src/shared/card-search/parse.ts`)

Extend `SearchField`:

```ts
export type SearchField =
  | /* existing 32 fields */
  | "setType"       // st:, set_type:
  | "powTou"        // pt:, powtou:
  | "devotion"      // dev:, devotion:
  | "edhrec"        // edhrec:, edhrec_rank:
  | "layout"        // layout:
  | "prints"        // prints:
  | "sets"          // sets:
  | "in"            // in:foil, in:etched, in:nonfoil, in:<set>
  | "flavor"        // ft:, flavor:
  | "watermark"     // wm:, watermark:
  | "stamp"         // stamp:, security_stamp:
  | "illustrations"; // illustrations:
```

Extend `ComparableField`:

```ts
export type ComparableField =
  "power" | "toughness" | "powTou" | "loyalty" | "defense" | "manaValue";
```

Extend `ColorValue` to support numeric counts:

```ts
export type ColorValue =
  | Readonly<{ kind: "multicolored" }>
  | Readonly<{ kind: "colorless" }>
  | Readonly<{ kind: "count"; count: number }>
  | Readonly<{ kind: "colors"; colors: readonly ManaColor[] }>;
```

Structured mana cost parsing (`parseManaQuery`):

```ts
export type ParsedManaQuery = Readonly<{
  /** Generic mana requirement (e.g. `2` for `{2}` or `10` for `{10}`), or null if none given. */
  generic: number | null;
  /** Non-generic mana symbols and their required counts (e.g. `{G}` -> 2, `{W/U}` -> 1). */
  symbols: ReadonlyMap<string, number>;
  /** True when the input had no recognizable mana tokens. */
  isEmpty: boolean;
}>;
```

### 3.2 Parser fixes & new aliases

1. **Negated parenthesized groups**: `tokenize()` emits `{ kind: "open"; negated: boolean }` when `-(` is encountered, so `-(t:land or t:artifact)` parses as `{ kind: "not", child: { kind: "or", ... } }`.
2. **Single quotes & escaped quotes**: `tokenize()` supports `'...'` phrases identically to `"..."` and respects `\"` / `\'` inside quotes.
3. **`not:` keyword**: Desugars directly in `wordNode()` to `{ kind: "not", child: { kind: "term", term: { field: "is", comparison: ":", value } } }` using the same `is:` validation.
4. **Aliases**:
   - `commander:` and `coloridentity:` → `identity`
   - `edition:` → `set`
   - `st:`, `set_type:` → `setType`
   - `pt:`, `powtou:` → `powTou`
   - `dev:`, `devotion:` → `devotion`
   - `edhrec:`, `edhrec_rank:` → `edhrec`
   - `ft:`, `flavor:` → `flavor` (supports `/regex/`)
   - `wm:`, `watermark:` → `watermark`
   - `stamp:`, `security_stamp:` → `stamp`
   - `c:mono` / `c:monocolor` / `c:monocolored` → `{ kind: "count", count: 1 }`
5. **Non-integer P/T**:
   - `pow:*`, `tou:*`, `loy:*` (with `:`, `=`, `!=`) match faces whose stat contains `*`.
   - Fractional numbers (`pow=1.5`, `tou>=0.5`) compare as `numeric` instead of `int`.
6. **Set-code dates**: `date>=blb` / `year<mh3` accept 2–6 alphanumeric set codes in addition to `YYYY[-MM[-DD]]` / `YYYY` and compare against `(select release_date from card_sets where code = upper($code))`.
7. **`is:` values**:
   - Existing groups extended with:
     - `finish`: `nonfoil`
     - `layout`: `doublefaced`, `doublesided`, `reversible`, `leveler`, `room`, `case`, `battle`, `aftermath`, `prototype`, `mutate`
     - `treatment`: `full` (alias for `fullart`), `ub`, `universesbeyond`, `boosterfun`, `textless`, `spotlight`, `booster`
     - `frame`: `old`, `new`, `modern`, `future`, `inverted`, `nyxtouched`, `tombstone`, `colorshifted`
     - `kind`: `brawler`, `companion`, `partner`, `etb`, `reprint`, `firstprint`, `reserved`, `funny`, `acorn`, `creatureland` (alias for `manland`)
     - `land`: `bondland`, `crowdland`, `filterland`, `horizonland`, `canopyland`, `tangoland`, `battleland`, `shadowland`, `snarl`, `surveilland`, `verge`, `triland`, `karoo`, `storageland`, `tapland`, `bicycleland`

### 3.3 Card features (`land-cycles.ts`, ADR 0027)

All new land-cycle patterns (`bondland`, `filterland`, `horizonland`, `tangoland`, `shadowland`, `surveilland`, `verge`, `triland`, `karoo`, `storageland`, `tapland`) live in `src/modules/catalog/cards/domain/features/recognizers/land-cycles.ts` (never as raw SQL regexes in `search-sql.ts`), with aliases (`crowdland` → `bondland`, `canopyland` → `horizonland`, `battleland` → `tangoland`, `snarl` → `shadowland`, `bicycleland` → `cycleland`) normalized in the parser or SQL lookup. `FEATURES_VERSION` is incremented by 1 so the features pass recomputes `land_cycles`.

Similarly, `is:etb` and `is:partner` avoid adding raw SQL regexes: `is:partner` checks `keywords` (`Partner`, `Partner with`, `Friends forever`, `Choose a Background`, `Doctor's companion`, `Background`), and `is:etb` uses `card_features` (or `enters` check via a recognizer if needed to keep `pnpm regex-count` flat).

### 3.4 Scryfall extras (`src/modules/catalog/cards/domain/types.ts` & `infrastructure/scryfall.ts`)

Extend `ScryfallCard` with:

```ts
flavorText: string | null;
watermark: string | null;
isReserved: boolean;
isStorySpotlight: boolean;
isBooster: boolean;
isTextless: boolean;
securityStamp: string | null;
illustrationId: string | null;
```

Mapped purely in `mapScryfallCard` from `default-cards.jsonl` (combining `card_faces[].flavor_text` with `\n` when top-level `flavor_text` is absent, and taking `card_faces[0].watermark` / `card_faces[0].illustration_id` as fallbacks).

### 3.5 Deckless synergy queries (`src/modules/decks/building/` & `src/app/_llm-tools/`)

```ts
export type CatalogSynergySearchInput = Readonly<{
  queries: readonly SynergyQuery[];
  where: "owned" | "game" | "real" | "store" | "both";
  perQuery: number;
  maxPriceCents: number | null;
}>;

export type CatalogSynergySearch = Readonly<{
  queries: readonly QueryReport[];
  cards: readonly MergedCard[];
}>;
```

`makeDeckSearch` gains `searchQueries` (parallel to `semantic` supporting optional `deckId`), delegating to `searchForDeck` when `deckId` is present and `searchCatalogQueries` when `deckId` is omitted. `search-cards.ts` stays a thin adapter (ADR 0026).

## 4. Invariants

1. **Negated groups**: `-(a or b)` produces `not (a or b)` in both AST and SQL; nested `-(a -(b or c))` works identically.
2. **Color & identity counts**: `c=2`, `c>=3`, `id<=2`, `c:mono` filter by `cardinality(column)` and never emit "isn't a color" notes.
3. **Mana cost comparisons**:
   - `m:2g` / `m>=2g` matches `{2}{G}`, `{3}{G}`, `{2}{G}{G}` (generic ≥ 2 and at least one `{G}`).
   - `m=2g` matches `{2}{G}` only (exact generic and exact symbol multiset).
   - `m<2g` / `m<=2g` / `m>2g` perform strict/non-strict multiset + generic comparisons.
   - Multi-digit generic costs like `m:10g` or `m:{10}{G}` parse as generic `10`, not `{1}` and `{0}`.
4. **`produces:` parity**: Supports `:` / `>=` (at least), `=` (exact), `<=` (within), `<` / `>` (strict), `!=`, and numeric counts (`produces>=2`, `produces=0`).
5. **`not:` parity**: `not:<value>` produces the exact negation of `is:<value>` and validates `<value>` against `ALL_IS_VALUES`.
6. **Non-integer stats**: `pow:*` matches `*`, `1+*`, `2+*`; `pow=1.5` matches `1.5` without Postgres cast errors.
7. **Set-code dates**: `date>=blb` compares against `card_sets.release_date` for `BLB`; an unknown set code produces a non-matching condition safely (no SQL error).
8. **Regex ratchet (ADR 0027)**: `pnpm regex-count` does not increase; all new land-cycle / oracle-text patterns live in `catalog/cards/domain/features/recognizers/`.
9. **Deckless `queries` in `search_cards`**: Calling `search_cards` with `queries` and no `deckId` succeeds across `where: "owned" | "game" | "real" | "store" | "both"`, merges/deduplicates cards across queries with `synergies` labels, and does not apply any deck-specific color/format/bracket filter.
10. **Backward compatibility**: All existing search queries, `printings` rows (before the next Scryfall sync), and `search_cards` calls behave identically.

## 5. Use cases

| Use case                                         | Actor / authz         | Input                                                                                     | Output                                                           | Errors (`kind`)      | Transaction? |
| ------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------- | ------------ |
| `search_cards` (syntax + `queries`, no `deckId`) | Authenticated `Actor` | `queries`, `where`, `maxPerQuery`, `maxPriceCents`, `sort`, `includeText`, `includePrice` | `CatalogSynergySearch` presented as compact `{ queries, cards }` | `InvalidInput`       | No (read)    |
| `sync` (Scryfall pass)                           | Worker / `AdminActor` | Scryfall `default-cards.jsonl`                                                            | Populates 8 new `printings` columns via `saveCardExtras`         | Existing sync errors | Per-batch    |

## 6. Persistence

One drizzle-kit migration adding 8 columns to `printings` (`src/modules/catalog/cards/infrastructure/schema.ts`):

| Column               | Type      | Default / Nullability    | Source                                                       |
| -------------------- | --------- | ------------------------ | ------------------------------------------------------------ |
| `flavor_text`        | `text`    | nullable                 | Scryfall `flavor_text` / `card_faces[].flavor_text`          |
| `watermark`          | `text`    | nullable                 | Scryfall `watermark` / `card_faces[0].watermark`             |
| `is_reserved`        | `boolean` | `not null default false` | Scryfall `reserved`                                          |
| `is_story_spotlight` | `boolean` | `not null default false` | Scryfall `story_spotlight`                                   |
| `is_booster`         | `boolean` | `not null default false` | Scryfall `booster`                                           |
| `is_textless`        | `boolean` | `not null default false` | Scryfall `textless`                                          |
| `security_stamp`     | `text`    | nullable                 | Scryfall `security_stamp`                                    |
| `illustration_id`    | `text`    | nullable                 | Scryfall `illustration_id` / `card_faces[0].illustration_id` |

No new tables required. Existing rows default safely (`null` / `false`) until the next Scryfall sync populates them via `saveCardExtras`.

## 7. Read models (queries)

- `src/modules/catalog/cards/queries/search-sql.ts`: compiles all new `SearchField` and `is:` cases to parameterized SQL. To keep file sizes manageable and readable, pure helper builders (e.g. mana-cost SQL, devotion SQL, `is:` SQL) may be extracted into sibling helper files in `src/modules/catalog/cards/queries/` (currently 11 source files; keep within the 12-file folder limit or extract a `search/` subfolder if needed).
- `src/modules/decks/building/queries/search-for-deck.ts`: adds `searchCatalogQueries(db, userId, input)` sharing `ownedHits` / `storeHits` (parameterized by pool `game` / `real` / `owned` / `store` / `both` and optional `fitsDeck` condition) and `searchForDeckResult`.
- `src/shared/card-search/help.ts`: updated so both the Search Help page and the LLM `searchHelpText()` document every new keyword and `is:` value.

## 8. Patterns applied

- **Functional core**: `parse.ts`, `help.ts`, `scryfall.ts` (`mapScryfallCard`), and `land-cycles.ts` are pure, deterministic functions.
- **Anti-corruption layer (ADR 0007)**: Scryfall fields are Zod-parsed in `scryfall.ts` and mapped to domain types before touching the repository.
- **Thin adapters (ADR 0026)**: `search-cards.ts` validates input, delegates to `deckSearch.searchQueries`, and presents the result via `present/search-cards.ts`.
- **Recognizers over SQL regexes (ADR 0027)**: New land cycles live in `land-cycles.ts` with fixture tests.

## 9. Test plan

- **Domain unit tests**:
  - `src/shared/card-search/parse.test.ts`: `-(a or b)`, single quotes, escaped quotes, `c=2`/`id<=2`/`c:mono`, `m=`/`m>=`/`m<=`/`m:10g`, `produces>=2`/`produces=wu`, `not:`, `pow:*`, `pow=1.5`, `pt>mv`, `devotion:`, `st:`, `edhrec:`, `layout:`, `prints:`, `sets:`, `in:`, `ft:`, `wm:`, `stamp:`, `illustrations:`, `date>=blb`, all new `is:` values.
  - `src/shared/card-search/help.test.ts`: verify help stays in sync with `IS_VALUES` and keywords.
  - `src/modules/catalog/cards/infrastructure/scryfall.test.ts`: mapping of the 8 new Scryfall fields (single-face and multi-face).
  - `src/modules/catalog/cards/domain/features/recognizers/land-cycles.test.ts`: real card text fixtures for every added land cycle.
  - `src/modules/decks/building/application/deck-search.test.ts` & `src/app/_llm-tools/registry.test.ts`: `search_cards` with `queries` and no `deckId` across `owned`, `game`, `real`, `store`, `both`.
- **Integration tests (`pnpm test:int`)**:
  - `src/modules/catalog/cards/queries/search-language.int.test.ts`: real Postgres execution of all new operators, mana comparisons, devotion, `pt:`, `prints:`/`sets:`, `is:reprint`/`is:firstprint`, `date>=<set>`, `ft:`, `wm:`, `is:reserved`, `stamp:`, `illustrations:`, and `-(...)`.
  - `src/modules/decks/building/queries/search-for-deck.int.test.ts`: deckless `searchCatalogQueries` against `owned`, `game`, `real`, `store`, `both`.
- **Gate**: `pnpm check` (typecheck, lint, cycles, format, unit tests, ratchets, knip) and `pnpm test:int`.

## 10. Resolved questions

1. **Inline `order:` / `direction:` / `unique:` directives**: Deferred — keep sorting/dedup on the existing UI/tool parameters (`sort`, `oneRowPerCard`) rather than parsing display directives inside the search string.
2. **Lesson**: `no`.
