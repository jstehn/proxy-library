# TCG Virtual Library

A self-hosted web app for a Magic: The Gathering playgroup that brings back the "make it out of
what you have" constraint that proxying removes. Everyone gets a weekly allowance. You buy sealed
product at MSRP, open packs with the real odds (with suspense, foils and sound), keep a collection,
buy and sell singles at market price, trade with each other, and build decks **only from cards you
own**. Then you print them as proxies and play.

Card data comes from [MTGJSON](https://mtgjson.com) (sets, booster recipes, products, precons)
and [Scryfall](https://scryfall.com) (prices, images, legality), synced nightly and cached.

It's also a TypeScript learning project: [`lessons/`](lessons/README.md) has one lesson per build
phase, written for someone coming from Python and SQL.

## Run it for your group

See [docs/deploy.md](docs/deploy.md) (Docker Compose).

## Develop

Needs Nix (with flakes) and direnv.

```sh
direnv allow          # node, pnpm and Postgres from flake.nix, env vars from .envrc
pnpm install
pnpm db:start         # a project-local Postgres in .dev/
pnpm db:migrate
pnpm worker sync      # load the catalog (downloads Scryfall's bulk file once)
pnpm dev              # http://localhost:3000, and the first account becomes the admin
```

After that, **one command runs everything** (also after a restart):

```sh
pnpm dev:all          # starts Postgres if needed, applies migrations, runs the app + the worker
```

Ctrl+C stops the app and the worker; Postgres keeps running until `pnpm db:stop`.

| Command                      | Does                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| `pnpm dev:all`               | database + migrations + app + worker, in one terminal          |
| `pnpm check`                 | typecheck, lint, format check and unit tests (before a commit) |
| `pnpm test:int`              | integration tests against the `tcg_test` database              |
| `pnpm test:e2e`              | browser tests (Playwright, with Nix's browsers)                |
| `pnpm test:remote`           | the only tests that call MTGJSON and Scryfall (run by hand)    |
| `pnpm worker schedule`       | the nightly sync and admin-queued syncs                        |
| `pnpm worker check-packs`    | opens 1,000 packs of every booster recipe and reports problems |
| `pnpm worker check-products` | checks every product for sale contains something               |

Documentation starts at [docs/README.md](docs/README.md): architecture, design docs for every
phase, and decision records.
