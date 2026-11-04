# Lesson 24: Tiers, windows, and a radio group

- **Phase:** 24 (standard art for cards you don't own, and choosing a card's printing)
- **Prerequisites:** [Lesson 23](23-replacing-a-list-and-ranking-copies.md) (rankings as
  `ORDER BY` lists, one shared definition), [Lesson 20](20-suggesting-cards.md) (comparator
  chains)
- **Time:** 1¼ hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Turn a list of preferences ("Magic's own art, not Secret Lair, an ordinary frame…") into
   **tiers** of a ranking, and say why you **sort instead of filtering** when "unless there's
   nothing else" is part of the rule.
2. Build an SQL ranking from **smaller fragments**, and name the aliases a fragment expects.
3. Put two groups in one ordered result ("yours first, then the rest") with a **window
   function**, `row_number() over (order by …)`.
4. Check a choice in **pure domain code** that is given the facts it needs, with the use case
   loading those facts through a port.
5. Build a **controlled radio group** in React whose choice shows at once while the server
   saves it (`useTransition`), and say when that's better than updating first and undoing.
6. Write a test for a **tie-breaker**, and see why a test without a tie passes for the wrong
   reason.

---

# Part A: Preferences become tiers

## A1. What "standard art" means

Before this phase, a deck line for a card you didn't own showed the card's **newest**
printing. For Sol Ring that was a Secret Lair or a Warhammer 40,000 version, and the deck
looked random. The player's rules, in their words:

- the standard art if I don't own it;
- Universes Within (Magic's own worlds) before Universes Beyond (Fallout, Doctor Who, …);
- not Secret Lair by default.

Each rule becomes one **tier**, most important first, exactly like lesson 23's comparator
chain:

0. released already (found after deploying: a preview from a set out next year had become
   the "newest" Forest);
1. not Universes Beyond;
2. not Secret Lair;
3. an ordinary card: modern frame, normal border, not full art, no showcase or extended art,
   no promo;
4. from an expansion, then a core set, then a Commander set, then anything else;
5. newest set, lowest collector number, printing id (a total order: lesson 23, E1).

In Python it's one sort key:

```python
def standard_first(p):
    return (p.universes_beyond, p.secret_lair, not p.ordinary, SET_TYPE_RANK[p.set_type],
            -p.release_ordinal, p.number, p.id)
```

## A2. Sort, don't filter

"Not Secret Lair" sounds like a `WHERE`: `where s.name not ilike 'Secret Lair%'`. But some
cards were printed **only** in Secret Lair, and a filter would leave them with no picture at
all. The rule really says "not Secret Lair **unless there's nothing else**", and that is what a
sort tier does: Secret Lair printings sink below the others, but if nothing else exists, the
best of them still comes first.

> **Rule of thumb:** if the sentence has "prefer", "by default" or "unless", it's a sort
> tier. If it has "never" or "must", it might be a filter. Even then, ask what should happen
> when nothing is left.

## A3. The order of tiers is the decision

The same tiers in a different order give a different answer. For cards you **own**, the
player wanted value first: "the most valuable printing owned first, then the other rules".
So `MOST_SPECIAL_FIRST` keeps price at the top and puts Universes Within before Universes
Beyond **second**:

```ts
// src/modules/decks/queries/owned.ts
export const MOST_SPECIAL_FIRST = sql`
  (select s.usd_cents from price_snapshots s
    where s.printing_id = c.printing_id and s.finish = c.finish
    order by s.day desc limit 1) desc nulls last,
  ${IS_UNIVERSES_BEYOND},
  case c.finish when 'etched' then 0 when 'foil' then 1 else 2 end,
  …`;
```

A $40 Fallout Sol Ring you own still beats a $2 plain one. At equal value, the Magic one
wins. Moving one line changes behaviour, so the order is what design doc 24 records, and what
the tests pin down (Part E).

---

# Part B: Fragments inside fragments

## B1. One rule, two rankings

"Universes Beyond last" appears in both rankings. Scryfall marks every Universes Beyond
printing with the promo type `universesbeyond`, so the rule is one `CASE`:

```ts
/** SQL: 1 for a Universes Beyond printing (`p`), else 0; for ordering Magic's own art first. */
const IS_UNIVERSES_BEYOND = sql`case when 'universesbeyond' = any(p.promo_types) then 1 else 0 end`;

export const STANDARD_FIRST = sql`
  case when s.release_date > to_char(current_date, 'YYYY-MM-DD') then 1 else 0 end,
  ${IS_UNIVERSES_BEYOND},
  case when s.name ilike 'Secret Lair%' then 1 else 0 end,
  case when p.frame_version in ('2003', '2015')
             and p.border_color in ('black', 'white')
             and not p.is_full_art
             and not (p.frame_effects && array['showcase', 'extendedart']::text[])
             and cardinality(array_remove(p.promo_types, 'universesbeyond')) = 0
       then 0 else 1 end,
  case s.type when 'expansion' then 0 when 'core' then 1 when 'commander' then 2 else 3 end,
  s.release_date desc,
  nullif(regexp_replace(p.collector_number, '\\D.*$', ''), '')::int nulls last,
  p.collector_number,
  p.id`;
```

Drizzle's `sql` tag lets one fragment hold another (`${IS_UNIVERSES_BEYOND}`). The result is
still one piece of SQL with its parameters in order, like building a query from `psycopg.sql`
parts in Python.

Two details:

- `array_remove(p.promo_types, 'universesbeyond')`: the "ordinary" tier ignores the
  Universes Beyond tag. Otherwise a card printed only in Universes Beyond could never count as
  ordinary, and its plainest printing would lose to a showcase one.
- `'\\D.*$'` has two backslashes because it's inside a JavaScript template literal. The string
  Postgres receives is `\D.*$`: "the first non-digit and everything after it". So `"263★"`
  becomes `263`, and the main card sorts before its starred variant.

## B2. A fragment's hidden parameters

`STANDARD_FIRST` mentions `p` and `s`. It only works in a query where `p` is a printing and `s`
is its set. Those aliases are **parameters you can't see in the type**: TypeScript can't check
them, and a wrong alias is an SQL error at run time. Two habits make them visible:

1. Say them in the doc comment ("`p` is a printing and `s` its set").
2. Test every query that uses the fragment against real Postgres (the integration tests do).

A function, `standardFirst(printing: string, set: string)`, would make the aliases explicit,
at the cost of building SQL identifiers from strings. With three callers, all using `p` and
`s`, a comment was enough.

---

# Part C: Two groups, one order

The printing picker lists **your printings first, best first, then the rest standard first**.
One query, one `ORDER BY`. But `MOST_SPECIAL_FIRST` ranks **copies** (`c`, a row of your
collection), and a printing you don't own has no copy to rank. The fix is to rank the copies
separately, then look each printing's rank up:

```sql
with best as (
  select c.printing_id, row_number() over (order by ${MOST_SPECIAL_FIRST}) as rank
    from ${owned} c join printings p on p.id = c.printing_id
   where p.oracle_id = ${oracleId}
)
select …
  from printings p join card_sets s on s.code = p.set_code
 where p.oracle_id = ${oracleId}
 order by (select min(b.rank) from best b where b.printing_id = p.id) nulls last,
          ${STANDARD_FIRST}
```

- `row_number() over (order by …)` is a **window function**: it numbers the rows 1, 2, 3, …
  in that order without grouping them away. It's Python's
  `enumerate(sorted(copies, key=…), start=1)`.
- `min(b.rank)`: one printing can be owned in two finishes (two rows), so it takes its best.
- `nulls last`: printings you don't own have no rank (null), so they come after all of yours,
  and the next tier, `STANDARD_FIRST`, orders them.

---

# Part D: Choosing a printing

## D1. Facts in, decision out

Choosing a printing has three rules: the line must be in the deck, the printing must be of
that card, and the finish must be one it comes in. The rules are **pure**: they need facts
about the printing but no database. So the domain function takes the facts as an argument:

```ts
// src/modules/decks/domain/deck.ts
export function withPrinting(
  deck: Deck,
  choice: PrintingChoice,
): Result<Deck, ChoosePrintingError> {
  const existing = deck.entries.find(
    (entry) => entry.oracleId === choice.oracleId && entry.board === choice.board,
  );
  if (existing === undefined) return err({ kind: "EntryNotFound" });

  const { pinned } = choice;
  if (pinned !== null) {
    if (pinned.facts === null || pinned.facts.oracleId !== choice.oracleId)
      return err({ kind: "PrintingNotOfCard" });
    if (!pinned.facts.finishes.includes(pinned.finish)) return err({ kind: "FinishNotAvailable" });
  }
  …
}
```

The use case loads the facts through a port (`cards.printingFacts`) and passes them in. This
is **functional core, imperative shell** again (lesson 01): the shell does the I/O, the core
decides. The unit tests check every rule with a fake that returns facts from a list, and no
database.

Why not a database constraint? Postgres could refuse a printing of the wrong card with a
trigger. But the error would come back as an exception with a message to parse, not as
`{ kind: "FinishNotAvailable" }` that the UI can turn into a sentence.

## D2. "Follow my copies" is null

Unpinning sets the printing and finish back to `null`, and the deck view falls back to your
most special copy, then the standard printing. `null` here means "decide for me", not
"unknown". The type `pinned: {…} | null` says it in the signature, and the radio button says
it to the player.

---

# Part E: A radio group that saves

## E1. One value controls the group

A radio group is one choice among many, so React holds **one value** for the whole group, not
one boolean per button. Each option is a printing **and** a finish, so the value encodes both:

```tsx
const AUTOMATIC = "automatic";
const current =
  line.pinnedPrintingId === null
    ? AUTOMATIC
    : `${line.pinnedPrintingId}:${line.pinnedFinish ?? line.finish}`;

<input
  type="radio"
  name={groupName}
  value={value}
  checked={checked === value}
  onChange={() => choose(value)}
/>;
```

`checked={…}` makes it **controlled** (lesson 23, Part F): React's state decides which button
is on, not the browser. All buttons share a `name`, so the keyboard's arrow keys move through
them as one group.

## E2. Show the choice, then wait for the server

Choosing saves at once. There are two ways to make that feel fast:

- **Optimistic UI:** change the deck on screen first, send the change, undo it if the server
  refuses. The builder does this for quantities (design doc 19), because the browser can work
  out the new deck itself.
- **Wait for the server:** show that it's saving, then show what the server returns.

A new printing means a new picture, price and finish that the browser doesn't have. So the
picker does a little of each: the **radio** moves at once (a `saving` value overrides the
current one), and the deck waits for the server's fresh copy:

```tsx
const [saving, setSaving] = useState<string | null>(null);
const checked = saving ?? current;
const [isSaving, startSaving] = useTransition();

function choose(value: string) {
  setSaving(value);
  startSaving(async () => {
    const result = await choosePrintingAction({ deckId, oracleId, board: line.board, pinned });
    setSaving(null);
    …
  });
}
```

`useTransition` gives `isSaving` for "Saving…" and disables the buttons, so a second click
can't race the first. If the save fails, `saving` goes back to `null` and the radio returns to
what the deck really has.

---

# Part F: Testing a tie-breaker

The first version of this test passed its first half and failed its second:

```ts
await own("BLB 2", "nonfoil");
await own("BLB 900", "foil");
// No prices: the foil would win (design doc 23)…
expect(await picks()).toEqual(both("BLB 900"));
// …unless it's Universes Beyond.
await setLook("BLB 900", { promo_types: ["universesbeyond"] });
expect(await picks()).toEqual(both("BLB 2"));
```

The comment was wrong: the fixture catalog **has** prices for both, and the foil was simply
pricier. The first assertion passed for the wrong reason (price, not finish), and the second
failed correctly: value comes before Universes Beyond. A tie-breaker only matters when
everything before it is equal, so its test must **make a tie**:

```ts
await price("BLB 2", "nonfoil", 500);
await price("BLB 900", "foil", 500);
```

Then it checks the tie-breaker in both directions, and one more time with the tie broken
(`900` cents), to prove value still comes first.

Two more habits from these tests:

- **Give fixtures known values.** The tests set each Beza printing's border, frame and promo
  types in `beforeEach`, so a fixture refresh can't change what they mean, and put the
  originals back in `afterAll`.
- **Assert the not-yet state.** The end-to-end test first expected "Follow my copies" to be
  checked. It wasn't: pasting a list had pinned a printing (phase 23). Now the test says so
  (`not.toBeChecked()`) before changing anything.

---

## Common mistakes

| Mistake                                                  | What happens                                       | Instead                                                            |
| -------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| Filtering out what should only be ranked down            | Cards printed only in Secret Lair have no picture  | A sort tier: last, but still there                                 |
| Putting a "nice to have" tier above value                | A $2 card beats the $40 one you own                | Write the tiers in the order the player stated them                |
| One backslash in a regex inside a template literal       | `\D` becomes `D` in the string; numbers sort wrong | `\\D` in TypeScript, so Postgres gets `\D`                         |
| Reusing a fragment where its aliases mean something else | SQL error at run time, or a silently wrong order   | Name the aliases in the doc comment; integration-test every caller |
| One `useState` per radio button                          | Two buttons on at once after a fast double click   | One value for the group                                            |
| Testing a tie-breaker without a tie                      | The test passes because of an earlier rule         | Make everything before it equal, then test it both ways            |

## Exercises

### 1. Warm-up: sort, don't filter

Write a comparator `standardFirst(a, b)` for

```ts
type Printing = {
  id: string;
  universesBeyond: boolean;
  secretLair: boolean;
  ordinary: boolean;
  setType: "expansion" | "core" | "commander" | "other";
  releaseDate: string; // "2024-08-02"
};
```

following tiers 1–4 of Part A1, then newest first, then id. Check that a card printed only in
Secret Lair still gets a printing, and that an ordinary Secret Lair printing loses to a
showcase one from an expansion.

<details><summary>Solution</summary>

```ts
const SET_TYPE_RANK = { expansion: 0, core: 1, commander: 2, other: 3 } as const;
const flag = (value: boolean) => (value ? 1 : 0);

function standardFirst(a: Printing, b: Printing): number {
  return (
    flag(a.universesBeyond) - flag(b.universesBeyond) ||
    flag(a.secretLair) - flag(b.secretLair) ||
    flag(!a.ordinary) - flag(!b.ordinary) ||
    SET_TYPE_RANK[a.setType] - SET_TYPE_RANK[b.setType] ||
    b.releaseDate.localeCompare(a.releaseDate) ||
    a.id.localeCompare(b.id)
  );
}

const onlySecretLair = [
  {
    id: "sld",
    universesBeyond: false,
    secretLair: true,
    ordinary: true,
    setType: "other",
    releaseDate: "2024-01-01",
  },
] satisfies Printing[];
[...onlySecretLair].sort(standardFirst)[0].id; // "sld": ranked down, never filtered out
```

`a || b` in JavaScript returns `b` when `a` is `0`, so each line is only looked at when every
line before it is a tie: a comparator chain in one expression. An ordinary Secret Lair printing
loses to an expansion showcase because "not Secret Lair" (tier 2) comes before "ordinary"
(tier 3).

</details>

### 2. Encode and decode a choice

The picker's radio values are `"automatic"` or `"<printingId>:<finish>"`. Write
`decodeChoice(value: string)` returning `{ kind: "automatic" }`,
`{ kind: "pinned"; printingId; finish }`, or `null` for anything malformed (no colon, an empty
id, an unknown finish).

<details><summary>Solution</summary>

```ts
const FINISHES = ["nonfoil", "foil", "etched"] as const;
type Finish = (typeof FINISHES)[number];
type Choice = { kind: "automatic" } | { kind: "pinned"; printingId: string; finish: Finish };

function isFinish(value: string): value is Finish {
  return (FINISHES as readonly string[]).includes(value);
}

function decodeChoice(value: string): Choice | null {
  if (value === "automatic") return { kind: "automatic" };
  const colon = value.lastIndexOf(":");
  if (colon <= 0) return null;
  const printingId = value.slice(0, colon);
  const finish = value.slice(colon + 1);
  return isFinish(finish) ? { kind: "pinned", printingId, finish } : null;
}
```

`lastIndexOf` rather than `split(":")`, so an id that ever contained a colon would still
decode. `value is Finish` makes `isFinish` a **type guard**: a function returning a boolean that also
tells TypeScript what the value is when it's `true`. After the check, TypeScript knows `finish`
is a `Finish`, not just a string. Python's `TypeGuard[...]` (in `typing`) does the same for
type checkers.

</details>

### 3. A test that needs a tie

Here is the owned-copy ranking reduced to two tiers:

```ts
type Copy = { id: string; priceCents: number | null; universesBeyond: boolean };
function mostValuableFirst(a: Copy, b: Copy): number {
  if (a.priceCents !== b.priceCents) {
    if (a.priceCents === null) return 1;
    if (b.priceCents === null) return -1;
    return b.priceCents - a.priceCents;
  }
  return Number(a.universesBeyond) - Number(b.universesBeyond);
}
```

Write a test that **fails** if someone deletes the last line (the Universes Beyond rule), and
one that fails if someone moves that rule above price.

<details><summary>Solution</summary>

```ts
it("puts Universes Within first at equal value", () => {
  const fallout = { id: "pip", priceCents: 500, universesBeyond: true };
  const magic = { id: "c21", priceCents: 500, universesBeyond: false };
  expect([fallout, magic].sort(mostValuableFirst).map((copy) => copy.id)).toEqual(["c21", "pip"]);
});

it("still puts value first", () => {
  const fallout = { id: "pip", priceCents: 4000, universesBeyond: true };
  const magic = { id: "c21", priceCents: 200, universesBeyond: false };
  expect([magic, fallout].sort(mostValuableFirst).map((copy) => copy.id)).toEqual(["pip", "c21"]);
});
```

The first test needs **equal prices**, or price decides and the rule under test never runs.
It also lists the Universes Beyond copy first, so that a sort that does nothing fails too.

</details>

### 4. Think: why the window function?

In Part C, why can't the picker's query just say `order by ${MOST_SPECIAL_FIRST}` on
`printings p`?

<details><summary>Answer</summary>

`MOST_SPECIAL_FIRST` ranks **copies**: it reads `c.finish`, `c.quantity` and the price of
`c`'s finish. In a query over printings there is no `c`: an unowned printing has no copy,
and an owned one can have several (one per finish, game and real). Ranking the copies first
(`best`) and then taking each printing's best rank turns "many or none per printing" into
"one number or null", which `ORDER BY … nulls last` can use.

</details>

## Recap

- Preferences become **tiers** of a ranking, most important first. The order of the tiers is
  the decision: value first for your copies, Magic's own art first for the rest.
- **Sort, don't filter** when the rule says "by default" or "unless there's nothing else".
- SQL fragments can hold fragments. A fragment's aliases are hidden parameters: name them, and
  test every query that uses it.
- `row_number() over (order by …)` numbers rows in an order, like `enumerate(sorted(…))`, and
  lets two groups share one `ORDER BY`.
- Rules that need facts stay pure: the use case loads the facts through a port and passes them
  in.
- A radio group is **one** controlled value. Show the choice at once, and wait for the server
  when it has data you don't.
- A tie-breaker's test must make a tie.

## Further reading

- [Design doc 24](../docs/design/24-choose-a-printing.md): the tiers and the decisions taken
  while building.
- PostgreSQL: [window functions](https://www.postgresql.org/docs/current/tutorial-window.html)
  and [sorting rows](https://www.postgresql.org/docs/current/queries-order.html) (`NULLS LAST`).
- React: [`useTransition`](https://react.dev/reference/react/useTransition) and
  [controlled radio inputs](https://react.dev/reference/react-dom/components/input#providing-an-initially-selected-option).
- Scryfall's [card objects](https://scryfall.com/docs/api/cards): `promo_types`,
  `frame_version`, `border_color`.
