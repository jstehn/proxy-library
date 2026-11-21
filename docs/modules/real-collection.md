# The real collection

The cards a player really owns, kept apart from the game. Code: `src/modules/real-collection/` (P30
merges it with the game collection and keeps the purpose below inside the merged module, owner
answers 2026-11-19). Checked against `refactor/main` (2026-11-20) by the tests named in brackets.

## What it is for

1. **Real cards never touch the game:** no money, no ledger entries, no store, trades or packs, nothing
   in the activity feed. Decks are the one bridge: a deck with "use my real cards" on counts real copies
   plus game copies as owned (by card, any printing); with it off only game copies count. The shape of
   the boundary (today a lint rule: only `decks` imports `real-collection`) is P30's to keep. (doc 16 §5
   rules 1-2, §14.1)
2. **Resetting a player leaves the real collection alone;** deleting the account deletes it. (doc 16 §5
   rule 9, §14.7)

## Rows

3. **Quantities are whole numbers from 1 to 9,999 per row;** setting a row to 0 deletes it; a row can
   move to another printing of the same card, merging with what is there; a different card is refused.
   The finish must exist for that printing. Condition and language are not tracked. (doc 16 §5 rules
   3-4, §14.3; `real-collection.test.ts`)
4. **Only the owner can change a real collection** (every change acts on the actor only). Other
   players see it only while its owner has it **shared** (off by default), read only. (doc 16 §5 rule
   5, §14.4; `real-collection.test.ts`, `isShared`)
5. **Real products:** adding a precon or other product adds exactly its list (every board, nested
   products as many times as they nest), adding it twice doubles the cards, and removing it with its
   cards removes them; removing without keeps the cards. Nobody else can remove your product.
   (doc 16 §15; `real-collection.test.ts`, `product-cards.test.ts`)

## Import

6. **Formats:** pasted lists, Moxfield and ManaBox CSV, and our own export; a CSV in an unrecognised
   format is refused; a list of names with commas is a list, not a CSV. (doc 16 §14.5;
   `readers.test.ts`)
7. **An import is all or nothing and applies exactly the preview the player confirmed:** the server
   plans again, and if the collection changed in between (another tab) nothing is saved and the new
   preview is shown; the confirmed printings are re-checked, so a tampered finish is refused. Add mode
   never removes anything; replace mode makes the collection exactly the file. (doc 16 §5 rule 6;
   `real-collection.test.ts`, `import-plan.test.ts`)
8. **Lines that do not match are skipped and listed,** never dropped silently; empty, oversized (more
   than 20,000 lines or 5 MB) and unrecognised imports are refused. (doc 16 §5 rules 7-8;
   `real-collection.test.ts`, `MAX_IMPORT_LINES`)
9. **Matching:** by Scryfall id exactly, even when the name differs; else by set and number, then set
   alone, then name; a name with no set takes the newest ordinary printing (promos and special
   treatments skipped, falling back to the newest printing when nothing is ordinary), without a
   "guessed" mark; the finish is respected; every paper set is matchable, as a reference set when not
   enabled. (doc 16 §14.2 and §14.6; `match.test.ts`, `reference-sets.test.ts`)

## Open decisions

None found. "Undo last import" is a deferred idea (doc 16 §14.8, `docs/future-ideas.md`).
