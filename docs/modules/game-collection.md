# The game collection: cards owned, trades, wishlist, reset, activity

The cards a player owns through the game (bought, opened, traded, drafted), and what happens to them:
the acquisition log, trades, the wishlist, starting over, the activity feed and the exports. Code:
`src/modules/{collection,trades,wishlist,reset,activity}/`. The real collection (cards a player owns
outside the game) is in `real-collection.md`; P30 merges the two modules and keeps the rule that real
cards never touch the game's money (owner answers, 2026-11-19). Checked against `refactor/main`
(2026-11-20) by the tests named in brackets.

## Owning cards

1. **A collection is the sum of its acquisitions log.** Quantities are per printing and finish
   (finishes kept apart); changes that cancel out are dropped; fractions are refused. Every card gained
   is logged with its source (store, pack, trade, draft, sale, reset). (doc 06 §4 rule 7, doc 07 §4 rule 2;
   `cards.test.ts`)
2. **Ownership counts by card, not by printing,** for decks: pinning or showing a printing you do not
   own never makes an owned card show as short. (doc 24 §4 rule 5, ADR 0011)
3. **Serialized cards are ordinary stacks** for now. (doc 07 §13.1, owner review 2026-10-06)
4. **Exports** are Moxfield CSV, a plain text list with foil markers, and a full CSV with values in
   dollars; values are quoted only when needed and quotes doubled; Moxfield rows say condition "Near
   Mint" and language "English", which the app does not track. (doc 11 §7.4, doc 16 §14.5;
   `export.test.ts`)

## Trades

5. **An offer has at least one item,** at most one money item per side, card quantities 1-99, money
   $0.01 to $10,000; the same printing and finish from one side combine; a counter-offer is a new
   proposal and the original is closed. (doc 10 §5 rule 1, §12.4; `trade.test.ts`, `trades.test.ts`)
6. **You cannot trade with yourself or a disabled player;** a stranger sees a trade as not found.
   Only the recipient accepts, declines or counters; only the proposer cancels; a trade is decided once.
   (doc 10 §5 rules 2 and 6; `trade.test.ts`)
7. **Nothing is reserved while a proposal waits.** It is checked at proposal (a friendly early check)
   and again inside the acceptance transaction; if either side is short of cards or money the
   acceptance is refused (`NoLongerPossible`, saying who and what), nothing moves and the trade stays
   proposed. Proposals do not expire. (doc 10 §5 rules 3-4, §12.1 and 3; `trades.test.ts`)
8. **Acceptance is one transaction:** both wallets are locked in a fixed order (by user id), money moves
   (`trade_out` / `trade_in`, referencing the trade) and then cards (acquisitions with source `trade`).
   Collections are visible to other players in the trade builder. (doc 10 §5 rule 5, §12.2;
   `trades.test.ts`)

## Wishlist

9. **At most one wish per target** (same card and finish preference, or same printing and finish);
   adding again updates the quantity; at most 500 wishes per player; quantity 1-99; target price 1 cent
   to $100,000; note at most 200 characters; an exact-printing wish names a finish the printing has.
   (doc 26 §4 rules 1-4; `wishlist.test.ts`, `wish.test.ts`)
10. **Only the owner** sees, changes or buys from their wishlist. Buying buys exactly the printing the
    page showed and only the missing copies, through the store's single purchase (see `economy.md` rule
    11); a purchase that fills the wish deletes it in the same transaction, a wish filled another way
    shows "You own this". (doc 26 §4 rules 5-8; `wishlist.test.ts`)
11. **A shared wishlist shows cards, preference, quantity and notes, never the wallet, allowance,
    payday countdown or target and saved prices.** Who may see it is the player's wishlist visibility
    (everyone, friends or only me; default friends, see `accounts.md` rule 13); the trade builder shows
    "Cards {partner} wants" when the partner's visibility allows. (doc 51 §4 rule 3 and §11, doc 48-social
    §13.2; `profile.ts` `canViewSection`, `profile.test.ts`) See the disagreement below.

## Starting over

12. **An admin may reset anyone; a player may reset themselves** (typing START OVER); anyone else gets
    `Forbidden`. Nothing in a ledger is deleted: money is one entry noted as a reset, cards are negative
    `reset` acquisitions, store receipts and accepted trades stay. Locks follow the order other actions
    use (trade, wallet, item, cards) so a reset waits instead of deadlocking. Totals start again from
    zero after a reset. The admin's screen asks for the username to be typed first. A reset deletes the player's decks and the feed events about them, keeps their
    comments on other players' decks, and leaves the real collection alone. Tokens are not revoked by a
    self-reset. (doc 12 §3, doc 21 §4 rule 7, doc 16 §5 rule 9, doc 28 §13.5; reset code under
    `src/modules/reset/`, `wishlist.test.ts` "part of a reset")

## Activity

13. **The feed shows notable pulls, sealed purchases, completed trades and shared decks.** A pull is
    notable if mythic or better, or worth $5 or more (plain rares stay out; the opener still celebrates
    a rare). Purchases show the product, not the price; trades show who and how many cards, not what or
    for how much. A deck's events show only while the deck exists and is shared. (doc 11 §7.1-2, doc 21
    §4 rule 8, owner review 2026-10-06; `events.test.ts`)
14. **The friends view** includes your own events alongside your accepted friends'. (doc 48-social
    §13.3)

## Disagreements recorded here (for the project manager)

- **Wishlist sharing default:** doc 51 §4 rules 1-2 say a wishlist is private until its owner turns
  `isShared` on; doc 48-social §13.2 and the code (`wishlistVisibility`, default `"friends"`, no
  `isShared` column on wishlists) make it visible to friends by default. Code followed. Decided 2026-11-20 (owner): the code; doc 51 is marked.
