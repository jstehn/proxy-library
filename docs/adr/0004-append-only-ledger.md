# 0004. Record money as an append-only ledger with per-account locking

- **Status:** Proposed
- **Date:** 2026-09-26

## Context

Wallets receive allowances, grants and self-funding, and they pay for sealed product, singles and
trades. "Total spent" and "self-funded" must be publicly visible and trustworthy. Two browser
tabs could try to spend the same money at once.

## Decision

- Table `ledger_entries(id, user_id, amount_cents, kind, ref jsonb, created_at)`. **Insert-only.**
  Corrections are new compensating entries, never updates or deletes.
- `kind` ∈ `allowance | grant | self_fund | purchase_sealed | purchase_single | sellback | trade_in | trade_out`.
- **Balance = `SUM(amount_cents)`**. "Total spent" = `-SUM` of purchase kinds. "Self-funded" =
  `SUM` of `self_fund`.
- A `wallet_accounts(user_id PK, allowance_accrued_through timestamptz)` row per user serves as
  the **lock target**. Every debit runs `SELECT … FOR UPDATE` on it inside the transaction, then
  checks the balance, then inserts.
- Amounts are integer cents (`Cents` brand). A DB `CHECK` guards the sign per kind.

## Consequences

- ✅ A full audit trail. Any balance can be explained line by line.
- ✅ Public stats are simple aggregate queries.
- ✅ Serialized debits per user, and no lost updates.
- ❌ Balance is a `SUM` per read. It's fine at this scale (an index on `user_id`). If it ever
  isn't, add a cached balance column maintained in the same transaction (new ADR).

## Alternatives considered

- **Mutable `balance` column:** no history, and "total spent" would need a second source of truth.
- **Serializable isolation instead of row locks:** works, but needs retry loops everywhere.
  Explicit locking is easier to reason about and to teach.
