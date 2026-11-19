# P13. Tags, themes and signals (sliced by ability)

- **Branch:** `refactor/P13-tags-signals` (one step branch per slice: `refactor/P13.k-<ability>`) · **Depends on:** P11 · **Parallel with:** P12, P14
- **Audit:** doc 65 F4, F9, D12; [plan review](../reviews/plan-review/README.md) report [4](../reviews/plan-review/4-domain-engines.md)
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S3](../dedup-playbook.md#s3) (tags, themes, one signals system)
- **Lines:** about −300 to −600 (P12 to P14 together: −700 to −1,500). **A slice merges only at net ≤ 0.**

> **Changed by the plan review.** Sliced **by ability**, not by consumer file: each slice adds
> its recognizer, switches every caller, **deletes the old code and its tests**, and removes the
> allowlist entry. The four reminder-text strippers and the second signals system go here.
> `shared/card-search` ends up smaller, but P30 finishes moving what is left to its owners.

## Goal

Role tags, themes and signals come from `CardFeatures`. The two signals systems become one.

## Deletes

Verify with `wc -l` and `grep -c` first. Regex counts are from `refactor/main` at `cc8f0f7`.

| Slice                                                                                                                                                                                                                    | Old code that goes                                                                                                       | Lines              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| 1. **Reminder text** (the four strippers: both `withoutReminders` copies in `shared/card-search/{primitives,tags}.ts` (and `brackets.ts`), plus the others; find with `grep -rn "reminder" src --include='*.ts' -il`)    | all four, replaced by `plainText` in the features pipeline                                                               | −40 to −80         |
| 2. **Role tags** (`cardTags`, 16 regexes in `shared/card-search/tags.ts`, 2 in `primitives.ts`) and `tag-cards` in the worker if the stored features replace it                                                          | `src/shared/card-search/tags.ts` (on the oversize allowlist; likely deleted whole) and the extractors in `primitives.ts` | −150 to −350       |
| 3. **Themes**                                                                                                                                                                                                            | the theme matchers in `shared/card-search/*` and `decks/domain/deck-profile.ts` (8 regexes)                              | −60 to −120        |
| 4. **Signals, one system.** The two systems: `shared/card-search/signals.ts` (deck-level evidence, 9 regexes, on the allowlist) and `decks/domain/signals.ts` (produces and consumes, 6 regexes). One model covers both. | the system that doesn't survive, and the allowlist entry                                                                 | −100 to −250       |
| 5. **Bracket flags** (Game Changers, tutors, mass land denial, extra turns: 3 regexes)                                                                                                                                   | `shared/card-search/brackets.ts` (and `decks/domain/brackets.ts` if it duplicates)                                       | −30 to −80         |
| 6. **Search filters** `tag:` and `theme:` read the stored features instead of recomputing                                                                                                                                | the SQL and parse code for them in `shared/card-search/{sql,parse}.ts`                                                   | counted in 2 and 3 |

## Touches

`src/shared/card-search/{tags,primitives,signals,brackets,sql}.ts`,
`src/modules/decks/domain/{signals,deck-profile,rate,suggest,brackets}.ts`, the worker's
`tag-cards` command, new recognizers in `catalog/domain/features/recognizers/`, `regex-baseline.txt`,
`NOT_YET_RECOGNIZED`, `oversize-allowlist.txt`. **Avoid** the mana files (P12) and the land and
type checks (P14).

## Steps (per slice, in the order above)

1. Branch `refactor/P13.k-<ability>` from `refactor/P13-tags-signals`.
2. **Slice 4 first needs a short design:** compare the two signals systems. Write down (a
   paragraph in the handoff) what each model covers and the one model that covers both, and any
   deliberate change in what is produced or consumed. If the two disagree for a real card, pick the
   one the tests pin, and list the card.
3. Per slice: recognizer with a fixture table on the cards the current tests use; switch every
   caller; delete the old code, its tests, the allowlist and `NOT_YET_RECOGNIZED` entries; lower
   the regex baseline; bump `featuresVersion` if output changed.
4. Check the net of the slice (`git diff --shortstat`); above 0 needs a reason in the handoff **and**
   the owner's approval before merging.
5. Run `pnpm worker tag-cards` against the dev database once at the end if the command survived,
   and compare the tag counts per tag with before (the old and new counts may differ; list it).
6. `pnpm check`, `pnpm test:int`, `pnpm sizes --update`.

## What not to do

- Don't move a tag or signal "as is" to a recognizer and keep the old copy.
- Don't change what a tag means. List differences.
- Don't leave both signals systems alive for a release.
- Don't edit the mana recognizers (P12).

## Done when

- `grep -rn "withoutReminders\|stripReminder" src | grep -v test` finds nothing outside the
  features pipeline.
- There is one `signals` module (`ls src/shared/card-search src/modules/decks/domain | grep signals`).
- `src/shared/card-search/{tags,signals}.ts` are gone or off the oversize allowlist, and the regex
  baseline is lower by the regexes moved.
- Every slice's net lines were ≤ 0 (or approved); the handoff shows each.
- `pnpm check` and `pnpm test:int` are green.

## Handoff

(empty)
