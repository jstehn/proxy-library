# 0013. Keep daily price history and an append-only store transaction ledger

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Players can sell singles back to the virtual store, and they want to see **what a card was worth
over time** and **what they actually sold (or bought) it for**. A single "current price" column,
overwritten on every sync, loses both. The wallet ledger (ADR 0004) records the money, but not
which card, which price, or which rate produced it.

Decided with the user: the **store** is the buyer (instant sale at a buylist rate, not a player
marketplace), and market prices are kept as **daily snapshots**.

## Decision

**Price history (catalog, Phase 4):**

- `price_snapshots(printing_id, finish, day, usd_cents)`, primary key
  `(printing_id, finish, day)`. It's append-only: each daily sync writes that day's price, and
  re-running a sync on the same day updates only that day's row.
- The "current price" is the latest snapshot. There's no separate mutable price column.
- Only printings in **enabled sets** get snapshots.

**Store transactions (store, Phases 6–7):**

- `store_transactions` is an append-only record of every single bought from or sold to the store:
  `(id, user_id, direction: buy | sell, printing_id, finish, quantity, unit_market_cents,
rate_bps, unit_price_cents, total_cents, price_day, created_at)`.
  - `unit_market_cents` is the market price used, and `price_day` says which snapshot it came
    from. `rate_bps` is the buylist rate for sells (e.g. 5000 = 50%), or 10000 for buys.
  - `unit_price_cents` is what was actually paid or received per copy.
- A sale writes, in **one unit of work**: the store transaction, a wallet ledger entry
  (`kind: sellback`, with the transaction id in `ref`), and the collection change (copies
  removed, with an acquisitions-log entry).
- Rows are never updated or deleted, the same as the wallet ledger.

**Screens (Phase 7):** a card's detail page shows its price-history chart with the player's own
buys and sells marked on it, plus a "my sales" history.

## Consequences

- ✅ "What was it worth, and what did I get for it?" is one query, forever.
- ✅ Buylist-rate changes never rewrite history, because each sale records the rate it used.
- ✅ Price charts come straight from `price_snapshots`.
- ❌ Storage grows daily: roughly (printings in enabled sets × finishes) rows per day. For about
  50 sets that's tens of thousands of rows a day, around 10–15 million a year. Postgres handles
  this fine with the primary-key index. If it ever matters, older history can be thinned to
  weekly without changing any code outside the catalog module.

## Alternatives considered

- **Record prices only when they change:** fewer rows, but "price on day X" queries become range
  lookups. Revisit if storage grows too large.
- **Record only the price at the moment of sale:** no charts and no market context.
- **Player-to-player marketplace:** not wanted for now. It could be added later on top of the
  same ledger with a new `direction` or a separate listings table.
