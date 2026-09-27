# Lesson 04: Pulling in outside data

- **Phase:** 4 (catalog & data sync)
- **Prerequisites:** [Lesson 03](03-wallet-ledger-and-time.md): transactions, idempotency,
  property tests
- **Time:** 2–3 hours, best split across the parts
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Explain why outside data goes through an **anti-corruption layer**, and build one with Zod
   schemas and pure mappers.
2. Process a file far bigger than memory as a **stream**, using async generators and
   `for await`.
3. Add behavior to a function by **wrapping** it (user agent, rate limit, retry), and compose
   the wrappers.
4. Write **idempotent imports** with upserts, split into short transactions.
5. Run long work outside web requests with a **job queue** in a database table.
6. Test against **recorded fixtures**, and explain why one **real run** is still essential.

---

# Part A: Keeping outside data at the edge

## A1. The problem: other people's JSON

MTGJSON and Scryfall publish enormous JSON formats that change over time. If their shapes spread
through the app (`card.identifiers.scryfallOracleId` in a page, `prices.usd_foil` in the store),
every upstream change breaks code everywhere.

An **anti-corruption layer** (ACL) stops that at the edge. Outside data is translated into
**our own types** in one place, and nothing past that point knows MTGJSON or Scryfall exist:

```
MTGJSON JSON ─▶ Zod schema (just the fields we use) ─▶ pure mapper ─▶ Printing, BoosterConfig, …
                   mtgjson-schema.ts                     mtgjson-mapper.ts        domain/types.ts
```

## A2. Zod schemas for the fields we use

From [`mtgjson-schema.ts`](../src/modules/catalog/infrastructure/mtgjson-schema.ts):

```ts
export const MtgjsonCard = z.object({
  uuid: z.string(),
  name: z.string(),
  number: z.string(),
  finishes: z.array(z.string()).default([]),
  availability: z.array(z.string()).default([]),
  side: z.string().optional(),
  identifiers: z.object({
    scryfallId: z.string().optional(),
    scryfallOracleId: z.string().optional(),
  }),
  // …
});
```

A real MTGJSON card has about 50 fields, and we name about 20. Zod **drops the rest**, so they
can't leak inward. `.default([])` means "if it's missing, use an empty list", which is how the
schema absorbs MTGJSON leaving out empty fields. This is lesson 01's "parse, don't validate",
applied to a 5 MB file.

## A3. Pure mappers do the translating

From [`mtgjson-mapper.ts`](../src/modules/catalog/infrastructure/mtgjson-mapper.ts):

```ts
export function mapPrinting(raw: MtgjsonCard): Printing | null {
  if (!isPaperPrinting(raw.availability)) return null; // your paper-only rule
  // …
  return {
    id: PrintingId.of(raw.uuid),
    collectorNumber: raw.number,
    finishes: FINISHES.filter((finish) => raw.finishes.includes(finish)), // always the same order
    variantLabel: variantLabel(treatments), // "Borderless · Showcase"
    // …
  };
}
```

Mappers are pure functions, so they're tested by feeding them real data and checking the result
([`mtgjson-mapper.test.ts`](../src/modules/catalog/infrastructure/mtgjson-mapper.test.ts)). Rules
like "paper only" and "what does `raisedfoil` mean" live in the domain
([`rules.ts`](../src/modules/catalog/domain/rules.ts)), and the mapper calls them.

## A4. When real data surprised us

The fixtures (small, trimmed copies of real files) passed every test. Then the first real sync
found three problems in a few minutes:

| Surprise                    | What happened                                                                                                          | Fix                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Double-faced cards**      | MTGJSON stores one entry per _face_, and both faces share a Scryfall id, so our unique column rejected the second face | keep only the front face, and point references to any face at it                          |
| **"Standard" was 120 sets** | basic lands are legal in _every_ set, and old sets contain reprints that are legal again                               | a set counts only if ≥ 50% of its non-basic cards are legal (real data: 99–100% vs ≤ 24%) |
| **45 sets refused**         | one odd product (a fat pack containing another set's land pack) failed the whole set                                   | leave out just that product, and report it                                                |

The lesson: **tests prove your code does what you meant; a real run tests whether you meant the
right thing.** Keep fixtures for speed and repeatability, but run against the real service once
before building anything on top of it. Section 15 of
[design doc 04](../docs/design/04-catalog.md) records what changed.

---

# Part B: A file bigger than memory

## B1. Streaming

Scryfall's bulk file is 79 MB gzipped and over 500 MB unzipped. Loading it whole
(`JSON.parse(readFileSync(...))`) would need gigabytes of memory. Instead, we **stream** it: read
a little, handle it, and move on. From
[`gateways.ts`](../src/modules/catalog/infrastructure/gateways.ts):

```ts
async *readBulkFile(path: string) {
  const lines = createInterface({
    input: createReadStream(path).pipe(createGunzip()), // read the file → unzip as it goes
    crlfDelay: Infinity,
  });
  for await (const line of lines) {                     // one line (= one card) at a time
    const parsed = ScryfallCardSchema.safeParse(JSON.parse(line));
    if (!parsed.success) continue;                      // one odd card shouldn't stop the sync
    yield mapScryfallCard(parsed.data);
  }
}
```

The file is **JSON Lines**: one card per line, which is what makes line-by-line reading possible.
`.pipe(createGunzip())` connects two streams, so bytes flow from disk through the unzipper as
they're read, like a Unix pipe.

## B2. Async generators: Python generators, but async

`async *readBulkFile` (note the `*`) is an **async generator**. `yield` hands out one card at a
time, and the caller pulls them with `for await`:

```ts
for await (const card of scryfall.readBulkFile(path)) {
  tallyStandard(tally, card);
  // …
}
```

It's the same idea as Python's generators:

```python
async def read_bulk_file(path):
    async for line in lines:
        yield map_card(json.loads(line))

async for card in read_bulk_file(path): ...
```

Only one card exists in memory at a time, and the price pass collects results in batches of 500
before writing them.

---

# Part C: Being a good citizen of the internet

## C1. Wrapping a function to add behavior

Scryfall asks callers to identify themselves, to stay under 10 requests per second, and to back
off when told to. Instead of scattering that through the code, each rule is a **wrapper**: it
takes a fetch function and returns a new one that does one extra thing. From
[`shared/http/fetch.ts`](../src/shared/http/fetch.ts):

```ts
export function withUserAgent(userAgent: string): FetchWrapper {
  return (next) => (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", userAgent);
    return next(url, { ...init, headers });
  };
}
```

`withUserAgent(ua)` returns a function that takes `next` (the fetch it wraps) and returns a new
fetch. The wrappers stack like layers, from
[`src/server/core.ts`](../src/server/core.ts):

```ts
function politeFetch(perSecond: number): Fetch {
  const withRetries = withRetry({ attempts: 3, sleep: realSleep })(platformFetch);
  const limited = withRateLimit({ perSecond, clock, sleep: realSleep })(withRetries);
  return withUserAgent(userAgent)(limited);
}
```

This is Python's decorator idea (`@retry` on top of `@rate_limit`), done with plain functions.
Each wrapper is written and tested once, and the gateways never know it's there.

## C2. A property test finds a float bug

The rate limiter spaces requests `1000 / perSecond` milliseconds apart. A property test, "for
any rate and any number of simultaneous requests, the waits are exact multiples of the
interval", failed immediately:

```
expected [ 166.666748046875 ] to deeply equal [ 166.66666666666666 ]
```

At 6 per second the interval is 166.666… ms. Adding it to a timestamp around 1.7 trillion
milliseconds loses float precision, the same trap lesson 00 showed with `0.1 + 0.2`. The fix
rounds the interval **up** to whole milliseconds (`Math.ceil`), which is exact and never faster
than the limit. That property test is now in
[`fetch.test.ts`](../src/shared/http/fetch.test.ts).

## C3. Download only what changed

Scryfall publishes the bulk file once a day and asks callers not to download it more often.
`latestBulkFile()` asks Scryfall for the file's `updated_at` (a tiny request), names the local
copy after it, and downloads only when that name isn't already on disk. MTGJSON set files are
downloaded only when the set was never imported (or on a `full` run). Card images are fetched
once, then served from disk: about 150 ms the first time, about 1 ms after that.

---

# Part D: Importing safely

## D1. Upserts make imports idempotent

A sync can run any number of times, so saving must be **idempotent** (lesson 03). An **upsert**
does it in SQL: insert, or update the row if the key already exists:

```sql
insert into printings (id, name, …) values (…)
on conflict (id) do update set name = excluded.name, …   -- excluded = the row we tried to insert
```

Drizzle's `.onConflictDoUpdate({ target, set })` writes this. Price snapshots use the same idea
with the key `(printing, finish, day)`, which gives rule 7 for free: running twice on the same
day replaces that day's price, and a new day adds a row.

Rows are chunked 500 per statement, because Postgres allows at most 65,535 parameters in one
statement (500 printings × 23 columns fits).

## D2. Short transactions for long work

A sync takes about 35 seconds. One transaction around all of it would hold locks the whole time
and roll back everything on a single error. Instead there's **one transaction per imported set**
(rule 3: a set's cards, boosters, products and decks change together) and **one per batch of 500
prices**. A crash midway leaves every finished set complete and the rest untouched, and the next
run carries on.

## D3. Leave out what's broken, and say so

Rule 5: nothing kept may refer to something missing. `withoutBrokenReferences` removes each
booster, deck or product whose references can't be satisfied, **repeating until nothing
changes**, because removing a booster breaks the box made of those boosters, which breaks the
case made of those boxes. Everything removed is listed in the run's summary, so an admin can see
exactly what's missing and why (for example, "unknown booster FRA/play" for a set MTGJSON hasn't
finished yet).

---

# Part E: Work that takes minutes

## E1. A job queue in a table

A page request can't run a multi-minute download: the browser would time out. So "Sync now"
only **queues** the work:

```
admin clicks "Sync now" → requestSync inserts a row in sync_runs: status "queued"
worker (every 30 s)     → claimNext marks the oldest queued run "running" → runs it → "succeeded" / "failed"
nightly                 → the worker queues its own run when isNightlySyncDue(...) says so
```

`claimNext` takes an advisory lock (lesson 02), so even two workers can't run two syncs at once.
If the worker crashes mid-run, the row stays "running" forever, so on startup
`recoverInterruptedRuns()` marks such rows failed. The admin page re-renders every few seconds
while a run is active (`router.refresh()` from a small client component).

Try it: start `pnpm worker schedule` in one terminal, click **Sync prices now** on
`/admin/catalog`, and watch the run go from queued to running to succeeded.

## E2. Testing without the network

Every catalog test uses **recorded fixtures**: small, trimmed copies of real files
([`tests/fixtures/`](../tests/fixtures/README.md)). The fixture gateways read them through the
**same** schemas and mappers as the HTTP gateways, so the anti-corruption layer is fully tested,
and the tests are fast and repeatable and never depend on MTGJSON being up. The end-to-end tests
load the catalog the same way, and answer card-image requests locally (`page.route(...)`) so the
browser never reaches Scryfall.

---

## Common mistakes

| Mistake                                                | Why it happens                 | Avoid it by                                             |
| ------------------------------------------------------ | ------------------------------ | ------------------------------------------------------- |
| Using an external API's JSON directly in pages         | it's right there               | translate at the edge into your own types               |
| `JSON.parse(readFileSync(bigFile))`                    | it works on a small test file  | stream it (JSON Lines + `readline` + `for await`)       |
| Assuming ids are unique per row in someone else's data | it's true in your fixtures     | check against real data; read their model docs          |
| One transaction around a multi-minute job              | "all or nothing" sounds safest | small transactions around units that must be consistent |
| Downloading on every run                               | simplest                       | check a cheap "last updated" first; cache on disk       |
| Doing slow work inside a page request                  | it's one click                 | queue it; let a worker do it; show status               |
| Trusting only fixtures                                 | tests pass                     | do one real run before building on the data             |

## Exercises

### 1. Run a sync and read what it did (warm-up)

Run `pnpm worker sync`. Then find in the output how many cards were priced, which sets were
imported, and what was left out. Run it again straight away. What changes, and why is it fast?

<details><summary>Solution</summary>

The second run downloads nothing: the bulk file's `updated_at` hasn't changed, and every enabled
set is already imported, so there are no MTGJSON downloads either. It only re-reads the cached
bulk file and **upserts** today's prices. The number of snapshots stays the same, because
`(printing, finish, day)` already exists for today.

</details>

### 2. Name a new treatment

MTGJSON might one day add a promo type `"firstplacefoil"`. What does `variantLabel` show for it
today? Add it so it shows **"First Place Foil"**, with a test.

<details><summary>Solution</summary>

Today it shows nothing: unknown codes are ignored on purpose, so gibberish never reaches
players. To add it, put a pair into `PROMO_TYPE_LABELS` in
[`rules.ts`](../src/modules/catalog/domain/rules.ts):

```ts
["firstplacefoil", "First Place Foil"],
```

and test it:

```ts
expect(variantLabel({ ...plain, promoTypes: ["firstplacefoil"] })).toBe("First Place Foil");
```

(`plain` is the no-treatment object already defined in `rules.test.ts`.)

</details>

### 3. Write an async generator

Write `take(items, count)`, an async generator that yields only the first `count` items of any
`AsyncIterable` and then stops, even if the source is endless.

<details><summary>Solution</summary>

```ts
async function* take<T>(items: AsyncIterable<T>, count: number): AsyncGenerator<T> {
  if (count <= 0) return;
  let taken = 0;
  for await (const item of items) {
    yield item;
    taken++;
    if (taken >= count) return;
  }
}

async function* numbers() {
  let n = 0;
  while (true) yield n++;
}
// for await (const n of take(numbers(), 3)) → 0, 1, 2
```

Returning from the generator also stops the `for await` loop over the source. With the bulk
file, that closes the file stream early.

</details>

### 4. Write your own fetch wrapper

Write `withLogging(log)`, a `FetchWrapper` that calls `log("200 https://…")` after each request,
and test it with a fake fetch.

<details><summary>Solution</summary>

```ts
function withLogging(log: (line: string) => void): FetchWrapper {
  return (next) => async (url, init) => {
    const response = await next(url, init);
    log(`${response.status} ${url}`);
    return response;
  };
}

const lines: string[] = [];
const fake: Fetch = async () => new Response("ok", { status: 200 });
await withLogging((line) => lines.push(line))(fake)("https://example.test/x");
// lines → ["200 https://example.test/x"]
```

To use it, wrap it around the others in `politeFetch`. The order decides what it sees: on the
outside, it logs once per call; placed inside `withRetry`, it would log every retry.

</details>

### 5. Latest price with `DISTINCT ON`

Write a SQL query for the latest price of each finish of Bloomburrow #1 (Banishing Light).

<details><summary>Solution</summary>

```sql
select distinct on (s.finish) s.finish, s.day, s.usd_cents
from price_snapshots s
join printings p on p.id = s.printing_id
where p.set_code = 'BLB' and p.collector_number = '1'
order by s.finish, s.day desc;
```

`distinct on (finish)` keeps the **first** row for each finish, and `order by finish, day desc`
makes that first row the newest. It's a Postgres extension to SQL (similar to pandas'
`sort_values(...).drop_duplicates("finish")`). The set browser's query uses it too.

</details>

### 6. Why was it left out? (discussion)

Open `/admin/catalog`, expand a sync run's **Details**, and find `leftOut`. Pick two entries and
explain, from the message alone, why each product couldn't be kept.

<details><summary>Solution</summary>

For example:

- `FRA: product "Reality Fracture Play Booster Pack": unknown booster FRA/play`: MTGJSON has no
  booster data for this set yet, so a pack of it can't be generated. Every box, case and Draft
  Night made of those packs is then left out too (removal repeats until nothing more changes).
- `BLB: product "Bloomburrow Tin Mouse": unknown product 0989bd17-…`: the tin contains a product
  listed under a _different_ set, which isn't imported.

Both follow rule 5: we never keep something we couldn't actually open.

</details>

## Recap

- Outside data enters through an **anti-corruption layer**: Zod keeps only the fields we use, and
  pure mappers produce our own types.
- **Stream** big files: JSON Lines + gunzip + `readline` + **async generators** and `for await`.
- Add behavior by **wrapping** functions (user agent, rate limit, retry) and composing them.
- Imports are **idempotent** (upserts) and split into **short transactions**. Broken pieces are
  left out and reported, never half-saved.
- Long work runs in a **worker**, fed by a **job queue** table, with recovery after crashes.
- **Fixtures** make tests fast and offline. **One real run** caught three bugs no fixture could.

## Further reading

- [Design doc 04: catalog](../docs/design/04-catalog.md), especially section 15
- [ADR 0007: external data behind an ACL](../docs/adr/0007-external-data-acl.md),
  [0013: price history](../docs/adr/0013-price-history-and-store-ledger.md),
  [0014: pricing sources](../docs/adr/0014-pricing-sources.md)
- MTGJSON data models: <https://mtgjson.com/data-models/>
- Scryfall API docs: <https://scryfall.com/docs/api> (see "Bulk Data" and the rate-limit notes)
- Node.js docs: "Stream", and `readline`'s async iterator
- PostgreSQL docs: `INSERT … ON CONFLICT` and `SELECT DISTINCT ON`
