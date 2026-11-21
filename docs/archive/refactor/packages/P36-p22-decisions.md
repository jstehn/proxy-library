# P36. Decisions from P22: 60-card role targets, and a commander score with options (a feature)

- **Branch:** `refactor/P36-p22-decisions` · **Depends on:** P22, P30 · **Parallel with:** wave 6
  packages that don't touch `decks/scoring` or the commander finder
- **Source:** the owner's answers to P22's disagreements (`owner-answers.md`, 2026-11-20)

## 1. Role targets for 60-card formats (owner answer 1: research the best targets)

Today `FORMAT_RULES` gives 60-card formats role targets of 4 ramp, 6 card draw, 6 removal and 2
board wipes (doc 44), while doc 19 said Commander only.

- Research typical counts for 60-card constructed decks (lands, ramp, card draw, removal, sweepers)
  from reputable deckbuilding sources (Frank Karsten's land and colour articles, current
  tournament-deck statistics). Note the sources and the date in the doc.
- Targets are guides, not rules (the tools give ideas, not verdicts). Write them per format if they
  differ, in `FORMAT_RULES`, with a test, and update `docs/modules/decks-core.md`.

## 2. Commanders found by their own score, with options (owner answer 9)

The commander finder keeps its own score (not `rateCard`): **popularity and power** are good
metrics, and the player gets **options**. Today it has a second weight table
(`COMMANDER_WEIGHTS`).

- Write down what the score uses today, then give the finder a choice of ordering, for example:
  popularity (EDHREC rank), power (the deck-level strength signals the app has), a blend of the
  two (default), and "fits my collection" if it already exists. Keep it simple: a select box, no
  sliders, unless the owner asks.
- The LLM tools keep the rule: no scores or ranks in their output; a list in the chosen order.
- Tests for each ordering on fixture commanders.

## 3. Doc fixes (code wins)

Correct the docs P22 flagged so they match the code and the owner's answers: doc 61 (response cap
14 KB), doc 28 (search batching), doc 30 (20 redirect URIs), doc 45 (EDHREC cadence), doc 33 (MSRP
mode sells at the kind price), doc 51 (wishlist sharing follows profile visibility), doc 13 (images
download and cache on first view). Use "Superseded in part" lines or `docs/modules/` page edits, as
P22 did.

## Done when

- Role targets set from research, with sources cited; tests pass.
- The commander finder offers the orderings; tests pass; the tools show no scores.
- The seven docs agree with the code.
- `pnpm check`, `pnpm test:int` green; net lines reported (a feature).

## Handoff

Parts 1 and 3 done (part 2 is P32's). Role targets: research found only removal (4-8, guide 6) and control draw (about 8) for 60-card decks; ramp, draw and wipe stay 4/6/2 as house guides, one set for all 60-card formats (type holds one number; ranges live in decks-core.md "Role targets (sources)"). Seven design docs marked, module "Disagreements" entries closed.

Part 2 done (commander finder). It already had a select box over four orderings; what changed: the default is now the blend, the blend is popularity bonus plus power score (your collection left out), and power no longer holds a popularity term, so the blend counts it once. Fourth option "Fits my collection" (`coverage`) is the old coverage score. `COMMANDER_WEIGHTS` stays: it is only that coverage score, not a duplicate of `RATING_WEIGHTS`. No LLM tool lists commanders, so no tool change. What each score uses is written in `docs/modules/decks-building.md` rule 12.
