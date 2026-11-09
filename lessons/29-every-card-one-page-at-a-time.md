# Lesson 29: Every card, one page at a time

- **Phase:** 29 (build a deck from every card in the catalog, not just the ones you own)
- **Prerequisites:** [Lesson 09](09-rules-as-data.md) (CTEs and lateral joins),
  [Lesson 14](14-a-search-language-and-paper.md) (the search language, debouncing),
  [Lesson 24](24-tiers-windows-and-a-radio-group.md) (rankings as `ORDER BY` lists, window
  functions)
- **Time:** 1 hour
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Give one query **two sources** by swapping a single CTE, so the sorting, paging and mapping
   that follow can't drift apart.
2. Keep a list of allowed values in **one `as const` array** and get the TypeScript type, the
   Zod check and the UI's buttons from it.
3. **Page before per-row work**: sort and limit the cheap rows first, then do the expensive
   lookups only for the rows on the page.
4. Use **`DISTINCT ON`** to keep one row per group with the columns you need, instead of
   grouping and then looking the row up again.
5. Read **`EXPLAIN ANALYZE`** output: find the node where the time goes, notice `loops`, and
   spot a sort that **spills to disk**.
6. Tell the cost **you added** from a cost that was **already there**, and decide what belongs
   in this change.

---

# Part A: The problem

The deck builder's grid showed only the cards you own. Building a deck around cards you
**don't** own yet meant typing them into "Edit as text". The ask: a switch to search every
card, then use the existing "Buy what it's short" link.

The first job was finding out how much was really new. Two facts settled it:

- `setEntry`, the use case that puts a card in a deck, only checks that the card **exists**. It
  never checked ownership. A deck holding cards you don't own is already normal, and its line
  is marked **short**.
- "Buy what it's short" writes the deck's short lines as a list (name and finish) and opens
  Buy a list, which picks the cheapest printing for sale.

So the domain, the use cases and the tables stay as they are. The whole feature is a **read
model** (a query shaped for one screen) and a switch. Checking what already exists before
designing is often the biggest saving in a feature.

---

# Part B: One query, two sources

## B1. The shape both sources share

The grid needs the same thing whichever source it searches: a page of cards, each with the
printing to show, how many you own, and the deck's facts (copies in this deck, legality,
color identity, price). Only **which cards are candidates** differs:

| Source | Candidates                          | Printing shown                             |
| ------ | ----------------------------------- | ------------------------------------------ |
| `mine` | cards you own                       | your most special copy                     |
| `all`  | every card with a printing for sale | yours if you own it, else the standard art |

One way to build this is two functions with two queries. They would start identical, and a
month later one would sort `type` differently or forget the new `misfit` column. The other way
is **one** query where the candidates come from a CTE that is swapped:

```ts
// src/modules/decks/queries/browse.ts (shortened)
sql`
  with owned as (...),
  ${input.source === "mine" ? mineCandidates : allCandidates}
  select card.oracle_id, p.id as printing_id, p.name, ...
    from candidates card join printings p on p.id = card.printing_id
    ...
   order by ${orderBy(input.sort, sql`card.newest`, sql`card.oracle_id`)}
`;
```

Both `mineCandidates` and `allCandidates` define a CTE called `candidates` with the same six
columns: `oracle_id`, `printing_id`, `owned`, `owned_real`, `newest` and `total`. That's the
contract between the two halves. Everything after it is written once.

**Python comparison.** It's the strategy pattern with SQL fragments for strategies:

```python
candidates = mine_candidates if source == "mine" else all_candidates
query = f"with owned as (...), {candidates} select ... from candidates card ..."
```

The difference is safety. Drizzle's `sql` template turns every `${value}` into a bound
parameter, and every `${fragment}` into more SQL with **its** parameters, so composing pieces
never builds SQL by pasting user text into a string (lesson 14).

## B2. One list of values, three uses

```ts
export const BROWSE_SOURCES = ["mine", "all"] as const;
export type BrowseSource = (typeof BROWSE_SOURCES)[number]; // "mine" | "all"
```

`as const` makes the array's type `readonly ["mine", "all"]` instead of `string[]`, and
`(typeof X)[number]` reads "the type of any element", which gives the union `"mine" | "all"`.
The same array then feeds the server action's validation:

```ts
// src/app/decks/[id]/builder/actions.ts
source: z.enum(BROWSE_SOURCES),
```

A browser could send `source: "everything"`. Zod refuses it before the query runs, and the
type checker refuses it in our own code. Adding a third source means adding it to the array,
and then the compiler lists every place that must handle it (exercise 1).

**Python comparison:** `Source = Literal["mine", "all"]` plus `typing.get_args(Source)` for
the runtime list. Here the runtime list comes first and the type is derived from it.

---

# Part C: Paging before per-row work

## C1. What "per-row work" costs here

For every card in "All cards", the query has to choose a printing. If you own the card, it's
your most special copy. If not, it's the first of the matching printings by the standard-art
ranking (`STANDARD_FIRST`, lesson 24). That's a small sorted lookup, about 0.06 ms each. Over
30,062 cards, that's two seconds. Over the 60 on one page, it's 4 ms.

The grid only **shows** 60. So the plan is in three steps:

1. **match:** the printings for sale that fit the search, one row per card;
2. **page:** sort those rows, keep 60 (`limit 60 offset …`);
3. **candidates:** only now, choose a printing for each of the 60.

```ts
// src/modules/decks/queries/browse.ts (allCandidates, shortened)
matching as (
  select distinct on (p.oracle_id)
         p.oracle_id, p.name, p.mana_value, p.color_identity, p.type_line,
         s.release_date as newest
    from printings p join card_sets s on s.code = p.set_code and s.is_enabled
   where ${matches}
   order by p.oracle_id, s.release_date desc nulls last
),
paged as (
  select p.oracle_id, p.newest, count(*) over ()::int as total
    from matching p
   order by ${orderBy(input.sort, sql`p.newest`, sql`p.oracle_id`)}
   limit ${BROWSE_PAGE_SIZE} offset ${offset}
),
candidates as (
  select paged.oracle_id,
         coalesce(owned.printing_id, (
           select p.id from printings p join card_sets s on ...
            where p.oracle_id = paged.oracle_id and ${matches}
            order by ${STANDARD_FIRST} limit 1)) as printing_id,
         ...
    from paged left join owned on owned.oracle_id = paged.oracle_id
)
```

Line by line:

- **Sorting works before a printing is chosen** because the sort keys (name, mana value,
  colors, type line) are the same on every printing of a card. Any one printing sorts the
  card. That fact is what makes step 2 possible before step 3.
- **`count(*) over ()`** is a window function (lesson 24) over the whole result. It runs before
  `limit`, so `total` is the number of matching cards, not 60. One query gives both the page
  and "16 cards" for the heading.
- **`from matching p`** gives the CTE the alias `p`. The shared `orderBy` fragment is written
  for a printing called `p` (`p.name`, `p.mana_value`), and `matching` has columns with those
  names, so the same fragment sorts it. That's why the matching row carries exactly those
  columns.
- **`${matches}` appears twice.** In `matching` it decides which cards are on the grid. In
  `candidates` it limits the choice of printing to the ones that matched, so `s:mh3 bolt`
  shows the MH3 printing, not the newest one from some other set.
- **`oracle_id` is the last sort key.** Two cards with the same name would otherwise come in
  any order, and a card could appear on page 1 and again on page 2. A unique final key makes
  the order total, so pages never overlap.

**Python comparison.** Sorting everything, then doing the expensive part on the first 60:

```python
page = sorted(matching, key=sort_key)[offset:offset + 60]
cards = [with_printing(card) for card in page]  # expensive, 60 times
```

never

```python
cards = sorted((with_printing(card) for card in matching), key=sort_key)[offset:offset + 60]
```

The second one does the expensive work 30,000 times and throws away 29,940 results.

## C2. `DISTINCT ON`: one row per group, the row you choose

`select distinct on (a) ... order by a, b` keeps the **first** row of each group of equal `a`,
where "first" is set by the rest of the `ORDER BY`. Above, each card keeps its newest
printing, so that printing's `release_date` is the card's "newest" for the `newest` sort.

The first draft used `group by` instead:

```sql
select p.oracle_id, (array_agg(p.id))[1] as any_printing_id, max(s.release_date) as newest
  from printings p join card_sets s ... group by p.oracle_id
```

`group by` only returns the grouped column and aggregates. To sort by name, every group then
needed a **second lookup** of a printing by `any_printing_id`: 29,404 index scans. `DISTINCT ON`
returns a real row with all the columns you ask for, so that lookup disappears.

**Python comparison:** pandas `df.sort_values(["oracle_id", "release_date"], ascending=[True,
False]).drop_duplicates("oracle_id")`.

---

# Part D: Reading a query plan

## D1. `EXPLAIN ANALYZE`

`explain analyze <query>` runs the query and prints the **plan**: the tree of steps Postgres
chose, with the real time and row count of each step. Read it from the most indented lines
(which run first) outwards. The first version of "All cards" took 435 ms for an empty search
in a Commander deck. Its plan, shortened:

```
WindowAgg (actual time=456.625..460.589 rows=29404 loops=1)
  ->  Nested Loop (actual time=210.420..447.768 rows=29404 loops=1)
        ->  GroupAggregate (actual time=210.271..249.018 rows=29404 loops=1)
              ->  Sort (actual time=210.240..225.913 rows=57537 loops=1)
                    Sort Method: external merge  Disk: 4744kB
                    ->  Hash Join (actual time=0.302..139.683 rows=57537 loops=1)
                          ->  Seq Scan on printings p_2 (actual time=0.033..124.967 rows=77926 loops=1)
        ->  Index Scan using printings_pkey on printings p_1 (actual time=0.006..0.006 rows=1 loops=29404)
```

What each part says:

- **`actual time=start..end`** is in milliseconds, and `end` **includes** the step's children.
  The nested loop ends at 447 ms and its `GroupAggregate` child at 249 ms, so the loop itself
  added about 200 ms.
- **`loops=29404`** on the index scan: it ran once per group, 0.006 ms each, about 180 ms in
  all. Small numbers times big `loops` are where time hides. That's the second lookup from C2.
- **`Sort Method: external merge  Disk: 4744kB`**: the rows didn't fit in `work_mem` (the memory
  Postgres allows one sort), so the sort wrote to disk. A disk sort isn't always the problem,
  though. Here it costs about 85 ms, less than half of what the lookups cost.
- **`Seq Scan on printings … rows=77926`**: every printing is read once, 125 ms. With an empty
  search, every card is in the result, so no index could skip any rows.

After the change, the same search took 242 ms, and 193 ms in a casual deck. The new plan has no
29,404-loop index scan. Its sort **still** spills (`Disk: 4224kB`, a little smaller): all of the
saving came from removing the lookups. Check a guess like "narrower rows will sort in memory"
against the new plan instead of assuming it.

## D2. The cost you didn't add

The slowest search was `o:"draw a card"`, at about 530 ms. Its plan:

```
Seq Scan on printings p_2 (actual time=1.765..471.812 rows=6159 loops=1)
  Filter: (... AND EXISTS(SubPlan 14))
    ->  Function Scan on jsonb_array_elements face_1 (actual time=0.004..0.004 rows=0 loops=77926)
          Filter: (regexp_replace((value ->> 'text'), '\([^)]*\)', '', 'g') ~~* '%draw a card%')
```

472 of the 530 ms go to the search language's `o:` keyword, which strips reminder text and
matches every face of every printing. The singles store runs the same condition when it
searches the whole catalog. This feature didn't create that cost. It's the first time the deck
builder pays it.

Fixing it would mean a stored, searchable rules-text column and a trigram index, which changes
the shared search library that every page uses. That's a separate design. The right move here
is to **measure, attribute and write it down** (design doc 29, section 8), not to widen a small
feature into a rewrite of the search library.

---

## Common mistakes

- **Doing per-row work before the `LIMIT`.** A lateral join or scalar subquery placed before
  sorting and paging runs once for every candidate, not once per shown row. Sort and page
  first on cheap columns, then join the expensive parts to the page.
- **Sorting without a unique last key.** `order by name limit 60 offset 60` can repeat or skip
  rows when names tie, because Postgres may break ties differently in each query. End every
  paged `ORDER BY` with a unique column.
- **Two copies of one query.** Copy a 200-line query for a second source, and the copies drift.
  Swap the part that differs (one CTE) and keep one copy of the rest.
- **Reading `actual time` as the step's own time.** It includes the children. Subtract them,
  and multiply by `loops`.
- **Fixing every slow thing you find.** Fixing a cost that was already there, in a shared
  library, widens the change and its risk. Measure it, attribute it, and write it down for its
  own design.

---

## Exercises

### 1. Warm-up: a third source

A "wishlist" source is planned. Starting from

```ts
const SOURCES = ["mine", "all", "wishlist"] as const;
```

write the `Source` type, an `emptyMessage(source)` function with a `switch` that the compiler
proves handles every source, and an `isSource(text)` type guard.

_Hint:_ in the `default` branch, assign the value to a variable of type `never` (lesson 26).

<details><summary>Solution</summary>

```ts
const SOURCES = ["mine", "all", "wishlist"] as const;
type Source = (typeof SOURCES)[number];

function emptyMessage(source: Source): string {
  switch (source) {
    case "mine":
      return "None of your cards match.";
    case "all":
      return "No cards match.";
    case "wishlist":
      return "Nothing on your wishlist matches.";
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

function isSource(text: string): text is Source {
  return (SOURCES as readonly string[]).includes(text);
}
```

Delete the `"wishlist"` case and `tsc --strict` reports
`Type '"wishlist"' is not assignable to type 'never'`. The cast in `isSource` is needed
because `includes` on a `readonly ["mine", ...]` only accepts those literals, and the question
is whether an arbitrary string is one of them.

</details>

### 2. `DISTINCT ON`: the cheapest priced printing of each card

Against the test database (`psql -d tcg_test`), list Beza, the Bounding Spring and Dawn's
Truce once each, with the printing and finish of their cheapest price snapshot.

<details><summary>Solution</summary>

```sql
select distinct on (p.oracle_id) p.name, p.set_code, p.collector_number, ps.finish, ps.usd_cents
  from printings p join price_snapshots ps on ps.printing_id = p.id
 where p.name in ('Beza, the Bounding Spring', 'Dawn''s Truce')
 order by p.oracle_id, ps.usd_cents, p.id;
```

```
           name            | set_code | collector_number | finish  | usd_cents
---------------------------+----------+------------------+---------+-----------
 Beza, the Bounding Spring | BLB      | 2                | nonfoil |       430
 Dawn's Truce              | BLB      | 9                | foil    |       956
```

The `ORDER BY` must **start** with the `DISTINCT ON` column. What follows chooses the winner,
and `p.id` makes the choice the same every time.

</details>

### 3. Page first

This query counts the printings of the first five cards by name, but it runs the count for
every card before sorting:

```sql
select card.name, counts.printings
  from (select distinct on (oracle_id) oracle_id, name from printings order by oracle_id) card
  cross join lateral (select count(*) as printings from printings other
                       where other.oracle_id = card.oracle_id) counts
 order by card.name limit 5;
```

Rewrite it so the count runs only five times, and check that both return the same rows.

<details><summary>Solution</summary>

```sql
with card as (select distinct on (oracle_id) oracle_id, name from printings order by oracle_id),
page as (select * from card order by name limit 5)
select page.name, counts.printings
  from page
  cross join lateral (select count(*) as printings from printings other
                       where other.oracle_id = page.oracle_id) counts
 order by page.name;
```

Both return Agate Assault 1, Agate-Blade Assassin 1, Banishing Light 1, Beza 4 and Brave-Kin
Duo 1 on the fixture catalog. Run both under `explain analyze` and compare the `loops` on the
inner aggregate: one per card for the first, 5 for the second. The final `order by` is still
needed, because a join doesn't promise to keep its input's order.

</details>

### 4. Challenge: read the plan

In the first plan in D1, the `Nested Loop` ends at 447.8 ms, its `GroupAggregate` child at
249.0 ms, and its index-scan child shows `0.006 ms × loops=29404`. Where did the nested loop's
own ~200 ms go, and what change in C2 removed it? Then predict the new plan's `Sort Method`
line, and check your prediction.

<details><summary>Solution</summary>

Almost all of it is the index scan: 29,404 loops × 0.006 ms ≈ 176 ms, plus the loop's
overhead. It's the second lookup of a printing for every group, needed because `group by` kept
only `oracle_id`, `any_printing_id` and `newest`, and sorting needed the name and other columns.
`DISTINCT ON` returns those columns directly, so the nested loop and its 29,404 scans disappear.

A reasonable guess is that the sort moves to memory, since the rows are narrower. It doesn't:
the new plan still says `external merge  Disk: 4224kB`. The 57,537 rows being sorted are still
too many for the default `work_mem`, and the sort is about the same size as before. The query
went from 435 ms to 242 ms because of the removed lookups alone. That's why you check the new
plan instead of trusting the explanation that sounds right.

</details>

---

## Recap

- Before designing, check what already exists. Here, decks already accepted unowned cards, so
  the feature was one query and one switch.
- One query with a swappable CTE beats two queries. Agree on the CTE's columns, and write
  everything else once.
- `as const` arrays give the union type, the Zod enum and the buttons from one list.
- Sort and page on cheap columns, then do per-row work for the page only.
- `DISTINCT ON (key) … ORDER BY key, chooser` keeps one chosen row per group with all its
  columns.
- In `EXPLAIN ANALYZE`, times include children, `loops` multiplies, and `external merge Disk`
  means the sort spilled.
- End every paged `ORDER BY` with a unique key.
- Measure a cost before fixing it, and keep a shared cost you didn't add for its own change.

## Further reading

- [Design doc 29](../docs/design/29-build-from-every-card.md): the feature and its measurements.
- [Design doc 24](../docs/design/24-choose-a-printing.md): the standard-art ranking reused here.
- PostgreSQL manual: [Using EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html) and
  [`SELECT … DISTINCT ON`](https://www.postgresql.org/docs/17/sql-select.html#SQL-DISTINCT).
- Markus Winand, [Use The Index, Luke: paging](https://use-the-index-luke.com/sql/partial-results)
  on why `offset` gets slower deep into the results, and keyset paging as the alternative.
