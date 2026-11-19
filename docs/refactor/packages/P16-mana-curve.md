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

**Done.** One curve (decision 2): `curveSlot`, `curveSlotLabel`, `manaCurve`, `CURVE_SLOTS` in
`src/shared/kernel/mana-curve.ts` (not `decks/domain/`: the drafts domain may not import the decks
module, and both need it; ESLint refused `drafts/domain` importing `decks/client`). All four
`curveBucket` functions are gone (`grep -rn curveBucket src | grep -v test` finds nothing).

**Intended differences** (decision 2):

- Rating (`rate.ts`): curve slots 0 to 7+ instead of 0 to 6. A 7-drop is no longer "crowded" because
  the 6-drops are: with 20 six-drops in a Commander deck, a 7-drop lost the saturation penalty;
  the label for a card of 7 or more reads "crowded 7+-MV slot". `curveCounts` is now a number
  array (8 slots), not a Map.
- Drafter (`auto-pick.ts`): rounds down (2.5 is a 2-drop, was 3); 0-drops are slot 0 (were slot
  1); 6 and 7+ are separate slots. `IDEAL_CURVE` is now `[1, 1, 6, 5, 4, 3, 1, 1]` (the old 6+ target
  of 2 is split 1 and 1).
- Draft a deck (`draft-deck.ts`): the four buckets became eight slots with shares
  `[.02, .13, .20, .28, .20, .10, .05, .02]`; the old "1-2" (.35) and "5+" (.17) totals are kept.
  The reason on a curve pick is `{ kind: "curve", slot }` (was `bucket: "1-2" | ...`), worded
  "3 mana curve slot" / "7+ mana curve slot".
- Drafts page pool chart: eight bars, 0 to 7+ (was six, 1 to 6+).
- Deck profile (`suggest.ts`): `curveCounts` has slot 7 (was capped at 6).

**Product choice to confirm:** the eight draft-a-deck shares are mine (the user decided the
buckets, not the numbers).

**Not done / notes:** no screenshots (see deferred-checks). Sizes: source lines 92,917 to 92,945
(+28, including 42 new lines of curve code and tests count separately: test lines 36,476 to
36,618); the −50 to −100 estimate did not materialize because the old copies were small and the
eight-slot tables are longer than the four-bucket one.
