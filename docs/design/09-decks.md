# Design: Deck builder

- **Phase:** 9
- **Status:** **Approved** (self-approved during the unattended run, 2026-09-27; see
  [decisions-to-review.md](../decisions-to-review.md))
- **Related ADRs:** 0011 (ownership by oracle card; decks pin a preferred printing)

## 1. Purpose & scope

This is where the project's point comes together: **build decks only from cards you own**, then
take them to the table as proxies. A player creates decks, adds cards from their collection (or
pastes a list), and sees at a glance what they're **short of** and whether the deck is **legal**
in its format. They then export the list or print a **proxy sheet**.

Decided before the run: ownership is **shared**. Every deck may use every copy you own (like
moving cards between real decks), and the builder shows which other decks use a card.

**Out of scope:** playing games, deck statistics beyond counts and curve, sharing decks with other
players (future-ideas).

## 2. Vocabulary

| Term            | Meaning                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Oracle card** | A card regardless of printing (Scryfall's `oracle_id`): every Lightning Bolt printing is one oracle card.                   |
| **Entry**       | A line in a deck: an oracle card, a board (main, side, commander), a quantity, and optionally a pinned printing and finish. |
| **Owned**       | Copies of that oracle card in your collection, in any printing and finish.                                                  |
| **Short**       | How many more copies a deck needs than you own.                                                                             |
| **Format**      | `casual` (no rules), `standard`, `pioneer`, `modern`, `legacy`, `vintage`, `pauper`, or `commander`.                        |

## 3. Domain model

```ts
type Board = "main" | "side" | "commander";
type Format =
  "casual" | "standard" | "pioneer" | "modern" | "legacy" | "vintage" | "pauper" | "commander";
type DeckEntry = {
  oracleId;
  board;
  quantity;
  printingId: PrintingId | null;
  finish: Finish | null;
};
type Deck = { id: DeckId; ownerId; name; format; entries: DeckEntry[] };

/** What the rules need to know about each oracle card. */
type CardRules = {
  name;
  typeLine;
  colorIdentity;
  legalities: Record<string, string>;
  isBasicLand;
  anyNumberAllowed;
};

type DeckProblem =
  | { kind: "Short"; oracleId; name; needed; owned }
  | { kind: "TooFewCards"; minimum; count }
  | { kind: "TooManyCards"; maximum; count }
  | { kind: "SideboardTooBig"; maximum; count }
  | { kind: "TooManyCopies"; name; maximum; count }
  | { kind: "NotLegal"; name; status } // banned / not_legal in this format
  | { kind: "CommanderMissing" }
  | { kind: "CommanderInvalid"; name }
  | { kind: "OutsideColorIdentity"; name };

function deckProblems(
  deck,
  rules: (oracleId) => CardRules,
  owned: (oracleId) => number,
): DeckProblem[];
```

## 4. Rules

1. **Ownership (all formats):** for each oracle card, the copies across all boards must not exceed
   the copies you own, in any printing and finish. **Basic lands are exempt**: every playgroup has
   a box of them.
2. **Constructed** (standard, pioneer, modern, legacy, vintage, pauper): main deck ≥ 60 cards,
   sideboard ≤ 15, at most 4 copies of each card (main + side) except basic lands and cards that
   say "a deck can have any number of cards named…". Every card must be `legal` (or `restricted`,
   max 1 copy, in vintage).
3. **Commander:** exactly 100 cards including 1–2 commanders. One copy of each card except basic
   lands and "any number" cards. Each commander must be a legendary creature (or say "can be your
   commander"). Every card's color identity must fit inside the commanders' combined identity, and
   every card must be legal in commander.
4. **Casual:** only rule 1.
5. Problems are **reported, never enforced**: you can save a deck that's short or illegal. The
   builder shows what's wrong, the way a real deck on your table can be half-built.
6. **Entries:** quantity 1–99 (0 removes). A deck name is 1–60 characters, and a player may have
   up to 100 decks.
7. **Only the owner** can see or change a deck.
8. The **pinned printing** (the version you want on the proxy sheet and in exports) is set when a
   card is added from the collection. When it comes from a pasted list, it's a printing you own,
   if any, otherwise the newest printing in the catalog.

## 5. Use cases

| Use case     | Input                                        | Errors (`kind`)                                                   |
| ------------ | -------------------------------------------- | ----------------------------------------------------------------- |
| `createDeck` | name, format                                 | `NameInvalid`, `TooManyDecks`                                     |
| `updateDeck` | deckId, name?, format?                       | `DeckNotFound`, `NameInvalid`                                     |
| `deleteDeck` | deckId                                       | `DeckNotFound`                                                    |
| `setEntry`   | deckId, oracleId, board, quantity, printing? | `DeckNotFound`, `QuantityInvalid`, `CardNotFound`                 |
| `importList` | deckId, text                                 | `DeckNotFound`; lines it can't match are **returned**, not failed |

## 6. Ports

```ts
interface DeckRepository { create; get(id); lockForOwner(id, ownerId); save(deck); delete(id); countFor(ownerId) }
interface CardLookup { byName(names): Map<lowercased name, { oracleId, printingId }>; exists(oracleId) }
```

Rules facts and ownership are **read models** (queries), not ports, because they're only needed
to show the builder.

## 7. Persistence

- `decks(id bigserial, owner_id, name, format, created_at, updated_at)`.
- `deck_entries(deck_id, oracle_id, board, quantity 1–99, printing_id null, finish null)`, primary
  key `(deck_id, oracle_id, board)`.

## 8. Read models

- `decksFor(userId)`: each deck with its card count and the number of cards it's short (for the
  list's badges, which show when a sale or trade leaves a deck short).
- `deckView(userId, deckId)`: entries with names, pinned printings, mana value, type, owned
  count, the other decks using each card, and the `CardRules` for the problem check.
- `collectionSearch(userId, name)`: your owned cards by name, for the "add" search.

## 9. Screens

| Route                | Purpose                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/decks`             | your decks, with format, size and a "short N" badge; create a deck                                                                                                   |
| `/decks/[id]`        | the builder: search your collection and add; entries by board and type, with +/−, owned, short and "also in"; problems; paste a list; rename, format, delete; export |
| `/decks/[id]/export` | the list as text: "4 Lightning Bolt (M11) 149" (with printings), or names only                                                                                       |
| `/decks/[id]/print`  | proxy sheet: 3 × 3 cards per page at real card size (63 × 88 mm), print styles                                                                                       |

## 10. Patterns applied

- **Functional core:** `deckProblems` is pure, with one table of format rules, and every rule is
  unit-tested.
- **Strategy:** exporters are functions of one shape (`(deck, cards) → string`), chosen from a
  table.
- **Parse, don't validate:** the pasted-list parser turns text into typed lines, or reports the
  lines it couldn't read.

## 11. Test plan

- **Domain:** each rule in section 4 with small decks; the list parser (quantities, "4x", set
  codes in parentheses, sideboard markers, blank lines, garbage); exporters.
- **Use cases (fakes):** ownership of decks, limits, import reporting unmatched lines.
- **Integration:** repository round-trip; `decksFor` short counts after selling a card
  (`tests/integration`).
- **End-to-end:** create a Commander deck, add a card from the collection, see "short" problems,
  and open the export.

## 12. Decisions made without review

1. **Basic lands never count as short.**
2. **Problems are shown, not enforced** (rule 5).
3. **Formats offered:** casual, standard, pioneer, modern, legacy, vintage, pauper, commander.
   Others (brawl, oathbreaker…) can be added to the rules table later.
4. **Only cards in the catalog** (enabled and supporting sets) can go in a deck. A pasted list
   reports anything else as "not found".
5. **Partner and "background" pairs** are simplified: up to 2 commanders are allowed, with no check
   that the pair is allowed together.

## 13. Implementation notes (what changed while building)

- **The "short" count is worked out twice:** in SQL for the deck list (`decksFor`, one query for
  every deck) and by the pure `deckProblems` in the builder. The integration test checks both on
  the same data (a deck's "short" moves as copies are bought and sold, and the builder reports no
  problems when everything is owned), so they can't drift apart unnoticed.
- **The builder's rules facts come from each card's newest printing** that has legalities.
  Legality belongs to the oracle card, so any printing would do, but the newest is the most likely
  to be up to date.
- **`importList` uses a plain `for … of` loop**, not `forEach`: TypeScript's narrowing of `deck`
  (not null) doesn't carry into a callback, and a loop reads more simply anyway.
- **Deleting a deck asks twice** (a `<details>` with a confirm button), with no JavaScript needed.
