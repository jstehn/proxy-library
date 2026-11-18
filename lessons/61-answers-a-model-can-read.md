# Lesson 61: Answers a model can read, rules a simulator keeps

- **Phase:** 61 (MCP commander awareness and deck primers: a compact `get_deck`, a deck profile
  the tools read, a goldfish simulator that knows mana, colors and commander tax, and a primer
  and per-card roles in the deck builder)
- **Prerequisites:** [Lesson 19](19-counting-what-a-deck-does.md) (role tags, the draw
  simulator), [Lesson 23](23-replacing-a-list-and-ranking-copies.md) (replace vs add,
  all-or-nothing saves), [Lesson 28](28-tools-for-a-model.md) (tools written for a model)
- **Time:** 1¼ hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Measure a response in **bytes**, not characters, and explain why a `.length` check undercounts
   text with dashes and accents.
2. Shrink a tool's answer by changing its **shape** (one line per item instead of one object),
   and page it by **whole groups** so no page splits a heading.
3. Write a state machine's refusals as a **union of errors**, turn each into words with an
   exhaustive `switch`, and let `assertNever` catch a forgotten case at compile time.
4. Model a **discount** (a cost reducer) as data and apply it with a small pure function.
5. Recognise a **matching** problem (which mana source pays which colored pip), see why a greedy
   pick fails, and solve it with augmenting paths.
6. Spot the **"field the save forgets"** bug in a replace-all repository, and fix it by putting
   the field in the domain type.

---

# Part A: Budgeting an answer in bytes

## A1. The problem

`get_deck` returned 98.6 KB for a 100-card deck. An MCP client cuts tool results off somewhere
around 40–100 KB, so the model read half a deck, or nothing. The response cap from earlier in
the phase (`capToolResponse`, in [cap-response.ts](../src/app/_llm-tools/cap-response.ts))
stopped the overflow, but it sliced the biggest array wherever the bytes ran out: half a board
on one page, and every other section repeated on the next.

## A2. Characters are not bytes

A limit on a network response is a limit on **bytes**. JavaScript strings count **UTF-16 code
units**, and UTF-8 (what goes over the wire) spends 1 to 4 bytes per character:

```ts
"Sol Ring".length; // 8
Buffer.byteLength("Sol Ring", "utf8"); // 8
"Avacyn — angel".length; // 14
Buffer.byteLength("Avacyn — angel", "utf8"); // 16: the em dash is 3 bytes
```

Python draws the same line: `len("—")` is 1, `len("—".encode("utf-8"))` is 3. So the budget
code measures `Buffer.byteLength(JSON.stringify(value), "utf8")`. `JSON.stringify` matters too:
quotes, escapes (`\n` is two bytes) and key names all count.

**Try it:** `node -e 'console.log("{T}: Add {G}.".length, Buffer.byteLength(JSON.stringify("Flying\n—")))'`

## A3. Shape is the biggest lever

Each card used to be an object:

```json
{
  "name": "Sol Ring",
  "oracleId": "6ad8011d-…",
  "printingId": "…",
  "board": "main",
  "quantity": 1,
  "tags": [],
  "owned": 1,
  "manaCost": "{1}",
  "manaValue": 1,
  "typeLine": "Artifact",
  "price": { "cents": 129, "text": "$1.29" }
}
```

Two UUIDs (36 bytes each), repeated key names, `manaValue` next to `manaCost`, and an empty
`tags` add up to 350–600 bytes **before** the rules text. A model reads a line just as well:

```text
1 Sol Ring · {1} · Artifact · ramp — {T}: Add {C}{C}.
```

[compact-deck.ts](../src/app/_llm-tools/compact-deck.ts) builds that line. Flags appear only
when they're true (`SHORT 1`, `GC`, `PINNED`), and the text drops what a reader doesn't need: the
card's own name becomes `~`, and reminder text in parentheses goes. Measured on deck 51, the
rules text was only 12 KB of the 98.6 KB. The structure around it was the problem, so the text
could stay.

The lesson in general: before cutting **content**, look at the **packaging**. Repeated keys and
identifiers are the cheapest bytes to lose, and the hardest for a reader to use anyway.

## A4. Pages that keep groups whole

`pageCompactGroups` walks the groups in order. It adds a whole group when it fits, stops at a
group boundary when the next one doesn't, and only splits a group that alone is bigger than a
page. The cursor is the index of the next **line** across all groups, so a page can resume in
the middle of a group that had to be split:

```ts
const groupBytes = bytes(title) + 2 + bytes(groupLines);
if (used + groupBytes <= budgetBytes) {
  cards[title] = groupLines; // the whole group fits
  used += groupBytes;
  index = groupEnd;
  continue;
}
if (Object.keys(cards).length > 0) break; // stop between groups
// otherwise this one group is too big: take as many lines as fit (at least one)
```

The header, stats and problems come only on page one. A page never repeats them, so two pages
together are never bigger than the deck.

---

# Part B: Refusals as data

## B1. A simulator that says no

The goldfish simulator once let a 6-mana card be cast on turn 0 with no lands. Its rules are now
**invariants** (things that are always true): no cast before you keep your hand or on turn 0,
and with `strict` on, no cast you can't pay for. Each broken rule is a **value**, not a thrown
exception, because a refused move is an expected answer, not a bug
([goldfish-session.ts](../src/modules/decks/domain/goldfish-session.ts)):

```ts
export type GoldfishError =
  | Readonly<{ kind: "CastNotAllowed"; reason: string }>
  | Readonly<{ kind: "InsufficientMana"; card: string; required: string; available: ManaPool }>
  | Readonly<{ kind: "LandLimitReached"; landsPlayedThisTurn: number }>;
// … and a few more
```

In Python you'd write a small `@dataclass` per error and `match` on its class. Here the `kind`
field does the job of the class.

## B2. Words for each refusal, checked by the compiler

The tool first sent `JSON.stringify(error)` as the message, so the model read
`"{\"kind\":\"InsufficientMana\",…}"`, JSON inside a string. `goldfishErrorText` in
[tools/decks.ts](../src/app/_llm-tools/tools/decks.ts) writes a sentence for each kind instead:

```ts
switch (error.kind) {
  case "CastNotAllowed":
    return error.reason;
  case "InsufficientMana": {
    // … "Can't pay {1}{G} for Heroic Intervention; the pool has nothing. Tap lands …"
  }
  // … one case per kind
  default:
    return assertNever(error);
}
```

Inside each `case`, TypeScript **narrows** `error` to that one member, so `error.required` is
only allowed under `"InsufficientMana"`. In `default`, every kind has been handled, so `error`
has type `never`. If someone adds a new error kind and forgets a case, `assertNever(error)` stops
compiling. That's the point: the type system lists the cases you still owe.

---

# Part C: Discounts as data

Henzie makes blitz cost {1} less for each time you've cast your commander. Goreclaw makes
creatures with power 4 or more cost {2} less. Rather than special-casing card names in the
simulator, the deck profile stores **cost reducers** as data:

```ts
export interface CostReducer {
  cardName: string;
  scope: "blitz" | "creature_power_gte_4" | "commander" | "all_spells";
  genericReduction: number;
  perCommandCast?: boolean;
}
```

`effectiveManaValue` in [deck-profile.ts](../src/modules/decks/domain/deck-profile.ts) adds up
the reducers whose scope matches the card, multiplies the per-cast ones, and never goes below
zero:

```ts
for (const reducer of profile.costReducers) {
  if (!matchesReducerScope(reducer.scope, card)) continue;
  const multiplier = reducer.perCommandCast ? Math.max(0, commandCasts) : 1;
  reduction += reducer.genericReduction * multiplier;
}
return Math.max(0, baseManaValue - reduction);
```

The pattern is the one from [lesson 09](09-rules-as-data.md): a union of named scopes plus a
function per scope beats an `if` per card, because adding a reducer is adding a row, and the
tests can feed it any profile.

---

# Part D: Colors are a matching problem

## D1. The bug

`simulate_opening_hands` answers "how often can I cast my commander by turn N?". For Henzie
({B}{R}{G}) it said 93% by turn 3. An earlier hand-written estimate said about 68%. The
simulator counted mana **sources** and compared the count with the mana value: three Forests are
three sources, so Henzie was "castable". The colors were never checked.

## D2. Why greedy isn't enough

Each colored pip needs its own source that can make that color. The obvious loop gives each pip
the first source that fits:

```text
pips:    B, G
sources: [B or G] (a dual land), [B only] (a Swamp)
greedy:  B ← dual land, then G ← … only the Swamp is left → fail
answer:  B ← Swamp, G ← dual land → castable
```

The greedy loop made a choice too early. This is **bipartite matching**: pips on one side,
sources on the other, an edge where a source can pay a pip, and the question is whether every
pip can get its own source.

## D3. Augmenting paths

The fix is to let a pip **take** a source from an earlier pip, if that earlier pip can move to
another source. `canPayColors` in [goldfish.ts](../src/modules/decks/domain/goldfish.ts):

```ts
function assign(pip: number, seen: boolean[]): boolean {
  for (let source = 0; source < sources.length; source++) {
    if (seen[source] || !(sources[source] ?? []).includes(pips[pip] ?? "")) continue;
    seen[source] = true;
    const holder = pipForSource[source] ?? -1;
    if (holder === -1 || assign(holder, seen)) {
      pipForSource[source] = pip; // take it (the old holder moved on)
      sourceForPip[pip] = source;
      return true;
    }
  }
  return false;
}
return pips.every((_, pip) =>
  assign(
    pip,
    sources.map(() => false),
  ),
);
```

`assign(holder, seen)` is the "can the earlier pip move?" question, asked recursively. `seen`
stops it from going round in circles. A commander has at most a handful of pips, so this tiny
version is plenty. For big graphs, Python has `networkx.bipartite.maximum_matching`.

With colors checked (and land drops picking the land that makes a missing color), Henzie by turn
3 is 73%, close to the independent estimate.

**Try it:** in `goldfish.test.ts`, `canPayColors(["B", "G"], [["B", "G"], ["B"]])` is `true`.
Swap the sources and it's still `true`: order no longer matters.

---

# Part E: The field the save forgets

## E1. The trap

Phase 61 added `role` and `pinned` columns to `deck_entries`, and a query
(`updateDeckEntryMetadata`) that wrote them straight to the table. Nothing called it, and it
was just as well. The deck repository saves a deck by **replacing** its entries
([lesson 23](23-replacing-a-list-and-ranking-copies.md)):

```ts
await db.delete(deckEntries).where(eq(deckEntries.deckId, deck.id));
await db.insert(deckEntries).values(deck.entries.map((entry) => ({ ...entry, deckId: deck.id })));
```

`deck.entries` comes from the domain type `DeckEntry`, which had no `role` or `pinned`. So the
very next edit to **any** card (a note, a count, a move) would re-insert every row with the
column defaults, and silently wipe every role and pin.

In Python terms: an ORM `session.merge()` of a dataclass that doesn't have the new column
writes the default back over it.

## E2. The fix

Put the fields where the save reads from: `DeckEntry` gets `role?` and `pinned?`; `withEntry`
keeps them unless a change sets them (left out keeps, `null` clears); the repository loads and
saves them; and `moveEntry` carries them when a card goes to the maybeboard and back. The
integration test proves the bug can't come back: set a role, then **edit a different card**,
then read the role.

The general rule: in a replace-all save, **the domain type is the schema**. A column the type
doesn't know about is a column the next save resets.

---

## Common mistakes

- **Budgeting with `.length`.** It counts UTF-16 units, not bytes. Measure what you send:
  `Buffer.byteLength(JSON.stringify(value), "utf8")`.
- **Trimming content before packaging.** Dropping rules text saved little; dropping repeated
  keys and IDs saved most. Measure each part first.
- **Paging by raw slices.** A page that ends mid-group, and repeats every other section, is
  harder to read than one big answer. Page on the boundaries the reader thinks in.
- **Throwing for expected refusals.** "You can't cast that yet" is an answer. Return it as a
  `Result` error and let the caller word it.
- **Sending error objects as text.** A model (or a person) reads a sentence better than
  serialized JSON.
- **Greedy assignment for a matching problem.** If an early choice can block a later one, you
  need augmenting paths (or a library), not a first-fit loop.
- **Writing a column around the domain.** With a replace-all repository, the next save undoes
  it. Add the field to the domain type instead.

## Exercises

### 1. Warm-up: characters vs bytes

What do these print? Work it out, then run it.

```ts
console.log("Ojer Kaslem // Temple".length);
console.log(Buffer.byteLength("Ojer Kaslem // Temple", "utf8"));
console.log("Avacyn — angel".length, Buffer.byteLength("Avacyn — angel", "utf8"));
```

_Hint:_ which characters are outside plain ASCII?

<details><summary>Solution</summary>

`21`, `21`, then `14 16`. The first string is all ASCII (1 byte each). The em dash `—` is one
UTF-16 unit but three UTF-8 bytes, so the second string is 2 bytes longer than its `.length`.

</details>

### 2. Left out keeps, null clears

Write `nextRole(change, existing)`: `change` is `undefined` (the field was left out), `null`
(clear it) or a string (set it, trimmed, and an empty string means clear). `existing` is the
current role or `undefined`.

```ts
nextRole(undefined, "Sac outlet"); // "Sac outlet"
nextRole(null, "Sac outlet"); // null
nextRole("  Draw engine ", undefined); // "Draw engine"
nextRole("   ", "Sac outlet"); // null
```

_Hint:_ check `undefined` first; `null` and `undefined` are different here.

<details><summary>Solution</summary>

```ts
function nextRole(
  change: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  if (change === undefined) return existing ?? null;
  if (change === null) return null;
  const trimmed = change.trim();
  return trimmed === "" ? null : trimmed;
}
```

This is the rule `withEntry` follows for `role` (through `tidyRole`, which also squeezes inner
spaces and caps the length).

</details>

### 3. Break the greedy loop

Here is the first-fit version from Part D2:

```ts
function greedyPay(pips: string[], sources: string[][]): boolean {
  const used = new Set<number>();
  return pips.every((pip) => {
    const index = sources.findIndex((colors, i) => !used.has(i) && colors.includes(pip));
    if (index === -1) return false;
    used.add(index);
    return true;
  });
}
```

Find pips and sources where `greedyPay` says `false` but `canPayColors` says `true`. Then
find a case where both say `false` even though there are as many sources as pips.

_Hint:_ give the first pip a choice it shouldn't take.

<details><summary>Solution</summary>

```ts
greedyPay(["B", "G"], [["B", "G"], ["B"]]); // false: B took the dual land
canPayColors(["B", "G"], [["B", "G"], ["B"]]); // true: B ← Swamp, G ← dual land

greedyPay(["B", "R"], [["B"], ["B"]]); // false
canPayColors(["B", "R"], [["B"], ["B"]]); // false: nothing makes R
```

Two sources for two pips isn't enough; each pip needs a source **of its color**.

</details>

### 4. Challenge: a case the compiler asks for

Add `| Readonly<{ kind: "SummoningSick"; card: string }>` to a copy of `GoldfishError` and run
`pnpm typecheck` with `goldfishErrorText` unchanged. What does TypeScript report, where, and
why? Then add the missing case.

_Hint:_ look at the `default:` branch.

<details><summary>Solution</summary>

TypeScript reports, at `return assertNever(error);`, that an argument of type
`{ kind: "SummoningSick"; card: string }` is not assignable to a parameter of type `never`.
Every other kind was narrowed away by its `case`, so the new one is all that's left in
`default`, and `assertNever` only accepts `never`. The fix is one more case:

```ts
case "SummoningSick":
  return `${error.card} can't tap for mana the turn it came in.`;
```

</details>

## Recap

- Limits on responses are in **bytes**; measure the serialized JSON with `Buffer.byteLength`.
- Change the **shape** before cutting content: one readable line per item, flags only when
  true, no IDs unless asked.
- Page by the reader's **groups**, send shared sections once, and resume from a cursor.
- Model refusals as a **union of errors**, word them with an exhaustive `switch`, and let
  `assertNever` list the cases you missed.
- Store rules like **discounts as data** and apply them with one small pure function.
- "Which source pays which pip" is **bipartite matching**: first-fit can fail, augmenting paths
  don't.
- In a replace-all save, **the domain type is the schema**: a field it doesn't carry is reset by
  the next save.

## Further reading

- [Design doc 61](../docs/design/61-mcp-commander-awareness-and-primers.md), especially section
  5a (the compact `get_deck`)
- [Lesson 23](23-replacing-a-list-and-ranking-copies.md): replace vs add, all-or-nothing saves
- [Lesson 28](28-tools-for-a-model.md): tools written for a model to read
- "Matching (graph theory)" and "Hopcroft–Karp algorithm" on Wikipedia, for the faster version
  of augmenting paths
