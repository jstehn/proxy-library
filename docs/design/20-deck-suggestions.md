# Design: deck suggestions and a budget shopping list

- **Phase:** 20
- **Status:** **Approved** (2026-10-06, after review; self-approved during the overnight run of
  2026-10-02 → 03, judgement calls in [decisions-to-review.md](../decisions-to-review.md))
- **Related:** design doc 14 (deck builder), design doc 15 (buy a list), design doc 19 (role
  tags), ADR 0006 (cross-module reads), ADR 0016 (client-safe API), ADR 0017 (shared card search)

## 1. Purpose & scope

From [future-ideas.md](../future-ideas.md), "Deck building": **suggestions** ("cards like this"
and "cards that go with your commander", from your own collection first) and **price-based
recommendations** (the cheapest singles that complete a deck, or improvements within a budget).

1. **Cards for this deck**: cards that fit the deck's themes (its commander's, and what most of
   the deck already does), and cards for the roles it's short of ("Removal: 5 of 8"). Your own
   cards come first, then cards in the store with their price.
2. **Cards like this one**: in the selected-card panel, cards that do a similar job.
3. **A shopping list within a budget**: "spend up to $20 on this deck" picks store cards that fit,
   and hands the list to the existing **Buy a list** screen.

The cheapest way to **complete** a deck already exists ("Buy what it's short", design doc 15),
and the builder links to it. **Out of scope:** data from other sites (EDHREC; decided before the
run: local heuristics only), swapping cards out (that needs a strength judgment we don't have),
and the `otag:` search keyword (you asked for it to wait, though the stored tags make it easy).

## 2. Ubiquitous language

| Term              | Meaning                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Theme**         | Something a deck builds around, read from rules text: +1/+1 counters, tokens, sacrifice, graveyard, artifacts, enchantments, lifegain, spells, landfall, equipment and auras. |
| **Tribe**         | A creature type the deck cares about (Elves): the commander names its own type, or a third of the deck's creatures share it.                                                  |
| **Card features** | A printing's role tags (design doc 19) and themes, computed once by the catalog sync and stored, so SQL can filter by them.                                                   |
| **Deck profile**  | What a deck is about: its themes, tribes, the roles below target, and its commander's keywords. Worked out from the deck, never stored.                                       |
| **Pool**          | Where a suggestion comes from: **owned** (your collection) or **store** (for sale in an enabled set, at its cheapest printing).                                               |
| **Reason**        | Why a card is suggested, shown with it: "Elves", "+1/+1 counters", "Removal (5 of 8)".                                                                                        |
| **Budget list**   | Store cards chosen to fit the deck, totalling no more than a budget, as a list for Buy a list.                                                                                |

## 3. Domain model

### 3.1 Themes (`src/shared/card-search/tags.ts`, beside the role tags)

```ts
export const THEMES = [
  "counters",
  "tokens",
  "sacrifice",
  "graveyard",
  "artifacts",
  "enchantments",
  "lifegain",
  "spells",
  "landfall",
  "equipment",
] as const;
export type Theme = (typeof THEMES)[number];

type ThemeRule = Readonly<{
  theme: Theme;
  label: string; // "+1/+1 counters"
  /** A deck leader builds around it: matched against a commander's text. */
  leads: readonly RegExp[];
  /** A card plays into it: matched against any card's type line and text. */
  fits: (card: TagFacts) => boolean;
}>;

export function cardThemes(card: TagFacts): Theme[]; // the themes a card fits
export function leaderThemes(card: TagFacts): Theme[]; // the themes a commander builds around
/** Bumped whenever TAG_RULES or THEME_RULES change, so the sync tags every printing again. */
export const CARD_FEATURES_VERSION: number;
```

`leads` and `fits` differ on purpose: a commander that says "sacrifice another creature" leads
a sacrifice theme, and a creature that says "when this dies" fits it.

### 3.2 Scoring (`src/modules/decks/domain/suggest.ts`, pure)

```ts
export type CandidateCard = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  manaValue: number;
  keywords: readonly string[];
  roles: readonly Tag[];
  themes: readonly Theme[];
  rarity: string;
  priceCents: number | null;
  pool: "owned" | "store";
}>;

export type DeckProfile = Readonly<{
  themes: readonly Theme[];
  tribes: readonly string[]; // "Elf"
  /** Roles below the format's target, with the count and target, for reasons. */
  gaps: readonly Readonly<{ tag: TargetedTag; count: number; target: number }>[];
  keywords: readonly string[]; // the commanders' keywords
}>;

/** What the deck is about, from its lines and their text. */
export function deckProfile(lines: readonly ProfileLine[], format: Format): DeckProfile;

export type Scored = Readonly<{ card: CandidateCard; score: number; reasons: readonly string[] }>;

export function scoreForDeck(card: CandidateCard, profile: DeckProfile): Scored | null;
export function scoreForRole(card: CandidateCard, tag: Tag, profile: DeckProfile): Scored | null;
export function scoreLike(card: CandidateCard, target: CandidateCard): Scored | null;
/** Highest score first; owned cards before store cards at equal score; then by name. */
export function rank(scored: readonly Scored[]): Scored[];
/** Store cards that fit, cheapest-per-point first, never over the budget. */
export function budgetPicks(scored: readonly Scored[], budget: Cents, maxCards: number): Scored[];
```

**Weights** (a table, `WEIGHTS`, so they're easy to tune and teach):

| Part                                          | Points |
| --------------------------------------------- | ------ |
| each deck theme the card fits                 | 3      |
| each tribe the card belongs to (or names)     | 3      |
| each role the deck is short of                | 2      |
| each commander keyword it shares (at most 2)  | 1      |
| "like this": each shared role or theme        | 3      |
| "like this": each shared keyword (at most 3)  | 2      |
| "like this": each shared creature type        | 2      |
| "like this": same main type                   | 1      |
| "like this": mana value within 1              | 1      |
| strength tie-break (rarity, price; 0 to ~1.6) | × 0.5  |

A card with **no** theme, tribe, role or keyword match scores `null` (not suggested), so
strength alone never suggests a card.

**Deck profile rules:**

- **Themes:** the commanders' `leaderThemes`, plus any theme that at least 4 cards (and 10% of
  the non-land cards) in the main deck already fit.
- **Tribes:** a commander's own creature type that its text names ("other Elves you control"),
  plus a type shared by a third of the deck's creatures (at least 5 cards).
- **Gaps:** targeted roles (design doc 19) below the format's target.

**Budget:** cards are taken in order of score per dollar, with prices under $1 counted as $1 (so
a pile of 10¢ cards doesn't beat one good $3 card), skipping any that no longer fit the budget,
until the budget or `maxCards` (15) runs out. Greedy, not optimal (lesson 20 explains why
that's fine here).

## 4. Invariants

1. The same `cardTags` / `cardThemes` decide features everywhere. The sync stores them with
   `CARD_FEATURES_VERSION`, and any printing with an older version is tagged again on the next
   sync.
2. A suggestion is never already in the deck, never a basic land, always within the commander's
   color identity (Commander) or the deck's colors (other formats, when it has any), and legal
   in the format (casual: anything).
3. Owned cards come before store cards at equal score. A store card is one that's for sale: an
   enabled set and a known price, at its cheapest printing and finish.
4. A card owned in any printing is in the owned pool, never also in the store pool.
5. `budgetPicks` never exceeds the budget, never picks a card twice, never picks more than
   `maxCards`, and only picks store cards.
6. Every suggestion shows at least one reason.

## 5. Use cases and screens

No new commands: suggestions are reads, and adding a card uses the existing `setEntry`.

### 5.1 The Suggestions panel (builder, beside "Test hand")

```
┌ Suggestions ──────────────────────────────────────────────┐
│ For this deck   Elves · +1/+1 counters · short of Removal │
│  [img] Elvish Archdruid   ②ⓖ   Elves · Ramp      You own 1 │
│  [img] Llanowar Elves     ⓖ    Elves · Ramp         $0.25  │
│  …                                                        │
│ Removal (5 of 8)                                          │
│  [img] Beast Within …                                     │
│ Spend up to [$ 20 ] [Make a list]                         │
│  12 cards, $19.40: Elvish Mystic $0.30, … [Buy these →]   │
│ To complete the deck: Buy what it's short →               │
└───────────────────────────────────────────────────────────┘
```

- **For this deck:** up to 12 owned, then up to 12 from the store.
- **One section per role below target:** up to 6 owned, then 6 from the store.
- **Clicking a suggestion selects it** in the selected-card panel (big image, text, add with a
  quantity), exactly as clicking a grid card does, so a new card shows (with its problems) at
  once (design doc 19). Store cards can be added too: the deck shows them as short, as pasted
  cards already are.
- **Budget:** dollars and cents, at most $1 000. "Buy these" opens Buy a list with the list
  filled in (`/singles/list?list=…`), where prices are checked again before anything is bought.
- In the selected-card panel: **"Cards like this"**, 6 owned then 6 from the store.
- Keyboard: **S** opens or closes the Suggestions panel.

## 6. Ports

None. Suggestions are queries (read models) and pure scoring. The tag pass uses two new methods
on the catalog's existing `CatalogRepository`:

```ts
/** Up to `limit` printings whose features are older than `version`. */
printingsToTag(version: number, limit: number): Promise<TaggablePrinting[]>;
saveCardFeatures(features: readonly CardFeatures[], version: number): Promise<void>;
```

## 7. State machines

None.

## 8. Persistence

Migration on `printings`:

- `role_tags text[] not null default '{}'`, `theme_tags text[] not null default '{}'`,
  `features_version integer not null default 0`;
- GIN indexes on `role_tags` and `theme_tags` (array overlap, `&&`).

**The tag pass** (sync step 5b, after prices, because ramp reads `produced_mana`): repeatedly takes
1 000 printings with `features_version < CARD_FEATURES_VERSION`, tags them in TypeScript and
saves them, until none are left. The first sync after deploying tags every printing (about 76 000,
a few seconds). Later syncs only tag new printings. `pnpm worker tag-cards` runs the pass alone.

## 9. Read models (queries)

`src/modules/decks/queries/suggestions.ts`:

- `suggestionContext(db, userId, deckId)`: the deck's format, identity limit, lines with text and
  keywords (for `deckProfile`), and its oracle ids.
- `candidates(db, userId, context, want, pool)`: `want` is `{ roles, themes, tribes, keywords }`.
  - **Owned:** one row per oracle card in your collection (its most-owned printing, as the
    builder's grid), filtered by invariant 2 and by overlap with `want`.
  - **Store:** one row per oracle card in an enabled set, filtered the same way, not owned, ranked
    by a cheap SQL overlap count and cut to 400 before scoring. Then each kept card's cheapest
    priced printing in an enabled set (cards without a price are dropped).
  - Rows have the `BrowseCard` fields (so the builder can select and add them as grid cards) plus
    the scoring fields.
- `deckSuggestions`, `roleSuggestions(tag)`, `similarCards(oracleId)` and `budgetList(budget)`
  put these together: query → score → rank → cut.

`/singles/list?list=…` fills the box with a given list (at most `MAX_LIST_LINES` lines), beside
the existing `?deck=`.

## 10. Events emitted

None.

## 11. Patterns applied

- **Rules as data:** the theme table and the weights table.
- **Functional core:** all scoring is pure and unit-tested; queries only fetch candidates.
- **Precompute what's expensive to search:** features are derived once per printing by the sync
  (the same move as `produced_mana`), with a version so rule changes re-derive them.
- **Filter in SQL, rank in TypeScript:** SQL narrows 31 000 cards to a few hundred using indexed
  arrays; TypeScript does the scoring that's easier to read and test.
- **Reuse over rebuild:** the buy flow, the selection panel and provisional lines are reused.

## 12. Test plan

- **Unit:** themes (leads vs fits, with quoted Oracle text); `deckProfile` (commander themes,
  majority themes, tribes, gaps); each scorer (reasons, `null` without a match, owned-first
  ranking); `budgetPicks` property tests (invariant 5) and a worked example.
- **Integration (fixture catalog):** the tag pass tags every fixture printing once and only once
  per version; `candidates` keeps the commander's identity, skips cards in the deck and basics,
  and puts owned cards in the owned pool only; the store pool uses the cheapest priced printing;
  `?list=` prefill.
- **E2E:** open Suggestions in a Commander deck, see a section, select a suggestion and add it;
  make a budget list and follow "Buy these" to a filled-in Buy a list. Screenshots in dark mode
  and at phone width.

## 13. Decisions (self-approved, then approved by you on 2026-10-06; see decisions-to-review.md)

1. Features are stored per printing by the sync (not computed per request).
2. Suggestions are **additions**; nothing suggests a card to cut.
3. Non-Commander decks are limited to the deck's colors when it has any.
4. Budget picks use score per dollar with a $1 floor, at most 15 cards, one copy each.
5. The `otag:` keyword still waits, as you asked, though the columns now exist.
