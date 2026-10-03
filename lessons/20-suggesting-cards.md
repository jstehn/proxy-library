# Lesson 20: Suggesting cards

- **Phase:** 20 (deck suggestions and a budget shopping list)
- **Prerequisites:** [Lesson 09](09-rules-as-data.md) (rule tables),
  [Lesson 14](14-a-search-language-and-paper.md) (parameterized SQL, stale responses),
  [Lesson 17](17-many-players-one-state.md) (scoring functions),
  [Lesson 19](19-counting-what-a-deck-does.md) (role tags)
- **Time:** 2 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Work out a **profile** of a thing (what a deck is about) from its parts, using rule tables.
2. Return **reasons as data** (a discriminated union) and put them into words in the UI layer.
3. Write a **scoring function** from a weights table, with "no match" kept apart from "a low score".
4. Decide when to **precompute** a value and store it, and keep stored values fresh with a
   **version number**.
5. **Filter in SQL, rank in TypeScript**, using `DISTINCT ON`, `LATERAL` and array overlap (`&&`).
6. Use a **greedy algorithm** under a budget, say when it isn't optimal (the knapsack problem),
   and prove its promises with property tests.

---

# Part A: What is this deck about?

## A1. A profile, worked out, never stored

To suggest cards, we first need to know what the deck wants. Design doc 20 calls that the
**deck profile**:

```ts
// src/modules/decks/domain/suggest.ts
export type DeckProfile = Readonly<{
  themes: readonly Theme[]; // "counters", "tokens", …
  tribes: readonly string[]; // "Elf"
  gaps: readonly RoleGap[]; // { tag: "removal", count: 5, target: 8 }
  keywords: readonly string[]; // the commander's: "Flying"
}>;
```

It's **derived**: `deckProfile(lines, format)` works it out from the deck each time. Nothing is
saved, so it can never disagree with the deck. (Compare with B1, where something _is_ saved, and
why.)

Each part has a small rule:

- **Themes** come from the commander's text (`leaderThemes`), plus any theme that at least 4
  cards and 10% of the spells already fit.
- **Tribes** come from a commander that names its own creature type ("other **Elves** you
  control"), plus a type a third of the deck's creatures share.
- **Gaps** are role counts from lesson 19 below their targets.

## A2. Two sides of a theme

Lesson 19's tags had one pattern per role. Themes need two: what a **leader** says ("Whenever
you sacrifice a permanent…") and what a card says when it **fits** ("When this creature dies…").
So each row of the theme table has both:

```ts
// src/shared/card-search/tags.ts (one row)
{
  theme: "sacrifice",
  label: "Sacrifice",
  leads: [
    rule(String.raw`\bsacrifices? (a|an|another|one or more|x|\w+) (other )?(creatures?|artifacts?|permanents?)\b`),
    rule(String.raw`\bwhenever (a|another|one or more) [^.]*creatures? [^.]*\bdies?\b`),
  ],
  fits: (_card, text) => /\bsacrifice\b|\bdies\b/i.test(text),
},
```

Some themes fit by **type line**, not text: a card fits "artifacts" if it _is_ an artifact. That's
why `fits` is a function, not a pattern: a row can look at whatever it needs.

## A3. Reasons as data, words in the UI

Every suggestion says why ("Elves · Removal (5 of 8)"). The domain could build those strings,
but then it would need the labels, which belong to the screen. It returns **data** instead:

```ts
export type Reason =
  | Readonly<{ kind: "theme"; theme: Theme }>
  | Readonly<{ kind: "tribe"; tribe: string }>
  | Readonly<{ kind: "role"; tag: Tag; count?: number; target?: number }>
  | Readonly<{ kind: "keyword"; keyword: string }>;
```

and the app turns it into words:

```ts
// src/app/decks/labels.ts
export function reasonText(reason: Reason): string {
  switch (reason.kind) {
    case "theme":
      return THEME_LABELS[reason.theme];
    case "tribe":
      return plural(reason.tribe);
    case "role": /* "Removal (5 of 8)" */
    case "keyword":
      return reason.keyword;
    default:
      return assertNever(reason);
  }
}
```

`assertNever` (lesson 01) makes the compiler complain if a new kind of reason is added and this
switch forgets it. **Python comparison:** a `match` statement over dataclasses, with
`typing.assert_never` in the `case _:` branch.

The test for `deckFit` can now say `toContainEqual({ kind: "theme", theme: "tokens" })`, which
doesn't break when the wording changes.

## A4. A scoring function from a weights table

Lesson 17 scored draft picks. Here it's the same shape: small parts, added up, with every weight
in one table so it's easy to read and tune.

```ts
export const WEIGHTS = {
  theme: 3,
  tribe: 3,
  roleGap: 2,
  commanderKeyword: 1,
  /* … */ strength: 0.5,
} as const;

export function scoreForDeck(card: CandidateCard, profile: DeckProfile): Scored | null {
  const { points, reasons } = deckFit(card, profile);
  if (points === 0) return null;
  return { card, score: points + WEIGHTS.strength * strength(card), reasons };
}
```

Two choices to notice:

- **`null` means "doesn't belong", not "scores low".** A $90 mythic that shares nothing with the
  deck isn't suggested at all. `strength` (rarity and price) is only a **tie-break**, added after
  the decision.
- **One list per role ignores the other gaps.** The first version added _every_ gap's points, so a
  card that ramps, draws and removes topped the ramp list, the draw list and the removal list
  alike. Trying it on the real catalog showed that; the fix was one line,
  `deckFit(card, { ...profile, gaps: [] })`. A heuristic gets tuned by looking at real output.

## A5. Sorting with a chain of comparisons

```ts
.sort((a, b) =>
  b.score - a.score ||
  Number(b.card.pool === "owned") - Number(a.card.pool === "owned") ||
  a.card.name.localeCompare(b.card.name),
)
```

A comparator returns a negative number (a first), a positive one (b first) or 0 (a tie). `||`
moves on to the next comparison only when the one before is `0`. `Number(true)` is `1`, so owned
cards sort first at equal scores.

**Python comparison:** `sorted(items, key=lambda s: (-s.score, s.card.pool != "owned", s.card.name))`.
Python compares the key tuples part by part, which is what the `||` chain does.

---

# Part B: Searching 76 000 printings quickly

## B1. Precompute when the question is asked often and the answer rarely changes

The first sketch searched rules text in SQL on every request. On the real catalog, one text
search over every printing took **0.6 seconds**, and a suggestion needs several. But a card's
roles and themes only change when **our rules** change (or when a new card arrives). So the sync
works them out once and stores them:

```sql
-- drizzle/0023_card_features.sql
ALTER TABLE "printings" ADD COLUMN "role_tags" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE "printings" ADD COLUMN "theme_tags" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE "printings" ADD COLUMN "features_version" integer DEFAULT 0 NOT NULL;
CREATE INDEX "printings_role_tags_idx" ON "printings" USING gin ("role_tags");
```

Now "cards with a role this deck lacks" is `p.role_tags && array['removal', 'wipe']` (`&&` means
"the arrays overlap"), and the **GIN index** answers it without reading every row. A GIN index
lists, for each tag, the rows that have it, like the index at the back of a book.

A stored copy can go **stale**. The version number handles that:

```ts
export const CARD_FEATURES_VERSION = 1; // bumped whenever the tag or theme rules change
```

The sync's tag pass takes printings whose `features_version` is below the current one, tags
them, and saves them with the new version, 500 at a time, until none are left. A new printing
starts at version 0, so it gets tagged on its first sync. Changing a rule and bumping the number
re-tags everything on the next sync, with no migration. Running the pass twice in a row does
nothing the second time (it's **idempotent**, lesson 04).

**Python comparison:** like a `@cached_property` whose cache key includes a version, except the
cache is a database column that every process shares.

## B2. Saving a batch in one statement

```ts
await db.execute(sql`
  update printings p
     set role_tags = v.role_tags, theme_tags = v.theme_tags, features_version = ${version}
    from jsonb_to_recordset(${rows}::jsonb) as v(id text, role_tags text[], theme_tags text[])
   where p.id = v.id
`);
```

The 500 rows travel as **one** JSON parameter, and `jsonb_to_recordset` turns them back into a
table that the `update … from` joins. That's one round trip instead of 500. It's still a single
parameter, so it's safe from SQL injection. **Python comparison:** `executemany`, or
`execute_values` in psycopg2.

## B3. Filter in SQL, rank in TypeScript

SQL is good at "which rows" over big tables with indexes. TypeScript is better at "how good is
each" when the rules are subtle and need tests. So `storeCandidates` does three things in SQL:

1. **`DISTINCT ON (p.oracle_id)`**: one row per card, not per printing. Postgres keeps the first
   row of each group in the `ORDER BY`. In pandas: `df.sort_values(...).drop_duplicates("oracle_id")`.
2. **Keep the 400 most promising**, ranked by a rough count of what each card shares with the
   deck (a cheap `int` sum of overlaps).
3. **`JOIN LATERAL`** to find each kept card's **cheapest printing for sale** (lesson 09: a
   lateral join runs a small query per row).

Then TypeScript scores those 400 with the tested functions and keeps the best 12. If the cut at
400 ever dropped good cards, the fix would be in SQL's rough count. The scoring wouldn't change.

**Measure, don't guess.** A throwaway script timed each query on the real catalog: 100–600 ms.
That's why the design keeps them. Measuring on 32 fixture cards would have shown nothing.

---

# Part C: Spending a budget

## C1. Greedy: the best value that still fits

"Spend up to $20 on this deck" picks store cards by **points per dollar**:

```ts
const value = (entry: Scored) =>
  entry.score / Math.max(PRICE_FLOOR_CENTS, entry.card.priceCents ?? 0);
// sort by value; then take each card if it still fits the budget
```

The **floor** treats cards under $1 as $1. Without it, a 10¢ card with 2 points (20 points a
dollar) beats a $3 card with 9 points (3 a dollar), and the list fills with filler.

This is a **greedy algorithm**: at each step it takes the best-looking choice and never
reconsiders. It's fast and easy to explain, but **not always optimal**. Choosing items with values
and costs under a budget to maximize total value is the **knapsack problem**, and greedy can lose:

| Card      | Points | Price | Points per dollar |
| --------- | ------ | ----- | ----------------- |
| Bomb      | 10     | $5    | 2                 |
| Good      | 6      | $3    | 2                 |
| Also good | 6      | $3    | 2                 |

With $6, greedy ties on value, takes the higher score (Bomb), and then nothing else fits: **10
points**. Good + Also good would have been **12**. The exact answer needs dynamic programming or
trying every subset. For 15 suggestions where the points are themselves rough guesses, the greedy
list is good enough, and every step of it can be explained: "best value first".

## C2. Promises a property test can keep

Whatever the scores and prices, `budgetPicks` promises four things (invariant 5): never over
budget, never the same card twice, never more than asked, only store cards. fast-check throws
hundreds of random lists at it:

```ts
fc.assert(
  fc.property(fc.array(entry), fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 8 }),
    (entries, budget, most) => {
      const picks = budgetPicks(/* … */, budget, most);
      expect(spent(picks)).toBeLessThanOrEqual(budget);
      expect(picks.length).toBeLessThanOrEqual(most);
      // …
    }),
);
```

It doesn't check that the picks are _optimal_: they aren't always (C1). Test the promises the
code makes, not ones it doesn't.

## C3. Handing off to a flow that already works

The budget list doesn't buy anything. It becomes text (`1 Builder's Talent (BLB) 1`) and a link,
`/singles/list?list=…`, to the existing **Buy a list** screen. That screen already parses lists,
checks today's prices and buys in one transaction. Text that arrives in the address is untrusted,
so the page cuts it to the box's own limits (20 000 characters, `MAX_LIST_LINES` lines).
Reusing the purchase flow means the money code didn't change at all.

---

## Common mistakes

- **Scoring everything.** If "no match" is just a low score, the store's priciest cards show up
  everywhere. Return `null` for "doesn't belong".
- **Putting words in the domain.** Labels change and belong to the screen; reasons as data keep
  tests stable.
- **Recomputing on every request** what only changes when your code changes. Store it, with a
  version.
- **Storing without a way to refresh.** A stored derived value needs a rule for when it's
  recomputed (here, the version), or it quietly goes stale.
- **Claiming a greedy result is the best.** It's the best _value-first_ list. Say that.
- **Tuning on fixtures only.** 32 test cards can't show that one card tops every list; the real
  catalog did.

## Exercises

### 1. Warm-up: cheapest first

Write a comparator that sorts suggestions with owned cards first, then by price (cheapest first,
unknown prices last), then by name.

<details><summary>Solution</summary>

```ts
function cheapestFirst(a: Scored, b: Scored): number {
  return (
    Number(b.card.pool === "owned") - Number(a.card.pool === "owned") ||
    (a.card.priceCents ?? Infinity) - (b.card.priceCents ?? Infinity) ||
    a.card.name.localeCompare(b.card.name)
  );
}
```

`Infinity - Infinity` is `NaN`, which `||` treats as false, so two unknown prices fall through to
the name.

</details>

### 2. Beat the greedy list

Find a list of two cards and a budget where `budgetPicks` gets fewer points than the best choice.

<details><summary>Solution</summary>

"Value" (3 points, $1) and "Big" (10 points, $5) with a $5 budget. Greedy takes Value first (3
points a dollar), then Big no longer fits: 3 points. Big alone would give 10.

</details>

### 3. The exact answer, for small lists

Write `bestWithin(entries, budget)`: the highest total score of any subset within the budget, by
trying every subset. Use it to check your answer to exercise 2.

_Hint:_ the numbers `0 … 2ⁿ − 1` written in binary are every subset of `n` items: bit `i` says
whether item `i` is in. `1 << n` is 2ⁿ, and `mask & (1 << i)` tests bit `i`.

<details><summary>Solution</summary>

```ts
function bestWithin(entries: readonly Scored[], budget: number): number {
  let best = 0;
  for (let mask = 0; mask < 1 << entries.length; mask++) {
    let cost = 0;
    let total = 0;
    entries.forEach((entry, index) => {
      if (mask & (1 << index)) {
        cost += entry.card.priceCents ?? 0;
        total += entry.score;
      }
    });
    if (cost <= budget) best = Math.max(best, total);
  }
  return best;
}
```

2ⁿ subsets is fine for 15 items (32 768) and hopeless for 400. That's one reason to use greedy.
Python: `itertools.combinations` over every size.

</details>

### 4. Soldiers aren't a tribe

Six Rabbit Soldiers make both Rabbit and Soldier "tribes", but Soldier is a class, not a tribe
anyone builds around. Write `tribeTypes(typeLine)`: the creature types, without class types
(Soldier, Warrior, Wizard, Cleric, Rogue, Scout, Druid, Shaman, Knight, Advisor).

<details><summary>Solution</summary>

```ts
const CLASS_TYPES = new Set([
  "Soldier",
  "Warrior",
  "Wizard",
  "Cleric",
  "Rogue",
  "Scout",
  "Druid",
  "Shaman",
  "Knight",
  "Advisor",
]);
function tribeTypes(typeLine: string): string[] {
  return creatureTypes(typeLine).filter((type) => !CLASS_TYPES.has(type));
}
tribeTypes("Creature — Rabbit Soldier"); // ["Rabbit"]
```

(Some decks _do_ build around Wizards, which is why the app doesn't do this yet. It's listed in
decisions-to-review.md.)

</details>

### 5. Challenge: when would you not store it?

The tags are stored because they're expensive to search and rarely change. Name something about a
card that would be a **bad** fit for storing this way, and say why.

<details><summary>Solution</summary>

Anything that depends on the **player or the deck**: "fits this deck", "you own 3", "used in two
of your decks". It changes with every deck edit and is different for every player, so a stored
copy would be stale at once. The deck profile is worked out per request for that reason. Prices
are stored, but as **dated snapshots** (a history), not one value to keep fresh.

</details>

## Recap

- A **profile** is worked out from the thing it describes, so it never disagrees with it.
- **Reasons as data** (a union) in the domain, **words** in the UI, and `assertNever` to keep
  them in step.
- A score is a sum of weighted parts. **`null` means "no match"**, and strength only breaks ties.
- **Precompute** what's expensive and rarely changes, store it with a **version**, and refresh it
  with an idempotent pass.
- **Filter in SQL** (indexes, `DISTINCT ON`, `LATERAL`), **rank in TypeScript** (tested rules).
- **Greedy** is fast and explainable but can miss the best total (knapsack). Test the promises
  it makes, not optimality.

## Further reading

- [Design doc 20](../docs/design/20-deck-suggestions.md): the weights, profile rules and budget
  rule.
- PostgreSQL manual: "GIN Indexes", `DISTINCT ON` (in `SELECT`), `jsonb_to_recordset`.
- The knapsack problem (Wikipedia): why the exact answer is hard, and the dynamic-programming
  solution for whole-number prices.
