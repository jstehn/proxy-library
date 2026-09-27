# Design: Catalog & data sync

- **Phase:** 4
- **Status:** **Approved** 2026-09-27 (paper-only rule added in review; open-question proposals accepted)
- **Related ADRs:** 0006 (queries), **0007 (external data behind an anti-corruption layer)**,
  0011 (printing × finish), **0013 (daily price history)**, **0014 (pricing sources, new)**

## 1. Purpose & scope

The `catalog` module is the app's local copy of Magic card data: sets, **printings** (every version
of every card: set, number, finish, treatments), booster pack recipes, sealed products, deck lists,
daily prices and images. Everything else (packs, store, collection, decks) reads from it, and
**nothing talks to MTGJSON or Scryfall except the catalog's sync** (ADR 0007).

Decided with the user:

- **Sets:** the current **Standard** sets are enabled at first; admins enable or disable any set
  later.
- **Sync:** **nightly** in the worker, plus a **"Sync now"** button for admins.
- **Products:** import **all paper** sealed products (packs, boxes, cases, bundles, prerelease
  kits, preconstructed decks, tins) and the **deck lists** they contain.
- **Paper only:** only things that exist _only_ on MTGO or Arena are left out. Anything also
  released in paper (e.g. Commander precons that are on Arena too) is imported (rule 9).
- **Pricing:** singles at market price, sealed at MSRP (ADR 0014). This phase stores prices;
  selling is Phase 6.
- **Images:** downloaded from Scryfall **the first time they're viewed**, then served locally.

**Out of scope:** generating packs (Phase 5), selling (Phase 6), owning cards (Phase 7).

## 2. Vocabulary

| Term               | Meaning in this codebase                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Set**            | A Magic release, identified by a code like `BLB` (Bloomburrow).                                                                         |
| **Enabled set**    | A set players can buy product from. Chosen by admins.                                                                                   |
| **Supporting set** | A set imported only because an enabled set needs its cards, e.g. Bloomburrow boosters include Special Guests (`SPG`).                   |
| **Printing**       | One version of a card: a specific set, collector number and treatment (ADR 0011). Its id is MTGJSON's `uuid`.                           |
| **Oracle id**      | The id shared by every printing of the same card (all Lightning Bolts).                                                                 |
| **Finish**         | `nonfoil`, `foil` or `etched`. Prices differ per finish.                                                                                |
| **Treatment**      | Visual variants: borderless, showcase, extended art, full art, textured/galaxy/surge foil, serialized…                                  |
| **Booster config** | MTGJSON's recipe for one booster type (`play`, `collector`, …): weighted **variants** of slot counts, and **sheets** of weighted cards. |
| **Sealed product** | Anything sold closed: a pack, box, case, bundle, kit, deck or tin. Its **contents** can nest other products.                            |
| **Deck list**      | The fixed cards inside a preconstructed product (starter kit, commander deck, bundle land pack).                                        |
| **Price snapshot** | One day's market price for one printing in one finish (ADR 0013).                                                                       |
| **Sync run**       | One execution of the data sync, with a status and summary, visible to admins.                                                           |
| **Gateway**        | The adapter that talks to one external service (MTGJSON or Scryfall).                                                                   |

## 3. Domain model

```ts
export type SetCode = Brand<string, "SetCode">; // uppercase, e.g. "BLB"
export type PrintingId = Brand<string, "PrintingId">; // MTGJSON uuid
export type Finish = "nonfoil" | "foil" | "etched";
export type Rarity = "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";

export type CardSet = Readonly<{
  code: SetCode;
  name: string;
  releaseDate: string;
  type: string; // "expansion", "core", …
  keyruneCode: string;
  isEnabled: boolean;
  isSupporting: boolean;
  importedVersion: string | null; // MTGJSON version last imported
}>;

export type Printing = Readonly<{
  id: PrintingId;
  setCode: SetCode;
  collectorNumber: string;
  name: string;
  oracleId: string;
  scryfallId: string;
  rarity: Rarity;
  colors: Color[];
  colorIdentity: Color[];
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  layout: string;
  finishes: Finish[];
  treatments: Readonly<{
    borderColor: string;
    frameEffects: string[];
    promoTypes: string[];
    isFullArt: boolean;
    frameVersion: string;
  }>;
  variantLabel: string; // "Borderless · Showcase", "" for the normal version
}>;

export type BoosterConfig = Readonly<{
  setCode: SetCode;
  boosterType: string; // "play", "collector", "prerelease", …
  variants: ReadonlyArray<{ weight: number; slots: Readonly<Record<string, number>> }>;
  sheets: Readonly<Record<string, BoosterSheet>>;
}>;
export type BoosterSheet = Readonly<{
  cards: ReadonlyArray<{ printingId: PrintingId; weight: number }>;
  isFoil: boolean;
  allowDuplicates: boolean;
  balanceColors: boolean;
  isFixed: boolean;
}>;

// A sealed product's contents form a tree (patterns.md #12, Composite).
export type SealedContents = ReadonlyArray<
  | { kind: "pack"; setCode: SetCode; boosterType: string }
  | { kind: "sealed"; productId: SealedProductId; count: number }
  | { kind: "card"; printingId: PrintingId; finish: Finish }
  | { kind: "deck"; setCode: SetCode; deckName: string }
  | { kind: "other"; name: string } // spindowns, storage boxes: shown, no effect
  | { kind: "variable"; options: ReadonlyArray<SealedContents> } // "one of these, at random"
>;
export type SealedProduct = Readonly<{
  id: SealedProductId;
  setCode: SetCode;
  name: string;
  category: string;
  subtype: string | null; // e.g. "booster_box" / "collector"
  releaseDate: string | null;
  contents: SealedContents;
}>;

export type DeckList = Readonly<{
  setCode: SetCode;
  name: string;
  type: string; // "Starter Kit", "Commander Deck", …
  cards: ReadonlyArray<{
    printingId: PrintingId;
    count: number;
    finish: Finish;
    board: "main" | "side" | "commander";
  }>;
}>;
```

**Pure functions (functional core):**

- `variantLabel(treatments)` turns MTGJSON codes into words ("Borderless · Showcase · Surge
  Foil"). The UI never interprets raw codes.
- `supportingSetCodes(set)` lists every set a set's boosters, products and decks draw from.
- `standardSetCodes(scryfallCards)` finds the sets currently legal in Standard (below).
- `priceSnapshots(printings, scryfallPrices, day)` produces one snapshot per printing × finish
  that has a price.
- `isNightlySyncDue(lastRunStartedAt, now, syncTime)` decides whether it's time for the nightly
  run.

**Anti-corruption layer (ADR 0007):** `mapMtgjsonSet(raw)` and `mapScryfallCard(raw)` are pure
mappers from Zod-validated external shapes into the types above. They're tested with **recorded
fixtures** (a trimmed real Bloomburrow file and real Scryfall lines in `tests/fixtures/`).

### Which sets are "Standard"?

Neither source publishes a list of Standard sets, but every Scryfall card carries its legalities.
A set counts as Standard when it's a paper `expansion` or `core` set with at least one card
`legalities.standard === "legal"`. It's computed during each sync from the bulk file we download
anyway. "Enable Standard sets" on the admin page adds any that aren't enabled yet. It never
disables sets that have rotated out, because players may still want them.

## 4. Rules (invariants)

1. **Only the sync talks to MTGJSON and Scryfall**, through gateways, Zod parsing and pure
   mappers. Nothing else ever sees their raw JSON.
2. **Printings are never deleted** (collections will point at them). A sync only inserts or
   updates.
3. **A set is imported in one transaction**: its printings, booster configs, products and deck
   lists change together or not at all.
4. **Imports are skipped** when MTGJSON's version for that set hasn't changed (unless forced).
5. **Enabling a set also imports its supporting sets.** Every card a booster, product or deck
   refers to must exist as a printing, and the import checks this before committing.
6. **One sync runs at a time** (an advisory lock). A second request waits in the queue.
7. **One price snapshot per printing, finish and day.** Re-running on the same day overwrites
   that day's snapshot. Past days are never changed.
8. **Only English printings** are imported (MTGJSON set files are English; Scryfall's
   `default_cards` is filtered to `lang: "en"`).
9. **Paper only** (decided in review). The principle: **exclude something only when it exists
   _only_ digitally.** Anything that also exists in paper is imported, even if it's on MTGO or
   Arena too, such as a Commander precon deck that was also released on Arena, or a card
   available on paper, MTGO and Arena. Concretely:

   | Thing          | Excluded only when…                                                                  | Kept, for example                                        |
   | -------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
   | Set            | MTGJSON marks it online-only (`isOnlineOnly`)                                        | every paper set, even if it's also on Arena              |
   | Printing       | its `availability` lacks `paper` (e.g. an Alchemy rebalanced card)                   | a card available on `["arena", "mtgo", "paper"]`         |
   | Booster type   | it's a digital booster configuration (`play-arena`, names ending `-arena` / `-mtgo`) | `play`, `collector`, `prerelease`, `collector-sample`, … |
   | Sealed product | it's a digital redemption with no paper product (subtype `mtgo_redemption`)          | Commander decks, starter kits, bundles, boxes            |
   | Deck list      | its only purpose is digital redemption (type "MTGO Redemption")                      | Commander decks, starter kit decks, bundle land packs    |

   Two safety checks keep this honest:

   - **Nothing referenced goes missing.** Every card a remaining booster, product or deck refers
     to must be an imported paper printing (rule 5), so a digital-only card can't slip in, and a
     paper product never loses a card by mistake.
   - **The import reports what it skipped** (counts per kind, and the names of skipped products
     and decks) in the sync run summary, so an admin can spot anything excluded that shouldn't
     have been.

10. **Polite to both services** (their published guidance):
    - Scryfall's API is called at most 8 times per second, with a descriptive `User-Agent` and
      `Accept` header.
    - The Scryfall bulk file is downloaded at most once per Scryfall update, and cached on disk.
    - An MTGJSON set file is downloaded only when its version changed.
    - Card images are fetched once each, then served from our disk.

## 5. Use cases

| Use case             | Who              | What it does                                                                    | Errors (`kind`)                         |
| -------------------- | ---------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| `requestSync`        | admin            | queues a sync run (`full` or `prices`)                                          | `Forbidden`, `SyncAlreadyQueued`        |
| `runSync`            | worker           | the sync (below)                                                                | recorded on the run: `failed` + message |
| `setSetEnabled`      | admin            | enables or disables a set. Enabling queues an import (and its supporting sets). | `Forbidden`, `SetNotFound`              |
| `enableStandardSets` | admin            | enables every current Standard set not yet enabled                              | `Forbidden`                             |
| `imageFor`           | anyone signed in | returns a printing's image (from disk, or fetched once and saved)               | `ImageNotFound`                         |

### What a sync run does

```
1. MTGJSON Meta + SetList      → update the list of all sets (names, dates, types)
2. Scryfall bulk file          → download only if newer than the cached copy (~79 MB, gzipped JSON Lines)
   (first pass)                → work out the current Standard sets; on the very first run, enable them
3. For each enabled set        → collect its supporting sets
4. For each set to import      → if MTGJSON's version changed: download the set file (~1 MB),
                                  map it, and save it in ONE transaction (rule 3)
5. Scryfall bulk file          → for every printing we have: today's price per finish, image
   (second pass)                  addresses, legalities (streamed line by line, never loaded whole)
6. Record the run              → status, counts (sets imported, printings, snapshots), duration
```

A `prices` run does only steps 2 (download if newer) and 5. That's the nightly run once the sets
are already imported.

### How "Sync now" reaches the worker

The web app can't run a multi-minute download inside a page request. Instead:

```
admin clicks "Sync now" → requestSync inserts a sync_runs row with status "queued"
worker (every 30 s)     → picks the oldest queued run → status "running" → does the work → "succeeded"/"failed"
nightly                 → the worker queues its own run when isNightlySyncDue(...) says so
admin page              → shows each run's status, timings and summary (refreshes itself while one is running)
```

This is a tiny **job queue** in a database table. It needs no extra infrastructure, and it
survives restarts: a run left `running` by a crash is marked `failed` when the worker starts.

## 6. Ports

```ts
export interface MtgjsonGateway {
  meta(): Promise<{ version: string; date: string }>;
  setList(): Promise<MtgjsonSetSummary[]>;               // parsed + mapped
  set(code: SetCode): Promise<MtgjsonSetFile>;           // parsed + mapped: printings, boosters, products, decks
}

export interface ScryfallGateway {
  /** Path to a local copy of the newest default_cards bulk file (downloaded only if newer). */
  latestBulkFile(): Promise<{ path: string; updatedAt: Date }>;
  /** Stream cards from that file one at a time (parsed + mapped), without loading it all. */
  readBulkFile(path: string): AsyncIterable<ScryfallCard>;
  /** Fallback for a few cards: POST /cards/collection, 75 ids per request. */
  cardsById(ids: readonly string[]): Promise<ScryfallCard[]>;
}

export interface ImageStore {
  get(key: ImageKey): Promise<Uint8Array | null>;        // from disk
  put(key: ImageKey, bytes: Uint8Array): Promise<void>;  // write-then-rename, so no half files
}
export interface ImageFetcher { fetch(url: string): Promise<Uint8Array> }

export interface CatalogRepository { … }                 // sets, printings, boosters, products, decks, snapshots
export interface SyncRunRepository { … }                 // queue, claim, finish, list
```

Plus `Clock` and `UnitOfWork`.

**Adapters:** `httpMtgjsonGateway`, `httpScryfallGateway`, `diskImageStore`,
`httpImageFetcher`, `drizzleCatalogRepository`, `drizzleSyncRunRepository`.

**Fakes:** fixture-backed gateways, an in-memory image store, and in-memory repositories.

**`shared/http`** (patterns.md #14, decorators): `fetchJson`, `downloadToFile`, and the wrappers
`withUserAgent`, `withRateLimit({ perSecond })` and `withRetry({ attempts })`, each written and
tested once, then composed:

```ts
const scryfallFetch = withUserAgent(USER_AGENT)(
  withRateLimit({ perSecond: 8 })(withRetry({ attempts: 3 })(fetch)),
);
```

## 7. State machines

**Sync run:** `queued → running → succeeded | failed`. A run found `running` when the worker
starts becomes `failed` ("interrupted").

**Set:** `available ⇄ enabled`, with `supporting` as a separate flag set by imports.

## 8. Persistence

```sql
card_sets        (code pk, name, release_date, type, is_online_only, keyrune_code, parent_code,
                  is_enabled bool, is_supporting bool, imported_version text, imported_at)
printings        (id pk, set_code fk, collector_number, name, oracle_id, scryfall_id,
                  rarity, colors text[], color_identity text[], mana_cost, mana_value, type_line, layout,
                  finishes text[], border_color, frame_version, frame_effects text[], promo_types text[],
                  is_full_art bool, variant_label, image_uris jsonb, legalities jsonb, updated_at)
                  index (set_code, collector_number), index (oracle_id), unique (scryfall_id)
booster_configs  (set_code fk, booster_type, variants jsonb, sheets jsonb, primary key (set_code, booster_type))
sealed_products  (id pk, set_code fk, name, category, subtype, release_date, contents jsonb)
deck_lists       (set_code fk, name, type, cards jsonb, primary key (set_code, name))
price_snapshots  (printing_id fk, finish, day date, usd_cents bigint,
                  primary key (printing_id, finish, day))                -- ADR 0013
sync_runs        (id pk, kind 'full'|'prices', status, requested_by, requested_at, started_at,
                  finished_at, summary jsonb, error text)
```

Booster sheets and product contents are stored as `jsonb`. They're always read and written as a
whole, and a Zod schema re-checks their shape when loaded (Phase 5 reads them). Printings get
real columns, because screens filter and sort by them.

**Images** live on disk, not in Postgres: `IMAGE_CACHE_DIR/<size>/<scryfallId>-<face>.jpg`.
Sizes are `small` (grids), `normal` (reveals and detail) and `large` (zoom).

**Scryfall bulk file cache:** `SYNC_CACHE_DIR/scryfall/default-cards-<updatedAt>.jsonl.gz`. The
newest copy is kept and older ones deleted.

## 9. Read models (queries)

| Query                             | Used by                    | Returns                                                                 |
| --------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `listSetsForAdmin(db, filter)`    | `/admin/catalog`           | every known set: code, name, date, type, enabled/supporting, card count |
| `enabledSets(db)`                 | `/sets`                    | enabled sets, newest first                                              |
| `setPrintings(db, code, filters)` | `/sets/[code]`             | printings with variant label, rarity, latest price per finish           |
| `printingDetail(db, id)`          | card detail (later phases) | everything about one printing + price history                           |
| `recentSyncRuns(db)`              | `/admin/catalog`           | the last 20 runs with status and summary                                |

## 10. Screens

| Route            | Who     | Purpose                                                                                                         |
| ---------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `/admin/catalog` | admins  | sync status and history, "Sync now", "Enable Standard sets", a searchable list of all sets with enable switches |
| `/sets`          | players | the enabled sets, with set symbols (Keyrune font, loaded from a CDN)                                            |
| `/sets/[code]`   | players | a grid of that set's printings: image, name, variant label, rarity, market price per finish; filters            |
| `/api/images/…`  | players | serves card images from the local cache (fetching once on first request)                                        |

`/sets/[code]` is a plain browser so you can see the imported data. The real store and collection
screens come in Phases 6–7.

## 11. Patterns applied

- **Anti-corruption layer (10):** gateways parse with Zod, and pure mappers produce domain types.
  It's tested against recorded real fixtures.
- **Decorator by composition (14):** HTTP etiquette (user agent, rate limit, retry) is built from
  small wrappers.
- **Composite (12):** sealed contents are a recursive union, and so is the check that all their
  references exist.
- **Functional core (1):** labels, supporting sets, Standard detection, snapshots and the nightly
  timing are all pure functions.
- **Unit of work (5):** one transaction per imported set.
- **CQRS-lite (6):** the set browser reads with SQL, including "latest price per finish".
- **Ports & adapters (2):** the gateways, image store and fetcher are all swappable. Tests never
  touch the network.
- **Job queue in a table:** new here, and documented in the lesson (not a separate pattern entry).

## 12. Test plan

- **Mappers (fixtures):** a trimmed real Bloomburrow set file maps to the expected printings
  (treatments and variant labels), booster configs (variants, sheets, foil flags), sealed products
  (every content kind, including nesting and `variable`) and deck lists. Real Scryfall lines map
  to per-finish prices and image addresses. Malformed input is rejected with a clear message.
- **Paper-only filtering (rule 9):** kept: a printing available on `arena` + `mtgo` + `paper`, a
  Commander precon deck and its sealed product that also exist on Arena, and a `collector-sample`
  booster. Excluded: an Alchemy printing (`arena` only), a `play-arena` booster, an MTGO
  redemption product and deck, and an online-only set. Also, no remaining booster, product or deck
  may refer to an excluded card.
- **Pure functions:** `variantLabel` cases; `supportingSetCodes` (BLB → SPG, BLC, promo sets);
  `standardSetCodes`; `priceSnapshots` (missing prices skipped, one row per finish);
  `isNightlySyncDue` around midnight and daylight-saving edges; plus a property: the nightly
  check fires at most once per day.
- **`shared/http`:** the rate limiter never exceeds N per second (with a manual clock); retry backs
  off and gives up; the user-agent header is present.
- **Use cases (fakes):** the first sync enables Standard sets and imports supporting sets; an
  unchanged version is skipped; a missing referenced card fails that set's import without
  touching others; a second sync request is refused while one is queued; an interrupted run is
  marked failed.
- **Integration:** importing the fixture set into Postgres, twice (idempotent); a price snapshot
  on the same day is overwritten, while a new day adds a row; the image route serves from disk
  after the first fetch (fake fetcher).
- **No test ever calls the real MTGJSON or Scryfall.** A manual `pnpm worker sync` against the
  real services is the final check, and its summary is reported in the lesson.

## 13. Lesson 04 outline

"Pulling in outside data": anti-corruption layers and why raw JSON never leaves the adapter;
Zod schemas for big external formats (only the fields we use); streaming a 79 MB gzipped
JSON Lines file with Node streams and `readline` (compared to Python generators); `AsyncIterable`
and `for await`; decorators by function composition (user agent, rate limit, retry);
idempotent imports and upserts (`ON CONFLICT DO UPDATE`); a job queue in a table; serving files
from a cache with correct HTTP caching headers; recorded fixtures versus live network in tests.

## 14. Decisions from review (all proposals accepted)

1. Nightly sync time: **04:00 in the server's time zone** (configurable with `SYNC_TIME`).
2. Standard detection: **paper expansion/core sets with at least one Standard-legal card**, with
   rotated-out sets left enabled (proposed in section 3).
3. Price history retention: **keep every day** (ADR 0013 estimates 10–15 million rows a year for
   ~50 sets; only enabled and supporting sets get snapshots).
4. Tokens and art cards from set files: **not imported** (they aren't collectible cards here).
   Revisit if bundles need them.
5. Set symbols on `/sets`: **Keyrune icon font from a CDN** (MTGJSON's `keyruneCode` matches it).
   Or no symbols, to avoid the external request.
