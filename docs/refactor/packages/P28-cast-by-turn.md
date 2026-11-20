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

(empty)
