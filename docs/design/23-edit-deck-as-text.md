# Design: edit a deck as text, and use your most special copy

- **Phase:** 23
- **Status:** **Approved** (2026-11-03). Decisions: section 13 and 14.5, all as recommended,
  except the maybeboard, which is left for a later feature (question 2).
- **Related:** design doc 09 (decks, list export), design doc 14 (deck builder 2.0), design doc 15
  (list parsing, `@/shared/card-search`, optimistic concurrency), ADR 0017 (the shared
  card-search library)

## 1. Purpose & scope

A deck page today can **add** a pasted list ("Paste a list → Add these cards"), but it can't
**change** a deck as text. A player who edits a list somewhere else (a spreadsheet, a chat, a
deck site) has to remove cards one by one in the builder. This phase adds **Edit as text**: a
text box holding the deck's whole list, which you edit and save. **Saving replaces the deck
with what the text says.**

It also teaches the list reader the **category headings** that Archidekt and Moxfield exports
use ("Commander (1)", "Lands (36)", "Ramp & Mana Fixers (9)"). Today those lines are read as card
names: "Commander (1)" is reported as a card not found, so the commander lands on the main
board.

**Part 2 (feedback 2026-11-03): use the copy you own, the most special one first.** When a
card is added to a deck and you own it, the deck should show the version you own, preferring
the **most valuable or special** one (the pricier printing, a foil, a borderless or showcase
frame) rather than, as today, the one you hold the most copies of. See section 14.

**Out of scope:** choosing among a card's variants from the builder (later: future-ideas,
"Decks"); a maybeboard (decks have no such board, see question 2); undoing a save (the
deck's list as text is on the export page, so copy it first); editing a deck you don't own
(shared decks stay read-only, design doc 21).

## 2. Ubiquitous language

| Term                  | Meaning in this codebase                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deck text**         | A deck's whole list written as text: `Commander` / `Deck` / `Sideboard` sections, "1 Sol Ring (C21) 263 \*F\*" lines. What the text box starts with. |
| **Replace**           | Saving deck text: the deck afterwards holds exactly the text's cards, no more. (The existing **Add** keeps what was there.)                          |
| **Category heading**  | A line naming a group of cards with a count, "Lands (36)". Switches back to the main board unless it names a board ("Sideboard (10)").               |
| **Most special copy** | Of the copies you own of a card (real ones too when the deck uses them), the one ranked first by section 14's order: price, then finish, then frame. |
| **Fingerprint**       | A short hash of a deck's entries, sent with the text box so a save can tell the deck changed since the box was filled.                               |

## 3. Domain model

```ts
// src/shared/card-search/list.ts (changed): headers may carry a count, and category headings
// switch to "main". "Commander (1)" → commander; "Lands (36)" → main; "Sideboard (10)" → side.
// A heading is a line with no leading quantity that ends in "(digits)"; no card name does.

// src/modules/decks/domain/list-format.ts (new pieces)

/** The deck text the box starts with: printings and finish markers, so a save keeps both. */
export function deckText(lines: readonly ExportLine[]): string; // ExportLine gains `finish`

/** Same entries → same fingerprint, whatever order they're stored in. */
export function fingerprint(entries: readonly DeckEntry[]): string;

// src/modules/decks/domain/deck.ts (new)

/** A list line matched to a card: what `cards.resolve` already returns, plus the line. */
export type ResolvedLine = Readonly<{ line: ListLine; card: ResolvedCard }>;

/**
 * The entries a deck holds after replacing its list (pure). Two lines for the same card on the
 * same board are added together (capped at 99). A line without "(SET) number" keeps the
 * printing and finish the deck already had for that card; a finish marker always wins.
 */
export function replacedEntries(
  current: readonly DeckEntry[],
  lines: readonly ResolvedLine[],
): DeckEntry[];

// src/modules/decks/domain/errors.ts (new)
export type DeckChanged = { kind: "DeckChanged" };
export type ListProblems = {
  kind: "ListProblems";
  unreadable: string[]; // lines the reader couldn't understand
  notFound: string[]; // card names the catalog doesn't have
};
export type ListTooLong = { kind: "ListTooLong"; maximumLines: number };
```

## 4. Invariants

1. **Saving is all or nothing.** If any line is unreadable or names a card the catalog doesn't
   have, nothing is saved, and the reply lists every problem line. The text box keeps what you
   typed.
2. **Replace means replace.** After a save, the deck's entries are exactly the text's cards and
   quantities on the text's boards. Cards not in the text are removed.
3. **Round trip:** saving the text the box started with, unchanged, leaves the deck as it was:
   same cards, boards, quantities, printings and finishes (property test).
4. **Printings survive editing.** A line without "(SET) number" keeps the printing and finish the
   deck already had for that card; a line with one uses that printing.
5. **No lost edits.** If the deck changed after the box was filled (the builder in another tab),
   the save is refused with `DeckChanged` and nothing is written.
6. **Owner only:** someone else's deck is reported as not found (design doc 09, rule 7).
7. **Headings never become cards:** "Commander (1)" switches to the commander board, other
   "Name (N)" headings switch to main; neither is reported as a card.
8. **Size:** at most 1 000 lines per save.
9. **One line per card per board, whatever the art** (already true: entries are keyed by oracle
   card and board). "7 Forest" stays one line when you own Forests with different art, and the
   text never splits it into two lines.
10. **Adding a card you own pins your most special copy** (section 14), unless the line names a
    printing ("(SET) number"), which always wins.

## 5. Use cases

| Use case      | Actor / authz | Input                                     | Output                                     | Errors (`kind`)                                              | Transaction? |
| ------------- | ------------- | ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ | ------------ |
| `replaceList` | deck owner    | `deckId`, `text`, `fingerprint` (of form) | `{ cards: number }`: how many cards it has | `DeckNotFound`, `DeckChanged`, `ListProblems`, `ListTooLong` | yes          |

Steps: check the size → `parseList` → in one transaction: lock the deck (`lockOwned`), compare
fingerprints, `cards.resolve` (one query, as `importList` does), stop with `ListProblems` if any
line is unreadable or not found, `replacedEntries`, save.

`importList` (Add) is unchanged except that it now reads category headings too.

## 6. Ports

None new. `DeckRepository.lockOwned` / `save` and `CardLookup.resolve` already cover it.

## 7. State machines

None.

## 8. Persistence

No schema change. The fingerprint is computed from the entries, so it needs no
`version` column.

## 9. Read models (queries)

Deck page (`/decks/[id]`), owner only: a new **Edit as text** section, closed until opened (a
`<details>`, as the page's other panels are):

- A tall monospace text box (about 30 rows, full width, usable at phone width) filled with the
  deck text, and a hidden fingerprint.
- **Save list** and **Cancel**. While saving, the button says "Saving…".
- On `ListProblems`: an error under the box listing each unreadable line and each card not
  found. The text stays as typed so you can fix or delete those lines.
- On `DeckChanged`: "This deck changed since you opened the box. Reload to edit the latest
  list." The text stays so you can copy it.
- On success: the page reloads with "Saved: 100 cards."

Because errors must keep the typed text, this is a small client component using React's
`useActionState` with a server action (the current Paste form redirects and loses the text). I'll
check `node_modules/next/dist/docs/` for this Next version's form and action guidance before
writing it.

Each `deckView` line gains `pinnedPrintingId` and `pinnedFinish` (what the deck stores, null
when not pinned), so `deckText` writes printings and "\*F\*" / "\*E\*" only where pinned, and the
page fingerprints what's stored. (Found while building: `deckView`'s `deck.entries` have no
printings, since read models don't make `PrintingId` brands, so `fingerprint` takes plain
strings.) The export page stays as it is.

## 10. Events emitted

None. Editing a deck doesn't record activity today.

## 11. Patterns applied

- **Functional core:** `replacedEntries`, `deckText` and `fingerprint` are pure; the use case
  only orders I/O around them.
- **Parse, don't validate:** the same `parseList` as Add and Buy a list (ADR 0017).
- **Optimistic concurrency** (design doc 15): the client sends what it was based on, and the
  server refuses a stale save. A fingerprint of the content does the job of a version number
  without a new column.
- **Result for expected failures:** problem lines are a `ListProblems` error, not an exception.

## 12. Test plan

- **Domain unit/property tests:**
  - `parseList`: "Commander (1)", "Commanders (2)", "Sideboard (10)", "Lands (36)",
    "Ramp & Mana Fixers (9)", "Treasure Generators & Multipliers (9)" are headings; "1 Lightning
    Bolt", "Lightning Bolt" and "1 Sol Ring (C21) 263" are still cards. The user's Jolene list
    reads as 1 commander + 99 main cards with nothing unreadable.
  - `replacedEntries`: removed cards are gone; duplicates add up (capped at 99); printing and
    finish kept without a set code, replaced with one; a finish marker wins.
  - **Round trip (property, fast-check):** for random decks, replacing with the cards from
    `parseList(deckText(deck))` gives the same entries (invariant 3).
  - `fingerprint`: the same entries in any order give the same fingerprint, and any change in
    quantity, board, printing or finish gives a different one.
- **Use-case tests (fakes):** replaces; `ListProblems` saves nothing; `DeckChanged` saves
  nothing; someone else's deck → `DeckNotFound`; over 1 000 lines → `ListTooLong`.
- **Integration:** `replaceList` against Postgres removes entries and keeps pinned printings.
- **E2E touchpoint:** open Edit as text, delete a card's line, change a quantity, add a card,
  save; the builder shows the new list. A bad line shows the error and keeps the text. Screenshot
  in dark mode and at phone width.

## 13. Decisions (part 1)

1. **All or nothing, or save what matched?** **Decided: all or nothing** (invariant 1). Saving
   the rest would silently drop a card you meant to keep, which Replace makes worse than Add.
   (Example from the list that prompted this: _Ingenious Artillerist_ is in Battle for
   Baldur's Gate, which the local catalog hasn't imported yet. Run `pnpm worker sync full`, or
   remove the line and add the card later.)
2. **Maybeboard / "Considering" headings:** **decided: a later feature** (future-ideas,
   "Decks"). Until then the reader only makes sure such cards don't land in the main deck: lines
   under a `Maybeboard` or `Considering` heading are skipped.
3. **Lesson 23 concepts:** round-trip property tests (`parse ∘ format = identity`), replace vs
   merge semantics, and forms that keep their input (`useActionState`, progressive enhancement).
   **Decided: yes.**

## 14. Part 2: your most special copy first

### 14.1 Today

There are three places that pick which printing a deck line shows, and each prefers the printing
you own **the most copies of**:

| Where                              | Code                                    | Also misses        |
| ---------------------------------- | --------------------------------------- | ------------------ |
| Adding a pasted list (and Replace) | `drizzleCardLookup.resolve`             | ignores real cards |
| The builder's grid (click → add)   | `browseCollection`, `owned.printing_id` |                    |
| The deck view, when nothing pinned | `deckView`, `owned_printing`            |                    |

If you own none, the newest printing (nonfoil when it has one) is used. That stays.

### 14.2 The order

One SQL ordering, written once and used by all three, ranks the copies you own of a card
(`ownedCopies`: game copies, plus real ones when the deck has "Use my real cards" on):

1. **Price, highest first.** The latest `price_snapshots.usd_cents` for that printing **in that
   finish**, so a foil is priced as a foil. This covers "more expensive" and, usually, "foil".
2. **Special finish:** etched, then foil, then nonfoil (when prices tie or are missing).
3. **Special frame:** borderless, full art, showcase/extended art (`frame_effects`), promo
   (`promo_types`), then a plain card.
4. Then the copy you hold most of, then the newest set, then the printing id (so the order is
   always the same).

A `rankOwnedCopies` SQL fragment in `decks/queries/owned.ts`, beside `ownedCopies`, holds this.
Lint didn't let infrastructure import queries, so `eslint.config.mjs` now allows exactly one
file, the same module's `queries/owned.ts`, with a reason comment. The
finish chosen comes with the printing, so a foil copy is pinned as foil.

### 14.3 Rules

1. A line or click that names a printing keeps it; ranking only applies when it doesn't.
2. A card already in the deck keeps its pinned printing on Add and Replace (invariant 4). Only
   new cards are ranked.
3. Unpinned lines in the deck view use the same order, so what you see matches what an add
   would pin.
4. The ranking only chooses which copy is **shown**. Ownership still counts every copy of every
   printing (ADR 0011), so "7 Forest" with three arts owned is one line and not short.

### 14.4 Tests

- **Integration (Postgres):** owning a cheap nonfoil, a pricier nonfoil and a foil of one card,
  the pricier one is picked; with no prices, the foil; with a tie, the borderless one; a named
  printing wins; real copies count only when the deck uses them. Run against `resolve`,
  `browseCollection` and `deckView` so all three agree.
- **Unit:** `replacedEntries` keeps an existing pin when the ranking would pick another.

### 14.5 Decisions (part 2)

4. **One special copy, many copies needed?** You own 1 foil Sol Ring and 3 plain ones; the deck
   shows the foil (one line, one printing). **Decided: yes**, show the special one. Showing
   several printings in one line is the later variant feature.
5. **Price or foil first?** **Decided: price first.** A $40 nonfoil beats a $2 foil, and a foil
   usually costs more anyway. If you'd rather foil always win, swap steps 1 and 2.

### 14.6 After release (2026-11-03)

- **Placement.** The section was first below the builder, after every deck section, and was
  hard to find on a long deck. It now sits above the builder, and the header's links
  (Export, Print proxies, …) start with **Edit as text**, which opens the section and scrolls to
  it (`#edit-as-text`).
