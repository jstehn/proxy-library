# Design: token proxies

- **Phase:** 25
- **Status:** **Built** (2026-11-04). Approved the same day, all decisions as recommended
  (section 13); implementation notes in section 14
- **Related:** design doc 14 (proxy sheets), design doc 22 (playtest style), design doc 24
  (choosing a printing; the picker this reuses), ADR 0007 (external data)

## 1. Purpose & scope

Your request: the proxy PDF should also print **2 copies of each token the deck's cards make**,
let you **choose each token's art**, and print the tokens **in the same style** as the cards
(scan, or playtest with the same art filter and stripes).

The catalog has no tokens today. Token sets are listed but hold no cards, and nothing links a
card to the tokens it makes. Scryfall's bulk file, which the sync already downloads, has both:

- about **3,400 paper token printings** (1,122 distinct tokens; a Goblin or Treasure has dozens of
  arts, Treasure up to 97), with images and art crops;
- each card's **`all_parts`** list, in which `component: "token"` entries name the tokens that card
  makes. Krenko, Mob Boss lists one Goblin printing. Emblems and helper cards (The Monarch, The
  Ring, the Initiative's Undercity) are listed the same way.

**Out of scope:** tokens anywhere other than the print page (search, store, collection, the deck
page). Also counters, dice, copies of other cards ("create a token that's a copy of…"; Scryfall
doesn't list those) and meld results.

## 2. Ubiquitous language

| Term           | Meaning in this codebase                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Token          | One distinct token (Scryfall oracle id), e.g. "1/1 red Goblin". Emblems and helper cards count as tokens here.  |
| Token printing | One printing of a token (its own art, set, number), Scryfall id as its id.                                      |
| Token link     | "This printing makes that token printing", from `all_parts`. Kept per printing; read per card across printings. |
| Deck's tokens  | The tokens made by the cards the sheet prints from (same board filter as the cards).                            |
| Token art      | The token printing chosen to print for a token in this deck.                                                    |

## 3. Domain model

```ts
// catalog: what the sync stores
type TokenPrinting = Readonly<{
  id: string; // Scryfall id
  oracleId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  layout: "token" | "double_faced_token" | "emblem" | string;
  colors: readonly string[];
  faces: readonly PrintedFace[]; // the same shape playtest cards use
  artist: string | null;
  images: ImageUris | null;
  releasedAt: string; // for "newest first" in the art picker
}>;

// decks: what the print page works with
type TokenLine = Readonly<{
  oracleId: string;
  name: string; // "Goblin"
  description: string; // "Token Creature — Goblin · 1/1 red"
  madeBy: readonly string[]; // ["Krenko, Mob Boss", "Goblin Instigator"]
  boards: readonly Board[]; // boards of the cards that make it, for the sideboard filter
  art: TokenPrinting; // the chosen art, or the default (section 3.2)
  included: boolean; // you can leave a token out
}>;

type ProxyOptions = Readonly<{
  // ...the existing options...
  /** Copies of each of the deck's tokens, after the cards. 0 prints none. */
  tokenCopies: 0 | 1 | 2 | 3 | 4; // default 2 (decision 1)
}>;
```

### 3.1 Which tokens

A token is in the deck's tokens if any printing of a card the sheet prints from links to any
printing of it. Two details:

- **Board filter:** "No sideboard" also leaves out tokens only sideboard cards make.
- **Real cards:** "Leave out real cards" does **not** drop tokens. You still need the Goblins
  when Krenko is a real card.
- Basic lands make no tokens, so their option doesn't matter here.

### 3.2 Default art

1. The token printing **your card's printing links to** (usually the same set's token, so Krenko
   from M13 gets the M13 Goblin). When several of the deck's cards link to different printings of
   one token, the first in deck order wins.
2. Otherwise, the newest printing.

### 3.3 Printing them

- Tokens come **after the deck's cards** on the same pages, `tokenCopies` of each, in name
  order (decision 4).
- **Scan style:** the token's Scryfall image, with bleed and guides as for cards.
- **Playtest style:** drawn by the same code as cards, with the same art filter and stripes.
  Stripe colours are the token's colours (grey for Treasure, Clues and emblems). A token has no
  mana cost, so the title bar holds just the name.
- **Taller art for tokens.** Most tokens have little or no text, and a real token's art fills most
  of the card. On a playtest token the art box **grows into unused text space** (keeping at least
  one line of text box if there is text). Deck cards keep today's layout.
- **Double-faced tokens** print their back on the mirrored back pages, like double-faced cards,
  and follow the "Back faces" option.
- Tokens are never foil, so they print with the non-foil pages when foils have their own.

## 4. Invariants

1. With `tokenCopies: 0`, the sheet prints exactly the cards it prints today.
2. Every token printed is one the deck's printed cards make (section 3.1); every token the deck's
   cards make is listed on the print page, printed unless left out.
3. A chosen token art is always a printing of that token. A choice that no longer fits (the card
   left the deck, or the token disappeared from the catalog) is ignored, not an error.
4. A missing token image never stops the sheet: it prints as a labelled box, like a card would.

## 5. Use cases

| Use case           | Actor / authz      | Input                                 | Output                  | Errors (`kind`)                  | Transaction? |
| ------------------ | ------------------ | ------------------------------------- | ----------------------- | -------------------------------- | ------------ |
| Download proxy PDF | deck owner, as now | deck id, options (now `tokenCopies`)  | PDF (cards then tokens) | 404 as now                       | no           |
| Choose token art   | deck owner         | deck id, token oracle id, printing id | —                       | `DeckNotFound`, `NotThatToken`   | yes          |
| Leave a token out  | deck owner         | deck id, token oracle id, included    | —                       | `DeckNotFound`, `TokenNotInDeck` | yes          |

**The print page** gains a **Tokens** section below the options:

```
Tokens                                         Copies of each: [0] [1] [2●] [3] [4]
┌──────────────────────────────────────────────────────────────────────────────┐
│ [✓] [thumb] Goblin            Token Creature — Goblin · 1/1     [Change art] │
│             Made by Krenko, Mob Boss, Goblin Instigator                      │
│ [✓] [thumb] Treasure          Token Artifact — Treasure         [Change art] │
│             Made by Smothering Tithe                                         │
│ [ ] [thumb] The Monarch       Card                              [Change art] │
│             Made by Palace Jailer                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Change art** opens a picker like the deck builder's printing picker (design doc 24): a grid of
the token's printings, newest first, set name and number under each, with a filter box when there
are more than 20 (Treasure). Choosing one saves it straight away. "No tokens" shows when none of
the deck's cards make any.

## 6. Ports

- **Catalog query** (`@/modules/catalog`): `tokensMadeBy(db, printingIds)` → per token, the linked
  token printings and which printings link to them; `tokenPrintings(db, oracleId)` → all printings
  of a token, for the picker.
- **Images:** token images go through the same disk cache and `/api/images/[id]/…` route.
  `imageSource` looks in `token_printings` when the id isn't a card printing (Scryfall and MTGJSON
  ids never collide). The proxy renderer's `ProxyImages` port is unchanged.
- **Scryfall schema** (Zod) gains `oracle_id`, `name`, `layout`, `released_at`, `collector_number`,
  `colors`, `oracle_text`, `power`, `toughness`, `artist`, per-face text, and
  `all_parts: [{ id, component }]`.

## 7. State machines

None.

## 8. Persistence

Migration `0027_tokens.sql`:

```sql
-- catalog: every paper token printing (English), replaced on each sync's bulk-file pass.
create table token_printings (
  id text primary key,              -- Scryfall id
  oracle_id text not null,
  name text not null,
  set_code text not null,
  collector_number text not null,
  layout text not null,
  colors text[] not null,
  faces jsonb not null,
  artist text,
  image_uris jsonb,
  released_at date not null
);
create index on token_printings (oracle_id);

-- catalog: from all_parts; a link to a token printing we don't store (digital only) is skipped.
create table printing_tokens (
  printing_id text not null references printings (id) on delete cascade,
  token_id text not null references token_printings (id) on delete cascade,
  primary key (printing_id, token_id)
);

-- decks: your art choice and whether a token is left out, per deck.
create table deck_token_choices (
  deck_id integer not null references decks (id) on delete cascade,
  token_oracle_id text not null,
  token_id text references token_printings (id) on delete set null, -- null: the default art
  included boolean not null default true,
  primary key (deck_id, token_oracle_id)
);
```

**Sync:** the existing pass over the bulk file also collects token printings (`games` includes
paper, English, layout `token`, `double_faced_token` or `emblem`, or a token set) and the token
links of the printings it already matches. Both tables are rewritten together in one transaction,
so a sync never leaves links to missing tokens. The first `pnpm worker sync prices` after
deploying fills them; no MTGJSON change.

## 9. Read models (queries)

- `deckTokens(db, userId, deckId)` (decks): the deck's `TokenLine`s, joining the deck's lines,
  `printing_tokens` (all printings of each card, by oracle id), `token_printings` and the deck's
  choices. Default art per section 3.2.
- The PDF route reads them with the proxy lines; the pure `tokensToPrint(tokenLines, options)`
  returns `ProxyCard`s that `proxyPages` places after `cardsToPrint`'s.

## 10. Events emitted

None.

## 11. Patterns applied

- **Functional core:** which tokens, the default art, copies and order are pure functions in
  `decks/domain/token-proxies.ts`; the taller-art layout is a flag on the pure playtest layout.
- **Anti-corruption layer:** Scryfall's token fields enter through the Zod schema and a pure mapper,
  like every other card field.
- **Module boundaries:** the catalog owns token data; decks owns your choices and reads the catalog
  through its public queries.

## 12. Test plan

- **Fixtures:** add real lines from the cached bulk file (no network): Krenko (M13) and its Goblin,
  three other Goblin printings, Smothering Tithe and Treasure, Palace Jailer and The Monarch, a
  double-faced token (Incubator // Phyrexian), an emblem (a planeswalker's), and a card linking to
  a digital-only token.
- **Domain:** which tokens (board filter, real cards don't drop them, two cards making one token
  list it once with both names), default art (linked printing, first in deck order, newest
  fallback), copies 0–4, left-out tokens, name order.
- **Mapper:** token printings and links parsed from fixtures; digital tokens and unknown links
  skipped.
- **Playtest layout:** a token with no text gets the full art height; one with text keeps its text
  box; deck cards unchanged.
- **Integration:** sync stores tokens and links from the fixture and rewrites them on a second
  sync; choosing art for a token not in the deck is `NotThatToken`; a removed card's choice is
  ignored; the PDF with `tokenCopies=2` has the extra cards, and with `0` matches today's.
- **Browser:** the Tokens section, change art, leave one out, download in scan and playtest
  (edges) style. Screenshots in dark mode and at phone width.
- **Real data:** a Krenko / Goblins deck, a Treasure deck (97 arts in the picker), a deck with
  emblems and The Monarch, and a commander precon; PDFs looked at page by page.

## 13. Decisions (2026-11-04)

1. **Default copies:** **2**, with 0–4 offered.
2. **Art choices:** **saved per deck** (`deck_token_choices`).
3. **Which tokens:** **everything Scryfall lists**, emblems and helper cards included, each with a
   checkbox to leave it out.
4. **Placement:** tokens **follow the cards on the same pages**.
5. **Taller art on playtest tokens** (section 3.3): **yes**.

## 14. Implementation notes (2026-11-04)

- **Emblems and helper cards are "combo pieces".** Real data showed Scryfall lists tokens as
  `component: "token"` but emblems and The Monarch as `"combo_piece"`, next to ordinary related
  cards (partners, the card itself). The mapper reads both; the sync keeps only links to stored
  token printings, so ordinary cards drop out. Scryfall's **Copy** helper card (for "create a
  token that's a copy of…") is listed too; untick it if you don't want it.
- **Queries live in `decks/queries/tokens.ts`**, not the catalog (section 6), as the deck
  builder's printing queries do: they read `token_printings` and `printing_tokens` with SQL.
  The catalog owns the tables and the sync.
- **Tokens are upserted, not replaced,** so `deck_token_choices.token_id` (a foreign key, `on
delete set null`) survives every sync; links are replaced. A bulk file with no tokens at all
  leaves the stored ones alone.
- **Images:** `imageSource` falls back to `token_printings` for an id that isn't a printing, so
  `/api/images/<token id>/…` and the PDF's art crops work unchanged.
- **Code:** `decks/domain/token-proxies.ts` (pure: `deckTokens`, `tokensToPrint`, `sheetCards`),
  `decks/application/token-choices.ts` (`chooseToken`, its own factory and services),
  `app/decks/[id]/print/token-section.tsx`. `proxySummary` now takes the copies to print, and
  `proxySheet` takes `{ lines, tokens }`.
- **Preview:** a deck whose cards are all left out previews its first token.
- **Real data** (3,396 token printings, 14,323 links): a deck of Krenko, Smothering Tithe,
  Palace Jailer, Elspeth Knight-Errant, Fable of the Mirror-Breaker, Sculpted Perfection and
  Tireless Provisioner (sideboard) lists 9 tokens; Treasure has 98 arts. Checked in dark mode at
  desktop and phone width, choices kept after a reload and a sync, and PDFs in scan, playtest
  colour and playtest edges looked at page by page (the Incubator's back on the mirrored page).
