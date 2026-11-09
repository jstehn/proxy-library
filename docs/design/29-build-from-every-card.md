# Design: Build a deck from every card

- **Phase:** 29
- **Status:** **Approved** (2026-11-08)
- **Related:** design doc 14 (deck builder, section 2.1), design doc 15 (buy a list), design doc
  23 (most special copy), design doc 24 (standard art), design doc 28 (search_for_deck's store
  pool). No new ADR.

## 1. Purpose & scope

The builder's grid only searches the cards you own. This phase adds a switch so the grid can
search **every card in the catalog**: you build the deck you want, then use the existing **Buy
what it's short** link to buy the cards you're missing.

Decks already accept cards you don't own. `setEntry` only checks that the card exists, and the
deck list already marks a line "short" when you don't own enough copies (design doc 09). So
this phase is a new **read model** and a **UI switch**. Nothing changes in the domain, the use
cases or the tables.

**Out of scope:** buying from inside the builder (Buy a list already does this, with prices
checked again and an optimistic-concurrency quote, design doc 15). Changes to the suggestions
panel (design doc 20) and to search_for_deck (design doc 28, which already has `where: "store"`).

## 2. Ubiquitous language

| Term               | Meaning in this codebase                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**         | What the builder's grid searches: `"mine"` (the cards you own, as now) or `"all"` (every card for sale).                               |
| **For sale**       | As in the singles store and Buy a list: a printing in an **enabled** set (design doc 15, section 3.3).                                 |
| **Shown printing** | The single printing a grid tile shows for a card. It's your most special copy if you own one, and otherwise the standard art (rule 3). |

## 3. Domain model

No new domain types. The query input gains one field, and `BrowseCard` already carries what the
tile needs (`owned` can now be 0).

```ts
export const BROWSE_SOURCES = ["mine", "all"] as const;
export type BrowseSource = (typeof BROWSE_SOURCES)[number];

export type BrowseInput = Readonly<{
  deckId: number;
  source: BrowseSource; // new
  search: string;
  colors: readonly Color[] | null;
  includeColorless: boolean;
  onlyLegal: boolean;
  sort: BrowseSort;
  page: number;
}>;
```

## 4. Invariants

1. With `source: "mine"`, results are exactly what they are today. The existing browse tests
   pass unchanged.
2. With `source: "all"`, each card (oracle id) that has at least one printing for sale and
   matches the search, colors and legality filter appears **once**. The cards you own are
   included, with their real `owned` count.
3. The shown printing for a card you **own** is your most special copy (`MOST_SPECIAL_FIRST`),
   as now. For a card you **don't own** it's the standard art (`STANDARD_FIRST`, design doc
   24): released, Universes Within before Universes Beyond, not Secret Lair, an ordinary frame,
   an expansion before other set types, then the **newest** set. It's chosen **among the
   printings that match the search**, so `s:mh3 bolt` shows the MH3 printing, not another
   set's.
4. A card you don't own is shown nonfoil when that printing has a nonfoil finish (the finish
   Buy a list buys by default), and its price is that printing's latest price for that finish.
5. Printing-level search terms (`s:`, `r:`, `is:foil`) match a card if **any** of its printings
   for sale matches them, the same rule the singles store uses.
6. `own=0` together with "All cards" finds only the cards you're missing. This works because of
   the existing `own` keyword, so no new syntax is needed.
7. The source never changes what a deck accepts or how it's checked. Adding an unowned card
   saves the same entry as adding an owned one, and the deck shows it as short.

## 5. Use cases

None new. Adding cards goes through the existing `setEntry` action.

| Use case                       | Actor / authz    | Input            | Output               | Errors               | Transaction? |
| ------------------------------ | ---------------- | ---------------- | -------------------- | -------------------- | ------------ |
| `browseCollection` (query)     | deck owner       | `BrowseInput`    | `BrowsePage \| null` | null = not your deck | no           |
| `browseAction` (server action) | signed-in, owner | + `source` (Zod) | `BrowsePage`         | as now               | no           |

## 6. Ports

None. This is a query (CQRS-lite), like the current browse.

## 7. State machines

None.

## 8. Persistence

No new tables or indexes. Measured on the real catalog (58,621 printings for sale, 30,062
cards), page 1 unless noted, each query run twice and the second timed:

| Search                    | Casual | Commander |
| ------------------------- | ------ | --------- |
| empty, by name            | 193 ms | 242 ms    |
| empty, by name, page 200  | 247 ms | 300 ms    |
| empty, by type            | 261 ms | 306 ms    |
| `t:creature mv<=3`        | 141 ms | 88 ms     |
| `bolt`                    | 107 ms | 131 ms    |
| `o:"draw a card"`, page 3 | 465 ms | 532 ms    |

The first draft grouped with `group by` and then looked up a printing per card to sort by (435
ms for an empty Commander search). `distinct on` removed those 29,404 lookups. The 150 ms target
holds for typical searches but not for an empty one, which reads every printing (about 120 ms
for the scan alone). No index helps when every row matches.

`o:` searches are the slowest, and that cost is not new: 470 of the 530 ms is the search
language's rules-text match (a regular expression over every face of every printing), which
the singles store pays too. A stored, indexed rules-text column would fix it for every page, as
its own change to `@/shared/card-search`.

## 9. Read models (queries)

`browseCollection` splits into two "candidate" common table expressions (CTEs) that feed the
**same** select, sort and mapping:

- `mine` is today's `owned` CTE, unchanged.
- `all` works in three steps, so the expensive per-card work only runs for the 60 cards on the
  page:
  1. **match:** printings for sale that satisfy the search, colors and legality, one row per
     `oracle_id` (`distinct on`, keeping the newest printing). The row keeps the card-level sort
     keys (name, mana value, type, color identity, and the newest set's release date for
     "newest").
  2. **page:** order those groups, then `limit 60 offset …`, plus `count(*) over ()` for the
     total.
  3. **shown printing:** a `join lateral` for each card on the page. If you own the card, it
     picks your most special copy. If not, it picks the first matching printing by
     `STANDARD_FIRST`. Then the existing columns (in this deck, other decks, rules, price).

The builder screen:

```
[ search: t:creature mv<=3 ……………………… ]
Search: (•) My cards  ( ) All cards        ← new, next to the color buttons
[W][U][B][R][G][C]  [ ] Show cards that don't fit
┌────┐┌────┐┌────┐
│card││card││card│   unowned tiles: "Not owned · $0.25" chip instead of "own 2"
└────┘└────┘└────┘
```

- **Switch:** "My cards" / "All cards", a two-button segmented control like the card-size
  control. It **always starts on "My cards"** when the builder opens, and isn't remembered
  (decision 1).
- **Tiles:** a card you don't own shows a "Not owned" chip and its price where the owned count
  normally goes. The tile isn't dimmed, because dimming already means "doesn't fit this deck".
- **Selected-card panel:** "You don't own this card · $X each" (the shown printing's price,
  decision 2), plus a note under the add
  buttons: "It'll show as short. Buy what it's short when you're done." The note links to
  `/singles/list?deck=<id>`.
- **Labels:** "Show everything I own" becomes "Show cards that don't fit" in both sources,
  because it was always a fit filter. The empty state reads "No cards match" in All cards.
- **Deck header:** no change. The existing "Buy what it's short" link is the way out.

## 10. Events emitted

None.

## 11. Patterns applied

- **CQRS-lite query** with one shape for two sources. It's one function with a `source` switch
  that only swaps the candidate CTE, so sorting, mapping and paging can't drift apart.
- **Paginate before per-row work** (top-N per group): group and limit first, then
  `join lateral` for one printing each. This is the main concept for the lesson.
- **One ranking fragment reused** (`MOST_SPECIAL_FIRST`, `STANDARD_FIRST`, design doc 24), so
  the grid shows the same art the deck will show once the card is added.

## 12. Test plan

- **Domain:** none (no domain change). The `derive.test.ts` case for a provisional line from an
  unowned card (`owned: 0`) shows as short in `problemsOf`.
- **Integration (`browse.int.test.ts`, real Postgres, fixture catalog):**
  - rule 1: `"mine"` returns only owned cards (the existing tests, now passing `source`);
  - rule 2: `"all"` includes an unowned card once even with three printings, and includes an
    owned card with its count;
  - rule 2: a card whose only printing is in a disabled set is left out;
  - rule 3: an unowned card shows its standard printing, and with `s:<set>` shows that set's;
    an owned card shows your most special copy;
  - rule 4: nonfoil price for an unowned card;
  - rule 6: `own=0` in "all" returns only unowned cards;
  - paging: total and page 2 are consistent (no card on two pages).
- **E2E (Playwright):** switch to All cards, search a card the player doesn't own, add it, see
  it marked short, follow "Buy what it's short" and see it on the list.
- **Manual:** screenshots in dark mode and at phone width, and a check against real data: a
  card with dozens of printings (Lightning Bolt, Sol Ring) and a double-faced card.

## 13. Decisions (from review)

1. **Default source:** the grid always starts on "My cards" (your collection), and you switch to
   "All cards" when you want it. The choice isn't remembered.
2. **Price on unowned cards:** the shown printing's price, on the tile and in the selected-card
   panel. No separate "cheapest" price.
3. **Shown printing:** the standard-first ranking from design doc 24 (`STANDARD_FIRST`), which
   prefers the newest Universes Within printing of an ordinary frame.
4. **Pinning:** adding from the grid pins the shown printing, as it does now. Buy a list still
   offers the cheapest printing unless you pick another there.
