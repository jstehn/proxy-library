# Design: deck builder 2.0 and proxy PDFs

- **Phase:** 14
- **Status:** **Built** (approved 2026-09-30 with the decisions in section 8; implementation notes in section 10)
- **Related:** design doc 09 (decks), ADR 0007 (Scryfall data), lesson 09

## 1. Purpose & scope

Building a 60- or 100-card deck from memory of card names doesn't work. This phase makes the
deck builder a place to **browse your collection visually**, search it the way Scryfall does,
see only cards that fit (a Commander deck's colors), read any card at a glance, and watch the
deck's statistics change as you build. Deck lists look like Moxfield's: grouped, with mana costs,
and every name previews its card. Proxies print as **PDFs** with cutting guides and options.

**Out of scope:** suggestions ("cards like this"), price-based recommendations, automatic tags
like "ramp" or "removal" (possible later), sharing decks publicly.

## 2. The builder screen

A two-part screen on wide displays; on a phone, two tabs ("Collection" and "Deck") with the
selected card as a sheet that slides up.

```
┌────────────── your collection ───────────────┐┌──────── the deck ────────┐
│ [ search: t:creature mv<=3 o:"draw a card" ] ││ Silverquill Influence    │
│ [W][U][B][R][G][C]  [Creature][Instant]…     ││ Commander (1)    ┌──────┐│
│ ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐         ││  Killian ⓦⓑ     │ card ││
│ │card││card││card││card││card││card│  …      ││ Creatures (31)   │ you  ││
│ └────┘└────┘└────┘└────┘└────┘└────┘         ││  1 Sol Ring  ①  │hover ││
│ ┌────┐┌────┐ (scrolls; loads more as you go) ││  2 …             └──────┘│
├──────────────── selected card ───────────────┤│ Lands (37)               │
│ [ big card image ]  Killian, Decisive Mentor ││ ── stats ──              │
│  text, stats, owned 2 · in this deck 1       ││ curve ▁▃▆█▅▂ · lands 37  │
│  [−] 1 [+]   [Add to main] [Sideboard] [⭐]  ││ colors ⚪60% ⚫40% …      │
└──────────────────────────────────────────────┘└──────────────────────────┘
```

### 2.1 Browsing your collection

- **Card images in a grid**, not names, loading more as you scroll (60 at a time).
- **Only cards that can go in this deck** by default: owned cards, legal in the deck's format
  and, in **Commander**, within the commander's **color identity** (section 4). A switch, "Show
  everything I own", turns the filter off (cards that don't fit are then dimmed and marked).
- Each card shows **how many you own** and **how many are already in this deck**. Ownership is
  shared across decks (decided in phase 9), so it also says when other decks use it.
- **Sort** by name, mana value, color or newest. **Group** the grid by type, like the
  collection page can.

### 2.2 Selecting a card

**Clicking a card selects it:** it's highlighted in the grid and shown large in the
**selected-card panel**: the full card image, its text and stats (so long cards are readable),
how many you own and how many the deck has. There you choose a **quantity** (− / +, starting at

1. and **add it** to the main deck, the sideboard, or (Commander) as the commander. Keyboard: the
   arrow keys move the selection, **Enter** adds, **+**/**−** change the quantity, and **/** jumps
   to the search box.

### 2.3 Search (inspired by Scryfall's syntax)

One search box understands plain words and a set of Scryfall's keywords. Plain words search
card names. Everything combines with spaces (and), `or`, `-` (not), parentheses and quotes.

| Write            | Finds                                                   | Example                  |
| ---------------- | ------------------------------------------------------- | ------------------------ |
| words            | names containing them                                   | `bolt`                   |
| `o:` / `oracle:` | words or a "quoted phrase" in the rules text            | `o:"draw a card"`        |
| `t:` / `type:`   | type line                                               | `t:legendary t:creature` |
| `c:` / `color:`  | colors; with `=`, `<=`, `>=`, `<`, `>`                  | `c:rw`, `c<=bg`, `c:m`   |
| `id:` / `ci:`    | color identity (same comparisons)                       | `id<=esper`              |
| `mv` / `cmc`     | mana value: `=`, `<`, `<=`, `>`, `>=`                   | `mv<=2`                  |
| `m:` / `mana:`   | mana cost symbols                                       | `m:{G}{G}`               |
| `pow` / `tou`    | power / toughness, with comparisons                     | `pow>=4`                 |
| `r:` / `rarity:` | rarity                                                  | `r:mythic`               |
| `s:` / `set:`    | set code                                                | `s:sos`                  |
| `f:` / `format:` | legal in a format                                       | `f:pauper`               |
| `is:`            | `is:foil`, `is:commander` (could lead a Commander deck) | `is:commander c:w`       |

Color words work too: guild, shard and wedge names (`c:simic`, `id<=esper`), and `c:c`
(colorless) and `c:m` (multicolored). A search that has an unknown keyword or a typo still runs
the parts it understands, and says which part it ignored, like Scryfall.

**Quick filters** sit under the box for people who don't type syntax: color buttons, type
buttons and a mana value range. Pressing one edits the search text, so the box always shows the
whole search (and teaches the syntax).

### 2.4 The deck list (like Moxfield)

- The **commander** first, shown as its full card.
- Then **grouped by type** (Creatures, Planeswalkers, Instants, Sorceries, Artifacts,
  Enchantments, Battles, Lands), each with a count. Each line: quantity, name, **mana cost as
  symbols**, and − / + / remove controls.
- **Hovering a name previews the card** (on a phone, tapping a name shows it). Clicking a name
  selects it in the selected-card panel.
- A **view switch**: list (default) or **visual** (the cards as overlapping images per group).
- Problems (not owned, not legal, too many copies, outside the color identity) are marked on
  their line, as now.

### 2.5 Live statistics

Updated the moment a card is added or removed (computed in the browser from the deck in hand):

- **Card count** against the format's target (100 for Commander, 60 minimum otherwise).
- **Mana curve**: spells by mana value, stacked creatures / non-creatures.
- **Lands**: count and share of the deck (with the usual guide: about 36–38 in Commander, 24 in
  a 60-card deck), plus other mana sources (cards that produce mana: rocks, dorks).
- **Colors**: colored symbols in mana costs (what you need) next to the colors your lands and
  mana sources produce (what you have), as two bars per color.
- **Types**: counts per type.
- **Average mana value** (without lands).
- **Price**: the deck's total market value.

## 3. Proxy PDFs

The proxy sheet becomes a **PDF** made on the server, so it prints at exactly the right size in
any browser or print shop.

- Cards at **2.5 × 3.5 inches** (63.5 × 88.9 mm, the real card size), 3 × 3 on US Letter (or A4).
- **Cutting guides just outside each card**: a small gap between cards (default 2 mm) with crop
  marks at every corner, outside the card, so a cut along them leaves a clean card with no white
  border and no guide on it.
- **Options** (a short form before downloading):

| Option             | Choices                                                                                                                                 | Default                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Page size          | Letter, A4                                                                                                                              | Letter                        |
| Basic lands        | include, skip                                                                                                                           | skip                          |
| Double-faced cards | **back faces on their own pages** (only back faces, mirrored to line up with the fronts for two-sided printing or stickers), front only | back faces on their own pages |
| Which cards        | the whole deck, the main deck, cards not marked "have a real copy"                                                                      | the whole deck                |
| Gap between cards  | 0, 1, 2, 3 mm                                                                                                                           | 2 mm                          |
| Bleed              | none, 1/8 inch (3 mm) of image around each card                                                                                         | none                          |
| Cut guides         | corner marks, full lines, none                                                                                                          | corner marks                  |
| Copies             | as many as the deck has, or one of each                                                                                                 | as many as the deck           |

- Images are Scryfall's **large** size (672 × 936, about 270 dots per inch at card size), from our
  image cache (fetched once each, as now).
- Library: **pdf-lib** (pure JavaScript, MIT licence) to draw images and lines into a PDF.

## 4. Commander color identity

A card's **color identity** is every color in its mana cost and rules text (Scryfall's
`color_identity`, which we already store). In Commander, every card's identity must be within the
commander's (two partners: their identities combined). So a red-white commander allows red,
white, red-and-white and colorless cards. The rule is already checked when a deck is shown; this
phase uses it to **filter the browser** and to mark lines that break it. Cards with special rules
(e.g. "a deck can have any number of cards named …") still follow color identity; their copy
limits are already handled by the deck rules.

## 5. Data changes

- **`produced_mana`** from Scryfall's bulk file (already downloaded nightly) on each printing, for
  the mana-sources statistic. Migration adds the column; the price pass fills it.
- No other new tables. Search runs as SQL over `printings` joined with your collection.

## 6. Design (code)

- **Search language**: a pure parser in `decks/domain/search.ts`: text → a tree of conditions
  (`{ kind: "and" | "or" | "not" | "term" }`), with errors for the parts it couldn't read. A
  query builder in `decks/queries` turns the tree into SQL conditions with parameters (never
  string-built SQL). Fully unit-tested, including odd input.
- **Collection browser**: a query `ownedCardsForDeck(deck, search, sort, page)` returning cards
  with owned / in-this-deck / in-other-decks counts and whether each fits the deck.
- **Builder UI**: a client component that holds the deck in memory, so stats update instantly;
  each change is saved through the existing deck actions (which re-check ownership and rules).
- **Card preview**: the shared enlarged-card view (`card-preview.tsx`) for hovered names and the
  selected-card panel.
- **Stats**: extend `deckStats` (pure) with lands, mana sources, color requirements vs sources,
  price; unit-tested.
- **PDF**: `GET /decks/[id]/proxies.pdf?…options` builds the PDF from the deck's lines and cached
  large images; the layout (positions, guides) is a pure function, unit-tested.

## 7. Test plan

- Search parser and query builder: unit tests (every keyword, comparisons, color names,
  negation, `or`, parentheses, errors); integration tests against the fixture catalog.
- Color identity filter: integration test (a red-white commander sees only R/W/RW/colorless).
- Stats: unit tests with known decks.
- PDF layout: unit tests (positions within the page, guides outside cards, back faces on mirrored back pages,
  basics skipped); an integration test that the PDF downloads and has the right page count.
- Browser test: search, select, add with a quantity, the stats change, hover a name to preview.
- Screenshots in dark mode and at phone width.

## 8. Decisions from review (2026-09-30)

1. **Search keywords:** the set in section 2.3, as proposed.
2. **Color filter:** on by default **only for Commander decks** (the commander's color identity),
   and the player can **choose which colors to see** (toggle each color, and colorless) in any
   deck, Commander or not.
3. **More copies than you own:** allowed, and the line is marked (as now).
4. **Proxy PDFs:** the proposed defaults, except **double-faced cards**: their back faces go on
   **separate pages made only of back faces**, in mirrored positions, so a two-sided print (or a
   sticker on the back) lines each back up with its front. Side-by-side is not offered. **Bleed**
   is an option (an extra margin of image around each card, for professional cutting).
5. **pdf-lib** for making PDFs: approved.
6. Out-of-scope ideas (suggestions, price-based recommendations, automatic tags, public sharing)
   are listed in [future-ideas.md](../future-ideas.md).

## 9. Commander eligibility (fixed before this phase)

Precon decks showed the commander rule was too narrow: _Hearthhull, the Worldseed_ (World
Shaper) and _Inspirit, Flagship Vessel_ (Counter Intelligence) are legendary **Spacecraft**, not
creatures, yet lead their precons. Since Edge of Eternities (2025), a **legendary Vehicle or
Spacecraft with a printed power and toughness** can be a commander. `canBeCommander` now accepts
legendary creatures, those Vehicles and Spacecraft, and cards that say "can be your commander",
and a **Background** as a second commander beside one that says "Choose a Background".
`pnpm worker check-commanders` tests every precon's commanders in the catalog (all 60 pass); the
search keyword `is:commander` uses the same rule.

## 10. Implementation notes (what changed while building)

- **The browser filters by legality too:** "Show everything I own" turns off both the color and
  the format filter (cards that don't fit are dimmed and labelled "off-color" or "not legal").
  The quick color buttons are the identity filter itself, not search text, so the search box
  never fights them.
- **Grouping the grid by type** is a sort ("Type") that adds a heading where the type changes, in
  the deck list's order.
- **Identity counts the rules text**, as Scryfall's `color_identity` does: _Wick, the Whorled
  Mind_ costs {3}{B} but is Grixis. It's now in the test fixtures (real MTGJSON data), and an
  integration test pins that a blue-red deck can't browse it.
- **One deck line holds at most 99 copies** (as before); adding more says so ("the most one line
  can hold").
- **The builder keeps the deck in the browser** and saves each change through a server action that
  returns the fresh deck; problems update when that answer arrives. A pasted list or new settings
  start the builder afresh (keyed on the deck's contents).
- **Proxy layout:** nothing prints closer than 1/8 inch to the paper's edge. With bleed, 3 × 3
  doesn't fit on Letter or A4, so the sheet turns sideways when that fits more (Letter: 3 × 2).
  Guides are drawn first and the cards on top, so corner marks only show outside the cards.
- **Double-faced cards print last**, each page of fronts followed by a page of only their backs in
  mirrored columns. "Double-faced" means the printing has a back image (split and adventure
  cards have two faces but one image).
- **"Cards not marked 'have a real copy'"** wasn't built: nothing marks real copies yet. The
  options are the whole deck or the deck without its sideboard (future-ideas.md).
- **Browser tests never download images:** the setup puts a placeholder JPEG in the test image
  cache for every printing, so making a PDF there stays offline.
