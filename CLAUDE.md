@AGENTS.md

# TCG Virtual Library

Self-hosted web app simulating an MTG collection: buy/open virtual sealed product, singles store,
wallet ledger, deck builder (owned cards only), trades. Also a TypeScript learning project for a
Python/SQL developer: `lessons/NN-*.md` has one lesson per build phase. Update the relevant lesson
when finishing a phase, and commit at the end of each lesson.

## Environment

- NixOS + flakes + direnv: `flake.nix` provides node 22, pnpm, postgres 17. `.envrc` sets
  `DATABASE_URL`, `PG*` vars and `IMAGE_CACHE_DIR`. Outside a direnv shell, prefix commands with
  `nix develop -c`.
- Postgres is project-local, socket-only, in `.dev/`: `pnpm db:start | db:stop | db:reset`.
- Docker comes later (Phase 10). Read config only from env vars.

## Conventions

- Money is integer cents (`Cents` in `src/lib/money.ts`). Never floats.
- All randomness (pack opening) and money movement happen server-side.
- Card data: MTGJSON (sets, booster sheets, sealed products) + Scryfall (prices, images,
  legalities). Prefer bulk files and batched calls (`/cards/collection`, 75 per request).
- `@/*` imports resolve to `src/*`.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.
