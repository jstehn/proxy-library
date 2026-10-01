# Proxy Library

**A learning project:** a self-hosted web app for a Magic: The Gathering playgroup, built to learn
TypeScript and to practice software engineering the way a team would, from design documents
to deployment.

> **How this was built, up front:** most of the code was written by an AI coding assistant
> (Claude Code). It was _vibe coded_, but not unattended. I set the requirements, reviewed and
> approved a design document before every phase was built, made the final call on every design
> decision, tested the app against real data, and sent back what was wrong. The goal was to
> learn: to read, question and understand every part of a real codebase, and to practice the
> engineering process around it, not to type every line myself.

## What it is

Proxying in Magic (printing stand-in cards) removes the old constraint of building decks from what
you own. Proxy Library brings it back for a group of friends:

- Everyone gets a **weekly allowance** of play money, kept in an append-only ledger.
- **Buy sealed product** at its official price and **open packs** with realistic odds, built
  from real booster recipes, with animations, foils and sound.
- **Keep a collection**, buy and sell **singles** at market price, and **trade** cards and money
  with other players.
- **Build decks only from cards you own**, with Scryfall-style search, live statistics and
  Commander rules, then **print the deck as proxies** in a PDF with cutting guides.

Card data comes from [MTGJSON](https://mtgjson.com) and [Scryfall](https://scryfall.com), synced
nightly and cached. Official product photos come from Wizards Play Network. It runs on my home
server for my playgroup.

## Why it exists

I come from **Python and SQL**. I wanted to learn TypeScript and modern web development properly,
and to practice the habits that matter more than any one language: writing down a design before
building, recording decisions and their trade-offs, testing at the right levels, keeping
architecture boundaries honest, and shipping to a real environment.

So every build phase produced three things besides code:

1. A **design document** I reviewed and approved before any implementation started
   ([docs/design/](docs/design/)), with my decisions written into it.
2. **Architecture Decision Records** for choices that cut across the codebase
   ([docs/adr/](docs/adr/README.md), 16 so far).
3. A **lesson** that teaches the concepts the phase used, compared with Python, with exercises
   whose solutions are verified to compile and pass ([lessons/](lessons/README.md), 15 so far).
   The lessons are how I made sure I understood the code instead of only accepting it.

## My role

What I decided and did, rather than delegated:

- **Requirements and scope:** what the app should do, phase by phase, and what's out of scope
  ([roadmap](docs/roadmap.md), [future ideas](docs/future-ideas.md)).
- **Design approval:** no phase was built before I approved its design document. Each one ends
  with open questions, and I answered them: for example, the starting money and weekly
  allowance, when a deck's color filter applies, how double-faced cards print on proxy sheets,
  and whether foils print on their own pages.
- **Testing on real data and pushing back:** I used the app and reported what was wrong:
  duplicate cards in booster packs, product photos that didn't fit their frames, commanders
  the rules wrongly rejected, cards too small to read. Several of these led to researching
  how real products behave, then changing the rules and the tests to match.
- **Reviewing trade-offs:** decisions with a reasonable alternative are listed for review in
  [docs/decisions-to-review.md](docs/decisions-to-review.md), with where to change each one.
- **Running it:** the deployment to my home server (Docker, Portainer, nightly backups) and its
  configuration.

## Engineering practices on show

| Practice                                                                | Where to look                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Modular monolith, ports & adapters, functional core                     | [docs/architecture/overview.md](docs/architecture/overview.md), [ADR 0001](docs/adr/0001-modular-monolith.md) |
| Architecture rules enforced by lint, not by convention                  | [ADR 0009](docs/adr/0009-lint-enforced-boundaries.md), `eslint.config.mjs`                                    |
| Expected failures as values (`Result`), not exceptions                  | [ADR 0003](docs/adr/0003-result-types.md)                                                                     |
| Money as integer cents in an append-only ledger, with row locks         | [ADR 0004](docs/adr/0004-append-only-ledger.md), [lesson 03](lessons/03-wallet-ledger-and-time.md)            |
| Transactions across modules (unit of work)                              | [ADR 0005](docs/adr/0005-unit-of-work.md), [lesson 06](lessons/06-transactions-across-modules.md)             |
| Outside data behind an anti-corruption layer                            | [ADR 0007](docs/adr/0007-external-data-acl.md), [lesson 04](lessons/04-pulling-in-outside-data.md)            |
| Replayable randomness (injected seeds and clocks) and statistical tests | [ADR 0008](docs/adr/0008-injected-rng-clock.md), [lesson 05](lessons/05-randomness-you-can-trust.md)          |
| A small query language: parser → syntax tree → parameterized SQL        | [lesson 14](lessons/14-a-search-language-and-paper.md)                                                        |
| Reproducible dev environment (Nix flakes + direnv)                      | [ADR 0010](docs/adr/0010-nix-dev-environment.md)                                                              |
| Design docs and decision records for every phase                        | [docs/design/](docs/design/), [docs/adr/](docs/adr/README.md)                                                 |

**Testing** is layered by cost: about 450 fast unit tests (pure domain logic, fakes for every
port), about 80 integration tests against a real Postgres, and browser tests (Playwright) for
whole journeys. **No automated test touches the network:** external data comes from recorded
fixtures, and a small opt-in suite checks the real services by hand. Checks against real data
also run as commands, e.g. opening 1,000 packs of every booster recipe and reporting any rule
violation.

## Tech stack

TypeScript throughout · Next.js 16 (App Router, server actions) and React 19 · PostgreSQL 17 with
Drizzle ORM · Zod · Better Auth · Tailwind CSS · Vitest and Playwright · pdf-lib · Nix flakes for
development, Docker Compose and Portainer for deployment.

## Status and limits

This is a **learning project, not a product**. It serves one invite-only playgroup on a home
server. It hasn't been load-tested or security-audited for the open internet, and features are
added when they teach something or my group asks for them. It's roughly 25,000 lines of
TypeScript (excluding tests), built in phases 0–14 of the [roadmap](docs/roadmap.md); phase 15
is in design.

## Repository tour

| Path                                               | What's there                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`src/modules/`](src/modules/)                     | The modules: catalog, packs, store, inventory, collection, decks, trades, wallet, accounts… each with `domain`, `application`, `infrastructure`, `queries` and `testing` |
| [`src/app/`](src/app/)                             | The Next.js pages and server actions (the delivery layer)                                                                                                                |
| [`src/server/`](src/server/), [`worker/`](worker/) | Composition roots: the only places that wire real implementations                                                                                                        |
| [`docs/`](docs/README.md)                          | Architecture, design docs, ADRs, roadmap, deployment                                                                                                                     |
| [`lessons/`](lessons/README.md)                    | One lesson per phase, with a [glossary](lessons/GLOSSARY.md)                                                                                                             |
| [`tests/`](tests/)                                 | Integration and browser tests, and recorded fixtures                                                                                                                     |

## Running it

**For a playgroup:** see [docs/deploy.md](docs/deploy.md) (Docker Compose).

**For development** (needs Nix with flakes, and direnv):

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

| Command                        | Does                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `pnpm dev:all`                 | database + migrations + app + worker, in one terminal          |
| `pnpm check`                   | typecheck, lint, format check and unit tests (before a commit) |
| `pnpm test:int`                | integration tests against the `tcg_test` database              |
| `pnpm test:e2e`                | browser tests (Playwright, with Nix's browsers)                |
| `pnpm test:remote`             | the only tests that call MTGJSON and Scryfall (run by hand)    |
| `pnpm worker schedule`         | the nightly sync and admin-queued syncs                        |
| `pnpm worker check-packs`      | opens 1,000 packs of every booster recipe and reports problems |
| `pnpm worker check-products`   | checks every product for sale contains something               |
| `pnpm worker check-commanders` | checks every precon's commander may lead a Commander deck      |

## Legal

Proxy Library is unofficial Fan Content permitted under the
[Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not
approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast.
©Wizards of the Coast LLC. It's free, and it has no affiliation with Wizards of the Coast,
MTGJSON or Scryfall. Proxies it prints are for casual play, not for sale.
