# Lesson 31: Floors, warnings, and data that won't wait

- **Phase:** 31 (Commander brackets: estimate the lowest bracket a deck's cards allow, save the
  bracket its owner is aiming for, warn when the cards go over it, and keep suggestions within it)
- **Prerequisites:** [Lesson 09](09-rules-as-data.md) (rule tables, reporting problems vs
  refusing), [Lesson 19](19-counting-what-a-deck-does.md) (regular-expression tables and
  near-misses), [Lesson 20](20-suggesting-cards.md) (precomputing with a version, filter in SQL
  and rank in TypeScript), [Lesson 27](27-averages-floors-and-one-rule-twice.md) (one rule in SQL
  and TypeScript)
- **Time:** 1¼ hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Compute a **floor** as the maximum over independent rules with `reduce`, and prove with a
   property test that adding to the input never lowers it.
2. Write rules **as data** keyed by a union type (`Record<BracketRule, …>`), with the source and
   date of the rules next to them, and tell apart data you own from data someone else changes.
3. Choose between a **versioned precomputed** value and a column refreshed on every sync, from
   how often the source changes.
4. Model a **warning** as its own type, separate from errors and from rule problems, and return
   `null` when there's nothing to warn about.
5. Judge **one change** ("does adding this card break the target?") by the rules it touches, and
   find the bug in the whole-deck version with a property test and a known example.
6. Turn the same judgement into a **SQL condition** when filtering after a `LIMIT` would short a
   result, and enforce a rule that spans two columns with a `CHECK` constraint.

---

# Part A: What a bracket is, and what we can check

Wizards' **Commander Brackets** sort decks into five power bands so a playgroup can agree before
a game: 1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH. Most of what puts a deck in a
bracket is **intent** (how hard you're trying to win), and no program can read intent. A few
things are on the cards, though:

| Rule                     | 1–2              | 3                 | 4–5 |
| ------------------------ | ---------------- | ----------------- | --- |
| Game Changers            | none             | up to 3           | any |
| Mass land denial         | no               | no                | yes |
| Extra-turn cards         | a few, unchained | no chaining       | any |
| Two-card infinite combos | no               | only late in game | any |

So the app can't say "this deck **is** bracket 3". It can say "this deck's cards **allow no
lower** than bracket 3": a **floor**. A deck can always be played above its floor (you could
bring a bracket-1 deck to a bracket-4 table), but its cards can't put it below. The design doc
names this the **bracket floor**, and the panel says "(at least)" next to it.

Naming the honest claim first shaped everything after it: the function returns a floor and a
range (`1–2` when nothing is found, because 1 and 2 differ only by intent), never a single
"power level".

---

# Part B: A floor is a maximum

## B1. Each rule forces a bracket

Each rule looks at how many copies trip it and says the lowest bracket that count allows. One Game
Changer forces 3; four force 4; any land denial forces 4. The deck's floor is the **highest**
of those, because every rule must be satisfied at once.

In Python you'd write `max([3, 4, 2], default=1)`. TypeScript arrays have no `max`, so the
project uses `reduce`, which walks the array carrying an accumulator (like `functools.reduce`):

```ts
const floor = findings.reduce<Bracket>(
  (highest, finding) => (finding.forces > highest ? finding.forces : highest),
  1,
);
```

From [`estimateBracket`](../src/modules/decks/domain/brackets.ts). Line by line:

- `reduce<Bracket>(…)`: the type in angle brackets says what the accumulator is. Without it,
  TypeScript infers the type of the starting value `1`, which is the literal type `1`, and then
  refuses to store a `3` in it.
- `(highest, finding) => …`: called once per finding with the best so far and the next item.
- `? :` is Python's `a if condition else b`, written `condition ? a : b`.
- `1`: the starting value, and the answer for an empty list (no findings: bracket 1).

`Math.max(...numbers)` would also work, but it returns `-Infinity` for an empty list and
`number` rather than `Bracket`; the `reduce` keeps both the type and the empty case right.

## B2. A property that must always hold

A floor that could **drop** when you add a card would make no sense: adding Armageddon can't make a
deck gentler. That's a promise about every possible deck, so it's tested as a **property**
([lesson 05](05-randomness-you-can-trust.md)): generate random decks and random cards, and check
the promise on each.

```ts
it("never lowers the floor when a card is added, and never reaches 5 (invariants 2, 3)", () => {
  fc.assert(
    fc.property(fc.array(lineArbitrary, { maxLength: 12 }), lineArbitrary, (lines, added) => {
      const before = floorOf(lines) ?? 1;
      const after = floorOf([...lines, added]) ?? 1;
      expect(after).toBeGreaterThanOrEqual(before);
      expect(after).toBeLessThan(5);
    }),
  );
});
```

From [`brackets.test.ts`](../src/modules/decks/domain/brackets.test.ts). `lineArbitrary` makes
random deck lines (any board, 1–4 copies, any subset of the flags). The property holds because a
maximum only grows when you add items **and** each rule's bracket only grows with its count. If
someone later wrote a rule that went down as copies went up, this test would catch it.

**Try it:** `pnpm exec vitest run src/modules/decks/domain/brackets.test.ts`

---

# Part C: Rules as data, and whose data it is

## C1. A table keyed by a union

The thresholds live in one object, not in `if` statements scattered through the code:

```ts
export const BRACKET_RULES: Readonly<
  Record<BracketRule, Readonly<{ flag: BracketFlag; forces: (count: number) => Bracket }>>
> = {
  // None in 1–2, up to three in 3, any in 4–5.
  gameChangers: { flag: "gameChanger", forces: (count) => (count <= 3 ? 3 : 4) },
  // Mass land denial: only in 4–5.
  landDenial: { flag: "landDenial", forces: () => 4 },
  // "Few, never chained" in 1–2; chaining is banned in 3, and three or more cards count as
  // chaining (design doc 31, decision 4), so those decks are at least 4.
  extraTurns: { flag: "extraTurn", forces: (count) => (count <= 2 ? 2 : 4) },
};
```

- `Record<BracketRule, …>` is a dict type whose keys must be **exactly** the members of
  `BracketRule` (`"gameChangers" | "landDenial" | "extraTurns"`). Forget one and it doesn't
  compile; misspell one and it doesn't compile. Python's closest is a `TypedDict` with every
  key required.
- `forces` is a **function stored as data**, typed `(count: number) => Bracket`. The rule is a
  value you can pass around, test on its own (exercise 2), and loop over.
- The comment above the table says which version of Wizards' rules it follows (the 9 February
  2026 update; tutors stopped counting in October 2025). Rules from someone else change. A
  dated source next to them tells the next reader what to check.

## C2. A type guard for numbers from outside

A bracket arrives from a form, the database or an LLM as a plain `number`. The type `Bracket` is
`1 | 2 | 3 | 4 | 5`, made from a constant list the way [lesson 09](09-rules-as-data.md) showed:

```ts
export const BRACKETS = [1, 2, 3, 4, 5] as const;
export type Bracket = (typeof BRACKETS)[number];

export function isBracket(value: number): value is Bracket {
  return (BRACKETS as readonly number[]).includes(value);
}
```

`value is Bracket` makes this a **type guard**: when it returns `true`, TypeScript treats
`value` as a `Bracket` from then on. The cast `as readonly number[]` is needed because
`includes` on a list of `1 | 2 | … | 5` only accepts those numbers, and the whole point is to
ask about any number.

## C3. Data you own, data you don't

There are two kinds of rule here, and they're stored differently:

- **Land denial and extra turns** are read from rules text by regular expressions the project
  wrote ([`brackets.ts`](../src/shared/card-search/brackets.ts), like the role tags of
  [lesson 19](19-counting-what-a-deck-does.md)). They change only when **we** change them.
- **Game Changers** are a list **Wizards** keeps and changes when it likes (it added Farewell and
  Biorhythm in February 2026). Scryfall publishes each card's `game_changer` flag, and the app
  already downloads Scryfall's file every night.

[Lesson 20](20-suggesting-cards.md) stored features with a **version number**: the sync
recomputes them only when `CARD_FEATURES_VERSION` goes up. That's right for our own rules,
because nothing else changes them. It would be wrong for Game Changers. If Wizards added a card on Tuesday,
the stored feature would stay stale until a developer bumped the version for some unrelated
reason.

So the first plan, one `bracket_flags` column holding all three flags, was changed while
building (design doc 31, implementation note 1):

| Column            | Holds                     | Refreshed                                 |
| ----------------- | ------------------------- | ----------------------------------------- |
| `bracket_flags`   | `landDenial`, `extraTurn` | by the tag pass, when the version changes |
| `is_game_changer` | Scryfall's `game_changer` | by **every** Scryfall pass, every night   |

The question to ask about any precomputed value: **who can change its inputs, and how will I
know?** If it's only your code, a version number works. If it's someone else's data, refresh it
whenever you fetch that data.

---

# Part D: A warning is not an error

## D1. Three kinds of "not right"

The project already had two:

- **Errors** (`Result` with `{ kind: … }`, ADR 0003): the action didn't happen. "A target
  bracket is 1 to 5."
- **Deck problems** (`DeckProblem`, [lesson 09](09-rules-as-data.md)): the deck breaks its
  format's rules. 99 cards in Commander. The deck builder shows them in red, and "Ready to play"
  needs none.

Going over your target bracket is neither. The deck is perfectly legal, since a bracket is an
agreement between players and not a rule of the game. So it gets its own type:

```ts
export type BracketWarning = Readonly<{
  kind: "OverTargetBracket";
  target: Bracket;
  floor: Bracket;
  /** Only the findings that force a bracket above the target. */
  findings: readonly BracketFinding[];
}>;

export function bracketWarning(
  estimate: BracketEstimate | null,
  target: Bracket | null,
): BracketWarning | null {
  if (estimate === null || target === null || estimate.floor <= target) return null;
  return {
    kind: "OverTargetBracket",
    target,
    floor: estimate.floor,
    findings: estimate.findings.filter((finding) => finding.forces > target),
  };
}
```

Adding `"OverTargetBracket"` to `DeckProblem` would have been less code, but then every place
that asks "is this deck ready?" would count it, and an over-target deck would stop being "ready
to play". A separate type keeps the two questions apart. It's shown in amber, never red.

## D2. Null means "nothing to say"

`bracketWarning` returns `null` in four different situations: no estimate (not a Commander
deck), no target, or a floor within the target. Callers don't care which. They only need "is there
a warning?", so one `null` serves them all, the same way Python code returns `None`. The
property test pins down exactly when:

```ts
expect(bracketWarning(estimate, target) === null).toBe((estimate?.floor ?? 1) <= target);
```

---

# Part E: Judging one change

## E1. The question suggestions ask

With a target set, suggestions must leave out cards that would take the deck over it. The first
version of `fitsTarget` answered "would the **deck** be within the target with this card
added?":

```ts
const estimate = estimateBracket("commander", [...lines, added]);
return estimate === null || estimate.floor <= target;
```

It looks right, and the first tests passed. The integration test of the LLM tools caught the problem. A bracket-2 deck
that already had one Game Changer (so it was already over target) got **every** flagged card
left out, extra-turn cards included. One or two extra-turn cards are fine in bracket 2. The
card was blamed for something already in the deck.

The question suggestions really need is "does **this card** break the target?" Each rule counts
on its own, so the answer is to check only the rules the card adds to (parameter types left out
here to keep it short):

```ts
export function fitsTarget(lines, card, target): boolean {
  const counted = lines.filter((line) => line.board !== "side");
  return BRACKET_RULE_NAMES.every((rule) => {
    const { flag, forces } = BRACKET_RULES[rule];
    if (!card.flags.includes(flag)) return true;
    const already = counted
      .filter((line) => line.flags.includes(flag))
      .reduce((total, line) => total + line.quantity, 0);
    return forces(already + 1) <= target;
  });
}
```

`every` is Python's `all(…)`: true when the test holds for each rule. A rule the card doesn't
touch passes at once.

## E2. Saying what "right" means, as properties

The new function has two promises, and each is a property test:

1. **While the deck is within its target**, it agrees with re-estimating the whole deck. Here
   the old question and the new one are the same. `fc.pre(condition)` (a **precondition**)
   skips generated cases where the condition is false, like `hypothesis.assume`.
2. **A card it accepts never raises the floor above `max(floor, target)`.** It may leave an
   already-over deck over, but it never makes things worse than the target allows.

Writing the promise down was what exposed the bug. "Agrees with re-estimating" was only ever true
for decks within their target.

---

# Part F: The same judgement in SQL

## F1. Why not filter afterwards?

Suggestions fetch a pool of a few hundred candidates, score them in TypeScript, and keep the best.
Leaving out over-target cards **after** the SQL is easy there, and they can count what they hid.

`search_for_deck` is different. Each query has a `LIMIT`: "the first 20 matching cards". Filter
after that and a query could come back with 3 cards when 40 fitting ones existed. So the search
must filter **inside** SQL.

## F2. From a judgement to a condition

Because `fitsTarget` checks rules one at a time, a card fits exactly when **each of its flags
fits alone**. So the judgement reduces to a list of flags a card mustn't have:

```ts
export function flagsOverTarget(lines: readonly BracketLine[], target: Bracket): BracketFlag[] {
  return BRACKET_FLAGS.filter((flag) => !fitsTarget(lines, { name: flag, flags: [flag] }, target));
}
```

and that list becomes SQL ([`search-for-deck.ts`](../src/modules/decks/queries/search-for-deck.ts)):

```ts
function withinTarget(flags: readonly BracketFlag[]): SQL {
  const conditions: SQL[] = [];
  if (flags.includes("gameChanger")) conditions.push(sql`not p.is_game_changer`);
  const textFlags = flags.filter((flag) => flag !== "gameChanger");
  if (textFlags.length > 0) {
    const array = sql.join(
      textFlags.map((flag) => sql`${flag}`),
      sql`, `,
    );
    conditions.push(sql`not (p.bracket_flags && array[${array}]::text[])`);
  }
  return conditions.length === 0 ? sql`true` : sql.join(conditions, sql` and `);
}
```

`&&` on Postgres arrays means "overlap" (any element in common), like Python's
`not set(a).isdisjoint(b)`. The GIN index on `bracket_flags` makes it fast. Each flag is a
**parameter** (`${flag}` becomes `$1`), never pasted into the SQL text.

A property test checks that `flagsOverTarget` and `fitsTarget` agree for cards with any mix of
flags. That test is what makes it safe to have the rule in two places, the same idea as
[lesson 27](27-averages-floors-and-one-rule-twice.md)'s value floor.

## F3. A rule across two columns

"Only Commander decks have a target" involves two columns, so one column's type can't express
it. A `CHECK` constraint can:

```ts
check(
  "decks_target_bracket",
  sql`${table.targetBracket} is null or (${table.targetBracket} between 1 and 5 and ${table.format} = 'commander')`,
),
```

The use case already refuses a target on a Modern deck, and clears it when a deck leaves
Commander. The constraint is the last line of defence, against any code path that forgets: an
integration test writes `format = 'modern', target_bracket = 2` directly and expects the
database to refuse.

---

# Part G: A smaller lesson from the tool schema

`update_deck` first took `targetBracket: number | null` (`z.number().nullable()`). The registry
test from [lesson 28](28-tools-for-a-model.md) failed: `nullable()` becomes an `anyOf` in JSON
Schema, and small models handle unions badly. The fix is to make "no target" a value in the same
type: `0` clears it, mapped to `null` at the edge. Keep internal types precise (`Bracket | null`)
and give the outside the simplest shape that can say everything.

---

## Common mistakes

- **Answering a different question than the caller asks.** "Is the deck within target with this
  card?" and "does this card break the target?" agree only while the deck is within target. Write
  down what the caller needs before writing the function.
- **Trusting a property test that passed by luck.** The whole-deck bug only shows when a deck is
  already over target and the card has a _different_ flag. Random generation hits that only
  sometimes. When you know a failing case, pass it in with `examples` so the test fails every
  time.
- **Versioning someone else's data.** A version number refreshes what **your** rules compute. A
  list maintained elsewhere goes stale between bumps. Refresh it every time you fetch it.
- **Folding a warning into errors or problems.** It then changes answers it shouldn't ("ready to
  play") and is shown with the wrong weight. Give it its own type.
- **Filtering after a `LIMIT`.** You get fewer results than exist. Filter in the query, or fetch
  a pool large enough and say how many you hid.
- **`Math.max` on a possibly empty list.** It returns `-Infinity`. Use `reduce` with a starting
  value that's the right answer for "nothing found".

---

## Exercises

### 1. Warm-up: the highest bracket

Write `highestBracket(forces: readonly Bracket[]): Bracket`, returning 1 for an empty list.

_Hint:_ `reduce` with a type argument and a starting value.

<details>
<summary>Solution</summary>

```ts
function highestBracket(forces: readonly Bracket[]): Bracket {
  return forces.reduce<Bracket>((highest, each) => (each > highest ? each : highest), 1);
}

expect(highestBracket([])).toBe(1);
expect(highestBracket([2, 4, 3])).toBe(4);
```

Without `<Bracket>`, the accumulator's type is the literal `1`, and returning `each` (a
`Bracket`) doesn't compile.

</details>

### 2. Test a rule on its own

`BRACKET_RULES.extraTurns.forces` is a function stored in the table. Write a table-driven test
(`it.each`) for 1, 2, 3 and 10 extra-turn cards.

_Hint:_ import `BRACKET_RULES` from `@/modules/decks`; it's part of the public API.

<details>
<summary>Solution</summary>

```ts
it.each([
  [1, 2],
  [2, 2],
  [3, 4],
  [10, 4],
])("%i extra-turn cards force bracket %i", (count, bracket) => {
  expect(BRACKET_RULES.extraTurns.forces(count)).toBe(bracket);
});
```

Testing the boundary (2 and 3) matters most: that's where "a few" becomes "chaining".

</details>

### 3. A condition you can read

Write `withoutFlags(flags: readonly BracketFlag[]): SQL` (as in Part F2), then check the SQL it
makes with drizzle's `PgDialect`: `new PgDialect().sqlToQuery(fragment)` returns
`{ sql, params }`.

_Hint:_ the text should hold `$1`, never the flag itself.

<details>
<summary>Solution</summary>

```ts
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();
expect(dialect.sqlToQuery(withoutFlags([])).sql).toBe("true");
const query = dialect.sqlToQuery(withoutFlags(["gameChanger", "landDenial"]));
expect(query.sql).toBe("not p.is_game_changer and not (p.bracket_flags && array[$1]::text[])");
expect(query.params).toEqual(["landDenial"]);
```

(`withoutFlags` is Part F2's `withinTarget`, renamed.) Reading the generated text is a quick way
to check a fragment before it meets a database.

</details>

### 4. Challenge: catch the whole-deck bug

Here is the first version from Part E1, as a function (its parameters have the same types as
`fitsTarget`'s):

```ts
function fitsWholeDeck(lines, card, target): boolean {
  if (card.flags.length === 0) return true;
  const added: BracketLine = { name: card.name, quantity: 1, board: "main", flags: card.flags };
  return (estimateBracket("commander", [...lines, added])?.floor ?? 1) <= target;
}
```

Write one property, "a card with **one** flag fits exactly when that flag's own rule still
allows the target", that **fails** for `fitsWholeDeck` and **passes** for the real `fitsTarget`.
Make the failure certain, not occasional.

_Hint:_ find the rule with `Object.values(BRACKET_RULES).find((each) => each.flag === flag)`;
then pass a known failing case with `fc.assert(property, { examples: [[lines, flag, target]] })`.

<details>
<summary>Solution</summary>

```ts
const property = (fits: typeof fitsTarget) =>
  fc.property(
    fc.array(lineArbitrary, { maxLength: 10 }),
    fc.constantFrom(...BRACKET_FLAGS),
    fc.constantFrom<Bracket>(1, 2, 3, 4, 5),
    (lines, flag, target) => {
      const rule = Object.values(BRACKET_RULES).find((each) => each.flag === flag)!;
      const already = lines
        .filter((line) => line.board !== "side" && line.flags.includes(flag))
        .reduce((total, line) => total + line.quantity, 0);
      expect(fits(lines, { name: "Candidate", flags: [flag] }, target)).toBe(
        rule.forces(already + 1) <= target,
      );
    },
  );

// A Game Changer already over a bracket-2 target, then an extra-turn card: rare at random.
const gameChanger: BracketLine = {
  name: "Rhystic Study",
  quantity: 1,
  board: "main",
  flags: ["gameChanger"],
};
const examples: [BracketLine[], BracketFlag, Bracket][] = [[[gameChanger], "extraTurn", 2]];

expect(() => fc.assert(property(fitsWholeDeck), { examples })).toThrow();
fc.assert(property(fitsTarget), { examples });
```

Without `examples`, the property found the bug in some runs and not others, which is the second
common mistake above. The `!` after `find(…)` tells TypeScript "this isn't `undefined`": every
flag has a rule, and a test would fail loudly if one didn't.

</details>

---

## Recap

- A **floor** from independent rules is their maximum. `reduce<Bracket>(…, 1)` keeps the type
  and the empty case right, and a property test proves adding never lowers it.
- Keep rules **as data** in a `Record` keyed by a union, with the source and date beside them.
- **Version** what your own rules compute; **refresh on every fetch** what someone else
  maintains (Game Changers).
- A **warning** is its own type, apart from errors (didn't happen) and problems (breaks the
  rules), and `null` when there's nothing to say.
- Judge a change by **what it touches**: per-rule `fitsTarget`, not "is the whole deck fine?"
- When a `LIMIT` is involved, turn the judgement into **SQL**; keep the two versions honest with a
  property test; enforce cross-column rules with a `CHECK` constraint.

## Further reading

- [Design doc 31](../docs/design/31-commander-brackets.md), especially section 15 (what changed
  while building).
- [ADR 0019](../docs/adr/0019-precomputed-card-features.md) and its implementation note on Game
  Changers.
- [ADR 0003](../docs/adr/0003-result-types.md) (errors as `Result`).
- Wizards of the Coast, "Introducing Commander Brackets Beta", and the updates since, on
  magic.wizards.com.
- fast-check's documentation on preconditions (`fc.pre`) and on the `examples` parameter of
  `fc.assert`, at fast-check.dev.
