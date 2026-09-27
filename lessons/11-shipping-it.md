# Lesson 11: Shipping it

- **Phase:** 11 (activity, export & Docker)
- **Prerequisites:** [Lesson 06](06-transactions-across-modules.md) (functions that run in the
  caller's transaction), [Lesson 04](04-pulling-in-outside-data.md) (fixtures vs a real run)
- **Time:** 2–3 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Record **events in the same transaction** as the change they describe, and decide what an event
   should (and shouldn't) contain.
2. Write **CSV** that every spreadsheet reads back, and serve a file download from a route.
3. Run **checks against real data** as a habit, and handle data that disappears upstream by
   **unlisting** instead of deleting.
4. Build a **Docker image** in stages, run a stack with **Compose**, and fix the permission and
   signal problems that come with containers.
5. Organize tests **by cost**, keeping anything that touches the network opt-in.
6. Explain why overlapping queries on **one database connection** are a problem.

---

# Part A: Telling the playgroup

## A1. Events in the same transaction

The activity feed shows "Rin opened a Bloomburrow Play Booster and pulled Caretaker's Talent
$11.09". The naive way is to insert the feed row after the opening succeeds. But "after" has a
gap. If the insert fails, the pull happened and the feed never mentions it. If the event is
written first and the opening then rolls back, the feed brags about a card nobody got.

So the event is written **inside the opening's transaction**, like every other piece of the
opening. From [`open.ts`](../src/modules/inventory/application/open.ts):

```ts
await receiveCards(services, item.ownerId, packGains(pack), { source: "pack", ref, at: now });
await recordPull(services, item, pack, now); // → recordEvent(services, { kind: "pull", … }, now)
```

Both succeed or neither does. This is the **transactional outbox** pattern, in its simplest form
(patterns.md 16): the "outbox" is just the `activity_events` table, and the feed reads it
directly. A bigger system would have a separate process send those rows on (e-mails,
notifications). The part that matters, **same transaction**, is the same.

`recordEvent` has the same shape as `spend` and `receiveCards` (lesson 06): it takes the
caller's `services`, and the module declares what it needs as `ActivityServices`.

## A2. What goes in an event

An event is a **public** record, so decide what it carries on purpose:

```ts
| { kind: "purchase"; actorId: UserId; productName: string; quantity: number }
```

No price: the group agreed that money amounts other than card prices stay private. A trade event
says who traded and how many cards, not what or for how much. It's easier to add a field later
than to remove one people have already seen. That's **data minimization**: store what the feature
needs, nothing more.

---

# Part B: Taking your data with you

## B1. CSV is harder than it looks

"Comma-separated values" breaks the moment a value contains a comma, like **Borrowing 100,000
Arrows**, or a quote: **Kongming, "Sleeping Dragon"**. The rules everyone follows (RFC 4180):

- A field containing a comma, a double quote or a line break is wrapped in double quotes.
- A double quote inside such a field is written twice.
- Lines end with `\r\n`.

From [`export.ts`](../src/modules/collection/domain/export.ts):

```ts
export function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
```

`Kongming, "Sleeping Dragon"` becomes `"Kongming, ""Sleeping Dragon"""`. In Python, the `csv`
module does this for you. Here it's one small, tested function that every exporter uses.

The exporters themselves are a strategy table again (lessons 05 and 09): Moxfield's CSV, a text
list, and a full CSV, all with the shape `(rows) → string`.

## B2. A route that returns a file

A route handler returns a web-standard `Response`. The `Content-Disposition: attachment` header
tells the browser to save it rather than display it. From
[`route.ts`](../src/app/api/export/collection/route.ts):

```ts
return new Response(COLLECTION_EXPORTERS[format](rows), {
  headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="collection-moxfield.csv"`,
  },
});
```

Python equivalent: Flask's `send_file(…, as_attachment=True)`. The end-to-end test clicks the link
and reads the downloaded file back.

---

# Part C: Real data keeps surprising you

## C1. Checks that run on everything

Lesson 05's `check-packs` opened 1,000 packs of every real booster recipe. This phase adds
`check-products`: unpack every product for sale, all the way down its tree, and report any that
give nothing or name something that doesn't exist. Its first run on real data found **six**:

| Product                            | Problem                                             |
| ---------------------------------- | --------------------------------------------------- |
| TMT Turtle Team-Up (and its case)  | contains the "Enemy Deck", whose card list is empty |
| HOB Co-op Kit                      | contains only extras: **and it was for sale**       |
| Reality Fracture precon (and case) | old empty rows, left over from before the fix       |

None of these could come from the recorded fixtures, because the fixtures are a small, tidy
sample. Every time this project ran a check across **all** the real data, it found something:
lesson 04's three import bugs, the empty precon you bought, these six. Make "check it against
everything real" a habit, and make the check a command you can rerun.

## C2. Unlist, don't delete

MTGJSON sometimes drops or changes a product. Deleting our row would break any unopened item a
player owns (its product would vanish). So products gain an `is_listed` flag instead:

- A set's import marks its products **listed** if they're in the new import, and **unlisted**
  otherwise.
- The store sells only listed products. Owned items still open, because their row is still there.
- The import's reference check ignores unlisted rows, **and the set's own old rows**, since the
  new import replaces them. Without that second part, a chain (a case containing a product
  containing the empty deck) needed one extra sync per level to clear.

This is a **soft delete**: the row stays and a flag says it's no longer active. It's the same
reason the ledgers are append-only. Data other data depends on shouldn't disappear.

## C3. Finding chains with a recursive query

"Which listed products contain, at any depth, a product that isn't listed?" is a tree question,
and SQL answers tree questions with a **recursive CTE** (lesson 09 introduced CTEs):

```sql
with recursive tree(root_id, root_name, product_id, depth) as (
  select sp.id, sp.name, sp.id, 0 from sealed_products sp where sp.is_listed   -- start: every listed product
  union all
  select t.root_id, t.root_name, (c->>'productId'), t.depth + 1                -- step: one level down
    from tree t
    join sealed_products parent on parent.id = t.product_id
    cross join lateral jsonb_array_elements(parent.contents) c
   where c->>'kind' = 'sealed' and t.depth < 5
)
select distinct t.root_name
  from tree t join sealed_products child on child.id = t.product_id
 where t.depth > 0 and not child.is_listed;
```

The first `select` is the starting point, and the second is applied repeatedly to what the
previous round found, until nothing new appears. It's a breadth-first walk (lesson 06's queue),
done by the database. After the fixes it returns no rows, which is exactly the answer you want.

---

# Part D: Docker

## D1. Images, layers and stages

A Docker **image** is a filesystem plus a command to run. It's built from a `Dockerfile`, one
**layer** per instruction, and Docker reuses layers whose inputs haven't changed. That's why the
[`Dockerfile`](../Dockerfile) copies the lockfile and installs dependencies **before** copying the
code:

```dockerfile
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile        # reused until the lockfile changes

FROM deps AS build
COPY . .
RUN pnpm exec next build                  # redone when the code changes
```

A code change reruns only the build, not the install. The `AS name` stages form a **multi-stage
build**: the final `runtime` stage copies just what it needs from the `build` stage.

The build needs configuration that **parses** (our config module refuses to start without a
`DATABASE_URL`), so it gets placeholder values. The real ones arrive at runtime from Compose. It's
the same rule as since Phase 0: configuration only from environment variables.

## D2. Users and permissions

Containers should not run as root, so the image switches to the `node` user. The first start then
failed:

```
Failed to read pnpm-workspace.yaml at /app/pnpm-workspace.yaml: Permission denied (os error 13)
```

On the host, that file was `-rw-------`: readable only by its owner. `COPY` keeps permissions,
and the files belonged to root, so `node` couldn't read them. The fix is to give the files to the
user that runs them:

```dockerfile
COPY --from=build --chown=node:node /app ./
```

## D3. Compose: services that wait for each other

[`docker-compose.yml`](../docker-compose.yml) describes four services, and the order they start in
is part of the design:

```yaml
migrate:
  command: ["pnpm", "worker", "migrate"]
  depends_on:
    db: { condition: service_healthy } # Postgres answers pg_isready
app:
  depends_on:
    migrate: { condition: service_completed_successfully } # the migration exited with 0
```

The app never starts against a half-migrated database, and a failed migration stops everything
with a clear error. Other pieces worth knowing:

- **Volumes** (`pgdata`, `images`, `sync-cache`) keep data when containers are replaced.
- **`${AUTH_SECRET:?message}`** makes a variable required: `docker compose` refuses to start and
  prints the message (exercise 4 shows it).
- **`x-app: &app` … `<<: *app`** is YAML's way to define shared settings once and merge them into
  each service (an _anchor_ and an _alias_).

## D4. Signals

`docker compose stop` sends the process **SIGTERM**, waits 10 seconds, then kills it. The worker
only listened for SIGINT (Ctrl+C), so Docker would have killed it in the middle of whatever it was
doing. Now both signals set the same "stop after this step" flag:

```ts
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
```

Python: `signal.signal(signal.SIGTERM, handler)`.

## D5. What the test really did

The plan was to test the containers without a catalog sync (80 MB from Scryfall). But a fresh
install's worker starts syncing **immediately**, because it has never synced, and it finished in
40 seconds, before I stopped it. That's recorded in the design doc and the deploy guide rather
than glossed over. It's also useful to know: it proved the worker works in Docker, and it's what a
real first deployment will do.

---

# Part E: Two loose ends

## E1. Tests sorted by cost

| Suite              | Runs                        | Touches                        |
| ------------------ | --------------------------- | ------------------------------ |
| `pnpm test`        | every save, in `pnpm check` | nothing: pure code and fakes   |
| `pnpm test:int`    | before committing           | the local `tcg_test` database  |
| `pnpm test:e2e`    | before committing           | a browser, `tcg_e2e`, fixtures |
| `pnpm test:remote` | **by hand only**            | the real MTGJSON and Scryfall  |

The remote suite is two tiny requests that check the services still match our schemas. It's a
separate Vitest project that nothing runs automatically, so no routine test ever slows down or
gets the machine rate-limited.

## E2. One connection, one query at a time

The Docker logs showed a warning from the Postgres driver:

```
DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated
```

A **transaction is one connection**, and one connection handles one query at a time. `Promise.all`
over four queries on a transaction's connection doesn't run them in parallel: the driver quietly
queued them, and the next major version will refuse. The fix is plain sequential `await`s. (On
the **pool**, which read models use, `Promise.all` is fine and genuinely parallel: each query
borrows its own connection.)

---

## Common mistakes

| Mistake                                             | Why it happens                   | Instead                                                        |
| --------------------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| Writing feed events after the transaction commits   | it feels like a separate concern | record them inside it: same fate as the change                 |
| Putting everything in an event "in case"            | more data seems harmless         | only what the feature shows; public records outlive intentions |
| Joining values with commas and calling it CSV       | it works for the first 100 cards | quote per RFC 4180, with one tested function                   |
| Deleting rows that other data points to             | "it's gone upstream"             | unlist (soft delete), and stop selling it                      |
| Copying dependencies after the code in a Dockerfile | it's the natural reading order   | dependencies first, for layer caching                          |
| Running containers as root                          | it avoids permission errors      | a normal user, with `--chown` on copied files                  |
| Only handling Ctrl+C                                | that's how you stop it locally   | handle SIGTERM too: that's how Docker stops it                 |
| `Promise.all` on one transaction                    | it looks faster                  | sequential awaits; parallelism belongs on the pool             |

## Exercises

### 1. Read the start-up order (warm-up)

Without running anything, list the order in which Compose starts the services, and say what
happens if a migration fails.

<details><summary>Solution</summary>

`db` first, then `migrate` once `db` is healthy, then `app` and `worker` together once `migrate`
has **exited successfully**. If the migration fails (non-zero exit), `app` and `worker` never start,
and `docker compose up` reports `service "migrate" didn't complete successfully`. That's better than
serving a half-migrated database.

</details>

### 2. Read CSV back

Write `parseCsvLine(line)`, the inverse of `csvField` for one line, and test that
`parseCsvLine(values.map(csvField).join(","))` gives `values` back, including a value with a comma
and one with quotes.

<details><summary>Solution</summary>

```ts
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        field += '"'; // a doubled quote is one quote
        index++;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      fields.push(field);
      field = "";
    } else field += character;
  }
  fields.push(field);
  return fields;
}

const values = ["Lightning Bolt", 'Kongming, "Sleeping Dragon"', "", "Borrowing 100,000 Arrows"];
expect(parseCsvLine(values.map(csvField).join(","))).toEqual(values);
```

A round-trip test (lesson 09) is the best test for a pair like this. In real code, use a library.
This is to see why one is needed.

</details>

### 3. A one-line pull summary

For a compact feed, write `summarizePull(cards)`: the most valuable card with its price, plus
"and N more", or "nothing notable" for an empty list.

<details><summary>Solution</summary>

```ts
type Pulled = { name: string; rarity: string; priceCents: number | null };

function summarizePull(cards: readonly Pulled[]): string {
  const best = cards.reduce<Pulled | null>(
    (top, card) => (top === null || (card.priceCents ?? 0) > (top.priceCents ?? 0) ? card : top),
    null,
  );
  if (best === null) return "nothing notable";
  const others = cards.length - 1;
  const price = best.priceCents === null ? "" : ` ($${(best.priceCents / 100).toFixed(2)})`;
  return others === 0 ? `${best.name}${price}` : `${best.name}${price} and ${others} more`;
}
// summarizePull([{ name: "A", rarity: "rare", priceCents: 100 }, { name: "B", rarity: "mythic", priceCents: 1500 }])
//   → "B ($15.00) and 1 more"
```

`reduce<Pulled | null>(…, null)` passes the type explicitly, because the starting value `null`
alone would make TypeScript think the result is always `null`.

</details>

### 4. A required variable

Run `env -u AUTH_SECRET docker compose --env-file /dev/null config`. What happens, and which
part of `docker-compose.yml` causes it?

<details><summary>Solution</summary>

```
error while interpolating x-app.environment.AUTH_SECRET: required variable AUTH_SECRET is missing a
value: Set AUTH_SECRET in .env (at least 32 characters)
```

It comes from `AUTH_SECRET: ${AUTH_SECRET:?Set AUTH_SECRET in .env (at least 32 characters)}`.
`:?` means "required, and here's the message". Compose refuses before starting anything, which is
the same fail-fast idea as the app's own config check (lesson 01).

</details>

### 5. Chains of products (SQL)

Run the recursive query from C3 on your database. Then change it to list, for every listed
product, how deep its nesting goes.

<details><summary>Solution</summary>

On a healthy catalog the query from C3 returns no rows. For depth, keep the same CTE and group:

```sql
-- (the same "with recursive tree(...) as (...)" as in C3)
select root_name, max(depth) as deepest
  from tree
 group by root_name
 order by deepest desc, root_name
 limit 10;
```

A case of boxes comes out at depth 2 (a case contains boxes, and a box contains pack products; the
pack itself is a `pack` node, not a `sealed` one). The deepest in the real catalog is 3: "master
cases" such as the Secrets of Strixhaven Collector Booster Box Master Case, which hold cases.

</details>

### 6. Delete or unlist? (discussion)

MTGJSON removes a booster recipe that players still have unopened packs of. What should happen, and
what does this app do today?

<details><summary>Solution</summary>

The packs should stay openable: people bought them. Today, the import upserts recipes and never
deletes them, so an old recipe stays in `booster_configs` and owned packs keep opening (lesson 06
made opening independent of whether the set is enabled). If the store sold that pack as a product,
the product would be unlisted, since a product that refers to a missing recipe is left out. So
nothing new is sold, and nothing owned breaks. The rule of thumb: remove things from **sale**, never
from **existence**.

</details>

## Recap

- Record events **in the same transaction** as the change. Put in them only what may be public.
- CSV needs quoting rules. A route returns a `Response` with `Content-Disposition: attachment` to
  download.
- **Check everything real**, with rerunnable commands. They keep finding what fixtures can't.
- **Unlist, don't delete** data that other data depends on.
- Docker: layer order for caching, multi-stage builds, a non-root user with `--chown`, Compose
  health and completion conditions, required variables, and SIGTERM.
- Sort tests by cost, and keep network tests opt-in.
- One transaction is one connection: `Promise.all` belongs on the pool.

## Further reading

- [Design doc 11](../docs/design/11-activity-export-docker.md), especially section 8
- [docs/deploy.md](../docs/deploy.md)
- RFC 4180 (CSV); MDN: `Content-Disposition`
- Docker docs: "Multi-stage builds", "Compose file reference: depends_on", "Interpolation"
- PostgreSQL docs: "WITH Queries" (recursive), "Explicit Locking"
- Chris Richardson, "Pattern: Transactional outbox" (microservices.io)
