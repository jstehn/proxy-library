# P23. Guards and test fixes

- **Branch:** `refactor/P23-guards` · **Depends on:** none (first package of wave 3a) · **Parallel with:** none (it makes every later package measurable)
- **Source:** [plan review](../reviews/plan-review/README.md), "Process changes"; reports [2](../reviews/plan-review/2-code-volume.md) and [5](../reviews/plan-review/5-docs-tests-dx.md)
- **Lines:** small. It adds about 150 lines of scripts and takes nothing out of `src`. Say so in the handoff.

## Why

The first 22 packages grew code because nothing stopped it: new layers were added beside the old
ones, and every estimate came without a list of what would go. This package adds the guards that
make that visible, and fixes the two tests that fail under load. Every later package is measured by
them.

## Deletes

Nothing in `src`. It removes only what its fixes replace:

- `tests/e2e/accounts.spec.ts`: the wait in `pickFirstCard` (about line 842) that expects the pick
  heading to change after the last pick. A wait that also accepts the finished text replaces it
  (about −3 lines, +6).
- If you find yourself deleting source code here, stop: it belongs to P24.

## Touches

`scripts/dev/sizes.ts` (and its test), new `docs/refactor/sizes-baseline.txt`, `scripts/dev/clones.ts`
(near-clone mode), `scripts/dev/check.sh`, `knip.json`, `package.json`, `tests/e2e/accounts.spec.ts`,
`src/modules/decks/domain/optimize.test.ts`, `src/modules/drafts/domain/draft.test.ts`, new
`scripts/dev/install-hooks.sh`, `docs/refactor/README.md` (one line about the hook).

## Steps

1. **The code-line ratchet.** Today `pnpm sizes` prints "Code lines: 79,560". Make it a gate, the
   same way `scripts/dev/clones.ts` handles `docs/refactor/clone-baseline.txt`:
   - Count **production code lines**: code lines (no blanks, no comment-only lines) in `src`,
     `worker` and `scripts`, **excluding** test files, `src/**/testing/` and any `fixtures/`
     folder.
   - Store the number in `docs/refactor/sizes-baseline.txt` (one number and a newline).
   - `pnpm sizes` fails when the count is **above** the baseline, and prints the difference.
   - `pnpm sizes --update` lowers the baseline to today's count. It never raises it: if the count
     is higher, it refuses and says so. Copy the logic from `scripts/dev/clones.ts` (the `--update`
     block, about lines 85–95).
   - A package that must grow the count says why in its handoff, and the owner approves it. Only
     then may the baseline be edited by hand, in a commit that says "owner approved" and names the
     package.
   - Unit-test the counting and the comparison (same style as the `parseAllowlist` tests).
2. **Report test support apart.** `pnpm sizes` also prints "Test support:" (lines in
   `src/**/testing/` and `fixtures/`) and "Tests:" (the `.test.` and `.spec.` files, as today).
   Neither counts toward the baseline. Record all three numbers in STATUS's size table.
3. **Near-clone mode in `scripts/dev/clones.ts`.** Add `--near`. It works like the exact mode, but:
   - it flattens every identifier to `i` (keep keywords and punctuation) and every string and
     number literal, as now;
   - it uses 8-line windows, not 6.
   - **Report only.** It prints the count and the 20 biggest groups with their places, and always
     exits 0. It reads and writes no baseline. P20 reads this report to find what is left.
   - Unit-test `normalize` in the new mode on two snippets that differ only in names.
4. **`knip --production` in the merge gate.**
   - Run `pnpm exec knip --production 2>&1 | tail -80` and keep the output in the scratchpad. It
     lists unused files and exports. Do **not** fix them here: P24 deletes the dead code.
   - Add `"knip:production": "knip --production"` to `package.json`.
   - It exits non-zero today, so adding it as a gate would turn `pnpm check` red. Add it to
     `scripts/dev/check.sh` as a non-failing step named `knip (report)` that prints the number of
     findings. P24's Done when flips it to a gate.
   - Check `knip.json`: `entry` must list the real production entries, so "unused file" results
     are true. Add `worker/index.ts` and similar if knip reports them as unused.
5. **Fix the flaky draft end-to-end test.** The last pick doesn't change the heading (the page
   shows "Your N cards are in your collection" instead), so `expect.poll(() =>
pickHeading(page)).not.toBe(before)` in `pickFirstCard` times out
   (`tests/e2e/accounts.spec.ts`, search for `async function pickFirstCard`). Make the poll succeed
   when either the heading changed or the text `/Your \d+ cards are in your collection/` is
   visible. Don't add a sleep. Verify the exact lines before editing. Then run
   `pnpm test:e2e tests/e2e/accounts.spec.ts -g "draft"` three times.
6. **Per-test timeouts on the two property tests.**
   - `src/modules/drafts/domain/draft.test.ts`: the `fc.assert` at about line 192 (`numRuns: 150`).
   - `src/modules/decks/domain/optimize.test.ts`: the tests that run `optimizeDeck` many times
     (about lines 179–230).
   - Give each its own timeout as the third argument of `it(...)` (for example `20_000`). Don't
     raise the global timeout in `vitest.config.ts`.
   - Run each file twice while a `pnpm check` runs, to see that it passes under load.
7. **A pre-commit hook.** One line that runs the fast checks.
   - Check first: `grep -n "simple-git-hooks\|husky" package.json`. If `simple-git-hooks` is
     already installed, configure it. Otherwise **add no dependency**.
   - Write `scripts/dev/install-hooks.sh`. It writes a small `pre-commit` script (mode 755) into
     `git rev-parse --git-path hooks` (so it works in a worktree). The hook runs
     `pnpm exec prettier --check` on the staged files, then `pnpm --silent typecheck` and
     `pnpm --silent lint`. It is the fast part of `pnpm check`: no unit tests, so a commit stays
     under about 30 seconds.
   - Add `"hooks:install": "scripts/dev/install-hooks.sh"` to `package.json`, and one line to
     `docs/refactor/README.md` ("Starting a session"): "Run `pnpm hooks:install` once per
     checkout."
   - Don't install it for the user. Say in the handoff that they run it.
8. Keep `scripts/dev/check.sh`'s output to one line per check.

## What not to do

- Don't delete or "fix" anything knip reports. P24 owns that.
- Don't make the near-clone mode a gate. Report only.
- Don't change the 500-line benchmark or the allowlist.
- Don't add a runtime or dev dependency.

## Done when

- `pnpm sizes` prints production code lines, test support and tests on separate lines.
- `docs/refactor/sizes-baseline.txt` exists. Add a scratch line to a source file: `pnpm sizes`
  fails. After a real reduction, `pnpm sizes --update` lowers the file, and it refuses to raise.
- `pnpm clones --near` prints a count and groups, and exits 0.
- `pnpm check` is green and shows a `knip (report)` line.
- `scripts/dev/install-hooks.sh` installs a hook that rejects a badly formatted staged file.
- The two draft end-to-end tests pass three times in a row. The two property tests pass under
  load.
- STATUS's size table has a row "After P23" with the three numbers.

## Handoff

Sizes before: 79,560 code lines (old count: production plus `testing/`; fixtures skipped). After:
production **77,318** code lines (baseline file), test support **2,345** (23 files), tests
**32,905** code lines (36,730 lines, 230 files). Near-clone runs (`--near`): **229**. Exact clone
runs unchanged. `knip --production`: **766** findings (29 files, 266 exports, 471 types), report only.
`src` changed only in the two test files (timeouts). The scripts grew by about 30 production lines
(sizes ratchet and near mode); the baseline already includes them.

- **sizes:** `pnpm sizes` prints production code lines, test support and tests; fails above
  `sizes-baseline.txt`; `--update` lowers and refuses to raise. `scripts/dev/sizes.test.ts` is new.
  Fixtures now count as test support (they were skipped before).
- **near clones:** `pnpm clones --near`, 8-line windows, identifiers flattened to `i`, 100-character
  minimum (200 left only 1 group, because flattened lines are short). Report only; `clones.test.ts` is new.
- **knip:** `knip:production` script; `check.sh` gets a non-failing `knip (report)` line. In
  production mode knip needs `!` on entries, so `knip.json` has `worker/index.ts!`. Unused-file
  findings are real dead or test-only code (for P24), for example `catalog/client.ts`,
  `decks/domain/eval.ts`, `mulligan-trainer.ts`, `packages.ts`, `tests/integration/harness.ts`, and
  every `testing/` helper (test-only, so P24 must decide whether to mark them as entries).
- **e2e (PM must run):** in `pickFirstCard` the poll now succeeds when the heading changed OR
  `/Your \d+ cards are in your collection/` is visible. Run
  `pnpm test:e2e tests/e2e/accounts.spec.ts -g "draft"` three times; I could not run Playwright.
- **timeouts:** draft property test 30 s, the two optimizer tests 20 s each. Idle runs (3 each):
  draft 1.2-1.3 s; optimizer 1.7-1.8 s and 1.45-1.5 s. Under a parallel `pnpm check`: draft 2.6 s,
  optimizer 3.8 s (so the 5 s default was close).
- **hook:** `scripts/dev/install-hooks.sh` (`pnpm hooks:install`). `git rev-parse --git-path hooks`
  resolves to the shared main `.git/hooks`, so I did not run it. I ran the hook body on a staged
  badly formatted file: it failed as intended. The user runs `pnpm hooks:install` once.
- STATUS size row "After P23" is for the PM to add (I don't edit STATUS).
