# Design: buy singles from a list, and one card search everywhere

- **Phase:** 15
- **Status:** **Built** (approved 2026-10-01 with the recommended answers in section 8; implementation notes in section 9)
- **Related:** design doc 07 (singles store), design doc 09 (deck lists), design doc 14 (search
  language), ADR 0006 (cross-module reads), ADR 0009 (lint boundaries), ADR 0016 (client API)

## 1. Purpose & scope

Two things, both requested 2026-10-01:

1. **Buy a list of singles at once.** Paste a list ("4 Lightning Bolt", "1 Sol Ring (C21) 263"),
   see what each line would buy and what it all costs, change anything that's wrong, then buy
   everything in one go. The obvious use is finishing a deck, so a deck can fill the list with
   the cards it's short.
2. **Scryfall syntax in every card search.** The deck builder's search language (design doc 14)
   becomes the search for the **singles store** and the **collection** too, and learns more of
   Scryfall's keywords for card features: keyword abilities, double-faced and other layouts,
   showcase/borderless/full-art treatments, artist, mana produced, price, release year, how many
   you own, exact names and regular expressions.

**Out of scope:** a shopping cart that persists between visits; buying sealed product from a
list; selling from a list (possible later, same screen backwards); search in the trade screens
(they pick from a short list of cards, not the catalog).

## 2. Ubiquitous language

| Term               | Meaning in this codebase                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shopping list**  | Text pasted by a player, one card per line, in the same format deck lists use.                                                                              |
| **Quote**          | What the list would buy now: each line matched to a printing and finish, with its unit price and total, or the reason it can't be bought. Nothing is saved. |
| **Purchase**       | Buying every line of a quote at once, in one transaction.                                                                                                   |
| **Card search**    | The Scryfall-style language (design doc 14), now shared by every card search box.                                                                           |
| **Search context** | What a search runs over: catalog printings (singles), your copies (collection), or your cards for a deck (deck builder).                                    |

## 3. Buying a list

### 3.1 The screen

Singles → **Buy a list** (`/singles/list`). Also reachable from a deck: **"Buy what this deck is
short"** opens it with the deck's missing cards already filled in (decision 3).

```
┌─ paste a list ───────────────────────┐  ┌─ quote ──────────────────────────────────────┐
│ 4 Lightning Bolt                      │  │ 4 × Lightning Bolt   [M11 #149 ▾] nonfoil $0.80│
│ 1 Sol Ring (C21) 263                  │  │ 1 × Sol Ring         C21 #263      nonfoil $1.20│
│ 2 The One Ring *F*                    │  │ 2 × The One Ring     [LTR #246 ▾] foil  $142.00│
│ 1 Teferi's Protection                 │  │ ⚠ Teferi's Protection: not in an enabled set   │
│                                       │  │ ⚠ "Bolt Thing": no card by that name           │
│ [x] Only buy what I don't already own │  │ Total $144.00 · balance after $56.00           │
│ Printing: (•) cheapest ( ) newest     │  │ [ Buy 7 cards for $144.00 ]                    │
└───────────────────────────────────────┘  └───────────────────────────────────────────────┘
```

- The **quote updates as you type** (after a pause), like the deck builder's search.
- Each line shows the printing it picked; a **printing menu** lists that card's other printings
  for sale, with their prices, to choose a specific one.
- Lines that can't be bought are listed with the reason and **left out of the total**, so the
  rest can still be bought. The button says exactly what will happen ("Buy 7 cards for $144.00").
- **Only buy what I don't already own** (decision 2): a line asking for 4 when you own 3 buys 1
  (copies of any printing count, as decks count them). Lines you already have enough of are
  shown as "you have 4" and cost nothing.

### 3.2 Reading the list

The deck importer's parser (`parseList`, design doc 09) reads the list, so everything a deck list
accepts works here: quantities (`4`, `4x`), set and collector number (`(M11) 149`), comments,
blank lines, and section headers (ignored: a sideboard is bought like the rest). It also learns
Moxfield's finish markers, for decks and lists alike: **`*F*`** foil and **`*E*`** etched.

### 3.3 Which printing

1. A set and number in the line pick that printing.
2. A set alone picks that set's cheapest printing of the card.
3. Otherwise the **cheapest** printing for sale (decision 1), or the **newest** if chosen.

"For sale" means what the singles store already sells: a printing in an enabled set with a
market price in the wanted finish (nonfoil unless marked). A foil asked for where no foil exists
is reported ("no foil printing for sale"), not silently swapped.

### 3.4 Rules (invariants)

1. **All or nothing:** a purchase buys every line of the quote or nothing.
2. **The price you saw or less:** the purchase re-prices every line on the server. If the total
   would be **higher** than the quote you confirmed (a price update in between), nothing is
   bought and the new quote is shown. A lower total goes through at the lower price.
3. **Money:** the purchase fails if your balance can't cover the total (as single purchases do),
   and nothing is bought.
4. **Books stay reconcilable:** each line is recorded exactly as a single purchase is today (one
   store transaction and one wallet entry, linked by reference), so the ledger checks from
   design doc 07 keep working.
5. **Limits:** at most 250 lines and 99 copies a line; quantities are positive whole numbers.
6. **Activity:** one feed entry for the whole purchase ("bought 37 singles for $144.00"), not
   one per line.

### 3.5 Code

- `parseList` and its finish markers move to a shared place both modules can use
  (`@/shared/card-list`, section 5).
- `store/queries`: **`quoteList(db, userId, lines, options)`** resolves and prices each line
  (read only).
- `store/application`: **`buySinglesList(actor, { lines: [{ printingId, finish, quantity }],
expectedTotal })`** runs one unit of work. It re-quotes, checks the total and the balance, then
  for each line does what `buySingle` does today (the shared part becomes one inner function, so
  the two can't drift). Errors: `ListEmpty`, `ListTooLong`, `QuantityInvalid`, `NotForSale`
  (with the line), `PricesChanged` (with the new total), `InsufficientFunds`.
- `decks/queries`: the deck's short cards as list text, for the deck's "Buy what this deck is
  short" link.

## 4. Card search everywhere

### 4.1 Where

| Search box        | Searches                 | Notes                                                                 |
| ----------------- | ------------------------ | --------------------------------------------------------------------- |
| **Singles store** | every printing for sale  | the name box becomes the search box; set, rarity and color menus stay |
| **Collection**    | your copies              | same; `is:foil` means a foil copy you own                             |
| **Deck builder**  | your cards, for one deck | already uses it; gains the new keywords                               |

The menus beside the box (set, rarity, color, finish, sort) stay as quick filters and combine with
the search. Under each box, a **"Search help"** link opens one page listing every keyword with
examples.

### 4.2 Keywords

Already there (design doc 14): name words, `o:`, `t:`, `c:`, `id:`, `mv`, `m:`, `pow`, `tou`,
`r:`, `s:`, `f:`, `is:foil`, `is:commander`, `-`, `or`, parentheses, quotes.

New:

| Write                                | Finds                                                                                         | Example                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------ |
| `!"name"` / `!name`                  | exactly that name                                                                             | `!"Lightning Bolt"`      |
| `kw:` / `keyword:`                   | a keyword ability                                                                             | `kw:flying kw:ward`      |
| `loy` / `def`                        | loyalty / defense, with comparisons                                                           | `loy>=4`                 |
| `a:` / `artist:`                     | artist name                                                                                   | `a:"rebecca guay"`       |
| `cn:` / `number:`                    | collector number (with comparisons on the number)                                             | `s:fdn cn<=100`          |
| `produces:`                          | mana a card can make                                                                          | `produces:g t:artifact`  |
| `usd` / `usd:`                       | market price in dollars (nonfoil, or foil with `is:foil`)                                     | `usd<0.50`               |
| `year` / `date`                      | the set's release year or date                                                                | `year>=2024`             |
| `border:`                            | border color: black, white, borderless, silver, gold                                          | `border:borderless`      |
| `frame:`                             | frame: 1993, 1997, 2003, 2015, future; or an effect: showcase, extendedart, inverted, etched… | `frame:showcase`         |
| `is:` layouts                        | `dfc` (any double-faced), `transform`, `mdfc`, `split`, `adventure`, `flip`, `meld`, `saga`…  | `is:mdfc`                |
| `is:` treatments                     | `showcase`, `borderless`, `extendedart`, `fullart`, `serialized`, `promo`, `etched`           | `is:borderless r:mythic` |
| `is:` card kinds                     | `permanent`, `spell`, `historic`, `legendary`, `vanilla` (no rules text), `bear` (2-mana 2/2) | `is:vanilla c:g`         |
| `own` / `owned`                      | how many copies you own (any printing)                                                        | `own=0`, `own>=4`        |
| `/regex/` in names, `o:`, `t:`, `a:` | a regular expression, as Scryfall allows (decision 4)                                         | `o:/draw (a              | two) cards?/` |

### 4.3 Code

- The parser (`decks/domain/search.ts`) and the SQL builder (`decks/queries/search-sql.ts`) move to
  a shared place, **`@/shared/card-search`** (pure parser; SQL builder over printings aliased
  `p`), because three modules now use them and modules' queries may not import each other
  (ADR 0009). The browser keeps importing the pure part for quick filters. **ADR 0017** records
  this ("shared libraries for languages used by several modules").
- A **search context** says what's available: the player (`own`, `is:foil` on owned copies), and
  the column holding the finish when searching copies.
- **Keyword abilities** need data we don't store yet: Scryfall's `keywords` list per card, added
  as a column like `produced_mana` (migration, filled by the next price sync).
- Regular expressions run in Postgres (`~*`), limited to 100 characters; an invalid one is noted
  ("not a valid pattern (ignored)") instead of failing the search.

## 5. Shared code

`src/shared/card-list` (list parsing, `*F*`/`*E*`) and `src/shared/card-search` (parser + SQL)
are new shared elements. Lint: modules' domain may import their pure parts; queries may import the
SQL builder; the browser may import the pure parts only (no `drizzle-orm` reaches a client file).

## 6. Persistence

- `printings.keywords text[] not null default '{}'` (migration 0018), from Scryfall's bulk file.
- No new tables: a purchase writes the existing store transactions, wallet entries,
  acquisitions and one activity event.

## 7. Test plan

- **Parser:** unit tests for every new keyword, `!` exact names, regex (valid, invalid, too long),
  notes for unknown values; the existing 13 search tests keep passing after the move.
- **SQL:** integration tests against the fixture catalog for each new keyword family, and for the
  three contexts (singles, collection, deck builder) giving the same answers to the same search.
- **List parsing:** `*F*`/`*E*` markers, in decks and lists.
- **Quote:** cheapest/newest/set/number picks; foil not available; not in an enabled set;
  "only what I don't own".
- **Purchase:** all or nothing (a bad line or too little money buys nothing), price rose →
  `PricesChanged`, price fell → cheaper, ledger and store records reconcile, one activity event.
- **Browser test:** paste a list, change a printing, buy, see the cards in the collection and the
  balance drop; search the singles store with `t:creature mv<=2`.
- Screenshots in dark mode and at phone width.

## 8. Decisions from review (2026-10-01)

All six recommendations were accepted: cheapest printing by default; "only buy what I don't
already own" on by default; a "Buy what this deck is short" link on each deck; regular
expressions allowed (up to 100 characters); the keyword list as proposed; the menus stay beside
the search box.

The questions as asked:

1. **Default printing** when a line doesn't name one: the **cheapest** for sale (recommended:
   it's a game economy), or the **newest**? Either way, both are offered on the screen.
2. **"Only buy what I don't already own"**: on by default (recommended: a list from a deck
   shouldn't buy cards you have), or off?
3. **"Buy what this deck is short"** link on each deck (recommended), or only paste?
4. **Regular expressions** in searches (recommended: Scryfall supports them, and Postgres runs
   them safely with the length limit), or leave them out?
5. **The keyword list** in 4.2: anything to add or drop? (Flavor text `ft:` and "is a reprint"
   are possible too, at the cost of storing more of Scryfall's data.)
6. **Menus on the singles and collection pages**: keep them beside the search box (recommended:
   quick to use without syntax), or replace them with search terms?

## 9. Implementation notes (what changed while building)

- **No activity entry for a list purchase.** The activity feed's rule (design doc 11) is that money
  amounts other than card prices stay private, and buying a single records nothing either. So a
  list purchase records nothing in the feed, rather than "bought 37 singles for $144.00".
- **`usd`** compares the **cheapest current price among the printing's finishes**, not "nonfoil, or
  foil with `is:foil`": simpler to explain, and `is:foil` already narrows the finish where it
  matters.
- **A foil-only card asked for without a marker** is reported ("no nonfoil printing for sale (sold
  as foil: mark it _F_)"), not bought as foil, matching rule 3.3.
- **Owned copies are used up line by line**, so a card listed twice isn't covered by the same
  copies twice.
- **Regular expressions** are checked in JavaScript and also refused when they use features
  Postgres doesn't have (named groups, `\p{…}`). An unclosed `/pattern` becomes plain text.
- **The purchase's shared core** (`buyCopies`) is used by both `buySingle` and `buyList`, so a list
  purchase is recorded exactly like single purchases (rule 4).
- **Fixtures:** the Scryfall fixture gained each card's real `keywords` and `produced_mana`, copied
  from that day's bulk file, for the `kw:` and `produces:` tests.
- `is:class` was added beside the proposed layouts; `is:etched` sits with the finishes.
