# P00. Set up the refactor

- **Branch:** `refactor/main` (this package creates it) · **Depends on:** none · **Parallel with:** none
- **Audit:** doc 65 sections 4.3 (guards), 8 (tests)

## Goal

Create the branches and the tools every later package relies on: the size report, the clone
ratchet, and a record of what the app does today, so rebuilt features can be compared with it.

## Touches

`scripts/`, `package.json` (scripts only), `docs/refactor/`. No app code.

## Steps

1. With the user's approval, commit doc 65 and `docs/refactor/` to `main`. Tag `main` as
   `pre-refactor`, then create `refactor/main` from it.
2. **Size report:** `scripts/dev/sizes.ts` (run with `tsx`, like `check-cycles.ts`) and
   `pnpm sizes`. It lists non-test `.ts`/`.tsx` files over 500 lines and fails when one isn't in
   `docs/refactor/oversize-allowlist.txt` (format: `path  # reason`). Seed the allowlist with
   today's 28 files, each with `# pre-refactor, owned by Pnn` (the owner is the package whose
   **Touches** names the file; use P20 if none does). It also prints test files over 500 lines,
   as information only. It also prints the totals tracked in STATUS's **Size tracking** table:
   source lines, test lines, the 10 biggest folders by source-file count, every `index.ts`
   over 150 lines, and the `getContainer()` count in `src/app`.
3. **Clone ratchet:** `scripts/dev/clones.ts`. Hash every run of 6 normalized lines (strip
   whitespace, string and number literals, imports, comments and lone brackets; skip runs shorter
   than 200 characters; skip `*.test.*` and `testing/`). Count the runs that appear in more than
   one place, and fail if the count is above `docs/refactor/clone-baseline.txt`. With `--update`,
   it lowers the baseline (never raises it). The baseline on 2026-11-18 was 83.
4. Add both to `scripts/dev/check.sh` as two more parallel entries (`sizes`, `clones`).
5. **Reference outputs:** `scripts/dev/reference-outputs.ts` calls each of the 16 registered tools
   (`src/app/_llm-tools/registry.ts`) through `callTool` against the integration test database
   (reuse the setup in `src/app/_llm-tools/llm-tools.int.test.ts`). It writes
   `docs/refactor/reference/tools/<tool>.json` with ids and timestamps replaced by placeholders.
   This is a one-off record, not a test.
6. **Feature inventory:** `docs/refactor/reference/features.md`, a checklist with one line per
   page under `src/app/**/page.tsx`, per server action file, and per LLM tool, saying what it does
   in a few words. Milestones tick these off.

## Done when

- `pnpm check` runs sizes and clones and passes on `refactor/main`.
- The reference JSON and the feature checklist are committed.

## Re-check the numbers

```bash
find src worker scripts \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' | xargs wc -l | awk '$1>500 && $2!="total"' | wc -l
```

## Handoff

Done on `refactor/main` (tag `pre-refactor` on `main`): `pnpm sizes`, `pnpm clones`, both in
`pnpm check`; allowlist (28 files, owners chosen by the package whose Touches names the file, else
P20); reference JSON for the 16 tools; feature checklist.

- `scripts/dev/sizes.ts` counts `scripts/` and its own ~130 lines, so source is 93,490 against the
  audit's 93,361. Test lines include `tests/` (33,860 against 32,194): different counting, not growth.
- `scripts/dev/clones.ts` counts distinct 6-line runs that occur in 2+ places: 63 today, not the
  audit's 83 (a different counting method). `clone-baseline.txt` holds 63; later packages compare
  with that.
- `reference-outputs.ts`: run with `DATABASE_URL=$TEST_DATABASE_URL pnpm exec tsx scripts/dev/reference-outputs.ts`.
  The four tools that call outside services (edhrec_lookup, find_combos, youtube_research,
  reddit_research) are not called; their file holds the input schema. `rules_lookup` returns "rules
  not synced" in the fixture database. `draw_sample` card order changes from run to run.
- Source lines before and after: 93,361 to 93,490 (the new scripts).
