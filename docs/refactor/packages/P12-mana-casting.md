# P12. Mana and casting from features (sliced by ability)

- **Branch:** `refactor/P12-mana-casting` (one step branch per slice: `refactor/P12.k-<ability>`) · **Depends on:** P11 · **Parallel with:** P13, P14
- **Audit:** doc 65 F4, D12; [plan review](../reviews/plan-review/README.md) report [4](../reviews/plan-review/4-domain-engines.md)
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S3](../dedup-playbook.md#s3) (mana and casting consumers)
- **Lines:** about −250 to −500 (P12 to P14 together: −700 to −1,500). **A slice merges only at net ≤ 0.**

> **Changed by the plan review.** The package is cut **by ability, not by consumer file**. One
> ability ("taps for mana") appears in several files at once, so a slice touches all of them.
> Each slice adds its recognizer, switches **every** caller, deletes the old code and its tests,
> and removes its `NOT_YET_RECOGNIZED` and regex-baseline entries. No "new beside old".
> `sim-pipeline.ts` and the interactive goldfish are **gone** (P24): this package no longer
> touches them, and P28's effect registry reads these features later.

## Goal

Mana production, cost changes and cast permissions are read from `CardFeatures`, not from regexes
over card text, one ability at a time.

## Deletes

Verify the names with `grep -n "export function" src/modules/decks/domain/{mana,castability,mana-base}.ts`
before each slice. Line numbers are from `refactor/main` at `cc8f0f7`.

| Slice                                                                                                                                                                                                                                                                                                                                                          | Old code that goes                                                                                                                                            | Lines        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1. **Taps for mana** (skip it if P11's first recognizer already did it; then record that)                                                                                                                                                                                                                                                                      | `hasTapManaAbility`, `extractTapManaProduction` in `decks/domain/mana.ts` (lines 140–217) and the callers' own parsing in `castability.ts` and `mana-base.ts` | −100 to −200 |
| 2. **Mana doublers and extra mana** (`applyManaDoublers`, mana-from-spells, rituals)                                                                                                                                                                                                                                                                           | `mana.ts` (about line 218 on) and any copy in `castability.ts`                                                                                                | −50 to −100  |
| 3. **Cost reducers and cast permissions** (what the registry in P28 reads)                                                                                                                                                                                                                                                                                     | the cost-change regexes in `castability.ts` and `mana.ts`                                                                                                     | −50 to −100  |
| 4. **Enters tapped and tapped-source facts**                                                                                                                                                                                                                                                                                                                   | `tapped` in `mana-base.ts` and its copy in `castability.ts`, and the `mana-base.ts` regexes (2)                                                               | −30 to −80   |
| 5. **The mana-cost parsers**: four parsers of `{X}` costs exist (`mana.ts parseManaCost`, `shared/card-search/parse.ts manaSymbols`, `catalog/infrastructure/spellbook-gateway.ts parseManaNeededValue`, the mana-symbols helpers). P15 keeps **one**; this slice only removes parsing of **oracle text** costs ("costs {1} less"), not the printed mana cost. | in the files above                                                                                                                                            | counted in 3 |

(Each row's lines are an estimate from the review; the handoff records the real net per slice.)

## Touches

`src/modules/decks/domain/{mana,castability,mana-base,mana-symbols}.ts`, new recognizers in
`src/modules/catalog/domain/features/recognizers/`, `regex-baseline.txt` and the
`NOT_YET_RECOGNIZED` list from P11. **Avoid** `shared/card-search` (P13), land and type checks
(P14), and the mana-payment engine and `ManaColor` (P15 follows this package).

## Steps (per slice, in the order above)

1. Branch `refactor/P12.k-<ability>` from `refactor/P12-mana-casting`.
2. List the regexes for the ability: `grep -nE "\.test\(|\.match\(|RegExp|/[^/]+/[gimsuy]*" <files>`.
   Write the count in the commit message.
3. Write the recognizer with a fixture table, using **the same cards the current tests use**, so
   "moving is not fixing" (doc 66, invariant 5) is checked.
4. Switch every caller to the stored feature. Where the caller needs the feature in a pure
   function, pass it in as data (the capability or query loads it).
5. **In the same commit,** delete the old function, its tests, the `NOT_YET_RECOGNIZED` entry for
   the file (if the file is clean now), and lower the regex baseline (`pnpm check` has the
   `--update`). Bump `featuresVersion` if an earlier recognizer's output changed.
6. Check the slice's net: `git diff --shortstat refactor/P12-mana-casting...HEAD` for `src`. If it
   is above 0, find more to delete, or write the reason in the handoff **and** get the owner's
   approval. Don't merge it otherwise.
7. Run the simulator and mana tests: `pnpm vitest run src/modules/decks/domain`. Merge the slice into
   the package branch.
8. When the slices are done: `pnpm check`, `pnpm test:int`, `pnpm sizes --update`.

## What not to do

- Don't write a recognizer for an ability nobody reads yet.
- Don't keep the old function "until the next slice".
- Don't change a rule: the recognizer gives the answers the old code gave (list deliberate
  differences in the handoff).
- Don't touch the opening-hand or payment engines (P15).

## Done when

- `grep -cE "/i\.test\(" src/modules/decks/domain/{mana,castability,mana-base}.ts` is 0.
- The regex baseline is lower than at P11 by at least the count of regexes moved. List it.
- Every slice's net lines were ≤ 0 (or approved), and the handoff shows each slice's net.
- `pnpm check` and `pnpm test:int` are green.

## Handoff

(empty)
