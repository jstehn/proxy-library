@AGENTS.md

# Proxy Library

Self-hosted web app simulating an MTG collection: buy/open virtual sealed product, singles store,
wallet ledger, deck builder (owned cards only), trades, live drafts, LLM tools. Also a TypeScript
learning project for a Python/SQL developer: the lessons live in their own repo
(`../proxy-library-lessons`, https://github.com/jstehn/proxy-library-lessons), a lesson for each build phase that teaches
something new (ADR 0023); follow its `README.md`, verify every
exercise solution, commit at the end of each lesson. Lessons teach concepts; they are not changelogs.

## Read before writing code

- Docs index: `docs/README.md`. Build order and per-phase workflow: `docs/roadmap.md`.
- Layout, layers and request flow: `docs/architecture/overview.md`. Rules, naming and "where does
  this live?": `docs/architecture/conventions.md`. Patterns: `patterns.md`. Tests: `testing.md`.
  Why: `docs/adr/`. Product rules per responsibility: `docs/modules/`.
- **Process (ADR 0023):** a big feature (new table, module or port, cross-cutting decision, work
  across modules) starts with a design doc (`docs/design/NN-*.md` from the template); a small one
  with a short plan in its tududi task. The user approves it **before** implementation code. Each
  says "Lesson: yes (topics)" or "Lesson: no". New cross-cutting decisions become ADRs.
- **Task board:** the Proxy Library project in tududi (`tududi` MCP server, `.mcp.json`, key in
  `.envrc.local`). One feature in progress at a time; new ideas go to tududi's inbox. See `docs/todo.md`.
- The 2026 refactor (doc 65) is finished; its history is in `docs/archive/refactor/`. Its ratchets
  stay in `scripts/dev/baselines/` (`pnpm check` runs them).

## Environment

- NixOS + flakes + direnv: `flake.nix` provides node 22, pnpm, postgres 17. `.envrc` sets
  `DATABASE_URL`, `PG*` and `IMAGE_CACHE_DIR`. Outside a direnv shell, prefix commands with
  `nix develop -c`.
- Postgres is project-local, socket-only, in `.dev/`: `pnpm db:start | db:stop | db:reset`. It
  doesn't survive a reboot: `pnpm dev:all` starts it, migrates, and runs app + worker.
- Docker Compose for deployment (`docs/deploy.md`). Read config only from env vars.

## Commands

- `pnpm check`: typecheck, lint, cycles, format, unit tests and the size/clone/knip ratchets, in
  parallel and cached. Must pass before commit.
- `pnpm test` (unit, watch) · `pnpm test:int` (needs `pnpm db:start`) · `pnpm test:e2e` (Playwright,
  Nix browsers; keep `@playwright/test` pinned to nixpkgs' version) · `pnpm test:remote` (the only
  tests that call MTGJSON/Scryfall; never run automatically).
- `pnpm worker <command>`: `sync`, `schedule`, `draft-timers`, `sync-rules`, `sync-edhrec`,
  `embed-cards`, `value-products`, `check-packs`, `check-products`, `check-commanders` (see
  `worker/index.ts`).

## Rules that bite

- Expected failures return `Result`, errors are `{ kind }` unions, defects throw. Money is integer
  `Cents` from `@/shared/kernel`, never floats.
- Randomness and the clock are injected (`Rng`, `Clock`); money moves server-side only.
- External data enters only through `catalog/infrastructure` gateways, then Zod, then pure mappers.
  Tests use recorded fixtures and never touch the network. Be polite to MTGJSON and Scryfall (ADR 0007).
- **Readable for a TypeScript newcomer**: full words, no abbreviations (`unitOfWork`,
  `dependencies`; lint bans `ctx`, `res`, `obj`, `val`, `tl`); named types; factories unpack
  `dependencies`, define a named inner `function`, and return it by name.
- `@/*` resolves to `src/*`. Client components import a module's pure code from
  `@/modules/<module>/client`, never its `index.ts` (`import type` is fine).
- Lint enforces the architecture (`eslint.config.mjs`, ADR 0009). Don't disable a rule without a
  reason comment.
