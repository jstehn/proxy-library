# Lesson 03: Money, time and a ledger

- **Phase:** 3 (wallet)
- **Prerequisites:** [Lesson 02](02-accounts-and-forms.md): locks, race conditions, Server Actions
- **Time:** 2–3 hours, best split across the parts
- **Vocabulary:** unfamiliar terms are defined in the [glossary](GLOSSARY.md)

## Objectives

By the end of this lesson you will be able to:

1. Explain why money is recorded in an **append-only ledger**, with balances calculated rather
   than stored.
2. Treat **time as an input**: write date logic as a pure function and test it with a controlled
   clock and property tests.
3. Use a **row lock** (`SELECT … FOR UPDATE`), and choose between a row lock and an advisory lock.
4. Make an operation **idempotent** (safe to repeat), and do work **lazily** instead of on a
   schedule.
5. Write SQL aggregates with **`FILTER`** and read the results into TypeScript safely.
6. Use `Record<K, V>` and exhaustive switches so a new case can't be forgotten.
7. Handle human input at the edges: money typed as text, and times in different time zones.

---

# Part A: A ledger instead of a balance

## A1. The problem with `balance = balance - price`

The obvious design stores one number per player:

```python
player.balance = player.balance - price   # read, subtract, write back
```

This has two problems:

1. **History is gone.** Where did the money come from? When was it spent? The number can't say.
   "Total spent" and "total self-funded" (which you asked to make visible) would need a second,
   separate record, and the two could disagree.
2. **Updates get lost.** Two requests both read `50`, both subtract, and both write back. One
   subtraction simply vanishes. It's lesson 02's race condition again.

## A2. The ledger

Instead, every change is a new row that is **never edited or deleted**, and the balance is the
sum of the rows. That's exactly how a bank statement works:

| effective_at  | kind           | amount     | note               |
| ------------- | -------------- | ---------- | ------------------ |
| Jan 7, 10:00  | starting_grant | +$50.00    |                    |
| Jan 12, 00:00 | allowance      | +$20.00    |                    |
| Jan 13, 18:30 | grant          | +$25.00    | Won Friday's draft |
| Jan 13, 18:31 | correction     | −$10.00    | Typo in last grant |
| **balance**   |                | **$85.00** | = the sum          |

"Total self-funded" is simply the sum of the `self_fund` rows, and it can never disagree with
the balance, because both come from the same rows. Accountants have worked this way for
centuries (double-entry bookkeeping). In software the idea is called _event sourcing_: store what
happened, and derive the current state from it.

This project's ledger is in
[`wallet/infrastructure/schema.ts`](../src/modules/wallet/infrastructure/schema.ts). The code
never issues an `UPDATE` or `DELETE` on it.

## A3. Every kind goes one way: `Record<K, V>`

A grant must add money, and a correction must take it away. From
[`domain/ledger.ts`](../src/modules/wallet/domain/ledger.ts):

```ts
export type LedgerKind = "starting_grant" | "allowance" | "grant" | "correction" | "self_fund";

export const DIRECTION: Readonly<Record<LedgerKind, "in" | "out">> = {
  starting_grant: "in",
  allowance: "in",
  grant: "in",
  correction: "out",
  self_fund: "in",
};
```

`Record<LedgerKind, "in" | "out">` means "an object with **every** `LedgerKind` as a key". Like an
exhaustive `switch`, it can't silently fall out of date: add a new kind to the union and this
object stops compiling until you decide its direction (exercise 4).

The code builds entries through `ledgerEntry({ kind, size, … })`, which applies the sign from
`DIRECTION`, so nobody writes a minus sign by hand. The database checks the same rule again:

```ts
check("ledger_entries_direction", sql`(${table.kind} = 'correction') = (${table.amountCents} < 0)`),
```

Read it as "_is it a correction?_ must equal _is the amount negative?_". Checking the rule in code
**and** in the database is defense in depth: even a bug in some future code, or a hand-typed SQL
statement, can't record a negative grant.

## A4. Mistakes are fixed by adding, not editing

An admin who gives $100 instead of $10 doesn't edit the grant. They add a **correction** of $90
with a note. The history tells the whole story ("gave $100", "took back $90: typo"), which is
exactly the transparency this app wants around money.

---

# Part B: Time as an input

## B1. Paydays are a pure function

"Every Monday at midnight UTC" is described by two numbers: one **anchor** payday, and a
**period** in days. Every payday is `anchor + k × period` for some whole number `k`. From
[`domain/economy.ts`](../src/modules/wallet/domain/economy.ts):

```ts
/** Every payday p with `after < p ≤ upTo`, oldest first. */
export function paydaysBetween(schedule, after: Date, upTo: Date): Date[] {
  const period = schedule.periodDays * DAY_IN_MILLISECONDS;
  const anchor = schedule.anchor.getTime();

  const firstK = Math.floor((after.getTime() - anchor) / period) + 1;
  const lastK = Math.floor((upTo.getTime() - anchor) / period);

  const paydays: Date[] = [];
  for (let k = firstK; k <= lastK; k++) paydays.push(new Date(anchor + k * period));
  return paydays;
}
```

Walking through it with the anchor on Monday Jan 5 at 00:00, a weekly period,
`after` = Wednesday Jan 7 at 10:00, and `upTo` = Tuesday Jan 27 at 00:00:

- **First payday:** from the anchor to `after` is 2 days 10 hours, about 0.35 weeks.
  `floor(0.35) = 0`, and `+ 1` gives `firstK = 1`, so the first payday is anchor + 1 week =
  **Jan 12**.
- **Last payday:** from the anchor to `upTo` is 22 days, about 3.14 weeks. `floor(3.14) = 3`, so
  `lastK = 3`, which is anchor + 3 weeks = **Jan 26**.
- **Result:** k = 1, 2, 3, which is Jan 12, Jan 19 and Jan 26.

`getTime()` turns a `Date` into milliseconds since 1970, like Python's `datetime.timestamp() *
1000`, so the arithmetic is plain numbers.

The function never asks "what time is it?". The caller passes `upTo`. That's what makes it easy
to test: nothing to mock, just inputs and an output.

## B2. Testing with a clock you control

The use cases get "now" from an injected `Clock` (lesson 01). In
[`wallet.test.ts`](../src/modules/wallet/application/wallet.test.ts), a `manualClock` makes three
weeks pass in no time:

```ts
clock = manualClock("2026-01-07T10:00:00Z"); // a Wednesday
await wallet.refreshWallet(jack.userId); // opens the wallet: $50 starting grant
clock.advanceBy(3 * WEEK);
expect(await wallet.refreshWallet(jack.userId)).toBe(5000 + 3 * 2000);
```

The test then checks that each allowance is dated to **its own** payday (Jan 12, 19 and 26), not
to the moment it was recorded. Entries have an `effectiveAt` date for exactly this reason.

## B3. Property tests for time

Examples show that some cases work. Properties say what must hold for **all** cases, and
fast-check generates hundreds of random schedules and dates looking for a counterexample
([`economy.test.ts`](../src/modules/wallet/domain/economy.test.ts)):

```ts
it("never pays twice or skips a payday when a window is split in two", () => {
  fc.assert(
    fc.property(schedule, date, date, date, (s, x, y, z) => {
      const [a, b, c] = [x, y, z].sort((p, q) => p.getTime() - q.getTime());
      const split = [...paydaysBetween(s, a, b), ...paydaysBetween(s, b, c)];
      expect(iso(split)).toEqual(iso(paydaysBetween(s, a, c)));
    }),
  );
});
```

This one property is the heart of the whole allowance system. Wallets are refreshed at arbitrary,
unpredictable moments, whenever someone happens to load a page. Paying `a → b` and later `b → c`
must equal paying `a → c` in one go: no payday counted twice (it would be in both halves) and none
skipped (in neither). The `after < p ≤ upTo` boundaries (strictly after, up to and including) are
what make this true, and the property proves it for random inputs.

---

# Part C: Doing work lazily

## C1. Lazy instead of scheduled

There are two ways to pay allowances:

|                         | **Scheduled** (a job every Monday)            | **Lazy** (when the wallet is next shown) |
| ----------------------- | --------------------------------------------- | ---------------------------------------- |
| Needs                   | a background process that must be running     | nothing extra                            |
| If the server was off   | Monday's job never ran, so paydays are missed | caught up on the next visit              |
| Balance in the database | always current                                | current as of the last visit             |

This app is **lazy**. Every page that shows money first calls `refreshWallet`, from
[`site-header.tsx`](../src/app/site-header.tsx):

```ts
const balance = actor === null ? null : await getContainer().wallet.refreshWallet(actor.userId);
```

The trade-off: until someone looks, the database hasn't recorded the allowance yet. That's why
the admin Players page calls `refreshAllWallets()` before showing everyone's balance.

## C2. Idempotent: safe to repeat

`refreshWallet` runs on nearly every page load, so running it again must change nothing. It's
**idempotent**: repeating it has the same effect as doing it once. This works because each wallet
remembers `allowancePaidThrough`, and the next refresh only pays paydays after that moment (B3's
"strictly after").

In Python terms, `settings[key] = value` is idempotent and `items.append(value)` isn't. Any
operation that might be retried or run many times needs this property.

## C3. Opening a wallet exactly once

A wallet opens (and pays the $50 starting grant) the first time it's refreshed. But what if the
header and the wallet page both refresh a brand-new wallet at the same moment? You can't lock a
row that doesn't exist yet. Instead, from
[`drizzle-repositories.ts`](../src/modules/wallet/infrastructure/drizzle-repositories.ts):

```ts
const inserted = await db
  .insert(walletAccounts)
  .values(account)
  .onConflictDoNothing()
  .returning({ userId: walletAccounts.userId });
return inserted.length > 0; // true only for the request that actually created it
```

`on conflict do nothing` makes the second insert quietly do nothing, and `returning` tells each
request whether **its** insert happened. Only the one that got a row back pays the grant. The
integration test fires ten first visits at once and checks there is exactly one starting grant.

---

# Part D: Locks, again

## D1. A row lock

Lesson 02 used an **advisory lock**: one lock on a made-up number, so all account changes took
turns. For money, a **row lock** fits better:

```ts
const [row] = await db
  .select()
  .from(walletAccounts)
  .where(eq(walletAccounts.userId, userId))
  .for("update"); // SELECT … FOR UPDATE
```

`FOR UPDATE` locks just that player's `wallet_accounts` row until the transaction ends. Two
requests about **Jack's** wallet take turns, while a request about **Ana's** wallet goes straight
through.

|          | Advisory lock (lesson 02)                  | Row lock (this lesson)                    |
| -------- | ------------------------------------------ | ----------------------------------------- |
| Locks    | a number you choose                        | specific rows                             |
| Good for | a rule about the _whole_ group (≥ 1 admin) | a rule about _one_ thing (Jack's balance) |
| Blocks   | everyone taking the same lock              | only requests for the same rows           |

## D2. What goes wrong without it

When this lesson was written, removing `.for("update")` made the "ten simultaneous visits after
three paydays" test fail **5 out of 5 runs**. Jack should have received 3 allowances and got up to
**24**: each of the ten requests read the same old `allowancePaidThrough`, and each paid all three
paydays. With the lock, the second request waits, then sees the updated `allowancePaidThrough`,
and pays nothing.

## D3. Check, then act, inside the lock

A correction must not push a balance below $0. From
[`manage-money.ts`](../src/modules/wallet/application/manage-money.ts):

```ts
await bringUpToDate(services, input.userId, now); // pays due allowances AND takes the row lock
const affordable = checkCanAfford(await services.wallets.balance(input.userId), amount.value);
if (!affordable.ok) return affordable; // → rollback
```

Because the lock is held from the check until the transaction commits, no other correction for
this player can slip in between. The integration test sends two $30 corrections at once against a
$50 balance: one succeeds, and the other gets `InsufficientFunds` with a balance of $20.

**Order matters here too.** `bringUpToDate` takes the lock _first_ and reads the economy settings
_second_. If an admin's settings change finished while this request waited for the lock, it
already sees the new settings.

---

# Part E: Reading money back out

## E1. Several totals in one query: `FILTER`

The wallet page needs the balance and several totals. SQL's `FILTER` restricts one aggregate to
certain rows, so a single query gets them all. From
[`queries/wallet.ts`](../src/modules/wallet/queries/wallet.ts):

```sql
select
  sum(amount_cents)                                                         as balance,
  sum(amount_cents) filter (where kind in ('starting_grant','allowance','grant')) as received,
  sum(amount_cents) filter (where kind = 'self_fund')                       as self_funded
from ledger_entries
where user_id = $1
```

In pandas, that's one `.sum()` per column over a filtered frame, except the database does it in a
single pass.

In the Drizzle version, each total ends with `.mapWith(Number)`. Postgres returns sums of
`bigint` columns as **strings** (a JavaScript number can't hold every possible 64-bit integer), so
we convert them explicitly. Our amounts are far below that limit.

## E2. Pages: refresh, then read

A page that shows money first runs the **use case** (a write), then the **queries** (reads). From
[`wallet/page.tsx`](../src/app/wallet/page.tsx):

```ts
await wallet.refreshWallet(actor.userId); // may add allowance entries
const [summary, history, settings] = await Promise.all([
  walletSummary(db, actor.userId),
  walletHistory(db, actor.userId),
  currentEconomySettings(db),
]);
```

`Promise.all` runs the three read queries at the same time (Python's `asyncio.gather`), since none
depends on another.

---

# Part F: People at the edges

## F1. Money typed as text

People type `25`, `10.00` or `$12.50`. `Cents.fromUsd` parses those **as text** (digits before and
after the dot) and never as a float, so `"0.29"` becomes exactly 29 cents rather than
28.999999999999996. Going the other way, `Cents.toPlainDollars(2000)` gives `"20.00"` for a text
field. A property test checks that the two are exact opposites for every amount.

Both live in the kernel, alongside `Cents.applyRate`. That function is the **only** place money is
ever rounded, and it always rounds **down**, so nobody is paid more than the exact value (it's for
selling cards in Phase 7).

## F2. Time zones

The database stores exact **instants** (`timestamptz`), and the server works in them. But people
think in local time ("Monday at 9am"), and only the **browser** knows the viewer's time zone. So:

- **Showing a time:** [`<LocalTime>`](../src/ui/local-time.tsx) renders UTC on the server, then
  the browser switches it to local time.
- **Choosing a payday:** the Economy form has a `datetime-local` input. When it changes, the
  browser converts it to an exact instant (`new Date(value).toISOString()`) and puts that in a
  hidden field for the server.

Why render UTC first? The server builds the HTML, and the browser then takes it over
(**hydration**). React requires the browser's first render to match the server's exactly. If the
server printed its own local time and the browser printed a different one, React would complain.
`useSyncExternalStore(…, () => true, () => false)` is a small trick that answers "am I in the
browser yet?": `false` during the server render and hydration, then `true`, which triggers the
switch to local time.

---

## Common mistakes

| Mistake                                                    | Why it happens                                | Avoid it by                                                          |
| ---------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| Storing a balance and updating it                          | it's the obvious model                        | append ledger entries; calculate the balance                         |
| Editing or deleting a wrong ledger entry                   | it feels like "fixing" it                     | add a correction with a note                                         |
| Calling `new Date()` inside business logic                 | it's convenient                               | pass `now` in; inject a `Clock` (lint enforces this)                 |
| Paydays with `≥`/`>` boundaries that overlap or leave gaps | off-by-one thinking                           | pick "after < p ≤ upTo", and prove it with the split-window property |
| Checking the balance, then locking                         | the lock seems like a detail                  | lock first, then check, then write, all in one transaction           |
| Reading a `bigint` sum as a number without converting it   | it prints like a number                       | `.mapWith(Number)`, or `Number(...)`, knowing the safe range         |
| Formatting times on the server in its own time zone        | the server's zone looks right on your machine | store instants; let the browser show local time                      |
| `parseFloat("12.50") * 100` for money                      | it looks fine                                 | `Cents.fromUsd`, which never touches floats                          |

## Exercises

### 1. Read the ledger yourself (warm-up)

Sign in as an admin, give yourself $5 with a note, then run in `psql`:

```sql
select kind, amount_cents, note, effective_at from ledger_entries order by effective_at;
select user_id, sum(amount_cents) as balance_cents from ledger_entries group by user_id;
```

Does the second query match the balance in your header?

<details><summary>Solution</summary>

Yes. The header shows `refreshWallet`'s result, which is exactly
`sum(amount_cents)` for your user, formatted as dollars. You'll see your `starting_grant`, any
`allowance` rows (one per Monday since your wallet opened), and the new `grant` with your note.
Nothing in the app stores a balance anywhere else.

</details>

### 2. Paydays by hand

A schedule is anchored on Monday **Jan 5, 2026, 00:00 UTC** with a period of **14 days**. Which
paydays does `paydaysBetween` return for `after` = Jan 10 and `upTo` = Feb 10? Work it out on
paper, then check with a test.

<details><summary>Solution</summary>

The paydays are Jan 5, Jan 19, Feb 2, Feb 16, … Those strictly after Jan 10 and up to Feb 10 are
**Jan 19** and **Feb 2**.

```ts
const s = { anchor: new Date("2026-01-05T00:00:00Z"), periodDays: 14 };
expect(
  paydaysBetween(s, new Date("2026-01-10T00:00:00Z"), new Date("2026-02-10T00:00:00Z")).map((d) =>
    d.toISOString(),
  ),
).toEqual(["2026-01-19T00:00:00.000Z", "2026-02-02T00:00:00.000Z"]);
```

</details>

### 3. Write a property

Add a property to [`economy.test.ts`](../src/modules/wallet/domain/economy.test.ts): _a window
exactly `n` periods long, starting anywhere, contains exactly `n` paydays._

<details><summary>Hint</summary>

Generate an anchor, a start date, `periodDays` (1–60) and `n` (0–20). The end is
`start + n × periodDays` days in milliseconds.

</details>

<details><summary>Solution</summary>

```ts
it("a window of exactly n periods holds exactly n paydays", () => {
  const DAY = 24 * 60 * 60 * 1000;
  fc.assert(
    fc.property(
      date,
      date,
      fc.integer({ min: 1, max: 60 }),
      fc.integer({ min: 0, max: 20 }),
      (anchor, start, periodDays, n) => {
        const end = new Date(start.getTime() + n * periodDays * DAY);
        expect(paydaysBetween({ anchor, periodDays }, start, end)).toHaveLength(n);
      },
    ),
  );
});
```

(`date` is the generator already defined in that file.) It holds because the window is
"strictly after start, up to and including end": exactly one payday falls in each
period-long stretch, whatever the alignment.

</details>

### 4. Add a kind, and let the compiler guide you

In [`ledger.ts`](../src/modules/wallet/domain/ledger.ts), add `"tournament_prize"` to `LedgerKind`
and run `pnpm typecheck`. How many places does the compiler find, and what else (outside
TypeScript) would you need to change? Undo it afterwards.

<details><summary>Solution</summary>

Two compiler errors:

```
src/modules/wallet/domain/ledger.ts: Property 'tournament_prize' is missing in type '{…}' but required
in type 'Readonly<Record<LedgerKind, "in" | "out">>'.
src/app/wallet/labels.ts: Argument of type '"tournament_prize"' is not assignable to parameter of
type 'never'.
```

The `Record` forces you to choose a direction, and `assertNever` forces a label. Outside
TypeScript, the database's `ledger_entries_kind_known` CHECK constraint lists the allowed kinds,
so you'd also need a **migration** to add it there, or every insert of the new kind would fail.
That's the price of defense in depth: rules live in two places, but a mistake in either is caught.

</details>

### 5. Watch the row lock matter

In [`drizzle-repositories.ts`](../src/modules/wallet/infrastructure/drizzle-repositories.ts),
remove `.for("update")` from `lockAccount`. Run
`npx vitest run --project integration -t "after three paydays"` a few times, then **put it back**.

<details><summary>Solution</summary>

Without the lock, the test fails: instead of 3 allowances you'll see many more (up to 24 when
this lesson was written). All ten requests read the same `allowancePaidThrough`, and each one
pays all three paydays. With the lock, the requests queue up: the first pays three allowances and
moves `allowancePaidThrough` forward, and the other nine find nothing left to pay. The
`insert … on conflict do nothing` step alone isn't enough, because the wallet already exists at
that point.

</details>

### 6. A report with `FILTER`

Write one SQL query listing, per player, their number of allowances, their total received from
admins (grants), and their balance.

<details><summary>Solution</summary>

```sql
select user_id,
       count(*)          filter (where kind = 'allowance') as allowances,
       sum(amount_cents) filter (where kind = 'grant')     as granted_cents,
       sum(amount_cents)                                    as balance_cents
from ledger_entries
group by user_id
order by user_id;
```

A player with no grants shows `null` for `granted_cents`, because the sum of zero rows is null.
Wrap it in `coalesce(…, 0)` to show 0, as the app's queries do.

</details>

### 7. Try self-funding end to end (challenge)

As admin, click "Allow self-funding" for a player. Sign in as that player: the Wallet page now has
an "Add your own funds" form. Add $150, then $20. What happens each time, and where does the
admin see it?

<details><summary>Solution</summary>

$150 is refused with "You can add at most $100.00 at a time" (the default `selfFundLimit`;
change it on `/admin/economy`). $20 succeeds and shows in the player's history as "Added by you".
On `/admin/players` the player's **Self-funded** figure goes up by $20. Self-funding is always
recorded as its own kind, `self_fund`, so it can never be mistaken for an allowance or a grant.

</details>

## Recap

- Money is an **append-only ledger**. The balance and every total are **sums**, so they can never
  disagree, and the history explains everything.
- Each kind of entry goes one way, enforced by a `Record<LedgerKind, …>` in code **and** a
  database CHECK.
- **Time is an input**: `paydaysBetween(schedule, after, upTo)` is pure. Tests use `manualClock`,
  and a **property** proves that splitting a window never double-pays or skips.
- Allowances are paid **lazily** by an **idempotent** refresh. `insert … on conflict do nothing
returning` opens a wallet exactly once.
- A **row lock** (`FOR UPDATE`) serializes changes to one player's money, without blocking
  anyone else. Without it, one test paid 24 allowances instead of 3.
- `FILTER` computes several totals in one query. Postgres `bigint` sums need converting to
  numbers.
- At the edges: parse money **as text** (never floats), store **instants**, and let the
  **browser** show local time.

## Further reading

- [Design doc 03: wallet](../docs/design/03-wallet.md), especially section 15, "Implementation
  notes"
- [ADR 0004: append-only ledger](../docs/adr/0004-append-only-ledger.md)
- PostgreSQL docs: "Explicit Locking" (row-level locks) and "Aggregate Expressions" (`FILTER`)
- Martin Fowler, "Event Sourcing" (martinfowler.com)
- React docs: [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
