# Lesson 25: Links, upserts, and shapes that fit too well

- **Phase:** 25 (token proxies: print each token the deck's cards make, in the art you choose)
- **Prerequisites:** [Lesson 16](16-two-collections-one-deck.md) (separate models instead of a
  flag), [Lesson 24](24-tiers-windows-and-a-radio-group.md) (controlled radio groups,
  `useTransition`), [Lesson 22](22-pixels-kernels-and-drawing-a-card.md) (layout as a pure
  function)
- **Time:** 1¼ hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Model "many cards make many tokens" with a **link table**, and query it "through" a shared
   key (any printing of a card counts).
2. Group rows in TypeScript with a `Map` of lists, and keep the **best** value seen so far while
   grouping.
3. Say why **replacing** a table (delete everything, insert again) silently breaks rows that
   point at it, and keep them with an **upsert** plus "delete what's missing".
4. Store a choice as **intent** (`null` means "the default") rather than as the result, so the
   default can change later.
5. Spot where **structural typing** lets a wrong value through, and close the gap.
6. Check a data source's **real data**, not just its documentation, before trusting a rule
   about it.

---

# Part A: Many to many

## A1. The shape of the data

A card can make several tokens (Beza makes a Treasure and Fish), and a token is made by many
cards (hundreds of cards make Treasure). That's a **many-to-many** relationship. Neither side
can hold it in one column: a `token_id` column on `printings` would allow one token per card,
and a `card_id` on tokens one card per token.

The usual answer is a third table that holds nothing but pairs, a **link table** (also called a
join or junction table):

```sql
create table printing_tokens (
  printing_id text not null references printings (id) on delete cascade,
  token_id text not null references token_printings (id) on delete cascade,
  primary key (printing_id, token_id)
);
```

Each row says "this printing makes that token printing". The primary key on both columns stops
the same pair being stored twice. In Python you might hold the same thing as a set of tuples:

```python
makes = {("beza-blb", "treasure-tblb"), ("beza-blb", "fish-tblb"), ("tithe-c18", "treasure-tm19")}
```

## A2. Why tokens get their own table

Tokens could have gone into `printings` with an `is_token` flag. Lesson 16 explained why we
didn't do that with real cards: every query that reads `printings` (the store, search,
collections, deck legality) would need `where not is_token`, and forgetting it once would sell
Goblin tokens in the store. A separate `token_printings` table means code that doesn't know about
tokens can't see them.

## A3. Going "through" a key

Scryfall links **printings**: Krenko from Magic 2013 makes the Magic 2013 Goblin. A deck holds
**cards** (oracle ids); its line shows one printing, which may not link to anything. So the
query joins through `printings` and matches on the card:

```sql
select p.oracle_id as card_oracle_id, pt.printing_id, t.*
  from printing_tokens pt
  join printings p on p.id = pt.printing_id
  join token_printings t on t.id = pt.token_id
 where p.oracle_id = any($1::text[])
```

"Any printing of Krenko makes a Goblin" is what we want: you can print the Goblins whichever
Krenko you own. The row's `printing_id` is still kept, because Part B needs it to pick the
default art.

**Try it:** in `psql`, count how many cards make Treasure:

```sql
select count(distinct p.oracle_id)
  from printing_tokens pt
  join printings p on p.id = pt.printing_id
  join token_printings t on t.id = pt.token_id
 where t.name = 'Treasure';
```

---

# Part B: Grouping, and keeping the best

## B1. A `Map` of lists

The query returns one row per link. The print page wants one entry per **token**, listing the
cards that make it. That's grouping. Python's `defaultdict(list)` does it in two lines:

```python
from collections import defaultdict
by_token = defaultdict(list)
for link in links:
    by_token[link.token_id].append(link)
```

TypeScript has no `defaultdict`, so you read the list, or start one when there's none:

```ts
const byToken = new Map<string, TokenLinkRow[]>();
for (const link of linksByCard.get(maker.oracleId) ?? []) {
  byToken.set(link.token.oracleId, [...(byToken.get(link.token.oracleId) ?? []), link]);
}
```

`?? []` means "or an empty list if that's `undefined`". A `Map` keeps keys in the order they
were first set, as a Python `dict` does, so "first card in deck order" stays first.

## B2. The best value so far

The default art is "the token your card's own printing makes, from the first such card in deck
order; failing that, the newest any printing makes". Going through the deck once, each token
remembers its art **and why it has it**:

```ts
const own = tokenLinks.find((link) => link.printingId === maker.printingId);
const art = own?.token ?? newestFirst(tokenLinks.map((link) => link.token))[0];
const known = tokens.get(tokenOracleId);
if (known === undefined) {
  tokens.set(tokenOracleId, {
    art,
    fromOwnPrinting: own !== undefined,
    madeBy: [maker.name],
    boards: [maker.board],
  });
  continue;
}
// A later card's own printing beats an earlier card's guess.
if (!known.fromOwnPrinting && own !== undefined) {
  known.art = own.token;
  known.fromOwnPrinting = true;
}
```

(From [`token-proxies.ts`](../src/modules/decks/domain/token-proxies.ts).) Without the
`fromOwnPrinting` flag, the rule would be either "first card wins", even when that card only
guessed, or "last card wins", which breaks "first in deck order". The flag records which tier
of the rule produced the value, so a better tier can replace it and an equal one can't. It's
lesson 24's tiers again, worked out one row at a time.

---

# Part C: Rows that point at a table

## C1. Replacing breaks pointers

Every sync reads Scryfall's tokens again. The simplest way to store them is to **replace** the
table: delete everything, insert what the file says. That's correct for `printing_tokens`: its
rows are only ever written by the sync.

It is wrong for `token_printings`, because another table points at it. Your chosen art is
stored as a foreign key:

```sql
token_id text references token_printings (id) on delete set null
```

`on delete set null` says: if the token printing is deleted, set this column to null rather than
refuse the delete. That's right when a token really leaves the catalog: your deck goes back to
the default art. But a replace deletes **every** row, if only for a moment, so every deck's
choice would become null on every sync, even though the same rows come straight back.

## C2. Upsert, then delete what's missing

So the sync **upserts** the tokens (insert, or update the row with the same id) and then deletes
only the ids that aren't in the file:

```ts
.onConflictDoUpdate({
  target: tokenPrintings.id,
  set: { name: excluded("name"), /* … every column … */ },
});
// …
await db.execute(sql`delete from token_printings where id <> all(${sql.param(ids)}::text[])`);
```

`excluded.name` is the value from the row we tried to insert. `id <> all(array)` is true when
the id equals none of the array's values. It's Python's `id not in ids`. A row that stays keeps
its identity, so nothing pointing at it notices the sync.

One more guard: if the file has **no** tokens at all (a cut-down test file, a format change),
"delete what's missing" would delete every token. The sync then skips the step instead of wiping
everyone's choices. A step that deletes based on what an input lacks should check that the input
is plausible first.

## C3. Store the intent

A choice row holds `token_id = null` for "the default art", not the default's id. The default
depends on the deck (which Krenko it shows) and on the catalog (a new Goblin printing). Storing
the default's id would freeze today's answer as if you had chosen it. Storing `null` stores
what you meant, "whatever the default is", and the query works it out each time.

Python code does the same when `None` means "use the current setting" and the function looks the
setting up when it runs.

---

# Part D: Shapes that fit too well

## D1. A bug the compiler accepted

The print page's summary used to take the deck's lines:

```ts
proxySummary(props.lines, options); // lines: ProxyLine[]
```

This phase changed `proxySummary` to take the **copies** to print (`ProxyCard[]`: cards, then
tokens). The old call still compiled. TypeScript's types are **structural**: a value fits a
type if it has the right properties, whatever its type is called. A `ProxyLine` has every
property a `ProxyCard` has (`printingId`, `name`, `hasBack`, `isFoil`, `printed`) plus
`quantity` and more. So an array of lines is an acceptable array of cards, and four Lightning
Bolts would have been counted as one.

Python's `typing.Protocol` matches by shape in the same way. A `dataclass` parameter doesn't:
passing a `Line` where a `Copy` is expected is an error unless one inherits from the other.

## D2. Closing the gap

Three ways, from cheapest:

1. **Find the callers when the meaning changes.** Changing what a parameter means without
   changing its type is the risk. Search for every call (`grep -rn "proxySummary("`) and fix each
   one. That's what found this one.
2. **Make the shapes differ.** Give the type a property that only the right values have, such as
   `kind: "copy"`. Then a line is missing it, and the compiler refuses the call (exercise 2).
3. **A branded type** (lesson 01), when the difference is a rule rather than a shape: a
   `PrintingId` is a string, but not every string is a `PrintingId`.

Behaviour tests catch it too: the form's summary is worked out by the same pure functions the
tests check with real quantities.

---

# Part E: Check the data, not the documentation

The design said "everything Scryfall lists as a token". The code read `all_parts` entries whose
`component` is `"token"`. Every test passed: the fixture cards' tokens are all ordinary tokens.

Then a real deck on the print page showed Elspeth's Soldier but not her **emblem**, and nothing
for Palace Jailer's **Monarch**. A ten-line script over the real bulk file showed why:

```
Elspeth, Knight-Errant
   combo_piece Elspeth, Knight-Errant Emblem -> [tmed/token/emblem/en]
   token Soldier -> [tddf/token/token/en]
Palace Jailer
   combo_piece The Monarch -> [tltc/token/token/en]
```

Scryfall files emblems and helper cards under `"combo_piece"`, next to ordinary related cards.
The fix reads both components, and relies on a rule already in place: a link is stored only if
it points at a known token printing, so ordinary combo pieces drop out.

The lesson isn't about Scryfall. It's that a rule about outside data ("tokens are
`component: token`") is a guess until it has been run over **real** data, the edge cases
included. Fixtures (recorded data) prove the code does what you think. Only the real data shows
whether what you think is right.

---

## Common mistakes

- **Replacing a table that others point at.** Delete-and-insert looks idempotent, but every
  `on delete` rule (cascade, set null) fires for every row. Upsert rows that have an identity.
- **"Delete what's missing" without checking the input.** An empty or broken input then deletes
  everything. Skip the step when the input can't be right.
- **Storing the default as if it were chosen.** Store `null` (intent), and work the default out
  when reading.
- **Changing what a parameter means but not its type.** Structural typing will accept the old
  callers. Find them, or make the type refuse them.
- **A controlled checkbox that waits for the server.** `checked={token.included}` doesn't move
  until the save comes back, so the click seems ignored. Keep the value being saved in state and
  show `saving ?? saved`, as lesson 24's radio group does. (Playwright's `uncheck()` caught
  this: it fails when a click doesn't change the box.)
- **Trusting a data source's labels.** Check a classification rule against the real file before
  building on it.

## Exercises

### 1. Warm-up: `groupBy`

Write `groupBy(items, keyOf)` returning a `Map` from each key to the items with that key, in
first-seen order. Use it to group `{ card, token }` pairs by token.

<details><summary>Solution</summary>

```ts
function groupBy<Item>(items: readonly Item[], keyOf: (item: Item) => string): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

const links = [
  { card: "krenko", token: "goblin" },
  { card: "tithe", token: "treasure" },
  { card: "instigator", token: "goblin" },
];
const byToken = groupBy(links, (link) => link.token);
// keys: ["goblin", "treasure"]; byToken.get("goblin") holds krenko, then instigator
```

`<Item>` makes the function **generic** (lesson 01): it works for any item type, and the
`Map` it returns holds that type. Pushing onto the existing list is cheaper than copying it as
the project code does (`[...old, link]`); either is fine at this size.

</details>

### 2. A shape that fits too well

```ts
type Copy = Readonly<{ name: string; printingId: string }>;
type Line = Readonly<{ name: string; printingId: string; quantity: number }>;
function countCopies(copies: readonly Copy[]): number {
  return copies.length;
}
const lines: Line[] = [{ name: "Bolt", printingId: "m11", quantity: 4 }];
countCopies(lines);
```

Why does the last line compile, and what does it return? Change `Copy` so that it doesn't
compile.

<details><summary>Solution</summary>

A `Line` has every property a `Copy` has, so it **is** a `Copy` as far as TypeScript is
concerned (structural typing). It returns 1 (one line), not 4 (the copies).

```ts
type SafeCopy = Readonly<{ kind: "copy"; name: string; printingId: string }>;
function countSafeCopies(copies: readonly SafeCopy[]): number {
  return copies.length;
}
// @ts-expect-error a Line has no `kind: "copy"`, so it isn't a SafeCopy
countSafeCopies(lines);
```

`// @ts-expect-error` tells the compiler the next line **must** be an error. If it ever
compiles, that comment is itself an error, so it works as a test of the type.

</details>

### 3. Replace or upsert?

Run this in `psql` (temporary tables, rolled back at the end). What does each `select` show,
and why?

```sql
begin;
create temp table arts (id text primary key, name text not null);
create temp table choices (deck_id int, token text,
  art_id text references arts (id) on delete set null);
insert into arts values ('g1', 'Goblin'), ('g2', 'Goblin'), ('t1', 'Treasure');
insert into choices values (1, 'goblin', 'g2');

delete from arts;
insert into arts values ('g1', 'Goblin'), ('g2', 'Goblin'), ('t1', 'Treasure');
select art_id from choices;

update choices set art_id = 'g2';
insert into arts values ('g1', 'Goblin'), ('g2', 'Goblin Warrior'), ('t1', 'Treasure')
  on conflict (id) do update set name = excluded.name;
delete from arts where id <> all(array['g1', 'g2', 't1']);
select c.art_id, a.name from choices c join arts a on a.id = c.art_id;
rollback;
```

<details><summary>Answer</summary>

The first `select` shows `art_id` **null**: deleting `g2` fired `on delete set null`, and
inserting `g2` again doesn't put the pointer back. The second shows `g2 | Goblin Warrior`: the
upsert updated the row in place, so the choice still points at it and sees the new name. The
final `delete` removes nothing (`DELETE 0`), because every id is still in the list.

</details>

### 4. Challenge: how tall is a token's art?

A token's art and text box share `space` points. The text needs `textNeeds` points (0 with no
text), and a card's art is `cardArt` points tall. Write `tokenArtHeight(space, textNeeds,
cardArt)`: the art takes what the text doesn't need, but never less than a card's art. Then
write the test cases you'd want.

<details><summary>Solution</summary>

```ts
function tokenArtHeight(space: number, textNeeds: number, cardArt: number): number {
  return Math.max(cardArt, space - textNeeds);
}

it("art height", () => {
  expect(tokenArtHeight(200, 0, 105)).toBe(200); // no text: all the space
  expect(tokenArtHeight(200, 40, 105)).toBe(160); // short text: the rest
  expect(tokenArtHeight(200, 150, 105)).toBe(105); // long text: a card's art, no less
});
```

The third case matters most. Long text (an emblem's) must not shrink the art below a card's.
Then the ordinary layout's rule takes over, which gives the art's space to text that still
doesn't fit. The real code is the `card.isToken` block in
[`playtest-card.ts`](../src/modules/decks/domain/playtest-card.ts), which also measures
`textNeeds` by laying the text out at a real card's size.

</details>

## Recap

- Many-to-many needs a **link table** of pairs. Query it through a shared key when "any printing
  counts".
- Group with a `Map` of lists (`defaultdict(list)` in Python). Keep a flag saying **why** a value
  was chosen, so a better reason can replace it.
- Don't **replace** a table that others point at: `on delete` rules fire. **Upsert**, then delete
  only what's missing, and skip that when the input is implausible.
- Store **intent** (`null` = default), and work the default out when reading.
- **Structural typing** accepts any value with the right properties. When a parameter's meaning
  changes, find its callers or make the type refuse the old ones.
- A rule about outside data is a guess until it's been run over the **real** data.

## Further reading

- [Design doc 25](../docs/design/25-token-proxies.md): the decisions, and what real data
  changed (section 14).
- PostgreSQL: [`INSERT … ON CONFLICT`](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)
  and [foreign key actions](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK)
  (`on delete set null`, `cascade`).
- TypeScript handbook: [type compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)
  (structural typing).
- Scryfall: [related card objects](https://scryfall.com/docs/api/cards#related-card-objects)
  (`all_parts` and its `component` values).
