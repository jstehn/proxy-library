# Design: Trades

- **Phase:** 10
- **Status:** **Approved** (self-approved during the unattended run, 2026-09-27; see
  [decisions-to-review.md](../decisions-to-review.md))
- **Related ADRs:** 0004 (ledger), 0005 (unit of work), 0011 (printing × finish)

## 1. Purpose & scope

Players trade with each other: **cards and money on either side** (decided before the run). One
player proposes, the other **accepts**, **declines** or **counters** (a counter is a new proposal
going the other way), and the proposer can **cancel** while it's waiting. Accepting moves
everything **in one transaction**: every card and every cent, or nothing.

**Out of scope:** sealed product in trades (decided before the run), trades between more than two
players, escrow or reserving cards while a proposal waits (section 12).

## 2. Vocabulary

| Term          | Meaning                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Proposer**  | The player who made this proposal.                                                                                                       |
| **Recipient** | The player it's addressed to, who decides.                                                                                               |
| **Item**      | One thing changing hands: copies of a printing in a finish, or an amount of money, from one side.                                        |
| **Counter**   | The recipient's answer with different terms: the original becomes `countered`, and a new proposal goes back the other way, linked to it. |

## 3. Domain model

```ts
type TradeSide = "proposer" | "recipient"; // who gives the item
type TradeItem =
  | { kind: "card"; from: TradeSide; printingId; finish; quantity }
  | { kind: "money"; from: TradeSide; amount: Cents };
type TradeStatus = "proposed" | "accepted" | "declined" | "cancelled" | "countered";
type Trade = {
  id;
  proposerId;
  recipientId;
  status;
  items;
  message;
  replacesId: TradeId | null;
  createdAt;
  decidedAt: Date | null;
};
```

## 4. State machine

| From      | Event   | Who       | To                                                   |
| --------- | ------- | --------- | ---------------------------------------------------- |
| proposed  | accept  | recipient | accepted                                             |
| proposed  | decline | recipient | declined                                             |
| proposed  | counter | recipient | countered (and a new `proposed` trade the other way) |
| proposed  | cancel  | proposer  | cancelled                                            |
| any other | any     | anyone    | refused: `AlreadyDecided`                            |

A player who isn't part of the trade gets `TradeNotFound`, exactly like a missing trade.

## 5. Rules

1. **An offer has at least one item**, at most one money item per side, card quantities 1–99, and
   money $0.01–$10,000. The same printing and finish from the same side is combined.
2. **You can't trade with yourself**, or with a disabled player.
3. **At proposal time**, each side must own the cards listed from it, and the proposer must have
   the money offered. This is a friendly early check: nothing is reserved.
4. **At acceptance, everything is checked again** inside the transaction, because the proposer may
   have sold the cards since. If either side is now short of cards or money, the acceptance is
   refused (`NoLongerPossible`, saying who and what), nothing moves, and the trade stays proposed.
5. **Acceptance is one transaction:** both wallets are locked **in a fixed order** (by user id, so
   two acceptances can't deadlock each other), then money moves (`trade_out` / `trade_in` ledger
   entries with `ref = trade:<id>`), then cards (logged as acquisitions with source `trade`).
6. **The trade row is locked** while it's decided, so it can be accepted or declined only once.

## 6. Use cases

| Use case       | Who       | Errors (`kind`)                                                                                     |
| -------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `proposeTrade` | anyone    | `CannotTradeWithYourself`, `PlayerNotFound`, `OfferInvalid`, `NotEnoughCopies`, `InsufficientFunds` |
| `acceptTrade`  | recipient | `TradeNotFound`, `AlreadyDecided`, `NoLongerPossible`                                               |
| `declineTrade` | recipient | `TradeNotFound`, `AlreadyDecided`                                                                   |
| `cancelTrade`  | proposer  | `TradeNotFound`, `AlreadyDecided`                                                                   |
| `counterTrade` | recipient | the above plus `proposeTrade`'s                                                                     |

## 7. Ports

```ts
interface TradeRepository {
  create(trade): Promise<TradeId>;
  lock(id): Promise<Trade | null>;
  decide(trade): Promise<void>;
}
interface TradePlayers {
  isActive(userId): Promise<boolean>;
}
interface Holdings {
  copies(userId, printingId, finish): Promise<number>;
} // for the friendly check
// plus WalletServices (spend / receive) and CollectionServices (giveUpCards / receiveCards)
```

The wallet gains the `trade_in` and `trade_out` ledger kinds.

## 8. Persistence

- `trades(id, proposer_id, recipient_id, status, message, replaces_id, created_at, decided_at)`.
- `trade_items(trade_id, position, from_side, kind, printing_id, finish, quantity, amount_cents)`,
  with CHECK constraints for each kind's shape.

## 9. Read models and screens

| Route          | Purpose                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/trades`      | waiting for you (with the header badge count), waiting for them, and history                                                                                                  |
| `/trades/new`  | the builder: choose a player, search your cards and theirs, add money, write a message. The draft lives in the URL (like the collection's filters), so it needs no JavaScript |
| `/trades/[id]` | one trade: both sides with card prices, and Accept / Decline / Counter or Cancel                                                                                              |

Other players' collections are visible **in the trade builder** (you have to see what someone has
to ask for it).

## 10. Patterns applied

- **State machine (13)** as a pure transition function.
- **Unit of work** across wallet, collection and trades, with **ordered locking** to avoid
  deadlocks.
- **URL as state** for the builder's draft.

## 11. Test plan

- **Domain:** transitions (every row of section 4), offer validation, combining duplicate items.
- **Use cases (fakes):** propose checks; accept moves cards and money both ways; refuse when a side
  no longer has the cards or money; decline, cancel and counter.
- **Integration:** a full trade against Postgres (collections, wallets, acquisitions and ledger in
  step); acceptance refused and rolled back after the proposer sold the card; two trades between
  the same players accepted at the same moment, in opposite directions, with no deadlock.
- **End-to-end:** a second player proposes a trade to the admin, and the admin accepts it.

## 12. Decisions made without review

1. **Nothing is reserved while a proposal waits**, and acceptance re-checks everything. Simpler,
   and a refused acceptance explains exactly what changed.
2. **Collections are visible to other players in the trade builder.**
3. **Proposals don't expire.** Either side can end one (decline or cancel).
4. **Money limit per side: $10,000**, the same as the wallet's per-entry limit.

## 13. Implementation notes (what changed while building)

- **The wallet gained `lockWallets(services, userIds, now)`**, which brings wallets up to date
  and locks them sorted by user id. Trades use it; any future use case needing several wallets
  should too.
- **Deadlocks, tested honestly.** The integration test accepts two opposite trades at once and
  both succeed, but it passed even with the ordering removed: the two transactions didn't overlap
  closely enough. Two raw transactions that lock wallets in **opposite** orders, with a pause in
  between, do fail: Postgres reports `deadlock detected` and aborts one. Locking in the **same**
  order, the second waits and both commit. Lesson 10 shows the experiment. The ordering is
  justified by that reasoning, not by the test.
- **The builder's draft lives in the URL.** Each form carries the rest of the draft in hidden
  fields. If someone submits one form before a click on another has loaded, the older draft wins
  (the end-to-end test hit this and now waits). A client-side builder would avoid it, which is
  listed in future-ideas.
- **Counter-offers reuse the builder**, prefilled from the original trade seen from the other
  side, with `replaces=<id>`.
