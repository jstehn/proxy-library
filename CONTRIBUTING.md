# Contributing

Thanks for looking. Proxy Library is a personal playgroup project, so changes are reviewed on a
best-effort basis. Please read the [code of conduct](CODE_OF_CONDUCT.md) first. The project is
licensed under [0BSD](LICENSE).

## Set up

**With Nix and direnv (the way the project is developed):**

```sh
direnv allow          # loads Node 22, pnpm and Postgres 17 (with pgvector) from flake.nix
pnpm install
pnpm hooks:install    # a pre-commit hook: Prettier on staged files, typecheck, lint
pnpm dev:all          # starts Postgres, migrates, runs the app and the worker
```

**Without Nix:** install Node 22, pnpm (the version in `package.json`'s `packageManager`) and
Postgres 17 with the `pgvector` extension. Then set the variables `.envrc` exports
(`DATABASE_URL`, `TEST_DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `IMAGE_CACHE_DIR`,
`SYNC_CACHE_DIR`; see `.envrc`) and create the databases `tcg` and `tcg_test`. Then run
`pnpm install`, `pnpm db:migrate`, and `pnpm dev`.

The first registered user becomes the admin. Load the card catalog with `pnpm worker sync`.

## Commands

| Command         | Does                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`    | The gate, which must pass before a commit: typecheck, lint, import cycles, format, unit tests, size and clone ratchets, knip |
| `pnpm test`     | Unit tests in watch mode                                                                                                     |
| `pnpm test:int` | Integration tests against the `tcg_test` database (`pnpm db:start` first)                                                    |
| `pnpm test:e2e` | Browser tests (Playwright)                                                                                                   |

Automated tests never use the network: they use recorded fixtures. CI
([`.github/workflows/check.yml`](.github/workflows/check.yml)) runs `pnpm check` and the
integration tests.

## How changes are made

A **small change** starts with a short plan (what changes, which files, which tests) in the
issue or pull request. A **big change** (a new table, module or port, a cross-cutting decision,
or work across modules) starts with a design doc from [`docs/design/TEMPLATE.md`](docs/design/TEMPLATE.md),
and is agreed before the code is written. A decision that affects the whole codebase becomes an
ADR in [`docs/adr/`](docs/adr/README.md).

Please keep a change to one purpose, add tests with it, and run `pnpm check` before you push.

## Where things live

[`docs/README.md`](docs/README.md) is the index. Start with
[`docs/architecture/overview.md`](docs/architecture/overview.md) (modules and layers),
[`docs/architecture/conventions.md`](docs/architecture/conventions.md) (naming and TypeScript
rules) and [`docs/architecture/testing.md`](docs/architecture/testing.md).

## The rules that matter

- **Functional core.** Business rules are pure functions in `domain/`; I/O lives in
  `infrastructure/`. Modules talk to each other only through their `index.ts`, and ESLint
  enforces the boundaries ([ADR 0009](docs/adr/0009-lint-enforced-boundaries.md)).
- **Expected failures are values.** Use-cases return a `Result` with a `{ kind: ... }` error;
  only defects throw ([ADR 0003](docs/adr/0003-result-types.md)).
- **Money is integer cents** (`Cents` from `@/shared/kernel`), never floats. Randomness and the
  clock are injected, so they can be replayed in tests.
- **Readable names.** Full words, no abbreviations (`transaction`, not `tx`), named types
  instead of nested inline ones.
- **Don't disable a lint rule** without a comment saying why.
