# Lesson 06: One purchase, many modules

- **Phase:** 6 (store & inventory)
- **Prerequisites:** [Lesson 03](03-wallet-ledger-and-time.md) (transactions, row locks, ledgers),
  [Lesson 05](05-randomness-you-can-trust.md) (seeds, the pack engine)
- **Time:** 2–3 hours, best split across the parts
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Make several modules save **in one transaction** by giving each one a function that runs
   _inside the caller's transaction_, and combine their needs with **intersection types**.
2. Model a tree of products with a **recursive discriminated union**, and process it with the
   **Composite** pattern (a recursive function) or a **queue** (for work that grows as you go).
3. Check recursive JSON with a **self-referencing Zod schema** (`z.lazy`).
4. Write a small **state machine** as a pure transition function, and protect it with a row
   lock. Show what goes wrong without the lock.
5. Choose between **`??`** and **`||`** for fallbacks, and explain the difference.
6. Keep a database honest with **CHECK constraints** that mirror your TypeScript unions.
7. Write **cross-module integration tests** that set up every piece of state they rely on.

---

# Part A: A purchase touches three modules

## A1. The problem

Buying a Bloomburrow Play Booster Pack does three things, in three modules:

| Module      | What it saves                                      |
| ----------- | -------------------------------------------------- |
| `store`     | a store transaction: who bought what, for how much |
| `wallet`    | a ledger entry: −$5.49, kind `purchase_sealed`     |
| `inventory` | an unopened pack item                              |

If the program crashed between the second and third step, the player would have paid for
nothing. All three must happen **together or not at all**, which is what a transaction gives you
(lesson 01's unit of work). The question is how three modules can share **one** transaction
without knowing each other's insides.

## A2. Two kinds of functions

Until now, every module exposed **use cases** built by factories (lesson 01):
`makeGrantMoney(dependencies)` returns `grantMoney(actor, input)`, which **starts its own
transaction** with `unitOfWork.run(...)`.

A module that takes part in someone else's transaction needs a second kind: a plain function that
receives the **services of a transaction that's already running**. The wallet has one since
lesson 03 (`bringUpToDate`). This phase adds three more:

```ts
// wallet:     take money, or refuse if they can't afford it
spend(services, { userId, amount, kind: "purchase_sealed", note, ref, now });
// inventory:  hand over unopened items
receiveItems(services, { ownerId, productId, quantity, origin: "purchase", now });
// collection: add cards, logging where they came from
receiveCards(services, userId, gains, { source: "pack", ref, at });
```

The store's use case starts **one** transaction and calls them all inside it. From
[`buy-sealed.ts`](../src/modules/store/application/buy-sealed.ts), shortened:

```ts
return unitOfWork.run<SealedReceipt, BuySealedError>(async (services) => {
  const listing = await services.priceList.listing(input.productId);
  // … price checks …
  const transactionId = await services.storeLedger.recordSealedPurchase({ … });
  const paid = await spend(services, { …, ref: `store:${transactionId}` });
  if (!paid.ok) return paid; // returning an error rolls EVERYTHING back
  const items = await receiveItems(services, { … });
  return ok({ transactionId, items: items.value });
});
```

In Python with SQLAlchemy you'd pass one `session` into each helper:
`spend(session, ...)`, `receive_items(session, ...)`, then `session.commit()` once. Same idea:
**the caller owns the transaction, and the helpers borrow it.**

Notice the order. The store records its transaction first, because the wallet entry wants its id
as a reference (`store:42`). If the wallet then refuses, the unit of work rolls back the store
record too. The integration test "rolls everything back when the wallet can't pay" proves it.

## A3. Intersection types: "all of these at once"

`spend` needs the wallet's repositories. `receiveItems` needs the inventory's. So the store's
use case needs a `services` object that has **all** of them. TypeScript says that with an
**intersection type**, `A & B`: a value that is an `A` **and** a `B` at the same time.

From [`store/application/ports.ts`](../src/modules/store/application/ports.ts):

```ts
export type StoreServices = {
  priceList: PriceList;
  storeLedger: StoreLedger;
} & WalletServices &
  InventoryServices;
```

Read it as: "the store's own two repositories, plus everything the wallet needs, plus everything
the inventory needs". Inventory is itself an intersection (items, products, plus the pack engine's
and the collection's services), so `StoreServices` quietly includes those too.

The composition root's `servicesFor(transaction)` (in `src/server/core.ts`) returns one object
with every module's repositories. Because TypeScript checks **shapes** (structural typing, lesson
01), that one object satisfies every module's services type. No module imports another's
repositories. Each declares what it needs, and the composition root provides it.

Python's closest match is a `Protocol` that inherits from several protocols:
`class StoreServices(WalletServices, InventoryServices, Protocol): ...`.

---

# Part B: Products are trees

## B1. A recursive union

A Bloomburrow Bundle contains 9 play boosters, a land pack, a foil promo card and a spindown. A
Play Booster Box contains 36 packs. A case contains 6 boxes. Some products contain a random
**choice** ("one of these five decks"). The catalog describes a product's contents with a
discriminated union (lesson 01) that **refers to itself**:

```ts
export type SealedContent =
  | { kind: "pack"; setCode: SetCode; boosterType: string }
  | { kind: "sealed"; productId: SealedProductId; count: number } // another product
  | { kind: "card"; printingId: PrintingId; finish: Finish }
  | { kind: "deck"; setCode: SetCode; deckName: string }
  | { kind: "other"; name: string } // spindowns, storage boxes
  | { kind: "variable"; options: ReadonlyArray<readonly SealedContent[]> }; // ← itself
```

The `variable` case holds lists of `SealedContent`, and `sealed` points at another product whose
contents are `SealedContent` again. That makes it a **tree**.

## B2. The Composite pattern: one function for every node

**Composite** means treating a whole tree and a single node the same way: one function handles
every kind of node, and calls itself for the parts. From
[`unpack.ts`](../src/modules/inventory/domain/unpack.ts), shortened:

```ts
function visit(content: SealedContent): boolean {
  switch (content.kind) {
    case "pack":
      items.push(/* a pack item */);
      return true;
    case "sealed":
      /* push `count` items for that product */ return true;
    case "deck":
      items.push(/* a deck item */);
      return true;
    case "card":
      cards.push(/* one card */);
      return true;
    case "other":
      extras.push(content.name);
      return true;
    case "variable": {
      const chosen = content.options[randomInt(rng, content.options.length)];
      return chosen.every(visit); // ← recursion
    }
    default:
      return assertNever(content);
  }
}
```

- The `switch` covers every `kind`. `assertNever` (lesson 01) makes the compiler refuse the code
  if a seventh kind is ever added and forgotten here.
- `chosen.every(visit)` visits each chosen node and stops at the first `false` (a missing product).
  Python: `all(visit(c) for c in chosen)`.
- The random choice uses the injected `Rng`, seeded with a seed stored with the opening, so it can
  be replayed (lesson 05).

`unpack` deliberately goes **one level** down: opening a box gives you 36 packs to open, the way
it would on a table.

## B3. When a tree grows as you go: a queue

"Open everything inside" can't know the whole tree up front: the packs only exist after the box
is unpacked, and each pack has to be opened in turn. That's a job for a **queue**, which keeps a
list of work waiting and adds to its end as new work appears. From
[`open.ts`](../src/modules/inventory/application/open.ts):

```ts
const waiting: ItemId[] = [...itemIds];
for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
  const opened = await openInTransaction(services, actor, next, now, seeds.newSeed);
  if (!opened.ok) return opened;
  openings.push(opened.value);
  if (opened.value.kind === "product") {
    waiting.push(...opened.value.children.map((child) => child.id));
  }
}
```

- **`shift()`** removes and returns the first element (Python: `waiting.pop(0)`, or better
  `collections.deque.popleft()`). It returns `undefined` when the list is empty, which ends the loop.
- **`push(...list)`**: the `...` **spreads** the list into separate arguments, so every child is
  added. Python: `waiting.extend(children)`.

The result is parents before children: the box, then its packs, which is the order a player
wants to see them. This is breadth-first order, the same thing a BFS over a graph does.

## B4. Checking a recursive shape: `z.lazy`

Stored product contents are JSON, and JSON from a database is still checked on the way in
(lesson 04, "parse, don't validate"). A recursive type needs a recursive schema, but a constant
can't refer to itself while it's being defined. **`z.lazy`** delays the lookup until the schema is
actually used. From [`inventory/infrastructure`](../src/modules/inventory/infrastructure/drizzle-repositories.ts):

```ts
const SealedContentSchema: z.ZodType<SealedContent> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("pack"), setCode: …, boosterType: z.string() }),
    // …
    z.object({ kind: z.literal("variable"), options: z.array(z.array(SealedContentSchema)) }),
  ]),
);
```

The type annotation `z.ZodType<SealedContent>` is required. Without it, TypeScript would try to
work out the schema's type from its own definition and go round in circles. In Pydantic you'd write
a model that refers to itself by name in quotes (`options: list[list["SealedContent"]]`).

---

# Part C: Opening, exactly once

## C1. A state machine in one function

An item has two states, `unopened` and `opened`, and one allowed move between them. A **state
machine** is a list of states and the moves allowed between them. Written as a pure function, it's
easy to test. From [`item.ts`](../src/modules/inventory/domain/item.ts):

```ts
export function openTransition(item: Item | null, userId: UserId, now: Date) {
  if (item === null || item.ownerId !== userId) return err({ kind: "ItemNotFound" });
  if (item.status === "opened") return err({ kind: "AlreadyOpened" });
  return ok({ ...item, status: "opened", openedAt: now });
}
```

Someone else's item gives exactly the same answer as a missing one, so nobody can find out which
item ids exist by guessing.

## C2. Two clicks at once

A player double-clicks **Open**. Two requests arrive at the same moment. Both read the item, both
see `unopened`, both pass `openTransition`… and the pack opens twice?

The repository reads the item **with a row lock** (`SELECT … FOR UPDATE`, lesson 03): the second
transaction waits at that read until the first one finishes. By then the item says `opened`, and
the second request gets a clean `AlreadyOpened`.

What if the lock were missing? We tried it: removing `.for("update")` and running the
integration test "opens a pack only once, even when asked twice at the same moment" three times.
All three runs failed the same way:

```
Error: Failed query: insert into "item_openings" …
Caused by: error: duplicate key value violates unique constraint "item_openings_pkey"
```

Both requests got through. The only thing that stopped a double opening was the **primary key** on
`item_openings`, which allows one row per item. That's a useful safety net: the loser's whole
transaction rolled back, so no cards were added twice. But the player saw a crash instead of a
message. **The lock gives the right answer. The constraint makes sure a missing lock can't corrupt
data.** Have both.

## C3. CHECK constraints mirror your unions

`ItemContent` is a union: a product has a `productId`, a pack has a `setCode` and `boosterType`,
and a deck has a `setCode` and `deckName`. The table stores all of them in one row with nullable
columns, so the database gets a CHECK constraint with the same rule. From
[`inventory/infrastructure/schema.ts`](../src/modules/inventory/infrastructure/schema.ts):

```sql
(content_kind = 'product' and product_id is not null)
or (content_kind = 'pack' and set_code is not null and booster_type is not null)
or (content_kind = 'deck' and set_code is not null and deck_name is not null)
```

Another one ties the status to its timestamp: `(status = 'opened') = (opened_at is not null)`.
TypeScript protects the code, and CHECK constraints protect the data from anything else that
writes to it (a manual `psql` fix, a future migration).

---

# Part D: Small things that matter

## D1. `??` versus `||`

A product's price is its own override if it has one, otherwise its kind's price. From
[`pricing.ts`](../src/modules/store/domain/pricing.ts):

```ts
return prices.override ?? prices.kindPrice;
```

**`??`** (nullish coalescing) uses the right side only when the left is `null` or `undefined`.
**`||`** uses it whenever the left is _falsy_, which includes `0` and `""`. For money that
difference matters: an override of `0` means "free", and `||` would silently ignore it. (Lesson 05
used `||` on purpose: in a comparator, 0 means "tie, keep comparing".) Python's `or` behaves like
`||`. The `??` equivalent is `a if a is not None else b`.

## D2. Tests must set up their own world

The first run of the new integration test failed: the balance after buying a $5.49 pack was
$19.51, not $44.51. An earlier test (in the wallet module) had changed the shared
`economy_settings` row to a $25 starting grant, and our test assumed the default $50. The fix is
one line in `beforeEach` that sets the settings this test depends on. **A test that relies on
state it didn't create passes or fails depending on what ran before it.** This rule is now in
[`testing.md`](../docs/architecture/testing.md).

## D3. Tests that span modules

`store`'s own folder may only import other modules' public API and table definitions (lint rules,
lesson 01), so it can't wire up a real catalog, wallet and inventory. Journeys across modules live
in [`tests/integration/`](../tests/integration/store-and-inventory.int.test.ts), which is allowed
to wire modules the way the composition root does. Its catalog comes from recorded fixtures, so it
never touches the network.

---

## Common mistakes

| Mistake                                                   | Why it happens                            | Instead                                                                |
| --------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Each module starts its own transaction for one purchase   | every use case you've seen did `run(...)` | one transaction in the orchestrating use case; helpers take `services` |
| Reading an item, checking it, then updating, with no lock | it works when you click once              | lock the row (`FOR UPDATE`) before checking                            |
| Relying on a constraint error as your "already opened"    | the data stays safe either way            | lock for the clean answer, and keep the constraint as the safety net   |
| `a \|\| b` for a fallback that may legitimately be 0      | it reads like "or"                        | `a ?? b`                                                               |
| A recursive schema without a type annotation              | `z.lazy` looks self-explanatory           | annotate `z.ZodType<YourType>`                                         |
| Tests that assume shared settings are at their defaults   | they were, when you wrote the test        | set everything the test depends on in `beforeEach`                     |
| Foreign keys from items to catalog products               | "referential integrity is good"           | an owned item must outlive a re-import; keep a name snapshot instead   |

## Exercises

### 1. Follow a purchase through the database (warm-up)

In the running app, buy a pack in the store and open it. Then, in `psql`, find its row in
`store_transactions`, the matching `ledger_entries` row (hint: the `ref` column), the item in
`sealed_items`, its `item_openings` row, and the new `acquisitions` rows. Which of them could you
use to regenerate the pack?

<details><summary>Solution</summary>

```sql
select id, total_cents from store_transactions order by id desc limit 1;      -- say id 7
select kind, amount_cents from ledger_entries where ref = 'store:7';
select id, status from sealed_items order by id desc limit 1;                   -- say id 12
select seed, result->'cards'->0 from item_openings where item_id = 12;
select source, ref, count(*) from acquisitions where ref = 'item:12' group by 1, 2;
```

`item_openings.seed` regenerates the pack (with the same recipe), and `result` stores the actual
cards, so the pack can be shown even if the recipe changes later.

</details>

### 2. Count the packs in a product

Write `countPacks(contents, products)`: how many packs a product contains in total, going into
nested products (a case of 2 boxes of 3 packs is 6). For a `variable` node, count its **first**
option.

Hint: start from `unpack`'s `switch` and let the `sealed` case call `countPacks` again.

<details><summary>Solution</summary>

```ts
function countPacks(contents: readonly SealedContent[], products: ProductLookup): number {
  let total = 0;
  for (const content of contents) {
    switch (content.kind) {
      case "pack":
        total += 1;
        break;
      case "sealed": {
        const product = products(content.productId);
        if (product !== null) total += content.count * countPacks(product.contents, products);
        break;
      }
      case "variable":
        if (content.options.length > 0) total += countPacks(content.options[0], products);
        break;
      case "card":
      case "deck":
      case "other":
        break;
      default:
        return assertNever(content);
    }
  }
  return total;
}
```

With the sample products in
[`inventory/testing/fakes.ts`](../src/modules/inventory/testing/fakes.ts): the box gives 3, the
bundle 2, and a case made with
`sampleProduct("case", "Case", [{ kind: "sealed", productId: SealedProductId.of("box"), count: 2 }])`
gives 6.

</details>

### 3. `??` or `||`?

What do these return, and which one does the store want?

```ts
const prices = { override: 0, kindPrice: 549 };
prices.override || prices.kindPrice;
prices.override ?? prices.kindPrice;
```

<details><summary>Solution</summary>

`||` returns **549**, because `0` is falsy. `??` returns **0**, because `0` isn't `null` or
`undefined`. The store wants `??`: an override means "use exactly this". (In this app `checkPrice`
refuses a $0 price anyway, so both give the same result today. `??` states the intent, and it keeps
working if free items are ever allowed.)

</details>

### 4. Who spent what? (SQL)

Write a query over `store_transactions` listing each player's total spent on sealed product and
their number of purchases, biggest spender first.

<details><summary>Solution</summary>

```sql
select user_id, sum(total_cents) as spent_cents, count(*) as purchases
  from store_transactions
 where item_kind = 'sealed' and direction = 'buy'
 group by user_id
 order by spent_cents desc;
```

The same number is `-sum(amount_cents)` over `ledger_entries` with kind `purchase_sealed`. Two
ledgers that must agree are a good thing to check in a test.

</details>

### 5. A daily limit (challenge)

Your group wants at most 3 collector boosters per player per day. Write the pure rule
`checkDailyLimit(boughtToday, quantity, limit)` returning `ok(quantity)` or
`err({ kind: "DailyLimitReached", remaining })`, with tests. Then explain where `boughtToday`
would come from, and at what point in `buySealed` you'd have to read it so that two browser tabs
can't both squeeze in a third pack.

<details><summary>Solution</summary>

```ts
type DailyLimitReached = { kind: "DailyLimitReached"; remaining: number };

function checkDailyLimit(
  boughtToday: number,
  quantity: number,
  limit: number,
): Result<number, DailyLimitReached> {
  const remaining = Math.max(0, limit - boughtToday);
  if (quantity > remaining) return err({ kind: "DailyLimitReached", remaining });
  return ok(quantity);
}

expect(checkDailyLimit(0, 3, 3)).toEqual(ok(3));
expect(checkDailyLimit(2, 2, 3)).toEqual(err({ kind: "DailyLimitReached", remaining: 1 }));
```

`boughtToday` would come from a new `StoreLedger` method that sums today's quantities for that
player and product kind, since `store_transactions` records every purchase. It must be read
**after the wallet row is locked** (inside `spend`'s `bringUpToDate`, or with an explicit lock
first). Otherwise two tabs could both read "2 bought", both pass, and end up with 4. The
wallet lock already serializes each player's purchases, so reading after it is enough.

</details>

### 6. Why `services` and not `dependencies`? (discussion)

`receiveItems` takes `services`, but `makeOpenItem` takes `dependencies`. What would go wrong if
`receiveItems` were a use case with its own `unitOfWork.run(...)`?

<details><summary>Solution</summary>

It would run in its **own** transaction, separate from the store's. If the wallet later refused
the payment, the store's transaction would roll back, but the items would already be committed:
free packs. Functions that are one step of someone else's operation take the caller's `services`,
so they share its transaction. Only whole operations (a use case) start one.

</details>

## Recap

- One user action, **one transaction**: the orchestrating use case starts it, and each module
  contributes a function that takes the transaction's `services` (`spend`, `receiveItems`,
  `receiveCards`).
- **Intersection types** (`A & B`) combine the modules' needs, and one object from the composition
  root satisfies them all.
- Product contents are a **recursive union**. **Composite**: one recursive function per level.
  Work that grows as you go: a **queue** (breadth-first).
- **`z.lazy`** (with a type annotation) checks recursive JSON.
- A **state machine** as a pure transition, a **row lock** for the clean answer, and a
  **constraint** as the safety net.
- **`??`** falls back only on null or undefined. `||` falls back on 0 too.
- **CHECK constraints** mirror TypeScript unions in the database.
- Tests set up **all** the state they depend on. Journeys across modules live in
  `tests/integration/`.

## Further reading

- [Design doc 06: store & inventory](../docs/design/06-store-and-inventory.md), especially section 14
- [ADR 0005: unit of work](../docs/adr/0005-unit-of-work.md),
  [0013: store ledger](../docs/adr/0013-price-history-and-store-ledger.md),
  [0014: pricing sources](../docs/adr/0014-pricing-sources.md)
- [patterns.md](../docs/architecture/patterns.md): Composite (12), state machines (13)
- TypeScript handbook: "Intersection Types", "Recursive Type References"
- Zod docs: "Recursive objects" (`z.lazy`)
- MDN: "Nullish coalescing operator (??)", `Array.prototype.shift`, spread syntax
- PostgreSQL docs: `SELECT … FOR UPDATE`, CHECK constraints
