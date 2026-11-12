# Design: Opening-hand odds (land drops, ramp by turn 3)

- **Phase:** 43 (tududi task `#51`, project "Build decks from owned cards")
- **Status:** **Approved** (2026-11-11 — continuing Project #11 roadmap per user confirmation)
- **Related:** design doc 19 (statistics, roles, test hand & `deckOdds`), design doc 28 (LLM tool API), design doc 35 (mana base planner)
- **Lesson:** no (pure exact hypergeometric & joint bivariate hypergeometric probability math on top of existing `draws.ts`)

## 1. Purpose & scope

`src/modules/decks/domain/draws.ts` already implements `logFactorials`, `hypergeometricAtLeast`, `cardsSeen`, and `deckOdds` for the `TestHandPanel`. However:

1. **No turn-3 ramp accuracy or joint land+ramp odds.** `deckOdds` checks `"A ramp card by turn 2"` across _all_ cards tagged `"ramp"` regardless of mana value (counting a 5-mana ramp spell the same as _Sol Ring_ or _Arcane Signet_), and it cannot answer whether you have both the lands to cast early ramp and the ramp spell by turn 3.
2. **Limited land-drop & mulligan visibility.** The main deck statistics sidebar does not surface opening-hand consistency at a glance, and only turns 3 and 4 are shown in `TestHandPanel` (no turn 1–5 curve, no flood vs. screw split, no 1-mulligan keep odds).
3. **No MCP tool exposure.** Neither `get_deck` nor a dedicated `opening_hand_odds` tool exposes hypergeometric draw probabilities to LLM deck-building assistants.

**Out of scope:** Monte Carlo simulation in production tools (all probabilities here are exact closed-form hypergeometric sums), tapped-land / color-pip sequencing simulation, or opening-hand keep/mulligan heuristics for specific card combinations beyond role/`cardNames` counts.

## 2. Ubiquitous language

| Term                  | Meaning in this codebase                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Early ramp            | A non-land main-deck card tagged `"ramp"` with `manaValue <= 3` (`EARLY_RAMP_MAX_MV`).                      |
| Playable opening hand | An opening 7-card hand containing 2–5 lands (`0–1` = too few / screw; `6–7` = too many / flood).            |
| Land drop on curve    | Drawing at least `t` lands in `cardsSeen(t, onTheDraw)` cards (`7` on turn 1 play; `+1` per draw step).     |
| Joint turn-3 ramp     | Exact bivariate hypergeometric probability of drawing `>= 2` (or `>= 3`) lands AND `>= 1` early ramp by T3. |

## 3. Domain model & pure functions (`src/modules/decks/domain/draws.ts`)

Extend `DrawLine` and `LibraryCard` with optional `manaValue?: number` (defaults to `0` when omitted so minimal test fixtures treat ramp without explicit MV cleanly, while real `DeckLine` entries pass their exact `manaValue`):

```ts
export const EARLY_RAMP_MAX_MV = 3;

export type DrawLine = Readonly<{
  oracleId: string;
  name: string;
  printingId: string;
  board: Board;
  quantity: number;
  typeLine: string;
  manaValue?: number;
  text?: string;
  producedMana?: readonly string[];
}>;

export type LibraryCard = Readonly<{
  key: string;
  oracleId: string;
  name: string;
  printingId: string;
  isLand: boolean;
  manaValue?: number;
  tags: readonly Tag[];
}>;

export type LandDropOdds = Readonly<{
  turn: 1 | 2 | 3 | 4 | 5;
  cardsSeen: number;
  targetLands: number;
  chance: number;
}>;

export type OpeningHandOdds = Readonly<{
  librarySize: number;
  lands: number;
  ramp: number;
  earlyRamp: number;
  onTheDraw: boolean;
  freeMulligan: boolean;
  opening: Readonly<{
    tooFewLands: number;
    playableLands: number;
    tooManyLands: number;
    atLeastOneEarlyRamp: number;
    playableAfterFirstMulligan: number;
  }>;
  landDrops: readonly LandDropOdds[];
  rampByTurn3: Readonly<{
    cardsSeen: number;
    atLeastOneEarlyRamp: number;
    atLeastOneAnyRamp: number;
    twoLandsAndEarlyRamp: number;
    threeLandsAndEarlyRamp: number;
  }>;
  roles: readonly OddsRow[];
}>;

/** Exact multivariate hypergeometric probability for two disjoint groups (groupA + groupB <= population). */
export function hypergeometricAtLeast2Groups(
  population: number,
  groupA: number,
  groupB: number,
  draws: number,
  minA: number,
  minB: number,
): number;

/** Probability of seeing at least `atLeast` of `successes` copies by `turn` (`>= 1`). */
export function chanceByTurn(
  population: number,
  successes: number,
  turn: number,
  onTheDraw: boolean,
  atLeast?: number,
): number;

/** Full opening-hand, land-drop (T1–T5), turn-3 ramp, and role odds; null if library is empty. */
export function openingHandOdds(
  cards: readonly LibraryCard[],
  options?: Readonly<{ onTheDraw?: boolean; freeMulligan?: boolean }>,
): OpeningHandOdds | null;
```

Key calculation details:

- `tooFewLands + playableLands + tooManyLands` sums strictly to `1` across the opening 7 cards (clamped to `[0, 1]`):
  - `playableLands = atLeast(lands, 7, 2) - atLeast(lands, 7, 6)`
  - `tooManyLands = atLeast(lands, 7, 6)`
  - `tooFewLands = Math.max(0, 1 - atLeast(lands, 7, 2))`
- In London mulligans, a player sees 7 cards on their first mulligan whether free or to 6, so seeing 2–5 lands at least once across initial hand or first mulligan is `1 - (1 - playableLands) ** 2`.
- `twoLandsAndEarlyRamp` and `threeLandsAndEarlyRamp` use `hypergeometricAtLeast2Groups` with disjoint groups `lands` (`card.isLand`) and `earlyRamp` (`!card.isLand && tags.includes("ramp") && (manaValue ?? 0) <= EARLY_RAMP_MAX_MV`).
- `deckOdds(cards, onTheDraw)` remains exported and preserves existing behavior (`2–5 lands`, `3 lands by turn 3`, `4 lands by turn 4`, ramp/draw/removal role rows).

## 4. Invariants

1. **Partition unity:** `tooFewLands + playableLands + tooManyLands === 1` within floating-point tolerance (`1e-9`) for every non-empty library.
2. **Range & monotonicity:** All probabilities lie in `[0, 1]`. `playableAfterFirstMulligan >= playableLands`. Going on the draw (`onTheDraw: true`) is `>=` going first for every draw-dependent metric, and `twoLandsAndEarlyRamp <= Math.min(landDrops[1].chance, atLeastOneEarlyRamp)`.
3. **Disjoint joint group guard:** `hypergeometricAtLeast2Groups` returns `0` cleanly when impossible (`minA + minB > draws`, `groupA < minA`, `groupB < minB`) and never overflows `logFactorials`.
4. **Main-deck scope:** `library(lines)` counts only `board === "main"` (commanders start in the command zone; sideboard and maybeboard stay out of the library).

## 5. Web UI & MCP tools

### 5.1 Web UI (`TestHandPanel` & `StatsPanel`)

- **`StatsPanel` (`src/app/decks/[id]/builder/stats-panel.tsx`):**
  - Renders a compact **Opening-hand odds (play)** summary section from `library(props.lines)` (showing `2–5 lands in opening 7`, `3+ lands by turn 3`, `4+ lands by turn 4`, and `Early ramp (MV ≤ 3) by turn 3` with `with 2+ lands` note), updated live in both the deck builder and `SharedDeckView`.
- **`TestHandPanel` (`src/app/decks/[id]/builder/test-hand.tsx`):**
  - Replaces the flat `deckOdds` list with the full structured `openingHandOdds` breakdown responding to the `"On the draw"` and `"First mulligan free"` toggles:
    - Opening 7 land split (`0–1` screw / `2–5` keepable + after 1 mulligan / `6–7` flood)
    - Land drops on curve (Turn 1 through Turn 5)
    - Ramp by turn 3 (`MV ≤ 3` count, `>= 1 early ramp by T3`, `2+ lands & early ramp by T3`, plus any-MV ramp if higher-cost ramp exists)
    - Role odds (`Card draw by turn 4`, `Removal by turn 4`)

### 5.2 MCP tools (`src/app/_llm-tools/tools/decks.ts`, `registry.ts`)

1. **`get_deck`**:
   - Adds a compact `openingHandOdds` field (`librarySize`, `lands`, `earlyRamp`, `playableLandsInOpening7`, `playableAfterFirstMulligan`, `threeLandsByTurn3`, `fourLandsByTurn4`, `rampByTurn3`, `twoLandsAndRampByTurn3`), with percentages expressed cleanly as rounded whole percents (`0–100`) or `null` when the main deck is empty.
2. **`opening_hand_odds`** (`scope: "read"`, `readOnly: true`):
   - Input: `{ deckId, onTheDraw?: boolean, freeMulligan?: boolean, byTurn?: 1..10, tag?: Tag, cardNames?: string[], atLeast?: 1..7 }`.
   - Output: full `openingHandOdds` breakdown (rounded to `0–100%` or 1-decimal percents, e.g. `Math.round(p * 1000) / 10`), counts (`lands`, `ramp`, `earlyRamp`, `librarySize`), and when `tag` or `cardNames` is provided, a `customQuery` object with `matchingCopies` and `chanceByTurn`.

## 6. Test plan

- **Domain unit & property tests (`src/modules/decks/domain/draws.test.ts`):**
  - `hypergeometricAtLeast2Groups` matches brute-force exact counting on small decks and satisfies `0 <= P <= 1` + joint upper-bound invariants across `fast-check` generated decks.
  - `openingHandOdds` correctly filters `earlyRamp` by `manaValue <= 3`, verifies `tooFewLands + playableLands + tooManyLands` sums to 1, checks `onTheDraw` monotonicity, and checks `playableAfterFirstMulligan >= playableLands`.
  - `chanceByTurn` edge cases (`turn = 1`, `atLeast = 0`, impossible targets).
- **MCP integration & registry tests (`src/app/_llm-tools/registry.test.ts`, `llm-tools.int.test.ts`):**
  - `opening_hand_odds` registered with `scope: "read"` and passes simple-schema check.
  - End-to-end call to `get_deck` and `opening_hand_odds` (including `onTheDraw: true`, `tag: "ramp"`, and `cardNames: [...]`) against a test deck.
