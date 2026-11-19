# P21. Naming sweep, README fact check and trimmed `CLAUDE.md`

> **Re-scoped by the plan review.** New: rename `ctx` (about 250 uses), check every fact in the
> README, and trim `CLAUDE.md`. P34 owns the new README sections, CI and licence.

- **Branch:** `refactor/P21-naming-docs` · **Depends on:** P18, P20, P30, P33 (it renames in files those packages change, so it goes last) · **Parallel with:** P22, P34 (the `CLAUDE.md` edits of P34 start after this package merges)
- **Audit:** doc 65 F10, section 4.3 (the "where does this live?" table); [plan review](../reviews/plan-review/README.md) report [5](../reviews/plan-review/5-docs-tests-dx.md) · **Ends wave 6 → final milestone**
- **Lines:** none to remove. The renames don't change line counts; the docs shrink.

## Goal

The code follows its own naming rule (full words, no abbreviations), the README's facts are true,
`CLAUDE.md` is short and says only what agents need, and the docs describe the new architecture.

## Deletes

| What                                                                                                                                                               | Where                                                                                                           | Lines      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------- |
| Abbreviations: `ctx` (about 244 uses), `res`, `obj`, `val`, `tl`                                                                                                   | `drafts/domain/steps.ts` (65 `ctx`), `drafts/domain/{timers,draft,…}.ts`, `decks/domain/*`, `worker/`, the rest | renamed    |
| `docs/decisions-to-review.md`                                                                                                                                      | moved to `docs/archive/` (git mv)                                                                               | 0          |
| The parts of `CLAUDE.md` that restate `docs/architecture/*` and `docs/README.md` (the module list, the commands table, the conventions summary): replaced by links | `CLAUDE.md`                                                                                                     | −40 to −60 |
| Stale statements in the README (counts of ADRs, lessons, modules; the module list; features P24 removed)                                                           | `README.md`                                                                                                     | edits      |
| `CONTAINER_ALLOWED`: re-check each reason                                                                                                                          | `eslint.config.mjs`                                                                                             | −5 to −15  |

## Touches

Any file using `ctx`, `res`, `obj`, `val` or `tl` (command below), `docs/architecture/*.md`,
`docs/README.md`, `docs/decisions-to-review.md`, `README.md`, `CLAUDE.md`, `eslint.config.mjs`.

## Steps

1. **Rename `ctx`** to a full word that says what it is (`context` where it is a context;
   `draftContext`, `stepContext`, `timerContext` in the drafts steps; `requestContext`…).
   One module per commit, `pnpm typecheck` after each. Use the TypeScript rename (an editor
   rename, or `ts-morph` if it is installed; otherwise careful `sed` with word boundaries and a
   full `pnpm check` after). Then rename `res`, `obj`, `val` and `tl` the same way.
2. **Lint it.** Add a `no-restricted-syntax` selector for identifiers named `ctx`, `res`, `obj`,
   `val` and `tl` in `src` and `worker` (except in `.d.ts` and where a library's callback type
   forces a name: each exception has a reason comment). It needs to be in the same commit as the
   last rename.
3. **README fact check.** For every number and name in `README.md` (ADR count, lesson count, module
   list, test counts, commands, versions, features), check it against the repo (`ls docs/adr | wc -l`,
   `ls src/modules`, `pnpm test` summary, `package.json`). Fix what is false. Don't add sections
   (P34 does).
4. **Trim `CLAUDE.md`.** Keep: what the project is, the process rule (ADR 0023) in two lines, the
   environment (Nix, direnv, db), and the commands. Replace the "Architecture", "Conventions" and
   module descriptions with links to `docs/README.md`, `docs/architecture/conventions.md` and
   `docs/architecture/overview.md`. Don't touch the `@AGENTS.md` line. The goal is under 80 lines.
5. `conventions.md`: add the "where does this live?" table (one row per duplication group in doc 65
   section 4.1, pointing to its home now), the 500-line benchmark, the adapter rules from ADR 0026
   and its read-layer addendum (P25), the UI rules from P31–P33 (blocks, tokens, `CardImage`,
   `paths.ts`), and the comment policy (owner answer 2: a short summary on exported functions; other
   comments explain why).
6. `patterns.md`: use the effect registry (P28), `FORMAT_RULES`, card features and bindings as the
   worked examples. `overview.md`: check the module table and graph against P18 and P30, and the
   request walkthrough (it should show a capability, `reads` and two adapters).
7. Move `decisions-to-review.md` into `docs/archive/` and tidy the `docs/README.md` index so it
   reads Use / Understand / Contribute, with notes such as `future-ideas` and `requirements-audit`
   under a "Notes" heading at the end.
8. Re-check the `CONTAINER_ALLOWED` reasons in `eslint.config.mjs` (`_oauth/http.ts`,
   `api/health/route.ts`; see [removal-list.md](../removal-list.md)). Remove an entry if its
   reason is gone.
9. **Final milestone (4):** tick every row in `reference/features.md`, run the full suite (`pnpm check`,
   `pnpm test:int`, `pnpm test:e2e`), and ask the user about merging into `main`.

## Re-check the numbers

```bash
for w in ctx res obj val tl; do printf "%s %s\n" $w $(grep -rwE "$w" src worker --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l); done
wc -l CLAUDE.md
```

## What not to do

- Don't rename public names that appear in the database, the tool API or URLs.
- Don't rewrite docs for style. Fix what is false, and what restates another file.
- Don't delete `AGENTS.md` or its block (Next.js rewrites it).

## Done when

- The command above prints 0 for each word (outside tests and documented exceptions), and the lint
  rule keeps it so.
- `CLAUDE.md` is under 80 lines and links instead of restating. The README has no false fact
  (the handoff lists each fix).
- `pnpm check` is green. The final milestone's checks are listed in STATUS.

## Handoff

(empty)
