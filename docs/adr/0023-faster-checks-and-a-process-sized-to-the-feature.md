# 0023. Make `pnpm check` incremental, and size the design doc and lesson to the feature

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

Two things had slowed down: `pnpm check` and building a feature. Measured on 2026-11-10:

- **`pnpm check` took 38 s.** ESLint took 16.2 s and Prettier 11.4 s, because both re-read all
  ~830 files on every run even when a commit changed only a few. The unit tests took 5.5 s,
  `tsc` 3.0 s, the cycle check 1.8 s, and the stages ran one after another. Prettier also
  re-checked `drizzle/meta/`, the generated snapshots (about 130 KB each, one per migration).
- **The writing around a feature was as big as the code.** The layers (application,
  infrastructure, fakes, module `index.ts`) added only about 100 lines per feature. Prose is
  where the cost was:
  - Commander brackets (design doc 31): about 900 lines of behaviour code, against 378 lines of
    design doc plus an 830-line lesson.
  - The "All cards" switch (design doc 29): 180 lines of code, against a 199-line design doc
    plus a 454-line lesson.

  Every feature filled in the whole 13-section template and wrote a full lesson, however small
  it was.

## Decision

**`pnpm check` only re-checks what changed, and runs its stages at the same time.**

- ESLint and Prettier run with `--cache --cache-strategy content`, so a file that passed and
  hasn't changed is skipped. Their caches live in `node_modules/.cache/`.
- `scripts/check.sh` runs typecheck, lint, the cycle check, the format check and the unit tests
  in parallel. It prints one line for each check, and prints a check's output only when that
  check fails.
- Prettier ignores `drizzle/meta/`, which only drizzle-kit writes.

**The design doc and the lesson are sized to the feature.** The approval gate stays: no
implementation code until you approve.

- **Big feature:** a new table, a new module or port, a cross-cutting decision, or work spread
  across modules. It gets a design doc, `docs/design/NN-*.md`, from the template.
- **Small feature:** anything else. It gets a short plan in the tududi task's note (what
  changes, which files, the tests, open questions), and you approve it in chat. A small feature
  gets no design doc number.
- **Either size:** delete a template section that doesn't apply instead of writing "none".
- **Lesson:** write one only when the work teaches a concept that no existing lesson covers.
  Lessons keep their full format (`lessons/README.md`). The design doc or plan states
  "Lesson: yes (topics)" or "Lesson: no", so whether to write one is decided when you approve.

## Consequences

- ✅ A typical check takes about 7 s instead of 38 s. With empty caches it takes about 21 s.
- ✅ Most of a small feature's time goes into the feature itself.
- ❌ A cached ESLint result can miss a problem that depends on another file. `tsc` still catches
  missing imports, the `boundaries` rule depends only on file paths, and a config change throws
  the cache away. `rm -rf node_modules/.cache` forces a full run.
- ❌ Parallel stages compete for CPU, so a single stage is slower than when it ran alone.
- ❌ Fewer lessons, so some smaller ideas are no longer taught. A plan that says "Lesson: no"
  can be overruled at approval.

## Alternatives considered

- **Lint and format only staged files (lint-staged):** it misses problems in files a commit
  didn't touch, while the cache still checks every file and only skips the unchanged ones.
- **Drop `react-hooks/static-components` or `boundaries`** (40% and 36% of ESLint's rule time):
  the cache already skips them for unchanged files, and `boundaries` is how ADR 0009 is
  enforced.
- **Merge the architecture layers:** they cost about 100 lines per feature, and they are part of
  what the project teaches.
