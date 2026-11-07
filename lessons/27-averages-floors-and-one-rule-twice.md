# Lesson 27: Averages, floors, and one rule written twice

- **Phase:** 27 (a value floor for sealed product: never sell a pack for less than its cards
  sell back for)
- **Prerequisites:** [Lesson 05](05-randomness-you-can-trust.md) (weighted sampling, expected
  value vs simulation), [Lesson 06](06-transactions-across-modules.md) (the Composite pattern
  for products), [Lesson 20](20-suggesting-cards.md) (precomputing with a version)
- **Time:** 1¼ hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Work out an **exact average** from weights, using linearity of expectation, instead of
   simulating, and test one against the other.
2. Round a money **floor** in the right direction, and avoid SQL's integer division truncating
   before `ceil` sees the number.
3. Walk a tree whose nodes include **random choices**, averaging over them, and carry an
   "incomplete" flag up the tree instead of failing.
4. **Precompute** a value with the version of its inputs, recompute only when they change, and
   choose what's safe while nothing is computed yet.
5. Write one rule in **both** SQL and TypeScript, and test that the two agree on every row.
6. Notice when a fake differs from the real thing (an in-memory unit of work that can't roll
   back), and test what the fake can show.

---

# Part A: The problem, measured

Sealed product sells at an MSRP, and when Wizards lists none, at a generic price per kind of
product: $3.99 for an old default booster. The store buys cards back at 50% of market price. So
for any pack whose cards are worth more than twice its price, "buy it, open it, sell everything
back" makes money from nothing.

Before designing anything, the size of the problem was **measured**: 300 simulated openings of
each of the 316 priced pack types in enabled sets. 110 of them returned more than they cost.
Alpha did worst: $3.99 for cards averaging $1,276. A measurement like this turns "might be a
problem" into a decision (design doc 27, section 1). It also gave the test data to check the fix
against.

---

# Part B: An exact average

## B1. Linearity of expectation

A pack is made by picking a layout (a "variant") by weight, then for each slot drawing cards
from a sheet by weight. Simulating thousands of packs and averaging works, but it's slow, and
the answer wobbles from run to run.

The average can be worked out exactly instead. The key fact is **linearity of expectation**: the
average of a sum is the sum of the averages, **even when the parts depend on each other**. A
pack's value is the sum of its cards' values. So its average value is the sum, over every card
the recipe can produce, of "how many copies of it an average pack holds × its price":

```
value = Σ variants (variant weight / total weight)
          × Σ slots  Σ cards on that sheet  count × (card weight / sheet weight) × price
```

Rules like "no duplicates in one pack" or "balance the colours" change which cards end up
together, but not how often each card appears on average. That's why they don't affect this
sum.

In Python you'd write it with `sum` over generators. In TypeScript it's nested loops with a
running total ([odds.ts](../src/modules/packs/domain/odds.ts), `expectedPackValue`), reusing the
existing helpers that already count copies (`expectedCopies`) and pick each sheet's finish
(`finishFor`).

## B2. Testing an exact answer with a simulation

The exact function and the existing pack generator are two independent routes to the same
number, so each checks the other:

```ts
const packs = Array.from({ length: 20_000 }, (_, i) =>
  generatePack(SAMPLE_BOOSTER, seededRng(`value-${i}`), sampleFacts),
);
const average = packs.reduce((sum, pack) => sum + valueOf(pack), 0) / packs.length;
expect(Math.abs(average - expected) / expected).toBeLessThan(0.02);
```

Fixed seeds keep it from flaking (lesson 05). There's also a hand-worked case small enough to
check on paper: one card from "$1 at weight 3, $5 at weight 1" is (3 × $1 + 1 × $5) / 4 = $2.

**Try it:** `pnpm test src/modules/packs/domain/odds.test.ts`.

---

# Part C: A floor, rounded the right way

## C1. The rule

[pricing.ts](../src/modules/store/domain/pricing.ts) (`storePrice`): an admin's override is
used as typed. Otherwise the list price (official MSRP, else kind price) is raised to the
**resale floor** when it's below it. The floor is the contents value times the buylist rate:

```ts
export function resaleFloor(contentsValue: Cents, buylistRateBps: number): Cents {
  return Cents.of(Math.ceil((contentsValue * buylistRateBps) / FULL_RATE_BPS));
}
```

Rates are **basis points** (5000 = 50%), whole numbers, so no float rate appears in money maths
(lesson 03).

## C2. Which way to round

Rounding a floor **down** would leave the exploit open by a fraction of a cent per pack. So the
floor rounds **up** (`Math.ceil`), and the store's payouts round down. Each rounding goes in the
direction that protects the rule. Python's `math.ceil` behaves the same.

## C3. SQL's integer division

The same rule in SQL needs care, as this check against Postgres shows:

```sql
select ceil(1001 * 5000 / 10000),     -- 500: integer ÷ integer truncates first, then ceil
       ceil(1001 * 5000 / 10000.0);   -- 501: a numeric division keeps the fraction
```

Integer division in Postgres drops the fraction before `ceil` runs, just like Python's `//`.
Writing `10000.0` makes it a numeric division. TypeScript has only one number type, so the TS
version can't make this mistake. The SQL one can, which is one reason Part E tests them against
each other.

## C4. Properties, not just examples

Two property tests (fast-check, lesson 01) state the rule's promises over random inputs:

- without an override, the price × 10,000 is never less than value × rate (no free money);
- the price is never below the list price, and there's never a price without one.

---

# Part D: Walking a tree with random branches

## D1. The contents tree

A product's contents are a tree (lesson 06's Composite): packs, cards, decks, other products
(`sealed` × count), and **variable** nodes ("one of these"), which opening resolves by picking
one option uniformly at random. The value walk
([contents-value.ts](../src/modules/store/domain/contents-value.ts)):

| Node       | Value                                            |
| ---------- | ------------------------------------------------ |
| `pack`     | its recipe's average (Part B)                    |
| `card`     | its price                                        |
| `deck`     | the sum of its cards                             |
| `sealed`   | count × the nested product's value               |
| `variable` | the **average** of its options (linearity again) |
| `other`    | $0                                               |

## D2. "Partial", not "failed"

A recipe or deck list can be missing from the catalog. Throwing would stop one bad product from
valuing the other 2,000. Returning `null` would wipe out the whole sum. Instead each step
returns `{ cents, isPartial }`: the missing part counts as $0, and the flag rises to the top.
A partial value is still a true **lower bound**, so the floor it gives is still safe, and Admin
→ Store marks it so someone can look.

A product inside itself would recurse forever. That's bad data, not an expected failure, so a
depth limit throws (conventions: defects throw).

## D3. Gather first, then walk

The walk itself is pure and synchronous. The valuation
([value-products.ts](../src/modules/store/application/value-products.ts)) first collects
everything the trees refer to, then loads it all: nested products level by level, each pack's
value once, each deck once, and every price in one query. Only then does it walk. That's the
same "gather in SQL, decide in TypeScript" split as lesson 26.

---

# Part E: Stored values, and one rule twice

## E1. Precompute with a version

Pricing a store page would need every recipe's sheets and prices: far too slow per page view.
So values are **precomputed** into `product_values`, each row recording the `price_day` it came
from. The worker asks every 30 seconds, "is the newest price day newer than the stored one?",
and revalues only then (`valueProductsIfStale`). It's the same idea as lesson 20's feature
version, with the price day as the version.

## E2. Safe while nothing is computed

What should a kind-priced product cost before its first valuation, right after a deploy or after
a new set is enabled? Selling at the kind price would reopen the gap for that minute. So the
rule says **not for sale until valued** (decision 3). When in doubt, the safe default is "no".

## E3. The same rule in SQL and in TypeScript

Store pages, the Pack lab and draft fees read prices in SQL. Buying reads them in TypeScript.
Both versions are needed:

```sql
case
  when o.cents is not null then o.cents
  when coalesce(w.msrp_cents, k.cents) is null then null
  when w.msrp_cents is null and v.value_cents is null then null
  else greatest(coalesce(w.msrp_cents, k.cents), coalesce(<floor>, 0))
end
```

Postgres's `greatest` **ignores nulls**: `greatest(399, null)` is 399. That's convenient, but it
means `greatest` alone would happily give a price to a product with no list price. That's why
the "no list price" case comes first. `case` takes the first branch that matches, like an
`if … elif` chain.

Two copies of a rule drift apart unless something checks them. An integration test walks
**every** listed product in the fixture catalog and checks that the store page's SQL price, the
admin page's SQL price, and `storePrice` from TypeScript all agree.

---

# Part F: When a fake can't show it

The first version of a use-case test expected "nothing recorded" after a purchase the wallet
refused. It failed: the store's record **was** there. The in-memory unit of work runs the
function but can't undo writes. Postgres rolls the whole transaction back, which the
integration tests check. The fix was to test what the fake can show (the error and the price
asked for) and leave rollback to the real database, with a comment saying why.

The e2e setup had a similar question: it needed products valued, but test setup may not import
the server's composition root (lint, ADR 0009). It runs the real command instead,
`pnpm worker value-products`, so the browser tests use the same path production does.

---

## Common mistakes

- **Simulating what you can calculate.** For an average, linearity of expectation gives the
  exact answer. Use a simulation to test it.
- **Rounding a protective limit the wrong way.** Floors round up and payouts round down.
- **Integer division before `ceil`** in SQL. Divide by `10000.0`.
- **`greatest`/`least` ignore nulls in Postgres.** Handle "no value" in an earlier `case`.
- **Failing a whole batch for one bad item.** Count the unknown part as zero, flag it, and
  carry on, as long as zero errs on the safe side.
- **A precomputed value without a version.** Store what it was computed from, so you know when
  it's stale.
- **Two copies of a rule with no test that compares them.**

## Exercises

### 1. Warm-up: one slot's average

Write `slotValue(slot)` for a slot of `{ price, weight }` cards, drawing one card by weight.
Check `[{ price: 100, weight: 3 }, { price: 500, weight: 1 }]` gives 200, and an empty slot 0.

<details><summary>Solution</summary>

```ts
type Slot = ReadonlyArray<Readonly<{ price: number; weight: number }>>;
function slotValue(slot: Slot): number {
  const total = slot.reduce((sum, card) => sum + card.weight, 0);
  return total === 0 ? 0 : slot.reduce((sum, card) => sum + card.price * card.weight, 0) / total;
}
```

Python: `sum(c.price * c.weight for c in slot) / sum(c.weight for c in slot)`.

</details>

### 2. A floor in TypeScript and SQL

Write `floorFor(value, rateBps)`, rounding up, so `floorFor(1001, 5000)` is 501. Then write the
SQL expression, and say what `ceil(1001 * 5000 / 10000)` returns and why.

<details><summary>Solution</summary>

```ts
function floorFor(value: number, rateBps: number): number {
  return Math.ceil((value * rateBps) / 10_000);
}
```

```sql
ceil(value_cents * buylist_rate_bps / 10000.0)::bigint
```

`ceil(1001 * 5000 / 10000)` is **500**: all three are integers, so Postgres divides as integers
(5,005,000 / 10,000 = 500, fraction dropped), and `ceil(500)` is 500. Checked against Postgres 17.

</details>

### 3. `greatest` and nulls

What do `greatest(399, null)` and `greatest(null::int, null)` return in Postgres? Why does the
store's `case` check "no list price" before using `greatest`?

<details><summary>Solution</summary>

399 and `null`: `greatest` ignores nulls, and is null only when every argument is. Without the
earlier branch, a product with no list price but a contents value would get
`greatest(null, floor)` = the floor, and become for sale. Rule 2 says the floor may only raise a
price, never create one.

</details>

### 4. Challenge: averaging random branches

Contents are `{ kind: "card"; cents }` or `{ kind: "oneOf"; options: Content[][] }`, where
opening picks one option uniformly. Write `average(contents)`, recursively. A kit of a $1 card
plus one of [$3 card] or [$1 card plus one of [$0] or [$4]] should average $4.00.

<details><summary>Solution</summary>

```ts
type Content =
  | Readonly<{ kind: "card"; cents: number }>
  | Readonly<{ kind: "oneOf"; options: readonly (readonly Content[])[] }>;

function average(contents: readonly Content[]): number {
  return contents.reduce((sum, item) => {
    if (item.kind === "card") return sum + item.cents;
    if (item.options.length === 0) return sum;
    const options = item.options.reduce((total, option) => total + average(option), 0);
    return sum + options / item.options.length;
  }, 0);
}
// 100 + (300 + (100 + (0 + 400) / 2)) / 2 = 100 + (300 + 300) / 2 = 400
```

Tested. The inner "one of" averages to 200, the outer to (300 + 300) / 2 = 300, plus the $1 card.

</details>

## Recap

- **Linearity of expectation:** the average of a sum is the sum of averages, whatever the parts
  depend on. Calculate averages exactly, and test them with a seeded simulation.
- Round a protective floor **up**, and watch SQL's **integer division**.
- In a tree with random branches, average the options. Carry **partial** up rather than failing,
  when $0 errs on the safe side.
- Precompute with a **version**, recompute when it changes, and choose "not for sale" while
  nothing is known.
- One rule in two languages needs a **test that compares them** on real rows. Postgres's
  `greatest` ignores nulls.
- Test what a fake can show, and leave the rest to the real thing.

## Further reading

- [Design doc 27](../docs/design/27-sealed-value-floor.md) and
  [ADR 0021](../docs/adr/0021-sealed-value-floor.md).
- PostgreSQL: [`GREATEST` and `LEAST`](https://www.postgresql.org/docs/current/functions-conditional.html#FUNCTIONS-GREATEST-LEAST)
  and [mathematical operators](https://www.postgresql.org/docs/current/functions-math.html)
  (integer division).
- Linearity of expectation: any probability text, e.g. Grinstead & Snell, _Introduction to
  Probability_, chapter 6.
