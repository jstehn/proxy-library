# Lesson 10: Two players, one transaction

- **Phase:** 10 (trades)
- **Prerequisites:** [Lesson 06](06-transactions-across-modules.md) (one transaction across
  modules, row locks), [Lesson 07](07-reading-data-and-keeping-books.md) (lock, check, change)
- **Time:** 1½–2 hours
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Model a **multi-party state machine** where _who_ may do _what_ is part of the table.
2. Choose between **reserving** resources up front and **re-checking** them at the end, and
   explain the trade-off.
3. Explain what a **deadlock** is, reproduce one on purpose, and prevent it with a **lock order**.
4. Tell the difference between a test that **proves** something and one that merely **didn't
   catch** it.
5. Keep a multi-step form's state in the **URL**, and know its limits.

---

# Part A: The rules of a trade

## A1. A state machine with roles

Lesson 06's items had one owner and one move (`unopened → opened`). A trade has **two people**,
and each may only do certain things:

| From     | Event   | Who       | To        |
| -------- | ------- | --------- | --------- |
| proposed | accept  | recipient | accepted  |
| proposed | decline | recipient | declined  |
| proposed | counter | recipient | countered |
| proposed | cancel  | proposer  | cancelled |

The table becomes two small lookups and one function. From
[`trade.ts`](../src/modules/trades/domain/trade.ts):

```ts
const OUTCOME: Record<TradeEvent, TradeStatus> = {
  accept: "accepted",
  decline: "declined",
  counter: "countered",
  cancel: "cancelled",
};
const ALLOWED: Record<TradeEvent, TradeSide> = {
  accept: "recipient",
  decline: "recipient",
  counter: "recipient",
  cancel: "proposer",
};

export function decide(trade: Trade | null, userId: UserId, event: TradeEvent, now: Date) {
  if (trade === null || sideOf(trade, userId) !== ALLOWED[event])
    return err({ kind: "TradeNotFound" });
  if (trade.status !== "proposed") return err({ kind: "AlreadyDecided", status: trade.status });
  return ok({ ...trade, status: OUTCOME[event], decidedAt: now });
}
```

Two `Record`s keyed by the event union mean a new event (say, `expire`) won't compile until it has
both an outcome and a role, the same trick as lesson 09's format table. A player who isn't allowed
gets `TradeNotFound` rather than "not your turn", so the error doesn't reveal that the trade exists.

## A2. Reserve, or re-check?

Between proposing and accepting, days can pass. Alice might sell the Lightning Bolt she offered.
There are two classic designs:

- **Reserve (escrow):** proposing takes the cards and money out of play until the trade ends.
  Acceptance can't fail, but you need "reserved" states everywhere (can a reserved card go in a
  deck? be sold?), plus releasing on decline, cancel and expiry.
- **Re-check:** nothing is held. Proposing checks each side has what it offers (a friendly early
  warning), and **acceptance checks again, inside the transaction**. If something changed, the
  acceptance is refused with an exact explanation, and nothing moves.

This app re-checks (design doc 10, rule 4). It's simpler, and in a small playgroup a refused
acceptance ("Alice has 1 of a card the trade needs 2 of") is a fine outcome. The important part is
**where** the second check happens: inside the same transaction as the moves, after the locks. A
check done anywhere else is only advice.

## A3. Money first, cards second, all or nothing

From [`trades.ts`](../src/modules/trades/application/trades.ts), in outline:

```ts
await lockWallets(services, [trade.proposerId, trade.recipientId], now);
for (const item of moneyItems) {
  const paid = await spend(services, { userId: giver, amount, kind: "trade_out", ref, now });
  if (!paid.ok) return err({ kind: "NoLongerPossible", shortfall: … }); // rolls everything back
  await receive(services, { userId: taker, amount, kind: "trade_in", ref, now });
}
for (const side of ["proposer", "recipient"]) {
  const given = await giveUpCards(services, giver, cards, { source: "trade", ref, at: now });
  if (!given.ok) return err({ kind: "NoLongerPossible", shortfall: … });
  await receiveCards(services, taker, cards, { source: "trade", ref, at: now });
}
```

The integration test "refuses acceptance after the proposer sold the card" checks the rollback
directly. Bob's money had already moved inside the transaction when Alice's card turned out to be
missing, and afterwards Bob's balance is exactly what it was. Every building block here
(`spend`, `receive`, `giveUpCards`, `receiveCards`) was written in earlier phases for other
features. A trade is just a new arrangement of them inside one unit of work.

---

# Part B: Deadlocks

## B1. What a deadlock is

Accepting a trade locks **both** players' wallets. Suppose Alice accepts Bob's offer at the same
moment Bob accepts one of Alice's:

```
Transaction 1 (Alice → Bob):  locks Alice ……… wants Bob   (waits for T2)
Transaction 2 (Bob → Alice):  locks Bob   ……… wants Alice (waits for T1)
```

Each holds what the other needs, and neither can continue. That's a **deadlock**. Postgres notices
the cycle after about a second and aborts one transaction with an error. Your data is safe, but a
user sees a failure for no good reason.

## B2. Reproducing one on purpose

Lesson 06 removed a lock to watch a race. Here we **add** the bad interleaving, with two raw
transactions and a pause between their two locks:

```ts
async function lockBoth(first: string, second: string, label: string) {
  const client = await pool.connect();
  await client.query("begin");
  await client.query("select * from wallet_accounts where user_id = $1 for update", [first]);
  await sleep(300); // the other transaction takes its first lock meanwhile
  await client.query("select * from wallet_accounts where user_id = $1 for update", [second]);
  await client.query("commit");
}
await Promise.all([lockBoth("alice", "bob", "A→B"), lockBoth("bob", "alice", "B→A")]);
```

The real output:

```
A→B: committed
B→A: deadlock detected
```

With both transactions locking in the **same** order (`alice`, then `bob`), the second simply
waits at its first lock until the first commits:

```
A→B: committed
A→B again: committed
```

## B3. The fix: always lock in the same order

A deadlock needs a cycle, and a cycle needs two transactions to take the same locks in different
orders. So **always take them in one global order**. From
[`payments.ts`](../src/modules/wallet/application/payments.ts):

```ts
export async function lockWallets(services: WalletServices, userIds: readonly UserId[], now: Date) {
  const inOrder = [...new Set(userIds)].sort();
  for (const userId of inOrder) await bringUpToDate(services, userId, now);
}
```

Sorting user ids is arbitrary but **consistent**, and consistency is all that matters. (`new Set`
also removes duplicates, in case someone ever passes the same player twice.)

## B4. A test that passed for the wrong reason

The integration test "accepts two opposite trades at the same moment without a deadlock" passes.
But when the sort was removed, it **still passed**, 5 runs out of 5. The two acceptances do other
work before reaching the wallets, so they never overlapped at the dangerous moment.

That's worth sitting with: **a passing test only proves the code survived the cases the test
produced.** Concurrency bugs depend on timing, so a test can pass for years and then fail on a busy
evening. Here the protection rests on the reasoning in B3, and the experiment in B2 shows the
failure the reasoning prevents. The test stays as a smoke check, and the design doc says plainly
that it isn't proof. Compare lesson 06, where removing the lock **did** make its test fail, 3
runs out of 3. That test proves something, and this one doesn't.

---

# Part C: A form that lives in the URL

The trade builder has no client-side state. Each **+ add** is a link to the same page with one
more card in the query string:

```
/trades/new?with=bob&give=p1~nonfoil~2&get=p9~foil~1&giveMoney=2.50
```

([`draft.ts`](../src/app/trades/draft.ts) reads and writes that format, with a round-trip test.)
The back button undoes a change, a draft can be bookmarked, and it needs no JavaScript.

The limit showed up in the end-to-end test: the money box is a separate form whose hidden fields
copy the draft **as it was when the page loaded**. Click "+ add" and submit the money before the
new page arrives, and the older draft wins, so the card is dropped. The test now waits for the card
to appear. For a person that's rare, but real. It's the classic trade-off of URL state: simple and
robust, but each page is a snapshot. A client component with local state (like the deck builder's
type-ahead) avoids it, and it's in future-ideas.

---

## Common mistakes

| Mistake                                              | Why it happens                  | Instead                                                    |
| ---------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| Checking a trade is possible only when it's proposed | "we checked already"            | re-check inside the accepting transaction, after the locks |
| Locking rows in whatever order the code reaches them | each code path looks fine alone | one global order (here: sorted ids)                        |
| Treating a passing concurrency test as proof         | green is green                  | break the code and see whether the test notices            |
| A "not your turn" error for strangers                | it's more precise               | the same "not found" as a missing record                   |
| Several forms each carrying a copy of URL state      | it's easy                       | one form, or client state, when forms must combine         |

## Exercises

### 1. Trade with yourself, twice (warm-up)

Open two browsers (or a private window), sign in as two players, and trade: propose, counter, then
accept the counter. Then, in `psql`, find both trades and the `ledger_entries` and `acquisitions`
rows with `ref = 'trade:<id>'`.

<details><summary>Solution</summary>

```sql
select id, status, replaces_id from trades order by id;
select kind, amount_cents from ledger_entries where ref = 'trade:2';
select source, quantity from acquisitions where ref = 'trade:2';
```

The first trade is `countered`, and the second `accepted` with `replaces_id` pointing at the first.
Only the accepted one has ledger and acquisition rows: nothing moves for a counter.

</details>

### 2. Proposals that expire

Add a rule: a trade can't be accepted more than 14 days after it was proposed. Write
`checkNotExpired(trade, now)` returning `ok(trade)` or `err({ kind: "Expired", days: 14 })`, and say
where in `acceptTrade` to call it.

<details><summary>Solution</summary>

```ts
const DAY = 86_400_000;
const EXPIRY_DAYS = 14;

function checkNotExpired(
  trade: Trade,
  now: Date,
): Result<Trade, { kind: "Expired"; days: number }> {
  const age = now.getTime() - trade.createdAt.getTime();
  return age > EXPIRY_DAYS * DAY ? err({ kind: "Expired", days: EXPIRY_DAYS }) : ok(trade);
}
```

Call it right after `decide(...)` succeeds and before `carryOut`, inside the transaction. Test it
with lesson 03's clock: `fixedClock` a day before and a millisecond after the limit. Also add
`"Expired"` to `AcceptTradeError`, and the compiler will point at the message `switch` in the app.

</details>

### 3. Who owes whom? (SQL)

Write a query giving each player's total money received minus given in trades.

<details><summary>Solution</summary>

```sql
select u.name, sum(l.amount_cents) as net_cents
  from ledger_entries l join auth_users u on u.id = l.user_id
 where l.kind in ('trade_in', 'trade_out')
 group by u.name
 order by u.name;
```

`trade_out` entries are negative and `trade_in` positive (the wallet's direction rule), so a plain
`sum` nets them. Across all players the total is always 0: money in trades only changes hands.
That makes a nice invariant to test.

</details>

### 4. A limit on open proposals (challenge)

To stop spam, a player may have at most 5 open proposals. Write the pure rule
`checkOpenProposals(open)` and explain how to count `open` safely, so two browser tabs can't both
create a sixth.

<details><summary>Solution</summary>

```ts
const MAX_OPEN = 5;
function checkOpenProposals(
  open: number,
): Result<void, { kind: "TooManyOpenTrades"; maximum: number }> {
  return open >= MAX_OPEN ? err({ kind: "TooManyOpenTrades", maximum: MAX_OPEN }) : ok();
}
```

Count with a new `TradeRepository.openCountFor(proposerId)` inside `propose`'s transaction. Two
tabs could both count 4 and both insert, since there's no row to lock yet. Either lock something
first (the proposer's wallet row via `lockWallets`, or an advisory lock keyed by the proposer,
lesson 02), or accept that the limit can be exceeded by one. For spam protection, the second is
usually fine. Deciding which is the real exercise.

</details>

### 5. Reserve or re-check? (discussion)

Describe one situation in this app where reserving (escrow) would be clearly better than
re-checking, and what it would cost to build.

<details><summary>Solution</summary>

A marketplace where strangers trade, or a trade with a deadline (an auction), where a refused
acceptance would be unfair to the other side. Reserving needs a new "reserved" quantity in the
collection (and money held in the wallet), which every other feature must respect: deck ownership,
selling, other trades. Releases are needed on decline, cancel and expiry, plus tests for each.
That's a lot of surface area for a small playgroup, which is why this design re-checks.

</details>

## Recap

- A multi-party state machine is a table of **outcomes** and **roles**, and `Record`s make the
  compiler keep it complete.
- **Re-check inside the transaction** instead of reserving: simple, and failures explain
  themselves.
- Existing building blocks (`spend`, `receive`, `giveUpCards`, `receiveCards`) compose into a trade
  inside one unit of work, and an error rolls all of it back.
- A **deadlock** is a cycle of waiting locks. Prevent it by locking in **one global order**.
- Reproduce concurrency bugs on purpose. A passing concurrency test may simply have missed the
  timing.
- URL state is simple and robust, but each page is a snapshot.

## Further reading

- [Design doc 10: trades](../docs/design/10-trades.md), especially section 13
- PostgreSQL docs: "Explicit Locking: Deadlocks"
- [patterns.md](../docs/architecture/patterns.md): state machines (13), unit of work
- Martin Kleppmann, _Designing Data-Intensive Applications_, chapter 7 (transactions)
