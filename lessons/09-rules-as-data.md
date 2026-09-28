# Lesson 09: Rules as data, text as input

- **Phase:** 9 (deck builder)
- **Prerequisites:** [Lesson 05](05-randomness-you-can-trust.md) (strategy tables),
  [Lesson 07](07-reading-data-and-keeping-books.md) (SQL read models)
- **Time:** 2 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Derive a **union type from a constant list** (`(typeof LIST)[number]`), so the type, the
   runtime list and the validation all come from one place.
2. Express business rules as a **table of data** plus one pure function, and let the compiler
   point at everything a new rule needs.
3. Return **problems as data** instead of refusing, and say when each approach fits.
4. Parse messy **text input** with a regular expression, reporting what couldn't be read.
5. Write **round-trip tests** (export, then parse, then compare).
6. Use **CTEs** and **lateral joins** to compute per-row facts in SQL.
7. Keep **two implementations of one rule** honest by testing them against the same data.
8. Lay out a page in **physical units** for printing.

---

# Part A: Rules as data

## A1. One list, three uses

The deck builder needs the list of formats in three places: a **type** (so code can't use
`"moderm"`), a **runtime list** (for the `<select>` and for checking form input), and a **database
check**. Writing the list three times invites drift. From
[`deck.ts`](../src/modules/decks/domain/deck.ts):

```ts
export const FORMATS = [
  "casual",
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "pauper",
  "commander",
] as const;
export type Format = (typeof FORMATS)[number];
```

Read the second line from the inside out:

- **`typeof FORMATS`**: the _type_ of the constant. Thanks to `as const` (lesson 07) that's
  `readonly ["casual", "standard", …]`, a tuple of exact strings.
- **`[number]`**: "the type you get by indexing it with any number", which is the union of its
  elements: `"casual" | "standard" | … | "commander"`.

Python gets the same thing with `Format = Literal["casual", "standard", …]` plus
`get_args(Format)` for the runtime list. Here the runtime list comes first and the type is derived
from it. The same list feeds Zod (`z.enum(FORMATS)`) when a form or a database row is parsed.

## A2. A table of rules

Formats differ in a handful of numbers: 60 cards or exactly 100, four copies or one, a 15-card
sideboard or none. Instead of an `if` per format, the builder keeps one **table**. From
[`rules.ts`](../src/modules/decks/domain/rules.ts):

```ts
type FormatRules =
  | { kind: "casual" }
  | { kind: "constructed"; minimum: number; sideboard: number; copies: number }
  | { kind: "commander"; size: number };

const FORMAT_RULES: Record<Format, FormatRules> = {
  casual: { kind: "casual" },
  standard: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  modern: { kind: "constructed", minimum: 60, sideboard: 15, copies: 4 },
  // …
  commander: { kind: "commander", size: 100 },
};
```

The function `deckProblems` switches on `kind`, not on the format's name. Adding Pioneer was one
line. Adding Brawl (a 60-card Commander variant) is one line too, `brawl: { kind: "commander", size: 60 }`,
because it's the same kind of rules with a different number. This is lesson 05's Strategy idea
applied to **data** instead of functions.

`Record<Format, FormatRules>` also means the compiler **refuses** a format with no rules. When I
tried adding `"brawl"` to `FORMATS` for exercise 2, the next typecheck said:

```
src/app/decks/labels.ts: Property 'brawl' is missing in type '{ casual: string; … }'
but required in type 'Record<…, string>'.
```

It pointed at the label table too, one of the other places a new format needs. Structural typing
did the checklist.

## A3. Report, don't refuse

Most use cases so far **refused** bad input: `err(InsufficientFunds)`, and nothing happened. The
deck builder does the opposite. You can save a Commander deck with 99 cards, or with a card you
don't own. `deckProblems` returns a **list of problems as data**:

```ts
type DeckProblem =
  | { kind: "Short"; oracleId: string; name: string; needed: number; owned: number }
  | { kind: "WrongSize"; required: number; count: number }
  | { kind: "NotLegal"; name: string; status: string };
// …
```

Which approach fits depends on **what the state means**:

- Money leaving a wallet is a **transaction**. An invalid one must never exist, so refuse.
- A deck is a **work in progress**, like a half-built deck on your table. Blocking every step
  until it's legal would make building impossible. So allow, and report.

The page turns each problem into a sentence (`problemText`, with a `switch` ending in
`assertNever`), and the deck list shows a "short 3" badge. That badge is how a sale or a trade
that leaves a deck short gets noticed. It's recomputed every time the list is shown, never
stored, so it can't go stale.

---

# Part B: Text in and out

## B1. Parsing a pasted list

Players paste lists from Moxfield, Arena, forums… in slightly different styles:

```
4 Lightning Bolt
2x Counterspell
1 Sol Ring (C21) 263
Sideboard
SB: 1 Negate
```

One regular expression handles a line. From
[`list-format.ts`](../src/modules/decks/domain/list-format.ts):

```ts
const LINE = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,8})\)(?:\s+(\S+))?)?$/;
```

Piece by piece:

| Part                              | Means                                                                 |
| --------------------------------- | --------------------------------------------------------------------- |
| `^` … `$`                         | the whole line, nothing left over                                     |
| `(?:(\d+)\s*x?\s+)?`              | optionally: a number (captured as group 1), maybe an "x", then spaces |
| `(.+?)`                           | the name (group 2). `+?` is **lazy**: as short as possible            |
| `(?:\s+\(([A-Za-z0-9]{2,8})\)…)?` | optionally: a set code in parentheses (group 3)…                      |
| `(?:\s+(\S+))?`                   | …optionally followed by a collector number (group 4)                  |

`(?: … )` groups **without capturing** (only for the `?` after it). The lazy `+?` matters: a greedy
`.+` would swallow "Sol Ring (C21) 263" whole as the name. Lazy, it stops as soon as the rest can
match. It's the same syntax as Python's `re`, so you can test patterns in either.

Lines that don't fit, like "0 Nothing" or a 500-copy line, go into `unreadable` and are shown to
the player. That's lesson 04's "parse, don't validate": text becomes a typed `ListLine`, or an
explicit "couldn't read this", never a guess.

## B2. Round-trip tests

The exporters are a strategy table (lesson 05) of functions `(lines) → string`. The best test for
a writer and a reader that belong together is a **round trip**: write it out, read it back, and
check nothing changed:

```ts
const text = EXPORTERS.printings(lines);
expect(parseList(text).lines.map((line) => [line.quantity, line.name, line.board])).toEqual([
  [1, "Ruby", "commander"],
  [4, "Lightning Bolt", "main"],
  [2, "Duress", "side"],
]);
```

If someone later changes the export format ("Main" instead of "Deck"), this fails unless the parser
learns it too.

## B3. Why a `for` loop instead of `forEach`

`importList` first had `parsed.lines.forEach((line) => { … deck … })`, and TypeScript complained
that `deck` might be `null`, even after an `if (deck === null) return` above it. **Narrowing
doesn't reach inside callbacks**: the compiler can't know when a callback runs, so it forgets
what it learned. A plain loop keeps the narrowing:

```ts
for (const [index, line] of parsed.lines.entries()) { … } // entries(): Python's enumerate()
```

Rule of thumb: use `map` and `filter` for pure transformations, and a `for … of` loop when the
body updates variables or returns early.

---

# Part C: SQL, twice

## C1. CTEs and lateral joins

The deck list shows, for **every** deck, how many cards it's short. Computing that in TypeScript
would load every deck and the whole collection, so it's one SQL query instead. From
[`decks/queries/decks.ts`](../src/modules/decks/queries/decks.ts), simplified:

```sql
with owned as (            -- a CTE: a named query to use below
  select p.oracle_id, sum(c.quantity) as quantity
    from collection_cards c join printings p on p.id = c.printing_id
   where c.user_id = $1
   group by p.oracle_id
),
needs as (
  select e.deck_id, e.oracle_id, sum(e.quantity) as quantity
    from deck_entries e join decks d on d.id = e.deck_id
   where d.owner_id = $1
   group by e.deck_id, e.oracle_id
)
select d.id, d.name,
       (select sum(greatest(0, n.quantity - coalesce(o.quantity, 0)))
          from needs n left join owned o on o.oracle_id = n.oracle_id
         where n.deck_id = d.id) as short
  from decks d where d.owner_id = $1;
```

A **CTE** (`with name as (…)`) names a sub-result, like assigning an intermediate DataFrame to a
variable. `greatest(0, …)` stops owning extra copies of one card from making up for missing
another.

The builder uses **lateral joins**: `join lateral (select … limit 1) as shown on true` runs a small
query **per row** that can refer to that row's columns ("for this entry, the printing to show: the
pinned one, else one I own, else the newest"). It's the join version of lesson 07's correlated
subquery, and it can return several columns.

## C2. Two implementations of one rule

"Short" is worked out **twice**: in SQL for the list (fast for many decks), and by the pure
`deckProblems` in the builder (clear, and unit-tested rule by rule). Two implementations of one
rule will drift apart unless something checks them against each other. The integration test
[`decks.int.test.ts`](../tests/integration/decks.int.test.ts) buys and sells copies and checks
that the SQL's count moves, and that the domain function agrees on the same data. When you can't
avoid duplicating a rule, **test the copies against each other**.

---

# Part D: Printing on paper

The proxy sheet puts every card at its real size, 63 × 88 millimetres, nine to a page. CSS has
physical units, so Tailwind's arbitrary values can use them directly:

```tsx
<div className="grid grid-cols-[repeat(3,63mm)] gap-[1mm] print:gap-0">
  <img className="h-[88mm] w-[63mm] break-inside-avoid object-cover" … />
</div>
```

- **`mm`** is a real millimetre when printed at 100% scale ("actual size" in the print dialog).
- **`print:`** styles apply only when printing: the header disappears (`print:hidden`) and the gaps
  close.
- **`break-inside-avoid`** stops a page break from cutting a card in half.

It uses the large image size (672 × 936) so the text is sharp on paper. The same lesson as the
opener: readability depends on pixels at the size something is shown.

---

## Common mistakes

| Mistake                                             | Why it happens                       | Instead                                                            |
| --------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| A union type and a separate list of the same values | they were written at different times | `const LIST = [...] as const` and `(typeof LIST)[number]`          |
| One `if` per format                                 | it's quick for the first two         | a `Record` of rule data plus a switch on the rule's kind           |
| Refusing work-in-progress states                    | refusing felt safe for money         | report problems as data when the state is allowed to be incomplete |
| Guessing at unreadable input                        | "close enough" matching              | return it as unreadable and show it                                |
| Greedy `.+` in a pattern with optional tails        | `+` is the default                   | lazy `+?` when later parts are optional                            |
| `forEach` with early exits or reassigned variables  | it looks functional                  | `for … of` (with `.entries()` for the index)                       |
| Duplicated rule in SQL and TypeScript, tested once  | each looked right alone              | test them against each other on the same data                      |

## Exercises

### 1. Paste and print (warm-up)

Export a deck from Moxfield or Arena (or type a few lines by hand, with a "Sideboard" header) and
paste it into a deck. What happens to a card that isn't in the catalog? Then open **Print
proxies** and look at the print preview. Are the cards the size of real cards?

<details><summary>Solution</summary>

Cards the catalog doesn't have are listed after "Not in the catalog:" and not added. Lines the
parser can't read are listed after "Couldn't read:". The catalog only holds enabled and supporting
sets, so enable more sets to find more cards. At 100% scale each card prints 63 × 88 mm. If they
come out smaller, the print dialog is set to "fit to page".

</details>

### 2. Add Brawl

Brawl is Commander with 60 cards, using Scryfall's `brawl` legality. Add it. Which places must
change, and how do you find them all?

<details><summary>Solution</summary>

1. Add `"brawl"` to `FORMATS` in `deck.ts`.
2. Typecheck. The compiler lists the tables that are now incomplete: `FORMAT_RULES` in `rules.ts`
   (add `brawl: { kind: "commander", size: 60 }`) and `FORMAT_LABELS` in `app/decks/labels.ts`
   (add `brawl: "Brawl"`).
3. The one thing the compiler can't see is the database: the CHECK constraint on `decks.format`
   lists the formats too. Add `'brawl'` in `decks/infrastructure/schema.ts` and generate a migration.

A test like this then passes:

```ts
deck = withEntry(deck, { oracleId: "ruby", board: "commander", quantity: 1 });
deck = withEntry(deck, { oracleId: "mountain", board: "main", quantity: 59 });
expect(deckProblems(deck, rules, ownAll)).toEqual([]); // 60 cards: legal
```

</details>

### 3. Quantities after the name

Some sites write `Lightning Bolt x4`. Write `parseTrailingQuantity(line)` returning
`{ name, quantity }` or `null`, case-insensitive, ignoring spaces around the line.

<details><summary>Solution</summary>

```ts
function parseTrailingQuantity(line: string): { name: string; quantity: number } | null {
  const match = /^(.+?)\s+x(\d+)$/i.exec(line.trim());
  if (match === null) return null;
  return { name: match[1], quantity: Number(match[2]) };
}

parseTrailingQuantity("Lightning Bolt x4"); // { name: "Lightning Bolt", quantity: 4 }
parseTrailingQuantity("  Sol Ring X1 "); // { name: "Sol Ring", quantity: 1 }
parseTrailingQuantity("Lightning Bolt"); // null
```

The `i` flag makes it case-insensitive (Python: `re.IGNORECASE`). To use it in `parseList`, try it
before the main pattern.

</details>

### 4. A shopping list (SQL)

Write a query listing, for one player, every non-basic card their decks need more of than they
own, and how many to get. Use the **largest** quantity any single deck needs, since decks share
cards.

<details><summary>Solution</summary>

```sql
with owned as (
  select p.oracle_id, sum(c.quantity) as quantity
    from collection_cards c join printings p on p.id = c.printing_id
   where c.user_id = :player
   group by p.oracle_id
),
needed as (
  select e.oracle_id, max(e.quantity) as quantity
    from deck_entries e join decks d on d.id = e.deck_id
   where d.owner_id = :player
   group by e.oracle_id
)
select (select min(p.name) from printings p where p.oracle_id = n.oracle_id) as name,
       n.quantity - coalesce(o.quantity, 0) as to_get
  from needed n left join owned o on o.oracle_id = n.oracle_id
 where n.quantity > coalesce(o.quantity, 0)
   and not exists (select 1 from printings p where p.oracle_id = n.oracle_id and p.type_line like 'Basic%')
 order by name;
```

`max` rather than `sum` reflects shared ownership: two decks each using one Sol Ring need one Sol
Ring. (Strictly, `max` over entries undercounts a card on both the main board and the sideboard of
one deck. Summing per deck first, then taking the max over decks, fixes that.)

</details>

### 5. A mana curve (challenge)

Write `manaCurve(lines)`: the number of non-land cards (main deck and commander, not sideboard)
at each mana value 0–6, with 7 or more in the last bucket. Return an array of 8 numbers.

<details><summary>Solution</summary>

```ts
type CurveLine = {
  quantity: number;
  manaValue: number;
  typeLine: string;
  board: "main" | "side" | "commander";
};

function manaCurve(lines: readonly CurveLine[]): number[] {
  const curve = Array.from({ length: 8 }, () => 0);
  for (const line of lines) {
    if (line.board === "side" || line.typeLine.includes("Land")) continue;
    curve[Math.min(7, Math.floor(line.manaValue))] += line.quantity;
  }
  return curve;
}
```

(pandas: `df[~df.type.str.contains("Land")].groupby(df.mv.clip(upper=7)).quantity.sum()`.) The
builder's `DeckLine` already has `manaValue` and `typeLine`, so the builder now shows the curve:
compare your version with [`stats.ts`](../src/modules/decks/domain/stats.ts).

</details>

### 6. Refuse or report? (discussion)

For each, would you refuse or report: (a) a trade offering cards you don't own; (b) a deck using
cards you don't own; (c) an MSRP of $0; (d) a sideboard of 16 cards?

<details><summary>Solution</summary>

(a) **Refuse**: a trade moves real things, and completing it must be possible (Phase 10 re-checks
at acceptance). (b) **Report**: it's a plan, and it tells you what to go and get. (c) **Refuse**:
it's configuration that immediately affects purchases. (d) **Report**: the deck is being edited.
The question is always: can this state exist harmlessly while someone keeps working?

</details>

## Recap

- **`(typeof LIST)[number]`** turns a constant list into a union type, so the list, the type and
  the Zod schema come from one place.
- Rules that differ in numbers belong in a **table of data**, and `Record<Union, …>` makes the
  compiler list what a new entry needs.
- **Refuse** invalid transactions, and **report** problems in work in progress.
- Parse text with a careful regex (non-capturing groups, lazy `+?`) and **show what couldn't be
  read**.
- **Round-trip tests** keep a writer and a reader in step.
- **CTEs** name intermediate results, and **lateral joins** compute per-row facts.
- A rule implemented twice must be **tested against itself**.
- CSS **`mm`** and **`print:`** styles make a real-size proxy sheet.

## Further reading

- [Design doc 09: deck builder](../docs/design/09-decks.md)
- [ADR 0011: printing-level ownership](../docs/adr/0011-printing-level-ownership.md)
- TypeScript handbook: "Indexed Access Types", "Narrowing"
- MDN: "Regular expressions" (groups, lazy quantifiers), "CSS: printing", `break-inside`
- PostgreSQL docs: "WITH Queries (Common Table Expressions)", "LATERAL Subqueries"
- Magic comprehensive rules, section 903 (Commander), for the real rules behind rule 3
