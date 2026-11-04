# Design: standard art for cards you don't own, and choosing a card's printing

- **Phase:** 24
- **Status:** **Done** (2026-11-03). Approved the same day. Decisions: section 13, all as recommended, plus
  "Universes Within before Universes Beyond" (section 13, question 5).
- **Related:** design doc 23 (edit as text; section 14, your most special copy), design doc 14
  (deck builder 2.0, the selected-card panel), design doc 16 (real cards),
  `docs/future-ideas.md` ("Choose a card's variant in the builder", which this phase builds)

## 1. Purpose & scope

Two requests after phase 23 shipped:

1. **Standard art if I don't own it.** When a deck line has no printing chosen and you own no
   copy, the deck shows the **newest** printing. The newest one is often a showcase, borderless
   or promo version (Secret Lair, a collector-booster frame, a Commander set's extended art),
   so lists look random. It should show the card's **standard printing**: its ordinary frame,
   from a normal set.
2. **Change printings.** Pick which printing (and finish) a deck line uses, for owned and
   unowned cards alike. This builds the "Choose a card's variant" idea from future-ideas.

Out of scope: choosing **different printings for copies of one line** (for example 2 foil and
2 plain Sol Rings), since a line still has one printing; a maybeboard; bulk "re-pin every card"
actions.

## 2. Ubiquitous language

| Term                  | Meaning                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standard printing** | A card's most ordinary current printing, Universes Within before Universes Beyond: a normal frame (no borderless, full art, showcase or extended art), not a promo, from an expansion, core or Commander set, newest first. Falls back to newest. |
| **Pinned printing**   | The printing a deck line names (`deck_entries.printing_id`). Unpinned lines follow your copies (design doc 23).                                                                                                                                   |
| **Printing picker**   | The list of a card's printings in the selected-card panel, for choosing the pinned one.                                                                                                                                                           |

## 3. Domain model

No new domain types. A deck entry already has `printingId` and `finish`, both nullable, and
`setEntry` already writes them. Choosing a printing changes those two fields of an existing
line and leaves its quantity alone.

## 4. Invariants

1. **The order a deck line's printing is chosen in:** the pinned printing; else your most
   special copy (design doc 23); else the **standard printing**. This replaces "else the
   newest". It applies everywhere that order is used: pasting a list, Edit as text, the deck
   view, Export, Print proxies, and suggestions' "add this card" preview.
2. **The standard printing ranking** (one shared SQL fragment, `STANDARD_FIRST`, next to
   `MOST_SPECIAL_FIRST`): 0. **released already**: an upcoming set's preview cards only when there's nothing else
   (added after release, see section 14);
   1. **not Universes Beyond** (no `universesbeyond` promo type): Magic's own art first, so
      a reprint from a Fallout or Warhammer 40,000 deck, or a Universes Beyond card that also
      has a Universes Within version, shows the Magic version when there is one;
   2. **not Secret Lair** (a set whose name starts "Secret Lair": Drop, Countdown, Promo,
      Ultimate Edition, Showcase Planes, and any later ones);
   3. a modern frame (2003 or 2015), normal border (black or white) and not full art, with
      no showcase or extended art frame effect, and no promo types other than
      `universesbeyond`;
   4. set type expansion, then core, then Commander, then any other;
   5. newest set first; then the lowest collector number (the main-set number, not the
      variants that come after it); then printing id.

   A card printed only in Universes Beyond gets its most ordinary Universes Beyond printing.
   A card with only special printings still gets one (the best by that order). Rules facts
   (legalities, colour identity) keep coming from the newest printing, as now.

3. **Choosing a printing pins it**, with the finish chosen. The finish must be one the
   printing comes in, or the action is refused (`FinishNotAvailable`). The printing must be of
   the line's card (`PrintingNotOfCard`). The quantity doesn't change.
4. **"Follow my copies" unpins**: it sets printing and finish back to null, so the line goes
   back to rule 1's automatic choice.
5. **Ownership counts are per card, not per printing** (unchanged): pinning a printing you
   don't own doesn't make a card you own show as short. The picker shows which printings you
   own so you can choose one of yours.
6. **Your most special copy, amended** (design doc 23, section 14): the **most valuable copy
   you own comes first**, as before. At equal value (or with no prices), **Universes Within
   before Universes Beyond** comes next, then the existing steps (finish, frame, …), and
   `universesbeyond` no longer counts as a "special" promo type in the frame step. Secret Lair
   copies you own aren't ranked down: when you own one, its value decides.
7. **Owner only**, like every other deck change. It's refused while the deck is shown read-only.

## 5. Use cases

| Use case         | Actor      | Does                                                                                    | Errors                                                                     |
| ---------------- | ---------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `choosePrinting` | deck owner | sets one line's printing and finish, or unpins it (`printingId: null`). Saves the deck. | `DeckNotFound`, `EntryNotFound`, `PrintingNotOfCard`, `FinishNotAvailable` |

`choosePrinting({ deckId, oracleId, board, printingId: PrintingId | null, finish })`, in a
transaction with `lockOwned`, like `setEntry`. A new `cards.printingFacts(printingId)` port
call returns the printing's oracle id and finishes, so the checks happen in the use case.

## 6. Ports

- `DeckCards.printingFacts(printingId): Promise<{ oracleId; finishes: Finish[] } | null>`, in
  the decks module's `ports.ts`, implemented in `drizzle-repositories.ts`.

## 7. State machines

None.

## 8. Persistence

No migration. `deck_entries.printing_id` and `finish` already exist.

## 9. Read models (queries)

- **`cardPrintings(db, userId, deckId, oracleId)`** (decks queries): every printing of the
  card, for the picker: id, set code and name, collector number, release date, finishes, a
  short "what's special" label (borderless, showcase, extended art, full art, promo; from the
  same columns the rankings use), the latest price per finish, and how many copies you own per
  finish (game copies, plus real copies when the deck uses real cards). Sorted: printings you
  own first (by `MOST_SPECIAL_FIRST`), then the rest by `STANDARD_FIRST`. Loaded when the
  picker opens, not with the page.
- `deckView`, `resolve` and the suggestions preview: "newest" becomes `STANDARD_FIRST` as the
  last step (invariant 1).

**UI, in the builder's selected-card panel** (opened by clicking a deck line or a card):

```
┌ Selected: Sol Ring ───────────────────────────────┐
│ [image]  Printing: Commander 2021 #263 · etched   │
│          (pinned)            [Change printing ▾]  │
│ ...                                               │
│ ┌ Choose a printing ────────────────────────────┐ │
│ │ ○ Follow my copies (automatic)                │ │
│ │ You own                                       │ │
│ │ ● C21 #263 · Commander 2021   etched ×1  $4.10│ │
│ │ ○ SLD #1512 · Secret Lair     foil ×1   $12.00│ │
│ │ Other printings                               │ │
│ │ ○ CMM #400 · Commander Masters  [nonfoil|foil]│ │
│ │ ○ … (scrolls; a filter box when more than 20) │ │
│ └───────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

- Only shown when the card is in the deck (the panel knows its board). For a card on two
  boards, one picker per board line.
- Each printing has a small image (the `small` size, loaded lazily) and a finish choice for
  the finishes it comes in; choosing saves at once ("Saving…" while it does), and the panel
  and deck list update to the new image.
- Usable at phone width: the list is a scrolling column, each row a large tap target.
- Edit as text still writes pinned printings as `(SET) number`, so changing a printing there
  also works (phase 23).

## 10. Events emitted

None (deck changes emit none today).

## 11. Patterns applied

- **One shared ranking fragment** (`STANDARD_FIRST`), like `MOST_SPECIAL_FIRST`, so every
  place that falls back agrees.
- **Validation in the use case through a port** (`printingFacts`), not in SQL constraints, so
  errors are `Result`s the UI can show.

## 12. Test plan

- **Unit:** `choosePrinting` with fakes: pins; unpins; refuses a printing of another card, an
  unavailable finish, a line not in the deck, and someone else's deck; the quantity is
  unchanged.
- **Integration (Postgres):** a card whose newest printing is a showcase promo shows the
  standard printing when unowned (in `deckView`, `resolve` and the suggestions preview); a card
  with only special printings still shows one; owned copies still beat the standard printing;
  `cardPrintings` lists owned printings first, with counts per finish, and real copies only
  when the deck uses them.
- **E2E:** open a deck line, change its printing, see the new image in the deck list; choose
  "Follow my copies" and see it go back.
- Screenshots in dark mode and at phone width.

## 13. Open questions (recommendations in bold)

1. **Should a printing you pick by hand ever be replaced automatically?** For example, when you
   later open a foil of that card. **No: a pin stays until you change it or choose "Follow my
   copies".** That's what pinning means, and Edit as text already behaves this way.
2. **Where does the picker go?** **The selected-card panel** (above), where the card's other
   actions are. The alternative, a dropdown on each deck-list row, crowds the list at phone width.
3. **Standard printing: prefer the original set or the newest normal one?** **Newest normal
   one**, matching the current "newest" behaviour without the special frames. The original
   printing (for example Alpha's Sol Ring) often has old frames and poor scans.
4. **Lesson 24 concepts:** SQL `CASE` ranking reused as a fragment; controlled radio groups in
   React; optimistic UI versus waiting for the server (we wait, and say "Saving…"); validating
   through a port and returning `Result`.
5. **Universes Within or Universes Beyond?** (Asked on approval.) **Universes Within first**,
   wherever the card has a Magic-universe printing: rule 2, step 1, and rule 6. Scryfall marks
   every Universes Beyond printing with the promo type `universesbeyond`, which printings
   already store.
6. **Secret Lair?** (Asked during the build.) **Never the default art** for a card you don't
   own, unless it has no other printing (rule 2, step 2). Copies you own: value first (rule 6).

## 14. Implementation notes (what changed while building)

- **Old frames count as not ordinary** (rule 2, step 3: modern frame). With the Masters and
  Remastered sets enabled, many cards have both a 1990s printing from an expansion and a
  modern one; without this the old frame won on set type. Decision 3 ("not the original
  printing, it often has old frames") asked for this.
- **The commander can be selected.** Its picture in the deck list only showed its text, so it
  couldn't reach the panel the picker lives in. It now has a **Select** button next to its
  quantity buttons.
- **The picker sits under the selected-card panel**, in the same sticky sheet, and appears only
  when the card is in the deck. It loads the printings the first time it opens.
- **Pasted lists already pin a printing**, so a pasted card's picker starts on that printing,
  not on "Follow my copies".
- `cardPrintings` returns nothing for someone else's deck, so the action needs no separate
  ownership check.
- **Upcoming sets rank last** (rule 2, step 0; found on the live catalog after deploying).
  Forest's standard printing came out as a preview from Marvel: Darkhold Destiny, released
  2027-04-09, because "newest first" saw it as the newest. Preview cards from an unreleased set
  are nobody's standard art. That set's printings also aren't tagged `universesbeyond` yet;
  MTGJSON adds that later, and the nightly sync re-imports recent sets.
- **Paste a list, Deck settings and Comments moved above the builder** (found in use). They
  were below the collection grid, which loads more as you scroll, so they couldn't be reached
  (and pasting is how you add a card you don't own). They're now boxes you open, in a row under
  Edit as text: Paste a list starts open on an empty deck, Comments when the deck has any. A
  shared deck seen by someone else keeps its comments at the bottom (no grid there).
