# P24. Delete the dead and test-only code, and the interactive goldfish

- **Branch:** `refactor/P24-dead-code` · **Depends on:** P23 · **Parallel with:** P26
- **Source:** [plan review](../reviews/plan-review/README.md) (P24 and the owner's answers), reports [2](../reviews/plan-review/2-code-volume.md) and [4](../reviews/plan-review/4-domain-engines.md)
- **Lines:** the plan says −1,500 to −2,200. The list below adds up to about −2,500 to −3,000 code
  lines, because `sim-pipeline.ts` turns out to be used only by the interactive goldfish (step 5).
  Record the real number in the handoff.

## Why

The owner answered (2026-11-19): **delete all of it**, items (a) to (f), and remove the
interactive goldfish. "The owner will reimplement anything that turns out to be needed." Production
can't reach this code, so it is the cheapest saving in the plan, and it lets `knip --production`
pass.

## Deletes

Verify each path with `ls` first. Line counts are file lines; code lines are about 85% of them.

**The owner's list (a) to (f):**

| What                                                                           | Where                                                                                            | Lines            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------- |
| Mulligan trainer (`dealMulliganDrill`, `evaluateMulliganDecision`)             | `src/modules/decks/domain/mulligan-trainer.ts`, and its test (75)                                | 118              |
| Card packages (`planPackageInsert`)                                            | `decks/domain/packages.ts` (110) and its test (59), `decks/queries/packages.ts` (18)             | 128              |
| Upgrade roadmap                                                                | `decks/domain/upgrade-roadmap.ts` (158) and test (114), `decks/queries/upgrade-roadmap.ts` (114) | 272              |
| `deckCombosView`                                                               | `src/modules/decks/queries/deck-combos.ts`                                                       | 101              |
| Rating evaluation (`evaluateHoldout`)                                          | `decks/domain/eval.ts` (96) and test (166)                                                       | 96               |
| The evaluation half of the rating script (step 4 keeps the `--calibrate` half) | `scripts/dev/eval-ratings.ts`                                                                    | about 150 of 304 |
| Odds helpers only tests use: `deckOdds`, `chanceByTurn`                        | `decks/domain/draws.ts` (about lines 254–280 and 345–371) and their tests in `draws.test.ts`     | about 90         |
| Unused client file                                                             | `src/modules/catalog/client.ts`                                                                  | 3                |

**Test-only functions** from [removal-list.md](../removal-list.md). For each, `grep -rn "\bname\b"
src worker scripts` must show only its own file and its test. If one has a production caller
after all, keep it and say so in the handoff.

- `exportWithTags`: `decks/domain/list-format.ts` (about line 94)
- `primerSections`: `decks/domain/deck-profile.ts` (about 288)
- `preparedForTest`: `decks/domain/commanders.ts` (about 199)
- `msrpFor`: `store/domain/pricing.ts` (about 28)
- `viewerRelation`: `social/domain/friendship.ts` (about 15)
- `defaultProfile`: `social/domain/profile.ts` (about 24)

**Not on the list, though report 2 named them.** They have production callers. Don't delete them:
`actFor` (`drafts/domain/timers.ts`, used by `runTimers`), `TtlCache`
(`catalog/infrastructure/outside-data.ts`, used by the outside-data service), and the
`fixtureMtgjsonGateway`, `fixtureScryfallGateway` and `fixtureWpnGateway` functions (tests and the
end-to-end setup use them).

**The interactive goldfish (owner answer D3).** No page or tool reaches it. It lives in the
container and the worker:

| What                                        | Where                                                                                                                                                                                                | Lines     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| The engine, `stepGoldfishState` (572 lines) | `src/modules/decks/domain/goldfish-session.ts`, and `goldfish-session.test.ts` (536)                                                                                                                 | 794       |
| Its stress test                             | `decks/domain/engine-stress.test.ts` (858): delete it, or keep only cases that don't import `goldfish-session`                                                                                       | test      |
| The service                                 | `decks/application/goldfish-sessions.ts` (121) and `goldfish-sessions.test.ts`                                                                                                                       | 121       |
| The repository, port and record types       | `decks/infrastructure/drizzle-goldfish-sessions.ts`; the `GoldfishSession*` types in `decks/application/ports.ts` (about lines 169–195); its export in `decks/infrastructure/index.ts`               | about 100 |
| The table `goldfish_sessions`               | `decks/infrastructure/schema.ts` (about 260–280), and a migration that drops it                                                                                                                      | 20        |
| Wiring                                      | `makeGoldfishSessions` in `decks/index.ts` (line 194); `src/server/core.ts` (imports about 42 and 52, `goldfishSessions` at about 152, 222 and 283); the prune call in `worker/index.ts` (about 195) | 25        |
| Its types                                   | `decks/domain/goldfish-types.ts`                                                                                                                                                                     | 89        |
| The plugin pipeline                         | `decks/domain/sim-pipeline.ts`. Only `goldfish-session.ts` and two tests import it (checked 2026-11-19). If that is still true after the steps below, delete it too                                  | 779       |

**Keep.** They back `draw_sample` and the scorecard (owner answer D3): `goldfish.ts`
(`simulateOpeningHands`), `castability.ts` (`simulateCastOnCurve`), `draws.ts` without the two odds
helpers, and `mana.ts` as far as `castability` and `mana-base` use it.

## Touches

The files above; `src/modules/decks/index.ts` and `client.ts` (remove exports); `src/server/core.ts`;
`worker/index.ts`; `drizzle/` (one new migration); `tests/integration/embeddings.int.test.ts`;
`docs/design/60-interactive-goldfish-and-comprehensive-rules-mcp.md` (one line);
`docs/refactor/removal-list.md`; `scripts/dev/check.sh`.

## Steps

1. Run `pnpm exec knip --production 2>&1 | tail -80` and keep the output. It is your worklist.
   Check each item against the tables above. Anything knip reports that is **not** in them: don't
   delete it, and list it in your handoff.
2. **Dead features, one commit each:** mulligan trainer, packages (domain and query), upgrade
   roadmap, `deckCombosView`. For each: delete the files and tests, remove the export from
   `decks/index.ts` and `client.ts`. `tests/integration/embeddings.int.test.ts` calls
   `deckCombosView` (step 6 in that test) and `deckUpgradeRoadmap` (step 9): delete those steps.
3. **Test-only functions:** delete each with its tests, in one commit.
4. **The rating script.** `scripts/dev/eval-ratings.ts` does two jobs: holdout evaluation
   (`evaluateHoldout`) and `--calibrate` (`fitLogisticWeights`). Keep the second.
   - Rename the file `scripts/dev/fit-rating-weights.ts`. Remove the evaluation code and the `eval`
     import. Keep `--calibrate`'s behaviour.
   - Add one comment above `RATING_WEIGHTS` in `decks/domain/rate.ts`: the weights were fitted
     from data by `scripts/dev/fit-rating-weights.ts` (owner answer D5).
   - Delete `eval.ts` and its test. Search `package.json` and `docs/` for the old script name.
5. **The interactive goldfish**, in this order, so the tree compiles after every commit:
   1. Remove the worker's prune call and the `goldfishSessions` wiring in `core.ts`.
   2. Delete the service, the repository, the port types and the table from `schema.ts`. Run
      `pnpm db:generate` and check that the new file in `drizzle/` only drops the table and its two
      indexes. (The sessions are ephemeral, with a 24-hour life, and the owner approved removing
      the feature.) Don't apply the migration to anyone's data: the normal `pnpm db:migrate`
      does that later.
   3. Delete `goldfish-session.ts`, its test, and the `engine-stress.test.ts` cases that need it.
   4. Run `grep -rn "sim-pipeline\|goldfish-types" src worker scripts tests`. If only deleted
      files and tests are left, delete both. Put the last commit that had `sim-pipeline.ts`
      (`git log -1 --format=%h -- src/modules/decks/domain/sim-pipeline.ts`) in the handoff, so P28
      can read it. If `FormatRuleSet.commandZoneTaxPerCast` is now unused, tell P28; don't delete
      it here.
   5. Delete what knip now reports in `mana.ts` and `mana-symbols.ts` only if it is plainly unused.
      Leave the rest: P15 owns the mana engine.
6. Add "Superseded in part (2026-11-19): the interactive goldfish was removed (P24)" to design doc
   60's Status. In `README.md` (line 25, "Deck builder & analysis"), take out the
   "keep-or-mulligan trainer" and "reusable card packages" and anything else this package
   deleted. Search `docs/` and `CLAUDE.md` for the other names (`grep -rn "mulligan trainer\|card
packages\|interactive goldfish" docs README.md CLAUDE.md`) and fix only statements that are
   now false.
7. Flip `knip --production` in `scripts/dev/check.sh` from a report to a gate. It must exit 0. Fix the
   leftovers in this package. If one has to stay, put it in `knip.json` with a reason.
8. Delete the rows this package closes from `removal-list.md`. Run `pnpm sizes --update`.

## What not to do

- Don't delete `goldfish.ts` or `castability.ts`: they answer "can I cast X by turn Y".
- Don't port the goldfish features into something smaller. The owner will reimplement what is
  needed.
- Don't delete a type or an export because it looks unused. `knip --production` decides.

## Done when

- `pnpm exec knip --production` exits 0, and `pnpm check` runs it as a gate.
- `grep -rln "goldfish-session\|goldfishSessions\|sim-pipeline\|mulligan-trainer\|upgrade-roadmap\|deckCombosView" src worker scripts tests`
  finds nothing.
- `pnpm check` and `pnpm test:int` are green.
- `docs/refactor/sizes-baseline.txt` is lowered. The handoff lists the real lines removed per
  table row and every file deleted. The PM checks that list against `git diff --stat refactor/main`.

## Handoff

**Sizes.** Production code lines 77,318 to 74,794 (-2,524); baseline lowered. `git diff --shortstat
refactor/main` over src, worker, scripts, tests: 47 files, +240 / -5,178 (tests included).

**Commits (branch `refactor/P24-dead-code`):** dead features; test-only functions; rating script and
`eval.ts`; goldfish service/wiring; goldfish engine, pipeline and types; knip ratchet and docs.

**Files deleted (22), file lines:** `goldfish-session.ts` 794, `goldfish-session.test.ts` 536,
`engine-stress.test.ts` 858 (all of it imported the goldfish), `sim-pipeline.ts` 779,
`goldfish-types.ts` 89, `goldfish-sessions.ts` 121 and `.test.ts` 154,
`drizzle-goldfish-sessions.ts` 71, `mulligan-trainer.ts` 118 and `.test.ts` 75, `packages.ts` 110 and
`.test.ts` 59, `queries/packages.ts` 18, `upgrade-roadmap.ts` 158 and `.test.ts` 114,
`queries/upgrade-roadmap.ts` 114, `queries/deck-combos.ts` 101, `eval.ts` 96 and `eval.test.ts` 166,
`friendship.test.ts` 22 (only tested `viewerRelation`), `catalog/client.ts` 3.
`scripts/dev/eval-ratings.ts` (304) became `scripts/dev/fit-rating-weights.ts` (the fit only, always runs).
Test-only functions deleted with their tests: `exportWithTags`, `primerSections`, `preparedForTest`
(and the `sharesPlan` equivalence test that used it), `msrpFor` (its property tests now compute the
same expression inline), `viewerRelation`, `defaultProfile`, `chanceByTurn`; plus the unused `spendMana`
and `addMana` in `mana.ts`.

**Kept.** `deckOdds`: `openingHandOdds` (stats panel, test hand, `get_deck`) calls it for `roles`.
`actFor`, `TtlCache`, the fixture gateways (as the package says).

**Not done: knip does not exit 0.** `knip --production` went 766 to 457 findings (24 unused files
became 0 by ignoring test-support directories; 147 exports, 310 types remain). What remains is mostly
`index.ts` re-exports and types that only integration tests use (e.g. `auditDeck`, `deckStats`,
`storePage`). Deleting them is not on the package's list and overlaps P26 (types), so I did not.
`pnpm check` gates knip as a ratchet (`scripts/dev/knip-ratchet.sh`, `knip-baseline.txt` = 457), like
`sizes`. The PM or owner decides whether to cut the rest.

**For P28.** The last commit with `sim-pipeline.ts` is `156a971`. `FormatRuleSet.commandZoneTaxPerCast`
is now read only by `format-rules.test.ts`.

**Tables left behind (no migration written):** `goldfish_sessions` (schema kept, state typed
`unknown`), `card_packages`, `card_package_entries`. Removal-list rows added.

**Verify.** `draw_sample`, scorecard and deck facts output unchanged (I did not run `test:int`).
