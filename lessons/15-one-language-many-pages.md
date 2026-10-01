# Lesson 15: One language, many pages, and a purchase you can trust

- **Phase:** 15 (buy singles from a list; Scryfall-style search everywhere)
- **Prerequisites:** [Lesson 06](06-transactions-across-modules.md) (one transaction across
  modules), [Lesson 09](09-rules-as-data.md) (parsing text), [Lesson 14](14-a-search-language-and-paper.md)
  (the search parser, stale responses)
- **Time:** 2–3 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Decide where code shared by several modules belongs, and keep its **pure** and **impure**
   halves apart with lint rules.
2. Give a tokenizer a **mode** (inside quotes, inside a pattern) and explain the edge cases that
   creates.
3. Accept **untrusted regular expressions** safely: validate, limit, and refuse what the database
   can't run.
4. Let one word mean the right thing on each page by passing a **context** instead of writing
   three versions of the code.
5. Separate a **quote** (read only, shown to a person) from a **purchase** (re-checked on the
   server), and use the confirmed total as an **optimistic concurrency** check.
6. Reason about **all-or-nothing** transactions, including side effects that happen lazily inside
   them.
7. Extract the **shared core** of two use cases so they can't drift apart.

---

# Part A: One search, three pages

## A1. Where does shared code live?

Phase 14 put the search language in the decks module. Phase 15 wanted it in the singles store
(the catalog module) and the collection (the collection module) too. The project's lint rules
(ADR 0009) don't let one module's queries import another module's code, for good reason: if
catalog imported decks, and decks already imports catalog, the modules would depend on each
other in a circle, and a change in either could break both.

Three options, and why one won ([ADR 0017](../docs/adr/0017-shared-card-search.md)):

| Option                                   | Problem                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Copy the parser into each module         | three places to fix every bug; they drift                              |
| Make catalog and collection import decks | dependencies point the wrong way (decks is built _on_ the catalog)     |
| **A shared library**, like the kernel    | the language has no data or use cases of its own, so it isn't a module |

So it moved to `src/shared/card-search`, keeping its git history (`git mv`).

**Python comparison:** moving a helper out of `app/decks/search.py` into a small internal package
`app/common/card_search/` that `decks`, `catalog` and `collection` all import, instead of
importing each other.

## A2. A pure half and an impure half

The shared library has two halves with different rules:

- `parse.ts`, `list.ts` and `index.ts` are **pure**: text in, a tree or list lines out. The
  browser can use them (the deck builder's quick filters do), so they may not import
  `drizzle-orm`, React or Node.
- `sql.ts` turns a tree into SQL with `drizzle-orm`. Only **queries** may import it.

Both rules are in `eslint.config.mjs`, not just in a comment:

```js
const cardSearch = { element: { type: "card-search", fileInternalPath: "index.ts" } };
const cardSearchSql = { element: { type: "card-search", fileInternalPath: "sql.ts" } };
// …queries may import both; the app may import only cardSearch …
```

and the pure files are added to the list held to "no frameworks, no database" imports. If someone
later imports `sql.ts` from a client component, the lint step fails before the browser ever
downloads database code.

## A3. A tokenizer with modes

Lesson 14's tokenizer had one **mode** (a state that changes how characters are read): inside
quotes, spaces don't end a word. Regular expressions add a second mode, because a pattern like
`o:/draw (a|two) cards?/` contains spaces and parentheses that must not split the word or open a
group:

```ts
if (inPattern) {
  // Inside /…/ everything counts, spaces and parentheses too; "\/" is a literal slash.
  word += next;
  if (next === "\\" && index + 1 < text.length) word += text[++index];
  else if (next === "/") inPattern = false;
} else if (next === "/" && !inQuotes && /^(!?|[a-z]+(<=|>=|!=|=|<|>|:))$/i.test(word)) {
  word += next; // a pattern starts right after the keyword (or at the word's start)
  inPattern = true;
}
```

Two details are worth reading slowly:

- A `/` only **starts** a pattern right after a keyword (`o:`) or at the very start of a word.
  Otherwise `1/2` or a card named `Fire // Ice` would switch modes by accident.
- A backslash copies the **next** character too, so `\/` inside a pattern doesn't end it.

Modes have edge cases. An unclosed pattern (`a:/^rob`) never leaves pattern mode, reaches the end
of the text, and becomes the plain text `/^rob`: a "contains" search that finds nothing. It's
harmless, but it's the kind of behavior a test should pin down once you notice it (exercise 1).

**Python comparison:** `shlex` has exactly this kind of state machine (`state = 'a'`, `'"'`,
`'\\'`) for quotes and escapes.

## A4. Untrusted regular expressions

A search box is input from a person, and a regular expression is a small program. Three checks run
before a pattern reaches Postgres (`patternProblem` in `parse.ts`):

1. **It compiles:** `new RegExp(pattern, "i")` inside `try`. A broken one becomes a note
   (`/(broken/ isn't a valid pattern (ignored)`), and the rest of the search still runs.
2. **It's short:** at most 100 characters. A length limit is the simplest guard against patterns
   that take a very long time to run.
3. **The database understands it:** JavaScript and Postgres regular expressions mostly agree, but
   not entirely. Named groups `(?<name>…)` and `\p{…}` work in JavaScript and fail in Postgres, so
   they're refused. Checking with JavaScript alone would let them through to a database error.

The value then goes to SQL as a **parameter** (`p.name ~* $1`), never pasted into the query text,
exactly like plain words in lesson 14.

## A5. One word, a meaning per page

`is:foil` should mean three slightly different things:

| Page          | `is:foil` means                 |
| ------------- | ------------------------------- |
| Singles store | this printing is _sold_ in foil |
| Collection    | _this copy_ (this row) is foil  |
| Deck builder  | you _own_ a foil copy of it     |

Instead of three SQL builders, the caller passes a **context** that holds the right condition:

```ts
export type SearchContext = Readonly<{ userId: UserId; foil: SQL }>;

// Each page passes its meaning:
searchCondition(node, { userId, foil: FOIL_IN_CATALOG }); // store
searchCondition(node, { userId, foil: foilCopy(sql`c.finish`) }); // collection
searchCondition(node, { userId, foil: foilOwnedBy(userId) }); // deck builder
```

The builder doesn't know which page it's on; it just uses `context.foil`. That's dependency
injection (lesson 01) at the size of one condition.

**Python comparison:** passing a function or an SQLAlchemy clause in as an argument, rather than
writing `if page == "store": … elif page == "collection": …` inside the builder.

## A6. Fixtures from real data

Two keywords (`kw:` and `produces:`) needed fields the test fixtures had trimmed away. The fix
wasn't to invent values: the real Scryfall file was already cached on disk from the morning's
sync, so a short script copied each fixture card's real `keywords` and `produced_mana` across.
Then the diff was checked to contain **only** those fields: the first attempt also changed the
JSON spacing on every line, which would have hidden the real change in noise. Tests built on
real data catch real surprises; the fixture README records where it came from.

---

# Part B: A purchase you can trust

## B1. Quote, then purchase

Buying a list has two steps that look alike but must not be the same code:

| Step         | Where                         | Writes anything? | Trusts the browser?                    |
| ------------ | ----------------------------- | ---------------- | -------------------------------------- |
| **Quote**    | a query (`quoteShoppingList`) | no               | n/a: it's only shown                   |
| **Purchase** | a use case (`buyList`)        | yes, all at once | **no**: every price is looked up again |

The quote is a **read model** (lesson 07): it can be as convenient as the screen needs (menus of
printings, "you have 3"). The purchase receives only `{ printingId, finish, quantity }` per line,
and prices them again inside the transaction. A browser that sends a made-up low price changes
nothing, because the browser never sends prices at all.

## B2. "The price you saw, or less"

Prices change every night. If the quote said $144.00 and the purchase now costs $151.00, quietly
charging more would be wrong. So the browser sends the total the player **confirmed**, and the
purchase compares:

```ts
const total = Cents.sum(
  input.lines.map((line, index) => totalPrice(quotes[index].price, line.quantity)),
);
if (total > input.expectedTotal) return err({ kind: "PricesChanged", total });
```

This is **optimistic concurrency**: don't lock anything while the player reads the quote; check
at the end that what they agreed to still holds, and refuse if not. A lower total goes through,
because nobody minds paying less. The screen then shows the new total and asks again.

**Python comparison:** the `version` column check in SQLAlchemy's `version_id_col`, or an
`UPDATE … WHERE version = :seen` that affects zero rows when someone else got there first.

## B3. All or nothing, including the surprises

`buyList` runs in one unit of work (lesson 06). Every line is priced first, so an unbuyable line
stops everything before any money moves. Then each line is bought; if the wallet runs out on line
3, `buyCopies` returns `InsufficientFunds`, `buyList` returns it, and the transaction rolls back
lines 1 and 2 as well.

The integration test for this found something instructive. It expected the balance to be back at
$50.00 afterwards, and got $0.00. Nothing was broken: a new player's **$50 starting grant is
credited lazily**, the first time their wallet opens, and the first time was _inside the purchase
that rolled back_. So the grant rolled back too, and is credited again next time. The rollback was
complete; the test's assumption wasn't. The fix was to assert what the rule actually promises (no
purchase entries, no cards, no store records) rather than a balance that depends on when the
wallet first opened.

**Lesson:** "nothing happened" includes things you didn't know were happening. Lazy side effects
inside a transaction share its fate.

## B4. One shared core, so two purchases can't drift

Buying one card (`buySingle`) and buying a list (`buyList`) must record purchases identically, or
the store's books (lesson 07's reconciliation) stop adding up. So the common part became one
function both call:

```ts
export async function buyCopies(
  services: StoreServices,
  input: Readonly<{ actor: Actor; line: SingleInput; quote: CheckedQuote; now: Date }>,
): Promise<Result<SingleReceipt, InsufficientFunds>> {
  // one store record → one wallet entry linked to it → the cards
}
```

`buySingle` checks one quote and calls it; `buyList` checks every quote and calls it per line. The
existing 31 store tests kept passing after the refactor, which is the evidence the extraction
changed nothing.

## B5. A resource used up across lines

"Only buy what I don't already own" sounds simple until a list mentions a card twice:

```text
4 Lightning Bolt
4 Lightning Bolt
```

With 5 owned, the right answer is "buy 0, then 3", not "buy 0, then 0" (counting the same 5
copies twice). The quote keeps a running copy of what's owned and **uses it up** line by line:

```ts
const ownedLeft = new Map(answers.owned);
// …for each line:
const covered = options.onlyMissing ? Math.min(owned, request.quantity) : 0;
ownedLeft.set(choice.oracleId, owned - covered);
```

`new Map(answers.owned)` copies the map first, so the caller's data isn't changed. Mutating an
argument would be a surprise for whoever calls the function next.

---

## Common mistakes

- **Sharing code by importing another module's internals.** If two modules need it and it owns no
  data, it's a library; move it, and say so in an ADR.
- **Letting a pure library import a framework "just this once".** Lint the boundary, or it erodes.
- **Validating untrusted patterns with a different engine than the one that runs them.**
- **Trusting prices (or totals) from the browser.** Send identifiers; look prices up on the server.
- **Charging more than the person agreed to.** Compare against the confirmed total; refuse if it
  rose.
- **Testing "nothing changed" with a value that has its own lazy history.** Assert the rule's
  actual promise.
- **Mutating an argument** to keep a running count. Copy first.

## Exercises

### 1. Predict the tree (warm-up)

What do `parseSearch("o:/draw (a|two)/ -t:instant")` and `parseSearch("a:/^rob")` return
(`node` and `notes`)?

<details><summary>Solution</summary>

```ts
// o:/draw (a|two)/ -t:instant
{
  kind: "and",
  children: [
    { kind: "term", term: { field: "oracle", comparison: ":", value: "draw (a|two)", isPattern: true } },
    { kind: "not", child: { kind: "term", term: { field: "type", comparison: ":", value: "instant" } } },
  ],
}
// notes: []

// a:/^rob   (never closed)
{ kind: "term", term: { field: "artist", comparison: ":", value: "/^rob" } }
// notes: []: an artist "containing /^rob", which finds nothing
```

The parentheses inside the pattern don't start a group, because the tokenizer is in pattern mode.
The unclosed pattern is the edge case from A3: worth a note in a future version.

</details>

### 2. Read the finish marker

Write `finishMarker(line)` returning the line without Moxfield's `*F*` / `*E*` marker (anywhere
after the name, any case) and the finish it meant:

```ts
finishMarker("1 Sol Ring (C21) 263 *F*"); // { rest: "1 Sol Ring (C21) 263", finish: "foil" }
finishMarker("2 Opt *e* (XLN) 65"); // { rest: "2 Opt (XLN) 65", finish: "etched" }
finishMarker("1 Ponder"); // { rest: "1 Ponder", finish: null }
```

<details><summary>Solution</summary>

```ts
function finishMarker(line: string): { rest: string; finish: "foil" | "etched" | null } {
  const marker = /\s*\*([FE])\*\s*/i.exec(line);
  if (marker === null) return { rest: line.trim(), finish: null };
  const rest = (
    line.slice(0, marker.index) +
    " " +
    line.slice(marker.index + marker[0].length)
  ).trim();
  return { rest, finish: marker[1].toUpperCase() === "F" ? "foil" : "etched" };
}
```

Replacing the marker with one space (not nothing) keeps `Opt` and `(XLN)` apart when the marker
sat between them; `trim()` tidies the ends.

</details>

### 3. Use owned copies up

Write `toBuy(requests, owned)`: for each `{ card, quantity }`, how many to buy when owned copies
cover what they can, each copy counted once. It must not change `owned`.

```ts
const owned = new Map([["bolt", 5]]);
toBuy(
  [
    { card: "bolt", quantity: 4 },
    { card: "bolt", quantity: 4 },
    { card: "opt", quantity: 2 },
  ],
  owned,
);
// [0, 3, 2], and owned.get("bolt") is still 5
```

<details><summary>Solution</summary>

```ts
function toBuy(requests: readonly Request[], owned: ReadonlyMap<string, number>): number[] {
  const left = new Map(owned);
  return requests.map((request) => {
    const have = left.get(request.card) ?? 0;
    const covered = Math.min(have, request.quantity);
    left.set(request.card, have - covered);
    return request.quantity - covered;
  });
}
```

`ReadonlyMap` in the signature makes the promise visible: TypeScript won't let the function call
`owned.set`.

</details>

### 4. The price you saw, or less

Write `confirm(expected, unitPrices, quantities)` returning `{ kind: "buy", total }` when the
total is at most `expected`, else `{ kind: "pricesChanged", total }`.

<details><summary>Solution</summary>

```ts
type Outcome = { kind: "buy"; total: number } | { kind: "pricesChanged"; total: number };
function confirm(
  expected: number,
  unitPrices: readonly number[],
  quantities: readonly number[],
): Outcome {
  const total = unitPrices.reduce((sum, price, index) => sum + price * quantities[index], 0);
  return total > expected ? { kind: "pricesChanged", total } : { kind: "buy", total };
}
// confirm(500, [100, 50], [3, 4]) → buy 500;  [90, 50] → buy 470;  [110, 50] → pricesChanged 530
```

</details>

### 5. Why did the grant roll back? (discussion)

In B3 the balance after a failed purchase was $0.00, not $50.00. Explain why that's correct, and
what would have been wrong if the grant had been credited _outside_ the purchase's transaction.

<details><summary>Solution</summary>

The grant is credited the first time a wallet opens, and that first time happened inside the
purchase's transaction. When the purchase failed, the rollback undid everything in it, the grant
included. That's correct: the player loses nothing, because the grant is credited again the next
time the wallet opens.

Crediting it in a separate, earlier transaction would also have been safe for this one rule. The
general danger is the other way round: anything an action does outside its own transaction
survives a rollback. Then a failed action can leave half its work behind, which is exactly what
"all or nothing" promises won't happen.

</details>

## Recap

- Code several modules need, with no data of its own, is a **shared library**; split it into a
  pure half and a database half, and **lint** the line between them.
- A tokenizer with **modes** reads quotes and patterns correctly; modes come with edge cases to pin
  down.
- Untrusted regular expressions: **compile, limit, and check what the database supports**, then
  pass them as parameters.
- Give page-dependent words their meaning through a **context**, not `if page == …`.
- A **quote** is a read model; a **purchase** re-prices everything and checks the **confirmed
  total** (optimistic concurrency).
- All or nothing includes **lazy side effects** inside the transaction.
- Extract the **shared core** of two use cases so their records can't drift; existing tests prove
  the refactor changed nothing.

## Further reading

- [Design doc 15](../docs/design/15-buy-a-list-and-card-search.md) and its implementation notes.
- [ADR 0017: one card search language](../docs/adr/0017-shared-card-search.md).
- Scryfall's [search reference](https://scryfall.com/docs/syntax), and this app's `/search-help`.
- PostgreSQL: [regular expression details](https://www.postgresql.org/docs/current/functions-matching.html#POSIX-SYNTAX-DETAILS)
  (what it supports, and how it differs from JavaScript's).
- Martin Fowler, [Optimistic Offline Lock](https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html).
