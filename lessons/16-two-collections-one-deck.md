# Lesson 16: Two collections, one deck

- **Phase:** 16 (the real collection: cards and products you own in real life)
- **Prerequisites:** [Lesson 04](04-pulling-in-outside-data.md) (the catalog sync),
  [Lesson 06](06-transactions-across-modules.md) (one transaction, the Composite pattern),
  [Lesson 09](09-rules-as-data.md) (parsing pasted lists), [Lesson 15](15-one-language-many-pages.md)
  (quote vs purchase, optimistic concurrency)
- **Time:** 1.5 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Decide when two things that look alike deserve **separate models** (a bounded context) rather
   than a flag on one table, and keep them apart with a **lint rule**.
2. Let the two meet in **one switchable query** (`UNION ALL`) instead of everywhere.
3. Read several file formats with **one reader per format** (Strategy), using a CSV library.
4. Work out a change as **data first** (a plan), and test it with **properties** instead of
   examples.
5. Make "preview, then confirm" safe with a **version** and an **advisory lock**.
6. Choose among candidates with **filter, sort, find, fallback**, and reuse a helper across two
   row types with a **generic constraint**.
7. Let one module ask another for data through a **port it owns**, wired in the composition root.

---

# Part A: Two collections

## A1. Same shape, opposite rules

A real card and a game card are both "a printing, a finish, a quantity" (ADR 0011). The quickest
build is one more column on the game's table:

```sql
alter table collection_cards add column is_real boolean not null default false;
```

The design doc ([16, section 3](../docs/design/16-real-collection.md)) rejected it, and the
reason is the rules, not the columns:

| Game collection                              | Real collection                    |
| -------------------------------------------- | ---------------------------------- |
| changes only through game events             | the player types whatever they own |
| every change is in the `acquisitions` ledger | no ledger, only what's there now   |
| can be sold, traded, opened from packs       | none of these                      |
| reset when a player is reset                 | left alone                         |

With a flag, **every** existing query that sells, trades or counts would need
`and not is_real`, and forgetting it once would let a player sell a card they typed in. When two
things share a shape but not their rules, give them separate models. Each model with its own
rules and vocabulary is a **bounded context**. Here it's a new module,
`src/modules/real-collection`, with its own tables:
[`infrastructure/schema.ts`](../src/modules/real-collection/infrastructure/schema.ts).

**Python comparison:** a separate Django app with its own models, rather than a `kind` field on
an existing model that every view must remember to filter.

## A2. A wall the linter checks

"No game module may use the real collection" is design rule 1. A rule nobody checks gets
broken, so it's a lint rule in [`eslint.config.mjs`](../eslint.config.mjs):

```js
{
  from: { element: { type: "module-layer", captured: { module: "!(decks|real-collection)" } } },
  disallow: {
    to: [
      { element: { type: "module", captured: { module: "real-collection" } } },
      { element: { type: "module-layer", captured: { module: "real-collection" } } },
    ],
  },
},
```

`!(decks|real-collection)` is a glob that means "any module except these two". The first `to`
blocks the module's public API (`index.ts`). The second blocks its layers, including
`schema.ts`, so a store query can't join `real_cards` through the back door either. Try it: add
`import type { RealCopy } from "@/modules/real-collection";` to any file in
`src/modules/store/domain/` and run `pnpm lint`.

## A3. Where they meet: one query you can switch

Decks are the one place the two meet. A deck with **"Use my real cards"** on counts both. Rather
than changing every deck query's logic, there's one helper that returns a table, in
[`decks/queries/owned.ts`](../src/modules/decks/queries/owned.ts):

```ts
export function ownedCopies(userId: UserId, withReal: SQL): SQL {
  return sql`(select user_id, printing_id, finish, quantity, false as is_real
                from collection_cards where user_id = ${userId}
              union all
              select user_id, printing_id, finish, quantity, true as is_real
                from real_cards where user_id = ${userId} and ${withReal})`;
}
```

- **`UNION ALL`** stacks the rows of two queries with the same columns. (`UNION` without `ALL`
  also removes duplicate rows. Here two identical rows are two real stacks of cards, so they
  must stay.)
- `is_real` labels where each row came from, so a query can count "3 game · 1 real".
- `withReal` is SQL, not a boolean, so a query can pass a column: `d.uses_real_cards` decides per
  deck inside one query over all decks.

A query that used `from collection_cards c` now says `from ${owned} c`, and nothing else
changes. Its counting stays the same, and only its source changed.

**Python comparison:** `itertools.chain(game_rows, real_rows if with_real else [])`, done in
the database.

---

# Part B: Reading what people import

## B1. One reader per format

A player can paste a list or upload a Moxfield, ManaBox or our own CSV. Each format is a small
object with the same shape (the Strategy pattern, as in lesson 05),
in [`domain/readers.ts`](../src/modules/real-collection/domain/readers.ts):

```ts
type CsvFormat = Readonly<{
  recognizes: (headers: ReadonlySet<string>) => boolean;
  read: RowReader; // one CSV row → an ImportLine, or null if it can't be read
}>;

const CSV_FORMATS = {
  manabox: {
    recognizes: (headers) => headers.has("manabox id") && headers.has("scryfall id"),
    read: (row) => lineFrom({ quantity: row["Quantity"], name: row["Name"] /* … */ }),
  },
  moxfield: {/* … */},
  ours: {/* … */},
};
```

`readImport` looks at the first line's headers and asks each format in turn. A new format is
one more entry, and nothing else changes.

## B2. Don't split CSV on commas

```text
"Beza, the Bounding Spring",BLB,Bloomburrow,2,foil,mythic,1,…
```

`line.split(",")` breaks that name in two. CSV quoting also allows quotes inside quotes (`""`)
and line breaks inside a field. Those rules are easy to get almost right, so the readers use a
library, [Papa Parse](https://www.papaparse.com/):

```ts
const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: "greedy" });
```

**Python comparison:** `csv.DictReader`, never `line.split(",")`.

Like the list parser from lesson 09, readers **report** what they can't read (rule 7: "Line 6:
Carrot Cake, BLB, …") instead of dropping it silently. Lines that are read but match no card
are reported too, with a reason (`NoSuchCard`, `NoSuchPrinting`, `FinishNotAvailable`).

---

# Part C: Plan first, then save

## C1. The change as data

An import can add rows, change quantities and (in "replace" mode) remove rows. Rather than
writing to the database while working that out, a pure function returns the change **as data**,
in [`domain/import-plan.ts`](../src/modules/real-collection/domain/import-plan.ts):

```ts
type ImportPlan = Readonly<{
  added: readonly RealCopy[];
  changed: readonly ChangedCopy[]; // with `from`, the quantity before
  removed: readonly RealCopy[];
}>;

function planImport(
  current: readonly RealCopy[],
  matched: readonly RealCopy[],
  mode: ImportMode,
): ImportPlan;
```

The same plan does three jobs:

1. **The preview** shows it ("4 new rows, changes 2, removes 7").
2. **The repository** applies it: delete `removed`, upsert `changed` and `added`.
3. **Removing a real product** reuses it: `planRemoval` builds a plan that lowers rows, and the
   same `apply` saves it.

## C2. Properties instead of examples

An example test checks one case you thought of. A **property-based test** states something
that must hold for every input and lets the library ([fast-check](https://fast-check.dev/))
try hundreds of random ones. The properties come straight from the design doc:

```ts
it("replace, then reading back, gives exactly the file", () => {
  fc.assert(
    fc.property(copies, copies, (current, matched) => {
      const after = applyPlan(current, planImport(current, matched, "replace"));
      expect(asMap(after)).toEqual(asMap(matched));
    }),
  );
});
```

Others: "add never removes anything", "add twice doubles (up to 9,999)", "replace twice changes
nothing the second time". The second time changing nothing is **idempotence**. Read the tests in
[`import-plan.test.ts`](../src/modules/real-collection/domain/import-plan.test.ts).

**Python comparison:** `hypothesis` with `@given(...)`.

## C3. Preview, then confirm what was previewed

Between the preview and the Import button, the player might change the collection in another
tab. Importing the old plan would then do something they never saw. Lesson 15's quote had the
same problem with prices. Here the answer is a **version** of the collection, sent with the
preview and checked on import:

```sql
select max(updated_at) as updated_at, count(*)::int as rows
  from real_cards where user_id = $1
```

Both parts are needed: a new or changed row moves `max(updated_at)`, and deleting an _older_
row leaves the newest time alone, but changes the count (exercise 3).

The check must not race with a write between reading the version and saving. Normally you'd
lock rows (`select … for update`, lesson 03), but rows that don't exist yet can't be locked. So
the repository takes an **advisory lock** on the player's whole collection:

```ts
await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`real-collection:${userId}`}))`);
```

An advisory lock is a lock on a number you choose. Postgres doesn't tie it to any row and just
makes everyone asking for the same number wait in line. `_xact_` means it's released when the
transaction ends. `hashtext` turns the text key into that number.

```ts
// application/import.ts, inside the transaction
await realCollection.lock(actor.userId);
if (!sameVersion(await realCollection.version(actor.userId), input.version)) {
  return err({ kind: "CollectionChanged" });
}
```

On `CollectionChanged`, the page makes a new preview and shows it.

---

# Part D: Choosing and reusing

## D1. Filter, sort, find, fall back

"Lightning Bolt" with no set should become its **newest ordinary printing**: not a promo, not
borderless or showcase. The function is four steps, in
[`domain/match.ts`](../src/modules/real-collection/domain/match.ts):

```ts
export function newestOrdinaryPrinting(candidates, finish) {
  const inFinish = candidates.filter((candidate) => candidate.finishes.includes(finish));
  const sorted = [...inFinish].sort(newestFirst);
  return sorted.find(isOrdinaryPrinting) ?? sorted[0] ?? null;
}
```

- `[...inFinish].sort(...)` copies first, because `sort` changes the array it's called on.
- `find` returns the first match or `undefined`. `??` (lesson 06) supplies the fallbacks: the
  newest printing in that finish, then `null`.
- `newestFirst` is a comparator chain (lesson 05): `b.releaseDate.localeCompare(a.releaseDate) ||
a.setCode.localeCompare(b.setCode) || …`. `||` moves to the next rule only when the first one
  says "equal" (0).

What counts as "ordinary" is data: sets of set types, promo types and frame effects, chosen by
looking at what the real catalog contains (`select t, count(*) from printings, unnest(promo_types) t …`).

## D2. A generic constraint

The Game and Real tabs both split their rows into sections ("White", "Creatures"). The helper
only needs each row to have a `section`:

```ts
export function sectionsOf<Row extends { section: string }>(
  rows: readonly Row[],
): Array<{ label: string; rows: Row[] }> {
```

`<Row extends { section: string }>` is a **generic with a constraint**: `Row` can be any type
that has at least a `section` string. The return type keeps the caller's exact row type, so the
Real tab gets `RealCollectionRow[]` back, not a bare `{ section: string }[]`.

**Python comparison:** `TypeVar("Row", bound=HasSection)` with a `Protocol`.

## D3. Walking the same tree, without dice

A real product (the Silverquill Influence precon) is a tree of contents, like the store's
sealed products in lesson 06: decks, packs, nested products, "one of these". Inventory's
`unpack` walks one level and rolls dice for "one of these". A real product's contents are
whatever is in the box. So `realProductCards` walks **all the way down**, takes a choice from
the player for each "one of these", and lists packs as **not added**, because a real booster's
cards can't be known.

It has its own walker rather than reusing `unpack`, because the two answer different
questions. `unpack` asks what to make next and uses randomness. `realProductCards` asks what is
in the player's hands and uses their choices. Both are short `switch` statements over the same
union, each ending in `assertNever`, so a new kind of content breaks the build in both places.

---

# Part E: A port owned by the one who asks

Reference sets ([ADR 0020](../docs/adr/0020-reference-sets.md)) bring every paper printing into
the catalog, but the nightly prices only cover sold sets. The catalog needs one more fact: which
printings someone owns for real. The catalog must not import the real collection (that would
point a core module at a feature module), so the catalog **declares what it needs**:

```ts
// catalog/application/ports.ts
export interface ExtraPricedPrintings {
  printingIds(): Promise<PrintingId[]>;
}
```

and the composition root, which already knows every module, connects the two:

```ts
// src/server/core.ts
const catalog = makeCatalog({
  extraPricedPrintings: {
    printingIds: async () => (await realPrintingIds(db)).map(PrintingId.of),
  },
  // …
});
```

Tests pass `{ printingIds: async () => [] }`, or a list, to check that a reference printing is
priced once someone owns it.

**Python comparison:** a `Protocol` defined in the consumer's package, with the concrete
function passed in where the app is assembled.

---

## Common mistakes

- **A flag where the rules differ.** A boolean column is cheap until every query has to remember
  it. If the two kinds of thing follow different rules, give each its own model.
- **Splitting CSV by hand.** Quoted commas, doubled quotes and line breaks inside fields break
  it. Use a CSV library.
- **`UNION` where you meant `UNION ALL`.** `UNION` removes duplicate rows, and two identical
  stacks of cards are both real.
- **Re-planning on the server without a version.** The server must work out the change again
  (never trust the client's numbers), but if it silently imports a different plan, the player
  gets something they never previewed. Compare the version and send them back.
- **Locking rows that don't exist yet.** `select … for update` can't stop an insert. Lock
  something that always exists (a parent row, or an advisory lock).
- **Sorting the original array.** `array.sort()` changes `array`. Copy first with `[...array]`.

## Exercises

### 1. Warm-up: a Deckbox reader

Deckbox's CSV has the columns `Count`, `Name`, `Edition Code`, `Card Number` and `Foil` (`foil`
or empty). Write `readDeckboxRow(row)` that returns
`{ quantity, name, setCode, collectorNumber, finish }`, or `null` without a name or a quantity
of at least 1.

_Hint:_ copy `lineFrom` in `readers.ts`: trim, treat `""` as missing, upper-case the set code.

<details><summary>Solution</summary>

```ts
type DeckboxLine = {
  quantity: number;
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
  finish: Finish;
};

function readDeckboxRow(row: Readonly<Record<string, string | undefined>>): DeckboxLine | null {
  const quantity = Number((row["Count"] ?? "").trim());
  const name = (row["Name"] ?? "").trim();
  if (!Number.isSafeInteger(quantity) || quantity < 1 || name === "") return null;
  const number = (row["Card Number"] ?? "").trim();
  const edition = (row["Edition Code"] ?? "").trim();
  return {
    quantity,
    name,
    setCode: edition === "" ? null : edition.toUpperCase(),
    collectorNumber: number === "" ? null : number,
    finish: (row["Foil"] ?? "").trim().toLowerCase() === "foil" ? "foil" : "nonfoil",
  };
}
```

To make it a real format, add an entry to `CSV_FORMATS` whose `recognizes` checks for
`edition code` and `card number`.

</details>

### 2. A property of removal

Write a fast-check property for `planRemoval(current, taken)`: it never adds rows, never leaves
a changed row below 1, and only touches rows that were in `current`.

_Hint:_ generate `current` and `taken` with `sumCopies` so each key appears once, as in
`import-plan.test.ts`.

<details><summary>Solution</summary>

```ts
const copies = fc
  .array(
    fc.record({ id: fc.constantFrom("a", "b", "c"), quantity: fc.integer({ min: 1, max: 20 }) }),
    {
      maxLength: 6,
    },
  )
  .map((rows) => sumCopies(rows.map((row) => realCopy(row.id, row.quantity))));

fc.assert(
  fc.property(copies, copies, (current, taken) => {
    const plan = planRemoval(current, taken);
    expect(plan.added).toEqual([]);
    for (const row of plan.changed) expect(row.quantity).toBeGreaterThanOrEqual(1);
    const before = new Set(current.map(copyKey));
    for (const row of [...plan.changed, ...plan.removed])
      expect(before.has(copyKey(row))).toBe(true);
  }),
);
```

</details>

### 3. Why the count?

The version is `max(updated_at)` **and** the row count. Find a change to the collection that
`max(updated_at)` alone would miss, and show it with a pure `versionOf(rows)`.

<details><summary>Solution</summary>

Deleting a row that isn't the newest: the newest time stays the same, but there's one row fewer.

```ts
type Row = Readonly<{ key: string; updatedAt: string }>;
function versionOf(rows: readonly Row[]) {
  const newest =
    rows
      .map((row) => row.updatedAt)
      .sort()
      .at(-1) ?? null;
  return { updatedAt: newest, rows: rows.length };
}

const before = [
  { key: "a", updatedAt: "2026-10-01" },
  { key: "b", updatedAt: "2026-10-05" },
];
const after = before.filter((row) => row.key !== "a");
versionOf(after).updatedAt === versionOf(before).updatedAt; // true: max alone misses it
versionOf(after).rows !== versionOf(before).rows; // true: the count catches it
```

</details>

### 4. Challenge: prefer what's already on the shelf

Players often add cards from sets they already have. Write
`preferredPrinting(candidates, finish, ownedSets)` that picks the newest **ordinary** printing
from a set in `ownedSets`, and otherwise behaves like `newestOrdinaryPrinting`.

_Hint:_ filter to owned sets **and** ordinary printings first, then fall back with `??`. Why
filter on ordinary before calling `newestOrdinaryPrinting`?

<details><summary>Solution</summary>

```ts
function preferredPrinting(
  candidates: readonly PrintingCandidate[],
  finish: Finish,
  ownedSets: ReadonlySet<string>,
): PrintingCandidate | null {
  const ordinaryOwned = candidates
    .filter((each) => ownedSets.has(each.setCode))
    .filter(isOrdinaryPrinting);
  return (
    newestOrdinaryPrinting(ordinaryOwned, finish) ?? newestOrdinaryPrinting(candidates, finish)
  );
}
```

`newestOrdinaryPrinting` falls back to a **non-ordinary** printing when there's no ordinary one.
Without the extra filter, a promo from an owned set would beat an ordinary printing from
another set.

</details>

## Recap

- Same shape, different rules: **separate models**, with a lint rule as the wall between them.
- Let them meet in **one place**: a table expression (`UNION ALL` with an `is_real` label) that
  a switch can turn on.
- **One reader per format**, a CSV library for CSV, and every skipped line reported with a
  reason.
- Work out a change **as data** (a plan) in a pure function, and test it with **properties**.
- Preview, then confirm with a **version**, checked under a lock (an **advisory lock** when the
  rows may not exist yet).
- `filter → sort (a copy) → find → ??` for "the best one, or else".
- A **generic constraint** (`<Row extends { section: string }>`) shares a helper and keeps the
  caller's type.
- A module that needs data from another **declares a port**, and the composition root fills it.

## Further reading

- [Design doc 16](../docs/design/16-real-collection.md), including section 15 (real products)
  and section 16 (as built)
- [ADR 0020: reference sets](../docs/adr/0020-reference-sets.md),
  [ADR 0011: printing × finish](../docs/adr/0011-printing-level-ownership.md),
  [ADR 0009: lint-enforced boundaries](../docs/adr/0009-lint-enforced-boundaries.md)
- PostgreSQL: [advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS),
  [`UNION ALL`](https://www.postgresql.org/docs/17/queries-union.html)
- [fast-check](https://fast-check.dev/) (property-based testing),
  [Papa Parse](https://www.papaparse.com/docs) (CSV)
- Eric Evans, _Domain-Driven Design_, chapter 14: bounded contexts
