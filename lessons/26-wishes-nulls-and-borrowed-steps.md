# Lesson 26: Wishes, nulls, and borrowed steps

- **Phase:** 26 (a wishlist for singles: save a card you can't afford yet, see when you can, buy
  it in one click)
- **Prerequisites:** [Lesson 06](06-transactions-across-modules.md) (one transaction across
  modules), [Lesson 15](15-one-language-many-pages.md) (quote vs purchase, optimistic
  concurrency), [Lesson 20](20-suggesting-cards.md) (comparator chains, filter in SQL / rank in
  TypeScript)
- **Time:** 1¼ hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Explain why a plain `unique` constraint lets duplicate rows through when a column is `null`,
   and fix it with **partial unique indexes**.
2. Store a **discriminated union** in one table (a nullable column says which kind) and turn
   rows back into the union with one function.
3. Get the compiler's **exhaustiveness check** to work when you switch on a property of a value
   that has already been narrowed.
4. Reuse another module's step **inside your own transaction**, with a price guard that refuses
   a rise but accepts a drop.
5. Round **up** in integer arithmetic (paydays to go) without floats going wrong, and sort with a
   comparator chain that puts `true` first.
6. Keep code that the server calls out of a `"use client"` file, and keep a form's message on
   screen when the form itself disappears.

---

# Part A: One row per wish, and the trouble with `null`

## A1. Two kinds of wish in one table

A wish is either "this card, any printing" or "this exact printing". In TypeScript that's a
discriminated union (lesson 01):

```ts
type WishTarget =
  | Readonly<{ kind: "anyPrinting"; oracleId: string; finish: FinishPreference }>
  | Readonly<{ kind: "exactPrinting"; oracleId: string; printingId: string; finish: Finish }>;
```

The table doesn't need a `kind` column. `printing_id` is `null` for "any printing" and set for an
exact one, so the null already says which kind it is
([schema.ts](../src/modules/wishlist/infrastructure/schema.ts)). Fewer columns means fewer ways
for two columns to disagree.

## A2. "One wish per target", and why `unique` isn't enough

Rule 1 says a player has at most one wish per target. The obvious constraint is:

```sql
unique (user_id, oracle_id, printing_id, finish)
```

It doesn't work for "any printing" wishes. In SQL, `null` means "unknown", and two unknowns are
never equal, so the database treats two rows with `printing_id = null` as **different**. This was
checked against Postgres while writing the lesson:

```sql
create table plain (user_id text, card text, deck_id int, unique (user_id, card, deck_id));
insert into plain values ('jack', 'bolt', null), ('jack', 'bolt', null);  -- both go in!
```

Python has the same idea in `float("nan") != float("nan")`: a value that isn't equal to itself
can't be caught by an equality check.

## A3. Partial unique indexes

A **partial index** covers only the rows matching its `where`. Two of them, one per kind, each
compare only the columns that kind uses:

```sql
create unique index wishes_any_printing_idx on wishes (user_id, oracle_id, finish)
  where printing_id is null;
create unique index wishes_exact_printing_idx on wishes (user_id, printing_id, finish)
  where printing_id is not null;
```

The first never sees `printing_id`, so its null can't get in the way. In Drizzle it's
``uniqueIndex(…).on(…).where(sql`…`)``. Another fix is an index over
`coalesce(printing_id, '')`, which turns null into a real value. The partial indexes say more
plainly what the rule is.

A `check` constraint ties each kind to the finishes it allows ("cheapest" only for any
printing, "etched" only for an exact one), so the database refuses a row no code should write.

**Try it:** `pnpm test:int tests/integration/wishlist.int.test.ts`. The test "allows one wish
per target" inserts a second "any printing" row by hand and expects Postgres to refuse it.

## A4. From a row back to the union

One function reads a stored row
([wish.ts](../src/modules/wishlist/domain/wish.ts), `wishFromStored`):

```ts
const target: WishTarget =
  row.printingId === null
    ? { kind: "anyPrinting", oracleId: row.oracleId, finish: preference(row.finish) }
    : {
        kind: "exactPrinting",
        oracleId: row.oracleId,
        printingId: row.printingId,
        finish: printingFinish(row.finish),
      };
```

`preference` and `printingFinish` turn the `text` column into the union's literal types by
finding it in a list, and **throw** if it isn't there. The CHECK constraint makes that
impossible, so it's a defect, not an expected failure, which is why it isn't a `Result`
(conventions: defects throw). The repository and the page's queries both use this one function,
so no reader can disagree about what a null means.

---

# Part B: The compiler and a narrowed value

## B1. A check that didn't compile

`fits` answers "does this printing fill the wish?". The first version was:

```ts
if (target.kind === "exactPrinting") return; /* … */
switch (target.finish) {
  case "nonfoil":
    return copy.finish === "nonfoil";
  case "foil":
    return copy.finish !== "nonfoil";
  case "cheapest":
    return true;
  default:
    return assertNever(target.finish); // error: Property 'finish' does not exist on type 'never'
}
```

`assertNever(x)` only compiles when `x` has the type `never`, meaning "no value is left". That's
how adding a fourth preference later becomes a compile error here. But TypeScript narrows the
**variable you switch on**. Here that's `target.finish`, and in `default` it narrowed `target`
itself to `never`. Reading `.finish` from `never` is the error.

## B2. Switch on a variable of its own

```ts
const preference = target.finish;
switch (preference) {
  // …the same cases…
  default:
    return assertNever(preference); // preference: never
}
```

Now the narrowed thing is `preference`, a plain string-literal union, and `default` sees it as
`never`, as intended. Python's `match` with `typing.assert_never` behaves the same way: put the
value you're checking in a variable of its own.

---

# Part C: Borrowing another module's step

## C1. Buying is the store's job

Buying from the wishlist must charge the same price, write the same ledger entry and store
record, and add the same cards as the card page's Buy button (rule 6). Copying that code into
the wishlist would make two places to keep in step. Calling `store.buySingle` won't do either: it
opens **its own** transaction, so "buy, then delete the wish" would be two transactions, and a
crash between them would leave a bought card still wished for.

Lesson 12's reset showed the answer: a module exports a function that runs **inside the
caller's** transaction, taking the caller's `services`. The store now has
([singles.ts](../src/modules/store/application/singles.ts)):

```ts
export async function buySingleIn(
  services: StoreServices,
  input: BuySingleInInput, // actor, line, maxUnitPrice, now
): Promise<Result<SingleReceipt, BuySingleInError>>;
```

and `buyWish` ([buy-wish.ts](../src/modules/wishlist/application/buy-wish.ts)) runs one unit of
work: lock the player's wishlist, check the wish, `buySingleIn`, then delete the wish if it's now
filled. Any error returned along the way rolls back all of it. Its dependency type says what it
needs: `UnitOfWork<WishlistServices & StoreServices>`, an intersection (lesson 06).

`buySingle` and `buySingleIn` share a small private helper, `quoteForSale` (priced, and from an
enabled set), so the rules about what the store sells are written once.

## C2. A guard that refuses a rise but not a drop

The Wishlist page shows a price, and the player clicks Buy later. The nightly sync might change
the price in between. Lesson 15's Buy a list sent the total it showed and refused if the real
total was **higher**. The wishlist does the same per copy:

```ts
if (input.maxUnitPrice !== null && quote.price > input.maxUnitPrice) {
  return err({ kind: "PricesChanged", total: totalPrice(quote.price, quantity.value) });
}
```

Only a rise matters: nobody minds paying less than they agreed to. `null` means "no limit",
which is how the card page's Buy still works. That is optimistic concurrency again: no lock
while the player looks, and a check when they act.

**Try it:** in [wishlist.test.ts](../src/modules/wishlist/application/wishlist.test.ts), the
tests "refuses when the price has gone up" and "buys at a lower price" each change a fake price
after the wish was added.

---

# Part D: Small arithmetic, and an order

## D1. Paydays to go: rounding up

"You're $3.84 short and get $2.50 a week" needs 2 paydays: divide, and round **up**. With whole
cents, `Math.ceil(shortfall / allowance)` is safe. Both are integers well below 2⁵³, and the
division's error is far too small to push an exact quotient over a whole number. Python writes
the integer version as `-(-a // b)`. A float-free TypeScript one is
`Math.floor((a + b - 1) / b)` (exercise 1).

The date of the last payday is the next payday plus `count − 1` periods
([lines.ts](../src/modules/wishlist/domain/lines.ts), `paydaysToGo`). Two property tests pin it
down: the paydays cover the shortfall and one fewer wouldn't, and a bigger allowance never needs
more.

## D2. A comparator chain with booleans

The page's order is "at target first, then affordable, then the smallest shortfall…":

```ts
return (
  Number(b.atTarget) - Number(a.atTarget) ||
  STATUS_ORDER[a.status.kind] - STATUS_ORDER[b.status.kind] ||
  shortfallOf(a) - shortfallOf(b) ||
  b.wish.createdAt.getTime() - a.wish.createdAt.getTime()
);
```

`Number(true)` is 1. Subtracting `a` from `b` puts `true` first. Each step returns 0 on a tie, and
`||` moves on to the next step (lesson 20). In Python you'd write a key tuple:
`sorted(lines, key=lambda l: (not l.at_target, ORDER[l.status], l.shortfall))`.

The SQL only **gathers**: every printing for sale of the wished cards, and what the player owns
of them ([for-sale.ts](../src/modules/wishlist/queries/for-sale.ts)). TypeScript **decides**
which offer fits each wish, what it costs and where it sorts. That keeps the rules in one pure
function that unit tests can reach without a database (lesson 20's "filter in SQL, rank in
TypeScript").

---

# Part E: Server, client, and a form that vanishes

## E1. A `"use client"` file is a different world

`offerLabel(offer)` ("M3C #217 · foil") was first written in the forms file, which starts with
`"use client"`. The Wishlist page, a Server Component, called it, and the page crashed:

> Attempted to call offerLabel() from the server but offerLabel is on the client.

Everything a `"use client"` file exports becomes a **client reference**. The server may render
such a component or pass it props, but it can't **call** the function. A plain helper that both
sides need belongs in a file with no directive. Here that's
[labels.ts](../src/app/wishlist/labels.ts), which the page and the forms both import. Type
checking can't catch this; only running the page does, which is one reason for end-to-end tests.

## E2. When the form disappears with its message

The Buy form shows "Bought for $23.84" through `useActionState`. That message lives in the form
component. Buying the last missing copy removes the wish, so its row, its form and the message
all disappear when the page refreshes. The player would see the card vanish without being
told why.

The action therefore **redirects** after a purchase that fills the wish:
`redirect("/wishlist?bought=…&paid=…")`. The page reads those parameters and shows a banner. This
is the old **Post/Redirect/Get** pattern: after a change, send the browser to a page that shows
the result, so the message doesn't depend on the form still being there. (`redirect` works by
throwing, so call it outside any `try` that might catch it.)

---

## Common mistakes

- **Trusting `unique` with nullable columns.** Null is never equal to null, so duplicates get
  in. Use partial unique indexes, or index an expression that turns null into a value.
- **Two columns for one fact.** A `kind` column next to a nullable `printing_id` can disagree.
  Derive one from the other, or add a CHECK that ties them together.
- **`assertNever(obj.field)` after narrowing `obj`.** Copy the field into a variable and switch
  on that.
- **Calling another module's use case from inside your transaction.** It opens its own. Ask the
  module for an in-transaction function instead (`buySingleIn`, `deleteWishlist`).
- **A price guard that refuses any change.** Refusing a drop only annoys people. Compare with
  `>`.
- **Helpers in `"use client"` files.** The server can render client components, not call client
  functions.

## Exercises

### 1. Warm-up: rounding up without floats

Write `ceilDivide(numerator, denominator)` for whole numbers (`denominator > 0`) using only
`Math.floor`, `+`, `-` and `/`. `ceilDivide(384, 250)` is 2, `ceilDivide(500, 250)` is 2, and
`ceilDivide(0, 250)` is 0.

_Hint:_ adding `denominator − 1` before dividing pushes any remainder over the next whole number.

<details><summary>Solution</summary>

```ts
function ceilDivide(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator - 1) / denominator);
}
```

A property test confirms it agrees with `Math.ceil(a / b)` for whole `a` from 0 to 10⁹ and `b`
from 1 to 10⁶. Python: `-(-a // b)`, or `(a + b - 1) // b`.

</details>

### 2. A comparator chain

Sort `{ name, price, atTarget }` rows: at target first, then cheapest, then by name.

<details><summary>Solution</summary>

```ts
type Row = Readonly<{ name: string; price: number; atTarget: boolean }>;
function byWishOrder(a: Row, b: Row): number {
  return (
    Number(b.atTarget) - Number(a.atTarget) || a.price - b.price || a.name.localeCompare(b.name)
  );
}
// [b $5, a $5, c $900 at target, d $1] → c, d, a, b
```

</details>

### 3. Partial unique indexes

A `pins` table holds `(user_id, card, deck_id)`. `deck_id` null means "pinned in every deck".
Allow one "every deck" pin per card, and one pin per card per deck. Write the indexes, and say
what a plain `unique (user_id, card, deck_id)` would let through.

<details><summary>Solution</summary>

```sql
create unique index pins_everywhere on pins (user_id, card) where deck_id is null;
create unique index pins_per_deck on pins (user_id, card, deck_id) where deck_id is not null;
```

Checked in a transaction on the test database: a second `('jack', 'bolt', null)` is refused by
`pins_everywhere`, and a second `('jack', 'bolt', 1)` by `pins_per_deck`. With the plain
constraint instead, two `('jack', 'bolt', null)` rows both go in.

</details>

### 4. Challenge: a union in a nullable column, both ways

Reminders are "someday" or "due at a time". The table stores `text` and `due_at` (null for
someday). Write the union type, `reminderFromStored(row)`, and `reminderToStored(reminder)` with
an exhaustive `switch`. Check that reading back what you stored gives the same reminder.

<details><summary>Solution</summary>

```ts
type Reminder =
  Readonly<{ kind: "someday"; text: string }> | Readonly<{ kind: "dueAt"; text: string; at: Date }>;
type StoredReminder = Readonly<{ text: string; dueAt: Date | null }>;

function reminderFromStored(row: StoredReminder): Reminder {
  return row.dueAt === null
    ? { kind: "someday", text: row.text }
    : { kind: "dueAt", text: row.text, at: row.dueAt };
}

function reminderToStored(reminder: Reminder): StoredReminder {
  switch (reminder.kind) {
    case "someday":
      return { text: reminder.text, dueAt: null };
    case "dueAt":
      return { text: reminder.text, dueAt: reminder.at };
    default:
      return assertNever(reminder);
  }
}
```

Here `switch (reminder.kind)` narrows `reminder` itself, and `assertNever(reminder)` receives the
narrowed variable, so it compiles. Part B's trouble came from reading a **property** of the
narrowed value. Round trip: `reminderFromStored(reminderToStored(r))` equals `r` for both kinds
(tested).

</details>

## Recap

- `null` is never equal to `null`: a `unique` constraint over a nullable column lets duplicates
  in. Partial unique indexes compare only the columns each kind uses.
- A nullable column can carry a union's kind. Read rows back with **one** function, and throw on
  values the CHECK constraint forbids.
- `assertNever` needs the **variable** you switched on. Copy a property into its own variable
  first.
- To join another module's work to your transaction, call its in-transaction function with your
  `services`, not its use case.
- A price guard refuses a rise (`>`), never a drop.
- Round up with whole numbers. Sort booleans first with `Number(b) - Number(a)`.
- Server code can't call functions from a `"use client"` file. A message that must outlive its
  form needs a redirect and a banner.

## Further reading

- [Design doc 26](../docs/design/26-wishlist.md): the decisions, and the implementation notes
  (section 14).
- PostgreSQL: [partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
  and [unique indexes and nulls](https://www.postgresql.org/docs/current/indexes-unique.html).
- TypeScript handbook: [narrowing and exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking).
- React: [`"use client"`](https://react.dev/reference/rsc/use-client) and what a client
  reference can and can't do.
- Next.js: `redirect` in Server Actions (`node_modules/next/dist/docs/`).
