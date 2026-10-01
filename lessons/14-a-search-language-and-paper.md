# Lesson 14: A search language, a live screen, and paper

- **Phase:** 14 (deck builder 2.0 and proxy PDFs)
- **Prerequisites:** [Lesson 07](07-reading-data-and-keeping-books.md) (SQL from parts, URL
  state), [Lesson 08](08-animation-state-and-sound.md) (React state, effects),
  [Lesson 09](09-rules-as-data.md) (union types, parsing text)
- **Time:** 3–4 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Write a small **parser**: split text into tokens, build a **syntax tree** with recursive
   descent, and give `or` and `and` the right **precedence**.
2. Turn a tree into **parameterized SQL** by walking it with an exhaustive `switch`, and explain
   why nothing typed by a user is ever pasted into the SQL text.
3. Tell **"at least these"** from **"within these"** for sets of colors, in Python, TypeScript
   and SQL.
4. Keep server-only code out of the browser with a **client-safe module API**, and say what
   would go wrong without it.
5. Build a screen that changes **instantly** but saves on the server: an **optimistic update**,
   ignoring **stale responses**, **debouncing**, and **deriving** state instead of copying it.
6. Lay out **paper** in code: units, two coordinate systems, fitting a grid, mirroring for the
   back of a sheet, and using draw order as a tool.
7. Keep a side effect thin: a **pure layout** plus a renderer behind a port, with each image
   fetched once by a **worker pool**.

---

# Part A: A search language

The old deck builder had a type-ahead box: type part of a name, pick a card. Building a 100-card
deck from memory of names doesn't work, so the builder now searches the way Scryfall does:

```text
t:creature mv<=3 o:"draw a card"     creatures costing 3 or less that draw a card
id<=esper -t:land                    what a white-blue-black commander can play, but no lands
c:rw or c:rg                         red-white cards, or red-green ones
```

That's a tiny **language**: it has words, operators (`or`, `-` for "not"), grouping with
parentheses and quotes. Reading a language takes a **parser**: a function that turns text into a
structure the program can work with.

## A1. Two steps: tokens, then a tree

Parsing is easier in two steps.

1. **Tokenize:** split the text into **tokens**, the smallest meaningful pieces. Here a token is a
   word (with a note if it started with `-`), the word `or`, `(` or `)`.
2. **Parse:** arrange the tokens into a **syntax tree**: nodes that say "all of these", "either
   of these", "not this", or "this one condition".

For `t:creature -c:r or bolt`:

```text
tokens:  [word "t:creature"] [word "c:r", negated] [or] [word "bolt"]

tree:            or
               /    \
            and      name contains "bolt"
           /    \
  type has     not
  "creature"    |
             color: r
```

**Python comparison:** `shlex.split('o:"draw a card" t:creature')` is a tokenizer: it keeps a
quoted phrase together. `ast.parse("a or b and c")` is a parser: it returns a tree in which `and`
sits _under_ `or`, exactly as here.

## A2. The tree as a type

In TypeScript the tree is a **recursive union type**: each kind of node is one member, and some
members contain more nodes ([search.ts](../src/modules/decks/domain/search.ts)):

```ts
export type SearchNode =
  | Readonly<{ kind: "all" }> // an empty search matches everything
  | Readonly<{ kind: "term"; term: SearchTerm }>
  | Readonly<{ kind: "not"; child: SearchNode }>
  | Readonly<{ kind: "and"; children: readonly SearchNode[] }>
  | Readonly<{ kind: "or"; children: readonly SearchNode[] }>;
```

`SearchNode` mentions itself (`child: SearchNode`), which is what lets a tree be any depth. A
term is the leaf: `mv<=2` becomes `{ field: "manaValue", comparison: "<=", value: "2" }`.

**Python comparison:** a set of `@dataclass`es (`Term`, `Not`, `And`, `Or`) with
`Node = Term | Not | And | Or`, where `Not.child: "Node"`.

## A3. The tokenizer: quotes and a minus

The tokenizer walks the text one character at a time. Two details matter:

- Inside quotes, spaces don't end the word, so `o:"draw a card"` is one token. The quote marks
  themselves are dropped.
- A `-` at the start of a word means "not", but only when something follows it. A lone `-`, or
  the hyphen in `Will-o'-the-Wisp`, is just text.

```ts
let negated = false;
if (character === "-" && index + 1 < text.length && !/\s/.test(text[index + 1])) {
  negated = true;
  index++;
}
let word = "";
let inQuotes = false;
while (index < text.length) {
  const next = text[index];
  if (next === '"') inQuotes = !inQuotes;
  else if (!inQuotes && (/\s/.test(next) || next === "(" || next === ")")) break;
  else word += next;
  index++;
}
```

Then a word is split into keyword, comparison and value with one regular expression:
`/^([a-z]+)(<=|>=|!=|=|<|>|:)(.*)$/i`. The two-character comparisons come **first** in the
alternation, so `<=` is read as `<=` and not as `<` followed by a value starting with `=`.

## A4. Recursive descent, and why `and` binds tighter than `or`

`a b or c` should mean "(a and b) or c", as in SQL and Python. The rule that decides which
operator groups first is called **precedence**. A **recursive descent** parser gets it from its
shape: one function per level, and the lower-precedence level calls the higher one.

```ts
function parseOr(): SearchNode {
  const options: SearchNode[] = [parseAnd()];
  while (tokens[position]?.kind === "or") {
    position++;
    options.push(parseAnd());
  }
  return simplify({ kind: "or", children: options });
}

function parseAnd(): SearchNode {
  const parts: SearchNode[] = [];
  while (position < tokens.length) {
    const token = tokens[position];
    if (token.kind === "or" || token.kind === "close") break;
    position++;
    if (token.kind === "open") {
      const inner = parseOr();
      // …expects a ")" next, or notes that one is missing
      parts.push(inner);
    } else if (token.kind === "word") {
      const node = wordNode(token.text, notes);
      if (node !== null) parts.push(token.negated ? { kind: "not", child: node } : node);
    }
  }
  return simplify({ kind: "and", children: parts });
}
```

Read it as a recipe:

- A search is one or more **and-groups** separated by `or` (`parseOr`).
- An and-group is words side by side, until an `or` or a `)` (`parseAnd`).
- A `(` starts a whole new search inside the group (`parseOr` again). That's the "recursive"
  part: parentheses can nest as deep as you like.

`position` is shared by both functions (they're nested inside `parseSearch`, so they see its
variables), so each one picks up where the other stopped. `simplify` tidies the result: an "and"
of one thing is that thing, and an "and" of nothing is `{ kind: "all" }`.

> **Try it:**
>
> ```sh
> pnpm exec tsx -e 'import("./src/modules/decks/domain/search.ts").then((search) => console.dir(search.parseSearch("(t:elf or t:goblin) mv<=2").node, { depth: null }))'
> ```
>
> The result is an `and` whose first child is the `or` from inside the parentheses.

## A5. Forgiving, like Scryfall

A strict parser stops at the first mistake. A search box shouldn't: `t:creature colour:u` (a
British spelling) should still find creatures. So `wordNode` returns `null` for a part it can't
read and pushes a **note** instead:

```ts
const field = KEYWORDS[keyword];
if (field === undefined) {
  notes.push(`Unknown keyword "${keyword}${comparison}" (ignored)`);
  return null;
}
```

The builder shows the notes under the box ("Unknown keyword "colour:" (ignored)"). The
principle: **report what you ignored**. Silently dropping part of a search shows results that
look right but aren't.

## A6. From tree to SQL, safely

[search-sql.ts](../src/modules/decks/queries/search-sql.ts) walks the tree with a `switch` on
`kind`, calling itself for children:

```ts
export function searchCondition(node: SearchNode, context: SearchContext): SQL {
  switch (node.kind) {
    case "all":
      return sql`true`;
    case "not":
      return sql`not (${searchCondition(node.child, context)})`;
    case "and":
      return sql`(${sql.join(
        node.children.map((child) => searchCondition(child, context)),
        sql` and `,
      )})`;
    // "or" is the same with ` or `; "term" turns one condition into SQL
  }
}
```

Two things keep this safe and complete.

**Exhaustive switch.** The function promises to return `SQL`. If someone adds a sixth node kind
and forgets a `case`, TypeScript reports that the function can end without returning. The
compiler finds the missing case for you.

**Parameters, never pasted text.** Inside a `sql` template, each `${value}` is sent to Postgres
as a **parameter** (`$1`, `$2`…), separately from the SQL text, so a search for
`'; drop table printings; --` is only ever a string to compare against. The one exception is
`sql.raw`, which pastes text into the SQL. It's used for the comparison operator, and only from a fixed table:

```ts
const NUMERIC_OPERATORS: Readonly<Record<Comparison, string>> = {
  ":": "=",
  "=": "=",
  "!=": "<>",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
};
// …
return sql`p.mana_value ${sql.raw(NUMERIC_OPERATORS[comparison])} ${Number(value)}`;
```

`comparison` can only be one of seven strings (the parser's regular expression guarantees it,
and the type says so), and each maps to a known operator. **Raw SQL is fine when its text comes
from your code, never from the user.**

One more detail: `ILIKE '%bolt%'` treats `%` and `_` in the search as wildcards. `containing()`
escapes them, so searching for `100%` finds "100%", not everything starting with "100".

**Python comparison:** SQLAlchemy's `and_(*conditions)`, `or_()` and `not_()` build the same
kind of tree, with values bound as parameters.

## A7. "At least these" and "within these"

Scryfall reads colors in two ways, and so do we:

- `c:rw`: the card's **colors include** red and white (red-white, Mardu, five-color…).
- `id<=rw`: the card's **color identity is within** red and white (red, white, red-white,
  colorless): what a Boros commander may play.

These are the two subset tests. Python has them as operators on sets:

```python
{"R", "W", "B"} >= {"R", "W"}   # True: at least red and white
{"R"} <= {"R", "W"}             # True: within red and white
```

Postgres has them for arrays: `@>` ("contains") and `<@` ("is contained by"):

```ts
const atLeast = sql`${column} @> ${colors}`;
const within = sql`${column} <@ ${colors}`;
```

**Color identity counts the rules text.** _Wick, the Whorled Mind_ costs {3}{B}, but its text has
an ability costing {U}{B}{R}, so its identity is blue-black-red. A blue-red commander can't play
it, even though it costs only black. We don't compute identity ourselves: Scryfall's
`color_identity` already includes the text box, and we store it. Wick is in the test fixtures
so an integration test pins this (`tests/integration/browse.int.test.ts`).

---

# Part B: A screen that changes instantly

## B1. What may run in the browser

A Next.js page can mix **server components** (run on the server, may read the database) and
**client components** (files starting with `"use client"`, which run in the browser too). Every
module a client component imports is shipped to the browser in its **bundle**, the JavaScript
the browser downloads.

The deck statistics are computed in the browser so they change the moment a card goes in. They
live in the decks module's domain, which is pure. But the module's public API,
`@/modules/decks` (its `index.ts`), also exports queries that import the database driver. If a
client component imported `deckStats` from there, the bundler would try to pull the Postgres
driver into the browser.

So the module has a second door, [client.ts](../src/modules/decks/client.ts), which re-exports
**only pure domain code** ([ADR 0016](../docs/adr/0016-client-safe-module-api.md)). The lint
rules enforce it: `client.ts` may not import application, queries or infrastructure code.

```ts
// A client component:
import { deckStats, mainType, TYPE_ORDER } from "@/modules/decks/client";
// A type is fine from anywhere: `import type` disappears when compiled.
import type { BrowseCard, DeckLine } from "@/modules/decks";
```

**Python comparison:** none quite, because Python code doesn't get shipped to browsers. The
nearest is keeping a library's pure helpers in a module that doesn't `import psycopg`, so a tool
that only needs the helpers doesn't need a database driver installed.

## B2. Optimistic updates, and answers that arrive late

When you press "+" on a deck line, the builder doesn't wait for the server. It changes its own
copy of the deck first, which is an **optimistic update**, then asks the server to save it. The
server answers with the deck as it now really is, and that replaces the guess:

```ts
const request = ++latestChange.current;
setDeck((current) => ({ ...current, lines: /* the line with its new quantity */ }));
startSaving(async () => {
  const result = await setQuantityAction({ deckId, ...change });
  if (request !== latestChange.current) return; // a later change will bring the fresh deck
  if (result.ok) setDeck(result.deck);
  else setMessage({ tone: "error", text: result.message });
});
```

Press "+" three times quickly and three requests are in flight. Their answers may arrive in any
order. If the answer to the _first_ click landed last, it would overwrite the deck with an older
state. The counter fixes that: each request remembers its number, and only the **latest**
request's answer is used. Older ones are **stale responses**.

`latestChange` is a `useRef`: a box React keeps between renders that, unlike state, doesn't
cause a re-render when it changes. That suits a counter nobody sees.

The browsing grid uses the same trick (`latestBrowse`), because typing "b", "bo", "bol" starts
three searches, and the answer for "b" must not replace the answer for "bol".

**Python comparison:** with `asyncio`, three `create_task(fetch(...))` calls finish in any
order; you'd keep a generation number and ignore results from older generations.

## B3. Debounce: wait for a pause

Searching on every keystroke would send a request per letter. **Debouncing** waits until typing
pauses:

```ts
useEffect(() => {
  const timer = setTimeout(() => setWaitedSearch(search), WAIT_MILLISECONDS);
  return () => clearTimeout(timer);
}, [search]);
```

Each keystroke changes `search`, so React runs the **cleanup** (`clearTimeout`) of the previous
effect before starting a new timer. Only when 250 ms pass with no keystroke does
`waitedSearch` change, and the search runs.

## B4. Derive state; don't copy it in an effect

The first version set "loading" inside the effect that started a search:

```ts
useEffect(
  () => {
    setBrowse((current) => ({ ...current, loading: true })); // flagged by the linter
    void (browseAction(/* … */).then(/* … */));
  },
  [/* filters */],
);
```

React's linter flags `setState` called directly inside an effect: React has just finished
rendering, and this makes it render again straight away for something it could have known
already. The fix is to **derive** the value. The results remember which filters produced them,
and "loading" is simply "the results are for different filters than the ones on screen":

```ts
const filters = JSON.stringify([waitedSearch, colors, includeColorless, showEverything, sort]);
// …
const isFirstPageLoading = browse.filters !== filters;
```

There's no `loading` flag left to forget to reset. The same idea appears when the commander
changes. The color filter should reset to the new commander's colors, and rather than an effect,
the component notices the change while rendering:

```ts
const commanderKey = (deck.commanderColors ?? []).join("");
const [seenCommanderKey, setSeenCommanderKey] = useState(commanderKey);
if (commanderKey !== seenCommanderKey) {
  setSeenCommanderKey(commanderKey);
  setColors(startingColors(deck.commanderColors));
}
```

**Rule of thumb:** if a value can be computed from other state, compute it. Store only what
can't be.

## B5. Infinite scroll

The grid loads 60 cards at a time. An empty `<div>` sits after the last card, and an
**IntersectionObserver** (a browser feature that calls you back when an element scrolls into
view) loads the next page when that `<div>` comes within 600 pixels of the screen. Calling
`setState` there is fine: it happens in a callback from the outside world, which is what effects
are for.

---

# Part C: Paper

## C1. Units and two coordinate systems

A PDF measures in **points**: 72 to the inch. A Magic card is 2.5 × 3.5 inches, so 180 × 252
points. Millimeters convert with 72 / 25.4.

```ts
export const POINTS_PER_INCH = 72;
export const POINTS_PER_MILLIMETER = POINTS_PER_INCH / 25.4;
export const CARD_WIDTH = 2.5 * POINTS_PER_INCH;
export const CARD_HEIGHT = 3.5 * POINTS_PER_INCH;
```

A PDF page's origin (0, 0) is its **bottom-left** corner, and y grows **upwards**, as in maths.
The screen (and SVG) puts the origin at the **top-left**, with y growing **downwards**. The
options page draws a preview of the first page as SVG from the same numbers the PDF uses, so it
flips the picture once:

```tsx
<g transform={`translate(0 ${firstPage.height}) scale(1 -1)`}>
```

`scale(1 -1)` mirrors y; `translate` moves the mirrored picture back onto the page. Keeping one
coordinate system in the layout code and converting at the edge is the same idea as storing
money as cents and formatting only for display.

## C2. How many cards fit

Cards sit in a grid, a `gap` apart, at least a `margin` from the paper's edge (home printers
can't print right to the edge). For one direction:

```ts
function fitting(length: number, slot: number, gap: number): number {
  return Math.max(0, Math.floor((length - 2 * PAGE_MARGIN + gap) / (slot + gap)));
}
```

Why `+ gap`? _n_ cards need _n_ slots but only _n − 1_ gaps: `n·slot + (n − 1)·gap ≤ available`.
Add one gap to both sides and it becomes `n·(slot + gap) ≤ available + gap`, which divides
neatly. On Letter with no bleed, three columns and three rows fit. With 1/8 inch of **bleed**
(extra image around each card so a slightly-off cut shows no white), each slot grows by a
quarter inch and three rows no longer fit. So `sheetGrid` also tries the page **sideways** and
keeps whichever holds more.

> **Try it:** in the proxy options, switch bleed on and watch the summary change from "9 to a
> page" to "6 to a page (sideways)".

## C3. Mirroring for the back of the sheet

Double-faced cards print their fronts on one page and their backs on the next. Print those two
pages on one sheet (two-sided), and each back must land exactly behind its front. Turning the
sheet over swaps left and right, so the back of the card in column 0 must sit in the **last**
column:

```ts
const column = face === "front" ? frontColumn : grid.columns - 1 - frontColumn;
```

The rows don't change, because the flip is around the vertical middle (flip on the long edge for
an upright page). Because the grid is centered, mirroring the column is the same as mirroring
the x position: `back.x = pageWidth − front.x − cardWidth`. A unit test checks exactly that.

## C4. Draw order as a tool

Corner marks show where to cut. They must never be printed **on** a card. Working out every
mark's length so it stops before the neighboring card is fiddly, and wrong as soon as bleed or
the gap changes. Instead, the renderer draws all guides **first** and the cards **on top**. A
mark that reaches under a card is simply covered, so only the parts outside cards show. The
layout stays simple, and the test checks the property that matters: no guide runs across a
card's face.

## C5. A pure layout and a thin renderer

All of the above is one pure function, `proxyPages(cards, options)`, which returns pages of
boxes and lines. No PDF library, no images, so every position is unit-tested in milliseconds.
Drawing is behind a port:

```ts
export interface ProxyPdfRenderer {
  render(pages: readonly ProxyPage[], images: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array>;
}
```

The real renderer ([pdf-lib-renderer.ts](../src/modules/decks/infrastructure/pdf-lib-renderer.ts))
just paints: lines, then images. The use case
([proxy-sheets.ts](../src/modules/decks/application/proxy-sheets.ts)) fetches each image
**once**, however many copies print. Four Lightning Bolts share one image, embedded once in the
PDF and drawn four times. It fetches with a small **worker pool**: six workers take the next
image from a shared queue until it's empty.

```ts
const queue = [...wanted.entries()];
async function worker() {
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const [key, placement] = next;
    const bytes = await images.image(placement.printingId, placement.face);
    if (bytes !== null) fetched.set(key, bytes);
  }
}
await Promise.all(Array.from({ length: IMAGES_AT_ONCE }, worker));
```

JavaScript runs one piece of code at a time, so two workers can never `shift()` the same item:
each `shift()` finishes before another worker gets a turn. They only interleave at `await`.

**Python comparison:** `asyncio.Semaphore(6)` around each fetch, or a pool of six tasks reading
from an `asyncio.Queue`.

**Tests never touch the network**, even here: the unit tests use a real 8 × 8 JPEG from
`tests/fixtures/images/card.jpg`, and the browser tests put that JPEG in their image cache for
every printing, so the PDF route finds every image already "downloaded".

---

## Common mistakes

- **Precedence by accident.** Parsing words left to right into one list makes `a b or c` mean
  "a and (b or c)". One function per precedence level, lower calling higher, gets it right.
- **Pasting user text into SQL** "because it's only an operator". Map it through a fixed table
  first; then `sql.raw` only ever sees your own strings.
- **Trusting the last answer to arrive.** Requests finish in any order. Number them and keep only
  the latest.
- **Copying state in effects.** A flag set in one effect and cleared in another drifts. Derive it
  from what you already have.
- **Importing a module's whole API into a client component.** Pure helpers must come from a
  client-safe entry point, or the database driver ends up in the bundle (or the build fails).
- **Mixing coordinate systems.** Pick one (PDF's, here) for all the maths, and convert once at the
  edge.
- **Calculating your way around overlaps** that draw order can solve.

## Exercises

### 1. Predict the tree (warm-up)

What does `parseSearch("t:creature -c:r or bolt").node` return? And what are the `node` and
`notes` for `parseSearch("mv<=two")`?

<details><summary>Solution</summary>

```ts
{
  kind: "or",
  children: [
    {
      kind: "and",
      children: [
        { kind: "term", term: { field: "type", comparison: ":", value: "creature" } },
        { kind: "not", child: { kind: "term", term: { field: "color", comparison: ":", value: "r" } } },
      ],
    },
    { kind: "term", term: { field: "name", comparison: ":", value: "bolt" } },
  ],
}
```

`and` binds tighter, so the `or` is at the top. For `mv<=two`, `node` is `{ kind: "all" }` and
`notes` is `['"two" isn't a number (ignored)']`: the only term was dropped, and an empty search
matches everything.

</details>

### 2. A4 with bleed

Using `sheetGrid`, how many cards fit on A4 with 1/8 inch bleed and the default 2 mm gap? Is the
page upright or sideways? Work it out with `fitting` by hand first (A4 is 595.3 × 841.9 points;
a slot with bleed is 198 × 270), then check in `tsx`.

Hint: try both orientations, as `sheetGrid` does.

<details><summary>Solution</summary>

Upright: columns `floor((595.3 − 18 + 5.67) / (198 + 5.67)) = 2`, rows
`floor((841.9 − 18 + 5.67) / (270 + 5.67)) = 3`, so 6. Sideways: columns
`floor((841.9 − 18 + 5.67) / 203.67) = 4`, rows `floor((595.3 − 18 + 5.67) / 275.67) = 2`, so 8.
Sideways wins: **4 × 2 = 8 cards**, two more than Letter's 6.

```ts
sheetGrid({ ...DEFAULT_PROXY_OPTIONS, paper: "a4", bleed: "eighthInch" });
// { width: 841.88…, height: 595.27…, columns: 4, rows: 2 }
```

</details>

### 3. Mirror a column

On a sideways sheet with 4 columns, a double-faced card's front is in column 1. Which column is
its back in? If the page is 792 points wide and the front's x is 100 with a card width of 180,
what is the back's x?

<details><summary>Solution</summary>

Column `4 − 1 − 1 = 2`. The x is `792 − 100 − 180 = 512`: the same distance from the right edge
as the front is from the left.

</details>

### 4. Only the latest answer

Write `latestOnly(work)`: it wraps an async function so that when calls overlap, only the most
recent call's result comes back; older calls resolve to `null`. Check it:

```ts
const wait = (milliseconds: number, value: string) =>
  new Promise<string>((resolve) => setTimeout(() => resolve(value), milliseconds));
const search = latestOnly((text: string) => wait(text === "b" ? 50 : 10, text));
const [first, second] = await Promise.all([search("b"), search("bo")]);
// first === null, second === "bo"
```

Hint: a counter in the closure, as in B2.

<details><summary>Solution</summary>

```ts
function latestOnly<Input, Output>(work: (input: Input) => Promise<Output>) {
  let latest = 0;
  return async function run(input: Input): Promise<Output | null> {
    const call = ++latest;
    const result = await work(input);
    return call === latest ? result : null;
  };
}
```

The "b" search is slower and finishes last, but by then `latest` is 2, so its result is thrown
away. Without the check, the grid would show results for "b" while the box says "bo".

</details>

### 5. A worker pool that keeps order (challenge)

Write `mapWithLimit(items, limit, work)`: like `Promise.all(items.map(work))`, but never more
than `limit` calls running at once, and results in the same order as `items`. Test it with a
counter of running calls, and with an empty list.

Hint: start `limit` workers; each takes the next index until none are left, and writes its
result at that index.

<details><summary>Solution</summary>

```ts
async function mapWithLimit<Item, Result>(
  items: readonly Item[],
  limit: number,
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
```

```ts
let running = 0;
let most = 0;
const doubled = await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
  running++;
  most = Math.max(most, running);
  await new Promise((resolve) => setTimeout(resolve, 10 - n));
  running--;
  return n * 2;
});
// doubled: [2, 4, 6, 8, 10, 12, 14]; most: 3
```

`next++` reads and increases in one step, and no other worker runs in between (there's no
`await` inside it), so each index is taken once. Writing to `results[index]` instead of pushing
keeps the order even though later items (shorter waits) finish first.

</details>

### 6. Why not check problems in the browser too? (discussion)

The statistics change instantly because they're computed in the browser. The problem list
("not legal in Commander", "you own 1, the deck has 3") updates only when the server answers.
`deckProblems` is pure too. What would it take to run it in the browser, and what could go
wrong?

<details><summary>Solution</summary>

It needs each card's rules (legalities, color identity, type line) and how many you own, sent
with the deck; then `client.ts` could export `deckProblems`. The risk is two answers disagreeing:
the browser's copy of ownership can be out of date (another tab sold a card), so the browser
might say "ready to play" while the server, which checks against the database, disagrees. That's
fine if the server stays the judge and the browser's answer is only a quick preview. It's in
`docs/future-ideas.md`.

</details>

## Recap

- A parser goes text → **tokens** → **tree**. Recursive descent gives precedence by its shape:
  `parseOr` calls `parseAnd`, and parentheses call `parseOr` again.
- A forgiving parser **notes** what it ignored instead of failing.
- Walk the tree with an **exhaustive switch** into SQL; values are **parameters**, and `sql.raw`
  only ever sees text from a fixed table in your code.
- "At least" is `>=` / `@>`, "within" is `<=` / `<@`. Color identity includes the rules text.
- Pure code for the browser comes through **`client.ts`**, so server code stays out of the bundle.
- Change the screen first (**optimistic**), save, then take the server's answer, but only the
  **latest** one. **Debounce** typing. **Derive** state rather than copying it in effects.
- Paper is maths in **points** with the origin at the bottom-left. A grid fits
  `floor((length − 2·margin + gap) / (slot + gap))`; backs go in column `columns − 1 − column`;
  draw guides under the cards.
- A **pure layout** plus a thin renderer behind a port is easy to test; a **worker pool** fetches
  each image once.

## Further reading

- [Design doc 14](../docs/design/14-deck-builder.md) and its implementation notes.
- [ADR 0016: a client-safe module API](../docs/adr/0016-client-safe-module-api.md).
- Scryfall's [search syntax reference](https://scryfall.com/docs/syntax), the model for ours.
- React: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).
- [pdf-lib](https://pdf-lib.js.org/), and the PDF coordinate system in its docs.
- Crafting Interpreters, chapter 6, ["Parsing Expressions"](https://craftinginterpreters.com/parsing-expressions.html):
  recursive descent explained slowly.
