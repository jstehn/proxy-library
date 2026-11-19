# P16. One mana curve

> **Decision 2 answered (2026-11-19):** everything uses the builder's mana curve (0–7+).

- **Branch:** `refactor/P16-mana-curve` · **Depends on:** P10, **decision 2** · **Parallel with:** P15, P17
- **Audit:** doc 65 D5
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S8](../dedup-playbook.md#s8) · **Lines to remove:** about −50 to −100

## Goal

The mana curve is computed by one function. Any curves that really differ are named schemes.

## Touches

`src/modules/decks/domain/{stats,rate,draft-deck}.ts`, `src/modules/drafts/domain/auto-pick.ts`,
new `decks/domain/mana-curve.ts` (exported from `decks/client.ts` so drafts and the builder can
use it), `app/decks/[id]/builder/stats/stats-panel.tsx` (moved by P19).

## Steps

1. Today's four schemes: `stats.ts` 0–7+ (floor), `rate.ts` 0–6 (floor), `auto-pick.ts` 1–6
   (round), `draft-deck.ts` "1-2 / 3 / 4 / 5+". Apply decision 2.
2. `manaCurve(lines, scheme)` with `CURVE_SCHEMES` as `Record<name, scheme>`; delete the three
   `curveBucket` functions.

## Done when

- `grep -rn "curveBucket" src | grep -v test` finds nothing.

## Handoff

(empty)
