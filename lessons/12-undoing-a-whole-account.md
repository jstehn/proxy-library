# Lesson 12: Undoing a whole account

- **Phase:** 12 (reset a player: by an admin, or by the player as "Start over")
- **Prerequisites:** [Lesson 06](06-transactions-across-modules.md) (functions that run in the
  caller's transaction), [Lesson 10](10-two-players-one-transaction.md) (lock order and
  deadlocks)
- **Time:** 1–1½ hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Build an **orchestration module**: one that owns no tables and asks other modules to do their
   part, all in one transaction.
2. "Undo" data kept in an **append-only ledger** without deleting anything.
3. Pick a **lock order** for a new action so it can't deadlock with the existing ones.
4. Write an authorization rule with more than one way in ("an admin, or yourself").
5. Explain JavaScript's **negative zero** and why it printed "-$0.00".

---

## 1. A module with no tables

"Reset" touches everything a player has: cards (collection), sealed items (inventory), decks,
open trades, money (wallet) and the activity feed. Six modules. The reset could reach into all
their tables with SQL, but then six modules' rules would live in a seventh place.

Instead, each module offers one function that clears **its own** part, inside the caller's
transaction (the lesson 06 shape: it takes `services` and returns what it did):

| Module     | Function                  | What it does                                                  |
| ---------- | ------------------------- | ------------------------------------------------------------- |
| trades     | `closeOpenTrades`         | cancels proposals the player made, declines ones sent to them |
| wallet     | `resetBalance`            | one grant or correction back to the starting amount           |
| inventory  | `discardAllItems`         | deletes their sealed items                                    |
| collection | `giveUpEverything`        | removes every copy, logged as negative acquisitions           |
| decks      | `deleteAllDecks`          | deletes their decks                                           |
| activity   | `forgetPullsAndPurchases` | removes their pulls and purchases from the feed               |

The new `reset` module has **no tables**. Its one use case calls the six in order, from
[`reset-player.ts`](../src/modules/reset/application/reset-player.ts):

```ts
return unitOfWork.run(async (services) => {
  const tradesClosed = await closeOpenTrades(services, userId, now);
  const balance = await resetBalance(services, { userId, resetBy: actor.userId, note, now });
  const itemsRemoved = await discardAllItems(services, userId);
  // … cards, decks, feed
});
```

One `unitOfWork.run`, so either all six happen or none do. **Python comparison:** a service
function that calls several repositories inside one `with transaction.atomic():` block in Django.

`closeOpenTrades` even reuses the trade **state machine** (lesson 10): it asks `decide(trade,
userId, "cancel" | "decline", now)`, exactly as if the player had pressed the button. So a reset
can't put a trade into a state the normal rules couldn't.

## 2. Undo without deleting

The wallet is an **append-only ledger** (lesson 03): entries are only ever added, and the balance
is their sum. To set a balance back to $200 you don't delete entries; you add one:

```ts
kind: balance < target ? "grant" : "correction",
size: Cents.of(Math.abs(target - balance)),
```

A player with $37.50 gets a $162.50 grant; one with $450 gets a $250 correction. The history
still explains every cent: "Started over" is written right there. Cards work the same way: every
copy leaves with a negative acquisition, source `reset`, so the card history still adds up to
what's owned (zero).

Some things _are_ deleted: sealed items, decks and feed entries. They aren't ledgers, they're
current state (or, for the feed, a public notice board). The rule of thumb: **delete state,
append to history**.

## 3. Lock order

Two transactions **deadlock** when each holds a lock the other waits for (lesson 10). A reset
takes many locks, so it must take them in the same order as the actions it could run into:

- accepting a trade locks the **trade**, then **wallets**;
- opening a pack locks the **item**, then **cards**.

So the reset goes trade → wallet → items → cards. Whatever a reset meets, both sides ask for the
shared locks in the same order, and one simply waits for the other.

## 4. More than one way in

```ts
const isSelf = actor.userId === userId;
if (!actor.isAdmin && !isSelf) return err({ kind: "Forbidden" });
```

Read it as "refuse unless admin or self". Writing the refusal as `!a && !b` (instead of
`!(a || b)`) is the same thing (De Morgan's law); pick whichever reads more clearly to you. The
screens add a **typed confirmation** (type START OVER, or the player's username) because the
action can't be undone: a stray click shouldn't cost someone their collection.

## 5. Negative zero

Testing the reset showed "Spent **-$0.00**" for a player who'd spent nothing. JavaScript numbers
have two zeros: `0` and `-0`. They're equal (`-0 === 0` is `true`), but `Intl.NumberFormat`
prints the sign. The wallet computed "spent" as `-sum`, and `-(0)` is `-0`.

`Cents.of` now adds zero, which turns `-0` into `0` and leaves every other number alone:

```ts
return (value + 0) as Cents;
```

**Python comparison:** Python floats have `-0.0` too (`str(-0.0)` is `'-0.0'`), but Python ints
don't; JavaScript has only one number type, so every number can be `-0`.

---

## Common mistakes

- **Reaching into other modules' tables** for a cross-cutting action. Ask each module to do its
  part; keep its rules in one place.
- **Deleting history to undo it.** Add a compensating entry instead, with a note saying why.
- **A new action with its own lock order.** Match the order of the actions it can meet.
- **Irreversible actions behind a single click.** Ask for something that can't happen by
  accident.
- **Formatting a value that can be `-0`.** Normalize it where the value is made.

## Exercises

### 1. Which entry? (warm-up)

The starting amount is $200. What single ledger entry does a reset add for balances of $37.50,
$450.00 and $200.00?

<details><summary>Solution</summary>

$37.50 → a **grant** of $162.50. $450.00 → a **correction** of $250.00 (stored as −25000
cents). $200.00 → **no entry**: the code only appends when `balance !== target`, and a zero
entry would break the ledger's "amount is never zero" rule anyway.

</details>

### 2. Normalize negative zero

Write `normalizeZero(n: number): number` that returns `0` for `-0` and `n` otherwise, without an
`if`. Check it with `Object.is(normalizeZero(-0), 0)` (plain `===` can't tell the zeros apart).

<details><summary>Solution</summary>

```ts
const normalizeZero = (n: number) => n + 0;
// Object.is(normalizeZero(-0), 0) === true; normalizeZero(-5) === -5
```

</details>

### 3. Refusal, rewritten

Rewrite `if (!actor.isAdmin && !isSelf) return forbidden;` as a single negated condition, and
check that both versions agree for all four combinations of the two booleans.

<details><summary>Solution</summary>

```ts
if (!(actor.isAdmin || isSelf)) return forbidden;
// for [a, b] of [[true, true], [true, false], [false, true], [false, false]]:
//   (!a && !b) === !(a || b)   → true every time (De Morgan's law)
```

</details>

## Recap

- An **orchestration module** owns no tables; it runs other modules' in-transaction functions in
  one unit of work.
- **Delete state, append to history**: ledgers get compensating entries with a note.
- A new multi-lock action takes locks in the **same order** as the actions it can meet.
- Authorization can have several ways in; irreversible actions need a **typed confirmation**.
- JavaScript has **`-0`**; normalize it where values are made (`value + 0`).

## Further reading

- [Design doc 12](../docs/design/12-reset-player.md)
- MDN: [Negative zero](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number#number_encoding),
  [`Object.is`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is)
