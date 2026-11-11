# Design: Mana base

- **Phase:** 35 (tududi task 49, first feature of project "Build decks from owned cards", which
  came from backlog task 41)
- **Status:** **Approved** (2026-11-11, with the proposals in section 13; ownership is shared
  between decks, question 3)
- **Related:** design doc 09 (decks, problems, basic lands need no copies), design doc 19 (role
  tags and targets), design doc 20 (suggestions: owned pool first, then store), design doc 28
  (LLM tools, land cycles in the search language, section 3.6), design doc 31 (brackets), design
  doc 32 (ideas, not verdicts). No new ADR: a pure planning function and a read query follow
  existing decisions.
- **Lesson:** no (a greedy fill over immutable data; no new TypeScript concept). See question 5.

## 1. Purpose & scope

The builder says "Lands 31 (aim ~37)" and shows symbols against sources per color, but it can't
say _which_ lands to play. This phase adds a **mana base plan** for a deck:

1. **Targets.** A land count for this deck (37 adjusted for its curve and its other mana
   sources, each adjustment with its reason) and a number of sources to aim for in each of its
   colors (from its colored symbols, with more for cards with two or three of a color in their
   cost).
2. **A fill from owned lands.** Lands to add to reach the targets: your non-basic lands first
   (any copy you own: decks share cards), picked one at a time for the color the deck is shortest
   on, untapped lands before tapped ones, plus owned utility lands that match the deck's roles
   or themes; basics make up the rest, split by what each color still needs.
3. **Lands to consider buying.** Up to five store lands that would close the biggest color gaps,
   with their prices. Never added by the fill.

It shows in the builder as a **Mana base** panel (targets, what the deck has, the proposed lands,
an **Add these lands** button), and as an LLM tool **`plan_mana_base`**. Like suggestions and
cuts (design doc 32), the plan comes from simple rules, so it's worded as an idea: "a mana base
you could start from".

`draft_deck` (task 46) will call the same pure function after it picks the spells, so the plan
has to work for a deck with no lands at all.

**Out of scope:** cutting lands (the plan reports "3 lands over target" and the player decides;
cuts stay non-land, design doc 32), fetch-land shuffling maths and "fetchable" source counting
(a fetch land counts as a source of each color it can find, nothing more), MDFC spell/land
backs counting as half a land, 60-card formats beyond using their land count (task 52),
opening-hand odds (task 51), and buying anything.

## 2. Ubiquitous language

| Term           | Meaning in this codebase                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- |
| Land target    | How many lands the plan aims for: the format's usual count, adjusted, with reasons.       |
| Source         | A card in play (land or not) that can make a color: Scryfall's `produced_mana`.           |
| Source target  | How many sources of one color the plan aims for.                                          |
| Color gap      | Source target minus the sources the deck has, for one color (never below 0).              |
| Owned copies   | Copies you own. Decks share them: a card in another deck is still yours to use here.      |
| Utility land   | A land whose role tags or themes match the deck's (a land that draws, a sacrifice land).  |
| Tapped land    | A land whose text says it enters tapped; "unless …" makes it _sometimes_ tapped.          |
| Mana base plan | Targets, the deck's current counts, the lands to add, and store lands to consider buying. |

## 3. Domain model

```ts
// decks/domain/mana-base.ts (pure)

/** A land the plan may add: owned or from the store. */
export type LandCandidate = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  text: string;
  /** Colors it can make: "W", "U", "B", "R", "G", "C". */
  producedMana: readonly string[];
  isBasicLand: boolean;
  /** Copies you own (other decks may use them too); basics are unlimited and don't need this. */
  ownedCopies: number;
  /** Your other decks that play it too: shown as a note, never a limit. */
  alsoIn: readonly string[];
  /** Store price of one copy, in cents (store candidates only). */
  priceCents: number | null;
  roles: readonly Tag[];
  themes: readonly Theme[];
}>;

export type Tapped = "never" | "sometimes" | "always";

/** Why the land target moved away from the format's usual count. */
export type LandTargetReason =
  | { kind: "base"; lands: number } // "37 is the usual count for Commander"
  | { kind: "lowCurve"; averageManaValue: number; change: number } // −1
  | { kind: "highCurve"; averageManaValue: number; change: number } // +1 or +2
  | { kind: "manyManaSources"; sources: number; change: number }; // −1 per 3 rocks/dorks past 9

export type LandTarget = Readonly<{ lands: number; reasons: readonly LandTargetReason[] }>;

export type SourceTarget = Readonly<{
  color: ManaColor;
  target: number;
  have: number;
  /** The most symbols of this color in one card's cost (1, 2, or 3 and more). */
  heaviestCost: number;
}>;

/** Why a land was picked. */
export type LandReason =
  | { kind: "fixes"; colors: readonly ManaColor[] } // "makes U and B, both short"
  | { kind: "untapped" }
  | { kind: "utility"; roles: readonly Tag[]; themes: readonly Theme[] }
  | { kind: "basic"; color: ManaColor | "C" };

export type PlannedLand = Readonly<{
  card: LandCandidate;
  quantity: number;
  tapped: Tapped;
  reasons: readonly LandReason[];
}>;

export type ManaBasePlan = Readonly<{
  landTarget: LandTarget;
  lands: number; // lands the deck has now
  sources: readonly SourceTarget[]; // one per color in the deck's identity that its spells use
  add: readonly PlannedLand[]; // owned non-basics first, then basics
  over: number; // lands over target (nothing is added then)
  considerBuying: readonly PlannedLand[]; // up to 5 store lands, never in `add`
}>;

export type ManaBaseInput = Readonly<{
  format: Format;
  lines: readonly ProfileLine[]; // the deck (counted boards only matter)
  inDeck: ReadonlyMap<string, number>; // copies of each oracle card the deck already plays
  owned: readonly LandCandidate[]; // lands you own the deck may play (identity, bracket)
  basics: readonly LandCandidate[]; // the six basics, Wastes included
  store: readonly LandCandidate[];
  deckRoles: readonly Tag[]; // roles the deck is short on (deckProfile gaps)
  deckThemes: readonly Theme[];
}>;

export function landTarget(format: Format, stats: DeckStats): LandTarget;
export function sourceTargets(
  lines: readonly ProfileLine[],
  target: LandTarget,
  identity: readonly ManaColor[],
): SourceTarget[];
export function tapped(text: string): Tapped;
export function planManaBase(input: ManaBaseInput): ManaBasePlan;
```

### 3.1 Land target

Start at `suggestedLands(format)` (37 / 24 / 17) and adjust, Commander and 60-card alike:

| Rule                                              | Change                    |
| ------------------------------------------------- | ------------------------- |
| Average mana value of non-land cards below 2.5    | −1                        |
| Average mana value 3.5 or more / 4.0 or more      | +1 / +2                   |
| Non-land mana sources (rocks, dorks, ramp) past 9 | −1 for each 3, at most −3 |
| Never below `base − 4` or above `base + 3`        | clamp                     |

The curve moves nothing until the deck has 20 non-land cards: a commander and a few spells say
too little about it (found building step 4). Limited (40 cards) only uses the base 17: draft decks have few rocks and a known curve. The
adjustments are a rule of thumb in the spirit of Frank Karsten's land-count regression, not that
formula (question 1).

### 3.2 Source targets

For each color the spells use (`colorPips`, counted boards, commander included):

- **Share:** `round(landTarget × pips[color] / all pips)`, so the targets roughly share out the
  lands. Non-land sources count toward `have` too (a Signet makes two colors).
- **Floor by heaviest cost:** a color with a card costing one of it aims for at least 10
  sources (Commander) / 8 (60-card); two of it ({U}{U}) at least 15 / 12; three or more at
  least 19 / 15. A floor can push the total past the land count; dual lands are how a deck
  meets both.
- A colorless commander (or no colored symbols) has no source targets: basics are Wastes, or the
  plan adds only colorless utility lands and says so.

### 3.3 The fill (greedy, one land at a time)

While the deck has fewer lands than its target:

1. Score every owned non-basic candidate with an owned copy the deck
   doesn't use yet: `+3` for each short color it
   makes (weighted by how short), `+1` for each other deck color, `+3` if utility for this
   deck, `−2` if always tapped, `−1` if sometimes tapped. A land making no deck color and no
   utility scores nothing and is skipped. Lands that can't be in the deck (outside the identity,
   over the bracket's limits) never are candidates.
2. Take the best (ties: untapped first, then name), lower its copies left and the color gaps,
   and loop. Stop taking non-basics when the best score falls to 2 or less: from there a basic
   does as well.
3. Fill the rest with basics, one at a time, each for the color with the biggest gap (ties:
   most pips). A deck that only needs colorless gets Wastes.

The **store** candidates go through step 1 once, after the fill, against the gaps the owned fill
left, and the top five (by score, then price) are `considerBuying`.

## 4. Invariants

1. The plan never makes the deck go past its land target: `lands + added = max(lands, target)`.
2. A deck at or over its target gets an empty `add` and `over = lands − target`.
3. Every added non-basic is owned, and never more copies than you own; in Commander, one copy.
4. Every planned land may be played in the deck: its color identity is within the commander's
   (Command Tower makes five colors but has none). The query only offers such lands.
5. Store lands are only in `considerBuying`, at most five, and none is also in `add`.
6. Basics in `add` are only of colors with a source target (or Wastes for a colorless deck).
7. Source targets exist only for colors the spells use; each is at least its heaviest-cost floor.
8. The land target stays within `base − 4 … base + 3`, and its reasons add up to it.
9. The plan is deterministic: the same input gives the same plan (ties broken by name).
10. Lands already in the deck are kept and counted; the plan only adds.

## 5. Use cases

| Use case              | Actor / authz | Input          | Output              | Errors (`kind`)                                   | Transaction? |
| --------------------- | ------------- | -------------- | ------------------- | ------------------------------------------------- | ------------ |
| Plan the mana base    | deck owner    | deck id        | `ManaBasePlan` view | `deckNotFound`                                    | no (read)    |
| Add the planned lands | deck owner    | deck id, lands | the deck, updated   | `DeckNotFound`, `CardNotFound`, `QuantityInvalid` | yes          |

Adding is a new use case, `addCards` (built in step 3): one transaction that adds each land's
copies to `main` on top of what the deck has, so a failure adds nothing.

## 6. Ports

None new. The query reads the catalog, the collection and other decks through the existing
`DbExecutor` read models (`queries/owned.ts`, `queries/suggestions.ts` helpers).

## 8. Persistence

No new tables or columns. Tapped-ness comes from the rules text (`tapped()`, the same patterns
as the search language's `ENTERS_TAPPED`), role tags and themes are already stored per printing.

## 9. Read models (queries)

`decks/queries/mana-base.ts`: `manaBasePlan(db, userId, deckId)`:

1. Load the deck view (lines, format, commander identity, target bracket).
2. Owned lands: printings of lands in the identity that you own, with how many copies you own,
   roles, themes and produced mana: one SQL query, about a few hundred rows at most.
3. Store lands: the same filter over store stock, cheapest printing per card, limited to lands
   making two or more deck colors or matching a deck role/theme (at most 200 rows).
4. Call `planManaBase`, and turn the reasons into words for the panel and the tool.

**Builder: Mana base panel** (beside Possible cuts). Shows:

- "Lands: 31 of ~36" with the target's reasons ("37 usual, −1: low curve (2.3)").
- One row per color: sources have / target, and "has a {U}{U} card" when a floor applied.
- The proposed lands (name, quantity, tapped badge, reasons), owned first, then basics, and
  "also in Golgari Value" when another deck plays it too (a note, not a limit).
- **Add these lands** (adds all), and "Lands to consider buying" with prices (links to the
  store).
- When at or over target: "The deck has 39 lands, 2 over the ~37 target" and no button.

**LLM tool `plan_mana_base`** (`src/app/_llm-tools/tools/decks.ts`): input `{ deckId }`;
returns the targets with reasons, sources per color, the lands to add (name, quantity, owned or
basic, tapped, reasons) and the lands to consider buying (name, price). The description says:
apply it with `set_deck_entry` after the player agrees; it only adds lands; it's a starting
point, not the best mana base. The server instructions' building recipe gets one step: "after
the spells, `plan_mana_base`".

## 11. Patterns applied

- **Functional core:** `planManaBase` is pure; the query gathers rows and calls it (as
  `rankCuts` and `deckProfile` do).
- **Read model, no aggregate change:** the plan is a query; adding lands reuses the deck's
  existing command.
- **Ideas, not verdicts** (design doc 32): reasons say what was found, the panel title says
  "a mana base you could start from".

## 12. Test plan

- Domain unit tests (`mana-base.test.ts`): `landTarget` for low, average and high curves and
  for many rocks, with the clamp; `sourceTargets` shares and floors (a {U}{U} card lifts blue to
  15); `tapped` for always / sometimes / never texts; `planManaBase`: fills only to target,
  prefers a two-color land for two short colors, untapped over tapped at equal colors, takes a
  utility land, never exceeds owned copies, uses a land another deck also plays, never adds out-of-identity lands, basics split by
  gaps, colorless deck gets Wastes, store lands only in `considerBuying` (≤5), deterministic
  ties. A property test: for random decks and candidates, invariants 1, 3, 4, 5 and 9 hold.
- Integration test (`mana-base.int.test.ts`): a seeded deck with owned duals, one also in
  another deck, returns both in `add`, the shared one noting the other deck.
- LLM tool test: `plan_mana_base` returns the shape above for a fixture deck.
- E2E: open a Commander deck with 30 lands, open Mana base, Add these lands, see "Lands 37".
  Checked in dark mode and at phone width.

## 13. Open questions

1. **Land target rule.** Proposal: the small table in 3.1 (37 ± a few, with reasons). An
   alternative is the regression often credited to Frank Karsten (lands ≈ 31.42 + 3.13 × average
   mana value − 0.28 × cheap ramp/draw, for 99 cards); secondary sources disagree on its
   coefficients and I couldn't find the original article, so the doc doesn't depend on it.
2. **Source floors** (10 / 15 / 19 for one / two / three symbols in Commander). These are rounded
   from common Commander guidance; they can be tuned later without changing the design.
3. **Which owned copies count?** Decided (2026-11-11): any copy you own. Decks share cards by
   default, so a land in another deck is still offered; the panel only notes where else it's
   played.
4. **Add button:** add all at once (proposal), or a checkbox per land?
5. **Lesson:** no (proposal). If you'd like one, a short lesson on greedy algorithms over
   immutable data (`reduce` vs a loop with local state) would fit.
