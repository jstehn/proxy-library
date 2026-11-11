# Design: Commanders I can build

- **Phase:** 36 (tududi task 45, project "Build decks from owned cards"; the first version of
  backlog task 109, "Rank the commanders I own")
- **Status:** **Approved** (2026-11-11, with the proposals in section 13)
- **Related:** design doc 09 (decks, commander rules: `canBeCommander`), design doc 19 (role tags
  and targets), design doc 20 (suggestions: deck profile, `deckFit`, owned pool first), design
  doc 28 (LLM tools), design doc 31 (brackets), design doc 32 (ideas, not verdicts), design doc
  35 (mana base: land target, decks share cards). No new ADR: a pure ranking function and read
  queries follow existing decisions.
- **Lesson:** no (proposal; see question 6).

## 1. Purpose & scope

You own a pile of legends and want to know which one your collection could already build a deck
around. This phase ranks **commanders by how much of a Commander deck your owned cards already
cover**, using only your collection and the catalog (no outside data):

1. **Candidates.** Every card you own that can lead a deck (`canBeCommander`: a legendary
   creature, a legendary Vehicle or Spacecraft with power and toughness, or "can be your
   commander") and is legal as a commander. Optionally, legends you don't own from the store,
   with their price (question 2).
2. **Coverage, per candidate.** From your owned cards inside its color identity:
   - **on-plan cards**: cards that share a theme, a tribe or a keyword with what the commander's
     text leads (the same `deckProfile` and `deckFit` the suggestions use, on a deck that holds
     only the commander);
   - **roles**: ramp, draw, removal and wipes against the Commander targets (10 / 10 / 8 / 3);
   - **spells**: how many of the deck's ~62 non-land slots your cards could fill at all;
   - **lands**: how many on-color non-basic lands you own (basics are free, so this is a note).
3. **What's missing, for one commander** (on request): the roles still short and the cheapest
   store cards that would fill them, plus on-plan store cards for the empty slots, with an
   estimated total.
4. **Start a deck** from a candidate: a new Commander deck named after it, with it as
   commander, opened in the builder (where suggestions, the mana base panel, and later
   `draft_deck`, task 46, fill it).

Every copy you own counts, even ones already in another deck (decks share cards, decided
2026-11-11). Like suggestions and cuts, the ranking comes from simple rules over rules text, so
it's worded as ideas: "commanders your cards could build", most of a deck already owned first,
never "the best commander".

It shows as a page, **Find a commander** (`/decks/commanders`, linked from Decks), and as an LLM
tool **`commanders_i_can_build`**.

**Out of scope:** popularity and win rates (they need outside data: EDHREC has no official API,
cEDH sites have their own terms; they stay in task 109 for a later design), partners and
Backgrounds as a pair (task 74: one commander at a time here; a "Choose a Background" legend is
ranked alone), filling the deck (task 46, `draft_deck`), a bracket filter (the commander's own
Game Changer status is shown, nothing more; question 5), and buying anything.

## 2. Ubiquitous language

| Term          | Meaning in this codebase                                                                     |
| ------------- | -------------------------------------------------------------------------------------------- |
| Candidate     | A card that can lead a Commander deck, owned (or from the store, when asked).                |
| Pool          | Your owned non-land cards that are legal in Commander, one entry per oracle card.            |
| On-color      | Inside the candidate's color identity (a colorless card is on-color for every candidate).    |
| Plan          | What the commander's text leads: themes, tribes and keywords, from `deckProfile`.            |
| On-plan card  | A pool card on-color that shares a theme, tribe or keyword with the plan.                    |
| Role coverage | Per targeted role, `min(on-color pool cards with that role, target)`; summed out of 31.      |
| Spell slots   | 62: a 99-card deck minus the usual 37 lands (design doc 35's base land count).               |
| Filled slots  | `min(62, on-color pool cards)`: how many spell slots your cards could fill at all.           |
| Coverage      | The four numbers above for one candidate, plus the score that orders the list (section 3.1). |

## 3. Domain model

```ts
// decks/domain/commanders.ts (pure)

/** An owned card the coverage counts (one per oracle card). */
export type PoolCard = CandidateCard & Readonly<{ colorIdentity: readonly ManaColor[] }>;

/** A card that could lead the deck. */
export type CommanderCandidate = Readonly<{
  oracleId: string;
  name: string;
  typeLine: string;
  text: string;
  colorIdentity: readonly ManaColor[];
  keywords: readonly string[];
  isGameChanger: boolean;
  /** Copies you own (0 for a store legend). */
  ownedCopies: number;
  /** Store price of its cheapest printing, for a legend you don't own; otherwise null. */
  priceCents: number | null;
  /** Your decks that already have it as commander: a note, never a reason to leave it out. */
  leads: readonly string[];
}>;

export type RoleCoverage = Readonly<{ tag: TargetedTag; have: number; target: number }>;

export type CommanderCoverage = Readonly<{
  commander: CommanderCandidate;
  plan: Readonly<{
    themes: readonly Theme[];
    tribes: readonly string[];
    keywords: readonly string[];
  }>;
  onPlan: number;
  roles: readonly RoleCoverage[];
  /** Spell slots your on-color cards could fill, out of SPELL_SLOTS. */
  filled: number;
  ownedLands: number;
  score: number;
}>;

export const SPELL_SLOTS = 62;

/** Every candidate's coverage, highest score first (ties: owned first, then by name). */
export function rankCommanders(
  candidates: readonly CommanderCandidate[],
  pool: readonly PoolCard[],
  ownedLands: readonly Readonly<{ colorIdentity: readonly ManaColor[] }>[],
): CommanderCoverage[];

/** One candidate in detail: which of your cards are on-plan or fill each role. */
export function coverageDetails(
  candidate: CommanderCandidate,
  pool: readonly PoolCard[],
): Readonly<{
  coverage: CommanderCoverage;
  onPlan: readonly Scored[]; // best fit first, with deckFit's reasons
  byRole: Readonly<Record<TargetedTag, readonly PoolCard[]>>;
}>;
```

### 3.1 The score

The list needs one order. Plan matters most (a commander whose plan your cards don't support is
just "on-color good stuff"), then roles, then sheer quantity:

```
score = 2 × min(onPlan, 30) + roleCoverage + 0.5 × filled
```

At most 60 + 31 + 31 = 122. The caps stop a huge collection in five colors from winning on bulk
alone: past 30 on-plan cards, more don't raise the score. The page doesn't show the number; it
shows the parts ("18 on-plan · roles 24 of 31 · 41 of 62 spells from your cards"). The weights
live in one `COMMANDER_WEIGHTS` object to tune.

A candidate whose text leads nothing the profile reads (a vanilla legend) has an empty plan and
0 on-plan cards; it still ranks by roles and filled slots, and the page says "no plan read from
its text".

### 3.2 Color identity

Identity checks run once per pool card per candidate, so both sides become a five-bit mask
(`W=1, U=2, B=4, R=8, G=16`): a card is on-color when `card & ~commander === 0`. That keeps
ranking every store legend (about 3,000) against a big collection fast enough to do per request
(question 3).

## 4. Invariants

1. Every candidate can lead a deck (`canBeCommander`) and is legal as a commander in the
   catalog's legalities.
2. Only on-color cards count; a card is never counted for a candidate whose identity it leaves.
3. The commander itself is never in its own pool count.
4. Every copy you own counts, whatever deck it's in; another deck only shows up as a note.
5. `onPlan ≤ filled ≤ SPELL_SLOTS`, each role's `have ≤ target`, and lands never count as spells.
6. Store legends appear only when asked, always with a price, and are marked as not owned.
7. The ranking is deterministic: the same collection gives the same order (ties by owned first,
   then name).
8. Nothing here changes data except **Start a deck**, which only creates a new deck.

## 5. Use cases

| Use case               | Actor / authz | Input                                | Output                 | Errors (`kind`)               | Transaction? |
| ---------------------- | ------------- | ------------------------------------ | ---------------------- | ----------------------------- | ------------ |
| Rank commanders        | player        | colors, include store legends, real? | `CommanderCoverage[]`  | none                          | no (read)    |
| One commander's detail | player        | oracle id, real?                     | details + missing cost | `CardNotFound`                | no (read)    |
| Start a deck           | player        | oracle id                            | new deck id            | `NameInvalid`, `TooManyDecks` | yes          |

Start a deck reuses `createDeck` and `importList` ("Commander\n1 <name>"), as the `create_deck`
tool already does; if the import fails, the empty deck stays and the builder says why.

## 6. Ports

None new. Reads go through `DbExecutor` and `queries/owned.ts` (`ownedCopies`).

## 8. Persistence

No new tables or columns: role tags, themes, keywords, color identity and legalities are stored
on printings already.

## 9. Read models (queries)

`decks/queries/commanders.ts`:

- `commandersICanBuild(db, userId, { colors, includeStore, withReal })`: three SQL queries:
  1. the pool: owned non-land, Commander-legal oracle cards with identity, roles, themes,
     keywords, rarity and price (one row each);
  2. owned non-basic lands' identities;
  3. candidates: owned cards matching `is:commander`'s condition (the SQL mirror of
     `canBeCommander`), plus, when asked, store legends (enabled sets, cheapest printing) you
     don't own; filtered to those whose identity includes every chosen color.

  Then `rankCommanders`. The page shows 25 at a time ("Show more").

- `commanderDetails(db, userId, oracleId, withReal)`: `coverageDetails` for one candidate, plus
  the missing part: for each short role, the cheapest on-color store cards with that role
  (`budgetPicks`-style, by price), then the cheapest on-plan store cards for the slots your
  cards can't fill, with the total. Stated as "about $N for M cards, from the cheapest that
  fit", an estimate, not a shopping list.

**Page: Find a commander** (`/decks/commanders`, a link beside "Cards to get" on Decks):

- Filters: color chips (identity includes these), "Also legends I don't own" (off), "Count my
  real cards" (off, like a new deck).
- One row per candidate: small card image, name, identity symbols, a Game Changer badge if it is
  one, "leads: Tokens, Rabbits, flying" (or "no plan read from its text"), "18 on-plan ·
  roles 24 of 31 · 41 of 62 spells from your cards · 9 lands", roles under target in amber
  ("draw 4 of 10"), "already leads Beza Tokens" when it does, a price for a store legend.
- **See the cards** expands the row: on-plan cards with their reasons, cards per role, and the
  missing-cost estimate (loaded on demand).
- **Start a deck** creates the deck and opens the builder.

**LLM tool `commanders_i_can_build`** (`src/app/_llm-tools/tools/decks.ts`, read scope): input
`{ colors?, includeStore? = false, limit? = 10, commander? }`. Without `commander`, returns the
ranked list (name, identity, plan, onPlan, roles, filled, ownedLands, owned or price, leads).
With `commander` (a name), returns its details: on-plan card names with reasons, cards per
role, and the missing-cost estimate. The description says: these are ideas from simple rules,
present a few to the player and let them choose; then `create_deck` with the commander and
build with the usual recipe. The server instructions' building recipe gets a first step: "no
commander yet? `commanders_i_can_build`".

## 11. Patterns applied

- **Functional core:** `rankCommanders` and `coverageDetails` are pure; queries gather rows.
- **Reuse:** the plan is `deckProfile` on a one-card deck, fit is `deckFit`, roles are
  `roleTargets`, the missing cost follows `budgetPicks`: no second definition of "fits".
- **Ideas, not verdicts** (design doc 32): parts shown, never "best".

## 12. Test plan

- Domain unit tests (`commanders.test.ts`): identity masks (colorless fits all, off-color never
  counts); on-plan from a theme, a tribe ("other Elves"), a keyword; role caps; the commander
  excluded from its own pool; the score caps (31 on-plan cards score as 30); vanilla legend has
  an empty plan; ties by owned then name. A fast-check property test for invariants 2, 3, 5, 7.
- Integration test (`commanders.int.test.ts`): a seeded collection with two legends where the
  one with more on-plan cards ranks first; a card in another deck still counts; store legends
  only with `includeStore`; details' missing cost uses store cards only.
- LLM tool test: both shapes (list, one commander).
- E2E: open Find a commander, see the fixture legend with its counts, Start a deck, land in the
  builder with it as commander. Checked in dark mode and at phone width.

## 13. Open questions

1. **The score** (section 3.1): 2 × on-plan (capped at 30) + role coverage + 0.5 × filled.
   Proposal as written; tune later.
2. **Store legends:** offered behind "Also legends I don't own" (proposal), or owned only?
3. **Speed:** rank everything per request (proposal; the bit masks keep it cheap), or cache per
   player. I'll measure with all store legends against a 5,000-card pool before deciding.
4. **Missing cost** only in the details, for one commander at a time (proposal), or for every
   row (one store query per candidate: slower)?
5. **Bracket:** only a badge on Game Changer commanders now (proposal); a bracket filter on the
   pool could come later.
6. **Lesson:** no (proposal). A short one on bit masks for sets of colors (`&`, `|`, `~`) would
   fit if you'd like one.
7. **Order:** the agreed order had `draft_deck` (46) before this; this one doesn't depend on it,
   so doing it first only changes the order. `draft_deck` becomes design doc 37.
