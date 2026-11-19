# P34. Repo polish: CI, licence, contributing, README, tidy root

- **Branch:** `refactor/P34-repo-polish` · **Depends on:** P23 (the hook and `pnpm check` it runs). Start the `CLAUDE.md` and ADR 0023 step after P21 merges, because P21 also edits `CLAUDE.md`. · **Parallel with:** P20, P22, P32, P33
- **Source:** [plan review](../reviews/plan-review/README.md) (P34; owner answers 10, 12 and "the repo is public"), report [5](../reviews/plan-review/5-docs-tests-dx.md)
- **Lines:** about +120 lines of workflow, scripts and path edits, and no change to `src`. Docs and root files only. It is not counted against the ratchet (the files are YAML and Markdown).

## Why

The repo is public. A newcomer sees: no CI (`scripts/check.sh` only runs locally), no `LICENSE`, no
`CONTRIBUTING`, a root folder with 30+ entries, and `scripts/` mixing development tools, operations
and personal tududi tooling. The owner's answers:

- **CI on GitHub Actions: fine.** The owner's own habit is pre-commit hooks (P23 added the hook;
  this package adds CI).
- **Licence: 0BSD** (free to use and edit, no attribution). A code of conduct states the intent
  against hateful use. (It is not a licence term: say so in its text.)
- **README:** a screenshot, a diagram, and the AI-authorship note kept clear and honest but
  **lower down**, not the first thing a reader sees.
- **Lessons move to their own repo** (answer 12). ADR 0023 and `CLAUDE.md` change from
  "Lesson: yes" to a pointer to that repo.
- **`docs/refactor/` is archived when the refactor ends** (answer 7).

## Deletes

| What                                                                                                                                                                                  | Where                                                                            | Lines                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `lessons/` (33 files), moved to the new repo with their history if the owner wants it                                                                                                 | `lessons/`                                                                       | about −16,000 lines of Markdown (not code lines) |
| Personal tooling out of the repo: `scripts/tududi-mcp.py`, `scripts/tududi-headers.sh`, `.mcp.json`'s tududi entry, `.envrc.local.example`'s tududi key, and the tududi links in docs | `scripts/`, root                                                                 | −150                                             |
| The "Lesson: yes" process text                                                                                                                                                        | `docs/adr/0023-...md`, `CLAUDE.md`, `docs/design/TEMPLATE.md`, `docs/roadmap.md` | −30                                              |
| The AI-authorship block at the top of the README (rewritten lower down)                                                                                                               | `README.md`                                                                      | moved                                            |

Verify before moving: `grep -rn "tududi" --include='*' -l . | grep -v node_modules | grep -v "^./docs/refactor"`,
`ls lessons | wc -l`, and `grep -rn "lessons/" --include='*.md' -l .`.

## Touches

New `.github/workflows/check.yml`, `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `README.md`,
`scripts/{dev,ops}/` (moved files), `package.json` (script paths), `Dockerfile`, `deploy/`,
`docs/deploy.md`, `.mcp.json`, `docs/adr/0023-*.md`, `CLAUDE.md`, `docs/design/TEMPLATE.md`,
`docs/README.md`.

## Steps

1. **CI.** `.github/workflows/check.yml`, on push and pull request to `main` and `refactor/main`:
   - Node 22, `pnpm/action-setup` at the version in `package.json`'s `packageManager` (check),
     `pnpm install --frozen-lockfile`, cache the pnpm store.
   - Run `pnpm check`. That is the same gate as local (typecheck, lint, cycles, format, unit tests,
     sizes, clones, knip).
   - A second job for integration tests with a `pgvector/pgvector` Postgres 17 service container
     and `DATABASE_URL` set (read `.envrc` and `scripts/db.sh` for the variables and the
     extensions the migrations need): `pnpm test:int`. Mark it optional first; make it required
     only when it passes three times in a row.
   - No end-to-end job yet (Playwright needs browsers; note it as a follow-up).
   - Pin action versions by tag. Don't add secrets. Don't push; the PM pushes (the owner decides).
2. **Licence and conduct.** `LICENSE` with the 0BSD text (the SPDX template; use the owner's name
   from `git config user.name` and the year). `CODE_OF_CONDUCT.md`: short, plain; states the
   project's intent that it not be used for hateful purposes, and says that this is a statement of
   intent and not a licence condition. Add `"license": "0BSD"` to `package.json`.
3. **`CONTRIBUTING.md`.** How to set up (Nix and direnv, or Node 22 and pnpm and Postgres 17), the
   commands (`pnpm check`, `pnpm test:int`, `pnpm test:e2e`), `pnpm hooks:install`, the process in
   one paragraph (small change: a short plan; big change: a design doc first; ADRs), where things
   live (link `docs/README.md`), and the rules that matter (functional core, `Result`, no
   abbreviations).
4. **README.** Keep the pitch and the screenshots. Add:
   - A short architecture diagram (a Mermaid block: browser → pages/actions/tools → capabilities
     and reads → modules → Postgres; worker beside it). Check it against
     `docs/architecture/overview.md` and P30's module list.
   - A "Quick start" that is correct today (copy from `docs/deploy.md`; test each command).
   - Move the "How this is built" block **lower**, under a heading such as "How this was built".
     Keep it clear and honest: mostly written by AI coding assistants, the owner sets
     requirements, approves designs and tests with their playgroup. Don't soften or inflate it.
   - Fix facts: the numbers of ADRs, modules and tests, and the feature list (P24 removed the
     mulligan trainer, card packages and the interactive goldfish; check that P24 and P21 already
     did this, and fix what is left).
5. **Tidy the root and `scripts/`.** Target: `scripts/dev/` (check, db, dev-all, sizes, clones,
   cycles, reference outputs), `scripts/ops/` (deploy, backup). `git mv`, then fix every path:
   `package.json`, the `Dockerfile`, `deploy/`, `docs/deploy.md`, `CLAUDE.md`, `eslint.config.mjs`,
   `knip.json`, the `check.sh` itself (`cd "$(dirname "$0")/../.."`), the docs under
   `docs/refactor/`. Run `grep -rn "scripts/" . --include='*' -l | grep -v node_modules` and fix
   each hit. Check that `pnpm check`, `pnpm db:start` (not run; read it), and `docker build`
   stay valid by reading the paths.
6. **Personal tooling.** Move the tududi scripts and `.mcp.json` out of the tracked tree: either
   into a private repo, or add them to `.gitignore` and keep local copies (the owner picks). Remove
   tududi links from public docs outside `docs/refactor/`. (`docs/refactor/` still mentions tududi
   until it is archived.)
7. **Lessons to their own repo** (after P21 merges). Create the move as a patch for the owner:
   - Prepare the folder `lessons/` as a ready-to-push tree in the scratchpad (with `README.md`
     and its history if wanted: `git subtree split --prefix=lessons`). **Don't create the
     repository or push anything**: the owner does.
   - In this repo: delete `lessons/`, change ADR 0023 (a change-log line and the "Lesson" bullet:
     lessons live in the sibling repo, link in the README), `CLAUDE.md` ("Lesson: yes" becomes "see
     the lessons repo"), `docs/design/TEMPLATE.md` and `docs/roadmap.md`. Fix the links that
     point into `lessons/` (`grep -rn "lessons/" --include='*.md' .`).
8. **The refactor docs.** Don't archive `docs/refactor/` yet; it is archived when the refactor
   ends (STATUS says when). Add a line to STATUS's "Decisions made" that P34 prepared the move.
9. Run `pnpm check`. `pnpm sizes --update` is not needed (no source change); say so.

## What not to do

- Don't create a GitHub repo, push, or open a pull request.
- Don't change the licence to anything but 0BSD. Don't add a licence header to source files.
- Don't commit secrets or `.envrc.local`.
- Don't rewrite the README's feature list beyond fixing facts.

## Done when

- `.github/workflows/check.yml` is valid YAML (check with `pnpm exec prettier --check` on it), and
  its `check` job runs the same command as local.
- `LICENSE` (0BSD), `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md` exist and are linked from the README.
- `ls scripts` shows `dev` and `ops` only (plus `README.md` if you add one), and
  `grep -rn "scripts/check.sh\|scripts/db.sh" package.json CLAUDE.md docs` shows the new paths.
- `ls lessons` fails in this repo; ADR 0023 and `CLAUDE.md` point to the lessons repo.
- `pnpm check` is green. The handoff lists every moved path and what the owner must do (create
  the lessons repo, push, turn on CI).

## Needs the owner

- Where the lessons repo lives and its name; whether to keep history.
- Whether the tududi scripts go to a private repo or are just ignored.
- The wording of the code of conduct, and whether CI integration tests are required.
- The final README screenshot and the "How this was built" text.

## Handoff

(empty)
