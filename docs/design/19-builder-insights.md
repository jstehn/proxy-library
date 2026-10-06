# Design: builder insights (roles, test hands, problems as you build)

- **Phase:** 19
- **Status:** **Approved** (2026-10-02, with the decisions in section 13)
- **Related:** design doc 09 (decks, rules 1–5), design doc 14 (deck builder, live statistics),
  design doc 15 (shared card search), ADR 0008 (injected randomness), ADR 0016 (client-safe
  module API), ADR 0017 (shared card search)

## 1. Purpose & scope

The builder shows a deck's curve, colors and lands. It doesn't show whether the deck can
**do** anything: how much ramp, card draw and removal it has, how its opening hands look, or
whether the card you just added breaks a rule (that only shows once the server answers). This
phase adds three things from [future-ideas.md](../future-ideas.md):

1. **Automatic role tags** (ramp, card draw, removal, board wipes, counterspells, tutors,
   protection) read from each card's rules text. They have counts against targets in the
   statistics, and a "by role" deck list.
2. **A draw simulator**: deal a test hand, mulligan, draw the next card, and see the exact odds
   of the things players ask about ("will I have lands?").
3. **Problems checked in the browser** the moment a card is added, removed or changed, using
   the same pure `deckProblems` the server runs.

**Out of scope:** suggestions that use the tags (phase 20), sharing and comments (phase 21),
more formats, partner checks and strict ownership (still in future-ideas.md). Tags are
**heuristics**: they help you count roles and don't decide anything, so a few misses and false
matches are acceptable (section 4, rule 3).

## 2. Ubiquitous language

| Term                 | Meaning in this codebase                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Role tag** (tag)   | A job a card does in a deck, read from its rules text: `ramp`, `draw`, `removal`, `wipe`, `counter`, `tutor`, `protection`. A card can have several, or none.      |
| **Tag rule**         | One row of the tag table: a tag and the patterns that find it. Read in TypeScript, in the browser and on the server.                                               |
| **Role target**      | The usual number of cards of a role in a deck of a format (Commander: about 10 ramp). A guide, not a rule.                                                         |
| **Test hand**        | A random opening hand from the deck's library, for practice. Nothing is stored.                                                                                    |
| **Library**          | The cards you draw from: the main deck, **without** the commanders (they start in the command zone) and the sideboard.                                             |
| **Mulligan**         | London mulligan: shuffle, draw 7 again, then put one card on the bottom per mulligan taken. In Commander the first mulligan is free (multiplayer rule, CR 103.5c). |
| **Odds**             | Exact chances from the hypergeometric distribution (drawing without replacement), not from simulation.                                                             |
| **Provisional line** | A deck line the browser makes from a grid card, to show a new card (and its problems) before the server answers.                                                   |

## 3. Domain model

### 3.1 Tags (`src/shared/card-search/tags.ts`, pure, browser-safe)

They go in the shared card-search library (ADR 0017) rather than the decks module, because
other modules will want them: a later `otag:` search keyword, and phase 20's suggestions.

```ts
export const TAGS = ["ramp", "draw", "removal", "wipe", "counter", "tutor", "protection"] as const;
export type Tag = (typeof TAGS)[number];

/** What a tag rule needs to know about a card (any face's text, joined). */
export type TagFacts = Readonly<{
  typeLine: string;
  text: string;
  producedMana: readonly string[];
}>;

/** One tag's rule: regular expressions over the rules text, matched ignoring case. */
type TagRule = Readonly<{
  tag: Tag;
  /** The card has the tag if any pattern matches its text… */
  patterns: readonly RegExp[];
  /** …and no exclusion matches (e.g. "search your library for a land" is ramp, not a tutor). */
  exclusions?: readonly RegExp[];
  /** Extra test on structured facts (ramp: a non-land that makes mana). */
  facts?: (card: TagFacts) => boolean;
  /** Lands never get this tag (a land that taps for mana isn't "ramp"). */
  notOnLands?: boolean;
}>;

export const TAG_RULES: readonly TagRule[]; // section 3.2

export function cardTags(card: TagFacts): Tag[];
```

### 3.2 The first tag table (to be tuned while building, with tests for each row)

| Tag          | Matches (examples, written as plain regex here)                                                                                                                                                                                                                         | Doesn't match                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ramp`       | non-land with `producedMana` (Sol Ring, Llanowar Elves); `search your library for … (basic )?land`; `put a land card … onto the battlefield`; `create … Treasure`                                                                                                       | lands; "destroy target land"                                |
| `draw`       | `draws? (a\|two\|three\|\w+\|X) cards?`; `draw cards equal to`                                                                                                                                                                                                          | "each player discards"; draw-step text in reminder text     |
| `removal`    | `(destroy\|exile) (up to one )?(another )?target (creature\|artifact\|enchantment\|planeswalker\|(nonland )?permanent)`; `damage to (any target\|target creature)`; `target creature gets -\d+/-\d+`; `return target (creature\|nonland permanent) to its owner's hand` | "destroy target land"; "exile target card from a graveyard" |
| `wipe`       | `(destroy\|exile) (all\|each) (other )?(creatures\|nonland permanents\|artifacts\|enchantments)`; `damage to each creature`; `all creatures get -\d+/-\d+`                                                                                                              | "each creature you control"                                 |
| `counter`    | `counter target (\w+ )?spell`; `counter target (activated\|triggered) ability`                                                                                                                                                                                          | "+1/+1 counter on target"                                   |
| `tutor`      | `search your library for (a\|an\|up to \w+) .*card`                                                                                                                                                                                                                     | searches for lands (that's ramp)                            |
| `protection` | `(creatures\|permanents) you control (gain\|have) (hexproof\|indestructible\|protection)`; `target (creature\|permanent) you control gains (hexproof\|indestructible\|protection)`; `phase out`                                                                         | a creature's own keyword (`keywords` has "Hexproof")        |

Reminder text (in parentheses) is removed before matching, so "(… draw a card …)" in a keyword's
reminder doesn't count.

### 3.3 Statistics (`src/modules/decks/domain/stats.ts`)

```ts
export type StatsLine = Readonly<{
  /* …as now… */
  /** Rules text of every face, for role tags. Missing: no tags. */
  text?: string;
}>;

export type DeckStats = Readonly<{
  /* …as now… */
  /** Cards (main deck and commander) with each role; a card with two roles counts in both. */
  tags: Readonly<Record<Tag, number>>;
}>;

/** The usual counts to aim for in a format (decision 2: Commander only), or null. */
export function roleTargets(format: string): Readonly<Record<TargetedTag, number>> | null;
// Commander (100): ramp 10, draw 10, removal 8, wipe 3 (a common community guide).
// Other formats: null. There's no common guide, so their roles are counted without targets.
```

`DeckLine` gets `text: string`. The deck query already reads it as `face_text`.

### 3.4 Draws (`src/modules/decks/domain/draws.ts`, pure, exported from `client.ts`)

```ts
/** One card in the library, by deck line; copies are separate entries. */
export type LibraryCard = Readonly<{
  oracleId: string;
  name: string;
  printingId: string;
  isLand: boolean;
  tags: readonly Tag[];
}>;

/** The cards you draw from: main deck copies, no commanders, no sideboard. */
export function library(lines: readonly DeckLine[]): LibraryCard[];

/** A test game's state: a reducer, like the opening experience (lesson 08). */
export type TestHand = Readonly<{
  library: readonly LibraryCard[]; // shuffled, top first
  hand: readonly LibraryCard[];
  mulligans: number;
  /** Cards still to put on the bottom after a mulligan (London). 0 when the hand is settled. */
  toBottom: number;
  turn: number; // 0 before any draw step
  freeMulligan: boolean; // Commander: the first one costs nothing
}>;

export type TestHandEvent =
  | Readonly<{ kind: "newHand"; rng: Rng }>
  | Readonly<{ kind: "mulligan"; rng: Rng }>
  | Readonly<{ kind: "bottom"; index: number }> // choose a card in hand to put on the bottom
  | Readonly<{ kind: "draw" }>;

export function startHand(cards: readonly LibraryCard[], rng: Rng, freeMulligan: boolean): TestHand;
export function nextHand(state: TestHand, event: TestHandEvent): TestHand;

/** P(at least `atLeast` successes) drawing `draws` cards without replacement. Exact. */
export function hypergeometricAtLeast(
  population: number,
  successes: number,
  draws: number,
  atLeast: number,
): number;

/** The odds table the panel shows (section 5.2). */
export function deckOdds(cards: readonly LibraryCard[]): readonly OddsRow[];
export type OddsRow = Readonly<{ label: string; chance: number }>;
```

Shuffling uses the kernel's `shuffled(rng, items)`.

## 4. Invariants

1. **One tag table.** Statistics, the deck list and the selected card all call `cardTags`;
   nothing else decides a card's roles.
2. Lands never get `ramp` (a land that taps for mana is a land, counted in "lands" already). A
   card can have several tags. Tags never change what a deck allows.
3. Every tag rule has at least one real card that matches and one near-miss that doesn't, as unit
   tests. Real Oracle text is quoted in the tests: the 32-card fixture has too few staples, and
   the strings are the test's data.
4. `deckStats(lines).tags[t]` counts copies in the main deck and commander, never the
   sideboard, the same as the other statistics.
5. The library never holds a commander or a sideboard card, and has exactly one entry per copy.
6. A test hand after `k` mulligans keeps `7 − k` cards (one fewer in Commander, where the first
   mulligan is free). You can't draw while cards are still waiting to go on the bottom.
7. `hypergeometricAtLeast` returns 1 when `atLeast ≤ 0`, and 0 when it's impossible. Summed
   over every exact count it gives 1 (property test). It matches a 20 000-hand seeded
   simulation within 1.5 percentage points (a fixed seed, so it never flakes).
8. The browser's problems equal the server's for the same deck: both call the one
   `deckProblems`, and the server's answer replaces the browser's when it arrives.
9. Randomness still comes from an injected `Rng`. The browser gets a **seed from the server**
   (the page calls `randomSeed()`) and makes `seededRng(`${seed}:${handNumber}`)`, so there's no
   `Math.random` and the lint rule stays as it is (section 11).

## 5. Use cases and screens

No new commands: nothing is saved. Everything below is pure functions and UI.

### 5.1 Role counts

```
── roles ──                          (targets for the format in grey)
Ramp      ████████░░  8 / 10
Draw      ██████████ 11 / 10
Removal   █████░░░░░  5 / 8   ← below the guide
Wipes     ██░         2 / 3
Counters 3 · Tutors 1 · Protection 2
```

- In `StatsPanel`, under the color bars, against the format's targets (decision 2).
- **Clicking a role** highlights its cards in the deck list. The deck list gets a third
  grouping, **"By role"**, beside "By type" and the visual view. A card with two roles shows
  under both, and cards with none go under "Other".
- The selected-card panel shows the card's tags as small labels.

### 5.2 Test hand

A **"Test hand"** button opens a panel (a sheet on a phone; the numbers are only an illustration):

```
┌ Test hand ── mulligans: 1 (free) ──────────── turn 0 ┐
│ [card][card][card][card][card][card][card]           │
│ Choose 0 cards to put on the bottom                  │
│ [New hand] [Mulligan] [Draw]                         │
├ Odds (this deck, 99-card library, on the play) ──────┤
│ 2–5 lands in the opening hand          81%           │
│ 3 lands by turn 3                      77%           │
│ 4 lands by turn 4                      66%           │
│ A ramp card by turn 2                  64%           │
│ Card draw by turn 4                    71%           │
│ Removal by turn 4                      62%           │
└──────────────────────────────────────────────────────┘
```

- The odds treat "by turn N, on the play" as the first `7 + N − 1` cards. Rows for a role only
  appear if the deck has that role. "On the draw" is a toggle (one more card).
- Keyboard: **H** opens the panel, **N** deals a new hand, **M** mulligans, **D** draws.

### 5.3 Problems as you build

- `BuilderDeck` (from `loadBuilderDeck`) also carries `rules: Record<oracleId, CardRules>` and
  `owned: Record<oracleId, number>`.
- `BrowseCard` carries what's needed for a **provisional line**: its `CardRules`, with
  `legalities` cut down to the deck's format to keep pages small, plus `producedMana`, `text`,
  set code, collector number and price.
- `deck-builder.tsx` keeps `{ lines, rules, owned }` in state. It derives problems with
  `deckProblems` and their words with `problemText` (`src/app/decks/labels.ts` already only
  imports types and `assertNever`, so client components can use it). Adding a **new** card
  inserts a provisional line at once, so its problems, stats and tags show immediately. When
  the server answers, its deck replaces the local one (the existing `latestChange` guard keeps
  stale answers out).

## 6. Ports

None new. The draw simulator takes the kernel's `Rng`. Tags and problems are pure functions.

## 7. State machines

The test hand (`nextHand`):

| From                   | Event      | To                                                             |
| ---------------------- | ---------- | -------------------------------------------------------------- |
| any                    | `newHand`  | fresh shuffle, 7 cards, mulligans 0, toBottom 0, turn 0        |
| `toBottom = 0`, turn 0 | `mulligan` | fresh shuffle, 7 cards, mulligans + 1, toBottom = owed bottoms |
| `toBottom > 0`         | `bottom`   | that card to the library's bottom, toBottom − 1                |
| `toBottom = 0`         | `draw`     | top card to hand, turn + 1 (nothing if the library is empty)   |
| `toBottom > 0`         | `draw`     | unchanged (invariant 6)                                        |
| turn > 0               | `mulligan` | unchanged (you can't mulligan after the game starts)           |

## 8. Persistence

None. No tables or migrations. Tags are computed in TypeScript when they're needed.

## 9. Read models (queries)

- `deckView` / `DeckLine`: add `text` (already selected as `face_text`).
- `browseCollection` / `BrowseCard`: add `rules` (a `CardRules` whose legalities are only the
  deck's format), `producedMana`, `text`, `setCode`, `collectorNumber` and `priceCents`, for
  provisional lines.

## 10. Events emitted

None.

## 11. Patterns applied

- **Rules as data** (lesson 09): the tag table, like `FORMAT_RULES`.
- **Functional core**: `cardTags`, `deckStats`, `nextHand`, `hypergeometricAtLeast` and
  `deckProblems` are all pure and unit-tested. The UI only wires them up.
- **Client-safe module API** (ADR 0016): `client.ts` gains `deckProblems`, `library`,
  `startHand`, `nextHand`, `deckOdds`, `roleTargets`. The shared card-search index exports
  `cardTags` and `TAGS`.
- **Reducer for UI state** (lesson 08): the test hand is a pure reducer.
- **Deliberate change to ADR 0008:** this is the first randomness that runs in the browser. It
  still uses an injected `Rng` and a server-made seed. Test hands decide nothing (no money, no
  cards), so cheating isn't a concern. **An implementation note will be added to ADR 0008**:
  "randomness that decides nothing may run in the browser, still through `Rng`".

## 12. Test plan

- **Domain unit/property tests:**
  - `tags.test.ts`: every row has matches and near-misses, using quoted Oracle text (Cultivate,
    Sol Ring, Llanowar Elves, Swords to Plowshares, Lightning Bolt, Wrath of God, Rhystic Study,
    Counterspell, Demonic Tutor, Heroic Intervention, Evolving Wilds as a land that isn't ramp,
    and so on). Reminder text is ignored. Lands never get `ramp`.
  - `stats.test.ts`: tag counts by quantity, sideboard excluded, overlapping roles.
  - `draws.test.ts`: library excludes commanders and the sideboard; the mulligan counts
    (Commander's free first one); bottoming; no draw while owing bottoms; property tests for
    `hypergeometricAtLeast` (sums to 1, in [0, 1], gets larger as `draws` grows) and the seeded
    simulation check.
- **Use-case tests (fakes):** none. There are no new use cases.
- **Integration tests (`test:int`):**
  - `browseCollection` returns rules and provisional-line fields. `deckView` lines carry text.
- **E2E (Playwright):** in a Commander deck, adding an off-color card marks it **before** the
  server answers (the save action is delayed in the test). The role counts change. "Test hand"
  shows 7 cards; a mulligan asks for 0 bottoms the first time (free) and 1 the second. Take
  screenshots in **dark mode and at phone width**.

## 13. Decisions from review (2026-10-02)

1. **The tag set:** the seven in section 3.2.
2. **Role targets for Commander only.** Approved first as "every format", with 60-card and
   limited numbers scaled down from Commander's. Changed in your review (2026-10-06): there's no
   good common guide for those decks, so they show counts without targets, and the suggestions
   (design doc 20) find no role gaps for them.
3. **`otag:` waits** for a later phase. The tag rules are plain JavaScript regular expressions
   for now; a search keyword would need the same rules in SQL (or tags stored per printing).
4. **A third deck-list view, "By role".**
5. **Commander's free first mulligan is on by default**, with a switch.
6. **Browser randomness:** an implementation note on ADR 0008.
