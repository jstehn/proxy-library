# Design: Collection & singles store

- **Phase:** 7
- **Status:** **Approved** (self-approved during the unattended run, 2026-09-27; see
  [decisions-to-review.md](../decisions-to-review.md))
- **Related ADRs:** 0006 (CQRS-lite reads), 0011 (printing × finish), 0013 (price history and
  store ledger), 0014 (market price for singles)

## 1. Purpose & scope

Players **browse their collection** (search, filters, sorting, total value), look at **one card
in detail** (price history, what they own, what they paid), **buy singles** from the store at
market price, and **sell singles** back to the store at the buylist rate (50% of market by
default, decided before the run).

**Out of scope:** player-to-player sales (trades are Phase 10), bulk selling ("sell all
duplicates", listed in future-ideas), and serialized-number tracking (see section 13).

## 2. Vocabulary

| Term             | Meaning                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- |
| **Single**       | One card, bought or sold on its own, at a specific printing and finish.                     |
| **Market price** | The latest daily snapshot of Scryfall's price for that printing and finish (ADR 0013/0014). |
| **Buylist rate** | The share of market price the store pays when buying a card from a player (basis points).   |
| **Payout**       | What a sale pays: market price × buylist rate, **rounded down** to the cent, per copy.      |

## 3. Domain model

```ts
// store/domain
type MarketQuote = { price: Cents; day: string }; // the snapshot used, recorded with the sale
function payoutPerCopy(market: Cents, rateBps: number): Cents; // Cents.applyRate (rounds down)

// collection/domain
type CardLoss = CardGain; // copies leaving, positive quantities
```

## 4. Rules

1. **Singles sell at market price:** the latest snapshot for that printing **and finish**. A
   finish with no price can't be bought, and it can't be sold either.
2. **Buying a single is one transaction:** a store transaction (`single`, `buy`), a wallet
   `purchase_single` entry, and the cards added to the collection with source `store`.
3. **Selling is one transaction:** the copies are removed (the player must own that many of that
   printing and finish), a store transaction (`single`, `sell`, with the rate used), a wallet
   `sellback` entry, and a negative acquisition with source `sale`.
4. **Payout rounds down**, per copy, then × quantity. A card whose payout is $0.00 can't be sold.
   (Selling it would give nothing, and a ledger entry can't be $0.)
5. **The buylist rate** is 0–100% (0–10,000 basis points), default 50%, admin-editable. At 0% the
   store isn't buying.
6. **Quantity** per buy or sell: 1–24. A sale can't exceed the copies owned.
7. **Only printings in enabled sets** can be bought. Any owned printing can be sold, if it has a
   price.
8. Every store transaction records the **market price, the snapshot day and the rate** it used,
   so history never changes when prices or rates do (ADR 0013).

## 5. Use cases

| Use case         | Who    | Input                        | Output        | Errors (`kind`)                                                              |
| ---------------- | ------ | ---------------------------- | ------------- | ---------------------------------------------------------------------------- |
| `buySingle`      | player | printingId, finish, quantity | store receipt | `NotForSale`, `NoPrice`, `QuantityInvalid`, `InsufficientFunds`              |
| `sellSingle`     | player | printingId, finish, quantity | store receipt | `NoPrice`, `QuantityInvalid`, `NotEnoughCopies`, `WorthNothing`, `NotBuying` |
| `setBuylistRate` | admin  | rate (basis points)          | —             | `Forbidden`, `RateInvalid`                                                   |

## 6. Ports

```ts
// store
interface MarketPrices { quote(printingId, finish): Promise<{ price, day, isSetEnabled } | null> }
interface StoreSettings { buylistRate(): Promise<number>; setBuylistRate(bps, by, at) }
interface StoreLedger { …; recordSingle(tx): Promise<number> } // buy or sell
// collection (new)
interface CollectionRepository { …; remove(userId, losses, acquisition): Promise<Result<void, NotEnoughCopies>> }
function giveUpCards(services, userId, losses, acquisition) // also used by trades (Phase 10)
```

`remove` locks the player's rows for those printings (`FOR UPDATE`), checks every quantity,
then decrements (deleting rows that reach 0) and logs negative acquisitions.

## 7. State machines

None.

## 8. Persistence

- `store_settings` (a single row, `id = 1`): `buylist_rate_bps` (default 5000), `updated_at`,
  `updated_by`.
- `store_transactions` already supports singles (Phase 6).
- No new collection tables.

## 9. Read models

- `collectionPage(db, userId, filter)`: owned cards joined with printings, sets and latest
  prices, filtered by name, set, rarity, color and finish; sorted by newest, value, name or set
  and collector number; 60 per page; plus totals for the whole filtered collection.
- `searchPrintings(db, filter)` (catalog): printings in enabled sets with their prices, for the
  singles store.
- `printingDetail(db, id)` (catalog): one printing with its set and prices, and
  `priceHistory(db, id)`: every snapshot, per finish.
- `ownedCopies(db, userId, printingId)` (collection) and `singleHistory(db, userId, printingId)`
  (store): what this player owns, bought and sold of the card.

## 10. Screens

| Route          | Purpose                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/collection`  | filters (GET form, so a view is a URL), sort, pages, totals; each card links to its page                                                                                                                |
| `/singles`     | the singles store: search printings in enabled sets, with prices; links to card pages                                                                                                                   |
| `/cards/[id]`  | the card large, its text, price per finish, **Buy** and **Sell** per finish (with the payout shown), a **price-history chart** with this player's buys and sells marked, and their store history for it |
| `/admin/store` | gains a **buylist rate** form                                                                                                                                                                           |
| `/wallet`      | gains a "Sold to the store" total                                                                                                                                                                       |

The chart is a small **server-rendered SVG** (`src/ui/price-chart.tsx`): one line per finish,
markers for buys (▲) and sells (▼). There's no chart library, since it's a few dozen lines.

## 11. Patterns applied

- **CQRS-lite (ADR 0006):** the collection and search screens are single SQL queries with
  filters built from a typed filter object. They never load domain objects.
- **URL as state:** filters and pages live in the query string, so views can be bookmarked and
  shared, and the back button works.
- **Unit of work across modules** (like Phase 6): `sellSingle` spans store, wallet and collection.

## 12. Test plan

- **Domain:** `payoutPerCopy` rounding (property test: never more than the market price, and never
  more than the rate implies); rate and quantity checks.
- **Use cases (fakes):** buying (no price, disabled set, not enough money), selling (not enough
  copies, worth nothing, rate 0, success writes all records).
- **Integration:** `remove` locking and quantity checks against Postgres; a buy-then-sell journey
  in `tests/integration` (collection back to 0, balance correct, two store transactions with
  their rates); two simultaneous sales of your last copy (one wins).
- **Queries:** the collection filters and sorts on fixture data.
- **End-to-end:** filter the collection, open a card, sell one copy, and see the balance rise.

## 13. Decisions made without review

1. **Serialized cards are ordinary stacks** for now (ADR 0011's open question). Individual serial
   numbers go in future-ideas.
2. **The payout is rounded per copy**, then multiplied, so selling 3 separately or together pays
   the same.
3. **A $0.00 payout can't be sold** (e.g. a 1¢ card at 50%).
4. **Selling doesn't require the set to be enabled.** You can always sell what you own, if it has
   a price.
5. **Market price for buying is the latest snapshot**, even if it's a few days old (a set whose
   sync failed). The snapshot day is shown next to the price.

## 14. Implementation notes (what changed while building)

- **The sell form stays on the page, disabled, when you own none.** Selling your last copy first
  made the form disappear, and its "Sold for …" message went with it: React keeps a form's state
  only while the form is on the page. The end-to-end test caught it.
- **`price_snapshots` gained an index on `day`.** "The newest price day" is asked by the store's
  featured art and the singles search, and without the index every such question would read the
  whole table, which grows by about 35,000 rows a day.
- **Integration tests share a harness** (`tests/integration/harness.ts`): the composition-root
  wiring, the fixture catalog, and `resetPlayers` (which also pins the money rules and the buylist
  rate, so no test depends on what an earlier one left behind).
- **The collection's filter conditions are written twice**, in the collection's query and the
  catalog's search, because a module's queries may read other modules' tables but not import their
  code. They're five short lines, so duplicating them is simpler than a shared layer.
- **Adding two ports to `StoreServices`** made the compiler list every place that had to provide
  them (the composition root, the integration harness, the fakes). That's structural typing doing
  the bookkeeping.
