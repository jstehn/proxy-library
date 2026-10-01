@AGENTS.md

# Proxy Library

Self-hosted web app simulating an MTG collection: buy/open virtual sealed product, singles store,
wallet ledger, deck builder (owned cards only), trades. Also a TypeScript learning project for a
Python/SQL developer: `lessons/NN-*.md` has one lesson per build phase. Lessons **teach concepts**
(objectives → concepts with Python comparisons → mistakes → exercises with verified solutions →
recap), following `lessons/README.md`. They are not changelogs. Write or update the phase's lesson
when finishing it, verify every exercise solution compiles and passes, and commit at the end of
each lesson.

## Architecture: read before writing code

- Docs index: `docs/README.md`. Build order and per-phase workflow: `docs/roadmap.md`.
- Modular monolith: `src/modules/<module>/{domain,application,infrastructure,queries,testing}` +
  `index.ts` public API. Functional core, ports & adapters, factory-function DI, composition
  roots in `src/server/` and `worker/`. See `docs/architecture/overview.md`.
- Pattern choices: `docs/architecture/patterns.md`. Rules and naming:
  `docs/architecture/conventions.md`. Tests: `docs/architecture/testing.md`. Why: `docs/adr/`.
- **Process:** every phase starts with a design doc (`docs/design/NN-*.md` from the template) and
  the user must approve it **before** implementation code is written. New cross-cutting decisions
  become ADRs.

## Environment

- NixOS + flakes + direnv: `flake.nix` provides node 22, pnpm, postgres 17. `.envrc` sets
  `DATABASE_URL`, `PG*` vars and `IMAGE_CACHE_DIR`. Outside a direnv shell, prefix commands with
  `nix develop -c`.
- Postgres is project-local, socket-only, in `.dev/`: `pnpm db:start | db:stop | db:reset`. It
  doesn't survive a reboot: `pnpm dev:all` starts it (if needed), migrates, and runs app + worker.
- Docker Compose for deployment (docs/deploy.md). Read config only from env vars.

## Conventions (summary)

- Expected failures return `Result`, errors are `{ kind: ... }` unions, and defects throw.
- Money is integer cents: `Cents` from `@/shared/kernel` (companion object: `Cents.of/add/format`).
  Never floats.
- All randomness (pack opening) and money movement happen server-side, via injected `Rng`/`Clock`.
- Card data: MTGJSON (sets, booster sheets, sealed products) + Scryfall (prices, images,
  legalities), synced by the worker. Prefer bulk files and batched calls (`/cards/collection`, 75
  per request).
- **Readable for a TypeScript newcomer** (docs/architecture/conventions.md, "Readability"): full
  words, no abbreviations (`unitOfWork`, `dependencies`, `transaction`); named types rather than
  nested inline ones; factories unpack `dependencies`, define a named inner `function`, and return
  it by name.
- `@/*` imports resolve to `src/*`.
- Shared kernel `@/shared/kernel`, fakes `@/shared/kernel/testing`, OS adapters `@/shared/runtime`,
  DB `@/shared/db`, config `@/shared/config`. Wiring: `src/server/core.ts`.
- Commands: `pnpm check` (typecheck + lint + format + unit tests; must pass before commit),
  `pnpm test` (unit, watch), `pnpm test:int` (needs `pnpm db:start`), `pnpm test:e2e`
  (Playwright, Nix browsers; keep `@playwright/test` pinned to nixpkgs' version), `pnpm worker <cmd>`
  (`sync [prices|full]` runs a catalog sync now; `schedule` runs the nightly sync + admin-queued runs;
  `check-packs [n]` opens n packs of every booster recipe and reports rule violations;
  `check-products` checks every product for sale contains something; `check-commanders` checks every
  precon's commander is allowed to lead a deck), `pnpm test:remote` (the only
  tests that call MTGJSON/Scryfall; never run automatically).
- Automated tests never touch the network: recorded fixtures, local image responses.
- Docker: `docker compose up -d --build` (see docs/deploy.md). Dev stays on Nix + direnv.
- External data (MTGJSON, Scryfall) enters only through `catalog/infrastructure` gateways → Zod → pure
  mappers. Tests use recorded fixtures in `tests/fixtures/`, never the network. Be polite to both
  services (ADR 0007).
- Lint enforces architecture boundaries (`eslint.config.mjs`, ADR 0009). Don't disable a rule
  without a reason comment.
