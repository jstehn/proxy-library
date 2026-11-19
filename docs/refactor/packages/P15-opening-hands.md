# P15. One opening-hand engine

- **Branch:** `refactor/P15-opening-hands` · **Depends on:** P12, P14 · **Parallel with:** P16, P17
- **Audit:** doc 65 D3

## Goal

Dealing, the London mulligan, bottoming and the keep rule are written once. The test hand, the
goldfish session, the odds simulator and the mulligan drill all use it.

## Touches

`src/modules/decks/domain/{draws,goldfish,goldfish-session,mulligan-trainer,goldfish-types}.ts`,
new `decks/domain/opening-hand/`, `app/decks/[id]/builder/test-hand.tsx`, the `draw_sample`
binding.

## Steps

1. Write the test first: the same seeded deck and `Rng` through all four engines. Record where
   they differ (keep rules, bottoming choices, early-play definitions).
2. Build `opening-hand/`: `deal(library, rng)`, `mulligan(state, rng)`, `bottom(state, cards)`,
   `chooseBottom(hand, policy)`, and `KeepPolicy` as a strategy (`{ minLands, maxLands,
requireEarlyPlay }` plus named presets). Define `isEarlyPlay` and `isEarlyRamp` once.
3. Move each engine onto it. The drill's "recommended" and the simulator's "keepable" become the
   same `KeepPolicy` call.
4. Delete the duplicates; `goldfish-session.ts` (794 lines) goes under 500.

## Done when

- `grep -rn "function isEarlyPlay\|function isEarlyRamp\|function isKeepable\|function bottomCards" src`
  finds one of each, in `opening-hand/`.

## Handoff

(empty)
