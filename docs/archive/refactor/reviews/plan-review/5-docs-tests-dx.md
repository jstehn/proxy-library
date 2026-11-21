# Plan review 5: docs, tests and the newcomer's first impression

A read-only review by an agent on 2026-11-19, on `refactor/main` at `48f18af`. It ran the unit
suite once.

## What it measured

| What                      | Count                                                  |
| ------------------------- | ------------------------------------------------------ |
| Tracked files             | 1,331                                                  |
| Test files                | 197 unit, 26 integration, 3 end-to-end                 |
| Unit suite                | 187 files and 1,574 tests in 11.8 s, all passing       |
| Comments                  | about 7% of lines, mostly explaining "why"             |
| `eslint-disable`          | 26                                                     |
| `as any` and `@ts-ignore` | 3                                                      |
| Missing                   | continuous integration (no `.github/`), a LICENSE file |

## Findings, ranked by first impression

1. **No CI, LICENSE or CONTRIBUTING file.** `scripts/check.sh` is good, but it only runs locally.
2. **The README pitches the project well, but some facts are stale.** It says 25 ADRs and 30
   lessons. Its module list is out of date. The root folder has more than 30 entries.
   `CLAUDE.md` mixes a project overview with rules for agents.
3. **The docs are large.** `docs/design` is about 16,000 lines in 66 files, with duplicate and
   missing numbers. The `docs/README.md` index lists notes such as `decisions-to-review`,
   `requirements-audit` and `future-ideas` at the same level as the architecture docs. Nothing
   explains how a feature works today; P22's `docs/modules/` fills that gap. **Risk:** code
   comments cite design docs about 891 times, so archiving docs must keep those numbers findable.
4. **Tests live in three places.**
   - Integration tests sit both in `src/**` and in `tests/integration`.
   - `accounts.spec.ts` is a 1,316-line grab-bag of 24 end-to-end tests. Despite its name, it also
     covers drafts, sharing and the store.
   - The pyramid itself is healthy.
5. **Some folders and index files are still too big.** `decks/domain` has 49 files, `application`
   30 and `queries` 27, against a limit of 12. `worker/index.ts` is 269 lines.
6. **`ctx` appears 216 times.** It's the one place the code doesn't follow its own naming rules;
   the rest mostly does.
7. **The tooling is strong but heavy.**
   - `eslint.config.mjs` is 508 lines, and its regex AST selectors are hard to read.
   - The Docker image ships the full source and dev dependencies.
   - Dependency versions mix exact pins with `^` ranges.
   - `scripts/` mixes development tools, operations, and personal tududi tooling.

## Test fixes

- **The flaky live-draft end-to-end test.** The last pick never changes the heading; the page
  shows "Your N cards…" instead, so the wait times out. Count that finished text as success, or
  wait on the live state rather than the heading.
- **Timeouts under load.** `optimize.test.ts` and `draft.test.ts` are property tests. Options:
  - give those tests their own timeouts
  - lower `numRuns` locally and raise it in CI
  - build their fixtures once
- **One place for integration tests.** Put them beside the module that owns them, and keep
  `tests/integration` only for journeys across modules.
- **Split `accounts.spec.ts`** by journey.

## Proposed end-state layout

```
README.md  LICENSE  CONTRIBUTING.md  .github/workflows/
src/  worker/  drizzle/  tests/{integration,e2e,fixtures}
docs/  README.md (Use / Understand / Contribute)  architecture/  modules/  adr/
       design/ (history; numbers kept)  deploy.md  contributing/
lessons/
scripts/{dev,ops}/
```

## Additions to the plan

- **P20:** split the end-to-end spec. Bring `worker/index.ts` under the limit. Make the flaky and
  slow tests part of Done when.
- **P21:**
  - Check the README's facts.
  - Tidy the docs index.
  - Set a policy for `ctx`.
  - Trim `CLAUDE.md`.
- **P22:**
  - Add a script that checks every "design doc NN" citation still resolves.
  - Decide whether `docs/refactor/` is archived or shrunk to one history page.
- **New P23:** CI, LICENSE, CONTRIBUTING, a pass over flaky tests, and a reorganized `scripts/`.

## Questions for the owner

- Will the repo be public? If so:
  - Which licence?
  - Should the tududi links and scripts be hidden?
- Is GitHub Actions CI acceptable?
- Should the lessons and the refactor docs stay in this repo?
- Is the "AI authored" note the intended first impression?
- May `accounts.spec.ts` be split and renamed?
