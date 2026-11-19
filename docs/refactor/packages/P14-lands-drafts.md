# P14. Lands, tokens and draft cards from features (sliced by ability)

- **Branch:** `refactor/P14-lands-drafts` (one step branch per slice: `refactor/P14.k-<ability>`) · **Depends on:** P11 · **Parallel with:** P12, P13
- **Audit:** doc 65 D4, F4; [plan review](../reviews/plan-review/README.md) report [4](../reviews/plan-review/4-domain-engines.md)
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S3](../dedup-playbook.md#s3) (lands, draft abilities)
- **Lines:** about −150 to −400 (P12 to P14 together: −700 to −1,500). **A slice merges only at net ≤ 0.**

> **Changed by the plan review.** Sliced by ability; each slice deletes its old code. **`cardTypes`
> is not deleted any more:** P26 keeps it as the pure type-line helper (owner answer D2), and the
> features cover oracle-text facts only. The old step "point `cardTypes` callers at features" is gone.

## Goal

Land-related text facts (cycles, enters tapped, fetch) and token making come from `CardFeatures`,
and the drafts module names no card in code.

## Deletes

| Slice                                                                     | Old code that goes                                                                                                                                                                                | Lines       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1. **Land cycles** (a stored `land_cycles` array, doc 66 open question 9) | the land-cycle matchers in `decks/domain/{mana-base,stats,rules}.ts` (5 regexes in `rules.ts`, 2 in `stats.ts`)                                                                                   | −60 to −150 |
| 2. **Token making** (what a card creates)                                 | the matchers in `decks/domain/token-proxies.ts` (2 regexes) and any copy in `decks/application/token-choices.ts`                                                                                  | −30 to −80  |
| 3. **Draft abilities** (`name === "Cogwork Librarian"`)                   | `drafts/domain/timers.ts:177` (verify the line) and the one regex in `abilities.ts`; replaced by one `DRAFT_ABILITIES` data table keyed by name (not a text recognizer: doc 66 section 7 says so) | −20 to −60  |
| 4. **The lint rule**                                                      | none (it adds ~10 lines)                                                                                                                                                                          | +10         |

## Touches

`src/modules/decks/domain/{mana-base,stats,rules,token-proxies}.ts`,
`src/modules/decks/application/token-choices.ts`,
`src/modules/drafts/domain/{timers,abilities,auto-pick}.ts`, `eslint.config.mjs`, new recognizers,
`regex-baseline.txt`, `NOT_YET_RECOGNIZED`. **Avoid** `src/shared/kernel/card-types.ts` (P26),
the mana files (P12) and the tag files (P13).

## Steps

1. For each slice, as in P12: branch, recognizer with fixtures from the current tests, switch every
   caller, **delete the old code in the same commit**, lower the regex baseline, check the net.
2. Slice 3: add `DRAFT_ABILITIES` (`{ "Cogwork Librarian": { kind: "extraCard" } }`) and read it in
   `timers.ts`. The lookup is data, so adding an ability needs no new branch.
3. Slice 4: add a lint rule forbidding `name === "<literal>"` and `name !== "<literal>"` in
   `src/modules/**/domain`, with the `DRAFT_ABILITIES` file as the one place a name is a key.
4. `pnpm check`, `pnpm test:int` (drafts have integration tests), `pnpm sizes --update`.

## What not to do

- Don't delete or change `cardTypes` or `isLand`: they are P26's pure helpers.
- Don't add a recognizer for type lines.
- Don't turn the Cogwork Librarian rule into a regex: it is keyed by name on purpose.

## Done when

- `grep -rn 'name === "' src/modules --include='*.ts' | grep -v test` finds no card names.
- The regex baseline is lower; every slice's net lines were ≤ 0 (or approved).
- `pnpm check` and `pnpm test:int` are green.

## Handoff

(empty)
