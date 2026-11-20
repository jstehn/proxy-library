# P20. Remaining near-clones and large files; split the end-to-end spec; thin worker

> **Re-scoped by the plan review.** The old P20 held three jobs that other packages now own:
> the service pass-through and `formAction` (P25), the `catalog` and `reddit`/`youtube` structure
> (P30), and the responsibility check of `decks` (P18). What is left is below.

- **Branch:** `refactor/P20-large-files` · **Depends on:** P18, P30, P31 · **Parallel with:** P22, P32, P33, P34 (P21 waits for this package)
- **Audit:** the 500-line benchmark (README, "File size"); [plan review](../reviews/plan-review/README.md) reports [2](../reviews/plan-review/2-code-volume.md) and [5](../reviews/plan-review/5-docs-tests-dx.md)
- **Recipe:** [dedup playbook](../dedup-playbook.md), Part A, then [S10](../dedup-playbook.md#s10) (small clones no package owns)
- **Lines:** **−400 to −600** (near-clones).

## Goal

The near-clone report is at its floor, every file on `docs/refactor/oversize-allowlist.txt` with
"pre-refactor" is split or kept for a real reason, the 1,316-line end-to-end spec is split by
journey, and `worker/index.ts` is under 150 lines.

## Deletes

| What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Where                      | Lines                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------- |
| **Remaining near-clones** that differ only in names and literals (about 3,500 lines in groups; 400–600 can go). Run `pnpm clones --near` (P23) and take the groups it reports; the biggest are likely in `src/app/**/actions.ts` leftovers, the `drizzle-*-repository.ts` files, and `queries/*.ts` pairs                                                                                                                                                                                                          | wherever the report points | −400 to −600                             |
| The big-file leftovers on the allowlist (verify which remain after P18, P28, P30 and P32): `drafts/domain/{steps,draft}.ts` (815, 707), `drafts/application/drafts.ts` (672), `store/queries/store.ts` (630), `shared/card-search/{parse,sql}.ts` (716, 615, if P30 left them), `drafts/infrastructure/drizzle-draft-repository.ts` (556), `reddit/infrastructure/reddit-http-gateway.ts` (553), `catalog/infrastructure/drizzle-repositories.ts` (511), `decks/domain/optimize.ts`, `playtest-card.ts`, `rate.ts` | those files                | split, not removed: net 0                |
| The 1,316-line `tests/e2e/accounts.spec.ts` (24 journeys: it also covers drafts, sharing and the store) split by journey. Test support counts apart.                                                                                                                                                                                                                                                                                                                                                               | `tests/e2e/`               | moved                                    |
| `worker/index.ts` (269 lines) → ≤ 150: the command table and the loops move to files                                                                                                                                                                                                                                                                                                                                                                                                                               | `worker/index.ts`          | −120 (moved into `worker/commands/*.ts`) |
| Rows P25 now owns (pass-through, `formAction`, `printingDetails` beside `lookUpCards`'s `detail`)                                                                                                                                                                                                                                                                                                                                                                                                                  | `removal-list.md` only     | rows                                     |

## Touches

The files above, `worker/`, `tests/e2e/`, `playwright.config.ts` (only if the spec names change),
`docs/refactor/{oversize-allowlist.txt,removal-list.md,clone-baseline.txt}`.
**Avoid** UI class strings (P31), pages (P32), renames (P21).

## Steps

1. **Near-clones.** Run `pnpm clones --near 2>&1 | head -80`. For each of the 20 biggest groups
   decide: **merge** into one function (the clones differ only in names), or **leave** (they differ
   in meaning; write one line why in the handoff). Merge one group per commit, deleting the copies
   in the same commit. Then make `--near` a gate with its own baseline if the owner agrees (propose
   it in the handoff; don't add it yourself).
2. **Name the jobs** of each remaining over-500 file in one line each. A file with one job and a
   good reason to be long (a parser, a lookup table) stays, with that reason on the allowlist.
   Split the others by job, not by line count: one file per job, each with its tests.
   The drafts steps engine (`steps.ts`, 65 uses of `ctx`) splits into one file per step kind,
   following the `DRAFT_ABILITIES` style.
3. **Split `accounts.spec.ts`** by journey into `tests/e2e/<area>.spec.ts` files: `accounts`,
   `catalog-and-store`, `collection`, `decks`, `drafts`, `sharing-and-social`, `wishlist-and-trades`.
   Keep the shared helpers (`signIn`, `openAdminPage`, `pickFirstCard`) in `tests/e2e/helpers.ts`.
   Specs run serially in one database, so keep the order the journeys need
   (`test.describe.configure({ mode: "serial" })` per file, and file names that sort in the right
   order, or a `projects` dependency). Run the whole suite once and check the count is the same
   (26 tests).
4. **`worker/index.ts` under 150 lines.** One file per command in `worker/commands/` (`sync`,
   `schedule`, `draft-timers`, `check-packs`, `check-products`, `tag-cards`, `check-commanders`,
   `migrate`) and a table `COMMANDS: Record<string, Command>` in `index.ts`. The two loops
   (`syncLoop`, `draftTimerLoop`) go to `worker/schedule.ts`.
5. **Close the rows.** Delete the rows from `removal-list.md` that P25 and P30 closed, and every
   "P20" row you closed. Anything left with "P20" in the list gets done, moved to a named package,
   or deleted with a sentence.
6. **Tests live with what they cover** (owner decision, 2026-11-19; `docs/architecture/testing.md`,
   "Layout"). Move each `tests/integration/*.int.test.ts` that tests one module into that module
   (beside the code it covers). Keep only journeys across modules in `tests/integration/`. Move
   `src/app/_llm-tools/llm-tools.int.test.ts` next to the bindings it covers. Moves only: no test
   changes. Do this after P18 and P30, so each test moves once.
7. `pnpm check`, `pnpm test:int`, `pnpm test:e2e`. `pnpm sizes --update`; `pnpm clones --update`.

## What not to do

- Don't merge two functions that look alike but mean different things (playbook A1, step 3).
- Don't split a file by line count.
- Don't change a test's behaviour while splitting the spec. Don't rename tests.
- Don't add a "common" dumping file.

## Done when

- The allowlist has no "pre-refactor" entries. No source folder has more than 12 files, and no
  `index.ts` is over 150 lines (`pnpm sizes`).
- `ls tests/e2e` shows no spec over 400 lines, and `pnpm test:e2e` runs the same tests as before.
- `wc -l worker/index.ts` is ≤ 150.
- Every file left in `tests/integration/` tests more than one module (say which in the handoff), and
  `pnpm test:int` runs the same number of tests as before.
- `pnpm clones --near` reports fewer groups than at P23 by the number the handoff names.
- STATUS's size table shows the code lines at the end of this package, against the ≤ 75,000 target.

## Handoff

(empty)
