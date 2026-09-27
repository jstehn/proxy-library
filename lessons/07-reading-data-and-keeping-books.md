# Lesson 07: Reading data, and keeping the books straight

- **Phase:** 7 (collection & singles store)
- **Prerequisites:** [Lesson 03](03-wallet-ledger-and-time.md) (ledgers, rounding, `FILTER`),
  [Lesson 06](06-transactions-across-modules.md) (one transaction across modules, row locks)
- **Time:** 2 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Build SQL **from optional filters** safely, with parameters instead of string pasting.
2. Keep a page's filters **in the URL**, with a plain GET form, and read them back with types.
3. Use **`as const`** and a small generic (`oneOf`) to turn untrusted strings into a known set of
   values.
4. Round money in the customer's favor **exactly once**, and prove it with a property test.
5. Remove things safely under concurrency: **lock, check, then change**.
6. Check that two ledgers **agree** with one SQL query.
7. Draw a chart as **SVG** by mapping data to pixels with a linear scale.
8. Explain why a React form **lost its message**, and how keeping it on the page fixes that.

---

# Part A: Reading data for screens

## A1. Filters are optional, and SQL isn't

The collection page can be filtered by name, set, rarity, color and finish, in any combination.
The query needs a `WHERE` clause containing only the filters that were chosen.

**Never** build it by pasting strings: `where p.name ilike '%${name}%'` breaks on a card called
"Urza's Saga" (the apostrophe ends the string) and lets anyone who types
`'; drop table players; --` run SQL. That attack is called **SQL injection**. Drizzle's `sql`
template turns every `${…}` into a **parameter** that Postgres receives separately from the SQL
text, so it's always data, never code. From
[`collection/queries/collection.ts`](../src/modules/collection/queries/collection.ts):

```ts
const conditions = [sql`c.user_id = ${userId}`];
if (filter.name) conditions.push(sql`p.name ilike ${`%${filter.name}%`}`);
if (filter.setCode) conditions.push(sql`p.set_code = ${filter.setCode.toUpperCase()}`);
if (filter.color === "C") conditions.push(sql`cardinality(p.colors) = 0`);
// …
const where = sql.join(conditions, sql` and `);
```

- Each `sql\`…\`` is a **fragment**: SQL text plus its parameters. Fragments can go inside other
  fragments.
- **`sql.join(list, separator)`** glues fragments together, like Python's `" and ".join(...)`,
  but keeping the parameters separate.
- The `%` wildcards go **inside the parameter value** (`` `%${filter.name}%` ``), not in the SQL.

In Python this is SQLAlchemy's `text("... where name ilike :name")` with `{"name": f"%{q}%"}`, or
building `select()` with `.where()` calls in a loop. It's the same rule: values travel as
parameters.

## A2. One query per screen (ADR 0006)

The page needs rows **and** totals for the whole filtered collection ("13 cards worth $2.82"),
not just the 60 cards on screen. The query defines the filtered set once as a fragment, then uses
it twice: once with `order by … limit 60 offset …` for the page, and once with
`count(*)`/`sum(...)` for the totals. The two run in parallel with `Promise.all` (lesson 02).

The latest price for each owned card is a **correlated subquery**: a small `select` that runs per
row and refers to the outer row (`s.printing_id = c.printing_id`). It's the SQL form of "for each
card, look up its newest price". An index on `(printing_id, finish, day)` (the primary key) makes
each lookup instant.

## A3. The URL is the state

A **GET form** puts its fields in the URL: choosing "Most valuable" and pressing **Show** loads
`/collection?sort=value`. That gives you, for free:

- a **bookmarkable, shareable** view ("look at my foils": send the link),
- a working **back button**,
- **no client-side state** to keep in sync. The page is a Server Component that reads
  `searchParams` and runs the query.

Pagination links keep the filters by rebuilding the query string with `URLSearchParams` (Python:
`urllib.parse.urlencode`). From
[`card-filters.tsx`](../src/app/_components/card-filters.tsx):

```ts
const params = new URLSearchParams({ ...props.values, page: String(page) });
return `${props.action}?${params.toString()}`;
```

## A4. `as const` and `oneOf`: from any string to a known value

Anything in a URL is an untrusted string. The sort must be one of four known values. Two pieces
of syntax make that type-safe.

**`as const`** tells TypeScript to keep the most specific type for a literal:

```ts
const SORTS = [
  ["newest", "Newest first"],
  ["value", "Most valuable"],
] as const;
// type: readonly [readonly ["newest", "Newest first"], readonly ["value", "Most valuable"]]
// Without `as const` it would be string[][], and "newest" would just be a string.
```

**`oneOf`** is a generic function (lesson 01) that returns the value only if it's allowed, and
otherwise falls back to the first allowed value:

```ts
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T {
  return allowed.find((option) => option === value) ?? allowed[0];
}

oneOf(values.sort, ["newest", "value", "name", "set"] as const); // type: "newest" | "value" | …
```

`T extends string` means "T can be any string type, including a union of literals". Called with
`["newest", "value", …] as const`, `T` becomes exactly `"newest" | "value" | "name" | "set"`, so
the result can go straight into the query's `sort` field, and a typo there is a compile error.
Python's version is checking `value in ALLOWED` and typing the result as a `Literal[...]`.

---

# Part B: Keeping the books straight

## B1. Round once, in one place, and prove it

The store pays 50% of market price. A $1.99 card is worth $0.995 to the store, which isn't a whole
cent. The rule (lesson 03): money is rounded **down**, only in `Cents.applyRate`. And the payout is
worked out **per copy** and then multiplied, so selling three copies together pays exactly the same
as selling them one at a time.

A property test (lesson 03) states what "rounded down correctly" means for any price and any rate.
From [`singles.test.ts`](../src/modules/store/domain/singles.test.ts):

```ts
const payout = payoutPerCopy(Cents.of(market), rate);
expect(payout).toBeLessThanOrEqual(market); // never more than the card is worth
expect(payout * 10_000).toBeLessThanOrEqual(market * rate); // never more than the exact share
expect((payout + 1) * 10_000).toBeGreaterThan(market * rate); // and not a cent less than it could be
```

The last two lines together say "the largest whole number of cents not above the exact value". In
other words, the payout is exactly the floor. All the arithmetic is in whole numbers, so there's
no float anywhere.

## B2. Lock, check, then change

Selling removes cards. The danger is the same double click as lesson 06, but for your **last
copy**: two sales both read "you own 1", both pass the check, and the store pays twice.

`remove` in [`collection/infrastructure`](../src/modules/collection/infrastructure/drizzle-repositories.ts)
does it in the only safe order:

1. **Lock** the player's rows for those cards (`SELECT … FOR UPDATE`).
2. **Check** every quantity. If any is short, return `err(NotEnoughCopies)` and change nothing.
3. **Change**: decrement (or delete a row that reaches zero, since the table's CHECK allows only
   positive quantities), then log the negative acquisitions.

The integration test "sells your last copy only once, even when asked twice at the same moment"
fires two sales with `Promise.all`. One wins, and the other gets `NotEnoughCopies` with `owned: 0`,
because it waited for the lock and then saw the first sale's result.

## B3. Two ledgers that must agree

Every sale writes to **two** append-only ledgers: `store_transactions` (what was sold, at what
price and rate) and `ledger_entries` (the money), linked by `ref = 'store:<id>'`. If they ever
disagree, something is badly wrong, so a test checks that they agree:

```sql
select t.id from store_transactions t
 where not exists (select 1 from ledger_entries l
                    where l.ref = 'store:' || t.id and abs(l.amount_cents) = t.total_cents)
```

`not exists (…)` finds store transactions with **no** matching wallet entry. The test expects the
answer to be empty. An **anti-join** like this is how you'd reconcile two tables in any data job
(pandas: a left merge with `indicator=True`, keeping `left_only`).

---

# Part C: Drawing and displaying

## C1. A chart is a mapping from data to pixels

The price-history chart ([`price-chart.tsx`](../src/ui/price-chart.tsx)) is plain SVG drawn on
the server. SVG is shapes described in text: `<polyline points="10,50 20,40 …">`,
`<circle cx cy r>`. The only maths is a **linear scale**: map a day to an x position and a price
to a y position.

```ts
const x = (day: string) =>
  PADDING.left + ((dayNumber(day) - firstDay) / (lastDay - firstDay)) * plotWidth;
const y = (cents: number) => HEIGHT - PADDING.bottom - (cents / maxCents) * plotHeight;
```

`y` counts **down** from the bottom because SVG's y axis points down (0 is the top). That's the
same flip matplotlib does for you. `viewBox="0 0 640 220"` defines the drawing's own coordinate
system, and the browser scales it to whatever width the page gives it.

## C2. Why the "Sold" message disappeared

The first version showed the sell form only when you owned the card. Selling your last copy worked
(the balance went up), but no "Sold for $4.91" appeared, and the end-to-end test failed.

What happened: the action finished, the page refreshed with "you own 0", so the page stopped
rendering `<SellForm>`. **React state (`useActionState`'s message) lives inside a component while
it's on the page. Remove the component, and its state is thrown away.** The fix keeps the form on
the page, disabled with a `<fieldset disabled>`, so the message survives. It's a good example of a
bug only an end-to-end test could see: every unit test passed.

---

## Common mistakes

| Mistake                                    | Why it happens                      | Instead                                                           |
| ------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------- |
| Pasting user input into SQL text           | it works in the demo                | parameters (`${value}` in Drizzle's `sql`), `sql.join` for pieces |
| Totals computed from the current page only | the page's rows are right there     | a second aggregate over the whole filtered set                    |
| Keeping filters in React state             | "it's interactive"                  | a GET form: the URL is the state                                  |
| Trusting `searchParams.sort` as a sort key | TypeScript says it's a string       | `oneOf(value, allowed)` to narrow to known values                 |
| Rounding the total instead of each copy    | fewer operations                    | round per copy, so how you split a sale doesn't change the payout |
| Check the quantity, then lock              | the check looks read-only           | lock first, then check, then change                               |
| Hiding a form that holds a result message  | "you can't sell what you don't own" | keep it on the page, disabled                                     |

## Exercises

### 1. A URL for a view (warm-up)

Write the URL for "my foil rares from Bloomburrow, most valuable first", then open it.

<details><summary>Solution</summary>

`/collection?set=BLB&rarity=rare&finish=foil&sort=value`. The order of the parameters doesn't
matter. Missing ones don't filter, and `page` defaults to 1.

</details>

### 2. Write a linear scale

Write `linearScale(domainMin, domainMax, rangeMin, rangeMax)` returning a function that maps a
value from the first range to the second, as the chart's `x` and `y` do. Map $0–$10 to pixels 192
(bottom) to 12 (top). What should it do when `domainMin === domainMax`?

<details><summary>Solution</summary>

```ts
function linearScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
  function scale(value: number): number {
    if (domainMax === domainMin) return rangeMin; // one value: avoid dividing by zero
    return rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
  }
  return scale;
}

const y = linearScale(0, 1000, 192, 12);
y(0); // 192
y(1000); // 12
y(500); // 102
```

Passing the bottom pixel as `rangeMin` and the top as `rangeMax` handles SVG's downward y axis
without special cases. (It's a factory that returns a named inner function, like the use cases.)

</details>

### 3. `oneOf` against bad input

What do these return, and why is the second one safe to pass into a query?

```ts
const sorts = ["newest", "value", "name"] as const;
oneOf("value", sorts);
oneOf("drop table", sorts);
oneOf(undefined, sorts);
```

<details><summary>Solution</summary>

`"value"`, `"newest"`, `"newest"`. An unknown value falls back to the first allowed one, so only the
four known sort keys can ever reach the query, where each one selects a fixed SQL fragment. The
user's text is never part of the SQL.

</details>

### 4. Price changes with a window function (SQL)

Using `price_snapshots`, list each Bloomburrow mythic's price per finish for the last 7 days, with
the change from the previous day. Hint: `lag(...) over (partition by … order by day)`.

<details><summary>Solution</summary>

```sql
select p.name, s.finish, s.day, s.usd_cents,
       s.usd_cents - lag(s.usd_cents) over (partition by s.printing_id, s.finish order by s.day)
         as change_cents
  from price_snapshots s
  join printings p on p.id = s.printing_id
 where s.day >= current_date - 7 and p.set_code = 'BLB' and p.rarity = 'mythic'
 order by p.name, s.finish, s.day;
```

`lag` looks one row back within each partition (the same printing and finish). The first day has
no previous row, so its change is `null`. On a fresh database with one day of history, every change
is `null`. Partition by `printing_id`, not by name: showcase and borderless versions share a name
but have their own prices. (pandas: `df.groupby(["printing_id", "finish"])["usd_cents"].diff()`.)

</details>

### 5. Plan a bulk sale (challenge)

Write the pure function behind a future "sell everything above N copies" button:
`duplicatesToSell(rows, keep)` takes collection rows (`printingId`, `finish`, `quantity`) and
returns what to sell, keeping `keep` of each printing **and finish**. Then say which existing
function would carry out the sale in one transaction.

<details><summary>Solution</summary>

```ts
type Row = { printingId: string; finish: "nonfoil" | "foil" | "etched"; quantity: number };

function duplicatesToSell(rows: readonly Row[], keep: number): Row[] {
  return rows
    .filter((row) => row.quantity > keep)
    .map((row) => ({ ...row, quantity: row.quantity - keep }));
}

duplicatesToSell(
  [
    { printingId: "a", finish: "nonfoil", quantity: 7 },
    { printingId: "a", finish: "foil", quantity: 1 },
  ],
  4,
); // → [{ printingId: "a", finish: "nonfoil", quantity: 3 }]
```

`giveUpCards` already takes a list of cards, locks their rows together and refuses if any is short,
so a bulk sale is one transaction: record one store transaction per card, one `giveUpCards` call
with the whole list, and one `receive` for the total.

</details>

### 6. Per copy or per sale? (discussion)

The store pays $0.99 for a $1.99 card at 50%. Selling 3 copies pays $2.97. If the payout were
rounded **once for the whole sale** instead, what would 3 copies pay, and why is that a problem?

<details><summary>Solution</summary>

3 × $1.99 × 50% = $2.985, which rounds down to **$2.98**, a cent more than three separate sales
($2.97). Players would learn to sell in bulk to gain cents, and the same card would have two
prices depending on how you sold it. Rounding per copy makes the price of a copy one number.

</details>

## Recap

- Build SQL from optional filters with **fragments and parameters** (`sql`, `sql.join`), never by
  pasting strings.
- One screen, one query shape: rows for the page **and** totals over the whole filtered set.
- A **GET form** keeps filters in the URL. **`as const`** and **`oneOf`** turn URL strings into
  known values.
- Round money **once, per copy, down**, and state that rule as a property test.
- **Lock, check, change** when removing things. Concurrency tests prove it.
- Link ledgers with a `ref`, and **reconcile** them with an anti-join.
- A chart is **linear scales** plus SVG shapes.
- React state lives only while its component is on the page.

## Further reading

- [Design doc 07: collection & singles](../docs/design/07-collection-and-singles.md), section 14
- [ADR 0006: CQRS-lite reads](../docs/adr/0006-cqrs-lite-reads.md),
  [ADR 0013: price history and store ledger](../docs/adr/0013-price-history-and-store-ledger.md)
- Drizzle docs: "Magic sql`` operator" (`sql.join`, `sql.param`)
- OWASP: "SQL Injection Prevention Cheat Sheet"
- PostgreSQL docs: "Window Functions", `EXISTS` subqueries
- MDN: "SVG Tutorial" (`viewBox`, `polyline`), `URLSearchParams`
- TypeScript handbook: "const assertions"
