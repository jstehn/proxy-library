# P15. One opening-hand engine, one mana-payment engine, one `ManaColor`

- **Branch:** `refactor/P15-opening-hands` · **Depends on:** P12, P13, P14 (the mana and tag features it reads) · **Parallel with:** P27 (P28 needs this package)
- **Audit:** doc 65 D3; [plan review](../reviews/plan-review/README.md) report [4](../reviews/plan-review/4-domain-engines.md)
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S4](../dedup-playbook.md#s4)
- **Lines:** −650 to −1,150 (the plan's figure). **Recount first:** P24 already deleted the mulligan trainer, the interactive goldfish and `sim-pipeline.ts`, which were two of the four opening-hand engines and one of the three payment engines. Expect the lower end; state the real number and why in the handoff.

> **Changed by the plan review.** The package now also merges the **mana-payment engines** and the
> two `ManaColor` types (report 4, findings 3 and 4). Opening hands and payment are the same
> question seen twice: "can this hand pay for that spell?".

## Goal

Dealing, the London mulligan, bottoming and the keep rule are written once. Paying a mana cost,
parsing a cost and the `ManaColor` type are also written once. The test hand, the odds simulator
(`simulateOpeningHands`), the cast-on-curve simulator (`simulateCastOnCurve`), `draw_sample` and
the scorecard all use them.

## Deletes

Verify each with `grep -n` first (the line numbers are from `cc8f0f7`).

| What                                                                                                                                                                                                                                                                                                                                                                               | Where                                                                                           | Lines        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------ |
| The copies of `isEarlyPlay` and `isEarlyRamp` (copied word for word)                                                                                                                                                                                                                                                                                                               | `decks/domain/{draws,goldfish}.ts` (and `EARLY_RAMP_MAX_MV` in `draws.ts`)                      | −30 to −60   |
| The second and third "keepable" and "bottom" implementations                                                                                                                                                                                                                                                                                                                       | `decks/domain/{goldfish,draws}.ts`, and `decks/application/draw-sample.ts` (`MustCastByOption`) | −150 to −300 |
| The duplicated London-mulligan dealing in `simulateOpeningHands` and the test-hand path                                                                                                                                                                                                                                                                                            | `decks/domain/goldfish.ts` (336 lines), `app/decks/[id]/builder/test-hand/test-hand-panel.tsx`  | −100 to −200 |
| `creatureTypes` (exists twice with different rules: `decks/domain/suggest.ts:122` and another copy; keep one)                                                                                                                                                                                                                                                                      | `suggest.ts` and the other file                                                                 | −20 to −40   |
| **Payment engines:** `spendMana`/`addMana` in `mana.ts` (lines 82–139), `canPayColors` in `goldfish.ts`, and the payment loop in `castability.ts` (343 lines). Keep one.                                                                                                                                                                                                           | those three files                                                                               | −150 to −300 |
| **Cost parsers:** `parseManaCost` (`mana.ts:31`), `manaSymbols` (`shared/card-search/parse.ts:679`), `mana-symbols.ts` (164 lines), and the printed-cost parts of `castability.ts`. Keep one parser for printed costs (and `{X}`). (`parseManaNeededValue` in `catalog/infrastructure/spellbook-gateway.ts` reads Commander Spellbook's text: leave it unless it is a plain copy.) |                                                                                                 | −100 to −200 |
| **The second `ManaColor`** in `decks/domain/mana.ts:6` (`"W"                                                                                                                                                                                                                                                                                                                       | "U"                                                                                             | "B"          | "R" | "G" | "C"`, with colourless) against the kernel's `ManaColor` (`shared/kernel/colors.ts:6`, derived from `COLORS`). One type; the "colourless-too" case becomes a named union (`ManaColor | "C"`as`ManaSymbolColor`, say) in the kernel. | `mana.ts`, 20+ importers | −10 to −30 |
| `goldfish-types.ts` leftovers and the `mana.ts` exports that nothing uses after the merge                                                                                                                                                                                                                                                                                          | `decks/domain/`                                                                                 | −30 to −60   |

## Touches

`src/modules/decks/domain/{draws,goldfish,goldfish-types,mana,mana-symbols,castability,mana-base}.ts`,
new `decks/domain/opening-hand/` (deal, mulligan, bottom, keep) and `decks/domain/mana-payment.ts`,
`src/shared/kernel/colors.ts`, `src/shared/card-search/parse.ts` (only `manaSymbols`),
`app/decks/[id]/builder/test-hand/*`, the `draw_sample` binding and `decks/application/draw-sample.ts`,
`decks/queries/{audit,mana-base}.ts`. **Avoid** `rate.ts`, `suggest.ts` scoring (P27) and the
effect registry (P28).

## Steps

1. **Write the characterization test first:** the same seeded decks and `Rng` through every
   remaining engine (`simulateOpeningHands`, `simulateCastOnCurve`, the test-hand deal). Record where
   they differ (keep rules, bottoming choices, early-play definitions, colour payment with hybrid,
   phyrexian and `{X}`). Keep this table in the handoff.
2. **Build `opening-hand/`:** `deal(library, rng)`, `mulligan(state, rng)`, `bottom(state, cards)`,
   `chooseBottom(hand, policy)`, and `KeepPolicy` as a strategy (`{ minLands, maxLands,
requireEarlyPlay }` plus named presets). Define `isEarlyPlay` and `isEarlyRamp` once.
3. **Move each engine onto it, one commit per engine, and delete its old copy in the same commit.**
   The "recommended" and the simulator's "keepable" become the same `KeepPolicy` call.
4. **Build one `mana-payment.ts`:** `parseCost` (one parser), `canPay(pool, cost)` and
   `pay(pool, cost)` with hybrid, phyrexian, generic and `{X}`. Move `castability`, `goldfish` and
   `mana-base` onto it; delete the other payment loops and parsers **in the same commits.**
5. **One `ManaColor`.** Replace the type in `mana.ts`; fix the importers (`grep -rn "ManaColor"
src`). Delete the old definition.
6. `pnpm check`, `pnpm test:int`, `pnpm sizes --update`. Compare the characterization table: every
   difference now is intended and listed.

## What not to do

- Don't build the effect registry here (P28).
- Don't keep an engine "for the test hand". The UI calls the same functions.
- Don't change the keep rules silently: choose the best one, list what changed, and ask the owner
  if two rules truly conflict.

## Done when

- `grep -rn "function isEarlyPlay\|function isEarlyRamp\|function isKeepable\|function bottomCards" src`
  finds one of each, in `opening-hand/`.
- `grep -rn "function parseManaCost\|function spendMana\|function canPayColors" src` finds at most
  one payment and one parser, in `mana-payment.ts`. `grep -rn "type ManaColor" src` finds one.
- `goldfish-session.ts` and `sim-pipeline.ts` don't exist (P24); no engine file is over 500 lines.
- `pnpm check` and `pnpm test:int` are green. The handoff has the real net lines and the table
  of deliberate differences.

## Handoff

**Branch** `refactor/P15-opening-hands`; commits: the pin test, then the two engines.
**Package net: -77 production lines** (75,422 to 75,345; the plan's -650 to -1,150 was written before
P24 deleted the trainer, the interactive goldfish and `sim-pipeline.ts`, which were two of four hand
engines and one of three payment engines, and before P12 to P14 removed `spendMana`/`addMana`).

- **Hand engine** `decks/domain/opening-hand/{library,hand}.ts`: `playOpening(cards, rng, rule)` deals,
  mulligans, bottoms by `KeepPolicy` (`COMMANDER_KEEP`) and returns the kept `Opening` (`hand`, `library`
  top first, `mulligans`, `keptClean`); `drawsByTurn(turn, onTheDraw)` says how many of `library` are drawn by a
  turn. The test hand uses the same `dealHand`, `bottomCard`, `drawCard` (`nextHand` is the reducer). One
  `isEarlyPlay`/`isEarlyRamp`/`isKeepable`/`chooseBottom`. `draws.ts` keeps only the exact odds.
- **Payment engine** `decks/domain/mana-payment.ts`: `parseCost` (built on `costSymbols`),
  `firstUnpaidPip`/`canPay` (bipartite matching). Deleted: `mana.ts` (with its `ManaColor`, pool, parser),
  goldfish's `canPayColors`, castability's `missingPip`/`buildPipOptions`, draw-sample's own shuffle,
  the `colorPips` regex in `stats.ts`.
- **Pinned** (`application/engines-pinned.test.ts`, seeded snapshots recorded before the change): scorecard
  hand run, other keep rules, mustCastBy x4, odds table, cast on curve, test-hand sequence, `draw_sample` x3.
  **All still match: no difference on the reference deck.**
- **Differences by design (not visible on the reference deck; owner to decide):**
  1. A commander's cost is now `parseCost(...).pips` (hybrid pays with either colour, `{C}` needs a colourless
     source) instead of `colorPips` (a hybrid pip counted for both colours, `{C}` ignored).
  2. Castability: an unpayable `{C}` pip used to count as cast; now it counts as not cast (no bottleneck colour).
  3. Castability: pips are matched exactly (augmenting paths) instead of greedily, so a spell the greedy loop
     wrongly failed can now count.
  4. `SimulateHandsOptions`: `policy?: KeepPolicy` replaces `minLands/maxLands/requireEarlyPlay`; the 0..7 clamps
     went (no caller could reach them).
  5. A bottomed card now goes to the bottom of the library (it was dropped from it); matters only if a run
     draws the whole library.
  6. `openingHandOdds` early ramp: a card without a mana value no longer counts as early (it did, as 0).
  7. `colorPips` (stats) no longer counts the half-mana symbols `{HW}`/`{HR}`.
- **Not done, and why:** `creatureTypes` (drafts and decks, different rules: Kindred) stays twice, because
  decks' copy is in `suggest.ts` (P27's file); a kernel copy plus both deletions is a follow-up after P27.
  `manaSymbols` in `card-search/parse.ts` reads a search query for SQL, not a printed cost: left.
  `simulateCastOnCurve` keeps its own partial shuffle (no mulligan): moving it to `shuffled` would change
  every seeded number; P28 rebuilds it on `playOpening`. `canCastByTurn` (goldfish) and
  `simulateCastOnCurve` remain two simulators for P28 to merge.
- **Integration files run** (private DB `tcg_p15_test`, dropped): llm-tools, mana-base, decks: green.
