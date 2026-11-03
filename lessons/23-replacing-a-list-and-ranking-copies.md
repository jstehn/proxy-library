# Lesson 23: Replacing a list, and ranking what you own

- **Phase:** 23 (edit a deck as text, and use your most special copy)
- **Prerequisites:** [Lesson 09](09-rules-as-data.md) (parsing text with regular expressions,
  round-trip tests), [Lesson 15](15-one-language-many-pages.md) (optimistic concurrency),
  [Lesson 20](20-suggesting-cards.md) (comparator chains)
- **Time:** 1½ hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Decide whether a line of text is a **heading or data** when both look alike, and build the
   regular expressions from shared parts with `String.raw` and `new RegExp`.
2. Say why **replace** is idempotent and **add** isn't, and which one a "save this text" button
   needs.
3. Write a **property test** for a round trip (format → parse → apply = unchanged) with
   fast-check, and use it to find the cases a hand-written example misses.
4. Detect a stale form with a **fingerprint** of the content instead of a version column, and
   compute one with FNV-1a (`Math.imul`, `>>> 0`).
5. Write a **ranking** as an SQL `ORDER BY` list (`desc nulls last`, `CASE` ranks), and keep
   one definition shared by every query that needs it.
6. Build a form that **keeps its input** after a failed save, with `useActionState` and a
   controlled text box.

---

# Part A: Text that doesn't say what it is

## A1. Heading or card?

Deck sites export lists in groups. Archidekt writes:

```
Commander (1)
1 Jolene, the Plunder Queen

Lands (36)
1 Cinder Glade
7 Forest

Ramp & Mana Fixers (9)
1 Arcane Signet
```

To a person, "Lands (36)" is obviously a heading. To the list reader from lesson 09 it was a
card line: no quantity (so 1), the name "Lands (36)". The reader then asked the catalog for a
card called "Lands (36)", found none, and reported it. "Commander (1)" was worse: the reader
knew the heading `Commander` but not `Commander (1)`, so Jolene went on the **main** board.

When two kinds of line share a shape, you need a rule that tells them apart **from the text
alone**. Here's what distinguishes them:

| Line                     | Starts with a quantity? | Ends with `(digits)`? | What it is |
| ------------------------ | ----------------------- | --------------------- | ---------- |
| `1 Sol Ring (C21) 263`   | yes                     | no                    | a card     |
| `Lightning Bolt`         | no                      | no                    | a card     |
| `2 Opt (XLN)`            | yes                     | no (letters)          | a card     |
| `Lands (36)`             | no                      | yes                   | a heading  |
| `Ramp & Mana Fixers (9)` | no                      | yes                   | a heading  |

No real card name ends in a number in brackets, so "no leading quantity, ends in `(digits)`"
is safe. When you pick a rule like this, write down **why it can't misfire** (here: no card
name has that shape). If you can't, the rule is a guess.

A Python version:

```python
import re
CATEGORY = re.compile(r"^[^\d\s].*\s\(\d+\)$")
CATEGORY.match("Lands (36)")          # match
CATEGORY.match("1 Sol Ring (C21) 263") # None: starts with a digit
```

## A2. Building patterns from parts

The known headings now take an optional count too: `Sideboard`, `Sideboard:` and
`Sideboard (15)`. Rather than writing that ending four times, the reader builds each pattern
from a shared piece:

```ts
// src/shared/card-search/list.ts
const COUNT = String.raw`\s*(?::|\(\d+\))?\s*$`;
const HEADERS: ReadonlyArray<[RegExp, ListSection | "skip"]> = [
  [new RegExp(String.raw`^(commander|commanders)` + COUNT, "i"), "commander"],
  [new RegExp(String.raw`^(deck|main|mainboard|main deck)` + COUNT, "i"), "main"],
  [new RegExp(String.raw`^(sideboard|side|sb)` + COUNT, "i"), "side"],
  [new RegExp(String.raw`^(maybeboard|maybe|considering)` + COUNT, "i"), "skip"],
];
```

Line by line:

- `` String.raw`…` `` is a **raw string**: backslashes stay as typed, like Python's `r"…"`.
  Without it, `"\s"` in a normal string literal is just `"s"`, and the pattern silently changes.
- `new RegExp(source, "i")` turns a string into a pattern, like `re.compile(source, re.I)`. A
  `/…/i` literal can't be glued together from parts; `new RegExp` can.
- `(?::|\(\d+\))?` means "optionally, a colon or a count in brackets". `(?:…)` is a group that
  doesn't capture, the same as in Python.
- `"skip"` is a section the app has no board for yet (a maybeboard). Its lines are left out
  rather than mixed into the main deck.

The reader checks the known headings first and the category rule second, so
`Sideboard (15)` goes to the sideboard and not to "main":

```ts
const header = HEADERS.find(([pattern]) => pattern.test(line));
if (header !== undefined) {
  board = header[1];
  continue;
}
if (CATEGORY.test(line)) {
  board = "main";
  continue;
}
if (board === "skip") continue;
// TypeScript narrowed `board` after the check above: here it can't be "skip".
let lineBoard: ListSection = board;
```

That last line shows **narrowing** again (lesson 01): after `if (board === "skip") continue;`,
TypeScript knows `board` is one of the other values, so it fits a `ListSection`.

**Try it:** `pnpm vitest run src/shared/card-search/list.test.ts`. The test
"reads a whole category-grouped Commander list" reads a real 100-card list from
`tests/fixtures/lists/` and checks it comes out as 1 commander and 99 cards.

---

# Part B: Replace, not add

## B1. Two buttons, two meanings

The deck page already had **Paste a list → Add these cards**. Pasting `4 Lightning Bolt` into a
deck with 2 bolts gives 6. That's right for "add these". But the new box holds the **whole**
list, and the player edits it. If they change `4` to `3` and press Save, they mean "3", not
"7".

An operation is **idempotent** if doing it twice is the same as doing it once:

| Operation               | Once  | Twice  | Idempotent? |
| ----------------------- | ----- | ------ | ----------- |
| Add "4 Lightning Bolt"  | 2 → 6 | 6 → 10 | no          |
| Replace with "3 Bolt"   | 2 → 3 | 3 → 3  | yes         |
| Python `set.add(x)`     |       |        | yes         |
| Python `list.append(x)` |       |        | no          |

A save button should be idempotent. A double click, or a retry after a timeout, then can't
double the deck. That's why the new use case is a **different function**, `replaceList`, rather
than a flag on `importList`.

## B2. What "replace" keeps

Replacing doesn't mean forgetting everything. The text usually says `1 Sol Ring` with no
printing, and the deck had a foil Commander 2021 Sol Ring pinned. Losing that pin on every save
would be a nasty surprise. So replacing has rules about what it keeps:

```ts
// src/modules/decks/domain/deck.ts
function chosenVersion(current: readonly DeckEntry[], line: MatchedLine): DeckEntry {
  // The same card on the same board first, then the same card on any board.
  const existing =
    current.find((entry) => entry.oracleId === line.oracleId && entry.board === line.board) ??
    current.find((entry) => entry.oracleId === line.oracleId);
  const base = { oracleId: line.oracleId, board: line.board, quantity: line.quantity };

  if (existing !== undefined && (!line.namesPrinting || existing.printingId === line.printingId)) {
    return {
      ...base,
      printingId: existing.printingId,
      finish: line.finishMarker ?? existing.finish,
    };
  }
  return { ...base, printingId: line.printingId, finish: line.finishMarker ?? line.finish };
}
```

- `a ?? b` is "a unless it's null or undefined, else b" (lesson 06). It's chained here: same
  board, else any board.
- A card already in the deck keeps its printing, unless the line **names** a different one.
- A finish marker (`*F*`, `*E*`) always wins.
- A card new to the deck takes what the catalog chose (Part E).

`replacedEntries` puts lines into a `Map` keyed by `"board:card"`, so two lines for one card add
up. A `Map` remembers insertion order, as a Python `dict` does since 3.7, so the deck comes out
in the order of the text.

## B3. All or nothing

If one line out of a hundred names a card the catalog doesn't have, should the other 99 be
saved? With **add**, saving 99 is harmless: the missing card was never in the deck. With
**replace**, saving 99 **deletes** a card the player meant to keep. So `replaceList` checks
every line first, and if any has a problem it returns `ListProblems` with all of them and
writes nothing. The rule is: the more an operation can destroy, the stricter its checks before
it starts.

---

# Part C: The round trip, tested by a machine

## C1. The promise

The box starts filled with the deck's text. Saving that text unchanged must leave the deck
exactly as it was: same cards, boards, quantities, printings and finishes. Lesson 09 tested a
round trip with a few hand-written examples. This one has too many combinations for that:
pinned or not, foil or not, three boards, duplicates.

## C2. Let fast-check write the examples

A **property-based test** describes the inputs and states a property that must hold for all of
them. The library generates hundreds of inputs and, when one fails, **shrinks** it to the
smallest failing case. Python's equivalent is Hypothesis.

```ts
// src/modules/decks/domain/deck-text.test.ts (shortened)
const entry = fc.record({
  card: fc.integer({ min: 1, max: 30 }),
  board: fc.constantFrom(...BOARDS),
  quantity: fc.integer({ min: 1, max: 99 }),
  printing: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
  finish: fc.option(fc.constantFrom(...FINISHES), { nil: null }),
});
// One entry per card per board, as a deck has.
const deck = fc.uniqueArray(entry, {
  selector: (generated) => `${generated.board}:${generated.card}`,
});

fc.assert(
  fc.property(deck, (generated) => {
    // entries → deckText → parseList → match back → replacedEntries
    expect(sorted(replacedEntries(entries, lines))).toEqual(sorted(entries));
  }),
);
```

- `fc.record({...})` builds objects from a generator per field, like Hypothesis's
  `st.fixed_dictionaries`.
- `fc.option(x, { nil: null })` gives `x` or `null`.
- `fc.uniqueArray(..., { selector })` makes arrays with no two items sharing a key, because a
  real deck never has two lines for one card on one board.

Stating the property changed the design before any code ran. The obvious `deckText` writes the
**shown** printing for every card. But for a card nobody has pinned, the text would then say
`(BLB) 2`, and saving it would pin that printing. The deck would change though the text hadn't.
So the text names a printing **only when one is pinned**, and the property test keeps that
decision true.

A test of the whole path then caught a real bug that the unit tests couldn't. The integration
test fills the box the way the deck page does and saves it. The deck page's read model,
`deckView`, returned entries with `printingId: null` for every card (read models don't make
`PrintingId` brands; only the edges do). So the fingerprint (Part D) never matched the one from
the locked deck, and every save would have said "the deck changed". The fix gave each deck
line its stored `pinnedPrintingId` and `pinnedFinish`, and made `fingerprint` take plain
strings, so the page and the use case fingerprint the same thing.

---

# Part D: Did it change while I was typing?

## D1. The problem

You open the box, then add a card in the builder in another tab, then come back and save the
text. The text doesn't have the new card, so replacing would delete it. Lesson 15 solved this
for the shopping list with **optimistic concurrency**: the form sends what it was based on, and
the server refuses a save when that's out of date.

Lesson 15 compared a quote. Here we need a summary of the whole deck. A version column would
work, but every write to a deck would have to bump it, and a forgotten bump is a silent bug.
Instead the server computes a **fingerprint**: a short value derived from the content itself.
If the content is the same, so is the fingerprint, and no other code has to remember anything.

```ts
// src/modules/decks/domain/list-format.ts
export function fingerprint(entries: readonly DeckEntry[]): string {
  const canonical = entries
    .map((entry) =>
      [
        entry.board,
        entry.oracleId,
        entry.quantity,
        entry.printingId ?? "",
        entry.finish ?? "",
      ].join("|"),
    )
    .sort()
    .join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index++) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${entries.length}`;
}
```

- **Canonical form** first: each entry as one line, then `.sort()`. The order rows come back
  from the database doesn't change the result.
- **FNV-1a** is a tiny, well-known hash: for each character, XOR it in, then multiply by a fixed
  prime. It isn't cryptographic, and doesn't need to be: we only need to notice a change in the
  player's own deck.
- `Math.imul(a, b)` multiplies as **32-bit integers**. Plain `*` in JavaScript works on 64-bit
  floats: the product gets too large, loses its low bits, and the hash is wrong (exercise 2).
  Python's ints never overflow, so in Python you'd write `(h * prime) & 0xFFFFFFFF`.
- `hash >>> 0` reads the 32 bits as an **unsigned** number. JavaScript's bit operators give
  signed results, so without it half the hashes would print with a minus sign.

The check runs **inside** the transaction, after `lockOwned` has locked the deck's row. Nothing
can change the deck between the check and the save (lesson 07's lock, check, change).

---

# Part E: Your most special copy

## E1. A ranking is a comparator chain

When you add a card you own, which of your copies should the deck show? The player asked for
the most valuable or special one. Written as rules, most important first:

1. the higher price (priced in that finish, so a foil is priced as a foil);
2. etched, then foil, then nonfoil;
3. borderless, full art, showcase or extended art, a promo, then plain;
4. then the copy you hold most of, the newest set, and the id, so ties always break the same way.

That's a **comparator chain** (lesson 20): compare by the first rule, and only on a tie look at
the next. Python writes it as a tuple sort key: `sorted(copies, key=lambda c: (-price, rank,
...))`. In SQL it's an `ORDER BY` list:

```ts
// src/modules/decks/queries/owned.ts
export const MOST_SPECIAL_FIRST = sql`
  (select s.usd_cents from price_snapshots s
    where s.printing_id = c.printing_id and s.finish = c.finish
    order by s.day desc limit 1) desc nulls last,
  case c.finish when 'etched' then 0 when 'foil' then 1 else 2 end,
  case when p.border_color = 'borderless' then 0
       when p.is_full_art then 1
       when p.frame_effects && array['showcase', 'extendedart']::text[] then 2
       when cardinality(p.promo_types) > 0 then 3
       else 4 end,
  c.quantity desc,
  (select cs.release_date from card_sets cs where cs.code = p.set_code) desc nulls last,
  c.printing_id`;
```

- `desc nulls last`: Postgres puts nulls **first** in a descending sort by default, so an
  unpriced card would beat every priced one. Always say where nulls go.
- `case … then 0 … else 4 end` turns categories into numbers that sort. It's a lookup table in
  SQL.
- `&&` is array overlap ("do these share any element?"), from lesson 20.
- The final `c.printing_id` is a **tiebreaker** that makes the order total. Without it, two
  equal copies could come back in either order, and the deck view and the builder could
  disagree.

## E2. One definition, three users

Three places pick which copy a deck line shows: a pasted list (`resolve`, in infrastructure),
the builder's grid (`browseCollection`, in queries) and the deck view (`deckView`, in queries).
Each used to have its own "the copy you hold the most of". If only one of them changed, a card
could be shown as a foil in the grid and then pinned as nonfoil when you clicked Add.

So the ranking is written **once**, as an SQL fragment, and all three import it. The lint rules
(ADR 0009) didn't let infrastructure import from queries, so this phase adds one narrow
exception, with its reason:

```js
// eslint.config.mjs
// Design doc 23: which copies are yours, and which is most special, are one SQL definition
// shared by the read side and the decks' card lookup, so a pasted list and the builder agree.
layer("queries", { sameModule: true, file: "owned.ts" }),
```

Make an exception to an architecture rule as narrow as you can: one file, one module, and a
comment saying why. Then the next reader knows it was a decision, not an accident.

The integration test checks that all three agree, on purpose:

```ts
// tests/integration/decks.int.test.ts
expect(await picks(BEZA)).toEqual(everywhere(plain, "nonfoil"));
// everywhere(id, finish) = { resolved: [id, finish], deckView: [id, finish], grid: [id, finish] }
```

---

# Part F: A form that keeps what you typed

The old Paste form redirected to `?error=…`, and the page came back with an empty box. For one
line that's fine. For a 100-line list with one typo, it's unacceptable.

React's `useActionState` runs a server action and gives the component its result:

```tsx
// src/app/decks/[id]/edit-as-text.tsx
const [state, formAction, pending] = useActionState(replaceListAction, initialState);
// Controlled, so the text survives a save that fails: React resets uncontrolled form fields
// after an action runs.
const [list, setList] = useState(text);
...
<textarea name="list" value={list} onChange={(event) => setList(event.target.value)} />
```

- The action's signature gains a first parameter, the previous state:
  `replaceListAction(previous, formData)`. It **returns** the error to show. On success it
  redirects, as before.
- `pending` is true while the save runs, so the button can say "Saving…".
- A **controlled** field gets its value from React state (`value={list}`). An **uncontrolled**
  one keeps its own value in the browser (`defaultValue`). React 19 resets uncontrolled fields
  after a form action, so only the controlled one survives a failed save.
- The component is rendered with `key={fingerprint}`. When a save succeeds, the deck and its
  fingerprint change, React sees a new key, and the box starts again from the saved text.

---

## Common mistakes

- **Guessing what a line is.** "If it isn't found, it's probably a heading" turns typos into
  silently skipped cards. Recognise headings by a rule you can justify, and report everything
  else.
- **Reusing "add" for "save".** If a save isn't idempotent, double clicks and retries double
  the data.
- **Saving part of a destructive change.** When an operation removes things, check every input
  before you write anything.
- **A round trip that writes more than it read.** If the text shows derived values (the shown
  printing) as if they were stored ones (a pinned printing), saving turns guesses into facts.
- **Plain `*` in a 32-bit hash.** JavaScript numbers are floats. Use `Math.imul` and `>>> 0`.
- **Forgetting where nulls sort.** `order by price desc` puts unpriced rows first in Postgres.
- **The same rule in three queries.** They'll drift. Write one fragment and share it.
- **`defaultValue` on a form that can fail.** The field is reset after the action. Control it.

## Exercises

### 1. Warm-up: predict the boards

What does `parseList` give for this text? Which line is not what it looks like?

```
Commanders (1)
1 Ruby, Daring Tracker
Creatures (2)
2 Llanowar Elves
Lands
1 Forest
Sideboard:
1 Anger
```

<details><summary>Solution</summary>

| Name                 | Board       |
| -------------------- | ----------- |
| Ruby, Daring Tracker | `commander` |
| Llanowar Elves       | `main`      |
| Lands                | `main`      |
| Forest               | `main`      |
| Anger                | `side`      |

`Lands` has no count, so it doesn't match the category rule. It's read as **a card named
"Lands"**, and saving would report "Not in the catalog: Lands". That's the right outcome: the
reader doesn't guess, and the player sees the problem.

</details>

### 2. FNV-1a by hand

Write `fnv1a(text: string): string` (8 hex digits) and check it against the published test
vectors: `""` → `811c9dc5`, `"a"` → `e40c292c`, `"foobar"` → `bf9cf968`. Then replace
`Math.imul(hash, 0x01000193)` with `hash * 0x01000193` and see which vector breaks.

<details><summary>Solution</summary>

```ts
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
```

With plain `*`, `""` still passes (there's no multiplication), but `"foobar"` doesn't. The
product grows past 2⁵³, the float can't hold its low bits exactly, and the XOR on the next
character works on wrong bits.

</details>

### 3. The ranking in TypeScript

Write a comparator `mostSpecialFirst(a, b)` for
`{ priceCents: number | null; finish: "nonfoil" | "foil" | "etched"; quantity: number }`:
price highest first with nulls last, then etched / foil / nonfoil, then quantity highest first.
Sort these four copies: unpriced foil ×1, $2 nonfoil ×4, $2 foil ×1, $40 nonfoil ×1.

<details><summary>Solution</summary>

```ts
const FINISH_RANK = { etched: 0, foil: 1, nonfoil: 2 } as const;
function mostSpecialFirst(a: Copy, b: Copy): number {
  if (a.priceCents !== b.priceCents) {
    if (a.priceCents === null) return 1; // nulls last
    if (b.priceCents === null) return -1;
    return b.priceCents - a.priceCents; // highest first
  }
  if (a.finish !== b.finish) return FINISH_RANK[a.finish] - FINISH_RANK[b.finish];
  return b.quantity - a.quantity;
}
```

Order: $40 nonfoil, $2 foil, $2 nonfoil ×4, unpriced foil. The unpriced foil comes last even
though it's a foil, because price is the first rule. Swap the first two `if` blocks and the
foils come first instead. That was a real decision in design doc 23 (price first).

</details>

### 4. Challenge: prove replace is idempotent

Write a fast-check property: for any starting deck and any list of matched lines,
`replacedEntries(replacedEntries(start, list), list)` equals `replacedEntries(start, list)`.
Then show with one example that adding with `withEntry` (old quantity + 4) is not idempotent.

<details><summary>Solution</summary>

```ts
const line = fc.record({
  card: fc.integer({ min: 1, max: 10 }),
  board: fc.constantFrom(...BOARDS),
  quantity: fc.integer({ min: 1, max: 99 }),
});
function toMatched(generated: { card: number; board: Board; quantity: number }): MatchedLine {
  return {
    oracleId: `oracle-${generated.card}`,
    board: generated.board,
    quantity: generated.quantity,
    printingId: samplePrintingId(`p-${generated.card}`),
    finish: "nonfoil",
    namesPrinting: false,
    finishMarker: null,
  };
}

fc.assert(
  fc.property(fc.array(line), fc.array(line), (before, list) => {
    const start = replacedEntries([], before.map(toMatched));
    const once = replacedEntries(start, list.map(toMatched));
    expect(replacedEntries(once, list.map(toMatched))).toEqual(once);
  }),
);

// Adding: once gives 4, twice gives 8.
const add = (current: Deck) =>
  withEntry(current, {
    oracleId: "bolt",
    board: "main",
    quantity: (current.entries[0]?.quantity ?? 0) + 4,
  });
```

It holds because the second replace finds every card already in the deck with the printing the
first one chose, and keeps it.

</details>

## Recap

- When two kinds of line look alike, tell them apart with a rule you can justify from the
  data ("no card name ends in `(digits)`"), and report what matches neither.
- `String.raw` + `new RegExp` build patterns from shared parts, like `r"..."` + `re.compile`.
- A save should be **idempotent**: replace, not add. A destructive save checks everything
  before writing anything.
- A **property test** states the promise (the round trip leaves the deck unchanged), and the
  library finds the inputs that break it.
- A **fingerprint** of the content detects a stale form without a version column. FNV-1a in
  JavaScript needs `Math.imul` and `>>> 0`.
- A ranking is a comparator chain. In SQL: an `ORDER BY` list with `nulls last`, `CASE` ranks
  and a final tiebreaker. Define it once and share it.
- `useActionState` plus a controlled field keeps the user's text when a save fails.

## Further reading

- [Design doc 23](../docs/design/23-edit-deck-as-text.md): the decisions, including price
  before foil.
- [ADR 0009](../docs/adr/) (lint-enforced boundaries) and ADR 0017 (the shared card-search
  library).
- fast-check: [Arbitraries](https://fast-check.dev/docs/core-blocks/arbitraries/), and
  Hypothesis for the Python side.
- [FNV hash](http://www.isthe.com/chongo/tech/comp/fnv/) by its authors, with test vectors.
- React: [`useActionState`](https://react.dev/reference/react/useActionState); Next.js's forms
  guide in `node_modules/next/dist/docs/01-app/02-guides/forms.md`.
