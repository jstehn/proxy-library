# The game economy: wallet, store, packs and opening

The virtual money, the store (sealed products and singles), the pack engine, the inventory of
unopened items and the opening experience. Code: `src/modules/{wallet,store,packs,inventory}/` and
`src/app/inventory/opened/_components/`. Written by responsibility; what a player owns afterwards is in
`game-collection.md`. Checked against `refactor/main` (2026-11-20) by the tests named in brackets.
Money is integer cents everywhere (`Cents`).

## Wallet

1. **The ledger only grows.** No update or delete; a mistake is a new entry. The balance is the sum of
   entries (nothing stored to drift); totals (spent, self-funded, received) are sums over entry kinds,
   counted from the latest reset. A balance never goes below $0, and money-out entries check it while
   holding the wallet lock. (doc 03 §4 rules 1-3 and 12, doc 12 §3 rule 5; `ledger.test.ts`,
   `wallet.test.ts`, `wallet.int.test.ts`)
2. **Each entry kind goes one way** (starting grant, allowance, grant and self-fund add money,
   corrections take it away), enforced in code and by a database check. Amounts are whole cents, above
   zero, at most $10,000.00 per entry; notes are at most 200 characters. (doc 03 §4 rules 4-5;
   `ledger.test.ts`)
3. **The starting grant is paid exactly once, and every payday exactly once per player,** even with
   simultaneous requests; a new wallet's first allowance is the next payday after it opened; changed
   settings apply from now on, after paying every wallet up under the old ones. (doc 03 §4 rules 6-9;
   `wallet.test.ts`, `economy.test.ts`, `wallet.int.test.ts`)
4. **Grants and corrections are admin only with a note.** Self-funding needs the player's permission
   and stays within the per-deposit limit. (doc 03 §4 rules 10-11; `wallet.test.ts`)

## Prices

5. **A sealed product costs its MSRP:** its own override, else its official MSRP, else its kind's price;
   a product with none is not for sale. Cases, displays and "Set of N" products never take a single
   product's kind price. Only products from enabled sets that can be fully opened (every pack has a
   recipe, every deck a list) are for sale. MSRPs are edited by admins, $0.01 to $10,000. (doc 06 §4
   rules 1, 2, 8 and §13.1; `pricing.test.ts`, `store.test.ts`)
6. **Two pricing modes, `msrp` (the default) and `value`** (admin switch). In `msrp` mode every list
   price (an official MSRP or a kind's price) sells as published, never raised to the resale floor. In
   `value` mode a list price is raised so that buying a product and selling everything back returns no
   more than it cost (never lowered, never created for a product with no list price, an admin's
   override exempt), and a kind-priced product is not for sale until valued. The store pages, buying,
   the Pack lab, Admin -> Store and a draft's entry fee all use the one rule, and the mode takes effect
   at once. The floor follows the buylist rate: at 0% it disappears. (doc 27 §4, doc 33 §4;
   `pricing.test.ts`, `value-products.test.ts`) See the disagreement below.
7. **Singles sell at the latest market price for that printing and finish;** a finish with no price
   cannot be bought or sold. Only printings in enabled sets can be bought; any owned printing with a price
   can be sold. The snapshot day, price and rate are recorded on every transaction so history never
   changes. (doc 07 §4 rules 1, 7, 8; `singles.test.ts`)
8. **The store buys back at the buylist rate** (0-100% in whole basis points, default 50%, admin
   editable, 0% means not buying). The payout is rounded down per copy then multiplied, never more than
   the market price and **never less than 1 cent for a card with a price**; only a $0.00 card cannot be
   sold. (doc 07 §4 rules 4-5, §13.2-3; owner review 2026-10-06; `singles.test.ts`)

## Buying

9. **Every purchase is one transaction:** the wallet is debited, a store transaction is written and the
   items or cards are created, all or nothing; a purchase fails if the balance cannot cover it. Quantity
   per purchase or sale is 1-24. (doc 06 §4 rules 3-4, doc 07 §4 rules 2-3 and 6; `store.test.ts`,
   `singles.test.ts`)
10. **Buy a list:** at most 250 lines; buys every line or none; prices again on the server and buys
    only if the total is the confirmed one or lower (a higher total buys nothing and shows the new
    quote); each line is recorded like a single purchase (one store transaction and one wallet entry,
    linked); the default printing is the cheapest for sale (the newest when asked, a named set and
    number first); "only buy what I don't already own" is on by default. (doc 15 §3.4 and §8;
    `singles.test.ts`, `shopping-list.test.ts`)
11. **A single's price in a wish** or deck "buy what it is short" goes through the same store code with
    the same wallet check, price and ledger entry; a price that rose since the page loaded refuses with
    `PricesChanged`. (doc 26 §4 rules 6-7; `wishlist.test.ts`, `singles.test.ts`)

## Packs

12. **A pack is repeatable and exact:** the same recipe and seed give the same pack, card for card; the
    seed is stored and part of the pack; a pack has exactly the slot counts of the variant it rolled;
    layouts roll in proportion to their weights. (doc 05 §4 rules 1-2 and 7; `generate.test.ts`)
13. **No duplicates in a draw** (same printing, or two versions of one card) unless the sheet has too few
    cards; no repeats between slots of one rarity (any-rarity slots such as the wildcard and foil may
    repeat, basic lands may always repeat); fixed lists are drawn first, then the rest in name order.
    (doc 05 §4 rule 3 and 3b; `generate.test.ts`)
14. **Finishes:** foil sheets give foil (or etched), other sheets nonfoil unless the printing exists in
    one finish; every finish is one the printing has; marked sheets show all five colours among the
    commons whenever they can within 50 tries. (doc 05 §4 rules 4-5; `generate.test.ts`)
15. **Reveal order builds suspense:** nonfoil commons, nonfoil uncommons, basic lands, foil commons and
    uncommons, then rares, mythics and specials in any finish; within a group cheapest first by market
    price (unknown is $0), then collector number, so the most valuable card is last. The pack lab
    simulates at most 1,000 packs per run. (doc 05 §4 rule 8, §14.1-2; `reveal.test.ts`, `report.test.ts`)
16. **A pack costs its MSRP; its contents are valued at market.** (doc 05 §14.3, ADR 0014; `odds.test.ts`)
17. **Every card in a real recipe is a real catalog printing,** checked by `pnpm worker check-packs`
    (violations are reported, not hidden), and every product for sale contains something
    (`check-products`). (doc 05 §4 rule 6; `checks.test.ts`, `unpack.test.ts`)

## Inventory and opening

18. **Items only move forward** (`unopened -> opened`); opening an opened item, or someone else's, is
    refused and the row is locked so a double click cannot open twice. A box opens its packs parents
    first; a bundle unpacks one level into packs, a deck and extras; a variable product picks the same
    option for the same seed; a product that gives nothing stays unopened. (doc 06 §4 rule 5;
    `inventory.test.ts`, `unpack.test.ts`)
19. **Every opening is replayable and recorded:** a pack stores its seed and cards, a product unpacking
    its seed, extras and created items; every card gained is logged, so the collection always equals
    the sum of its acquisitions. (doc 06 §4 rules 6-7; `inventory.test.ts`)
20. **Reveal order is the server's; nothing random happens in the browser.** Effects depend only on the
    card's rarity, finish and price; suspense only for hits (rare or mythic, or any card worth $5 or
    more at mythic level); always skippable (Reveal all, Skip, Space or Enter); "reduce motion" removes
    flips and shakes but not order or sound; sound is optional, generated in the browser, muted state
    remembered in `localStorage` with `try`/`catch`, starts only after the first click; card images
    preload while the pack is sealed and the tear waits at most 3 seconds. (doc 08 §4; `machine.ts`,
    `pack-opener.tsx`, `sounds.ts`)

## Disagreements recorded here (for the project manager)

- **Kind-priced products in `msrp` mode:** doc 33 §4 rule 2 says "in both modes, a kind-priced product
  never sells below its resale floor"; the code and its tests (`pricing.test.ts`, "sells a kind-priced
  product at its kind MSRP too, without raising to resale value") sell it at the kind price in `msrp`
  mode. The code's header comment (`pricing.ts`) agrees with the code. Code followed. Decided 2026-11-20 (owner): MSRP, not market rate; doc 33 is marked.
- **Doc 27 §4 rule 1** (no price below resale) holds only in `value` mode, as doc 33 amends it.
