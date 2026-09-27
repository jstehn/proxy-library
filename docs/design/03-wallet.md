# Design: Wallet

- **Phase:** 3
- **Status:** **Implemented** 2026-09-27 (approved with all proposals). See section 15 for how the build differed.
- **Related ADRs:** 0003 (Result), 0004 (append-only ledger), 0005 (unit of work),
  0008 (injected clock)

## 1. Purpose & scope

The `wallet` module holds each player's virtual money. It answers "how much do I have?", "where
did it come from and where did it go?", and "how much has each player spent and given
themselves?". Money arrives through a **starting grant**, a weekly **allowance**, admin
**grants**, and **self-funding** (players with permission add their own). Admins can also take
money away with a **correction**.

**Out of scope for this phase:**

- Spending money in a store (Phase 6) and selling cards back (Phase 7). This phase builds the
  debit logic and tests it (corrections use it), but other modules start calling it in Phase 6.
- Public player profiles (backlog). For now only **admins** see other players' totals (decided in
  review).

## 2. Vocabulary

| Term                 | Meaning in this codebase                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| **Ledger**           | The list of every money change for every player. Rows are only ever **added**, never edited or deleted. |
| **Ledger entry**     | One change: amount (positive = in, negative = out), kind, optional note, who did it, and when.          |
| **Balance**          | The sum of a player's ledger entries. Never stored, always calculated.                                  |
| **Payday**           | A moment when an allowance is due, e.g. every Monday 00:00 UTC.                                         |
| **Allowance**        | The fixed amount every player receives each payday.                                                     |
| **Starting grant**   | A one-time welcome amount a player receives when their wallet opens.                                    |
| **Grant**            | Money an admin gives a player, with a note ("won Friday's draft").                                      |
| **Correction**       | Money an admin takes away, with a note ("undo mistaken grant"). Can't push a balance below $0.          |
| **Self-funding**     | A player with permission adding money to their own wallet. Always recorded as such.                     |
| **Economy settings** | The admin-editable numbers: allowance amount and schedule, starting grant, self-funding limit.          |
| **Wallet account**   | One row per player: the lock target for money changes, and how far their allowance has been paid.       |

## 3. Domain model

```ts
// wallet/domain/ledger.ts
export type LedgerKind =
  | "starting_grant" // +  once, when the wallet opens
  | "allowance"      // +  each payday
  | "grant"          // +  admin gives
  | "correction"     // -  admin takes away
  | "self_fund";     // +  player adds their own
  // Later phases add: "purchase_sealed", "purchase_single", "sellback", "trade_in", "trade_out".

export type LedgerEntry = Readonly<{
  userId: UserId;
  amount: Cents;              // positive = money in, negative = money out
  kind: LedgerKind;
  note: string | null;        // required for grant and correction
  createdBy: UserId | null;   // the admin or player who did it; null for automatic entries
  effectiveAt: Date;          // when it counts (an allowance is effective at its payday)
}>;

/** Each kind of entry must go in one direction. Checked in code AND by a database constraint. */
export const DIRECTION: Record<LedgerKind, "in" | "out"> = { … };

// wallet/domain/economy.ts
export type EconomySettings = Readonly<{
  allowance: Cents;                 // default $20.00
  allowancePeriodDays: number;      // default 7
  allowanceAnchor: Date;            // a payday; others are anchor ± N × period. Default Monday 00:00 UTC
  startingGrant: Cents;             // default $50.00
  selfFundLimit: Cents;             // max per self-funding deposit, default $100.00
}>;

// wallet/domain/wallet-account.ts
export type WalletAccount = Readonly<{
  userId: UserId;
  allowancePaidThrough: Date;       // every payday up to and including this moment has been paid
  openedAt: Date;
}>;
```

### Paydays: a pure function

```ts
/** Every payday p with after < p ≤ upTo, oldest first. */
export function paydaysBetween(
  schedule: { anchor: Date; periodDays: number },
  after: Date,
  upTo: Date,
): Date[];
```

Paydays are `anchor + k × period` for every whole number `k`, including negative ones, so the
anchor can be any past or future payday. This function is the whole allowance rule. Everything
else just records what it returns.

## 4. Rules (invariants)

1. **The ledger only grows.** No update or delete, ever. A mistake is fixed by a new entry.
2. **Balance = sum of entries.** There is no stored balance to drift out of sync.
3. **A balance never goes below $0.** Every money-out entry (for now only corrections) checks
   the balance first, while holding the wallet lock.
4. **Each kind goes one way:** starting grant, allowance, grant and self-fund are positive, and
   correction is negative. This is enforced in code and by a database `CHECK`.
5. **Amounts are whole cents**, greater than zero as entered, and at most **$10,000.00** per
   entry (a guard against typos like an extra zero).
6. **Every payday is paid exactly once per player.** Paydays at or before `allowancePaidThrough`
   are never paid again, even if two requests pay allowances at the same moment (section 8).
7. **The starting grant is paid exactly once**, in the same transaction that opens the wallet.
8. **Allowance starts after joining.** A new wallet's `allowancePaidThrough` is the moment it
   opens, so the first allowance is the next payday.
9. **Settings changes apply from now on.** Before new settings are saved, every wallet is paid up
   under the old ones. Nothing is recalculated backwards.
10. **Grants and corrections: admins only, note required** (1–200 characters).
11. **Self-funding: only players with `canSelfFund`**, at most `selfFundLimit` per deposit.
12. **Totals** (spent, self-funded, received) are sums over ledger kinds, never stored.

### Rounding rule (decided here, used from Phase 7)

When money is calculated with a percentage (the buylist rate for selling cards), the result is
**rounded down to the whole cent**, so a player is never paid more than the exact value.
`Cents.applyRate(amount, rateBasisPoints)` lives in the kernel and is the only place this
rounding happens.

## 5. Use cases

| Use case                | Who                    | Input                | Success         | Errors (`kind`)                                                                     |
| ----------------------- | ---------------------- | -------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `refreshWallet`         | system (any page)      | userId               | current balance | —                                                                                   |
| `refreshAllWallets`     | system (admin pages)   | —                    | —               | —                                                                                   |
| `grantMoney`            | admin                  | userId, amount, note | new entry       | `Forbidden`, `AmountInvalid`, `NoteRequired`, `PlayerNotFound`                      |
| `correctBalance`        | admin                  | userId, amount, note | new entry       | `Forbidden`, `AmountInvalid`, `NoteRequired`, `PlayerNotFound`, `InsufficientFunds` |
| `addOwnFunds`           | player (`canSelfFund`) | amount, note?        | new entry       | `SelfFundingNotAllowed`, `AmountInvalid`, `SelfFundLimitExceeded`                   |
| `updateEconomySettings` | admin                  | new settings         | saved settings  | `Forbidden`, `SettingsInvalid`                                                      |

**`refreshWallet(userId)`** is the heart of the module. Inside one transaction it:

1. **Locks** the player's wallet account (or creates it if it doesn't exist yet: the wallet
   "opens", and the starting grant is recorded).
2. Asks `paydaysBetween(schedule, allowancePaidThrough, now)` which paydays are due.
3. Records one `allowance` entry per due payday (effective at that payday), and moves
   `allowancePaidThrough` to now.

Wallets are refreshed **lazily**: whenever a page shows money, and before any money-out entry. So
a player who hasn't visited for three weeks gets three allowance entries on their next visit, each
dated to its own payday. No background job is needed, and none can be missed.

Every other use case that changes money calls the same refresh step first, so it always works
with an up-to-date balance.

## 6. Ports

```ts
/** The ledger and wallet accounts (write side). */
export interface WalletRepository {
  /** Lock this player's wallet account for the rest of the transaction; null if none yet. */
  lockAccount(userId: UserId): Promise<WalletAccount | null>;
  insertAccount(account: WalletAccount): Promise<void>;
  updateAccount(account: WalletAccount): Promise<void>;
  appendEntries(entries: readonly LedgerEntry[]): Promise<void>;
  balance(userId: UserId): Promise<Cents>;
  listAccountUserIds(): Promise<UserId[]>;
}

export interface EconomySettingsRepository {
  get(): Promise<EconomySettings>;
  /** Lock the settings for the rest of the transaction (used while changing them). */
  lockAndGet(): Promise<EconomySettings>;
  save(settings: EconomySettings, updatedBy: UserId): Promise<void>;
}

/** Does this player exist? The wallet asks instead of reaching into the accounts module. */
export interface PlayerDirectory {
  exists(userId: UserId): Promise<boolean>;
}
```

Plus `Clock` and `UnitOfWork` from the kernel. Adapters: `drizzleWalletRepository`,
`drizzleEconomySettingsRepository`, `drizzlePlayerDirectory` (reads the `players` table, which
lint allows through the accounts module's `schema.ts`). The fakes are in-memory versions of each,
passing shared contract tests.

## 7. State machines

None beyond the wallet account's existence (not open → open). The ledger is append-only, so it has
no states.

## 8. Persistence

```sql
wallet_accounts (
  user_id                text primary key references players(user_id),
  allowance_paid_through timestamptz not null,
  opened_at              timestamptz not null
)

ledger_entries (
  id            bigserial primary key,
  user_id       text not null references wallet_accounts(user_id),
  amount_cents  bigint not null,
  kind          text not null,
  note          text,
  created_by    text references players(user_id),
  effective_at  timestamptz not null,
  recorded_at   timestamptz not null default now(),
  check (amount_cents <> 0),
  check (kind in ('starting_grant','allowance','grant','correction','self_fund')),
  check ((kind = 'correction') = (amount_cents < 0))   -- rule 4
)
index on ledger_entries (user_id, effective_at desc)

economy_settings (
  id                     smallint primary key check (id = 1),   -- exactly one row
  allowance_cents        bigint not null,
  allowance_period_days  integer not null,
  allowance_anchor       timestamptz not null,
  starting_grant_cents   bigint not null,
  self_fund_limit_cents  bigint not null,
  updated_at             timestamptz not null,
  updated_by             text references players(user_id)
)
```

The migration inserts the default settings row: $20.00 every 7 days anchored at Monday
00:00 UTC of the current week, a $50.00 starting grant, and a $100.00 self-funding limit.

**Locking:** money changes lock the player's `wallet_accounts` row with `SELECT … FOR UPDATE`.
This is a row lock (lesson 02 used an advisory lock), and it makes two requests for the **same**
player take turns while leaving different players independent. `updateEconomySettings` locks the
settings row, then refreshes every wallet before saving.

**Time zones:** the anchor is stored as an exact instant. "Monday 09:00 in my time zone" is chosen
on the settings page and converted to an instant. Across a daylight-saving change, paydays shift
by one hour in local time. Accepted for simplicity.

## 9. Read models (queries)

| Query                       | Used by                | Returns                                                                           |
| --------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| `walletSummary(db, userId)` | `/wallet`, site header | balance, total received, total self-funded, total spent (always $0 until Phase 6) |
| `walletHistory(db, userId)` | `/wallet`              | latest 100 entries: date, kind, amount, note, who                                 |
| `playerMoney(db)`           | `/admin/players`       | per player: balance, total spent, total self-funded                               |
| `economySettings(db)`       | `/admin/economy`       | the current settings                                                              |

Totals use SQL aggregates, e.g. `sum(amount_cents) filter (where kind = 'self_fund')`.

## 10. Screens

| Route            | Who               | Purpose                                                                                 |
| ---------------- | ----------------- | --------------------------------------------------------------------------------------- |
| site header      | signed-in players | shows your balance                                                                      |
| `/wallet`        | signed-in players | balance, totals, history; an "Add funds" form if you may self-fund                      |
| `/admin/players` | admins            | adds balance / spent / self-funded to each row, plus "Give money" and "Correct balance" |
| `/admin/economy` | admins            | allowance amount and schedule, starting grant, self-funding limit                       |

Money is typed as dollars (`12.50`, `$12.50` or `12`) and parsed into `Cents` with a strict parser
(`Cents.fromUsd`), never a float.

## 11. Patterns applied

- **Append-only ledger (15):** ADR 0004 made concrete, including the per-kind sign constraint.
- **Functional core (1):** `paydaysBetween`, the amount and note checks, and "can this balance
  afford it" are pure functions. The use cases only load, lock and save.
- **Injected clock (17):** every "now" comes from `Clock`, so tests can jump weeks ahead with
  `manualClock`.
- **Unit of work (5) + row lock:** refresh and money-out happen inside one transaction holding the
  player's row lock.
- **Ports & adapters (2):** `PlayerDirectory` keeps wallet from depending on accounts' internals.
  It uses `Actor` from accounts' public API only.
- **CQRS-lite (6):** screens read summaries with SQL aggregates, never through the repository.
- **Contract tests (18):** wallet and settings repositories, in-memory vs Drizzle.

## 12. Test plan

- **Domain:** `paydaysBetween` with fixed examples (exact payday instants, anchors in the future,
  multi-week gaps) plus properties: results are strictly increasing, all inside the window, and
  **splitting a window never changes the total** (`paydays(a→b) + paydays(b→c) = paydays(a→c)`).
  Amount and note validation. The direction rule for every kind.
- **Use cases (fakes + `manualClock`):** a wallet opens with the starting grant exactly once;
  three weeks later exactly three allowances, dated to their paydays; refreshing twice pays
  nothing extra; a settings change pays up under the old amount first; a correction can't go
  below $0; self-funding permission and limit; admin-only rules.
- **Contract tests:** repositories, in-memory vs Drizzle.
- **Integration:** the database rejects a positive correction and a negative grant (constraint);
  **concurrency:** ten simultaneous refreshes of one wallet pay each payday once; two simultaneous
  corrections that together exceed the balance: one succeeds, one gets `InsufficientFunds`.
- **End-to-end:** an admin grants money → the player sees it in their header and history → the
  admin corrects part of it → the history shows both with notes.

## 13. Lesson 03 outline

"Money, time and a ledger": why an append-only ledger (and how it resembles double-entry
bookkeeping and event sourcing); time as a function input (paydays, property tests with
generated dates); row locks (`SELECT … FOR UPDATE`) versus advisory locks; doing work lazily
instead of on a schedule; SQL aggregates with `FILTER`; parsing money typed by people; one module
asking another a question through a port.

## 14. Decisions from review (all proposals accepted)

1. Largest single grant, correction or self-funding deposit: **$10,000.00** (typo guard); the
   self-funding limit setting can be lower.
2. Do **disabled** players keep receiving allowances? **Yes**: they simply pile up, and an admin
   can correct them if needed. The alternative (tracking disabled periods) adds complexity for a
   rare case.
3. History length on `/wallet`: **latest 100 entries** for now (paging later if needed).
4. Default payday: **Monday 00:00 UTC**. Change it on the settings page to your local time.

## 15. Implementation notes (what changed while building)

- **Opening a wallet exactly once** uses `insert … on conflict do nothing returning`, so only the
  request that actually inserted the row pays the starting grant. Locking a row that doesn't exist
  yet isn't possible, which is why the port has `openAccountIfMissing` and `lockAccount`
  instead of a single "lock or create".
- **Lock first, then read the settings**, so a settings change that finished while a refresh
  waited for the lock is already visible to it.
- **`refreshAllWallets` also opens wallets** for players who have never visited, so the admin
  Players page shows everyone's starting grant immediately.
- **`economy_settings.updated_by` has no foreign key.** With one, `TRUNCATE players CASCADE`
  (as tests do) would also delete the single settings row.
- **Kernel additions:** `Cents.applyRate` (the rounding rule) and `Cents.toPlainDollars`
  ("20.00" for text fields, round-trip tested against `Cents.fromUsd`, which now also accepts a
  leading `$`).
- **Architecture rule refined:** infrastructure may import another module's public `index.ts`
  (for shared types like `Actor`), recorded in conventions.md.
- **Evidence for the row lock:** with `FOR UPDATE` removed from `lockAccount`, the "ten
  simultaneous visits after three paydays" test failed 5 out of 5 runs, paying up to **24**
  allowances instead of 3. With the lock it passes every time.
