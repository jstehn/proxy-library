# Design: Commander bracket estimate and target bracket

- **Phase:** 31
- **Status:** **Approved** (2026-11-10, with the decisions in section 13)
- **Related:** design doc 09 (decks, problems), design doc 19 (role tags), design doc 20 and
  ADR 0019 (features stored per printing), design doc 21 (sharing), design doc 28 and ADR 0022
  (LLM tools), ADR 0007 (external data), ADR 0017 (shared card search). No new ADR: this follows
  ADR 0019's stored features and ADR 0007's gateway. Combo detection will need one later.

## 1. Purpose & scope

Wizards' **Commander Brackets** (1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH) are how
a playgroup agrees on power before a game. A deck's bracket is mostly set by a few checkable
things: how many **Game Changers** it has, and whether it has **mass land denial**, **chained
extra turns** or **early two-card combos**. The rest is intent, which no tool can read.

This phase adds:

1. A **bracket estimate**: the lowest bracket the deck's cards allow, the evidence for it
   (which cards, which rule) and what can't be checked. It shows in the deck builder, on shared
   decks, and in `get_deck` for LLM tools.
2. **Search keywords** for Game Changers, land denial and extra turns.
3. An optional **target bracket** saved on a Commander deck. The builder **warns** when the
   cards go over it, and **suggestions** leave out cards that would push the deck over it.

**Out of scope:** a "power level" score (1–10), judging intent (bracket 1 vs 2, 4 vs 5), banned
cards (already a deck problem, design doc 09). **Two-card combos** are "not checked" for now and
are a later feature (Commander Spellbook data, its own design doc and ADR; added to
`future-ideas.md`).

### The rules being checked (as of the 9 Feb 2026 update; tutors stopped counting in Oct 2025)

| Rule                     | 1 Exhibition | 2 Core       | 3 Upgraded        | 4 Optimized | 5 cEDH |
| ------------------------ | ------------ | ------------ | ----------------- | ----------- | ------ |
| Game Changers            | none         | none         | up to 3           | any         | any    |
| Mass land denial         | no           | no           | no                | yes         | yes    |
| Extra turns              | few, no loop | few, no loop | no chaining       | any         | any    |
| Two-card infinite combos | no           | no           | only late in game | any         | any    |

The table lives in code as data (`BRACKET_RULES`), with the update's date in a comment, so a
future change by Wizards is one edit plus tests. **The Game Changer list itself is not in our
code**: Scryfall flags each card (`game_changer: true`, 53 cards in the 7 Nov 2026 bulk file),
so the nightly sync keeps it current. Scryfall also flags a few tokens (Treasure, Zombie, Orc
Army); tokens aren't printings here, so they never reach a deck.

## 2. Ubiquitous language

| Term                 | Meaning in this codebase                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bracket**          | 1–5, Wizards' Commander power bands.                                                                                                                                         |
| **Bracket floor**    | The lowest bracket the deck's cards allow: the estimate. A deck can always be played _higher_ than its floor; its cards can't make it lower.                                 |
| **Target bracket**   | The bracket the owner means the deck for, saved on the deck. Optional, Commander only.                                                                                       |
| **Over target**      | The floor is above the target. A **warning**, never a deck problem: the deck stays valid and nothing is blocked.                                                             |
| **Game Changer**     | A card on Wizards' list, read from Scryfall's `game_changer` flag and stored on the printing.                                                                                |
| **Mass land denial** | A card that destroys, exiles, bounces or locks down many lands, or turns off nonbasic lands. Includes Blood Moon and Back to Basics (decision 2; stricter than some guides). |
| **Extra-turn card**  | A card whose text says "take an extra turn". Three or more in a deck counts as **chaining** (decision 4).                                                                    |
| **Bracket finding**  | One reason for the floor: a rule, the cards that trip it, and the bracket it forces.                                                                                         |
| **Unchecked**        | What the estimate can't see: intent, and two-card combos.                                                                                                                    |

## 3. Domain model

### 3.1 Card flags (`src/shared/card-search/brackets.ts`, pure, browser-safe)

Next to tags and themes, so the builder, the sync and the search share one set of rules.

```ts
export const BRACKET_FLAGS = ["gameChanger", "landDenial", "extraTurn"] as const;
export type BracketFlag = (typeof BRACKET_FLAGS)[number];

export type BracketFacts = TagFacts & Readonly<{ isGameChanger: boolean }>;

/** Which bracket rules a card trips. `gameChanger` comes from Scryfall; the others from text. */
export function bracketFlags(card: BracketFacts): BracketFlag[];
```

Text rules (reminder text removed first, each with real-card tests and near-misses, like tags):

| Flag         | Matches (examples)                                                                                                                                                                                                                                                        | Doesn't match                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `landDenial` | `(destroy\|exile\|return) all (nonbasic )?lands` (Armageddon, Ravages of War, Jokulhaups); `each player sacrifices … lands` (Tangle Wire is out, Wildfire in); `lands don't untap` (Winter Orb, Back to Basics); `nonbasic lands are \w+` (Blood Moon, Magus of the Moon) | Strip Mine ("target land"); "lands you control"; "destroy all creatures" |
| `extraTurn`  | `takes? an extra turn`, `takes? (two\|\w+) extra turns` (Time Warp, Nexus of Fate, Time Stretch)                                                                                                                                                                          | "skip your next turn"; "extra combat"                                    |

### 3.2 The estimate (`src/modules/decks/domain/brackets.ts`, pure, exported from `client.ts`)

```ts
export const BRACKETS = [1, 2, 3, 4, 5] as const;
export type Bracket = (typeof BRACKETS)[number];

export type BracketLine = Readonly<{
  name: string;
  quantity: number;
  board: Board;
  flags: readonly BracketFlag[];
}>;

export type BracketRule = "gameChangers" | "landDenial" | "extraTurns";

export type BracketFinding = Readonly<{
  rule: BracketRule;
  cards: readonly string[]; // names, for the panel and for highlighting
  count: number;
  forces: Bracket; // the lowest bracket this finding allows
}>;

export type BracketEstimate = Readonly<{
  /** The floor: the highest `forces` among findings, or 1 with none. */
  floor: Bracket;
  /** What the deck could also be, given intent: floor 1 → 1–2, floor 4 → 4–5. */
  range: Readonly<{ low: Bracket; high: Bracket }>;
  findings: readonly BracketFinding[];
  gameChangers: number;
  unchecked: readonly ("intent" | "combos")[];
}>;

/** Commander decks only (null for other formats). Ignores the sideboard; counts commanders. */
export function estimateBracket(
  format: Format,
  lines: readonly BracketLine[],
): BracketEstimate | null;
```

How findings force brackets (`BRACKET_RULES`):

- Game Changers: 0 → no finding; 1–3 → 3; 4 or more → 4.
- Any land denial card → 4.
- Extra-turn cards: 1–2 → 2 ("few"); 3 or more → 4 (chaining is banned in 3).
- The floor is never 5 (cEDH is intent). Range: floor 1 → 1–2; 2 → 2; 3 → 3; 4 → 4–5.

The panel's words come from `BracketFinding` in `src/app/decks/labels.ts` (like `problemText`),
not from the domain.

### 3.3 Target bracket (decks module)

```ts
// deck.ts
export type Deck = Readonly<{
  /* …as now… */
  /** The bracket the owner means it for (design doc 31). Commander decks only; null: no target. */
  targetBracket: Bracket | null;
}>;

export type TargetBracketInvalid = Readonly<{ kind: "TargetBracketInvalid" }>; // not 1–5
export type TargetBracketNotCommander = Readonly<{ kind: "TargetBracketNotCommander" }>;

export function checkTargetBracket(
  format: Format,
  target: number | null,
): Result<Bracket | null, TargetBracketInvalid | TargetBracketNotCommander>;

// brackets.ts
export type BracketWarning = Readonly<{
  kind: "OverTargetBracket";
  target: Bracket;
  floor: Bracket;
  /** Only the findings that force a bracket above the target. */
  findings: readonly BracketFinding[];
}>;

/** null when there's no target, the deck isn't Commander, or the floor is within the target. */
export function bracketWarning(
  estimate: BracketEstimate | null,
  target: Bracket | null,
): BracketWarning | null;

/**
 * Whether adding one more copy of a card keeps the deck within the target: the estimate with
 * that card added still has floor ≤ target. Suggestions use it to leave cards out.
 */
export function fitsTarget(
  lines: readonly BracketLine[],
  card: Readonly<{ name: string; flags: readonly BracketFlag[] }>,
  target: Bracket,
): boolean;
```

So with target 3 and two Game Changers, one more Game Changer is still suggested, a fourth isn't.
With target 2, no Game Changers and no land denial, and extra-turn cards only up to two. Target
4 or 5 leaves nothing out.

A Game Changer that's already in the deck and over target is a warning; it isn't removed or
blocked. Changing the format away from Commander **clears** the target (in the same update).

## 4. Invariants

1. One rule table: the builder, shared decks, `get_deck`, suggestions and search all go through
   `bracketFlags` and `estimateBracket`.
2. The floor is the maximum of the findings' `forces`; adding a card never lowers it (property
   test).
3. The floor is never 5. Non-Commander formats get `null`.
4. Sideboard lines never count. Commanders count (Tergrid and Braids are Game Changers).
5. Each text rule has quoted-Oracle-text matches and near-misses as unit tests.
6. Every finding lists the cards that caused it, so the estimate is always explainable.
7. Game Changer status comes only from stored Scryfall data, never a list in our code.
8. A target bracket exists only on Commander decks: `checkTargetBracket` refuses others, a
   format change clears it, and a database check enforces it.
9. Over target is a warning, never a `DeckProblem`: it doesn't change whether a deck is valid.
10. With a target, no deck suggestion would raise the floor above it: `fitsTarget` holds for
    every card suggestion queries return (property test over fake candidates; integration test).
11. `bracketWarning` is null exactly when `floor ≤ target` (or no target).

## 5. Use cases and screens

### 5.1 Use cases

| Use case                  | Actor / authz    | Input                         | Output | Errors (`kind`)                                                     | Transaction?                                       |
| ------------------------- | ---------------- | ----------------------------- | ------ | ------------------------------------------------------------------- | -------------------------------------------------- |
| `setTargetBracket`        | the deck's owner | deckId, `target: 1–5 \| null` | Deck   | `DeckNotFound`, `TargetBracketInvalid`, `TargetBracketNotCommander` | yes (one row)                                      |
| `changeFormat` (existing) | owner            | as now                        | Deck   | as now                                                              | yes; also clears the target when leaving Commander |

### 5.2 Builder (StatsPanel, Commander decks)

```
── bracket ──                          Target: [ none ▾ 1 2 3 4 5 ]
Bracket 3 · Upgraded  (at least)
  ⚠ Over your target (2): 2 Game Changers
  2 Game Changers (up to 3 in bracket 3): Rhystic Study, Smothering Tithe
  1 extra-turn card: Time Warp
  Not checked: two-card combos, how you play it
```

- The target is a small select in the panel's heading; it saves at once (like the format).
- Over target shows as an amber warning in the panel **and** in the problems list, styled
  apart from problems (problems are red and mean "not legal").
- Clicking a finding highlights its cards in the list (the role-click mechanism from phase 19).
- Game Changers get a small "GC" label in the deck list and the selected-card panel.
- Live: computed in the browser from the lines' flags, like stats; adding a Game Changer shows
  the warning before the server answers.
- The builder's suggestions panel leaves out cards that don't fit the target, and says so:
  "Hiding 6 cards over bracket 2".

### 5.3 Shared decks (design doc 21)

The shared deck page shows the floor, the range and the target ("Built for bracket 3 · cards
say at least 3"), so a playgroup can check before a game.

### 5.4 LLM tools

- `get_deck` output gains `targetBracket` and `bracket: BracketEstimate` (Commander decks), plus
  `bracketWarning` when over target.
- `update_deck` gains `targetBracket: 1–5 | null`.
- `suggest_for_deck`, `budget_upgrades` and `search_for_deck` (they take a deck) leave out cards
  that don't fit the target, and report how many they left out.
- The instructions add: "For a Commander deck, read its target bracket. If it has none, ask the
  player which bracket they want and save it with update_deck. Keep Game Changers, land denial
  and extra turns within it; `-is:gamechanger` excludes Game Changers from a search."

### 5.5 Search language

- `is:gamechanger` (alias `is:gc`), `is:landdenial`, `is:extraturn`, in SQL (ADR 0017; see
  section 15, note 6). They work in the builder grid, the store, collection and `search_for_deck`,
  and go in the search guide.

## 6. Ports

- The Scryfall gateway's Zod schema gains `game_changer` (ADR 0007's ACL); the mapper carries
  `isGameChanger`.
- `DeckRepository` stores and loads `targetBracket` (no new port).

## 7. State machines

None. The target is a plain optional value.

## 8. Persistence

Catalog (`printings`):

- `is_game_changer boolean not null default false`, filled by the Scryfall pass (same place as
  `produced_mana`).
- `bracket_flags text[] not null default '{}'` with a GIN index, filled by the tag pass from
  `bracketFlags` (it reads `is_game_changer`, so it runs after the Scryfall pass, as tags do).
  `CARD_FEATURES_VERSION` goes to 2, so the next sync re-tags every printing (~17 s).

Decks (`decks`):

- `target_bracket smallint null`, checks `target_bracket between 1 and 5` and
  `target_bracket is null or format = 'commander'`.

Until the next sync, flags are empty and estimates read low; the panel says "card data not
synced yet" when no printing has `features_version ≥ 2`.

The deck export (design doc 11) and reset (design doc 12) need nothing new: the target is a deck
column, exported with the deck and deleted with it.

## 9. Read models (queries)

- `deckView` / `DeckLine`, `BrowseCard`, `SuggestionCard`: add `bracketFlags`.
- `BuilderDeck` and the shared deck view: add `targetBracket`.
- `deckSuggestions`, `budgetList`, `searchForDeck`: when the deck has a target, filter
  candidates with `fitsTarget` in TypeScript after the SQL filter ("filter in SQL, rank in
  TypeScript", design doc 20), and return `hiddenOverTarget: number`.

## 10. Events emitted

None. (Setting a target isn't activity worth a feed entry.)

## 11. Patterns applied

- **Rules as data** (lessons 09 and 19): `BRACKET_RULES` and the flag table.
- **Functional core**: `bracketFlags`, `estimateBracket`, `bracketWarning` and `fitsTarget` are
  pure; queries, use cases and UI only wire them up.
- **Precomputed features** (ADR 0019): flags stored per printing, versioned.
- **Client-safe API** (ADR 0016): `client.ts` exports the estimate functions.
- **Result for expected failures** (ADR 0003): `checkTargetBracket`.
- **Warnings beside problems:** a separate type rather than a new `DeckProblem` kind, because
  problems mean "this deck breaks the format's rules" and the bracket is an agreement between
  players.

## 12. Test plan

- **Unit:**
  - `shared/card-search/brackets.test.ts`: each text rule's matches and near-misses with quoted
    Oracle text (Armageddon, Ravages of War, Winter Orb, Blood Moon, Magus of the Moon, Back to
    Basics, Strip Mine, Wrath of God, Time Warp, Nexus of Fate, Relentless Assault).
  - `decks/domain/brackets.test.ts`: the thresholds (0/1/3/4 Game Changers), land denial → 4,
    extra turns 2 vs 3, sideboard ignored, commander counted, non-Commander → null, ranges;
    property tests that adding a line never lowers the floor and that `fitsTarget` agrees with
    re-estimating; `bracketWarning` null exactly when within target.
  - `deck.test.ts`: `checkTargetBracket` (0, 6, 2.5, null, non-Commander).
- **Use cases (fakes):** `setTargetBracket` (owner only, errors); changing format clears it.
- **Gateway:** the Scryfall mapper reads `game_changer` (a fixture card gets the field).
- **Integration (`test:int`):** the sync stores both columns; `is:gamechanger` in SQL; the
  `target_bracket` checks; suggestions with target 2 contain no Game Changer; `get_deck` and
  `update_deck` round-trip the target.
- **E2E:** in a Commander deck, set target 2, add a Game Changer: the panel changes 1–2 → 3 and
  the warning appears; suggestions say they're hiding cards. Screenshots in **dark mode and at
  phone width**.

## 13. Decisions (review, 2026-11-10)

1. **Shown in all three places**: the builder, LLM tools (`get_deck`) and search keywords.
2. **Blood Moon and Back to Basics count as land denial**, with the Armageddon and Winter Orb
   families.
3. **Two-card combos are "not checked"** for now; detecting them is a later feature.
4. **Three or more extra-turn cards count as chaining** (floor above bracket 3).
5. **Decks get an optional saved target bracket**, with warnings and target-aware suggestions,
   in this phase (section 3.3).

## 14. Answers to the last questions (2026-11-10)

1. Three or more extra-turn cards force bracket 4: bracket 3 bans chaining.
2. A target bracket is Commander-only: refused on other formats and cleared on a format change.

## 15. Implementation notes (2026-11-10)

Where the build differs from the sections above, and why.

1. **Game Changers aren't in `bracket_flags`.** Stored features are only rewritten when
   `CARD_FEATURES_VERSION` changes (ADR 0019), but Wizards changes the Game Changer list on its
   own schedule. So `is_game_changer` is its own column, rewritten by **every** Scryfall pass,
   and `bracket_flags` holds only the text flags (`landDenial`, `extraTurn`). Code works out a
   card's full flags with `bracketFlags({ ...text facts, isGameChanger })`; the tag pass stores
   `textBracketFlags`. `CARD_FEATURES_VERSION` is 2.
2. **No `setTargetBracket` use case.** The target is one more field of the existing
   `updateDeck` (`targetBracket?: number | null`), which already owns format changes, so
   "leaving Commander clears it" happens in the same transaction. Its errors gained
   `TargetBracketInvalid` and `TargetBracketNotCommander`.
3. **`fitsTarget` judges only the rules the card itself trips** (invariant 10, refined). The
   first version re-estimated the whole deck, so once a deck was over its target every flagged
   card was left out: with a Game Changer too many in a bracket-2 deck, extra-turn cards (fine
   in bracket 2) were hidden too. Now a card fits when each rule it adds to still allows the
   target. Property tests check that it agrees with re-estimating whenever the deck is within its
   target, and that a card it accepts never raises the floor above `max(floor, target)`.
4. **`search_for_deck` filters in SQL, the other suggestions in TypeScript.** Suggestions score a
   candidate pool, so they filter after SQL with `fitsTarget` and count what they hid
   (`hiddenOverTarget`: left-out cards that would have scored). Searches have a `LIMIT`, so
   filtering afterwards would leave queries short; they turn `flagsOverTarget` (one flag at a
   time, which point 3 makes exact) into `not p.is_game_changer` / `not (p.bracket_flags && …)`
   and report `leftOutOverTarget`.
5. **`update_deck` clears the target with 0, not null.** The tool registry keeps input schemas
   free of unions for small models (design doc 28, rule 9), and `nullable()` is a union.
6. **The search keywords run in SQL only.** There's no browser-side search matcher (section 5.5
   said "both"); the grid, store and `search_for_deck` all search in SQL.
7. **The warning is said once in full.** The problems list carries the full sentence; the bracket
   panel says "Over your target (bracket 2)" and colours the reasons that cause it, so a phone
   doesn't show the same paragraph twice. On a shared deck it says "its target".
8. **Test data.** The recorded fixtures (real Bloomburrow cards) hold no Game Changer and leave
   the field out, so tests mark cards in setup instead of changing the fixtures: the integration
   tests for a while, and the e2e global setup for Banishing Light and Builder's Talent.
