# Lesson 05: Randomness you can trust

- **Phase:** 5 (pack engine)
- **Prerequisites:** [Lesson 01](01-architecture-foundation.md) (the `Rng` port, generics,
  `Record`), [Lesson 03](03-wallet-ledger-and-time.md) (property tests)
- **Time:** 2–3 hours, best split across the parts
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Explain what a **seed** is, and why passing randomness in as an `Rng` makes every pack
   replayable and every test deterministic.
2. Sample by weight **with and without replacement**, and say how each matches a real print sheet.
3. Pick behavior from data with a **strategy table**, a `Record` whose values are functions,
   using TypeScript **function types**.
4. Add a constraint to a random draw with **rejection sampling**, without changing the odds of the
   draws you keep.
5. Calculate an **expected value** exactly from a recipe, and check it against a **Monte Carlo
   simulation**.
6. Write **statistical tests** that never flake, using fixed seeds and a tolerance measured in
   **standard errors**, and check that a test can fail by **breaking the code on purpose**.
7. Sort by several keys at once with a **comparator**.
8. Share another module's types without depending on its code, using **`import type`**.

---

# Part A: Where randomness comes from

## A1. The problem: "it was random" isn't good enough

A player opens a pack and gets a mythic. Later they ask: _was that fair? Can I see it again?_
With `Math.random()` there's no answer. The numbers are gone, and a test for "one mythic in
eight packs" would pass or fail depending on luck.

Computers don't make truly random numbers. They make **pseudo-random** ones: a formula that turns
a starting value, the **seed**, into a long sequence of numbers that look random. The same seed
always produces the same sequence. That's a problem for a lottery, but exactly what we want here:

- **Replay:** store the seed with the pack, and the pack can be generated again, card for card.
- **Tests:** give the engine the seed `"test-1"`, and it produces the same pack on every run.

In Python this is `random.Random(42)`, or NumPy's `np.random.default_rng(42)`. Two generators with
the same seed give the same numbers.

## A2. The `Rng` port: randomness as a dependency

Lesson 01 built this in [`rng.ts`](../src/shared/kernel/rng.ts). The engine never calls
`Math.random()` (lint forbids it). It receives an `Rng`:

```ts
export interface Rng {
  /** Uniformly distributed in [0, 1). */
  next(): number;
}
```

It's the same idea as the injected `Clock` from lesson 03: anything that isn't the same every
time is a **dependency**, passed in from outside. Production code uses `seededRng(seed)` with a
fresh seed from the operating system (`randomSeed()`, 128 random bits). Tests use readable seeds.

```ts
const a = seededRng("hello");
const b = seededRng("hello");
a.next() === b.next(); // true, every time
```

**Try it:** in `pnpm exec tsx`, import `seededRng` from `./src/shared/kernel/rng.ts`, create two
generators with the same seed and call `next()` a few times on each. Then change one seed by one
letter.

---

# Part B: Drawing cards

## B1. Weighted picks: one card from a sheet

A booster **sheet** is MTGJSON's list of the cards one slot can contain, each with a **weight**.
Weight 3 means "three times as likely as weight 1". A rare slot might hold every rare at weight 2
and every mythic at weight 1, which is how mythics end up rarer.

Picking by weight works like dropping a pin on a ruler. Lay the weights end to end, pick a random
point along the total length, and see which card's stretch it landed in:

```
rare A (2)   rare B (2)   mythic (1)
|----------|----------|-----|       total = 5
0          2          4     5
        ▲ rng.next() × 5 = 2.6 → rare B
```

That's `weightedPick` in [`rng.ts`](../src/shared/kernel/rng.ts), and Python's
`random.choices(items, weights=w)`.

## B2. With or without replacement

Most slots draw **several** cards (ten commons, say). There are two ways to do that:

- **With replacement:** each pick is independent, so the same card can come up twice. Like
  rolling a die repeatedly. Python: `random.choices(items, weights=w, k=10)`.
- **Without replacement:** once a card is drawn it's out, so all ten are different. Like dealing
  from a deck. NumPy: `rng.choice(items, size=10, replace=False, p=probabilities)`.

A real print sheet is closer to dealing: a pack almost never has two copies of the same common.
So the kernel's `weightedSample` draws one card at a time by weight, **removes it**, and draws
again from what's left. A few sheets (such as some basic-land sheets) are marked
`allowDuplicates`, and those use repeated `weightedPick` instead.

## B3. Function types and the strategy table

A sheet is drawn in one of three ways, depending on its flags:

| Sheet kind       | Flag              | How                                                 |
| ---------------- | ----------------- | --------------------------------------------------- |
| `fixed`          | `isFixed`         | no randomness: every card, `weight` times, in order |
| `withDuplicates` | `allowDuplicates` | independent weighted picks                          |
| `distinct`       | (neither)         | weighted sampling without replacement               |

You could write an `if`/`else` chain inside the loop. The engine instead describes **the shape of
a drawing function** as a type, writes three small functions of that shape, and looks the right
one up in a table.

**New syntax: a function type.** This describes any function that takes these parameters and
returns this:

```ts
type DrawSheet = (rng: Rng, sheet: BoosterSheet, count: number) => PrintingId[];
```

Read it as "a DrawSheet is a function from (rng, sheet, count) to a list of printing ids". The
Python equivalent is `Callable[[Rng, BoosterSheet, int], list[PrintingId]]`. The names inside
(`rng`, `sheet`, `count`) are only documentation, and a function with different parameter names
still fits.

From [`generate.ts`](../src/modules/packs/domain/generate.ts):

```ts
function drawWithDuplicates(rng: Rng, sheet: BoosterSheet, count: number): PrintingId[] {
  return Array.from({ length: count }, () => weightedPick(rng, weightedCards(sheet)));
}

function drawDistinct(rng: Rng, sheet: BoosterSheet, count: number): PrintingId[] {
  return weightedSample(rng, weightedCards(sheet), count);
}

const DRAW_STRATEGIES: Record<SheetKind, DrawSheet> = {
  fixed: drawFixed,
  withDuplicates: drawWithDuplicates,
  distinct: drawDistinct,
};
```

Line by line:

- **`Array.from({ length: count }, () => …)`** builds a list of `count` items by calling the
  function once per item. Python: `[weighted_pick(...) for _ in range(count)]`.
- **`Record<SheetKind, DrawSheet>`** (from lesson 01) is an object with one entry per sheet kind,
  each a `DrawSheet`. Because the keys are _every_ `SheetKind`, the compiler refuses the table if
  you add a fourth kind and forget its function.
- Using it is one lookup: `const draw = DRAW_STRATEGIES[sheetKind(sheet)];`, then
  `draw(rng, sheet, count)`. In Python you'd write a dict of functions,
  `{"fixed": draw_fixed, ...}[kind](rng, sheet, count)`.

This is the **Strategy** pattern ([patterns.md](../docs/architecture/patterns.md)): interchangeable
functions with the same shape, chosen by data.

The fixed strategy uses one more new method:

```ts
function drawFixed(_rng: Rng, sheet: BoosterSheet, count: number): PrintingId[] {
  const everyCopy = sheet.cards.flatMap((card) =>
    Array.from({ length: card.weight }, () => card.printingId),
  );
  return Array.from({ length: count }, (_, index) => everyCopy[index % everyCopy.length]);
}
```

- **`flatMap`** maps each card to a list and joins the lists: a card with weight 2 becomes
  `[id, id]`. Python: `[card.id for card in cards for _ in range(card.weight)]`.
- **`_rng`**: a fixed sheet needs no randomness, but it must still fit the `DrawSheet` shape. The
  leading underscore says "unused on purpose".
- **`(_, index) =>`**: `Array.from` passes each position's (empty) value and its index. We only
  want the index.

## B4. Draw in a fixed order

`generatePack` first picks a pack **variant** (layout) by weight, then draws each slot:

```ts
const sheetNames = Object.keys(variant.slots).sort();
for (const sheetName of sheetNames) { … }
```

Why `.sort()`? The recipe is stored as JSON in Postgres, and Postgres **reorders JSON keys**. Each
draw consumes numbers from the generator. If the slots were drawn in whatever order the keys came
back, the same seed could give a different pack after a re-import. Sorting makes the order
depend only on the slot names. Replayable code has to control **every** input, including hidden
ones like iteration order.

---

# Part C: Constraints without cheating

## C1. The problem: a pack with no green commons

Some sheets are marked `balanceColors`: a pack's commons should include every color. A purely
random draw sometimes misses one, which in our small test sheet happens in about 3 packs out of 4.

The tempting fix is to **swap a card in**: if green is missing, replace a random common with a
random green one. But that changes the odds. Green commons become more likely than the recipe
says, and whichever card got swapped out becomes less likely.

## C2. Rejection sampling

**Rejection sampling** is the honest fix: draw, check, and if the draw breaks the rule, **throw
the whole draw away and draw again**. Every draw that is kept was produced by the normal process,
so among the valid packs each one keeps exactly the relative odds it had before. (In statistics
terms, you're sampling from the distribution _conditioned on_ the rule.)

A toy version in Python: roll two dice until they differ.

```python
def draw_until(draw, accept, max_attempts):
    value = draw()
    for _ in range(max_attempts - 1):
        if accept(value):
            break
        value = draw()
    return value
```

The engine's version, from [`generate.ts`](../src/modules/packs/domain/generate.ts):

```ts
function drawBalanced(
  draw: DrawSheet,
  rng: Rng,
  sheet: BoosterSheet,
  count: number,
  facts: FactsLookup,
): PrintingId[] {
  const sheetPrintings = sheet.cards.map((card) => card.printingId);
  const isPossible =
    count >= ALL_COLORS.length && monoColors(sheetPrintings, facts).size === ALL_COLORS.length;

  let drawn = draw(rng, sheet, count);
  if (!isPossible) return drawn;
  for (let attempt = 1; attempt < COLOR_BALANCE_ATTEMPTS; attempt++) {
    if (monoColors(drawn, facts).size === ALL_COLORS.length) break;
    drawn = draw(rng, sheet, count);
  }
  return drawn;
}
```

- It takes the **strategy** (`draw`) as a parameter, so balancing works with any sheet kind.
  Passing a function into a function is ordinary in both Python and TypeScript.
- **`monoColors`** collects the colors of the one-color cards into a `Set` (like Python's `set`).
  Five distinct colors means the rule is met.
- **Two safety valves.** If the rule _can't_ be met (fewer than five cards, or a sheet missing a
  color), it doesn't retry at all. If it's just unlucky, it stops after 50 attempts. A loop that
  might never end has no place on a server.

How many attempts does it take? If a draw is acceptable with probability _p_, the average is 1/_p_
attempts. With _p_ = 0.25 that's 4 draws, which is microseconds. The chance of 50 failures in a
row is 0.75⁵⁰ ≈ 0.00006%.

---

# Part D: Knowing the odds

## D1. Expected value from the recipe

For a data scientist, this part is familiar ground. The **expected value** of a count is its
long-run average. For one slot drawing from a sheet, each card is expected
`count × weight ÷ total weight` times. Expected values **add up** across slots and variants,
even when the draws depend on each other (this is called _linearity of expectation_). So the
average pack can be calculated exactly, without opening a single pack:

```
mythics per pack = Σ over variants ( variant share × Σ over slots ( mythic weight share × count ) )
```

That's `expectedPerPack` in [`odds.ts`](../src/modules/packs/domain/odds.ts). For our test
booster the answer, worked by hand in
[`odds.test.ts`](../src/modules/packs/domain/odds.test.ts), is 0.275 mythics per pack.

## D2. Monte Carlo: check it by simulation

A **Monte Carlo simulation** estimates the same number by brute force: open many packs and
average. The Pack lab (`/admin/packs`) does both and shows them side by side:

| Per pack (Bloomburrow play) | Recipe says | We got (1,000 packs) |
| --------------------------- | ----------- | -------------------- |
| Mythics                     | 0.194       | 0.197                |
| Foils (any rarity)          | 1.200       | 1.205                |

When the two agree, the recipe and the engine agree. When they don't, one of them is wrong.
That's why the lab exists.

## D3. Statistical tests that never flake

How close is "close enough"? A rate measured over _n_ packs wobbles from run to run. Its typical
wobble is the **standard error**:

```
standard error = √( p × (1 − p) ÷ n )
```

For a 25% mythic rate over 20,000 packs, that's √(0.25 × 0.75 ÷ 20000) ≈ 0.003. A correct engine
lands within **4 standard errors** of the true rate all but about once in 16,000 runs. A broken
one (say, mythics at 30%) misses by more than 15 standard errors. From
[`generate.test.ts`](../src/modules/packs/domain/generate.test.ts):

```ts
function expectRate(observedCount: number, expectedRate: number) {
  const standardError = Math.sqrt((expectedRate * (1 - expectedRate)) / PACKS);
  expect(Math.abs(observedCount / PACKS - expectedRate)).toBeLessThan(4 * standardError);
}
```

And because the seeds are fixed (`"stats-0"`, `"stats-1"`, …), the test gives the same answer on
every run. It can't be flaky: it passes forever or fails forever.

## D4. Property tests over seeds

Lesson 03's property tests generated random dates. Here fast-check generates random **seeds**,
and each property must hold for all of them:

```ts
fc.property(fc.string(), (seed) => {
  expect(packProblems(SAMPLE_BOOSTER, pack(seed), sampleFacts)).toEqual([]);
});
```

`packProblems` ([`checks.ts`](../src/modules/packs/domain/checks.ts)) lists every broken rule:
wrong slot counts, repeated cards, unknown printings, impossible finishes. The same function runs
in `pnpm worker check-packs` against every real recipe. It opened 96,000 real packs in under three
seconds and found nothing wrong.

## D5. How do you know a test can fail?

The pack tests all passed on their first run. That's good news, or a sign the tests don't test much.
The cheap way to find out is **mutation testing** by hand: break the code on purpose and check
that a test notices. For this engine:

| Deliberate bug                          | Test that caught it                             |
| --------------------------------------- | ----------------------------------------------- |
| color balance gives up after 1 attempt  | "always shows all five colors…"                 |
| every variant weight treated as 1       | "rolls each layout in proportion to its weight" |
| `distinct` sheets drawn with duplicates | "follows the recipe…", "never repeats a card…"  |

If a bug survives, you've found a missing test. Undo the break afterwards.

---

# Part E: Order and boundaries

## E1. Sorting by several keys: the reveal order

Cards are revealed to **build suspense**: commons, uncommons, basic lands, foils, then rares and
mythics. Within each group the cheapest comes first, so the most valuable card is the final flip.

JavaScript's `sort` takes a **comparator**: a function of two items that returns a negative
number if `a` comes first, positive if `b` does, and 0 if they tie. From
[`reveal.ts`](../src/modules/packs/domain/reveal.ts):

```ts
withSortKeys.sort(
  (a, b) =>
    a.tier - b.tier ||
    Cents.subtract(a.price, b.price) ||
    a.collectorNumber.localeCompare(b.collectorNumber, "en", { numeric: true }) ||
    a.card.printingId.localeCompare(b.card.printingId),
);
```

The trick is **`||`**: it returns its left side unless that is "falsy", and **0 is falsy**. So
`a.tier - b.tier || …` means "compare by tier, and only on a tie move on to price". In Python
you'd return a tuple from a key function, `sorted(cards, key=lambda c: (c.tier, c.price, …))`,
which compares the same way, one element at a time.

`localeCompare(…, { numeric: true })` compares text the way people read numbers, so collector
number `"9"` comes before `"10"`. Plain string comparison would put `"10"` first.

One more detail: `sort` **changes the array it's called on**. `revealOrder` sorts a new array it
built with `map`, so the caller's list is left alone (there's a test for that).

## E2. `import type`: sharing words, not code

The pack engine is written in the catalog's vocabulary: `BoosterConfig`, `PrintingId`, `Rarity`.
But lesson 01's rule says a domain imports nothing outside the kernel, to keep it pure. The
middle ground is **`import type`**:

```ts
import type { BoosterConfig, BoosterSheet, Color, PrintingId } from "@/modules/catalog";
```

A type-only import is **erased when the code is compiled**. At runtime the pack engine loads none
of the catalog's code. It only borrows its type names for the compiler. Python's equivalent is
importing inside `if TYPE_CHECKING:`. The lint rule now allows exactly this: a domain may
`import type` from another module's public `index.ts`, but a normal `import` is still an error.

---

## Common mistakes

| Mistake                                                 | Why it happens                  | Instead                                                            |
| ------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| Calling `Math.random()` "just this once"                | it's right there                | take an `Rng`; nothing random is replayable or testable otherwise  |
| Forcing a constraint by swapping cards in               | it's simpler than redrawing     | rejection sampling: redraw, with an attempt limit                  |
| Iterating an object's keys and trusting the order       | it looked stable in development | sort the keys when the order affects the result                    |
| Statistical tests with fresh random seeds each run      | "more realistic"                | fixed seeds, tolerance in standard errors                          |
| A tolerance picked by feel ("within 0.05")              | round numbers feel safe         | work out the standard error; 4 of them is a good default           |
| Trusting a test suite that has never failed             | green feels finished            | break the code on purpose and watch a test catch it                |
| `a.price > b.price ? 1 : -1` as a comparator            | it looks like it works          | return 0 for ties, or chained keys never get a turn                |
| Confusing "expected count" and "chance of at least one" | both sound like "the odds"      | two slots at 1/7 → 2/7 expected mythics, but a 13/49 chance of any |

## Exercises

### 1. Replay a run (warm-up)

Run `pnpm worker check-packs 200`, then open 100 packs of any set in the Pack lab and note the
seed at the top of the report. The lab gives pack _n_ of a run the seed `<run seed>-n`
(`packSeed` in [`simulate.ts`](../src/modules/packs/application/simulate.ts)). How would you
regenerate pack 2 exactly? And when could the replay come out different?

<details><summary>Solution</summary>

Call `openBooster(services, { setCode, boosterType, seed: packSeed(runSeed, 2) })`, or
`openPack(config, facts, "<run seed>-2")` with the recipe already loaded. The use case test
"opens the packs from one fresh seed, so the whole run can be replayed" does exactly this.

The replay differs if the **recipe** changed in between (MTGJSON corrected a sheet, and a sync
re-imported it). A seed replays the random choices, not the data they were made from. That's why
Phase 6 will store each opened pack's **cards** as well as its seed.

</details>

### 2. Write a weighted pick

Write `pickOne(rng, options)` from scratch (don't use `weightedPick`). Test it with a fake `Rng`
whose `next()` always returns the same number. For the rare slot below, which values of `next()`
give a mythic?

```ts
const rareSlot = [
  { item: "rare", weight: 7 },
  { item: "mythic", weight: 1 },
];
```

Hint: a fake `Rng` is just an object with a `next` function, `{ next: () => 0.9 }`.

<details><summary>Solution</summary>

```ts
import type { Rng, Weighted } from "@/shared/kernel";

function pickOne<T>(rng: Rng, options: ReadonlyArray<Weighted<T>>): T {
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  let remaining = rng.next() * total;
  for (const option of options) {
    if (remaining < option.weight) return option.item;
    remaining -= option.weight;
  }
  return options[options.length - 1].item; // only reached through rounding
}

const fixedRng = (value: number): Rng => ({ next: () => value });

expect(pickOne(fixedRng(0.1), rareSlot)).toBe("rare");
expect(pickOne(fixedRng(0.874), rareSlot)).toBe("rare");
expect(pickOne(fixedRng(0.875), rareSlot)).toBe("mythic");
```

A mythic comes from `next()` in [0.875, 1): `next() × 8 ≥ 7`. That's one eighth of the range,
matching weight 1 out of 8. (`reduce` adds up a list step by step, like Python's
`functools.reduce` or simply `sum(...)`.)

</details>

### 3. A generic rejection sampler

Write `drawUntil(draw, accept, maxAttempts)`, the TypeScript version of the Python toy in C2. It
should be generic (`<T>`), call `draw` at most `maxAttempts` times, and return the last draw.
Test it by rolling two dice until they differ, and prove the limit works.

<details><summary>Solution</summary>

```ts
function drawUntil<T>(draw: () => T, accept: (value: T) => boolean, maxAttempts: number): T {
  let value = draw();
  for (let attempt = 1; attempt < maxAttempts && !accept(value); attempt++) {
    value = draw();
  }
  return value;
}

const rng = seededRng("dice");
const rollTwo = () => [randomInt(rng, 6) + 1, randomInt(rng, 6) + 1];
const [first, second] = drawUntil(rollTwo, ([a, b]) => a !== b, 50);
expect(first).not.toBe(second);

let calls = 0;
drawUntil(
  () => ++calls,
  () => false,
  5,
); // never accepted
expect(calls).toBe(5);
```

`([a, b]) => …` **destructures** the pair in the parameter list, like Python's
`lambda pair: pair[0] != pair[1]`, but with names.

</details>

### 4. Expected mythics, two ways

A made-up collector booster has two rare slots. Each draws one card from a sheet where a rare
weighs 6 and a mythic weighs 1. Work out by hand (a) the expected number of mythics per pack and
(b) the chance of **at least one** mythic. Then check (a) with `expectedPerPack` and (b) with a
simulation of 20,000 packs.

Hint: build the recipe from `SAMPLE_BOOSTER` and `sampleSheet` in
[`testing/recipes.ts`](../src/modules/packs/testing/recipes.ts).

<details><summary>Solution</summary>

(a) Each slot gives 1/7 of a mythic on average, and expected values add: **2/7 ≈ 0.286**.
(b) No mythic in either slot is (6/7)², so at least one is 1 − 36/49 = **13/49 ≈ 0.265**. The
answers differ because a pack with two mythics counts twice in (a) but once in (b).

```ts
const collector = {
  ...SAMPLE_BOOSTER,
  variants: [{ weight: 1, slots: { rareA: 1, rareB: 1 } }],
  sheets: {
    rareA: sampleSheet([
      ["r-1", 6],
      ["m-1", 1],
    ]),
    rareB: sampleSheet([
      ["r-2", 6],
      ["m-1", 1],
    ]),
  },
};
expect(expectedPerPack(collector, sampleFacts).mythic).toBeCloseTo(2 / 7);

const packs = Array.from({ length: 20_000 }, (_, index) =>
  generatePack(collector, seededRng(`collector-${index}`), sampleFacts),
);
const withMythic = packs.filter((pack) => pack.cards.some((card) => card.printingId === "m-1"));
expect(Math.abs(withMythic.length / packs.length - 13 / 49)).toBeLessThan(0.015);
```

(0.015 is about 4.8 standard errors here: √(0.265 × 0.735 ÷ 20000) ≈ 0.0031.)

</details>

### 5. Write a statistical test

The sample booster's uncommon slot draws 3 different cards from 4 equally weighted uncommons.
How often should `u-4` appear in a pack? Write a test that checks it within 4 standard errors
over 20,000 fixed-seed packs.

<details><summary>Solution</summary>

`u-4` is missing only when the other three are the three drawn. By symmetry, each of the 4 cards
is equally likely to be the one left out, so `u-4` appears in **3/4** of packs.

```ts
it("puts u-4 in 3 packs out of 4", () => {
  const PACKS = 20_000;
  const withU4 = Array.from({ length: PACKS }, (_, index) =>
    generatePack(SAMPLE_BOOSTER, seededRng(`uncommon-${index}`), sampleFacts),
  ).filter((pack) => pack.cards.some((card) => card.printingId === "u-4")).length;
  const standardError = Math.sqrt((0.75 * 0.25) / PACKS);
  expect(Math.abs(withU4 / PACKS - 0.75)).toBeLessThan(4 * standardError);
});
```

</details>

### 6. Change the reveal rule (challenge)

Suppose the group decides a **foil** rare or mythic should always be the very last card, even
after a pricier nonfoil mythic. Change `revealTier` in
[`reveal.ts`](../src/modules/packs/domain/reveal.ts) and add a test. Run the tests: which
existing test breaks, and is that a bug?

<details><summary>Solution</summary>

Give foil rares and mythics their own last tier:

```ts
if (!isCommonOrUncommon) return card.finish === "nonfoil" ? 5 : 6;
```

```ts
it("reveals a foil rare after even a pricier nonfoil mythic", () => {
  const order = revealOrder([card("r-1", "foil"), card("m-1")], sampleFacts);
  expect(order.map((each) => each.printingId)).toEqual(["m-1", "r-1"]);
});
```

"saves the most valuable card for last within a group, whatever its rarity" now fails. It
expected `r-1, r-1 (foil), m-1` and gets `r-1, m-1, r-1 (foil)`. It isn't a bug: that test
recorded the **old rule**. When a rule changes on purpose, the tests describing it change too.
Update that test and the rule in design doc 05 (rule 8). (Then undo all of it, unless your group
really wants this rule.)

</details>

### 7. Why redraw? (discussion)

Color balance could instead take a finished draw that is missing green and swap one random
non-green common for a random green one. Give a concrete example of how that changes the odds,
and say what the redraw costs instead.

<details><summary>Solution</summary>

Take a sheet with 20 white commons and 2 green ones. Most draws lack green, so swapping would put
one of the 2 green cards into most packs. Each green card would appear far more often than its
weight says, and the white card that was swapped out would appear less often. Players would see
those two green commons everywhere.

Redrawing keeps only draws that happened naturally, so among the packs that meet the rule, each
card keeps the relative odds its weight gives it. The cost is time: on average 1/_p_ draws when a
draw meets the rule with probability _p_. That's why the loop has a limit, and why it skips
retrying when the rule can't be met at all.

</details>

## Recap

- A **seed** makes pseudo-random numbers repeatable. Randomness is a **dependency** (`Rng`), so
  packs can be replayed and tests are deterministic.
- Sheets are drawn **with replacement** (independent picks) or **without** (dealing), by weight.
- A **strategy table** (`Record<SheetKind, DrawSheet>`) picks the drawing function from data. A
  **function type** describes the shape they share.
- **Rejection sampling** enforces a rule without changing the odds of the draws kept. Always cap
  the attempts.
- **Expected values** come straight from the weights. A **Monte Carlo** run checks them.
- Statistical tests use **fixed seeds** and a tolerance of **4 standard errors**, so they never
  flake. **Break the code on purpose** to prove the tests can fail.
- A **comparator** chained with `||` sorts by several keys.
- **`import type`** borrows another module's vocabulary without loading its code.

## Further reading

- [Design doc 05: pack engine](../docs/design/05-packs.md), especially section 15
- [ADR 0008: injected Rng and Clock](../docs/adr/0008-injected-rng-clock.md)
- [ADR 0014: pricing sources](../docs/adr/0014-pricing-sources.md) (why packs cost MSRP but their
  contents are valued at market)
- MTGJSON data models ("Booster" and its sheets): <https://mtgjson.com/data-models/>
- Python docs: `random.choices`; NumPy docs: `Generator.choice` (`replace`, `p`)
- "Rejection sampling" and "Standard error" on Wikipedia, for the maths behind parts C and D
- MDN: `Array.prototype.sort`, `Array.from`, `flatMap`, `String.prototype.localeCompare`
- TypeScript handbook: "Type-Only Imports and Exports", "Function Type Expressions"
