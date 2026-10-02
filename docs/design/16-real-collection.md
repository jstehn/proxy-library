# Design: the real collection

- **Phase:** 16
- **Status:** **Approved** (2026-10-01, with the decisions in section 14)
- **Related:** design doc 04 (catalog sync, rule 13), design doc 07 (collection screens), design
  doc 09 and 14 (decks, proxy PDFs), design doc 15 (list parsing and card search), ADR 0006
  (cross-module reads), ADR 0009 (lint boundaries), ADR 0011 (printing × finish)

## 1. Purpose & scope

Requested 2026-10-01: each player can record the cards they **own for real**, kept apart from
the cards they own in the game. They can enter them by hand, paste a list, or import a file from
a collection app. They can then see them like the game collection (search, filters, total
value), export them, and **build decks from real and game cards together**, so all their decks
live in one place. Proxy PDFs can leave out the cards you already have for real (asked for in
future-ideas).

**Out of scope:** buying, selling or trading real cards in the app, or using them anywhere in the
game besides deck building; condition and language; individual copies with serial numbers,
grading or purchase prices; automatic syncing with outside apps (you re-import a file instead);
undoing an import (future-ideas).

## 2. Ubiquitous language

| Term                | Meaning in this codebase                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Game collection** | What the `collection` module has always tracked: cards from packs, the store and trades. Only game events change it.             |
| **Real collection** | Cards a player owns physically, as they recorded them. The player edits it freely, and it never touches money or the game.       |
| **Real copy**       | One row of the real collection: a printing, a finish and a quantity (ADR 0011's unit, the same as the game).                     |
| **Import**          | Reading a pasted list or a collection app's file, matching each line to a printing, and applying it after you've seen a preview. |
| **Reference set**   | A set imported into the catalog only so its cards can be recorded as real copies. It isn't sold and has no packs in the store.   |
| **Real cards on**   | A deck's switch: when on, real copies count as owned when building that deck.                                                    |
| **Shared**          | A player's switch: when on, other players can look at (not change) their real collection.                                        |

## 3. Why a separate module

A flag on `collection_cards` ("is real") would be less code, but the two follow opposite rules:

| Game collection                                      | Real collection                        |
| ---------------------------------------------------- | -------------------------------------- |
| changes only through game events, in one transaction | the player types whatever they own     |
| every change is in the `acquisitions` ledger         | no ledger, only the current state      |
| can be sold to the store, traded, opened from packs  | none of these                          |
| counts in decks                                      | counts in decks with **real cards on** |
| reset when a player is reset                         | left alone                             |

Mixing them would make every existing query and use case add "and not real", and forgetting it
once would let someone sell a card they typed in. So it gets its own module,
**`src/modules/real-collection`**, with its own table. It may read printings and prices. Of the
other modules, only **decks** reads it (its `real_cards` table, through queries, as ADR 0006
allows), and no game module (store, trades, wallet, packs, collection) does.

## 4. Domain model

```ts
// real-collection/domain
type RealCopy = Readonly<{ printingId: PrintingId; finish: Finish; quantity: number }>;

/** One line of an import, after reading it but before matching it to the catalog. */
type ImportLine = Readonly<{
  lineNumber: number;
  quantity: number;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  scryfallId?: string; // ManaBox files have it, so the match is exact
  finish: Finish; // nonfoil unless the line says otherwise
}>;

/** What one line becomes once matched (the preview shows one per line). */
type MatchedLine =
  | Readonly<{ kind: "Matched"; line: ImportLine; printingId: PrintingId }>
  | Readonly<{ kind: "Unmatched"; line: ImportLine; reason: UnmatchedReason }>;

type UnmatchedReason =
  | { kind: "NoSuchCard" } // no printing has that name
  | { kind: "NoSuchPrinting" } // the card exists, but not with that set and number
  | { kind: "FinishNotAvailable"; finishes: Finish[] }; // e.g. a foil copy of a card never printed in foil

type ImportMode = "add" | "replace"; // add to what's there, or make the collection exactly this file

/** The change an import makes, worked out before anything is saved (a pure function). */
function planImport(
  current: readonly RealCopy[],
  matched: readonly RealCopy[],
  mode: ImportMode,
): ImportPlan;
type ImportPlan = Readonly<{
  added: RealCopy[];
  changed: Array<RealCopy & { from: number }>;
  removed: RealCopy[];
}>;
```

### Reading files

| Format                      | How it's recognized                    | Matched by                                     |
| --------------------------- | -------------------------------------- | ---------------------------------------------- |
| **A pasted list**           | not a CSV header                       | set + number if given, else name (section 4.1) |
| **Moxfield collection CSV** | header has `Count`, `Name`, `Edition`  | set + collector number, else name              |
| **ManaBox CSV**             | header has `ManaBox ID`, `Scryfall ID` | Scryfall ID (exact)                            |
| **Our own export** (`full`) | our header                             | set + collector number                         |

Each format is a small **reader** with the same shape, `(text) => { lines, unreadable }` (the
Strategy pattern, as the exporters already do). Pasted lists use `parseList` from
`@/shared/card-search`, `*F*`/`*E*` markers included. CSV files are read by a CSV library rather
than by hand, because quoted fields with commas and line breaks are easy to get wrong. Condition
and language columns are ignored. Other formats aren't planned.

### 4.1 A name with no set

"Lightning Bolt" with no set becomes the card's **newest ordinary printing**: the most recent
release that isn't a promo, token, or special treatment (borderless, showcase, extended art,
full art, serialized), with the wanted finish. If no printing is ordinary, it's the newest one
with that finish. The preview shows the printing like any other line (no "guessed" mark), and
every line has a **printing menu** to choose another.

## 5. Rules (invariants)

1. **Real cards never touch the game:** no money, no ledger entries, no store, trades or packs,
   nothing in the activity feed. Lint enforces it: no module but `decks` imports or reads
   `real-collection`.
2. **Decks count real cards only with the switch on:** a deck with **real cards on** counts
   real copies plus game copies as owned (by card, any printing, as decks already count). With
   it off, only game copies count, as today.
3. **Quantities** are whole numbers from 1 to 9,999 per row. Setting a row to 0 deletes it.
4. **The finish must exist for that printing** (no foil copy of a nonfoil-only card).
5. **Only the owner can change a real collection.** Other players can **see** it only while
   its owner has it **shared** (off by default).
6. **An import is all or nothing**, in one transaction, and it applies **exactly the preview you
   confirmed**. The server re-plans it, and if your collection changed in between (another tab),
   nothing is saved and the new preview is shown.
7. **Lines that don't match are skipped and listed**, never dropped silently.
8. **Size:** at most 20,000 lines or 5 MB per import, which covers large collections.
9. **Resetting a player leaves the real collection alone.** Deleting the account deletes it.

## 6. Use cases

| Use case               | Who   | Input                                               | Output              | Errors (`kind`)                                                        | Transaction? |
| ---------------------- | ----- | --------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- | ------------ |
| `setRealCopies`        | owner | printingId, finish, quantity (absolute)             | the row             | `PrintingNotFound`, `FinishNotAvailable`, `QuantityInvalid`            | yes          |
| `changeRealPrinting`   | owner | from (printing, finish), to (printing, finish)      | the row it's now in | `NotOwned`, `PrintingNotFound`, `FinishNotAvailable`, `NotTheSameCard` | yes          |
| `previewImport`        | owner | file text or pasted text, mode                      | matched lines, plan | `ImportEmpty`, `ImportTooLarge`, `FormatNotRecognized`                 | read only    |
| `applyImport`          | owner | matched copies (printings as chosen), mode, version | the plan applied    | `ImportEmpty`, `ImportTooLarge`, `CollectionChanged`                   | yes          |
| `clearRealCollection`  | owner | confirmation                                        | rows removed        | —                                                                      | yes          |
| `setRealSharing`       | owner | shared: boolean                                     | —                   | —                                                                      | yes          |
| `setDeckUsesRealCards` | owner | deckId, on: boolean (decks module)                  | —                   | `DeckNotFound`, `Forbidden`                                            | yes          |

- `setRealCopies` takes the **new quantity**, not "+1", so pressing a button twice or retrying a
  request can't add two copies.
- `changeRealPrinting` moves a whole row to another printing **of the same card** (its oracle
  id). If you already have that printing and finish, the quantities are added together.
- The preview's "version" for rule 6 is the time of the collection's newest change
  (`max(updated_at)`) plus its row count. `applyImport` locks the player's rows and compares.

## 7. Where it shows up

| Route / place                        | What                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/collection` and `/collection/real` | two tabs, **Game** and **Real**, with the same search, filters, sorts, sections and totals (value at today's market price); each real row can change printing |
| `/collection/real/import`            | paste or upload, choose **Add** or **Replace**, see the preview (matched, skipped, and for Replace what gets removed), change any line's printing, **Import** |
| `/collection/real` → Export          | the same formats as the game collection (Moxfield, text, full CSV)                                                                                            |
| `/collection/real` → settings        | **"Let other players see my real collection"** (off by default); **Clear real collection** (asks to confirm)                                                  |
| `/players/[id]/real` (new)           | another player's real collection, read only, when they share it; linked from player names (trades, activity) only when shared                                 |
| `/cards/[id]`                        | a **"Real copies"** box: −/+ and a number per finish                                                                                                          |
| Deck builder                         | a **"Use my real cards"** switch per deck. On: the card pool and ownership include real copies, and each line shows where its copies are ("3 game · 1 real")  |
| Proxy PDF options                    | **"Leave out cards I own for real"**: a deck needing 4 Bolts when you have 2 real prints 2                                                                    |
| Buy a list (design doc 15)           | "Only buy what I don't already own" counts real copies when the deck the list came from has real cards on                                                     |
| Card search (design doc 15)          | a `real` keyword like `own`: `real>=1`, `real=0`. In a deck with real cards on, `own` counts both                                                             |

The deck switch is **on for new decks** and off for decks made before this phase, so nothing
changes under anyone without them asking.

### Catalog coverage: reference sets

The catalog now enables every expansion, core and Commander set (design doc 04, rule 13), which
covers most cards. The rest of the 810 paper sets (promos, Masters, Secret Lairs, duel decks,
Un-sets, …) hold printings that real collections contain too. So:

- **The sync imports every paper set**, as a **reference set** if it isn't enabled: printings
  only, no boosters, products or decks (the way supporting sets are imported today). About 500
  set files of ~1 MB each, downloaded once, a few dozen per run so no single run is long; after
  that only new sets are imported. No admin switch: it's always on.
- Reference sets **aren't sold**. Enabling one later imports it fully, as enabling a supporting
  set does today.
- **Prices:** snapshots stay limited to enabled and supporting sets, plus **printings someone
  owns for real**, so real collection values work without snapshotting every printing every
  night. The catalog asks for those printings through a port, `ExtraPricedPrintings`, which the
  composition root fills from the real collection, so the catalog doesn't import the new module.

This changes what the catalog is for (from "what can be sold" to "every paper card"), so it gets
an **ADR (0018): reference sets**.

## 8. Ports

```ts
// real-collection/application
interface RealCollectionRepository {
  copies(userId: UserId): Promise<RealCopy[]>;
  version(userId: UserId): Promise<CollectionVersion>;
  set(userId: UserId, copy: RealCopy, at: Date): Promise<void>; // 0 deletes
  move(
    userId: UserId,
    from: RealCopyKey,
    to: RealCopyKey,
    at: Date,
  ): Promise<Result<RealCopy, NotOwned>>;
  apply(
    userId: UserId,
    plan: ImportPlan,
    expected: CollectionVersion,
    at: Date,
  ): Promise<Result<void, CollectionChanged>>;
  clear(userId: UserId): Promise<number>;
  setShared(userId: UserId, shared: boolean, at: Date): Promise<void>;
}
interface PrintingMatcher {
  // reads the catalog's tables (CQRS-lite), batched: one query per import
  match(lines: readonly ImportLine[]): Promise<MatchedLine[]>;
}

// catalog/application (new)
interface ExtraPricedPrintings {
  printingIds(): Promise<PrintingId[]>;
}
```

Plus `Clock` and `UnitOfWork`. Adapters: `drizzleRealCollectionRepository`,
`sqlPrintingMatcher`; fakes for both. The decks module's ownership lookup (`OwnedLookup`) gets
its numbers from a query that adds `real_cards` when the deck's switch is on; `deckProblems`
itself doesn't change.

## 9. Persistence

Migration 0019:

```
real_cards (
  user_id      text not null references players(user_id) on delete cascade,
  printing_id  text not null references printings(id),
  finish       text not null check (finish in ('nonfoil', 'foil', 'etched')),
  quantity     integer not null check (quantity between 1 and 9999),
  added_at     timestamptz not null,
  updated_at   timestamptz not null,
  primary key (user_id, printing_id, finish)
)
index real_cards_printing_idx on (printing_id)   -- "printings someone owns for real", for prices

real_collection_settings (
  user_id      text primary key references players(user_id) on delete cascade,
  is_shared    boolean not null default false,
  updated_at   timestamptz not null
)
```

- `decks.uses_real_cards boolean not null default false`; new decks are created with `true`.
- `card_sets.printings_imported_at timestamptz`: when a set's printings were last imported
  (supporting or reference), so the sync knows which sets still need importing.
- No history table: the real collection stores only what you have now.

## 10. Events emitted

None. Changing your real collection isn't a game event, so it stays out of the activity feed.

## 11. Patterns applied

- **Separate bounded context** (section 3) rather than a flag: rules that differ get their own
  model, and the one place they meet (deck ownership) is a single, switchable query. This is the
  main lesson of the phase.
- **Strategy:** one reader per file format, as the exporters do.
- **Functional core:** reading, matching results and `planImport` are pure; only the matcher and
  repository touch the database.
- **Preview, then confirm with a version** (optimistic concurrency): the same idea as design doc
  15's quote, applied to a collection instead of prices.
- **Port owned by the consumer** (`ExtraPricedPrintings`): the catalog says what it needs, and
  the composition root connects the two modules without either importing the other.

## 12. Test plan

- **Readers:** each format from a small recorded file in `tests/fixtures/real-collection/`
  (Moxfield, ManaBox, our export, a pasted list), including quoted fields, foil/etched columns,
  condition and language columns (ignored), blank and broken lines, and a file in no known
  format.
- **`planImport`** (property tests): `add` never removes anything; `replace` then reading back
  gives exactly the file; applying a plan twice in `add` mode doubles quantities, in `replace`
  mode changes nothing the second time.
- **Newest ordinary printing** (unit): skips promos and special treatments, respects the finish,
  falls back when nothing is ordinary.
- **Matching** (integration, fixture catalog): Scryfall ID, set + number, name only, unknown
  name, unknown printing, foil not available. One query per import, not per line.
- **Use cases (fakes):** quantity limits, finish check, changing printing (merges, refuses a
  different card), `CollectionChanged` when the version moved, clear, sharing.
- **Decks:** with the switch off a deck is short exactly as today; on, real copies fill the gap;
  a deck of only real cards is buildable; selling or trading still sees game copies only.
- **Isolation:** resetting a player keeps their real cards; deleting the account removes them;
  another player sees a real collection only while it's shared, and can never change it; lint
  fails if a game module imports `real-collection`.
- **Catalog:** a reference set is imported printings-only once and not again; it isn't sold;
  its printing gets a price snapshot only once someone owns it for real.
- **Proxy PDFs:** "leave out real cards" prints only what's missing, by card across printings.
- **Browser test:** import a ManaBox file, change a line's printing in the preview, import, see
  the cards and their value on the Real tab, turn on a deck's real cards and see it become
  complete, print its proxies without them.
- Screenshots in dark mode and at phone width, including a long preview with skipped lines.

## 13. Order of work

Builds on design doc 15 (the list parser and card search in `@/shared/card-search`, migration 0018) and on design doc 04's rule 13 (expansion, core and Commander sets enabled by default).

1. Catalog: reference sets, `printings_imported_at`, `ExtraPricedPrintings` (and the ADR).
2. Real collection: domain, readers, use cases, repository, matcher.
3. Screens: Real tab, import, card page box, sharing.
4. Decks: the switch, ownership, proxy option, `real` search keyword.
5. Lesson 16 and commit.

## 14. Decisions from review (2026-10-01)

1. **Decks:** real cards count in a deck when its **"Use my real cards"** switch is on, so all
   decks can be managed in one place. They still can't be sold, traded or used anywhere else in
   the game. (The switch is per deck, on for new decks; section 7.)
2. **Catalog coverage:** every paper set is imported, as a reference set when not enabled.
3. **Condition and language** aren't tracked.
4. **Visibility:** only the owner by default; the owner can share it with the other players,
   read only.
5. **File formats:** pasted lists, Moxfield and ManaBox CSV, and our own export. No others.
6. **A name with no set** gets the newest ordinary printing, with no "guessed" mark; the player
   can choose or change the printing in the preview and later.
7. **Resetting a player** leaves the real collection alone.
8. **Undo last import** goes in future-ideas.
