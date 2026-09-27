# 0010. Use a Nix flake + direnv for the development environment

- **Status:** Accepted (implemented in Phase 0)
- **Date:** 2026-09-26

## Context

Development starts on NixOS, and production will later run in Docker. Tool versions (node,
pnpm, postgres) must be reproducible, and the project must not depend on system services.

## Decision

- `flake.nix` dev shell provides node 22, pnpm, postgres 17 and jq. `flake.lock` pins nixpkgs.
- `.envrc` (`use flake`) sets `DATABASE_URL`, `PG*` and `IMAGE_CACHE_DIR`.
- Postgres runs project-local and **socket-only** in `.dev/` via `scripts/db.sh`.
- Application config is read exclusively from env vars, so Docker (Phase 11) needs no code
  changes.

## Consequences

- ✅ `cd` gives an identical toolchain. There's no global Postgres, and no port conflicts.
- ❌ Flakes only see git-tracked files, so new files must be `git add`ed.
- ❌ Some npm packages ship prebuilt binaries that expect FHS paths. We prefer pure-JS
  dependencies (Drizzle over Prisma) and Nix-provided binaries (Playwright browsers).

## Alternatives considered

- **Docker Compose for dev from day one:** heavier inner loop. Deferred to deployment.
- **System-wide Postgres service:** global state outside the repo.
