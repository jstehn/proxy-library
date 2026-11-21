# P28. "Can I cast X by turn Y?": the simulator, with a small effect registry

- **Branch:** `refactor/P28-cast-by-turn` · **Depends on:** P15, P24 · **Parallel with:** P27
- **Source:** [plan review](../reviews/plan-review/README.md) (P28; owner answer D3), report [4](../reviews/plan-review/4-domain-engines.md)
- **Lines:** −250 to −450. The registry adds some lines; the injected options, the long functions' glue and the second engine's leftovers pay for it.
- **Big feature:** a design note first (step 1).

## Why

**What it's for (owner, tududi comment on this task, 2026-11-20):** a **probability simulator**
for LLMs and tools: "what is the probability that I can cast X by turn Y?", estimated the usual
way, by bootstrapping (many simulated shuffles of the deck, counting how often X is castable by
turn Y). The answer is a probability, not a verdict and not a score.

**A distribution, not one turn (owner, 2026-11-20).** The typical case is a commander like Henzie:
"when can I cast my commander?" Each simulated game records the **first turn** X became castable,
so one set of runs gives the whole curve: the probability of casting X by turn 1, 2, 3 … up to a
limit (say turn 10), plus the median turn. The tool shows that distribution; a single "by turn Y"
question is just one row of it.

The owner answered **D3**: remove the interactive goldfish (P24 did), and **keep the server-side
simulations that answer "can I cast X by turn Y?", with many runs**: the opening-hand and
cast-on-curve simulations behind `draw_sample` and the scorecard. The old plug-in structure existed
for cost reducers and rituals (Dark Ritual, which it doesn't handle today). Keep that extension
point as a **small registry of effects**, and drop the options that only tests inject.

P24 deleted `sim-pipeline.ts` (779 lines), because only the interactive goldfish used it. Its last
commit is named in P24's handoff. Read it for ideas, but write the registry fresh and small.

## Deletes

| What                                                                                                                                                                                                             | Where                                                                                                                                                                                                                                    | Lines        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| The seven injected options only tests use (verify the list: `grep -n "options\.\|Options" src/modules/decks/domain/{goldfish,castability,draws}.ts`; report 4 says seven) and the test scaffolding that fed them | `decks/domain/{goldfish,castability}.ts`                                                                                                                                                                                                 | −150 to −250 |
| The second cost parser and payment loop left after P15 (if P15 left any)                                                                                                                                         | `decks/domain/{castability,mana}.ts`                                                                                                                                                                                                     | −50 to −100  |
| The 100+-line functions' repeated glue, when split into steps (splitting alone doesn't remove lines; count what goes)                                                                                            | `simulateCastOnCurve`, `simulateOpeningHands`, `playtestCard`, `draftDeck` (498 lines, `decks/domain/draft-deck.ts` line 292), `recordDraft`, `applyChoices`, `computeRatingFeatures`, `fitLogisticWeights`, `suggestSwaps`, `scoreDeck` | −50 to −100  |
| Anything knip or `pnpm clones --near` shows is left                                                                                                                                                              |                                                                                                                                                                                                                                          | verify       |

## Touches

`src/modules/decks/domain/{goldfish,castability,mana,draws,draft-deck,playtest-card}.ts`, new
`decks/domain/cast-effects.ts` (the registry), `decks/application/draw-sample.ts`,
`src/app/_llm-tools/bindings/draw-sample.ts`, `decks/queries/{audit,mana-base}.ts`,
`app/d/[token]/scorecard/page.tsx`, a worker or server path for big runs if the design says so.
**Avoid** the scorer (P27) and `rate.ts`.

## Steps

1. **Design note** (short, in `docs/design/` or an ADR addendum):
   - The question the tool answers: **"what is the probability that I can cast card X (or any of
     these) by turn Y, on the play or on the draw?"** It's estimated by bootstrapping: shuffle the
     deck N times (seeded), deal the opening hand (with the deck's mulligan rule), draw a card each
     turn, play a land a turn and use the mana effects in scope, and record **the first turn each
     run could cast X** (or "not by the last turn simulated").
   - **The commander:** a card in the command zone is always available, so for it the question is
     only whether the mana (colours and amount) is there. Include the commander tax for a recast
     only if asked.
   - The answer: the **distribution**: for each turn 1 to the limit, the probability X is
     castable by then (cumulative, for example turn 3: 0.41, turn 4: 0.78, turn 5: 0.92), the
     **median turn**, the **number of runs**, a **margin of error** (for example a 95% interval: with
     2,000 runs about ±2 points), and the most common reasons a run failed (no source of a colour, too few lands, X not drawn). Where an exact answer
     exists (just "have I drawn X by turn Y", or a land count), check the simulation against the
     hypergeometric formula `draws.ts` already has, in a test.
   - Where runs happen: **server-side**, with an injected `Rng` and `Clock`. Pick the run count
     (for example 2,000) and a time budget; say how a long run is kept off the request thread
     (chunk it, or run it in the worker) if it needs to be.
   - The registry: `CAST_EFFECTS`, a `Record<kind, effect>` with a small interface (an effect
     changes a cost, adds mana when a spell resolves, or makes mana from a card on the
     battlefield). Name the effects in scope: cost reducers (for example "spells cost {1} less"),
     rituals (Dark Ritual: pay {B}, add {B}{B}{B}), and taps-for-mana. **Dark Ritual is the test
     case.** Cards map to effects by a small lookup (later P11's features can fill it).
2. **Pin today's results** for `simulateCastOnCurve` and `simulateOpeningHands` on the reference
   decks with seeded `Rng` as fixtures. After this package they may change only where the
   registry adds an effect; list each difference.
3. **Remove the injected options** (one commit): delete each option, the code path that read it,
   and the tests that needed it. Callers lose the argument.
4. **Add the registry** (one commit): `cast-effects.ts`, the effects in scope, and a unit test per
   effect. The first test is Dark Ritual: with it in hand, a 3-mana spell is castable on turn 1.
   Wire it into `simulateCastOnCurve` and `simulateOpeningHands`, and delete whatever hard-coded
   ramp logic the registry replaces **in the same commit**.
5. **The input and output.** `draw_sample` (and the capability behind it) accepts a card, a list,
   or "my commander", play or draw, and an optional last turn (default 10). It returns the
   cumulative probability for every turn up to that one, the median turn, the run count and the
   margin of error, in a compact table for the model (one short line per turn). A "by turn Y"
   question reads one row. Keep the tool answer compact (owner answer D5: few
   tokens, no scores or ranks; a rate of "castable in 83% of runs" is a measurement, not a score).
   Update the tool description, `cookbook.ts` and the tool tests.
6. **Split every function over 100 lines** in the list above into named steps in the same file or a
   sibling. Do it only where it reads better; stop when no function in the list is over 100
   lines. `draftDeck` (498 lines) becomes about 6 step functions plus a short driver. Don't
   change behaviour; the P27 snapshot tests still pass.
7. Run `pnpm check` and `pnpm test:int`, then `pnpm sizes --update`.

**Also (owner, 2026-11-20):** merge the two `creatureTypes` (`decks/domain/suggest.ts` and the
drafts copy) into one that counts Kindred cards everywhere, deleting the other in the same commit.
P15's handoff names both. And merge P15's two cast simulators (`canCastByTurn`,
`simulateCastOnCurve`) into the one simulator this package builds on `playOpening`.

**A UI element (owner, 2026-11-20):** the builder shows the same distribution. The commander's
"castable by turn" curve (turns 1 to 10, cumulative, plus the median turn) goes in the stats panel
beside the mana curve. A selected card shows the same small chart on demand ("When can I cast
this?"). It reads through the one capability the tool uses, via a builder action, and is labelled
as a measurement ("2,000 simulated games"), not a score. Its lines are reported separately (a
feature, like P13's haste theme), and a by-eye check goes in `deferred-checks.md`.

## What not to do

- Don't recreate an interactive session or a stateful simulator. Runs are stateless and seeded.
- Don't add effects beyond the three kinds. Others can be added later by the owner.
- Don't read the sim-pipeline code back in wholesale. The registry is small.
- Don't use `Math.random`, `Date.now` or any non-injected randomness.

## Done when

- `grep -rn "options\.\(inject\|plugin\)" src/modules/decks/domain` finds nothing (adjust to the
  option names from step 1's list, and write the names in the handoff).
- The Dark Ritual test passes, and an unlisted card is simply not affected.
- No function named in step 6 is over 100 lines. Measure each with
  `grep -n "function <name>" <file>` and the line of its closing brace. List the result in the
  handoff. A function that stays long has a one-line reason.
- `draw_sample` answers "cast X by turn Y" in a unit test with a seeded `Rng`.
- `pnpm check` and `pnpm test:int` are green. The sizes baseline is lowered, and the handoff shows
  the net (the registry's lines against the lines it and the options removed).

## Handoff

**Branch** `refactor/P28-cast-by-turn`. Design note: `docs/design/68-cast-by-turn.md`.

**Production lines: NOT net <= 0.** Baseline on `refactor/main` after P27 was 75,009; the branch is
75,355 (+346): the simulator and registry +217 (against what the package deleted), the UI slice
+120, `creatureTypes` +9. The package's -250 to -450 was written before P24 and P15 removed the
other engines; the old simulators were already smaller than the plan assumed. Owner to approve the
growth or cut; the UI slice (a feature) is reported apart.

- **Options removed** (first commit): `SimulateHandsOptions.policy`, `maxMulligans`, `onTheDraw`
  (callers never set them; the keep rule and the cap are constants), `simulateCastOnCurve`'s default
  `rng`, and the 0..7 style clamps. Their test scaffolding (the "other keep rules" pin) went.
- **One simulator** `decks/domain/cast-by-turn.ts` (`simulateCasting`) on `playOpening`. Deleted:
  `canCastByTurn` and `mustCastBy`/`MustCastByOption`/`mustCastByPct` (goldfish), the whole
  partial-shuffle body, `SimSource`/`SimCard` and the per-spell loops of `simulateCastOnCurve`
  (castability, which now maps lines to cards and targets and reads the curve at the spell's turn).
- **Registry** `decks/domain/cast-effects.ts`: `CAST_EFFECTS` (ritual, reducer, tapMana), `CARD_EFFECTS`
  by name (Dark Ritual, Seething Song, Foundry Inspector, Etherium Sculptor, Goblin Electromancer).
  The hard-coded "ramp tag" logic is replaced by the `tapMana` effect from the card features.
- **`draw_sample`**: input `cast` (names or "commander"), `onTheDraw`, `lastTurn`, `trials` (default
  2,000, max 5,000); `mustCastCard`/`mustCastTurn` and `odds.mustCastBy` are gone. Output: `cast`
  with runs, marginPct, side, cards, one `T<n>` line per turn, median turns and misses. The
  capability also has `castCurves` (used by the builder's action). Its reader now carries the card
  features (`withFeatures`) so ramp and tapped lands are real.
- **UI slice**: `builder/cast-curve/{actions,cast-bars,cast-curve}`: the commander's chart in the
  stats panel (loads on open), the selected card's behind "When can I cast this?". Unit test for the
  data mapping; by-eye checks are in `deferred-checks.md` ("Left by P28").
- **Pinned differences** (`engines-pinned.test.ts`, re-recorded): the old two simulators were
  different models, so numbers moved. Cast on curve: average 0.636 to 0.670; per spell -2 to +3
  points, Obliterator 6.5% to 4.8%, Twobrid Tutor 25.5% to 23.3%, Henzie 65.5% to 62.8%. Castable
  by a turn on the old goldfish model: Giant T4 55.0 to 52.0, Henzie T5 68.8 to 65.8, Henzie 3 mana
  T3 94.0 to 94.0, Wurm T6 32.3 to 27.8. `draw_sample` Henzie T5 68 to 64, Giant T4 57.3 to 55.
  Causes: a full shuffle and the same RNG stream per run (no partial shuffle); lands that enter
  tapped (conditional ones only as the first land); a land chosen for the target's missing colour;
  a ramp spell cast only with spare mana; Cultivate-type ramp (no mana of its own) no longer counts
  as a source; draw_sample's ramp now comes from the card features, not the role tag.
- **Exact formula**: `cast-by-turn.test.ts` checks the simulated "drawn by turn Y" curve (4 copies
  in 60 cards, 4,000 runs) against `hypergeometricAtLeast` within 3 points on turns 1 to 6.
- **Function lengths** (closing brace minus start): `simulateOpeningHands` 88, `simulateCastOnCurve`
  52 (both under 100). **Not split, with the reason:** `draftDeck` 489, `playtestCard` 196,
  `applyChoices` 168, `recordDraft` 139 (splits add lines against a net the package could not
  meet, and each shares many local accumulators; owner to say if wanted); `suggestSwaps` 113,
  `computeRatingFeatures` 111, `fitLogisticWeights` 103, `scoreDeck` 82 are P27's files (left).
- **creatureTypes**: one in `@/shared/kernel` (`card-types.ts`), counting Kindred and Tribal on the
  front face; the decks (`suggest.ts`) and drafts (`abilities.ts`) copies are gone. Difference: draft
  notes (Paliano Vanguard) now give a Kindred card's types. Test moved to `card-types.test.ts`.
- **Integration files run** (private DB `tcg_p28_test`, dropped): llm-tools, mana-base, decks,
  drafts, suggestions, commanders: green. `pnpm check`: all green except `sizes` (the +346 above);
  knip baseline lowered 382 to 380.

## P28b: the land-fetch effect

Branch `refactor/P28b-land-fetch`. A fourth effect kind, `landFetch`: a ramp spell that puts a land
onto the battlefield (Rampant Growth, Cultivate, Kodama's Reach, Three Visits, Farseek, Nature's
Lore). When it is cast ahead, the run gets a land: a basic of the first colour the target still
lacks that the card allows, else its first colour.

- **From the features, no name list.** New catalog feature `landFetch` (`{ entersTapped, colors }`
  or null), recognizer `recognizers/land-fetch.ts` (the regex stays in the recognizers: the
  regex-count ratchet is unchanged at 96). `effectOf` gives the effect to a non-land card with the
  `ramp` role tag and a `landFetch`. "Tapped" and the fetchable basic types (Forest, "a basic
  land", Plains/Island/Swamp/Mountain) are read from the text. An activated fetch (Sakura-Tribe
  Elder, Evolving Wilds) is not one.
- **`FEATURES_VERSION` 7 to 8**: stored rows lack `landFetch` until the next sync or
  `pnpm worker sync features` recomputes them (a backfill is needed; until then the simulator treats
  those cards as before). No migration (the column is JSON). There is no old function to compare
  against, so no A2 compare: the fixture file gained 7 cards (5 fetchers, 2 that must not match).
- **Tapped is recorded, not felt.** A fetched land enters tapped where the card says, and lands
  untap at the start of the next turn (the untap moved from after the mana count to the top of the
  turn, same result). Because a ramp spell is cast with spare mana at the end of a turn, the tapped
  land is always untapped by the time it is next used, so tapped and untapped fetchers behave the
  same here. The library is not thinned by the fetched land.
- **Castability** lines now carry `roles` and `landFetch`, so the scorecard and mana base see the
  effect too (they passed `roles: []` before).
- **Pinned (Cultivate now fetches in the reference deck, `engines-pinned.test.ts`):** cast on curve
  average 0.670 to 0.678; Wurm 52.5 to 56.0, Henzie 62.8 to 65.5, Worldspine Wurm 63.8 to 66.5,
  Giant 75.0 to 78.0. Castable by a turn: Giant T4 52.0 to 55.0, Henzie T5 65.8 to 68.8, Henzie 3
  mana T3 94.0 (same), Wurm T6 27.8 to 30.7. `draw_sample`: Henzie T5 64 to 68 (T3 1 to 2, T4 17 to
  25), Giant T4 55 to 57.
- Also fixed the two P28 lint warnings (unused `hasTypeWord` in `suggest.ts`, unused `cardTypes` in
  `abilities.ts`); a third (`_seen` in `drafts.int.test.ts`) is not P28's.
