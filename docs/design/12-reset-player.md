# 12. Reset a player's library

**Status:** approved (2026-09-28: you chose "Admin 'Reset player'" when asked how to clean up
test purchases). A small feature, so this doc is short.

## 1. Purpose

An admin can empty a player's library, for example after testing with real purchases. Before
this, the only options were SQL or wiping the whole database.

## 2. What a reset does

In **one transaction** (all or nothing), for one player:

| Part          | What happens                                                                           | Module       |
| ------------- | -------------------------------------------------------------------------------------- | ------------ |
| Open trades   | Ones they proposed are **cancelled**, ones they received are **declined**              | `trades`     |
| Money         | Balance goes back to the **starting grant**, with one grant or correction entry        | `wallet`     |
| Sealed items  | Every item, opened or not, and its opening record is **deleted**                       | `inventory`  |
| Cards         | Every copy leaves the collection, logged as a negative acquisition, source `reset`     | `collection` |
| Decks         | Every deck is **deleted**                                                              | `decks`      |
| Activity feed | Their pulls and purchases are deleted; trades stay (the other player was part of them) | `activity`   |

## 3. Rules

1. **An admin may reset anyone; a player may reset themselves** (added 2026-09-29: "Start over"
   on the Account page, confirmed by typing START OVER, with a warning that it wipes every card
   and doesn't recover all funds). Anyone else gets `Forbidden`; an unknown player gets
   `PlayerNotFound`. A self-reset's money entry is noted "Started over".
2. **Nothing in a ledger is deleted.** Money: one entry, noted "Library reset by <admin>".
   Cards: negative `reset` acquisitions, so the card history still adds up to what's owned.
   Store receipts and accepted trades stay.
3. **Locks follow the order other actions use** (trade → wallet → item → cards), so a reset
   waits for a trade being accepted or a pack being opened instead of deadlocking with it.
4. **The screen asks the admin to type the username** before resetting: it can't be undone.
5. **Totals stay historical.** "Spent" and "Self-funded" on the Players page still count
   spending before the reset.

## 4. Design

- A new module, `reset`, owns no tables. Its one use case, `resetPlayer(actor, userId)`, calls
  a function from each module's public API that runs in the caller's transaction:
  `closeOpenTrades`, `resetBalance`, `discardAllItems`, `giveUpEverything`, `deleteAllDecks`,
  `forgetPullsAndPurchases`. The same pattern as a trade calling `spend` and `giveUpCards`.
- Each module got one repository method for it (`openInvolving`, `removeAllOf`, `everything`,
  `deleteAllOf`, `forgetPullsAndPurchases`), in both the Drizzle adapter and the in-memory fake.
- Migration `0014_reset_source` allows the `reset` acquisition source.
- Screen: **Admin → Players → Reset library…** (`app/admin/players/reset-form.tsx`).

## 5. Tests

- `tests/integration/reset.int.test.ts`: a player with packs (one opened), a single, a deck and
  trades both ways is reset; everything is checked, including that another player is untouched,
  extra money is taken back with a correction, and non-admins are refused.
- The admin browser test resets a player through the screen, including a wrong confirmation.
