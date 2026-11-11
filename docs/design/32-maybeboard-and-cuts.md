# Design: Maybeboard and cards to cut

- **Phase:** 32 (tududi tasks 43 and 78, under task 41 "LLM tools: build decks from cards you
  already have")
- **Status:** **Approved** (2026-11-10, with the proposals in section 13)
- **Related:** design doc 09 (decks, problems), design doc 19 (role tags and targets), design doc
  20 (suggestions: the deck profile and `deckFit` reused here), design doc 23 (edit as text; the
  maybeboard was deferred there, question 2), design doc 28 (LLM tools), design doc 31
  (brackets), task 42 (free copies). No new ADR: a new board value and a pure scoring function
  follow existing decisions.
- **Lesson:** no (no new TypeScript concept: a widened union, a migration and a scoring
  function like design doc 20's)

## 1. Purpose & scope

Building a deck is as much about cutting as adding. This phase adds two things that work
together:

1. **A maybeboard**: cards you're considering, kept with the deck but not counted. They don't
   change the deck's size, statistics, problems, bracket, short list, proxies or free copies.
   Lists pasted with a `Maybeboard` / `Considering` section keep those cards instead of skipping
   them, and exports write the section back.
2. **Cards to cut**: the deck's weakest main-deck cards, weakest first, each with its reasons in
   words ("fits none of the deck's themes", "one of 14 ramp cards, target 10", "6 mana in a
   top-heavy curve"). It's in the builder, beside Suggestions, with a **Move to maybeboard**
   button for each card, and in a new LLM tool **`rank_cuts`**.

**Out of scope:** swaps ("cut X, add Y" in one step; suggestions and cuts stay separate lists),
a learned or outside card-strength rating (task 53; this uses the same local rules as
suggestions), cuts for lands (the mana base is task 49), and a maybeboard for 60-card sideboard
planning (the sideboard already exists).

## 2. Ubiquitous language

| Term | Meaning in this codebase |
| ---- | ------------------------ |
| Maybeboard | The deck's `maybe` board: cards considered, not played. Counted nowhere. |
| Counted boards | `commander`, `main` and `side`: every board but the maybeboard. |
| Cut candidate | A main-deck card that isn't a land or a commander. |
| Keep score | How much a cut candidate earns its place. Lower means a better cut. |
| Cut reason | One reason a card scores low (or high), put into words by the builder and `rank_cuts`. |

## 3. Domain model

```ts
// decks/domain/deck.ts
export const BOARDS = ["commander", "main", "side", "maybe"] as const;
export type Board = (typeof BOARDS)[number];
/** The boards a deck plays with: everything but the maybeboard. */
export const COUNTED_BOARDS = ["commander", "main", "side"] as const satisfies readonly Board[];
export function isCounted(board: Board): boolean;

// decks/domain/cuts.ts (pure)
export type CutCandidate = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  manaValue: number;
  keywords: readonly string[];
  roles: readonly Tag[];
  themes: readonly Theme[];
  rarity: string;
  priceCents: number | null;
  isGameChanger: boolean;
  /** Copies short (owned < quantity, task 42 counts aside). */
  short: number;
}>;

export type CutReason =
  | Readonly<{ kind: "noFit" }> // matches none of the deck's themes, tribes or commander keywords
  | Readonly<{ kind: "fits"; reasons: readonly Reason[] }> // design doc 20's reasons: why to keep
  | Readonly<{ kind: "surplusRole"; tag: TargetedTag; count: number; target: number }>
  | Readonly<{ kind: "neededRole"; tag: TargetedTag; count: number; target: number }>
  | Readonly<{ kind: "topHeavy"; manaValue: number; average: number }>
  | Readonly<{ kind: "overBracket"; target: Bracket }>
  | Readonly<{ kind: "notOwned"; short: number }>;

export type RankedCut = Readonly<{
  card: CutCandidate;
  keepScore: number;
  reasons: readonly CutReason[];
}>;

/** The deck's cut candidates, weakest first. */
export function rankCuts(
  candidates: readonly CutCandidate[],
  profile: DeckProfile, // deckProfile(lines, format) from design doc 20
  context: CutContext, // role counts and targets, average mana value, target bracket
): RankedCut[];
```

### Keep score (one place to tune, like design doc 20's `WEIGHTS`)

| Part | Points |
| ---- | ------ |
| Fit: design doc 20's `deckFit` against the deck's own profile (themes, tribes, commander keywords) | as in doc 20: +3 a theme, +3 a tribe, +1 a commander keyword (2 at most) |
| Role the deck is short of (count ≤ target) | +3 for each such role |
| Role the deck has too many of (count > target + 2) | −1 for each such role |
| Mana value ≥ 5 when the deck's average non-land mana value is over its format's guide (3.3 Commander, 3.0 others) | −(mana value − 4), at most −3 |
| A Game Changer in a deck whose cards go over its target bracket | −5 |
| Copies short | −1 |
| Strength tie-break (`strength`, rarity and price) | +0.5 × strength |

Reasons list every part that applied, so a low score explains itself and a kept card says why.

## 4. Invariants

1. Maybeboard cards change none of: deck size, statistics, role counts, problems, bracket
   estimate, short list and "Wish for what it's short", "Buy what it's short", proxies and token
   proxies, playtest hands, free copies (task 42: a maybeboard card doesn't use a copy), and
   suggestions' "already in the deck" check.
2. A card may be in the maybeboard and on a counted board at once (the primary key already
   includes the board).
3. Moving a card to the maybeboard keeps its quantity and pinned printing. Moving it back goes to
   the main deck.
4. `rankCuts` never lists a land, a commander, or a sideboard or maybeboard card.
5. `rankCuts` is deterministic: equal scores sort by name, then oracle id.
6. Pasting a list with a `Maybeboard` / `Maybe` / `Considering` section puts those lines on the
   maybeboard, and exporting writes them under `Maybeboard`. A round trip changes nothing.
7. Formats that export only what's played (Arena, MTGO) leave the maybeboard out.

## 5. Use cases

| Use case | Actor / authz | Input | Output | Errors (`kind`) | Transaction? |
| -------- | ------------- | ----- | ------ | --------------- | ------------ |
| `setEntry` (existing) with `board: "maybe"` | owner | deck, card, board, quantity | — | as today | yes |
| `moveEntry` (new) | owner | deck, card, from board, to board | — | DeckNotFound, EntryNotFound, CommanderMove | yes |
| `importList` / `replaceList` (existing) | owner | text | — | as today | yes |
| `cutsFor` (query) | owner | deck id, how many (default 10, at most 30) | `RankedCut[]` | — (null if not theirs) | no |

`moveEntry` adds to the target board's count if the card is already there (Bolt ×1 maybe +
Bolt ×2 main → Bolt ×3 main) and keeps the pinned printing of the line being moved.

## 6. Ports

No new port. `moveEntry` uses the decks repository the existing use cases use.

## 8. Persistence

One migration: the check `deck_entries_board_known` becomes
`board in ('commander', 'main', 'side', 'maybe')`. No new columns or tables.

## 9. Read models (queries)

- **Deck view** (`deckView`): maybeboard lines come back like the others with `board: "maybe"`.
  Everything that counts filters on `isCounted`, in the domain, rather than in each query.
- **SQL that counts copies in decks** (task 42's `free`, the other-deck uses, browse's
  "in this deck", suggestions' "in the deck") adds `board <> 'maybe'`.
- **Builder deck list**: a collapsed **Maybeboard (N)** section under the sideboard. Each line
  has **Move to deck**, and each main-deck line's menu gets **Move to maybeboard**. The selected
  card panel gains a **Maybe** add button beside Sideboard.
- **Cards to cut panel**: beside Suggestions, the 10 weakest cards with their reasons and a
  **Move to maybeboard** button. It's worked out in the browser from the deck in hand, like the
  problems (design doc 19), so it updates as you edit. `rankCuts` is pure and goes in
  `decks/client.ts`. A deck line already carries the name, type line, mana value, text (roles
  and themes come from it, as the builder does today), price and Game Changer flag. It gains
  `keywords` and `rarity`.
- **Deck page and shared view**: a Maybeboard section after the sideboard, with no counts in the
  header.
- **LLM tools**: `get_deck` lines carry `board: "maybe"`, and stats and problems ignore them.
  `set_deck_entry` accepts `"maybe"`. The new **`rank_cuts`** (read scope) takes a deck id and how
  many, and returns each card's name, keep score and reasons in words. The server instructions
  add "then rank_cuts to find what to cut, and move cuts to the maybeboard".

## 11. Patterns applied

Functional core (`rankCuts` is pure, used by the browser and `rank_cuts` alike), Strategy as data
(the weights table), the existing repository and use case for `moveEntry`. Same split as design
doc 20: queries fetch, the domain decides and explains.

## 12. Test plan

- Domain unit tests: `rankCuts` (each score part and reason, lands and commanders excluded,
  deterministic order); `isCounted` used by stats, problems, brackets, proxies and draws (one
  test each that a maybeboard card changes nothing); list read and write round trip with a
  Maybeboard section; `moveEntry` merging counts.
- Use-case tests (fakes): `moveEntry` (commander refused, missing line, merge).
- Integration: the migration accepts `maybe`; free copies, browse and suggestions ignore
  maybeboard cards; `rank_cuts` over a real deck.
- Browser check (scratch database, phone width, dark mode): move a card to the maybeboard and
  back; the Cards to cut panel's reasons.

## 13. Decisions (approved 2026-11-10: each proposal as written)

1. **Should the maybeboard count for "Wish for what it's short"?** Proposal: no (invariant 1).
   A separate "wish for the maybeboard" can come later if wanted.
2. **The weights** in section 3 are a first guess. Proposal: ship them, then tune them by checking
   a few precons by hand (the measured harness is task 57).
3. **Where Cards to cut shows on a phone**: proposal: in the Deck tab, under Suggestions, closed
   until opened (like Suggestions).
