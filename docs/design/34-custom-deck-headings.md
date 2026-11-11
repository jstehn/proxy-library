# Design: custom deck headings

- **Phase:** 34 (tududi task 110)
- **Status:** **Done** (approved 2026-11-10: your own order for headings; proposals 2–4)
- **Related:** design doc 09 (decks), 14 (the deck list), 19 (roles), 23 (Edit as text),
  32 (the maybeboard), ADR 0017 (the list reader in `@/shared/card-search`)
- **Lesson:** no (columns on two tables and changes along an existing path; nothing new to teach)

## 1. Purpose & scope

The deck list groups the main deck by card type (Creatures, Instants, Lands, ...) or, for a
moment, by role. Players on Archidekt and Moxfield group their decks by their own headings
instead: "Ramp", "Sac outlets", "Win conditions". This phase lets a deck do that, with a
per-deck switch between **its own headings** and **the built-in grouping by type**.

In scope: storing a heading per card, the switch, setting, renaming and ordering headings in the
builder,
reading headings from pasted lists, writing them back out (Edit as text and one export), and
the LLM tools.

**Out of scope:** several headings per card (the "By role" view already shows a card under
each of its roles), headings on the sideboard or maybeboard, and dragging (up and down buttons
order headings; they work at phone width).

## 2. Ubiquitous language

| Term           | Meaning in this codebase                                                                     |
| -------------- | -------------------------------------------------------------------------------------------- |
| Heading        | A name the player gives a group of main-deck cards ("Ramp"). At most one per card line.      |
| Grouping       | A deck's setting: `type` (built-in headings, the default) or `custom` (its own headings).    |
| Built-in group | Creatures, Instants, ... Lands: what `type` grouping shows, and what `custom` falls back to. |

## 3. Domain model

```ts
// decks/domain/deck.ts
export const GROUPINGS = ["type", "custom"] as const;
export type Grouping = (typeof GROUPINGS)[number];

export type DeckEntry = Readonly<{
  oracleId: string;
  board: Board;
  quantity: number;
  printingId: PrintingId | null;
  finish: Finish | null;
  heading: Heading | null; // new
}>;

export type Deck = Readonly<{
  /* as now */
  grouping: Grouping; // new
  /** The deck's headings in the owner's order: each heading a line uses, once. */
  headings: readonly Heading[]; // new
}>;

// decks/domain/headings.ts (new, pure)
export type Heading = Brand<string, "Heading">;
export const MAX_HEADING_LENGTH = 40;
export const MAX_HEADINGS = 30; // distinct headings per deck

/** Trimmed, 1–40 characters, not a board name ("Commander", "Sideboard", "Maybeboard", "Deck"). */
function checkHeading(raw: string): Result<Heading, HeadingInvalid>;

/** Every line with this heading gets the new one (null clears it); onto an existing one merges. */
function renamedHeading(deck: Deck, from: Heading, to: Heading | null): Deck;

/** The deck's headings in this order; it must name each of them exactly once. */
function orderedHeadings(deck: Deck, order: readonly Heading[]): Result<Deck, HeadingOrderInvalid>;

/**
 * The order kept consistent with the lines: headings no line uses any more drop out, and a new
 * one goes last. Every change to a deck passes through it before saving.
 */
function tidyHeadings(deck: Deck): Deck;
```

`withEntry` keeps a line's heading unless a new one is given, as it does for the pinned printing.
`movedEntry` keeps it too, so a card moved to the maybeboard and back returns under its heading.

### How the main deck is grouped

| Grouping | Groups, in order                                                                           |
| -------- | ------------------------------------------------------------------------------------------ |
| `type`   | As now: Creatures, Planeswalkers, ... Lands (headings are kept but not shown).             |
| `custom` | The deck's headings in its order, then the cards with no heading in their built-in groups. |

So a player can label a few cards ("Win conditions") and leave the rest grouped by type. The
commander, sideboard and maybeboard stay where they are, above and below.

## 4. Invariants

1. A heading only groups **main-deck** cards; on other boards it's stored but not shown.
2. A heading is never a board name, so reading a list back can't confuse the two.
3. Switching grouping changes only how the deck is shown; no card's heading is lost.
4. Edit as text, saved unchanged, leaves every heading as it was (design doc 23, rule 3, which
   now covers headings).
5. Problems, statistics, brackets, cuts and proxies ignore headings.

## 5. Use cases

| Use case                    | Actor / authz | Input                      | Output | Errors (`kind`)                                | Transaction? |
| --------------------------- | ------------- | -------------------------- | ------ | ---------------------------------------------- | ------------ |
| `setEntryHeading` (new)     | deck owner    | deck, card, heading / null | —      | EntryNotFound, HeadingInvalid, TooManyHeadings | yes          |
| `renameHeading` (new)       | deck owner    | deck, from, to / null      | —      | HeadingInvalid, HeadingNotFound                | yes          |
| `orderHeadings` (new)       | deck owner    | deck, every heading        | —      | HeadingOrderInvalid                            | yes          |
| `updateDeck` (gains field)  | deck owner    | `grouping`                 | as now | as now                                         | yes          |
| `importList`, `replaceList` | deck owner    | as now                     | as now | as now                                         | yes          |

Removing a heading from every card is renaming it to nothing: `renameHeading(from, null)`.

## 8. Persistence

One migration:

- `deck_entries.heading text null`, checked to be 1–40 characters.
- `decks.grouping text not null default 'type'`, checked to be `'type'` or `'custom'`.
- `decks.heading_order text[] not null default '{}'`: the headings in the owner's order. A list
  in one column rather than a table, because it's always read and written whole with the deck;
  the domain (`tidyHeadings`) keeps it matching the lines.

Every existing deck keeps today's look. The repository already rewrites a deck's entries on
save, so the heading travels with them; the `fingerprint` reads it too, so Edit as text notices
a heading changed elsewhere.

## 9. Read models and screens

- **The builder (phone width first):**
  - The deck list's view buttons become **By type · By heading · By role · Visual**. Choosing
    By type or By heading also saves the deck's grouping (the owner's choice, seen by anyone the
    deck is shared with); By role and Visual stay a passing view, as now.
  - The selected card's panel gains a **Heading** field: a text box offering the deck's existing
    headings (a `<datalist>`), with "None" to clear it. Typing a new name makes a new heading.
  - In By heading, each heading has small **↑ ↓** buttons and a **Rename** button beside its
    count: move it up or down; rename, merge into another heading, or clear it (its cards go
    back to their type groups). A new heading goes last.
- **The shared deck page** uses the deck's grouping.
- **Pasted lists** (`@/shared/card-search` `parseList`): a category heading line ("Ramp (9)",
  as copied from Archidekt or Moxfield) gives its cards that heading, on the main deck, instead
  of being dropped. Lines under a built-in type title ("Creatures (30)", "Lands (36)") get no
  heading: they're what `type` grouping shows anyway. Headings keep the order they appear in.
  A list with any custom heading sets the deck's grouping to `custom` when it's imported into a
  new deck.
- **Edit as text:** in `custom` grouping, the main deck is written as `Heading (count)` blocks
  (headings in the deck's order, then unheaded cards under "Deck"), so the text round-trips. Saving text with no
  headings in it keeps the headings (and their order) of cards still in the deck; text with any
  headings sets them all and their order (a card without one there loses its heading).
- **Export page:** a third box, **"With headings"**, in the same `Heading (count)` form that
  Archidekt reads. The other two boxes are unchanged (Arena and MTGO have no headings).

## 10. LLM tools

- `get_deck`: each line gains `heading` (null when none), and the deck gains `grouping`.
- `set_deck_entry`: an optional `heading` (a string, or null to clear; leaving it out keeps the
  current one).
- `update_deck`: an optional `grouping`.
- `create_deck` / `replace_deck_list`: their descriptions mention `Heading (count)` lines.
- `get_deck` lists the headings in order; new `arrange_headings` tool (write scope) renames,
  merges or clears one heading ("merge Removal into Interaction"), or sets their order.

## 12. Test plan

- **Domain:** `checkHeading` (trimming, length, board names), `withEntry` and `movedEntry` keep
  headings, `renamedHeading` (rename, merge, clear), `orderedHeadings` (rejects a missing or extra
  heading), `tidyHeadings` (drops unused, appends new), grouping in `custom` (headings in order,
  then type groups; other boards untouched).
- **Reader:** `parseList` gives headings from category lines, none under built-in type titles,
  and none outside the main deck; round trip `deckText` → `parseList` keeps headings
  (extends the existing property test).
- **Use cases (fakes):** `setEntryHeading` and `renameHeading` are owner-only and enforce
  `MAX_HEADINGS`; `replaceList` keeps headings when the text has none.
- **Integration:** the repository stores and reads headings and grouping; the LLM tools test
  sets a heading with `set_deck_entry` and reads it with `get_deck`.
- **Browser (scratch, dark, phone width):** give three cards a heading, switch to By heading and
  back, move one up, rename one, Edit as text round trip.

## 13. Decisions (2026-11-10)

1. **Order of headings:** **your own order** (chosen over the proposed A→Z), with up and down
   buttons, stored as `decks.heading_order`.
2. **Cards with no heading in `custom` grouping:** **accepted: in their usual type groups,
   after the headings**, so labelling a few cards doesn't hide the rest under "Other".
   Alternative: one "No heading" group at the end.
3. **One heading per card:** **accepted.** Archidekt allows several, but then counts stop
   adding up to the deck; By role already covers "a card in two groups".
4. **The shared grouping:** **accepted: the switch is saved on the deck**, so a shared deck
   shows the way its owner set it up. Alternative: each viewer's own choice, remembered in
   their browser.

## 14. Implementation notes (2026-11-10)

- Headings are plain strings checked by `checkHeading` (`decks/domain/headings.ts`), not a
  branded type: read models and pasted lists carry them as text. Besides length and board names,
  a heading must start with a letter and can't be a card type's title ("Creatures"), so every
  heading survives Edit as text (a line starting with a digit is a card; "//" and "#" are
  comments). `isReservedTitle` in `@/shared/card-search` holds the list reader's titles.
- The repository (and the fake) run `tidyHeadings` on every save, so the stored order always
  matches the lines; it also drops headings past `MAX_HEADINGS` from the extra lines.
- Edit as text only writes headings for the main deck, so a card on the maybeboard keeps its
  heading through a text save (`replacedEntries` keeps other boards' headings). Text with
  headings, saved to a deck without any, switches it to `custom`, as importing a list does.
- The builder has one server action for every heading change (`headingAction`, by `kind`). It
  doesn't revalidate the page (like quantity changes), so the Edit as text box can be stale
  after one; its fingerprint, which now reads headings, refuses a stale save.
- The LLM tool inputs clear a heading with `""`, not null: the registry's rule 9 keeps
  nullable types out of tool schemas. `arrange_headings` renames, merges, clears or orders.
- Checked in a browser at phone width in dark mode: pasting an Archidekt-style list into a new
  deck, ↑ ↓, Rename, the Heading field, By type and back, and the export.
