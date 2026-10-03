# Lesson 19: Counting what a deck does

- **Phase:** 19 (builder insights: role tags, test hands, problems as you build)
- **Prerequisites:** [Lesson 05](05-randomness-you-can-trust.md) (seeds and `Rng`),
  [Lesson 08](08-animation-state-and-sound.md) (reducers), [Lesson 09](09-rules-as-data.md)
  (rule tables, regular expressions), [Lesson 14](14-a-search-language-and-paper.md)
  (client-safe imports, stale responses)
- **Time:** 2 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Write a **table of regular expressions** that classifies text, and test a heuristic with
   matches **and** near-misses.
2. Use **lookahead** and **lookbehind** to say "not followed by" and "not preceded by", and
   explain why JavaScript can do something here that Python's `re` can't.
3. Compute exact card-drawing odds with the **hypergeometric distribution**, using logarithms so
   big numbers never overflow, and check the formula with a property test and a seeded simulation.
4. Model a small game as a **pure reducer** whose "nothing happens" answer is the same object.
5. Run randomness in the browser **without** `Math.random`, from a seed the server makes.
6. Move a pure function to the browser so the screen reacts at once, while the **server stays
   the authority**, and widen a parameter type with `Pick` so the browser can call it.

---

# Part A: Reading what a card does

## A1. The problem

A Commander player asks: "How much ramp do I have? Enough removal?" The catalog doesn't say. A
card's **role** is in its rules text: _"Search your library for a basic land card, put it onto
the battlefield"_ is ramp; _"Destroy target creature"_ is removal. We want a function
`cardTags(card)` that reads the text and answers `["ramp"]` or `["removal", "draw"]`.

This is a **heuristic**: a rule of thumb that is usually right. Scryfall's volunteers tag cards
by hand; we can't. So the goal is "right for the cards people count", tested on real cards, with
a short note on screen saying a few may be miscounted.

## A2. Rules as data, again

Lesson 09 put each format's rules in a table (`FORMAT_RULES`). The same idea works here: one row
per tag, each with the patterns that find it.

```ts
// src/shared/card-search/tags.ts (shortened)
type TagRule = Readonly<{
  tag: Tag;
  patterns: readonly RegExp[];
  facts?: (card: TagFacts) => boolean; // another way to qualify
  notOnLands?: boolean;
}>;

export const TAG_RULES: readonly TagRule[] = [
  {
    tag: "counter",
    patterns: [rule(String.raw`\bcounter (up to one )?target\b[^.]*?\b(spell|ability)\b`)],
  },
  // …
];

export function cardTags(card: TagFacts): Tag[] {
  const text = withoutReminders(card.text);
  const land = isLand(card.typeLine);
  return TAG_RULES.filter(
    (row) =>
      !(row.notOnLands && land) &&
      ((row.facts?.(card) ?? false) || row.patterns.some((pattern) => pattern.test(text))),
  ).map((row) => row.tag);
}
```

New syntax, piece by piece:

- `` String.raw`…` `` is a **raw string**: backslashes stay as typed. It's Python's `r"…"`.
  Without it, `"\b"` would be a backspace character, not a regex word boundary.
- `new RegExp(source, "i")` compiles a pattern; `"i"` ignores case. Python: `re.compile(source, re.I)`.
- `row.facts?.(card)` calls `facts` **only if it exists** (optional call), else gives `undefined`;
  `?? false` turns that into `false`. Python: `row.facts(card) if row.facts else False`.
- `filter(…).map(…)` keeps rows that match, then takes their tag: a list comprehension
  `[row.tag for row in TAG_RULES if …]`.

Ramp uses `facts` because the best signal isn't text: a non-land with `producedMana` (Sol Ring,
Llanowar Elves) makes mana. And `notOnLands` keeps a land that taps for mana out of "ramp": it's a
land, already counted as one.

## A3. "Not followed by": lookahead

"Exile target creature" is removal. "Exile target creature **you control**, then return it" is a
trick to reuse your own creature, not removal. And "exile target creature **card** from a
graveyard" is graveyard hate. We want "creature, **not followed by** ` card` or ` you control`".

A **lookahead** checks what comes next without consuming it. `(?!…)` is a _negative_ lookahead:
"the next characters are not this".

```ts
rule(
  String.raw`\b(destroy|exile)\b[^.]*?\btarget\b[^.]*?\b${PERMANENT_TYPE}(?! cards?\b)(?! you control)`,
);
```

- `[^.]*?` means "any characters except a full stop, as few as possible", so a match stays inside
  one sentence.
- `${PERMANENT_TYPE}` pastes a shared piece of pattern into the template string (an f-string in
  Python).
- `(?! cards?\b)(?! you control)` are the two "not followed by" checks.

Python has the same syntax: `re.search(r"creature(?! you control)", text)`.

## A4. "Not preceded by": lookbehind, and a difference from Python

_"Whenever an opponent draws a card, you create a Treasure token"_ (Smothering Tithe) contains
"draws a card", but it isn't card draw for **you**. The word that gives it away comes **before**:
"whenever". A **negative lookbehind** `(?<!…)` checks what comes before.

```ts
rule(String.raw`(?<!\b(whenever|when|if)\b[^,.]*)\bdraws? (a|an|one|two|…) cards?\b`);
```

It reads: "draw a card, as long as there's no _whenever_, _when_ or _if_ earlier in the same
clause" (`[^,.]*` stops at a comma or full stop). So _"Whenever an opponent casts a spell, you may
draw a card"_ (Rhystic Study) still counts: the comma ends the "whenever" clause.

That lookbehind has a **variable length**: `[^,.]*` could be any number of characters.
JavaScript allows that. **Python's `re` doesn't**: it raises `look-behind requires fixed-width
pattern`. In Python you'd use the third-party `regex` module, or split the text into clauses
first. That's worth knowing when you move a pattern between the two languages.

## A5. Testing a heuristic: matches and near-misses

A heuristic only earns trust with examples. Every row has at least one real card that matches
and one **near-miss**: a card that looks similar but shouldn't match. The tests quote real Oracle
text, because the fixture catalog has only 32 cards and few staples.

```ts
// src/shared/card-search/tags.test.ts (shortened)
const EXAMPLES: ReadonlyArray<readonly [Example, readonly Tag[]]> = [
  [card("Counterspell", "Instant", "Counter target spell."), ["counter"]],
  [card("Battlegrowth", "Instant", "Put a +1/+1 counter on target creature."), []], // near-miss
  // …
];

it.each(EXAMPLES.map(([example, tags]) => [example.name, example, tags] as const))(
  "%s",
  (_name, example, tags) => {
    expect(cardTags(example)).toEqual(tags);
  },
);
```

`it.each` makes one test per row, named by the first value (`%s`). Python: `@pytest.mark.parametrize`.
A second test checks that **every tag** has at least one example, so a new row can't arrive
untested.

The `card` helper uses `satisfies`: `({ … }) satisfies Example` checks the object fits `Example`
**without** changing its type to `Example`. An `as` cast would skip the check; `satisfies` keeps it.

**Try it:** in `tags.test.ts`, add `[card("Opt", "Instant", "Scry 1.\nDraw a card."), ["draw"]]`
and run `pnpm vitest run src/shared/card-search/tags.test.ts`.

---

# Part B: Will I draw my lands?

## B1. Drawing without putting back

An opening hand is 7 cards drawn from a 99-card library (Commander, without the commander) that
holds 37 lands. What's the chance of 3 or more lands?

Each card you draw changes the odds of the next, because you don't put it back. That's the
**hypergeometric distribution**. For `N` cards with `K` "successes" (lands), drawing `n`, the
chance of **exactly** `k` successes is:

```
C(K, k) × C(N − K, n − k) / C(N, n)
```

`C(a, b)` is "a choose b", the number of ways to pick `b` things from `a`, Python's `math.comb(a, b)`.
In words: ways to pick `k` lands, times ways to pick the other `n − k` cards from the non-lands,
divided by all possible hands.

**Python comparison:**

```python
from math import comb
def exactly(N, K, n, k):
    return comb(K, k) * comb(N - K, n - k) / comb(N, n)
sum(exactly(99, 37, 7, k) for k in range(3, 8))  # at least 3
```

## B2. Big numbers: add logarithms instead

Python's integers never overflow, so `comb(99, 7)` is exact. JavaScript numbers are 64-bit
floats: `C(99, 7)` (about 1.5 × 10¹⁰) is fine, but factorials like `99!` (about 10¹⁵⁶) lose
precision and `171!` is `Infinity`.

The trick: **multiplying numbers is adding their logarithms**. `ln(a × b) = ln a + ln b`. So we
build a table of `ln(n!)` by adding `ln(1) + ln(2) + …`, work in logs, and only take `Math.exp`
at the end, when the number is a probability between 0 and 1.

```ts
// src/modules/decks/domain/draws.ts
function logFactorials(size: number): number[] {
  const table = [0];
  for (let n = 1; n <= size; n++) table.push(table[n - 1] + Math.log(n));
  return table;
}
// …
const lnChoose = (n: number, k: number) => lnFactorial[n] - lnFactorial[k] - lnFactorial[n - k];
chance += Math.exp(
  lnChoose(successes, hits) + lnChoose(population - successes, misses) - lnAllHands,
);
```

"By turn 4, on the play" means you've seen the opening 7 plus 3 draw steps: 10 cards. So
`hypergeometricAtLeast(99, 37, 10, 4)` is the chance of four lands by turn 4.

## B3. Two ways to trust a formula

A typo in a formula gives believable wrong numbers. Two checks catch that:

1. **A property test** (lesson 05): for any deck, the exact counts for k = 0…n add up to 1.
   fast-check tries hundreds of random decks.
2. **A seeded simulation**: shuffle 20 000 hands and count. The answer must be within 1.5
   percentage points of the formula. The seed is fixed, so the test gives the same result every
   run and never fails at random.

Simulation is the slow, obviously-correct answer; the formula is the fast, exact one. Each checks
the other. (While writing this lesson, the test caught a wrong number _in the test_: I'd
remembered 97.1% for "at least one land in 7 of 60 with 24 lands"; it's 97.8%. Python's
`math.comb` settled it.)

## B4. A test game as a reducer

The test hand panel needs state: the shuffled library, the hand, mulligans taken, cards still
owed to the bottom. Lesson 08 kept the opening animation in a **reducer**: a pure
`(state, event) → state` function. The test hand works the same way.

```ts
// src/modules/decks/domain/draws.ts (shortened)
export function nextHand(state: TestHand, event: TestHandEvent): TestHand {
  switch (event.kind) {
    case "mulligan":
      if (state.turn > 0 || state.toBottom > 0) return state;
      return startHand(everyCard(state), event.rng, state.freeMulligan, state.mulligans + 1);
    case "draw": {
      const [top, ...rest] = state.library;
      if (state.toBottom > 0 || top === undefined) return state;
      return { ...state, hand: [...state.hand, top], library: rest, turn: state.turn + 1 };
    }
    // …
  }
}
```

When an event doesn't apply ("draw" while a card is owed to the bottom), it returns **the same
object**, not a copy. React then sees nothing changed and skips the re-render, and a test can
check exactly that with `expect(nextHand(hand, { kind: "draw" })).toBe(hand)`. `toBe` is
identity (Python `is`); `toEqual` is equality (Python `==`).

`const [top, ...rest] = state.library` is **array destructuring** with a **rest element**:
Python's `top, *rest = library`. On an empty array, `top` is `undefined` instead of an error.

The **London mulligan**: shuffle and draw 7 again, then put one card on the bottom per mulligan.
In multiplayer Commander the first mulligan is free, so the owed count is
`mulligans − (freeMulligan ? 1 : 0)`. The rule is one line of data, not a branch in the UI.

## B5. Randomness in the browser, without `Math.random`

ADR 0008 says randomness comes through an `Rng`, and lint forbids `Math.random()`. Pack openings
happen on the server because they decide what you **get**. A test hand decides nothing: nothing
is saved and nobody gains anything. So it can run in the browser, as long as it still goes
through `Rng`:

```tsx
// src/app/decks/[id]/page.tsx: the server makes a seed…
<DeckBuilder … seed={seeds.newSeed()} />;

// src/app/decks/[id]/builder/test-hand.tsx: …and the browser counts shuffles from it.
const shuffles = useRef(0);
const nextRng = () => seededRng(`${props.seed}:${shuffles.current++}`);
```

Every shuffle has a reproducible seed, the lint rule didn't change, and ADR 0008 gained a note
saying when browser randomness is fine. **Write down an exception where the rule lives**, so the
next reader doesn't think the rule was forgotten.

---

# Part C: Problems the moment you click

## C1. Same function, both sides

Before this phase, adding a card showed its problems ("outside your commander's colors") only
when the server answered. But `deckProblems` is **pure**: it needs the deck, each card's rules
facts, and how many you own. The server already had all of that. So the browser can run the
**very same function**, as long as it has the same inputs:

- the builder's deck now arrives with `rules` (each card's identity, legalities, text…);
- each grid card carries its `rules` too, so a card new to the deck can be checked before the
  server knows about it.

Because it's one function, the browser and server can't disagree about the rules. The server
still re-checks and answers with the saved deck, which replaces the browser's. The server is the
**authority**; the browser is a **fast preview** of the same answer.

## C2. Widening a parameter with `Pick`

`deckProblems` used to take a whole `Deck`: id, owner, name, format and entries. The browser
doesn't have an owner id, and the function never read it. Rather than invent fake values, the
parameter type was **widened** to what's really needed:

```ts
// src/modules/decks/domain/rules.ts
export type DeckToCheck = Pick<Deck, "format" | "entries">;
export function deckProblems(deck: DeckToCheck, rules: RulesLookup, owned: OwnedLookup) { … }
```

Every `Deck` still fits (TypeScript checks **structure**, not names), so no server code changed.
The browser passes `{ format, entries }`. Python's equivalent is a `Protocol` with just those two
attributes.

## C3. A provisional line

A new card needs a deck line to show: its name, mana cost, price… The grid card has all of it,
so `provisionalLine(card, board, quantity)` builds one. An integration test adds a card through
the real use case and checks the **server's** line has the same printing, finish, text and price
as the browser's guess. That test is what keeps the preview honest as queries change.

## C4. Testing "before the server answers"

How do you prove something showed up **before** a response? Make the response slow. The browser
test holds every server-action request for 3 seconds with `page.route`, then expects the problem
text within 1.5 seconds:

```ts
await page.route("**/decks/**", async (route) => {
  if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  await route.continue();
});
```

Then the test **waits for the held-back saves to reach the server** before moving on. The first
version didn't, and the test failed later: it left the page while a save was still waiting, and
the server never got it. The status line already said "Plains: now 99." from an earlier step, so
waiting for that text proved nothing. Wait for the event you mean (here, the response whose body
has `"quantity":99`), not for a look-alike.

---

## Common mistakes

- **Testing a heuristic only with matches.** Every pattern matches what you wrote it for. The
  near-misses ("+1/+1 counter on target", "destroy target land") are what show it's too broad.
- **Reminder text.** "(… draw a card …)" inside parentheses explains a keyword; it isn't the
  card's ability. Strip reminders before matching.
- **Copying a regex from JavaScript to Python unchanged.** Variable-length lookbehind works in
  one and raises an error in the other.
- **Multiplying factorials in floats.** `170!` is the largest that fits; work in logarithms.
- **Trusting remembered numbers in tests.** Two expected values in this phase's tests were wrong
  from memory. Compute them (`python3 -c "from math import comb; …"`) before writing them down.
- **Returning a copy when nothing changed.** A reducer that always copies makes React re-render
  and hides "nothing happened" from tests.
- **Two sources of truth.** Computing problems in the browser with a _different_ function from
  the server's would drift. Share the one pure function.

## Exercises

### 1. Warm-up: a lifegain pattern

Write `gainsLife(text)`: true for "you gain 4 life" or "you gain X life", false for reminder text
("…causes you to gain that much life.") and for "Each opponent loses 2 life."

_Hint:_ remove `\([^)]*\)` first, then one regex.

<details><summary>Solution</summary>

```ts
const LIFEGAIN = /\byou gain (\d+|x|that much) life\b/i;
function gainsLife(text: string): boolean {
  return LIFEGAIN.test(text.replace(/\([^)]*\)/g, ""));
}
```

Lifelink's reminder text says "gain that much life", but it's removed before matching.

</details>

### 2. Exactly k

Using `hypergeometricAtLeast`, write `exactly(population, successes, draws, count)`. What's the
chance of exactly 3 lands in an opening 7 from 60 cards with 24 lands?

_Hint:_ "at least 3" minus "at least 4".

<details><summary>Solution</summary>

```ts
function exactly(population: number, successes: number, draws: number, count: number): number {
  return (
    hypergeometricAtLeast(population, successes, draws, count) -
    hypergeometricAtLeast(population, successes, draws, count + 1)
  );
}
exactly(60, 24, 7, 3); // ≈ 0.3087, the same as comb(24,3)*comb(36,4)/comb(60,7) in Python
```

</details>

### 3. Expected lands

Using `exactly`, compute the **average** number of lands in an opening hand (the sum of
`k × P(exactly k)`). Compare it with `7 × lands / cards`. Why are they equal?

<details><summary>Solution</summary>

```ts
function expectedLands(population: number, lands: number, draws: number): number {
  let total = 0;
  for (let count = 0; count <= draws; count++) {
    total += count * exactly(population, lands, draws, count);
  }
  return total;
}
expectedLands(60, 24, 7); // 2.8 = 7 × 24 / 60
```

Each of the 7 cards, on its own, is a land with chance `lands / cards`, and averages add up even
when the cards depend on each other. Not putting cards back changes how spread out the results
are, not their average.

</details>

### 4. A new reducer event

Write `toBottomOfLibrary(state)`: put the library's top card on the bottom (a "scry 1, bottom").
It must do nothing while cards are owed to the bottom after a mulligan, and do nothing in the
same way `nextHand` does.

<details><summary>Solution</summary>

```ts
function toBottomOfLibrary(state: TestHand): TestHand {
  const [top, ...rest] = state.library;
  if (top === undefined || state.toBottom > 0) return state; // the same object: nothing happened
  return { ...state, library: [...rest, top] };
}
```

</details>

### 5. Challenge: when does "draw" mean you?

Explain why `(?<!whenever [^,.]*)draws? a card` rejects _"Whenever an opponent draws a card, you
gain 1 life"_ but accepts _"Whenever you attack, draw a card."_ Then say what Python's `re` does
with this pattern, and one way to get the same result in Python.

<details><summary>Solution</summary>

In the first text, "whenever an opponent " comes right before "draws", with no comma or full stop
between, so the lookbehind finds it and refuses. In the second, the comma after "attack" means
`[^,.]*` can't reach back to "whenever", so nothing refuses the match.

Python's `re.compile` raises `error: look-behind requires fixed-width pattern`. Either use the
`regex` package (which allows variable-length lookbehind), or split the text into clauses on
`[,.]` and skip clauses that start with "whenever".

</details>

## Recap

- A **table of patterns** classifies text; each row is tested with real matches and near-misses.
- **Lookahead** `(?!…)` and **lookbehind** `(?<!…)` say "not followed / preceded by".
  JavaScript allows variable-length lookbehind; Python's `re` doesn't.
- The **hypergeometric distribution** gives exact odds when drawing without replacement. Work in
  **logarithms** to keep big numbers safe, and check the formula with a property test and a
  seeded simulation.
- A **reducer** returns the same object when nothing happens: React skips work and tests can say so.
- Browser randomness is fine **when it decides nothing**, still through a seeded `Rng`. Write the
  exception down in the ADR.
- One pure function can run on **both sides**. The browser previews; the server decides. `Pick`
  narrows a parameter to what the function really reads.

## Further reading

- [Design doc 19](../docs/design/19-builder-insights.md): tags, targets, the test hand and its
  state table.
- [ADR 0008](../docs/adr/0008-injected-rng-clock.md) and its Phase 19 note.
- MDN, "Lookahead assertion" and "Lookbehind assertion" (regular expressions).
- Frank Karsten, "How many lands do you need to consistently hit your land drops?" (ChannelFireball,
  2016): the hypergeometric reasoning behind land counts.
