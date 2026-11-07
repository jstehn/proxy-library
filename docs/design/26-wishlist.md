# Design: wishlist

- **Phase:** 26
- **Status:** **Built** (2026-11-06). Approved the same day with every recommendation except
  decision 4: Start over **deletes** the wishlist. Implementation notes in section 14
- **Related:** design doc 07 (singles store), design doc 15 (buy a list; its candidate ranking),
  design doc 03 (wallet and allowances), design doc 12 (reset), ADR 0013 (price history)

## 1. Purpose & scope

Your request: a **wishlist for singles**, so you can save a card you want (The Reaver Cleaver)
when you can't afford it yet, and come back to buy it.

The singles store already sells any printing of an enabled set at market price, and every
printing has a daily price history. A wishlist adds three things on top of that:

- **Saving a card**, either as "any printing, the cheapest one for sale" or as one exact
  printing and finish (the borderless foil, say).
- **A Wishlist page** that shows the current price of each wish, how it has moved since you
  saved it, whether your balance covers it, and when it will if allowances are on.
- **Buying from the wishlist** in one click, through the store's existing single-purchase
  code (same price, wallet check and ledger entry). Buying the copies you were missing removes
  the wish.

The Reaver Cleaver has five printings. Three are for sale (enabled sets): M3C #217 at $23.84,
DMC #8 at $27.62 and DMC Extended Art #84 at $31.09. HOC's borderless and The List aren't in an
enabled set. An "any printing" wish shows the M3C copy at $23.84. If DMC drops below that, it
shows DMC instead.

**Out of scope:** notifications outside the app (e-mail isn't set up) and sharing a wishlist
with other players (a later idea: "what my friends want" for trades). Adding a deck's missing
cards to the wishlist in one click is left out too, though it would be easy later (decision 5).

## 2. Ubiquitous language

| Term           | Meaning in this codebase                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Wish           | One card you want, with how many copies and which printing (any, or one exact printing and finish).                                |
| Any printing   | A wish keyed by the oracle card. It is filled by the cheapest printing for sale in the wish's finish preference.                   |
| Exact printing | A wish for one printing in one finish.                                                                                             |
| Target price   | Optional. "Tell me when it's at or below $20." The list highlights wishes at or under their target.                                |
| Saved price    | The wish's price on the day you saved it, kept so the list can say "down $1.20 since you saved it".                                |
| Affordable     | Your balance covers the wish's copies still missing, at today's price.                                                             |
| Paydays to go  | How many more allowances you need until it's affordable, if prices don't move. Shown only when allowances are on (allowance > $0). |
| Fulfilled      | You own at least the wanted number of copies (of any printing, for an "any printing" wish), however you got them.                  |

## 3. Domain model

```ts
type WishTarget =
  | Readonly<{ kind: "anyPrinting"; oracleId: string; finish: FinishPreference }>
  | Readonly<{ kind: "exactPrinting"; printingId: string; finish: Finish }>;

/** For "any printing": nonfoil only, foil only (foil or etched), or whichever is cheapest. */
type FinishPreference = "nonfoil" | "foil" | "cheapest"; // default "nonfoil"

type Wish = Readonly<{
  id: WishId; // branded
  userId: UserId;
  target: WishTarget;
  quantity: number; // 1–99; how many copies you want to own in total
  targetPrice: Cents | null;
  savedPrice: Cents | null; // null if nothing was for sale on the day you saved it
  note: string; // up to 200 characters, "" for none
  createdAt: Date;
}>;

/** What the Wishlist page shows for one wish (computed by a pure function from the query rows). */
type WishLine = Readonly<{
  wish: Wish;
  name: string;
  /** The printing it would buy today, or null when none is for sale. */
  offer: Candidate | null; // the shopping list's Candidate type (design doc 15)
  owned: number; // copies counted toward the wish (section 3.1)
  missing: number; // quantity − owned, at least 0
  totalCents: Cents | null; // offer price × missing
  changeSinceSaved: Cents | null; // offer price − saved price, per copy
  atTarget: boolean;
  status: WishStatus;
}>;

type WishStatus =
  | Readonly<{ kind: "affordable" }>
  | Readonly<{
      kind: "shortBy";
      shortfall: Cents;
      paydaysToGo: number | null;
      nextPayday: Date | null;
    }>
  | Readonly<{ kind: "notForSale" }> // no printing in an enabled set has a price
  | Readonly<{ kind: "fulfilled" }>; // you own enough already (from a pack, a trade…)
```

### 3.1 Which copies count as owned

- **Any printing:** copies of the oracle card in any printing and finish. If you own an M3C
  copy, you have The Reaver Cleaver.
- **Exact printing:** copies of that printing in that finish only. If you wished for the foil
  borderless and own a nonfoil M3C copy, the wish stays.

Real-collection cards (design doc 16) don't count, because you can't spend them in the game.

### 3.2 Paydays to go

`paydaysToGo = ceil(shortfall / allowance)`, with the date of the payday that gets you there from
`paydaysBetween`. It assumes you spend nothing else and the price doesn't change, and the page
says so. This is a pure function in `wishlist/domain`, property-tested (more allowance never
means more paydays; a shortfall of 0 is affordable).

## 4. Invariants

1. A player has at most one wish per target: same oracle card and finish preference, or same
   printing and finish. Adding it again updates the quantity (upsert), not a duplicate row.
2. At most 500 wishes per player.
3. `quantity` is 1–99. `targetPrice`, if set, is 1¢–$100,000. Note ≤ 200 characters.
4. An exact-printing wish names a finish the printing actually has.
5. Only the owner can see, change or buy from their wishlist (not-found for anyone else, as
   with private decks).
6. Buying from the wishlist goes through the store's single-purchase code, with the same wallet
   check, price and ledger entry as the card page. The wishlist never moves money itself.
7. Buying buys exactly the printing the page showed, and only the missing copies. If its price
   has gone up since the page loaded, the purchase is refused with `PricesChanged` (as Buy a list
   does) and the page reloads with the new price. A price drop just costs less.
8. A purchase from the wishlist that fills the wish deletes it in the same transaction. A wish
   filled another way (a pack, a trade, a draft) isn't deleted. The page shows it as
   "✓ You own this" with a Remove button (decision 3).

## 5. Use cases

| Use case     | Actor / authz | Input                                           | Output  | Errors (`kind`)                                                                    | Transaction?              |
| ------------ | ------------- | ----------------------------------------------- | ------- | ---------------------------------------------------------------------------------- | ------------------------- |
| `addWish`    | player        | target, quantity, targetPrice?, note?           | `Wish`  | `CardNotFound`, `FinishNotAvailable`, `WishlistFull`, `InvalidWish`                | yes (upsert)              |
| `updateWish` | owner         | wishId, quantity?, targetPrice?, note?          | `Wish`  | `WishNotFound`, `InvalidWish`                                                      | yes                       |
| `removeWish` | owner         | wishId                                          | —       | `WishNotFound`                                                                     | yes                       |
| `buyWish`    | owner         | wishId, printingId, finish, expected unit price | receipt | `WishNotFound`, `AlreadyOwned`, `PricesChanged`, `NotForSale`, `InsufficientFunds` | yes, one with the store's |

## 6. Ports

```ts
type WishlistServices = Readonly<{
  wishes: WishRepository; // findById, findByTarget, countFor, upsert, update, delete, deleteMany
  ownership: OwnedCopies; // copies by oracle card / by printing+finish (collection's query, via an adapter)
  catalog: PrintingLookup; // does this oracle card / printing+finish exist (catalog's public API)
}>;
```

The store exports its in-transaction purchase step (today the private `buyCopies` that both
`buySingle` and `buyList` use) as `buySinglesIn(services, …)`, in the same style as
`giveUpEverything(services, …)` and `resetBalance(services, …)`. `buyWish` runs one unit of work:
check the price, buy the missing copies through `buySinglesIn`, delete the wish.

## 7. State machines

None. A wish exists until you remove it or it's fulfilled.

## 8. Persistence

One table, owned by the new `wishlist` module. Migration `0028_wishlist.sql`.

```
wishes
  id              bigserial primary key
  user_id         text not null references players(user_id) on delete cascade
  kind            text not null check (kind in ('anyPrinting', 'exactPrinting'))
  oracle_id       text not null           -- set for both kinds (exact: the printing's card)
  printing_id     text references printings(id)   -- null for anyPrinting
  finish          text not null           -- 'nonfoil' | 'foil' | 'etched' | 'cheapest'
  quantity        smallint not null check (quantity between 1 and 99)
  target_cents    bigint check (target_cents between 1 and 10000000)
  saved_cents     bigint
  note            text not null default '' check (length(note) <= 200)
  created_at      timestamptz not null
  check ((kind = 'anyPrinting') = (printing_id is null))

unique index wishes_target on (user_id, kind, oracle_id, coalesce(printing_id, ''), finish)
index wishes_user on (user_id, created_at)
```

`oracle_id` is stored for exact wishes too, so "owned copies of this card" and "is this card
wished for" are one index lookup in both cases.

## 9. Read models (queries)

- **Wishlist page** (`/wishlist`, new header link after Singles): one query joins wishes to
  today's prices and owned counts, and the pure `wishLines` function ranks the offers and works
  out the statuses. It reuses design doc 15's candidate ranking, so "cheapest" means the same
  thing here as in Buy a list. Sorted by: at target first, then affordable, then smallest
  shortfall, with fulfilled wishes last. Each row shows the card image, the printing it would buy (with a menu of the other
  printings for sale, as in Buy a list), the price and change since saved, owned/wanted, a
  status line ("You can afford this", "$4.16 short, about 1 payday (Nov 9)", "Not for sale in
  an enabled set"), and Buy / Edit / Remove. A header line gives the total for everything
  affordable, and the total for the whole list.
- **Card page** (`/cards/[id]`): an "Add to wishlist" form next to Buy, with "Any printing" or
  "This printing" and a finish. If you already wish for it, it says so instead ("On your
  wishlist: 1 copy, any printing · Edit").
- **Singles grid and search**: a small ★ on tiles of cards you wish for (one extra set lookup
  per page).
- **Price drop badge**: the Wishlist header link shows a count of wishes at or under their target
  price, as the Trades link does for open trades. It's computed when the page loads, since
  prices change once a day with the nightly sync.

## 10. Events emitted

None. The activity feed is shared with other players, and a wishlist is private. Buying from it
records the usual single purchase.

## 11. Patterns applied

- **Functional core:** `wishLines`, `paydaysToGo`, and the target/duplicate rules are pure and
  tested without a database. The query only gathers rows.
- **Factory DI and one unit of work:** `buyWish` composes `store.buySingle`, as `buyList` does.
- **Expected failures as `Result`:** `PriceChanged` is an ordinary error, not a thrown one. The
  form shows it and reloads.
- **Upsert for "add again"**, as with token art choices (design doc 25).
- **Deliberate deviation:** the wishlist reads the collection's owned counts through a port
  rather than its own copy of them, so a sale or trade changes "owned" without a sync step.

## 12. Test plan

- **Domain unit/property tests:** `paydaysToGo` (monotonic in allowance, 0 shortfall,
  allowance 0 → null); `wishLines` (any-printing picks the cheapest for sale; exact printing
  ignores other printings; finish preference "cheapest" across foil and nonfoil; owned counts per
  section 3.1; sort order); target-price validation.
- **Use-case tests (fakes):** add twice upserts; 501st wish → `WishlistFull`; exact wish
  with a finish the printing lacks → `FinishNotAvailable`; other player's wish →
  `WishNotFound`; `buyWish` after a price rise → `PricesChanged` and no money moves; with too
  little money → `InsufficientFunds` and the wish stays; buying the missing copies deletes the
  wish; a wish already fulfilled → `AlreadyOwned`.
- **Integration (`test:int`):** the unique index; cascade on player delete; the wishlist query
  against seeded printings and prices; a buy that fails partway leaves both the wallet and the
  wish unchanged.
- **E2E:** add The Reaver Cleaver from its card page → it appears on /wishlist as "short by…"
  → grant money in the admin page → Buy → it leaves the list and appears in the collection.
  Screenshots in dark mode and at phone width.

## 13. Open questions

1. **What can a wish point at?** Recommended: **both** "any printing" (default) and "this exact
   printing and finish". The alternative is any-printing only, which is simpler but can't say
   "I want the borderless foil".
2. **Target price:** recommended **yes, optional**, shown as highlighting and the header badge
   only (no notifications outside the app). Alternative: leave it out for now and just show the
   change since saved.
3. **Fulfilled wishes:** recommended **buying from the wishlist removes the wish; any other
   route shows "✓ You own this" with Remove**. "Owned" is counted live, so selling the copy puts
   the wish back to "short by…". Alternative: delete wishes automatically however they're filled,
   which means calling the wishlist from the store, trades, packs and drafts transactions.
4. **Reset ("Start over"):** recommended keeping the wishlist. **Decided: delete it** with
   everything else, as design doc 12 says ("as when the account was new").
5. **"Add missing cards to wishlist" on a deck's "cards to get" panel:** recommended **later**,
   noted in future-ideas. It's a small add-on once this exists.
6. **Module:** recommended a **new `wishlist` module** (its own table, rules and page) that
   depends on store, catalog and collection. Alternative: put it inside `store`, which would
   save a module but mix "what you want" into "what the store sells".

## 14. Implementation notes (2026-11-06)

- **No `kind` column.** `printing_id is null` already says "any printing", so the table has two
  partial unique indexes (one per kind) instead of a `kind` column and an index over
  `coalesce(printing_id, '')`. A CHECK ties the allowed finishes to the kind.
- **Offers are the wishlist's own type, not the store's `Candidate`.** A queries file may not
  import another module's API, even types, so `Offer` lives in `wishlist/domain`, with the same
  order as Buy a list (cheapest, then newest). The SQL that gathers offers and owned copies is
  one file, `wishlist/queries/for-sale.ts`, which the use cases' adapter may import too (a lint
  exception like decks' `owned.ts`).
- **The store's purchase step.** The store now exports `buySingleIn(services, …)`: the checks of
  `buySingle` (quantity, priced, set enabled) plus an optional price limit, inside the caller's
  transaction. A rise above the limit is the store's existing `PricesChanged` error; a drop just
  costs less.
- **Buying refuses** a printing the wish doesn't ask for (`DoesNotFit`), a quantity above the
  copies still missing (`BuyQuantityInvalid`), and a wish already filled (`AlreadyOwned`).
- **A purchase that fills a wish** redirects to `/wishlist` with a "Bought … for …" banner,
  because the wish's row (and its form's message) disappears with it.
- **Reset** deletes the wishlist through `deleteWishlist(services, userId)`; the summary has
  `wishesDeleted`, shown in the admin's message. The Account page's warning names the wishlist.
- **Real data:** The Reaver Cleaver, any printing, nonfoil, offers M3C #217 at $23.84 out of 3
  printings for sale. A foil wish for it says "Not for sale", since its only foil (HOC) isn't in
  an enabled set.
- **E2E fixes on the way:** two older journeys still expected proxy counts from before token
  proxies (design doc 25: "1 card and 4 tokens…", and real cards still getting their tokens).
